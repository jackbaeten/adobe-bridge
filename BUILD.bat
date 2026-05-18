@echo off
setlocal enabledelayedexpansion
title Adobe Bridge - Build

echo.
echo  ====================================================
echo   Adobe Bridge  v1.0  -  Build Script
echo  ====================================================
echo.

:: ── Check Node.js ─────────────────────────────────────────────
node -v >nul 2>&1
if %errorLevel% neq 0 (
    echo  [!] Node.js is NOT installed.
    echo      Download LTS from: https://nodejs.org
    echo      After installing, run this script again.
    echo.
    start https://nodejs.org
    pause & exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NV=%%i
echo  Node.js !NV! found.

:: ── Install npm packages ───────────────────────────────────────
if not exist "node_modules" (
    echo.
    echo  Installing packages (downloads Electron ~80MB once)...
    call npm install
    if !errorLevel! neq 0 ( echo  [ERROR] npm install failed. & pause & exit /b 1 )
) else (
    echo  Packages already installed.
)

:: ── Build Electron app ─────────────────────────────────────────
echo.
echo  Building app...
call npm run build
if !errorLevel! neq 0 ( echo  [ERROR] Build failed. & pause & exit /b 1 )
echo  App built to dist\win-unpacked\

:: ── Find NSIS ──────────────────────────────────────────────────
echo.
echo  Looking for NSIS...
set NSIS_PATH=

for %%P in (
    "C:\Program Files (x86)\NSIS\makensis.exe"
    "C:\Program Files\NSIS\makensis.exe"
    "C:\NSIS\makensis.exe"
) do (
    if exist %%P (
        if "!NSIS_PATH!"=="" set NSIS_PATH=%%~P
    )
)

if "!NSIS_PATH!"=="" (
    echo  NSIS not found - downloading page...
    echo.
    echo  NSIS is a free tool needed to build the installer.
    echo  1. Download from: https://nsis.sourceforge.io/Download
    echo  2. Install it (default location is fine)
    echo  3. Run this BUILD.bat again
    echo.
    echo  Your app is already built in dist\win-unpacked\
    echo  You can run "Adobe Bridge.exe" from there right now to test.
    echo.
    start https://nsis.sourceforge.io/Download
    pause & exit /b 0
)

echo  NSIS: !NSIS_PATH!

:: ── Build installer with NSIS ──────────────────────────────────
echo.
echo  Building installer...
"!NSIS_PATH!" /V2 installer\installer.nsi
if !errorLevel! neq 0 ( echo. & echo  [ERROR] NSIS failed. & pause & exit /b 1 )

if exist "Adobe Bridge Setup.exe" (
    if not exist "dist" mkdir dist
    move /y "Adobe Bridge Setup.exe" "dist\Adobe Bridge Setup.exe" >nul
    echo.
    echo  ====================================================
    echo   Done!  dist\Adobe Bridge Setup.exe
    echo  ====================================================
) else (
    echo  Installer built to current folder.
)
echo.
pause
