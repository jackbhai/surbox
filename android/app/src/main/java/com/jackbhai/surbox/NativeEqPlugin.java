package com.jackbhai.surbox;

import android.media.audiofx.BassBoost;
import android.media.audiofx.Equalizer;
import android.media.audiofx.Virtualizer;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The REAL equaliser — Android's own audio effects, attached to the global
 * output mix (audio session 0).
 *
 * WHY NATIVE
 * The in-app equaliser built on Web Audio cracks and stutters in the
 * WebView: routing the element through a MediaElementSource hands playback
 * to the WebView's weakest audio path, and no amount of graph tuning
 * changes that (measured across four app versions — the same code plays
 * perfectly in the browser). The Android framework's effects run in the
 * audio server, below and outside the WebView entirely: the DSP costs the
 * page nothing, the element keeps its own (local-blob) output, and every
 * sound the app makes passes through the bands.
 *
 * Session 0 is the output mix itself — the same hook the system EQ apps
 * use. Effects live only while this process lives; nothing persists
 * after the app is killed. MODIFY_AUDIO_SETTINGS is declared once in the
 * manifest.
 */
@CapacitorPlugin(name = "NativeEq")
public class NativeEqPlugin extends Plugin {

    private Equalizer eq;
    private BassBoost bass;
    private Virtualizer virt;
    private boolean eqOn = false;
    private short bassStrength = 0;
    private short virtStrength = 0;

    private void ensure() throws Exception {
        if (eq != null) return;
        eq = new Equalizer(0, 0);
        bass = new BassBoost(0, 0);
        virt = new Virtualizer(0, 0);
    }

    /** Bands (centre frequencies + current levels), the level range in
     *  millibels, and the device's own preset names. */
    @PluginMethod
    public void describe(PluginCall call) {
        try {
            ensure();
            JSObject r = new JSObject();
            short[] range = eq.getBandLevelRange();
            r.put("min", (int) range[0]);
            r.put("max", (int) range[1]);
            JSArray bands = new JSArray();
            for (short i = 0; i < eq.getNumberOfBands(); i++) {
                JSObject b = new JSObject();
                b.put("freq", (int) (eq.getCenterFreq(i) / 1000));   // milli-Hz -> Hz
                b.put("level", (int) eq.getBandLevel(i));
                bands.put(b);
            }
            r.put("bands", bands);
            JSArray presets = new JSArray();
            for (short i = 0; i < eq.getNumberOfPresets(); i++) {
                JSObject p = new JSObject();
                p.put("index", (int) i);
                p.put("name", eq.getPresetName(i));
                presets.put(p);
            }
            r.put("presets", presets);
            r.put("enabled", eq.getEnabled());
            call.resolve(r);
        } catch (Exception e) {
            call.reject("equaliser unavailable on this device: " + e.getMessage());
        }
    }

    /** Master switch — everything off means the audio passes through
     *  untouched, bit for bit. */
    @PluginMethod
    public void setEnabled(PluginCall call) {
        Boolean on = call.getBoolean("on", Boolean.TRUE);
        try {
            ensure();
            eq.setEnabled(on);
            eqOn = on;
            bass.setEnabled(on && bassStrength > 0);
            virt.setEnabled(on && virtStrength > 0);
            call.resolve(new JSObject());
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void setBand(PluginCall call) {
        Integer band = call.getInt("band");
        Integer level = call.getInt("level");
        if (band == null || level == null) { call.reject("band and level are required"); return; }
        try {
            ensure();
            if (!eqOn) { eq.setEnabled(true); eqOn = true; }
            eq.setBandLevel(band.shortValue(), level.shortValue());
            call.resolve(new JSObject());
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /** 0 (off) .. 1000. */
    @PluginMethod
    public void setBass(PluginCall call) {
        Integer strength = call.getInt("strength");
        if (strength == null) { call.reject("strength is required"); return; }
        try {
            ensure();
            bassStrength = strength.shortValue();
            if (bassStrength > 0) {
                bass.setStrength(bassStrength);
                bass.setEnabled(eqOn);
            } else {
                bass.setEnabled(false);
            }
            call.resolve(new JSObject());
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /** 0 (off) .. 1000 — the wideness/spatial effect. */
    @PluginMethod
    public void setVirtualizer(PluginCall call) {
        Integer strength = call.getInt("strength");
        if (strength == null) { call.reject("strength is required"); return; }
        try {
            ensure();
            virtStrength = strength.shortValue();
            if (virtStrength > 0) {
                virt.setStrength(virtStrength);
                virt.setEnabled(eqOn);
            } else {
                virt.setEnabled(false);
            }
            call.resolve(new JSObject());
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void usePreset(PluginCall call) {
        Integer index = call.getInt("index");
        if (index == null) { call.reject("index is required"); return; }
        try {
            ensure();
            if (!eqOn) { eq.setEnabled(true); eqOn = true; }
            eq.usePreset(index.shortValue());
            call.resolve(new JSObject());
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
}
