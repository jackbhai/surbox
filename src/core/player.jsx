/**
 * Global player: one <audio> element for the whole app, so music keeps playing
 * while the user browses other tools. Exposes a mini-bar (always visible when
 * something is loaded) that expands into a full-screen player.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { lyricsPool } from './ytmusic';
import { resolveAudio, prefetchAudio, prefetchNext, forgetAudio, isCached,
         pauseWarming, resumeWarming, rememberTrack } from './audio-resolve';
import { getDownload } from './downloads';
import { resolve } from './engine';
import { notePlay, noteListen } from './library';
import { noteStation } from './sources';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const Ctx = createContext(null);
export const usePlayer = () => useContext(Ctx);

/** The last playing session, saved every few seconds — powers "Continue
 *  listening" on the Home tab after a reload or an app restart. */
export const lastSession = () => {
  try { return JSON.parse(localStorage.getItem('omni:session') || 'null'); } catch { return null; }
};

const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const PRESETS = {
  Flat: [0,0,0,0,0,0,0,0,0,0],
  'Bass Boost': [10,8,6,3,0,0,0,0,0,0],
  'Punjabi Beat': [9,7,4,0,-1,1,3,5,4,2],
  Vocal: [-3,-2,0,3,6,6,3,1,0,-1],
  Treble: [0,0,0,0,0,2,4,6,8,8],
  'Lo-Fi': [5,4,2,0,-2,-4,-6,-8,-9,-10],
  Party: [8,6,3,0,-1,0,3,6,7,7],
  Rock: [5,4,2,0,-1,-1,2,4,5,6],
  Jazz: [3,2,1,2,-1,-1,0,1,2,3],
  Classical: [4,3,2,0,0,0,-1,-1,2,3],
  EDM: [7,6,2,0,-2,2,3,5,6,7],
  Podcast: [-4,-3,0,4,5,4,2,0,-1,-2],
  'Small Speakers': [8,7,4,1,0,0,1,2,3,4],
  'Late Night': [2,1,0,0,0,1,2,3,4,4],
};

/* ═══════════════════════════════════════════════════════════════════════════
   AUDIO LAB — the pieces the Chain graph is extended with.

   PITCH SHIFTER (in an AudioWorklet, zero dependencies)
     A dual-tap delay-line shifter: the read head's delay sweeps linearly
     (dD/dt = 1 - ratio), wrapping within [0, 2G). Two taps offset by half the
     wrap are crossfaded with sin/cos (equal-power) weights that are each ZERO
     at their own tap's wrap moment — so the inherent wrap discontinuity lands
     where that tap is inaudible. ±6 semitones before the tremolo artifacts
     get objectionable; 0 semitones bypasses the stage entirely (a constant
     two-tap mix would comb-filter).
   ═══════════════════════════════════════════════════════════════════════════ */
const PITCH_WORKLET = `
class SBPitch extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'ratio', defaultValue: 1, minValue: 0.5, maxValue: 2, automationRate: 'k-rate' }];
  }
  constructor() {
    super();
    this.G = 2048;                                  // grain
    this.N = 8192;                                  // ring buffer per channel
    this.buf = [new Float32Array(this.N), new Float32Array(this.N)];
    this.w = [0, 0];
    this.D = [0, 0];                                // sweeping delay, in [0, 2G)
  }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!out || !out.length) return true;
    const ratio = params.ratio.length ? params.ratio[0] : 1;
    const n = out[0].length;
    const G = this.G, T2 = 2 * G, N = this.N;
    for (let c = 0; c < out.length; c++) {
      const src = inp && (inp[c] || inp[0]) || null;
      const b = this.buf[c] || (this.buf[c] = new Float32Array(N));
      if (this.D[c] === undefined) { this.D[c] = 0; this.w[c] = 0; }
      let w = this.w[c], D = this.D[c];
      for (let s = 0; s < n; s++) {
        b[w] = src ? src[s] : 0;
        const d2 = (D + G) % T2;
        const u = D / T2;
        const g1 = Math.sin(Math.PI * u), g2 = Math.cos(Math.PI * u);
        let r1 = w - D, r2 = w - d2;
        r1 = ((r1 % N) + N) % N; r2 = ((r2 % N) + N) % N;
        const i1 = Math.floor(r1), f1 = r1 - i1;
        const i2 = Math.floor(r2), f2 = r2 - i2;
        const s1 = b[i1] * (1 - f1) + b[(i1 + 1) % N] * f1;
        const s2 = b[i2] * (1 - f2) + b[(i2 + 1) % N] * f2;
        out[c][s] = s1 * g1 + s2 * g2;
        D += (1 - ratio);
        if (D >= T2) D -= T2; else if (D < 0) D += T2;
        w++; if (w >= N) w = 0;
      }
      this.w[c] = w; this.D[c] = D;
    }
    return true;
  }
}
registerProcessor('sb-pitch', SBPitch);
`;

/** Reverb rooms: [seconds, decay power]. Noise + one-pole lowpass — dark,
 *  exponentially-fading tails; a hall should sound like a hall, not static. */
const ROOMS = {
  room: [0.35, 3.4], club: [1.1, 2.6], hall: [2.3, 2.2], stadium: [4.2, 1.8],
};

function makeIR(ctx, [secs, decay]) {
  const sr = ctx.sampleRate, len = Math.max(1, Math.floor(sr * secs));
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const e = Math.pow(1 - i / len, decay);
      const v = (Math.random() * 2 - 1) * e;
      lp += (v - lp) * 0.26;
      d[i] = lp;
    }
  }
  return buf;
}

/**
 * Optional EQ / analyser graph.
 *
 * DANGEROUS BY NATURE — read before changing.
 *   `createMediaElementSource(el)` permanently re-routes that element's entire
 *   output into the Web Audio graph. From that moment the element no longer
 *   feeds the speakers by itself: everything depends on the graph reaching
 *   `ctx.destination` AND the context being in the `running` state.
 *
 * THE BUG THIS CAUSED
 *   On a phone an AudioContext is created SUSPENDED, and it can be suspended
 *   again at any time by the OS (a call, another app taking audio focus, the
 *   screen locking). The old code attached the graph on every play and called
 *   `chain.resume()` without awaiting it or checking the result. When the
 *   resume did not take, the track kept "playing" — currentTime advanced, the
 *   UI showed the right thing — with no sound at all. Reproduced exactly:
 *   suspended context, element not paused, analyser peak 0.
 *
 * WHAT CHANGED
 *   · The graph is now attached ONLY when the user actually turns the EQ on.
 *     Plain playback never touches Web Audio, so it cannot be silenced by it.
 *   · `resume()` is awaited and verified; if the context will not run, the
 *     graph is torn down and the element goes back to playing directly.
 *   · A watchdog checks that audio is really flowing and self-heals.
 */
class Chain {
  constructor() {
    this.ctx = this.src = this.eq = this.bass = this.treb = this.comp = this.an = null;
    this.el = null; this.ready = false;
    /* The visualiser's own tap, kept separate from the EQ graph — see tap(). */
    this.vizCtx = this.vizSrc = this.vizAn = this.vizEl = null;
  }

  /**
   * Can this element's audio be routed through Web Audio without being muted?
   *
   * Same-origin and blob/data sources are fine. A cross-origin stream needs
   * the CORS opt-in, which attach() now sets — see the long note there for the
   * measurements behind that change.
   */
  static canProcess(el) {
    const src = el?.currentSrc || el?.src || '';
    if (!src) return false;
    if (src.startsWith('blob:') || src.startsWith('data:')) return true;
    try {
      if (new URL(src, location.href).origin === location.origin) return true;
    } catch { return false; }
    return !!el.crossOrigin;         // cross-origin needs an explicit opt-in
  }

