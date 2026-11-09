// Vigia a conexão (macOS e Windows):
//  - com internet liberada, a checagem periódica serve de keepalive (evita queda por inatividade);
//  - se um portal cativo interceptar, roda o login automático;
//  - registra quedas/retornos em ~/.wifi-autologin/watchdog.log.
import { execFileSync } from 'node:child_process';
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

// MAC da interface Wi-Fi (o que o portal enxerga), só para diagnóstico no log.
// No macOS o Node recebe o MAC mascarado (02:00:00:00:00:00), então lê pelo ifconfig do dispositivo Wi-Fi.
let wifiDevice;
function macWifiDevice() {
  if (wifiDevice) return wifiDevice;
  try {
    const out = execFileSync('networksetup', ['-listallhardwareports'], { encoding: 'utf8' });
    wifiDevice = out.match(/Hardware Port: (?:Wi-Fi|AirPort)\s*\nDevice: (\S+)/)?.[1];
  } catch {}
  return (wifiDevice ||= 'en0');
}
const MASKED = /^(00:00:00:00:00:00|02:00:00:00:00:00)$/;
function currentMac() {
  try {
    if (process.platform === 'darwin') {
      const out = execFileSync('ifconfig', [macWifiDevice()], { encoding: 'utf8' });
      return out.match(/ether ([0-9a-f:]{17})/i)?.[1] ?? '?';
    }
    const ifs = networkInterfaces();
    const wifi = Object.keys(ifs).find(n => /wi-?fi|wireless|wlan|sem fio|^wl/i.test(n));
    const pick = (wifi ? ifs[wifi] : Object.values(ifs).flat())
      .find(i => !i.internal && i.mac && !MASKED.test(i.mac));
    return pick?.mac ?? '?';
  } catch { return '?'; }
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
      const status = await login().catch(e => { say('erro no login: ' + e.message); return 'error'; });
      const ok = status === 'online' || status === 'ignored';
      failures = ok ? 0 : failures + 1;
      // Janela fechada sem login: você não quer entrar agora; só tenta de novo em 30 min.
      // Outras falhas: espaça as tentativas (20s, 40s, 80s... até 5 min) para não abrir janelas sem parar.
      nextAttempt = ok ? 0
        : status === 'dismissed' ? Date.now() + 30 * 60_000
        : Date.now() + Math.min(10_000 * 2 ** failures, 300_000);
    }
    state = s;
  } finally { busy = false; }
}
// O intervalo é relido a cada ciclo (config.json pode mudar sem reiniciar o vigia).
async function loop() { await tick(); setTimeout(loop, checkIntervalMs()); }
loop();
