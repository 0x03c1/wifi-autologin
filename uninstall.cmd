@echo off
rem Clique duas vezes para desinstalar no Windows.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
pause