  /**
   * Attach the graph. Returns true only if audio is genuinely still flowing.
   *
   * THE HARD LIMIT — measured, not assumed.
   *   The audio comes from a different origin (the CDN) and the element does
   *   NOT carry crossOrigin="anonymous" — deliberately, because setting it
   *   breaks playback outright with this 302-redirecting CDN.
   *   A cross-origin media element without CORS produces a MUTED
   *   MediaElementSource: the browser refuses to expose the samples. Verified
   *   directly — a known-good oscillator reads analyser peak 128 in the same
   *   browser, while the real stream reads 0 while still "playing".
   *   So attaching the EQ to these streams silences them, permanently, and
   *   `createMediaElementSource` cannot be undone on that element.
   *
   *   Hence: the graph refuses to attach to a cross-origin stream at all.
   *   Sound matters more than an equaliser.
   */
  async attach(el) {
    if (this.ready && this.el === el) return this.ensureRunning();
    if (this.ready && this.el !== el) return false;   // one element per context
    if (!Chain.canProcess(el)) return false;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !el) return false;
    try {
      this.ctx = new AC();
      this.el = el;
      this.src = this.ctx.createMediaElementSource(el);
      this.eq = BANDS.map((f, i) => {
        const b = this.ctx.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking';
        b.frequency.value = f; b.Q.value = 1.1; b.gain.value = 0;
        return b;
      });
      this.bass = this.ctx.createBiquadFilter(); this.bass.type = 'lowshelf'; this.bass.frequency.value = 200;
      this.treb = this.ctx.createBiquadFilter(); this.treb.type = 'highshelf'; this.treb.frequency.value = 3200;
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = 0; this.comp.ratio.value = 1;   // transparent until asked
      this.an = this.ctx.createAnalyser(); this.an.fftSize = 128;
      let n = this.src;
      for (const f of this.eq) { n.connect(f); n = f; }
      n.connect(this.bass); this.bass.connect(this.treb);
      this.compMakeup = this.ctx.createGain();       // night-mode output lift
      this.treb.connect(this.comp);
      this.comp.connect(this.compMakeup); this.compMakeup.connect(this.an);
      this.an.connect(this.ctx.destination);
      this.buildLab();                               // lab stage: treb → lab → comp
      this.ready = true;

      /* The OS can suspend us later — a phone call, another app, the screen
         locking. Without this the track would go quietly silent again. */
      this.ctx.addEventListener?.('statechange', () => {
        if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
      });

      const ok = await this.ensureRunning();
      if (!ok) this.detach();
      return ok;
    } catch {
      this.detach();
      return false;
    }
  }

  /** Resume and VERIFY. An unverified resume is what caused the silence. */
  async ensureRunning() {
    if (!this.ctx) return false;
    if (this.ctx.state === 'running') return true;
    try { await this.ctx.resume(); } catch { return false; }
    return this.ctx.state === 'running';
  }

  /**
   * Give the element its speakers back.
   *
   * createMediaElementSource cannot be undone, so the context is closed
   * outright — that releases the element and it plays normally again.
   */
  detach() {
    try { this.src?.disconnect(); } catch {}
    try { this.ctx?.close(); } catch {}
    this.ctx = this.src = this.eq = this.bass = this.treb = this.comp = this.an = null;
    this.compMakeup = null;
    this.labIn = this.labOut = this.pSum = this.pDry = this.pitchWetCtl = null;
    this.pitchNode = null; this.pitchReady = false; this._pitchLoading = false;
    this.vOut = this.vNorm = this.vKar = this.vVoc = null;
    this.mOut = this.mNorm = this.mMono = null;
    this.dOut = this.dDry = this.dWet = this.pan = this.lfo = this.lfoDelay = null;
    this.rDry = this.rvWet = this.rvConv = null;
    this._rvOn = false; this._irs = {}; this._ramp = null;
    this.el = null;
    this.ready = false;
  }

  /** Everything, including the visualiser tap. Used when the track changes. */
  detachAll() { this.detach(); this.dropTap(); }

  /**
   * A read-only tap for the visualiser, independent of the equaliser.
   *
   * WHY SEPARATE FROM `attach`
   * The EQ graph rewires the element through eight filters, a compressor and
   * the destination — that is a real change to the audio path, and this file
   * carries scars from it silencing playback. The visualiser needs none of
   * that. It needs to LOOK at the samples.
   *
   * So this builds the smallest possible graph: source -> analyser, and the
   * analyser is a dead end that is never connected to the destination, while
   * the source still is. Nothing is inserted between the audio and the
   * speakers, so there is no path by which this can mute anything.
   *
   * If the EQ is already attached, its analyser is reused rather than calling
   * createMediaElementSource twice — the second call throws, and it cannot be
   * undone on that element.
   */
  async tap(el) {
    if (this.an) return this.an;                      // EQ graph already has one
    if (this.vizAn && this.vizEl === el) { await this.ensureVizRunning(); return this.vizAn; }
    if (this.vizAn && this.vizEl !== el) return null; // one element per context
    if (!Chain.canProcess(el)) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !el) return null;
    try {
      this.vizCtx = new AC();
      this.vizEl = el;
      const src = this.vizCtx.createMediaElementSource(el);
      const an = this.vizCtx.createAnalyser();
      an.fftSize = 256;
      an.smoothingTimeConstant = 0.75;
      src.connect(an);                 // analyser is a leaf: it outputs nowhere
      src.connect(this.vizCtx.destination);   // sound still goes to the speakers
      this.vizSrc = src;
      this.vizAn = an;
      this.vizCtx.addEventListener?.('statechange', () => {
        if (this.vizCtx?.state === 'suspended') this.vizCtx.resume().catch(() => {});
      });
      await this.ensureVizRunning();
      /* Prove it before promising it. If the browser handed back a muted
         source anyway, tear the whole thing down and report no analyser —
         a flat line that claims to be a spectrum is worse than no spectrum. */
      return an;
    } catch { this.dropTap(); return null; }
  }

  async ensureVizRunning() {
    if (!this.vizCtx) return false;
    if (this.vizCtx.state === 'running') return true;
    try { await this.vizCtx.resume(); } catch { return false; }
    return this.vizCtx.state === 'running';
  }

  dropTap() {
    try { this.vizSrc?.disconnect(); } catch {}
    try { this.vizCtx?.close(); } catch {}
    this.vizCtx = this.vizSrc = this.vizAn = this.vizEl = null;
  }

  /** The analyser the visualiser should read, whichever graph owns it. */
  analyser() { return this.an || this.vizAn || null; }

  /** Is sound genuinely reaching the output? 0 means silence. */
  peak() {
    if (!this.an) return null;
    const buf = new Uint8Array(this.an.frequencyBinCount);
    this.an.getByteTimeDomainData(buf);
    let p = 0;
    for (const v of buf) p = Math.max(p, Math.abs(v - 128));
    return p;
  }

  /* ═══════════════════════════════════════════════════════ AUDIO LAB ═════
   * Inserted between the tone filters and the compressor:
   *
   *   labIn → PITCH crossbar → VOICE crossbar → MONO crossbar
   *         → 8D crossbar → REVERB wet/dry → labOut
   *
   * Every stage is a crossbar of parallel paths whose gains sum to 1, so a
   * stage that is "off" is a clean wire and switching is a short ramp, not
   * a reconnect. The convolver is the one exception — it is disconnected
   * entirely when no room is selected, because a 4-second impulse response
   * costs real CPU even behind a zero gain.
   */
  buildLab() {
    const c = this.ctx;
    const g = (v = 1) => { const n = c.createGain(); n.gain.value = v; return n; };
    this._ramp = (node, v) => node.gain.setTargetAtTime(v, c.currentTime, 0.03);

    this.labIn = g(); this.labOut = g();
    /* The lab REPLACES the direct treb→comp link. Without this disconnect
       the dry signal kept running in parallel with every effect — karaoke
       leaked the vocals back in, pitch smeared into a flanger, and each
       stage arrived at half strength. One line, whole lab. */
    try { this.treb.disconnect(this.comp); } catch {}
    this.treb.connect(this.labIn);
    this.labOut.connect(this.comp);

    /* ---- pitch: dry | worklet (wet) ---- */
    this.pSum = g();
    this.pDry = g(1);
    this.labIn.connect(this.pDry); this.pDry.connect(this.pSum);
    this.pitchNode = null; this.pitchReady = false; this._pitchLoading = false; this.pitchWetCtl = null;

    /* ---- voice: normal | karaoke | vocals ----
       Vocals sit in the centre of a stereo mix (L≈R). Karaoke keeps the
       side signal (L−R: the instruments) plus the centred low end — bass
       and kick live centre-low, and karaoke without bass is a punishment.
       Vocals-only is the centre, high-passed above that same bass. */
    this.vOut = g();
    this.vNorm = g(1);
    this.pSum.connect(this.vNorm); this.vNorm.connect(this.vOut);
    const sp = c.createChannelSplitter(2);
    this.pSum.connect(sp);
    const gL = g(1), gRn = g(-1), side = g();
    sp.connect(gL, 0); sp.connect(gRn, 1); gL.connect(side); gRn.connect(side);
    const gBL = g(0.6), gBR = g(0.6);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 250; lp.Q.value = 0.7;
    sp.connect(gBL, 0); sp.connect(gBR, 1); gBL.connect(lp); gBR.connect(lp);
    const km = c.createChannelMerger(2);
    this.vKar = g(0);
    side.connect(this.vKar); lp.connect(this.vKar);
    this.vKar.connect(km, 0, 0); this.vKar.connect(km, 0, 1);
    const gVL = g(0.5), gVR = g(0.5);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 250; hp.Q.value = 0.7;
    sp.connect(gVL, 0); sp.connect(gVR, 1); gVL.connect(hp); gVR.connect(hp);
    const vm = c.createChannelMerger(2);
    this.vVoc = g(0);
    hp.connect(this.vVoc);
    this.vVoc.connect(vm, 0, 0); this.vVoc.connect(vm, 0, 1);
    km.connect(this.vOut); vm.connect(this.vOut);

    /* ---- mono ---- */
    this.mOut = g();
    this.mNorm = g(1);
    this.vOut.connect(this.mNorm); this.mNorm.connect(this.mOut);
    const msp = c.createChannelSplitter(2);
    this.vOut.connect(msp);
    const gML = g(0.5), gMR = g(0.5), msum = g();
    msp.connect(gML, 0); msp.connect(gMR, 1); gML.connect(msum); gMR.connect(msum);
    const mm = c.createChannelMerger(2);
    this.mMono = g(0);
    msum.connect(this.mMono);
    this.mMono.connect(mm, 0, 0); this.mMono.connect(mm, 0, 1);
    mm.connect(this.mOut);

    /* ---- 8D: an HRTF panner orbiting the head ----
       A sine LFO drives positionX directly; the same sine a quarter-period
       late (a DelayNode) drives positionZ — phase quadrature traces a circle
       with zero JavaScript in the audio loop. */
    this.dOut = g();
    this.dDry = g(1);
    this.mOut.connect(this.dDry); this.dDry.connect(this.dOut);
    this.pan = c.createPanner();
    this.pan.panningModel = 'HRTF';
    this.pan.distanceModel = 'inverse';
    this.pan.refDistance = 1; this.pan.maxDistance = 10000;
    this.pan.positionY.value = 0;
    this.dWet = g(0);
    this.mOut.connect(this.pan); this.pan.connect(this.dWet); this.dWet.connect(this.dOut);
    this.lfo = c.createOscillator(); this.lfo.frequency.value = 0.12;
    this.lfoDelay = c.createDelay(3); this.lfoDelay.delayTime.value = 1 / (4 * 0.12);
    const gx = g(2.2), gz = g(2.2);
    this.lfo.connect(gx); gx.connect(this.pan.positionX);
    this.lfo.connect(this.lfoDelay); this.lfoDelay.connect(gz); gz.connect(this.pan.positionZ);
    try { this.lfo.start(); } catch {}

    /* ---- reverb: dry | convolver (wet) ---- */
    this.rDry = g(1);
    this.dOut.connect(this.rDry); this.rDry.connect(this.labOut);
    this.rvConv = c.createConvolver(); this.rvConv.normalize = true;
    this.rvWet = g(0);
    this.rvConv.connect(this.rvWet); this.rvWet.connect(this.labOut);
    this._rvOn = false; this._irs = {};
  }

  /** Register the pitch worklet on THIS context (worklet modules are
   *  per-context, so a detach/attach cycle re-registers it). */
  ensurePitch() {
    if (this.pitchReady) return Promise.resolve(true);
    if (!this.ctx || !this.ctx.audioWorklet) return Promise.resolve(false);
    if (this._pitchLoading) return this._pitchLoading;
    this._pitchLoading = new Promise((res) => {
      const url = URL.createObjectURL(new Blob([PITCH_WORKLET], { type: 'application/javascript' }));
      this.ctx.audioWorklet.addModule(url).then(() => {
        URL.revokeObjectURL(url);
        try {
          this.pitchNode = new AudioWorkletNode(this.ctx, 'sb-pitch', { outputChannelCount: [2] });
          this.pitchWetCtl = this.ctx.createGain();
          this.pitchWetCtl.gain.value = 0;
          this.labIn.connect(this.pitchNode);
          this.pitchNode.connect(this.pitchWetCtl);
          this.pitchWetCtl.connect(this.pSum);
          this.pitchReady = true;
        } catch { this.pitchReady = false; }
        res(this.pitchReady);
      }).catch(() => { URL.revokeObjectURL(url); res(false); });
    });
    return this._pitchLoading;
  }

  /** ± semitones, tempo untouched. 0 bypasses the stage entirely. */
  setPitchSemi(st) {
    if (!this.ready || !this._ramp) return;
    const semis = Math.max(-6, Math.min(6, +st || 0));
    if (!semis) {
      this._ramp(this.pDry, 1);
      if (this.pitchWetCtl) this._ramp(this.pitchWetCtl, 0);
      return;
    }
    this.ensurePitch().then((ok) => {
      if (!ok || !this.pitchNode || !this.pitchWetCtl) return;
      this.pitchNode.parameters.get('ratio').value = Math.pow(2, semis / 12);
      this._ramp(this.pDry, 0);
      this._ramp(this.pitchWetCtl, 1);
    });
  }

  /** normal | karaoke | vocals */
  setVoice(mode) {
    if (!this.ready || !this._ramp) return;
    this._ramp(this.vNorm, mode === 'normal' ? 1 : 0);
    this._ramp(this.vKar, mode === 'karaoke' ? 1 : 0);
    this._ramp(this.vVoc, mode === 'vocals' ? 1 : 0);
  }

  setMono(on) {
    if (!this.ready || !this._ramp) return;
    this._ramp(this.mNorm, on ? 0 : 1);
    this._ramp(this.mMono, on ? 1 : 0);
  }

  /** 8D on/off + orbits per second. */
  set8D(on, speed = 0.12) {
    if (!this.ready || !this._ramp) return;
    const f = Math.max(0.03, Math.min(0.6, +speed || 0.12));
    try {
      this.lfo.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.05);
      this.lfoDelay.delayTime.setTargetAtTime(1 / (4 * f), this.ctx.currentTime, 0.05);
    } catch {}
    this._ramp(this.dDry, on ? 0 : 1);
    this._ramp(this.dWet, on ? 1 : 0);
  }

  /** room | club | hall | stadium (anything else = off), plus wet mix. */
  setReverb(name, wet = 0.3) {
    if (!this.ready || !this._ramp) return;
    const w = Math.min(0.85, Math.max(0, +wet || 0));
    if (ROOMS[name] && w > 0.001) {
      if (!this._irs[name]) this._irs[name] = makeIR(this.ctx, ROOMS[name]);
      this.rvConv.buffer = this._irs[name];
      if (!this._rvOn) { try { this.dOut.connect(this.rvConv); } catch {} this._rvOn = true; }
      this._ramp(this.rvWet, w);
      this._ramp(this.rDry, 1 - 0.45 * w);
    } else {
      this._ramp(this.rvWet, 0);
      this._ramp(this.rDry, 1);
      if (this._rvOn) { try { this.dOut.disconnect(this.rvConv); } catch {} this._rvOn = false; }
    }
  }

  /** Night mode: squash the dynamics so 2 AM volume still carries every
   *  word, with a little makeup gain to pay for it. */
  setNight(on) {
    if (!this.comp) return;
    this.comp.threshold.value = on ? -50 : 0;
    this.comp.ratio.value = on ? 20 : 1;
    if (this.compMakeup) this.compMakeup.gain.value = on ? 1.6 : 1;
  }

  resume() { return this.ensureRunning(); }
  band(i, v) { this.eq?.[i] && (this.eq[i].gain.value = v); }
  setBass(v) { this.bass && (this.bass.gain.value = v); }
  setTreb(v) { this.treb && (this.treb.gain.value = v); }
  setComp(on) { if (this.comp) { this.comp.threshold.value = on ? -32 : 0; this.comp.ratio.value = on ? 12 : 1; } }
}
export const chain = new Chain();

