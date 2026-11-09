# Instalador para Windows 10/11: copia o app para %USERPROFILE%\.wifi-autologin\app, instala dependências,
# registra o vigia como Tarefa Agendada (inicia no logon, sem janela) e abre o login inicial.
#   Uso: clique duas vezes em install.cmd  (ou)  powershell -ExecutionPolicy Bypass -File install.ps1 [-NoSetup]
param([switch]$NoSetup)
$ErrorActionPreference = 'Stop'

$TaskName = 'Wi-Fi AutoLogin'
$Base = Join-Path $env:USERPROFILE '.wifi-autologin'
$App  = Join-Path $Base 'app'
$Src  = $PSScriptRoot

function Say($m) { Write-Host "==> $m" -ForegroundColor Cyan }

# 1. Node.js >= 18
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Say 'Instalando Node.js LTS via winget...'
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  }
  if (-not $node) { throw 'Node.js não encontrado. Instale em https://nodejs.org (LTS) e rode de novo.' }
}
$major = [int](& $node -p "process.versions.node.split('.')[0]")
if ($major -lt 18) { throw "Node.js 18+ necessário (encontrado: $major)." }
$npm = Join-Path (Split-Path $node) 'npm.cmd'

# 2. Copia o app e instala dependências (usa Chrome se houver; senão o Microsoft Edge do Windows)
Say "Copiando arquivos para $App"
New-Item -ItemType Directory -Force -Path $App | Out-Null
Remove-Item -Recurse -Force (Join-Path $App 'src') -ErrorAction SilentlyContinue
Copy-Item -Recurse -Force (Join-Path $Src 'src'), (Join-Path $Src 'package.json') $App
if (Test-Path (Join-Path $Src 'package-lock.json')) { Copy-Item -Force (Join-Path $Src 'package-lock.json') $App }
Say 'Instalando dependências'
Push-Location $App
& $npm install --omit=dev --no-audit --no-fund --silent
Pop-Location

# 3. Tarefa agendada: inicia no logon, sem janela (conhost --headless), reinicia se cair
Say "Registrando a tarefa agendada '$TaskName'"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
$watchdog = Join-Path $App 'src\watchdog.mjs'
$action   = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless `"$node`" `"$watchdog`"" -WorkingDirectory $App
$trigger  = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
            -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Mantém a conexão Wi-Fi e faz login automático em portais cativos' | Out-Null
Start-ScheduledTask -TaskName $TaskName

# 4. Login inicial (salva a sessão SSO no perfil dedicado)
if (-not $NoSetup) {
  Say 'Abrindo o navegador para o login inicial.'
  Say 'Entre com sua conta e marque "Sim" em "Manter conectado?". Depois feche a janela.'
  Push-Location $App
  & $node 'src\login.mjs' --setup
  Pop-Location
}

Write-Host ''
Write-Host 'Instalado. O vigia roda em segundo plano e inicia junto com o Windows.' -ForegroundColor Green
Write-Host "  Log:           $Base\watchdog.log"
Write-Host "  Configuração:  $Base\config.json (opcional, veja config.example.json)"
Write-Host '  Desinstalar:   uninstall.cmd'
Write-Host ''
Write-Host 'Recomendação (veja o README):'
Write-Host '  - Configurações > Rede e Internet > Wi-Fi > (rede) > Endereços de hardware aleatórios: Desativado'
