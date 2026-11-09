// Configuração compartilhada. Nada aqui é segredo: credenciais nunca ficam no código nem em arquivo.
//
// Ajustes por usuário (opcionais) ficam em ~/.wifi-autologin/config.json, fora do repositório:
// {
//   "portals": [                                   // vazio/ausente = agir em qualquer portal cativo
//     { "match": "portal.exemplo.edu.br",            // trecho da URL/página do portal
//       "steps": ["Login Microsoft", "Continue"] }  // textos dos botões, na ordem (opcional)
//   ],
//   "learn": true,                                  // aprender portais novos com usuário e senha
//   "ignore": ["hotspot.exemplo.com"],              // portais em que nunca agir
//   "checkIntervalSeconds": 10
// }
// O arquivo é relido a cada uso; portais aprendidos são gravados nele (sem senha).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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

// Domínios de SSO tratados no fluxo de login (senhas digitadas neles nunca são guardadas).
export const SSO_HOSTS = /login\.microsoftonline\.com|login\.live\.com|login\.microsoft\.com/;

export function readConfig() {
  let cfg = {};
  try { if (existsSync(USER_CONFIG)) cfg = JSON.parse(readFileSync(USER_CONFIG, 'utf8')); }
  catch (e) { console.error(`config.json inválido (${e.message}); usando padrões`); }
  return {
    ...cfg,
    portals: Array.isArray(cfg.portals) ? cfg.portals : [],
    ignore: Array.isArray(cfg.ignore) ? cfg.ignore : [],
    learn: cfg.learn === true,
  };
}

export function writeConfig(cfg) {
  mkdirSync(BASE_DIR, { recursive: true });
  const tmp = USER_CONFIG + '.tmp';
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
  renameSync(tmp, USER_CONFIG); // troca atômica: o vigia nunca lê um arquivo pela metade
}

export const checkIntervalMs = () => (Number(readConfig().checkIntervalSeconds) || 10) * 1000;

export const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } };

// Decide o que fazer com um portal a partir do texto interceptado (URL + HTML):
//   { action: 'known', portal }  -> portal configurado ou aprendido
//   { action: 'generic' }        -> sem lista: tenta os botões comuns
//   { action: 'learn' }          -> portal novo e o aprendizado está ligado
//   { action: 'ignore' }         -> lista restrita, ou portal marcado para ignorar
export function classifyPortal(text, cfg = readConfig()) {
  const lower = text.toLowerCase();
  const portal = cfg.portals.find(p => p.match && lower.includes(String(p.match).toLowerCase()));
  if (portal) return { action: 'known', portal };
  if (cfg.ignore.some(h => h && lower.includes(String(h).toLowerCase()))) return { action: 'ignore' };
  if (cfg.learn) return { action: 'learn' };
  return cfg.portals.length ? { action: 'ignore' } : { action: 'generic' };
}