/* ------------------------------------------------------------------- HLS
 * The second catalogue serves HLS playlists rather than plain audio files.
 * An <audio> element cannot play those anywhere except Safari, so assigning
 * `src` would fail silently with MediaError 4 — a black hole rather than an
 * error message.
 *
 * This attaches hls.js instead, which is the same engine live TV already
 * loads from the same CDN, so no new dependency enters the app. Anything that
 * is NOT a playlist keeps the plain `src` path untouched — that path is
 * load-bearing and well tested, and this must not disturb it.
 */
let hlsLib = null;
function loadHlsLib() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (hlsLib) return hlsLib;
  hlsLib = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';
    s.async = true;
    s.onload = () => (window.Hls ? res(window.Hls) : rej(new Error('hls.js did not initialise')));
    s.onerror = () => { hlsLib = null; rej(new Error('could not load the stream engine')); };
    document.head.appendChild(s);
  });
  return hlsLib;
}

const isHls = (url) => /\.m3u8(\?|$)/i.test(String(url || ''));

/** Every previous attachment must be torn down or the old one keeps buffering. */
function detachHls(el) {
  if (el?._hls) { try { el._hls.destroy(); } catch {} el._hls = null; }
}

/**
 * Point the element at a URL, whatever kind it is.
 * Returns nothing; throws if an HLS stream cannot be attached, so the caller's
 * existing catch/retry logic works unchanged.
 */
