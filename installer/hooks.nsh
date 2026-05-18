; Adobe Bridge - NSIS installer hooks

!macro customInstall
    ; Registry: allow unsigned CEP panels
    WriteRegStr HKCU "Software\Adobe\CSXS.9"  "PlayerDebugMode" "1"
    WriteRegStr HKCU "Software\Adobe\CSXS.10" "PlayerDebugMode" "1"
    WriteRegStr HKCU "Software\Adobe\CSXS.11" "PlayerDebugMode" "1"
    WriteRegStr HKCU "Software\Adobe\CSXS.12" "PlayerDebugMode" "1"

    ; Add to Windows startup
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AdobeBridge" "$INSTDIR\Adobe Bridge.exe"

    ; Create CEP extensions directory
    CreateDirectory "$APPDATA\Adobe\CEP\extensions"
!macroend

!macro customUnInstall
    ; Remove startup entry
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AdobeBridge"

    ; Remove all bridge panels on full uninstall
    RMDir /r "$APPDATA\Adobe\CEP\extensions\com.aebridge.listener"
    RMDir /r "$APPDATA\Adobe\CEP\extensions\com.idbridge.main"
    RMDir /r "$APPDATA\Adobe\CEP\extensions\com.aibridge.main"
    RMDir /r "$APPDATA\Adobe\CEP\extensions\com.psbridge.main"
!macroend
