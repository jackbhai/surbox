# Building the SurBox APK

The whole app ships inside an Android WebView via [Capacitor](https://capacitorjs.com) —
one codebase, website and APK in lockstep.

## Prerequisites

- Node 18/20 (Capacitor 7 — **not** Node 22+ only-v8 tooling)
- JDK 17 or 21
- Android SDK: `platform-tools`, `platforms;android-35`, `build-tools;34.0.0`
- ~2 GB RAM for Gradle (a swap file helps on small machines)

## Everyday build

```bash
npm install
npm run build          # web bundle → dist/
npx cap sync android   # copies dist/ + registers plugins into android/
cd android
./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

First run only: `local.properties` must contain `sdk.dir=/path/to/android-sdk`.

## Release signing

`android/keystore.properties` (gitignored, **never commit it**) points at the
release key:

```properties
storeFile=../../surbox-keys/surbox-release.keystore
storePassword=…
keyAlias=surbox
keyPassword=…
```

Without it the release build falls back to debug signing, so the project
always builds. Keep the keystore safe: Android only installs an update over
an installed APK if it is signed with the **same key** — lose it and every
future release forces an uninstall first.

## Icons & splash

Source art lives in `assets-src/icon.png`. The layers in `assets/` are
generated from it (foreground scaled into the adaptive-icon safe zone,
2732×2732 splash). Regenerate all densities after changing the art:

```bash
npx @capacitor/assets generate --android
```

## Update checklist (new app version)

1. Ship the web version, verify the site works
2. Bump `versionCode` + `versionName` in `android/app/build.gradle`
3. `npm run build && npx cap sync android && cd android && ./gradlew assembleRelease`

## Honest limitations (WebView, by design)

- Lock-screen media controls don't appear — the WebView's `MediaSession`
  has no Android bridge. Playback itself keeps running in the background.
- The PWA service worker is inert inside the WebView; the app bundle is
  already local, so it isn't needed.
- The Equalizer / Audio Lab runs on the same tracks it runs on in the
  browser (downloaded / same-origin audio), for the same CORS reasons.