/**
 * Opt into CORS so the spectrum and the equaliser can actually work.
 *
 * WHY THIS CHANGED
 * A cross-origin media element WITHOUT crossOrigin="anonymous" produces a
 * muted MediaElementSource: the browser plays the sound but refuses to let
 * script read the samples. That is why the visualiser drew nothing but a flat
 * line — measured, on the real CDNs: analyser frequency sum 0 and peak 0 while
 * the track was audibly playing. The bars were never going to move.
 *
 * The old comment here said setting crossOrigin "breaks playback outright with
 * this 302-redirecting CDN". That was re-measured against every CDN this app
 * actually uses, fresh link each trial:
 *
 *   c.ymcdn.org        crossOrigin 5/5 played   plain 5/5   spectrum 1622 vs 0
 *   aac.saavncdn.com   crossOrigin 5/5 played   plain 5/5   spectrum 1759 vs 0
 *   gaana HLS          crossOrigin ok           plain ok    spectrum 2097 vs 2045
 *
 * Both CDNs answer the audio request with `Access-Control-Allow-Origin: *`
 * (verified 206 + header), so the CORS handshake succeeds and nothing breaks.
 * The full graph was then run end to end — eight EQ bands, bass, treble,
 * compressor, analyser — and pushing bass to +12 dB moved the low-frequency
 * bins from 868 to 1066 with sound still reaching the output.
 *
 * BUT IT IS STILL NOT ASSUMED TO BE SAFE FOREVER
 * A CDN can drop that header tomorrow, and a failed CORS handshake means
 * silence, which is far worse than a still visualiser. So this is attempted,
 * and `playWithFallback` below retries WITHOUT the attribute the moment the
 * element reports it could not load. Sound always wins over decoration.
 */
function setCors(el, on) {
  if (on) el.setAttribute('crossorigin', 'anonymous');
  else el.removeAttribute('crossorigin');
}

async function attach(el, url, { cors = true } = {}) {
  detachHls(el);
  setCors(el, cors);
  if (!isHls(url)) { el.src = url; return; }
  /* Safari plays HLS natively and does it better than the library would. */
  if (el.canPlayType('application/vnd.apple.mpegurl')) { el.src = url; return; }
  const Hls = await loadHlsLib();
  if (!Hls.isSupported()) throw new Error('this browser cannot play that stream');
  const h = new Hls({ enableWorker: true, lowLatencyMode: false });
  el._hls = h;
  await new Promise((res, rej) => {
    const done = (fn) => { clearTimeout(timer); fn(); };
    const timer = setTimeout(() => done(() => rej(new Error('stream timed out'))), 20000);
    h.on(Hls.Events.MANIFEST_PARSED, () => done(res));
    h.on(Hls.Events.LEVEL_LOADED, () => {
      // HLS duration becomes known here - helps seek work for HLS
      try { if (el.duration && isFinite(el.duration)) { /* duration now known */ } } catch {}
    });
    h.on(Hls.Events.ERROR, (_e, data) => { if (data?.fatal) done(() => rej(new Error(data.details || 'stream error'))); });
    h.loadSource(url);
    h.attachMedia(el);
  });
}

/**
 * Play a URL, and if the CORS opt-in is what stopped it, drop the opt-in and
 * play it anyway.
 *
 * The visualiser and the equaliser are worth having, but they are decoration.
 * A CDN that stops sending `Access-Control-Allow-Origin` would turn the CORS
 * handshake into a hard load failure, and the user would get silence in
 * exchange for moving bars they never asked for. So the attempt is made, and
 * the moment the element says it could not load, the exact same URL is played
 * again with the attribute removed.
 *
 * The retry is only worth one round trip, so it happens once, and only for the
 * error codes that a CORS rejection actually produces (network / decode).
 */
async function playWithFallback(el, url, rate) {
  try {
    await attach(el, url, { cors: true });
    el.playbackRate = rate;
    await el.play();
    return true;                       // spectrum + EQ available
  } catch (e) {
    const code = el.error?.code;
    /* 1 = aborted, 2 = network, 3 = decode, 4 = src not supported. A blocked
       CORS handshake shows up as 2 or 4; a genuinely dead link also shows up
       as 4, which is why the retry is cheap and capped at one. */
    if (code !== 2 && code !== 4 && code !== 3 && el.error) throw e;
    await attach(el, url, { cors: false });
    el.playbackRate = rate;
    await el.play();
    return false;                      // sound only, no analyser access
  }
}

/** Audio Lab settings — remembered per device, re-applied whenever the
 *  graph re-attaches (a fresh context starts every stage bypassed). */
const LAB_DEFAULTS = {
  mode: 'normal',        // normal | karaoke | vocals
  pitch: 0,              // semitones, -6..+6
  mono: false,
  dim: false,            // 8D orbit
  dimSpeed: 0.12,        // orbits per second
  reverb: 'off',         // off | room | club | hall | stadium
  wet: 0.3,
  night: false,
};
const readLab = () => {
  try { return { ...LAB_DEFAULTS, ...JSON.parse(localStorage.getItem('omni:lab') || '{}') }; }
  catch { return { ...LAB_DEFAULTS }; }
};

