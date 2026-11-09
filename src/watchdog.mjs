// Vigia a conexão (macOS e Windows):
//  - com internet liberada, a checagem periódica serve de keepalive (evita queda por inatividade);
//  - se um portal cativo interceptar, roda o login automático;
//  - registra quedas/retornos em ~/.wifi-autologin/watchdog.log.
import { appendFileSync, mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { BASE_DIR, LOG_FILE, PROBE_URL, checkIntervalMs, classifyPortal } from './config.mjs';
import { login } from './login.mjs';

mkdirSync(BASE_DIR, { recursive: true });
const append = (msg) => { try { appendFileSync(LOG_FILE, msg + '\n'); } catch {} };
// login.mjs também loga via console.log: espelha no arquivo.
const origLog = console.log;
console.log = (...a) => { origLog(...a); append(a.join(' ')); };
const say = (line) => console.log(`${new Date().toLocaleString('sv-SE')} ${line}`);

function currentMac() {
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (!i.internal && i.family === 'IPv4' && i.mac !== '00:00:00:00:00:00') return i.mac;
  }
  return '?';
}

// online | portal | ignored | offline
async function probe() {
  try {
    const r = await fetch(PROBE_URL, { redirect: 'manual', signal: AbortSignal.timeout(6000) });
    const body = await r.text().catch(() => '');
    if (r.status === 200 && body.includes('Success')) return 'online';
    return classifyPortal((r.headers.get('location') ?? '') + body).action === 'ignore' ? 'ignored' : 'portal';
  } catch { return 'offline'; }
}

let state = '';
let busy = false;
let failures = 0;
let nextAttempt = 0;
say('vigia iniciado');
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const s = await probe();
    if (s === 'online' && state !== 'online') { say('online'); failures = 0; nextAttempt = 0; }
    if (s === 'offline' && state !== 'offline') say('sem rede (Wi-Fi desconectado ou acordando)');
    if (s === 'ignored' && state !== 'ignored') say('portal ignorado pela configuração');
    if (s === 'portal' && Date.now() >= nextAttempt) {
      say(`portal cativo detectado → login (MAC ${currentMac()})`);
      const ok = await login().catch(e => { say('erro no login: ' + e.message); return false; });
      failures = ok ? 0 : failures + 1;
      // Se falhar repetidamente, espaça as tentativas (20s, 40s, 80s... até 5 min) para não abrir janelas sem parar.
      nextAttempt = ok ? 0 : Date.now() + Math.min(10_000 * 2 ** failures, 300_000);
    }
    state = s;
  } finally { busy = false; }
}
// O intervalo é relido a cada ciclo (config.json pode mudar sem reiniciar o vigia).
async function loop() { await tick(); setTimeout(loop, checkIntervalMs()); }
loop();
