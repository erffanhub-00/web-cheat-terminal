// Admin auth: password login + signed HttpOnly session cookie.
//
// The password comes ONLY from the Worker secret ADMIN_PASSWORD. When it is
// not set, admin login is disabled entirely — there is no fallback password
// on the live site, so a deployed Worker without the secret cannot be logged
// into at all. For local testing, put ADMIN_PASSWORD=admin123 in .dev.vars
// (gitignored, never committed); the admin UI shows a warning banner while
// that well-known dev password is in use, and /api/admin/me reports
// devPassword: true. Never commit a real password.
//
// The session cookie is HMAC-signed with the password itself as the key, so
// changing the password invalidates every existing session. All comparisons
// are timing-safe (SHA-256 + constant-time byte compare).

const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days
export const DEV_PASSWORD = 'admin123';

export function adminPassword(env) {
  return env.ADMIN_PASSWORD || null;
}

export function isDevPassword(env) {
  return env.ADMIN_PASSWORD === DEV_PASSWORD;
}

const encoder = new TextEncoder();

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function timingSafeEqual(a, b) {
  const hashA = await sha256Hex(a);
  const hashB = await sha256Hex(b);
  if (hashA.length !== hashB.length) return false;
  let diff = 0;
  for (let i = 0; i < hashA.length; i++) diff |= hashA.charCodeAt(i) ^ hashB.charCodeAt(i);
  return diff === 0;
}

export async function checkPassword(input, password) {
  if (typeof input !== 'string' || input.length === 0) return false;
  if (!password) return false; // no password configured -> admin disabled
  return timingSafeEqual(input, password);
}

function toBase64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function sign(payload, password) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

export async function createSessionCookie(password, requestUrl) {
  const expiry = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = `admin-session.${expiry}`;
  const signature = await sign(payload, password);
  const value = `${payload}.${signature}`;
  const secure = new URL(requestUrl).protocol === 'https:' ? '; Secure' : '';
  return `admin_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}${secure}`;
}

export function clearSessionCookie() {
  return 'admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
}

export async function verifySessionCookie(cookieHeader, password) {
  if (!cookieHeader || !password) return false;
  const match = cookieHeader.match(/(?:^|;\s*)admin_session=([^;]+)/);
  if (!match) return false;
  const parts = match[1].split('.');
  if (parts.length !== 3 || parts[0] !== 'admin-session') return false;
  const expiry = Number(parts[1]);
  if (!Number.isInteger(expiry) || expiry * 1000 < Date.now()) return false;
  const expected = await sign(`${parts[0]}.${parts[1]}`, password);
  const a = fromBase64Url(expected);
  const b = fromBase64Url(parts[2]);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