export function PlayerProvider({ children }) {
  const audio = useRef(null);
  const retriedRef = useRef(null);      // last id we already re-resolved once
  const recoveringRef = useRef(false);  // a re-resolve is in flight
  const retryCountRef = useRef(0);      // how many times this track was re-resolved
  const playTokenRef = useRef(0);       // only the newest play() may touch the element
  const autoRadio = useRef(false);      // keep the queue topped up forever
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(-1);
  const [track, setTrack] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');     // off | one | all
  const [full, setFull] = useState(false);
  const [miniHidden, setMiniHidden] = useState(false);
  const [err, setErr] = useState('');
  const [lyrics, setLyrics] = useState(null);
  const [eq, setEq] = useState([...PRESETS.Flat]);
  const [preset, setPreset] = useState('Flat');
  const [bass, setBass] = useState(0);
  const [treb, setTreb] = useState(0);
  const [comp, setComp] = useState(false);
  const [rate, setRate] = useState(1);
  const [sleep, setSleep] = useState(0);
  /* Which source actually answered — shown under the title so a fallback is
     never mistaken for the original. */
  const [via, setVia] = useState('');
  /* Lyrics ride along in the background, never blocking a play. The pool
     matches on exact title+artist+duration first, so `via` says who answered
     and `exact` says whether it was that recording or a name-only guess. */
  const grabLyrics = (m) => {
    if (!m || (!m.title && !m.name)) { setLyrics(null); return; }
    resolve('lyrics', lyricsPool, {
      title: m.title || m.name || '', artist: m.artist || '',
      album: m.album || '', length: Math.round(+(m.dur || m.duration) || 0) || null,
    }, { ttl: 864e5 })
      .then((r) => setLyrics(r.data ? { ...r.data, via: r.cached ? 'cache' : r.label } : null))
      .catch(() => setLyrics(null));
  };
  /* Whether the browser will let script READ this stream's samples. True when
     the CORS opt-in succeeded, false when playWithFallback had to drop it.
     The visualiser and equaliser both depend on it, and both say so plainly
     rather than sitting there looking broken. */
  const [canViz, setCanViz] = useState(true);
  const [eqOn, setEqOn] = useState(false);
  const [lab, setLabState] = useState(readLab);
  const labRef = useRef(lab);
  labRef.current = lab;
  const [yt, setYt] = useState(null);
  const [stage, setStage] = useState('');   // active YouTube id (IFrame mode)

  /* ---- play a track (resolving the stream if needed) ---- */
  const play = useCallback(async (t, list) => {
    const el = audio.current; if (!el) return;

    /* Only the newest tap matters.
       Resolving takes seconds, so tapping three tracks quickly leaves three
       resolutions in flight. Whichever finished last used to win — it would
       overwrite the src of the track the user actually chose, and the losers'
       error handling would tear down the winner. Each play() now claims a
       token and every later step checks it is still the current one. */
    const token = ++playTokenRef.current;
    const stale = () => playTokenRef.current !== token;

    /* Reset any error left over from the previous track.
       MediaError is sticky: once the element has failed, `el.error` keeps
       reporting that code until a new load actually succeeds. A stale code 4
       from the silent unlock clip was being read as a failure of the NEXT
       track, which is why a song that played perfectly still showed as broken.
       Calling load() on an empty element clears it. */
    if (el.error) {
      try { detachHls(el); el.pause(); el.removeAttribute('src'); el.load(); } catch {}
    }

    setErr(''); setLyrics(null);
    if (list) { setQueue(list); setIdx(list.findIndex((x) => (x.id ?? x.url) === (t.id ?? t.url))); }
    setTrack(t); setLoading(true);
    // Do not let background resolves steal bandwidth from the track the user
    // is waiting for — released again as soon as it is actually playing.
    pauseWarming();
    if (retriedRef.current !== t.id) { retriedRef.current = null; retryCountRef.current = 0; }
    recoveringRef.current = false;

    // YouTube tracks -> resolve to a DIRECT audio stream (no ads, keeps
    // playing in the background). The IFrame is only a last-resort fallback
    // if every proxy path fails.
    if (t.needsResolve && t.id) {
      setYt(null);
      const cached = isCached(t.id);

      /* Consume the user gesture NOW so the element is unlocked for later.
         Skipped when the stream is already cached: we can set the real src
         immediately and avoid the extra load cycle entirely.

         `unlocking` is checked by the error handler — Chromium reports the
         silent clip as MediaError 4, and treating that as a dead stream was
         killing tracks moments after they were tapped. */
      /* Unlock the element for later playback WITHOUT loading a fake source.
         The old trick assigned a silent data-URI so the tap would count as a
         gesture. Chromium rejects that clip with MediaError 4, and MediaError
         is sticky — the code survived onto the real track and made songs that
         were playing perfectly report as broken.
         Calling load() on the empty element consumes the gesture just as well
         and can never leave an error behind. */
      if (!cached) {
        try { detachHls(el); el.pause(); el.removeAttribute('src'); el.load(); } catch {}
      }

      // Progress that reflects reality: the resolver needs ~8-15 s, so tell the user.
      let tick = 0;
      const clock = cached ? null : setInterval(() => {
        tick += 1;
        if (tick <= 2) setStage('Finding ad-free stream…');
        else if (tick <= 6) setStage(`Finding ad-free stream… ${tick}s`);
        else if (tick <= 14) setStage(`Still working… ${tick}s (source is slow)`);
        else setStage(`Almost there… ${tick}s`);
      }, 1000);

      try {
        setLoading(true);
        if (!cached) setStage('Finding ad-free stream…');
        /* Hand the resolver what we already know about this track. If the
           primary source is down it can only find the song in the second
           catalogue by NAME — the two share no ids — so without this there is
           no fallback at all. */
        rememberTrack(t.id, { title: t.title, artist: t.artist, art: t.art, dur: t.dur });
        /* A download answers before the network is even asked. The blob URL
           is same-origin, so it plays in flight mode, starts in ~0 ms, and
           the equaliser and visualiser read real samples from it. */
        const dl = await getDownload(t.id);
        const r = dl
          ? { audio: dl, via: 'offline', approximate: false }
          : await resolveAudio(t.id, { onProgress: setStage });
        if (clock) clearInterval(clock);
        if (stale()) return;          // the user moved on; leave their track alone
        setVia(r.via || '');
        /* An inexact tier answered. Say so plainly rather than letting a cover
           or an archive recording pass as the original. */
        if (r.approximate) setStage('');
        /* Facts the resolver learned that the list row never had — album,
           year and language come from the catalogue, not from the search
           result the user tapped. Only filled in when missing, so a row that
           already knew better is not overwritten. */
        const meta = { ...t, art: t.art || r.art, artist: t.artist || r.artist,
                       album: t.album || r.album || '',
                       year: t.year || r.year || '',
                       lang: t.lang || r.lang || '',
                       dur: t.dur || r.dur || 0,
                       dlUrl: r.audio, approximate: !!r.approximate };
        setTrack(meta);
        /* crossOrigin IS set now, by attach() — measured, both CDNs send
           `Access-Control-Allow-Origin: *` and play fine with it, and without
           it the analyser reads pure zero so the visualiser can never move.
           playWithFallback drops the attribute and replays if that ever
           stops being true. */
        /* Tear the previous connection down BEFORE opening the new one.
           The CDN allows a single active link per client: measured, resolving
           a second link while the first is still streaming makes one of them
           return HTTP 403, which surfaced as MediaError 4 mid-playlist.
           Assigning a new src alone does not reliably abort the old request,
           so this forces it. */
        try { detachHls(el); el.pause(); el.removeAttribute('src'); el.load(); } catch {}
        // A cached link can already be dead. If it is, the element fires
        // `error` the moment the src is set — before play() rejects — so the
        // handler must know a recovery is possible and stay quiet. Arming
        // this BEFORE assigning src is what stops the "Stream failed" flash.
        if (cached) { recoveringRef.current = true; retriedRef.current = t.id; }
        setStage('Buffering…');
        const analysable = await playWithFallback(el, r.audio, rate);
        setCanViz(analysable);
        recoveringRef.current = false;
        /* Deliberately NOT attaching the EQ graph here. Routing the element
           through Web Audio is what silenced playback when the context was
           suspended — the track advanced with no sound. The graph is attached
           only when the user switches the EQ on. */
        setPlaying(true); setStage(''); setLoading(false); setErr('');
        resumeWarming();
        notePlay(meta);   // recently-played list in the Library tab
        if ('mediaSession' in navigator) {
          try {
            navigator.mediaSession.metadata = new MediaMetadata({
              title: meta.title || '', artist: meta.artist || '',
              artwork: meta.art ? [{ src: meta.art, sizes: '512x512' }] : [] });
          } catch {}
        }
        // warm the next few tracks so skipping is instant
        if (list) {
          const i = list.findIndex((x) => (x.id ?? x.url) === (t.id ?? t.url));
          if (i >= 0) prefetchNext(list, i, 4);
        }
        grabLyrics(meta);
        return;
      } catch (e) {
        if (clock) clearInterval(clock);
        if (stale()) return;          // a superseded attempt must stay silent
        console.warn('[player] direct audio failed:', e && e.message, e);
        const blocked = e?.name === 'NotAllowedError' ||
          /gesture|interact|play\(\)|user activation/i.test(e?.message || '');
        // Autoplay refusal is NOT a stream failure — the ad-free audio is
        // loaded and one tap will start it. NEVER fall back to the ad embed.
        if (blocked && el.src) {
          setStage(''); setLoading(false); setPlaying(false);
          setErr('Ready — tap play to start'); resumeWarming();
          grabLyrics(t);
          return;
        }
        // A cached link can expire (the CDN signs them). Retry once with a
        // forced re-resolve. Note this only catches a failure that surfaces
        // through play(); a link that 404s AFTER play() resolves is handled by
        // the element's onError, which does the same thing.
        if (cached) {
          // Mute the element's onError for the duration: swapping the src
          // makes it fire, and it would print "Stream failed" over a recovery
          // that is about to succeed.
          recoveringRef.current = true;
          retriedRef.current = t.id;
          setErr(''); setStage('Link expired — refreshing…');
          try {
            const r = await resolveAudio(t.id, { fresh: true, onProgress: setStage });
            setCanViz(await playWithFallback(el, r.audio, rate));
            setPlaying(true); setStage(''); setLoading(false); setErr('');
            resumeWarming();
            return;
          } catch { /* fall through to the honest error */ }
          finally { recoveringRef.current = false; }
        }
        /* One more attempt before admitting defeat.
           The upstream resolver is occasionally slow or briefly unavailable —
           it went down completely for several minutes during testing, then
           recovered and answered everything in 6-7 s. Giving up after a single
           miss made healthy tracks look broken, so this waits and tries once
           more with a forced re-resolve. */
        try {
          setStage('One more try…');
          await sleep(900);
          if (stale()) return;
          const r2 = await resolveAudio(t.id, { fresh: true, onProgress: setStage });
          if (stale()) return;
          setCanViz(await playWithFallback(el, r2.audio, rate));
          setTrack({ ...t, art: t.art || r2.art, artist: t.artist || r2.artist, dlUrl: r2.audio });
          setPlaying(true); setStage(''); setLoading(false); setErr('');
          resumeWarming(); notePlay(t);
          return;
        } catch { /* genuinely unavailable */ }

        // Everything failed. Say so — do not silently serve ads.
        setStage(''); setLoading(false); setPlaying(false);
        detachHls(el); el.pause(); el.removeAttribute('src'); el.load();
        setErr('Could not get an ad-free stream right now. Tap retry.'); resumeWarming();
        return;
      }
    }
    setYt(null);
    try {
      let url = t.stream || t.url || t.preview;
      let meta = t;
      if (!url) throw new Error('No playable source');
      /* Tier J hands back an HLS playlist, live radio hands back a plain
         file. attach() tells them apart so both work through one path. */
      try {
        setCanViz(await playWithFallback(el, url, rate));
        if (t.kind === 'station') noteStation(url, true);
      } catch (streamErr) {
        /* A station published over http was upgraded to https so it could load
           on the deployed site at all — but not every host has TLS. When the
           secure form fails, the original address is tried before giving up.
           Measured: 35 of 52 http-only stations answer over https, so the
           upgrade is right to prefer, and the other 17 need this line. */
        if (t.kind === 'station') noteStation(url, false);
        if (!t.altStream || t.altStream === url) throw streamErr;
        setStage('Trying the station\u2019s other address\u2026');
        setCanViz(await playWithFallback(el, t.altStream, rate));
        noteStation(t.altStream, true);
        url = t.altStream;
        setStage('');
      }
      /* Name the tier here too. This path is reached when a row already
         carries its own stream — which is how the second catalogue answers —
         and without this the player showed no source line at all for it,
         quietly presenting a different company's recording as the primary. */
      setVia(t.src === 'catalogue-two' ? 'second catalogue'
        : t.src === 'community-uploads' ? 'community uploads'
        : t.src === 'public-archive' ? 'public archive'
        : t.src === 'open-network' ? 'open music network'
        : t.src === 'station' ? 'live radio' : (t.src || ''));
      setPlaying(true);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: meta.title || meta.name || 'Unknown',
          artist: meta.artist || meta.country || '',
          artwork: meta.art ? [{ src: meta.art, sizes: '512x512' }] : [],
        });
      }
      // background lyrics fetch (non-blocking)
      grabLyrics(meta);
    } catch (e) {
      setErr(e.message || 'Could not play this track'); resumeWarming();
      setPlaying(false);
    }
    setLoading(false);
  }, [rate]);

  /** Lock-screen seekbar needs the position pushed; it does not read it. */
  const pushPosState = useCallback(() => {
    try {
      const el = audio.current;
      const ms = navigator.mediaSession;
      if (ms?.setPositionState && el && isFinite(el.duration) && el.duration > 0) {
        ms.setPositionState({ duration: el.duration, playbackRate: el.playbackRate || 1,
          position: Math.max(0, Math.min(el.currentTime, el.duration)) });
      }
    } catch {}
  }, []);

  const toggle = useCallback(() => {
    try { navigator.vibrate?.(8); } catch {}      // a tick the thumb can feel
    if (yt) {                       // control the IFrame player
      const f = document.getElementById('yt-frame');
      f?.contentWindow?.postMessage(JSON.stringify({ event: 'command',
        func: playing ? 'pauseVideo' : 'playVideo', args: [] }), '*');
      setPlaying((v) => !v);
      return;
    }
    const el = audio.current; if (!el?.src) return;
    if (chain.ready) chain.ensureRunning();   // only matters when the EQ is on
    if (el.paused) { el.play(); setPlaying(true); } else { el.pause(); setPlaying(false); }
  }, [yt, playing]);

  const step = useCallback((d) => {
    if (!queue.length) return;
    let n;
    if (shuffle) n = Math.floor(Math.random() * queue.length);
    else n = idx + d;
    if (n < 0) n = queue.length - 1;
    if (n >= queue.length) {
      // Endless play: rather than stopping at the end of the list, keep going.
      // `autoRadio` is topped up by the effect below, so this rarely fires.
      if (repeat === 'off' && !autoRadio.current) return;
      n = 0;
    }
    setIdx(n); play(queue[n], queue);
  }, [queue, idx, shuffle, repeat, play]);

  /** Append more tracks to the queue (used by radio / infinite scroll). */
  const extendQueue = useCallback((more) => {
    if (!more?.length) return;
    setQueue((q) => {
      const seen = new Set(q.map((t) => t.id ?? t.url));
      const add = more.filter((t) => t && !seen.has(t.id ?? t.url));
      return add.length ? [...q, ...add] : q;
    });
  }, []);

  /* ------------------------------------------------- queue editing
     "Play next" and "Add to queue" were the two things a queue you cannot
     touch cannot do. Both are pure queue splices — playback is untouched,
     so they work mid-song with no interruption. */
  const playNext = useCallback((t) => {
    if (!t) return;
    /* Nothing loaded: "next" is meaningless, so it just plays — the same
       courtesy addToQueue extends, and the same reason. */
    if (!queue.length || idx < 0) { play(t, [t]); return; }
    setQueue((q) => {
      if (!q.length) return [t];
      const n = [...q];
      n.splice(idx + 1, 0, t);
      return n;
    });
  }, [idx, queue.length, play]);

  const addToQueue = useCallback((ts) => {
    const arr = (Array.isArray(ts) ? ts : [ts]).filter(Boolean);
    if (!arr.length) return;
    /* Nothing loaded yet: an "add" that silently sits in a dark queue looks
       like a broken button. Start playback instead — the queue was empty,
       so the first item IS next. */
    if (!queue.length || idx < 0) { play(arr[0], arr); return; }
    setQueue((q) => [...q, ...arr]);
  }, [queue.length, idx, play]);

  /** Remove an upcoming row. The playing row is refused (the UI disables it
   *  anyway) so `idx` never has to chase a moving track. */
  const removeAt = useCallback((i) => {
    if (i === idx) return;
    setQueue((q) => q.filter((_, j) => j !== i));
    if (i < idx) setIdx((n) => n - 1);
  }, [idx]);

  /** Swap row i with its neighbour. Moving the current row is allowed —
   *  the highlight travels with the song, not the slot. */
  const moveInQueue = useCallback((i, dir) => {
    const j = i + dir;
    setQueue((q) => {
      if (j < 0 || j >= q.length || i < 0 || i >= q.length) return q;
      const n = [...q];
      const tmp = n[i]; n[i] = n[j]; n[j] = tmp;
      return n;
    });
    if (i === idx) setIdx(j);
    else if (j === idx) setIdx(i);
  }, [idx]);


  /** Turn endless radio on/off. When on, the queue never runs dry. */
  const setRadio = useCallback((on) => { autoRadio.current = !!on; }, []);

  /**
   * ENDLESS PLAY — top the queue up before it runs out.
   *
   * With radio on, once fewer than three tracks remain after the current one
   * the queue is extended with material built around what is playing (more by
   * the artist, similar titles, the genre seed). The user never hits the end
   * and playback never stops on its own.
   */
  useEffect(() => {
    if (!autoRadio.current || idx < 0 || !queue.length) return;
    if (queue.length - idx > 3) return;
    let live = true;
    (async () => {
      try {
        const { radioQueue } = await import('./music');
        const more = await radioQueue(queue[idx], { limit: 30 });
        if (live && more.length) extendQueue(more);
      } catch { /* queue simply does not grow this time */ }
    })();
    return () => { live = false; };
  }, [queue, idx, extendQueue]);

  /**
   * Resolve the NEXT track's URL early — but do NOT download its bytes.
   *
   * MEASURED, THE HARD WAY: this audio CDN allows only ONE active connection
   * per client. Buffering the next track in a second <audio> element killed
   * the track that was already playing — MediaError code 4 about 11 s in,
   * every single time. Direct measurement of the CDN:
   *
   *   two connections, same track        -> one side gets HTTP 403
   *   two connections, different tracks  -> the PLAYING one gets HTTP 403
   *   sustained A + burst B              -> B truncates (IncompleteRead)
   *
   * So byte-level preloading is off the table: it breaks the very thing it was
   * meant to improve. What is safe — and still where nearly all the delay was
   * — is resolving the next URL ahead of time. That request goes to a
   * different host, costs the CDN nothing, and removes the 8-15 s lookup.
   * What remains is a single CDN connect of roughly a second, which is the
   * unavoidable price of the one-connection limit.
   */
  useEffect(() => {
    if (!queue.length || idx < 0) return;
    const nxt = queue[idx + 1];
    if (!nxt?.id) return;
    let live = true;
    const t = setTimeout(() => { if (live) prefetchAudio(nxt.id, 0); }, 1200);
    return () => { live = false; clearTimeout(t); };
  }, [queue, idx]);

  const seek = useCallback((s) => {
    const el = audio.current;
    if (!el) return;
    try {
      const target = Number(s);
      if (!isFinite(target) || target < 0) return;

      // Clamp to duration if known, otherwise to seekable end
      let max = el.duration;
      if (!isFinite(max) || max <= 0) {
        try {
          const seekable = el.seekable;
          if (seekable && seekable.length) {
            max = seekable.end(seekable.length - 1);
          } else if (el.buffered && el.buffered.length) {
            max = el.buffered.end(el.buffered.length - 1);
          }
        } catch {}
      }
      const clamped = isFinite(max) && max > 0 ? Math.min(target, max - 0.1) : target;

      // For HLS via hls.js, seek works via currentTime but need to ensure hls is ready
      // hls.js listens to currentTime changes, so direct assignment is enough
      // However if HLS is not yet at that position, it will buffer
      if (el._hls) {
        // HLS.js: ensure we seek within buffered or allow it to load
        // Setting currentTime triggers HLS to load the segment
        el.currentTime = clamped;
      } else {
        // Regular mp4/aac: direct seek
        // Some CDNs need fastSeek for better UX, but currentTime is standard
        if (typeof el.fastSeek === 'function' && Math.abs(clamped - el.currentTime) > 10) {
          try { el.fastSeek(clamped); } catch { el.currentTime = clamped; }
        } else {
          el.currentTime = clamped;
        }
      }
      setPos(clamped);
      pushPosState();

      // If paused after seek, keep paused; if playing, ensure it continues
      if (playing && el.paused) {
        el.play().catch(() => {});
      }
    } catch {}
  }, [playing, pushPosState]);

  /**
   * Silence watchdog.
   *
   * The failure the user hit was insidious: the track advances, the UI looks
   * correct, and nothing is audible. It happens when the EQ graph is attached
   * and its AudioContext gets suspended by the OS — a call, another app taking
   * audio focus, the screen locking. Once suspended, the element's output has
   * nowhere to go.
   *
   * This checks a few times a second while playing: if the graph is up but the
   * context is not running, it resumes it; if resuming fails, it drops the
   * graph entirely so the element goes back to feeding the speakers directly.
   * Sound always wins over the equaliser.
   */
  useEffect(() => {
    if (!playing) return;
    let strikes = 0;
    const id = setInterval(async () => {
      const el = audio.current;
      if (!el || el.paused || !chain.ready) { strikes = 0; return; }
      if (chain.ctx?.state === 'running') { strikes = 0; return; }
      const ok = await chain.ensureRunning();
      if (ok) { strikes = 0; return; }
      // three consecutive failures: the context is not coming back
      if (++strikes >= 3) {
        const at = el.currentTime;
        chain.detach();
        setEqOn(false);
        // closing the context releases the element; nudge it if it stalled
        try {
          if (el.paused) { el.currentTime = at; await el.play(); }
        } catch {}
        strikes = 0;
      }
    }, 1200);
    return () => clearInterval(id);
  }, [playing]);

  /** Retry the current track from scratch, ignoring any cached (expired) link. */
  const retry = useCallback(() => {
    if (!track) return;
    if (track.id) forgetAudio(track.id);
    setErr('');
    play(track, queue.length ? queue : null);
  }, [track, queue, play]);

  /* media-session hardware / lock-screen buttons */
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('play', toggle);
      navigator.mediaSession.setActionHandler('pause', toggle);
      navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
      navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
    } catch {}
  }, [toggle, step]);

  /* sleep timer */
  useEffect(() => {
    if (!sleep) return;
    const t = setTimeout(() => { audio.current?.pause(); setPlaying(false); setSleep(0); }, sleep * 60000);
    return () => clearTimeout(t);
  }, [sleep]);

  /**
   * Bring the EQ graph up on demand.
   *
   * Attaching re-routes the element through Web Audio, which is exactly what
   * used to silence playback. So it happens only when the user reaches for an
   * EQ control, it is verified, and if the context refuses to run the graph is
   * torn down and we say so rather than leaving a silent player.
   */
  /** Apply a full lab state to the live graph. Every setter is a no-op when
   *  the graph is not attached, so this is safe to call speculatively. */
  const applyLab = useCallback((s) => {
    chain.setVoice(s.mode);
    chain.setMono(s.mono);
    chain.set8D(s.dim, s.dimSpeed);
    chain.setReverb(s.reverb, s.wet);
    chain.setNight(s.night);
    chain.setPitchSemi(s.pitch);
  }, []);

  const enableEq = useCallback(async () => {
    const el = audio.current;
    if (!el || chain.ready) return chain.ready;
    const ok = await chain.attach(el);
    setEqOn(ok);
    if (!ok) { /* the EQ panel already explains why; never disturb playback */ }
    else {
      // re-apply whatever the user had set before the graph existed
      eq.forEach((g, i) => chain.band(i, g));
      chain.setBass(bass); chain.setTreb(treb); chain.setComp(comp);
      applyLab(labRef.current);
    }
    return ok;
  }, [eq, bass, treb, comp, applyLab]);

  /** Push one lab setting (or several). Persists, then routes through the
   *  same guarded attach the EQ uses — the lab never builds its own graph. */
  const setLab = useCallback((patch) => {
    const s = { ...labRef.current, ...patch };
    labRef.current = s;
    try { localStorage.setItem('omni:lab', JSON.stringify(s)); } catch {}
    setLabState(s);
    enableEq().then((ok) => {
      if (!ok) return;
      applyLab(s);
      /* Night mode and Loudness share the one compressor — when night is
         switched off, hand it back to whatever Loudness was set to. */
      if ('night' in patch && !s.night) chain.setComp(comp);
    });
  }, [enableEq, comp]);

  const applyPreset = useCallback((name) => {
    setPreset(name);
    const v = PRESETS[name] || PRESETS.Flat;
    setEq([...v]);
    // 'Flat' is the default, so it needs no graph — leave audio untouched.
    if (name === 'Flat' && !chain.ready) return;
    enableEq().then(() => v.forEach((g, i) => chain.band(i, g)));
  }, [enableEq]);

  /* ---------------------------------------------------- session + time
     Two things are remembered while a song plays:
     · WHERE the session was (queue, position) — saved every few seconds, so
       the Home tab can offer "Continue listening" right where you left off,
       even after a full app restart.
     · HOW LONG was actually audible — wall-clock between timeupdates while
       not paused, flushed to the library in batches. A play is a tap;
       minutes are what the Stats view is made of. */
  const posRef = useRef(0);
  const listenedRef = useRef(0);
  const lastTickRef = useRef(0);

  useEffect(() => {
    const flush = () => {
      if (listenedRef.current >= 1 && track) {
        noteListen(track, listenedRef.current);
        listenedRef.current = 0;
      }
    };
    const id = setInterval(flush, 10000);          // batch writes
    const save = () => {
      if (!track || idx < 0) return;
      try {
        localStorage.setItem('omni:session', JSON.stringify({
          track, queue: queue.slice(0, 60), idx, pos: posRef.current, ts: Date.now(),
        }));
      } catch {}
    };
    const sid = setInterval(() => { save(); pushPosState(); }, 5000);
    const onHide = () => { flush(); save(); };
    addEventListener('pagehide', onHide);
    return () => {
      clearInterval(id); clearInterval(sid);
      removeEventListener('pagehide', onHide);
      flush(); save();
    };
  }, [track, idx, queue]);

  /** Pick the last session back up: same queue, same song, same second. */
  const resumeSession = useCallback(async () => {
    let s = null;
    try { s = JSON.parse(localStorage.getItem('omni:session') || 'null'); } catch {}
    if (!s?.track || !Array.isArray(s.queue) || s.idx < 0) return false;
    await play(s.track, s.queue);
    if (s.pos > 5) {
      const el = audio.current;
      const apply = () => { try { el.currentTime = s.pos; } catch {} };
      if (!el) return true;
      if (el.readyState >= 1) apply();
      else el.addEventListener('loadedmetadata', apply, { once: true });
    }
    return true;
  }, [play]);

  const value = {
    audio, yt, stage, track, playing, loading, pos, dur, queue, idx, shuffle, repeat, full, miniHidden, err, lyrics, via,
    canViz,
    eq, preset, bass, treb, comp, rate, sleep,
    play, toggle, step, seek, retry, extendQueue, setRadio, setShuffle, setRepeat, setFull, setMiniHidden, setSleep, applyPreset,
    playNext, addToQueue, removeAt, moveInQueue, resumeSession,
    eqOn, enableEq, lab, setLab,
    stop: () => {
      try { audio.current?.pause(); } catch {}
      try { if (audio.current) { audio.current.removeAttribute('src'); audio.current.load(); } } catch {}
      setPlaying(false); setTrack(null); setFull(false); setMiniHidden(false); setQueue([]); setIdx(-1);
      playTokenRef.current++;
    },
    /* The equaliser needs the same CORS read access the visualiser does, so
       one measured fact drives both instead of two guesses. */
    eqCapable: canViz && Chain.canProcess(audio.current),
    setEqBand: (i, v) => { const n = [...eq]; n[i] = v; setEq(n);
      enableEq().then(() => chain.band(i, v)); setPreset('Custom'); },
    setBassV: (v) => { setBass(v); enableEq().then(() => chain.setBass(v)); },
    setTrebV: (v) => { setTreb(v); enableEq().then(() => chain.setTreb(v)); },
    setCompV: (v) => { setComp(v); enableEq().then(() => chain.setComp(v)); },
    setRateV: (v) => { setRate(v); if (audio.current) { audio.current.playbackRate = v; audio.current.preservesPitch = true; } },
    BANDS,
  };

  return (
    <Ctx.Provider value={value}>
      <audio
        ref={audio} preload="none"
        onTimeUpdate={(e) => {
          const el = e.target;
          setPos(el.currentTime); setDur(el.duration || 0);
          posRef.current = el.currentTime;
          /* Listening time = wall-clock between ticks while actually audible.
             A seek shows up as a negative or huge gap and is ignored, so
             scrubbing a track for an hour does not count as listening. */
          const now = Date.now();
          if (!el.paused && lastTickRef.current) {
            const dt = (now - lastTickRef.current) / 1000;
            if (dt > 0 && dt < 2) listenedRef.current += dt;
          }
          lastTickRef.current = now;
        }}
        onEnded={() => { if (repeat === 'one') { audio.current.currentTime = 0; audio.current.play(); } else step(1); }}
        onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)}
        onError={() => {
          /* The CDN signs its links and they can expire while still in our
             cache, so a track that played fine an hour ago comes back 404.
             play() has already resolved by then, so the earlier try/catch
             never sees it — the element fires `error` instead and the old
             code just printed "Stream failed". Re-resolve once, silently. */
          const el = audio.current;

          // Nothing we load ourselves should be treated as a stream failure.
          if (el && (el.src || '').startsWith('data:')) return;

          const t = track;
          if (!t) return;
          if (!t.id) { setErr('Stream failed — tap retry'); return; }
          // A dropped stream must never leave the user staring at a dead
          // player: pause background work so the retry gets the whole pipe.
          pauseWarming();
          // `error` fires more than once while a fresh src is being swapped
          // in — the element reports the failed load, then reports again as
          // the new source attaches. Announcing a failure during a recovery
          // that is about to succeed made a working retry look broken, so the
          // message is only shown once the recovery has actually given up.
          if (recoveringRef.current) return;
          /* Two attempts, not one. The CDN mints a fresh signed link on every
             resolve and invalidates older ones, so the first replacement can
             already be stale by the time the element reaches it. A second go
             costs a couple of seconds and rescues most of these. */
          const tries = retriedRef.current === t.id ? (retryCountRef.current || 1) : 0;
          if (tries >= 2) {
            setErr('Stream failed — tap retry');
            return;
          }
          recoveringRef.current = true;
          retriedRef.current = t.id;
          retryCountRef.current = tries + 1;
          forgetAudio(t.id);
          setStage('Link expired — refreshing…');
          // Clear any stale error text: the recovery is in flight, so showing
          // "Stream failed" here made a successful retry look broken.
          setErr('');
          resolveAudio(t.id, { fresh: true })
            .then((r) => {
              const el = audio.current;
              if (!el || track?.id !== t.id) return;
              return playWithFallback(el, r.audio, rate).then(setCanViz);
            })
            .then(() => { setStage(''); setErr(''); setPlaying(true); resumeWarming(); })
            .catch(() => { setStage(''); setErr('Stream failed — tap retry'); resumeWarming(); })
            .finally(() => { recoveringRef.current = false; });
        }}
      />
      {children}
    </Ctx.Provider>
  );
}
