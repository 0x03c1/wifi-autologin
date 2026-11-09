// Configuração compartilhada. Nada aqui é segredo: credenciais nunca ficam no código.
//
// Ajustes por usuário (opcionais) ficam em ~/.wifi-autologin/config.json, fora do repositório:
// {
//   "portals": [                                  // vazio/ausente = agir em qualquer portal cativo
//     { "match": "portal.exemplo.edu.br",           // trecho da URL/página do portal
//       "steps": ["Login Microsoft", "Continue"] } // textos dos botões, na ordem (opcional)
//   ],
//   "checkIntervalSeconds": 10
// }
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const BASE_DIR = process.env.WIFI_AUTOLOGIN_HOME || join(homedir(), '.wifi-autologin');
export const PROFILE_DIR = join(BASE_DIR, 'browser-profile'); // sessão SSO salva (local, nunca versionada)
export const LOG_FILE = join(BASE_DIR, 'watchdog.log');
export const USER_CONFIG = join(BASE_DIR, 'config.json');

// URL de teste de portal cativo. Responde "Success" quando a internet está liberada;
// atrás de um portal, a rede intercepta e redireciona para a página de login.
export const PROBE_URL = 'http://captive.apple.com/hotspot-detect.html';

// Textos de botão tentados quando o portal não tem "steps" próprios (ordem = prioridade).
export const DEFAULT_BUTTONS = [
  /microsoft|azure|office ?365|entra/i,
  /^\s*(continue|continuar|prosseguir|avançar|next|próximo)\s*$/i,
  /^\s*(conectar|connect|acessar|entrar|login|log in|sign in|iniciar sessão)\s*$/i,
  /^\s*(aceitar|aceito|accept|agree|concordo|ok)\s*$/i,
];

// Rótulos de checkbox que podem ser marcados automaticamente (aceite de termos).
export const TERMS_CHECKBOX = /aceito|aceitar|accept|agree|concordo|termos|terms/i;

// Domínios de SSO tratados no fluxo de login.
export const SSO_HOSTS = /login\.microsoftonline\.com|login\.live\.com|login\.microsoft\.com/;

function loadUserConfig() {
  try { return existsSync(USER_CONFIG) ? JSON.parse(readFileSync(USER_CONFIG, 'utf8')) : {}; }
  catch (e) { console.error(`config.json inválido (${e.message}); usando padrões`); return {}; }
}

const user = loadUserConfig();
export const PORTALS = Array.isArray(user.portals) ? user.portals : [];
export const CHECK_INTERVAL_MS = (Number(user.checkIntervalSeconds) || 10) * 1000;

// Retorna o perfil do portal que casa com o texto (URL/HTML), {} se não há lista, ou null se
// há lista e nada casa (portal desconhecido: não mexer).
export function matchPortal(text) {
  if (!PORTALS.length) return {};
  return PORTALS.find(p => p.match && text.toLowerCase().includes(String(p.match).toLowerCase())) ?? null;
}
