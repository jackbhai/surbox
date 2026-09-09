#!/bin/bash

# SurBox APK Builder Script
# Run this script to build the Android APK from the web app

set -e  # Exit on error

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║         SurBox APK Builder v1.0                          ║"
echo "║         Ad-free music · EQ · background play              ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found! Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Check if Java is installed
if ! command -v java &> /dev/null; then
    echo "❌ Java not found! Please install Java JDK 17+ from https://adoptium.net/"
    exit 1
fi

# Check if Android SDK is available
if [ -z "$ANDROID_HOME" ] && [ -z "$ANDROID_SDK_ROOT" ]; then
    echo "⚠️  Warning: ANDROID_HOME not set"
    echo "   Android SDK might not be found."
    echo "   Set it with: export ANDROID_HOME=/path/to/Android/Sdk"
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo "Step 1/5: Installing npm dependencies..."
npm install
echo "✅ Dependencies installed"

echo ""
echo "Step 2/5: Building web application..."
npm run build
echo "✅ Web app built"

echo ""
echo "Step 3/5: Preparing Android platform..."
if [ ! -d android ]; then
    echo "   No android/ platform found - creating it..."
    npx cap add android
fi
npx cap sync android
echo "✅ Android sync complete"

echo ""
echo "Step 4/5: Building Android APK..."
cd android

# Check if gradlew is executable
if [ ! -x "./gradlew" ]; then
    chmod +x gradlew
fi

# Build debug APK
./gradlew assembleDebug

cd ..

echo ""
echo "Step 5/5: Verifying build..."
APK_PATH="android/app/build/outputs/apk/debug/app-debug.apk"

if [ -f "$APK_PATH" ]; then
    APK_SIZE=$(du -h "$APK_PATH" | cut -f1)
    echo "✅ APK built successfully!"
    echo ""
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║  BUILD SUCCESSFUL                                         ║"
    echo "╠═══════════════════════════════════════════════════════════╣"
    echo "║  APK Location: $APK_PATH"
    echo "║  APK Size: $APK_SIZE"
    echo "╠═══════════════════════════════════════════════════════════╣"
    echo "║  To install on connected Android device:"
    echo "║    adb install $APK_PATH"
    echo ""
    echo "║  To open in Android Studio:"
    echo "║    npx cap open android"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo ""
else
    echo "❌ APK build failed! Check errors above."
    exit 1
fi

echo ""
echo "🎉 Done! Your SurBox APK is ready."
echo ""
echo "Next steps:"
echo "  1. Transfer APK to your Android phone"
echo "  2. Enable 'Install from unknown sources' in Settings"
echo "  3. Tap the APK file to install"
echo "  4. Open SurBox and play some music"
echo ""
