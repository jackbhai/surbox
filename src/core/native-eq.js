/**
 * The system equaliser, reached through the NativeEq Capacitor plugin
 * (android/app/src/main/java/com/jackbhai/surbox/NativeEqPlugin.java).
 *
 * In the app this is THE equaliser: Android's own audio DSP, attached to
 * the global output mix, costing the page nothing and leaving the
 * element's (local-blob) playback path untouched — the WebAudio graph
 * that cracks in the WebView is never involved. In a browser there is no
 * such plugin, `nativeEqAvailable()` is false, and the WebAudio equaliser
 * takes over (where it plays perfectly).
 */
import { registerPlugin } from '@capacitor/core';
import { isNativeApp } from './buffered-play';

let impl = null;
try { impl = registerPlugin('NativeEq'); } catch {}

export const nativeEqAvailable = () => isNativeApp() && !!impl;

let described = null;
/** Bands, level range (millibels) and the device's preset names. */
export async function nativeEqDescribe() {
  if (!impl) throw new Error('no native equaliser here');
  if (!described) described = await impl.describe();
  return described;
}
export const nativeEqSetEnabled = (on) => impl?.setEnabled?.({ on: !!on });
export const nativeEqSetBand = (band, level) => impl?.setBand?.({ band, level });
export const nativeEqSetBass = (strength) => impl?.setBass?.({ strength: Math.round(strength) });
export const nativeEqSetVirt = (strength) => impl?.setVirtualizer?.({ strength: Math.round(strength) });
export const nativeEqUsePreset = (index) => impl?.usePreset?.({ index });
