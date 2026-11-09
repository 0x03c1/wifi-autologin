#!/bin/bash
# Remove o vigia do macOS. Use --purge para apagar também a sessão salva, a configuração e os logs.
set -uo pipefail
LABEL="com.wifi-autologin.watchdog"
BASE="$HOME/.wifi-autologin"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$BASE/app"
if [[ "${1:-}" == "--purge" ]]; then
  rm -rf "$BASE"
  echo "Removido (incluindo sessão salva, configuração e logs)."
else
  echo "Removido. Sessão, configuração e logs mantidos em $BASE (use --purge para apagar)."
fi
