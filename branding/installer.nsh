!macro customInit
  ; Avoid the original Caribbean app's installation directory.
  ${If} ${FileExists} "$INSTDIR\resources\backend\server.js"
    StrCpy $INSTDIR "$INSTDIR Desktop"
  ${EndIf}
!macroend
