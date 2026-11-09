@echo off
rem Clique duas vezes para instalar no Windows.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
pause
