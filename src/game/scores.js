// Local score storage as AES-GCM encrypted JSON (Web Crypto).
//
// The key is derived from a constant baked into the page, so this deters casual editing and
// makes tampering detectable (a modified blob fails to decrypt), but it is not a secret.
// A real, cheat-resistant leaderboard needs a server.

const STORAGE_KEY = 'dash.scores';
const APP_SECRET = 'umer-khan-portfolio:dash:v1';
const MAX_RUNS = 5;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromB64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

const emptyScores = () => ({ best: 0, runs: [] });

let cachedKey = null; // { salt (base64), key }

async function deriveKey(salt) {
  const saltB64 = toB64(salt);
  if (cachedKey?.salt === saltB64) return cachedKey.key;
  const base = await crypto.subtle.importKey('raw', encoder.encode(APP_SECRET), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  cachedKey = { salt: saltB64, key };
  return key;
}

function sanitize(data) {
  const n = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const runs = Array.isArray(data?.runs)
    ? data.runs
        .map((r) => ({ score: n(r?.score), at: typeof r?.at === 'string' ? r.at : '' }))
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_RUNS)
    : [];
  return { best: Math.max(n(data?.best), runs[0]?.score ?? 0), runs };
}

const cryptoAvailable = () => Boolean(globalThis.crypto?.subtle);

export async function loadScores() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || !cryptoAvailable()) return emptyScores();
    const envelope = JSON.parse(raw);
    const key = await deriveKey(fromB64(envelope.salt));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(envelope.iv) }, key, fromB64(envelope.data));
    return sanitize(JSON.parse(decoder.decode(plain)));
  } catch {
    // Missing, corrupted or tampered with: start fresh rather than trust it.
    return emptyScores();
  }
}

export async function saveScores(scores) {
  if (!cryptoAvailable()) return;
  try {
    let salt;
    try {
      salt = fromB64(JSON.parse(localStorage.getItem(STORAGE_KEY))?.salt ?? '');
    } catch {
      salt = null;
    }
    if (!salt || salt.length !== 16) salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(salt);
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(sanitize(scores))));
    const envelope = { v: 1, alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // Storage blocked (private mode, quota): scores just won't persist.
  }
}

// Only called when the player chooses to save a run.
export function recordRun(scores, score) {
  const runs = [...scores.runs, { score, at: new Date().toISOString() }];
  return sanitize({ best: Math.max(scores.best, score), runs });
}
