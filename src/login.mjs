// Login automático em portais cativos de Wi-Fi (página de aceite / login com SSO Microsoft).
//
// Usa um perfil de navegador dedicado: a sessão SSO ("Manter conectado?") fica salva nele,
// então depois do 1º login manual os seguintes acontecem sem digitar nada. Nenhuma senha é
// armazenada pelo script.
//
//   node src/login.mjs           -> automático (sem janela); se o SSO pedir senha/MFA, abre janela
//   node src/login.mjs --setup   -> abre janela para o 1º login (marque "Sim" em "Manter conectado?")
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PROBE_URL, PROFILE_DIR, DEFAULT_BUTTONS, TERMS_CHECKBOX, SSO_HOSTS, matchPortal } from './config.mjs';

const log = (...a) => console.log(new Date().toLocaleString('sv-SE'), ...a);
const CLICKABLE = 'button, a, input[type=submit], input[type=button], [role=button]';
const NEVER_CLICK = /terms|termos|privacy|privacidade|política|policy|cookies|visitante|guest|voucher|cadastr|register/i;

export async function isOnline() {
  try {
    const r = await fetch(PROBE_URL, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    return r.status === 200 && (await r.text()).includes('Success');
  } catch { return false; }
}

export function notify(message) {
  const title = 'Wi-Fi AutoLogin';
  try {
    if (process.platform === 'darwin') {
      spawn('osascript', ['-e', `display notification "${message}" with title "${title}"`], { stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      const ps = `(New-Object -ComObject WScript.Shell).Popup('${message}', 15, '${title}', 64)`;
      spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps],
        { stdio: 'ignore', detached: true, windowsHide: true }).unref();
    }
  } catch { /* notificação é opcional */ }
}

// Chrome se existir; senão Microsoft Edge (sempre presente no Windows).
async function launch(headless) {
  mkdirSync(PROFILE_DIR, { recursive: true });
  let lastErr;
  for (const channel of ['chrome', 'msedge']) {
    try { return await chromium.launchPersistentContext(PROFILE_DIR, { channel, headless }); }
    catch (e) { lastErr = e; }
  }
  throw new Error(`Nenhum navegador encontrado (instale o Google Chrome). ${lastErr?.message ?? ''}`);
}

async function clickIfVisible(locator, ms = 1000) {
  try { await locator.first().waitFor({ state: 'visible', timeout: ms }); await locator.first().click(); return true; }
  catch { return false; }
}

// Marca checkboxes de aceite de termos ainda desmarcados.
export async function acceptTerms(page) {
  for (const box of await page.getByRole('checkbox').all()) {
    try {
      if (!(await box.isVisible()) || await box.isChecked()) continue;
      const label = await box.evaluate(el =>
        (el.closest('label')?.innerText || (el.id && document.querySelector(`label[for="${el.id}"]`)?.innerText) ||
         el.parentElement?.innerText || '').slice(0, 300));
      if (TERMS_CHECKBOX.test(label)) await box.check();
    } catch {}
  }
}

// Clica no primeiro botão visível cujo texto casa com um dos padrões (em ordem de prioridade).
export async function clickNext(page, patterns) {
  for (const pattern of patterns) {
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const candidates = page.locator(CLICKABLE).filter({ hasText: re });
    for (const el of await candidates.all()) {
      const text = (await el.innerText().catch(() => '')) || (await el.getAttribute('value').catch(() => '')) || '';
      if (!re.test(text) || NEVER_CLICK.test(text) || !(await el.isVisible().catch(() => false))) continue;
      await el.click().catch(() => {});
      return text.trim();
    }
  }
  return null;
}

async function run({ headless, setup }) {
  const ctx = await launch(headless);
  const page = ctx.pages()[0] ?? await ctx.newPage();
  try {
    // Abrir a URL de teste faz o portal redirecionar com os parâmetros do cliente (MAC, AP...).
    await page.goto(PROBE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    if (await isOnline()) {
      if (!setup) { log('já está online'); return true; }
      // Setup com internet já liberada: só salva a sessão Microsoft no perfil.
      await page.goto('https://myaccount.microsoft.com/');
      log('Faça login com sua conta, marque "Sim" em "Manter conectado?" e feche a janela.');
      await page.waitForEvent('close', { timeout: 0 });
      return true;
    }

    const portal = matchPortal(page.url() + (await page.content().catch(() => '')));
    if (portal === null) { log('portal não está na lista de config.json — ignorando:', page.url()); return false; }
    const steps = portal.steps?.length ? portal.steps : DEFAULT_BUTTONS;

    const deadline = Date.now() + (headless ? 60000 : 300000); // com janela: 5 min para senha/MFA
    let lastClick = 0;
    while (Date.now() < deadline) {
      if (await isOnline()) { log('conectado ✔'); return true; }
      const url = page.url();

      if (SSO_HOSTS.test(url)) {
        if (headless && await page.locator('input[type=password]:visible, input[name=loginfmt]:visible').first().isVisible().catch(() => false)) {
          log('o login (SSO) pediu credenciais — sessão salva expirou');
          return false;
        }
        await clickIfVisible(page.locator('#idSIButton9'));   // "Sim" em Manter conectado? / Next
        await clickIfVisible(page.locator('[data-test-id]')); // seletor de conta
      } else if (Date.now() - lastClick > 3000) {
        await acceptTerms(page);
        const clicked = await clickNext(page, steps);
        if (clicked) { log('clicou:', clicked); lastClick = Date.now(); }
      }
      await page.waitForTimeout(1500);
    }
    log('tempo esgotado, URL atual:', page.url());
    return await isOnline();
  } finally {
    await ctx.close().catch(() => {});
  }
}

export async function login({ setup = false } = {}) {
  if (setup) {
    log('Modo setup: faça login na janela e marque "Sim" em "Manter conectado?"');
    return run({ headless: false, setup: true });
  }
  if (await run({ headless: true })) return true;
  if (await isOnline()) return true;
  // Sessão expirou ou o portal precisa de interação: avisa e abre janela para completar uma vez.
  notify('Conclua o login na janela que abriu');
  return run({ headless: false });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  login({ setup: process.argv.includes('--setup') })
    .then(ok => process.exit(ok ? 0 : 1))
    .catch(e => { log('erro:', e.message); process.exit(1); });
}
