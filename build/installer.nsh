; Never terminate an editor that could have an unsaved document.
; NSIS runs 32-bit PowerShell: CIM can read 64-bit paths; Get-Process.Path cannot.
!macro customCheckAppRunning
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("MDVIEW_INSTALL_DIR", "$INSTDIR").r0'
  nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -Command "try { $$target = [IO.Path]::GetFullPath((Join-Path $$env:MDVIEW_INSTALL_DIR 'MdView.exe')); if (Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $$_.ExecutablePath -eq $$target }) { exit 10 }; exit 0 } catch { exit 11 }"`
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "请先保存文档并关闭已安装的 MdView，再重新运行安装或卸载程序。" /SD IDOK
    SetErrorLevel 10
    Quit
  ${EndIf}
!macroend
