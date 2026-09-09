@echo off
REM SurBox APK Builder for Windows
REM Run this script to build Android APK from web app

echo ╔═══════════════════════════════════════════════════════════╗
echo ║         SurBox APK Builder v1.0 (Windows)              ║
echo ║         Ad-free music . EQ . background play     ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.

REM Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js not found! Please install from https://nodejs.org/
    pause
    exit /b 1
)

REM Check Java
where java >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Java not found! Please install JDK 17+ from https://adoptium.net/
    pause
    exit /b 1
)

echo.
echo Step 1/5: Installing npm dependencies...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo ❌ npm install failed
    pause
    exit /b 1
)
echo ✅ Dependencies installed

echo.
echo Step 2/5: Building web application...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Build failed
    pause
    exit /b 1
)
echo ✅ Web app built

echo.
echo Step 3/5: Syncing with Android platform...
call npx cap sync android
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Cap sync failed
    pause
    exit /b 1
)
echo ✅ Android sync complete

echo.
echo Step 4/5: Building Android APK...
cd android
call gradlew.bat assembleDebug
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Gradle build failed
    cd ..
    pause
    exit /b 1
)
cd ..

echo.
echo Step 5/5: Verifying build...
set APK_PATH=android\app\build\outputs\apk\debug\app-debug.apk

if exist "%APK_PATH%" (
    echo ✅ APK built successfully!
    echo.
    echo ╔═══════════════════════════════════════════════════════════╗
    echo ║  BUILD SUCCESSFUL                                         ║
    echo ╠═══════════════════════════════════════════════════════════╣
    echo ║  APK Location: %APK_PATH%
    echo ╠═══════════════════════════════════════════════════════════╣
    echo ║  To install on connected Android device:
    echo ║    adb install %APK_PATH%
    echo ║
    echo ║  To open in Android Studio:
    echo ║    npx cap open android
    echo ╚═══════════════════════════════════════════════════════════╝
    echo.
) else (
    echo ❌ APK not found! Build may have failed.
    pause
    exit /b 1
)

echo.
echo 🎉 Done! Your SurBox APK is ready.
echo.
echo Next steps:
echo   1. Transfer APK to your Android phone
echo   2. Enable 'Install from unknown sources' in Settings
echo   3. Tap the APK file to install
echo   4. Open SurBox app and enjoy!
echo.
pause
