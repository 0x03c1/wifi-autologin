// Modo aprendizado: observa o login que o usuário faz numa janela do navegador e, com a
// confirmação dele, guarda os passos no config.json e a senha no cofre do sistema.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SSO_HOSTS, hostOf, readConfig, writeConfig } from './config.mjs';
import { saveCredentials } from './credentials.mjs';

const run = promisify(execFile);
const log = (...a) => console.log(new Date().toLocaleString('sv-SE'), ...a);

// Roda dentro de cada página/frame: registra cliques, envios de formulário e Enter,
// junto com os campos de usuário/senha preenchidos naquele momento.
function captureScript() {
  if (window.__walInstalled) return;
  window.__walInstalled = true;
  const q = (v) => String(v).replace(/["\\]/g, '\\$&');
  const sel = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.name) return `${tag}[name="${q(el.name)}"]`;
    const type = el.getAttribute('type');
    const css = type ? `${tag}[type="${q(type)}"]` : tag;
    return `${css} >> nth=${[...document.querySelectorAll(css)].indexOf(el)}`;
  };
  const label = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80);
  const snapshot = (ev) => {
    const pw = [...document.querySelectorAll('input[type=password]')].find(i => i.value);
    let user = null;
    if (pw) {
      const scope = pw.form || document;
      const filled = [...scope.querySelectorAll('input')].filter(i =>
        i.value && !/^(hidden|password|checkbox|radio|submit|button|image|reset)$/i.test(i.type));
      user = filled.filter(i => i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING).pop() || filled[0] || null;
    }
    window.__walCapture?.({
      ...ev,
      url: location.href,
      password: pw ? { selector: sel(pw), value: pw.value } : null,
      username: user ? { selector: sel(user), value: user.value } : null,
    });
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('button, a, input[type=submit], input[type=button], [role=button]');
    if (el) snapshot({ kind: 'click', text: label(el), selector: sel(el) });
  }, true);
  document.addEventListener('submit', () => snapshot({ kind: 'submit' }), true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target?.matches?.('input')) snapshot({ kind: 'enter' });
  }, true);
}

/** Liga a captura no contexto do navegador. Os eventos ficam só em memória. */
export async function installCapture(ctx) {
  const events = [];
  await ctx.exposeBinding('__walCapture', (_source, data) => { events.push(data); });
  await ctx.addInitScript(captureScript);
  return { events };
}

const VAULT = { darwin: 'Keychain', win32: 'Gerenciador de Credenciais' }[process.platform] ?? 'cofre do sistema';

/** Pergunta ao usuário. Retorna 'save' | 'later' | 'never'. */
export async function askToSave(host, withPassword, updating) {
  const what = updating ? 'Atualizar o login salvo' : withPassword ? 'Salvar o login' : 'Salvar os passos (sem senha)';
  const detail = withPassword
    ? `A senha fica no ${VAULT}; nas próximas vezes o Wi-Fi AutoLogin entra sozinho.`
    : 'Nas próximas vezes o Wi-Fi AutoLogin repete os cliques sozinho.';
  const text = `${what} do portal ${host}?\n\n${detail}`;
  // Testes automatizados respondem pelo ambiente (save | later | never), sem diálogo.
  if (process.env.WIFI_AUTOLOGIN_ANSWER) return process.env.WIFI_AUTOLOGIN_ANSWER;
  try {
    if (process.platform === 'darwin') {
      const esc = (s) => s.replace(/["\\]/g, '\\$&');
      const script = `button returned of (display dialog "${esc(text)}" with title "Wi-Fi AutoLogin" ` +
        `buttons {"Nunca neste portal", "Agora não", "Salvar"} default button "Salvar" giving up after 120)`;
      const { stdout } = await run('osascript', ['-e', script]);
      return { Salvar: 'save', 'Nunca neste portal': 'never' }[stdout.trim()] ?? 'later';
    }
    if (process.platform === 'win32') {
      const msg = `${text}\n\nSim = salvar   Não = agora não   Cancelar = nunca neste portal`.replace(/'/g, "''");
      const ps = `(New-Object -ComObject WScript.Shell).Popup('${msg}', 120, 'Wi-Fi AutoLogin', 3 + 32)`;
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true });
      return { 6: 'save', 2: 'never' }[stdout.trim()] ?? 'later';
    }
  } catch { /* sem diálogo disponível */ }
  return 'later';
}

/**
 * Depois de um login manual bem-sucedido, oferece salvar o que foi observado.
 * Senhas digitadas em páginas de SSO (Microsoft) nunca são guardadas: lá vale a sessão salva.
 */
export async function offerToSave(startUrl, events, existing) {
  const own = events.filter(e => !SSO_HOSTS.test(e.url ?? ''));
  const withPw = own.filter(e => e.password?.value);
  const cred = withPw.filter(e => e.kind === 'click').pop() ?? withPw.pop() ?? null;
  const steps = [...new Set(own
    .filter(e => e.kind === 'click' && !e.password && e.text && e.text !== cred?.text)
    .map(e => e.text))];
  events.length = 0; // não manter senha em memória além do necessário

  const match = existing?.match ?? hostOf(startUrl);
  if (!match || (!cred && !steps.length)) return;

  const choice = await askToSave(match, !!cred, !!existing);
  const cfg = readConfig();
  if (choice === 'never') {
    if (!cfg.ignore.includes(match)) cfg.ignore.push(match);
    writeConfig(cfg);
    log(`portal ${match} marcado para ignorar`);
    return;
  }
  if (choice !== 'save') { log(`login em ${match} não foi salvo`); return; }

  const entry = { match, learned: true, steps };
  if (cred) {
    const host = hostOf(cred.url);
    Object.assign(entry, {
      host,
      secure: cred.url.startsWith('https:'),
      fields: { username: cred.username?.selector ?? null, password: cred.password.selector },
      submit: cred.kind === 'click' ? { selector: cred.selector, text: cred.text } : { enter: true },
    });
    saveCredentials(host, cred.username?.value ?? '', cred.password.value);
  }
  cfg.portals = cfg.portals.filter(p => p.match !== match).concat(entry);
  writeConfig(cfg);
  log(`portal ${match} salvo ${cred ? `(senha no ${VAULT})` : '(só passos)'}`);
}
