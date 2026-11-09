// Gerencia portais salvos e o modo aprendizado. Nunca mostra senhas.
//
//   node src/manage.mjs list               -> lista portais configurados, aprendidos e ignorados
//   node src/manage.mjs forget <portal>    -> esquece o portal (config.json + senha no cofre)
//   node src/manage.mjs learn on|off       -> liga/desliga o modo aprendizado
import { readConfig, writeConfig, USER_CONFIG } from './config.mjs';
import { deleteCredentials, getCredentials } from './credentials.mjs';

const [cmd, arg] = process.argv.slice(2);
const cfg = readConfig();

if (cmd === 'list' || !cmd) {
  console.log(`Configuração: ${USER_CONFIG}`);
  console.log(`Modo aprendizado: ${cfg.learn ? 'ligado' : 'desligado'}\n`);
  if (!cfg.portals.length) console.log('Nenhum portal salvo (o vigia age em qualquer portal com os botões comuns).');
  for (const p of cfg.portals) {
    const kind = !p.learned ? 'configurado' : p.fields ? 'aprendido, com login' : 'aprendido, só passos';
    const vault = p.host ? (getCredentials(p.host) ? `senha no cofre (${p.host})` : `SEM senha no cofre (${p.host})`) : '';
    const user = p.host ? getCredentials(p.host)?.username : '';
    console.log(`• ${p.match}  [${kind}]${user ? `  usuário: ${user}` : ''}${vault ? `  ${vault}` : ''}`);
    if (p.steps?.length) console.log(`    passos: ${p.steps.join(' → ')}`);
  }
  if (cfg.ignore.length) console.log(`\nIgnorados: ${cfg.ignore.join(', ')}`);
} else if (cmd === 'forget' && arg) {
  const portal = cfg.portals.find(p => p.match === arg || p.host === arg);
  const hosts = new Set([arg, portal?.host].filter(Boolean));
  const removedVault = [...hosts].some(h => deleteCredentials(h));
  const wasIgnored = cfg.ignore.includes(arg);
  cfg.portals = cfg.portals.filter(p => p !== portal);
  cfg.ignore = cfg.ignore.filter(h => h !== arg);
  writeConfig(cfg);
  console.log(portal || removedVault || wasIgnored
    ? `Portal ${arg} esquecido${removedVault ? ' (senha removida do cofre)' : ''}${wasIgnored ? ' (saiu da lista de ignorados)' : ''}.`
    : `Nada salvo para ${arg}.`);
} else if (cmd === 'learn' && (arg === 'on' || arg === 'off')) {
  cfg.learn = arg === 'on';
  writeConfig(cfg);
  console.log(`Modo aprendizado ${cfg.learn ? 'ligado' : 'desligado'}.`);
} else {
  console.log('Uso: node src/manage.mjs list | forget <portal> | learn on|off');
  process.exit(1);
}
