// Login automático em portais cativos de Wi-Fi (aceite de termos, SSO Microsoft e, com o modo
// aprendizado, portais de usuário e senha).
//
// Usa um perfil de navegador dedicado: a sessão SSO ("Manter conectado?") fica salva nele.
// Senhas de portais aprendidos ficam no cofre do sistema (veja credentials.mjs), nunca em arquivo.
//
//   node src/login.mjs           -> automático (sem janela); se precisar de você, abre janela
//   node src/login.mjs --setup   -> abre janela para o 1º login Microsoft ("Manter conectado?" = Sim)
//   node src/login.mjs --learn   -> abre janela no portal atual para aprender o login
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PROBE_URL, PROFILE_DIR, DEFAULT_BUTTONS, TERMS_CHECKBOX, SSO_HOSTS, classifyPortal, hostOf, readConfig } from './config.mjs';
import { getCredentials } from './credentials.mjs';
import { installCapture, offerToSave } from './learn.mjs';

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

// Marca checkboxes de aceite de termos ainda desmarcados (page ou frame).
export async function acceptTerms(scope) {
  for (const box of await scope.getByRole('checkbox').all()) {
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
// Passos definidos pelo usuário ou aprendidos são confiáveis; os padrões genéricos passam pelo filtro NEVER_CLICK.
export async function clickNext(page, patterns, { guard = true } = {}) {
  for (const pattern of patterns) {
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    for (const el of await page.locator(CLICKABLE).filter({ hasText: re }).all()) {
      const text = (await el.innerText().catch(() => '')) || (await el.getAttribute('value').catch(() => '')) || '';
      if (!re.test(text) || (guard && NEVER_CLICK.test(text)) || !(await el.isVisible().catch(() => false))) continue;
      await el.click().catch(() => {});
      return text.trim();
    }
  }
  return null;
}

// Há campo de senha visível fora do SSO? (portal de usuário/senha)
async function passwordFieldVisible(page) {
  for (const frame of page.frames()) {
    if (SSO_HOSTS.test(frame.url())) continue;
    if (await frame.locator('input[type=password]').first().isVisible().catch(() => false)) return true;
  }
  return false;
}

// Preenche usuário/senha de um portal aprendido. Só preenche no mesmo endereço onde aprendeu
// (e só em HTTPS, se foi aprendido em HTTPS). Retorna 'filled' | 'absent' | 'missing' | 'blocked'.
async function fillLearned(page, portal) {
  for (const frame of page.frames()) {
    const pw = frame.locator(portal.fields.password).first();
    if (!(await pw.isVisible().catch(() => false))) continue;
    const url = frame.url();
    if (hostOf(url) !== portal.host || (portal.secure && !url.startsWith('https:'))) return 'blocked';
    const cred = getCredentials(portal.host);
    if (!cred) return 'missing';
    if (portal.fields.username) await frame.locator(portal.fields.username).first().fill(cred.username).catch(() => {});
    await pw.fill(cred.password);
    await acceptTerms(frame);
    const clicked = portal.submit?.selector &&
      await frame.locator(portal.submit.selector).first().click({ timeout: 3000 }).then(() => true, () => false);
    if (!clicked) await pw.press('Enter').catch(() => {});
    return 'filled';
  }
  return 'absent';
}

// Retorna 'online' | 'ignored' | 'needs-user' | 'dismissed' | 'timeout'.
async function run({ headless, setup = false, forceLearn = false }) {
  const cfg = readConfig();
  const ctx = await launch(headless);
  const capture = !headless && !setup && (cfg.learn || forceLearn) ? await installCapture(ctx) : null;
  const page = ctx.pages()[0] ?? await ctx.newPage();
  try {
    // Abrir a URL de teste faz o portal redirecionar com os parâmetros do cliente (MAC, AP...).
    await page.goto(PROBE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    if (await isOnline()) {
      if (!setup) { log('já está online'); return 'online'; }
      // Setup com internet já liberada: só salva a sessão Microsoft no perfil.
      await page.goto('https://myaccount.microsoft.com/');
      log('Faça login com sua conta, marque "Sim" em "Manter conectado?" e feche a janela.');
      await page.waitForEvent('close', { timeout: 0 });
      return 'online';
    }

    const startUrl = page.url();
    const { action, portal } = classifyPortal(startUrl + (await page.content().catch(() => '')), cfg);
    if (action === 'ignore' && !forceLearn) { log('portal ignorado pela configuração:', startUrl); return 'ignored'; }
    const learned = !!portal?.learned;
    // Com janela, num portal novo ou aprendido, quem age é você (e o aprendizado observa).
    const auto = headless || (action === 'known' && !learned);
    const steps = portal?.steps?.length ? portal.steps : DEFAULT_BUTTONS;
    const guard = steps === DEFAULT_BUTTONS;
    if (!headless) log(auto ? 'janela aberta: concluindo o login' : 'janela aberta: faça o login; depois ofereço salvar');

    const deadline = Date.now() + (headless ? 60000 : 600000); // com janela: até 10 min
    let lastClick = 0, fills = 0;
    while (Date.now() < deadline) {
      if (await isOnline()) {
        log('conectado ✔');
        if (capture && (action !== 'known' || learned)) await offerToSave(startUrl, capture.events, learned ? portal : null);
        return 'online';
      }
      if (page.isClosed()) { log('janela fechada sem concluir o login'); return 'dismissed'; }
      const url = page.url();

      if (SSO_HOSTS.test(url)) {
        if (headless && await page.locator('input[type=password]:visible, input[name=loginfmt]:visible').first().isVisible().catch(() => false)) {
          log('o login (SSO) pediu credenciais — sessão salva expirou');
          return 'needs-user';
        }
        if (auto) {
          await clickIfVisible(page.locator('#idSIButton9'));   // "Sim" em Manter conectado? / Next
          await clickIfVisible(page.locator('[data-test-id]')); // seletor de conta
        }
      } else if (auto && Date.now() - lastClick > 3000) {
        if (learned && portal.fields?.password) {
          const r = await fillLearned(page, portal);
          if (r === 'missing') { log('senha deste portal não está no cofre'); return 'needs-user'; }
          if (r === 'blocked') { log('endereço do portal não confere com o aprendido — senha NÃO preenchida'); return 'needs-user'; }
          if (r === 'filled') {
            if (++fills > 2) { log('o portal recusou o login salvo (senha mudou?)'); return 'needs-user'; }
            log('preencheu o login salvo');
            lastClick = Date.now();
            await page.waitForTimeout(3000);
            continue;
          }
        } else if (await passwordFieldVisible(page)) {
          log('o portal pede usuário e senha que ainda não conheço');
          return 'needs-user';
        }
        await acceptTerms(page);
        const clicked = await clickNext(page, steps, { guard });
        if (clicked) { log('clicou:', clicked); lastClick = Date.now(); }
      }
      await page.waitForTimeout(1500);
    }
    log('tempo esgotado, URL atual:', page.url());
    return (await isOnline()) ? 'online' : 'timeout';
  } finally {
    await ctx.close().catch(() => {});
  }
}

export { run as attempt }; // usado nos testes

export async function login({ setup = false, forceLearn = false } = {}) {
  if (setup) {
    log('Modo setup: faça login na janela e marque "Sim" em "Manter conectado?"');
    return run({ headless: false, setup: true });
  }
  if (!forceLearn) {
    const status = await run({ headless: true });
    if (status === 'online' || status === 'ignored') return status;
    if (await isOnline()) return 'online';
  }
  const learning = forceLearn || readConfig().learn;
  notify(learning ? 'Faça o login na janela; depois ofereço salvar para as próximas vezes' : 'Conclua o login na janela que abriu');
  return run({ headless: false, forceLearn });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  login({ setup: process.argv.includes('--setup'), forceLearn: process.argv.includes('--learn') })
    .then(status => process.exit(status === 'online' ? 0 : 1))
    .catch(e => { log('erro:', e.message); process.exit(1); });
}
