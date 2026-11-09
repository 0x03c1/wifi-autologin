# Remove o vigia do Windows. Use -Purge para apagar também a sessão salva, a configuração e os logs.
param([switch]$Purge)
$TaskName = 'Wi-Fi AutoLogin'
$Base = Join-Path $env:USERPROFILE '.wifi-autologin'
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*\.wifi-autologin\app\src\watchdog.mjs*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-Item -Recurse -Force (Join-Path $Base 'app') -ErrorAction SilentlyContinue
if ($Purge) {
  Remove-Item -Recurse -Force $Base -ErrorAction SilentlyContinue
  Write-Host 'Removido (incluindo sessão salva, configuração e logs).'
} else {
  Write-Host "Removido. Sessão, configuração e logs mantidos em $Base (use -Purge para apagar)."
}
