import { guessByPrefix, isLocalBaseUrl, type ProviderId } from './providers';

/** Accept a pasted Authorization header or quoted key, but never a multi-line command. */
export function normalizeApiKey(input: string): string {
  let key = input.trim();
  key = key.replace(/^authorization\s*:\s*/i, '').replace(/^bearer\s+/i, '').trim();
  if (key.length >= 2 && ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'")))) key = key.slice(1, -1).trim();
  key = key.replace(/^bearer\s+/i, '').trim();
  return key;
}

export function credentialProblem(key: string, mode: string): string | null {
  if (!key) return null;
  if (/\s/.test(key) || /[\x00-\x1f\x7f]/.test(key)) return 'The API key contains whitespace or a line break. Paste just the key, not a command or example.';
  const known = guessByPrefix(key);
  if (mode === 'nvidia' && known && known !== 'nvidia') return 'That key looks like it belongs to a different provider, not NVIDIA NIM. Paste your NVIDIA API catalog key or select the correct provider.';
  return null;
}

/** Do not silently send a previously stored secret to a different provider or server. */
export function canReuseKey(savedProvider: string | null, savedBase: string | null, mode: string, base: string): boolean {
  if (!savedProvider || isLocalBaseUrl(base)) return false;
  const oldBase = (savedBase ?? '').trim().replace(/\/+$/, '');
  const nextBase = base.trim().replace(/\/+$/, '');
  if (oldBase !== nextBase) return false;
  return mode === 'auto' || mode === savedProvider || (mode === 'custom' && savedProvider === 'custom');
}

export function authFailure(provider: ProviderId, status: number): string {
  if (provider === 'nvidia') {
    if (status === 401) return 'NVIDIA NIM could not authenticate the API key. In Settings → AI Provider, select NVIDIA NIM, clear any unintended Base URL override, and paste a valid NVIDIA API catalog key (usually starts with nvapi-). If it still fails, generate a new key in NVIDIA and check that it has access. Do not paste your key into chat.';
    return 'NVIDIA NIM denied access (403). Check the key’s permissions and access to the selected model in NVIDIA. Do not paste your key into chat.';
  }
  return status === 401 ? 'The provider rejected the API key. Check it in Settings.' : 'The provider denied access. Check the key and model permissions in Settings.';
}
