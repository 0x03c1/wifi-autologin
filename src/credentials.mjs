// Credenciais de portais guardadas no cofre do sistema operacional:
// Keychain (macOS), Gerenciador de Credenciais (Windows) ou Secret Service (Linux).
// Nada é gravado em arquivo e nenhum valor vai para o log.
import { Entry } from '@napi-rs/keyring';

const SERVICE = 'wifi-autologin';

/** @returns {{ username: string, password: string } | null} */
export function getCredentials(host) {
  try {
    const raw = new Entry(SERVICE, host).getPassword();
    if (!raw) return null;
    const { username, password } = JSON.parse(raw);
    return typeof password === 'string' ? { username: username ?? '', password } : null;
  } catch { return null; }
}

export function saveCredentials(host, username, password) {
  new Entry(SERVICE, host).setPassword(JSON.stringify({ username, password }));
}

export function deleteCredentials(host) {
  try { return new Entry(SERVICE, host).deletePassword(); } catch { return false; }
}
