; ============================================================
;  Adobe Bridge  -  Installer
;  Based on the same approach as Overlord by Battle Axe
; ============================================================

Unicode True
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!define APP_NAME      "Adobe Bridge"
!define APP_VERSION   "1.0.0"
!define APP_EXE       "Adobe Bridge.exe"
!define APP_ID        "AdobeBridge"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"
!define STARTUP_KEY   "Software\Microsoft\Windows\CurrentVersion\Run"

Name            "${APP_NAME}"
OutFile         "Adobe Bridge Setup.exe"
InstallDir      "$LOCALAPPDATA\${APP_NAME}"
InstallDirRegKey HKCU "Software\${APP_ID}" "InstallPath"
RequestExecutionLevel user
SetCompressor   /SOLID lzma
BrandingText    " "

; ── MUI appearance ───────────────────────────────────────────
!define MUI_WELCOMEFINISHPAGE_BITMAP   "sidebar.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "sidebar.bmp"

!define MUI_WELCOMEPAGE_TITLE       "Adobe Bridge"
!define MUI_WELCOMEPAGE_TEXT        "Version ${APP_VERSION}$\r$\n$\r$\nConnects InDesign, Illustrator and Photoshop directly to After Effects.$\r$\n$\r$\nThe app runs in your system tray, just like Overlord.$\r$\n$\r$\nClick Install to continue."

!define MUI_FINISHPAGE_TITLE        "Adobe Bridge is installed"
!define MUI_FINISHPAGE_TEXT         "The app will start automatically with Windows and sit in your system tray.$\r$\n$\r$\nOpen InDesign or After Effects and go to$\r$\nWindow > Extensions to open the bridge panels."
!define MUI_FINISHPAGE_RUN          "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT     "Launch Adobe Bridge now"
!define MUI_FINISHPAGE_NOREBOOTNOTIFY
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName"     "${APP_NAME}"
VIAddVersionKey "ProductVersion"  "${APP_VERSION}"
VIAddVersionKey "CompanyName"     "${APP_NAME}"
VIAddVersionKey "FileDescription" "${APP_NAME} Installer"
VIAddVersionKey "FileVersion"     "${APP_VERSION}"
VIAddVersionKey "LegalCopyright"  "2026 ${APP_NAME}"

; ── Install ───────────────────────────────────────────────────
Section
    SetOutPath "$INSTDIR"
    SetOverwrite on

    ; Copy all app files
    File /r "dist\win-unpacked\*.*"

    ; Uninstall registry entry
    WriteRegStr   HKCU "${UNINSTALL_KEY}" "DisplayName"     "${APP_NAME}"
    WriteRegStr   HKCU "${UNINSTALL_KEY}" "DisplayVersion"  "${APP_VERSION}"
    WriteRegStr   HKCU "${UNINSTALL_KEY}" "Publisher"       "${APP_NAME}"
    WriteRegStr   HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
    WriteRegStr   HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
    WriteRegStr   HKCU "${UNINSTALL_KEY}" "DisplayIcon"     '"$INSTDIR\${APP_EXE}"'
    WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify"        1
    WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair"        1

    ; Start with Windows (hidden, tray only)
    WriteRegStr HKCU "${STARTUP_KEY}" "${APP_NAME}" '"$INSTDIR\${APP_EXE}" --hidden'

    ; Adobe CEP - allow unsigned extensions
    WriteRegStr HKCU "Software\Adobe\CSXS.9"  "PlayerDebugMode" "1"
    WriteRegStr HKCU "Software\Adobe\CSXS.10" "PlayerDebugMode" "1"
    WriteRegStr HKCU "Software\Adobe\CSXS.11" "PlayerDebugMode" "1"
    WriteRegStr HKCU "Software\Adobe\CSXS.12" "PlayerDebugMode" "1"

    ; Create CEP extensions folder
    CreateDirectory "$APPDATA\Adobe\CEP\extensions"

    ; Start menu
    CreateShortcut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"

    WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

; ── Uninstall ─────────────────────────────────────────────────
Section "Uninstall"
    ExecWait 'taskkill /F /IM "${APP_EXE}" /T'

    RMDir /r "$APPDATA\Adobe\CEP\extensions\com.aebridge.listener"
    RMDir /r "$APPDATA\Adobe\CEP\extensions\com.idbridge.main"
    RMDir /r "$APPDATA\Adobe\CEP\extensions\com.aibridge.main"
    RMDir /r "$APPDATA\Adobe\CEP\extensions\com.psbridge.main"
    RMDir /r "$INSTDIR"

    Delete "$SMPROGRAMS\${APP_NAME}.lnk"
    DeleteRegKey HKCU "${UNINSTALL_KEY}"
    DeleteRegValue HKCU "${STARTUP_KEY}" "${APP_NAME}"
SectionEnd
