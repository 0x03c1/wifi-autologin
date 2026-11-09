#!/bin/bash
# Instalador para macOS: copia o app para ~/.wifi-autologin/app, instala dependências,
# registra o vigia como LaunchAgent (inicia no login) e abre o login inicial.
#   Uso: ./install.sh [--no-setup]
set -euo pipefail

LABEL="com.wifi-autologin.watchdog"
BASE="$HOME/.wifi-autologin"
APP="$BASE/app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SRC="$(cd "$(dirname "$0")" && pwd)"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

# 1. Node.js >= 18
NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then
  if command -v brew >/dev/null; then
    say "Instalando Node.js via Homebrew..."; brew install node; NODE="$(command -v node)"
  else
    echo "Node.js não encontrado. Instale em https://nodejs.org (LTS) e rode de novo."; exit 1
  fi
fi
[[ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -ge 18 ]] || { echo "Node.js 18+ necessário."; exit 1; }

# 2. Navegador
if [[ ! -d "/Applications/Google Chrome.app" && ! -d "/Applications/Microsoft Edge.app" ]]; then
  echo "Instale o Google Chrome (https://www.google.com/chrome) e rode de novo."; exit 1
fi

# 3. Copia o app para fora de Downloads/Documents/Desktop (pastas que o macOS bloqueia para processos em segundo plano)
say "Copiando arquivos para $APP"
mkdir -p "$APP"
rm -rf "$APP/src"
cp -R "$SRC/src" "$SRC/package.json" "$APP/"
[[ -f "$SRC/package-lock.json" ]] && cp "$SRC/package-lock.json" "$APP/"
say "Instalando dependências"
(cd "$APP" && npm install --omit=dev --no-audit --no-fund --silent)

# 4. LaunchAgent
say "Registrando o vigia ($LABEL)"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$APP/src/watchdog.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>$BASE/watchdog.err.log</string>
</dict>
</plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$PLIST"

# 5. Login inicial (salva a sessão SSO no perfil dedicado)
if [[ "${1:-}" != "--no-setup" ]]; then
  say "Abrindo o navegador para o login inicial."
  say "Entre com sua conta e marque \"Sim\" em \"Manter conectado?\". Depois feche a janela."
  (cd "$APP" && "$NODE" src/login.mjs --setup) || true
fi

cat <<'EOF'

✔ Instalado. O vigia roda em segundo plano e inicia junto com o macOS.
  Log:          ~/.wifi-autologin/watchdog.log
  Configuração: ~/.wifi-autologin/config.json (opcional, veja config.example.json)
  Desinstalar:  ./uninstall.sh

Recomendações (veja o README):
  • Ajustes → Wi-Fi → (i) da rede → Endereço Wi-Fi privado: Fixo
  • Desligar o pop-up de portal do macOS (ele não guarda a sessão):
      sudo defaults write /Library/Preferences/SystemConfiguration/com.apple.captive.control Active -bool false
EOF
