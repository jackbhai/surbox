# SurBox APK Build Guide

Turn the SurBox web app into an Android APK with Capacitor.

## Requirements

| Tool | Version | Link |
|---|---|---|
| Node.js | 18+ | https://nodejs.org |
| Java JDK | 17+ | https://adoptium.net |
| Android SDK | API 34+ | https://developer.android.com/studio |

Set `ANDROID_HOME` to your SDK path, e.g. `export ANDROID_HOME=$HOME/Android/Sdk`.

## One command (Linux / macOS)

```bash
./build-apk.sh
```

The script installs dependencies, builds the web app, creates the `android/`
platform on first run (`npx cap add android`), syncs, and builds a debug APK.

APK output: `android/app/build/outputs/apk/debug/app-debug.apk`

## Windows

```bat
build-apk.bat
```

## Manual steps

```bash
npm install
npm run build
npx cap add android     # only the first time
npx cap sync android
cd android && ./gradlew assembleDebug
```

## Install on your phone

1. Copy the APK to your phone
2. Enable *Install from unknown sources*
3. Tap the APK, install, open **SurBox**

## Release build (optional)

```bash
cd android && ./gradlew assembleRelease
```

Sign with your own keystore for Play Store distribution.

## Notes

- `appId`: `com.surbox.app` (see `capacitor.config.json`)
- The app is a thin web shell — all music features live in the web build,
  so rebuild + `npx cap sync` after any change.
