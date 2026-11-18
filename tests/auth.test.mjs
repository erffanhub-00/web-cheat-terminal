// Auth tests: password check + signed session cookie (create / verify /
// tamper / expiry). Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  checkPassword,
  createSessionCookie,
  verifySessionCookie,
  clearSessionCookie,
  isDevPassword,
  DEV_PASSWORD,
} from '../src/auth.js';

const PASSWORD = 'secret123';

function base64url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signPayload(payload, password) {
  const key = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return base64url(new Uint8Array(sig));
}

test('checkPassword accepts the right password and rejects the wrong one', async () => {
  assert.equal(await checkPassword('secret123', PASSWORD), true);
  assert.equal(await checkPassword('nope', PASSWORD), false);
  assert.equal(await checkPassword('', PASSWORD), false);
});

test('no password configured means admin login is disabled', async () => {
  assert.equal(await checkPassword('admin123', null), false);
  assert.equal(await checkPassword('anything', undefined), false);
  assert.equal(await verifySessionCookie('admin_session=x.y.z', null), false);
});

test('dev password is flagged only when ADMIN_PASSWORD is the dev password', () => {
  assert.equal(isDevPassword({}), false);
  assert.equal(isDevPassword({ ADMIN_PASSWORD: 'x' }), false);
  assert.equal(isDevPassword({ ADMIN_PASSWORD: DEV_PASSWORD }), true);
  assert.equal(DEV_PASSWORD.length > 0, true);
});

test('session cookie round-trips and verifies', async () => {
  const setCookie = await createSessionCookie(PASSWORD, 'https://example.com/api/admin/login');
  assert.match(setCookie, /^admin_session=admin-session\.\d+\.[A-Za-z0-9_-]+; HttpOnly/);
  assert.match(setCookie, /Secure/); // https -> Secure flag
  const value = setCookie.split(';')[0].split('=')[1];
  assert.equal(await verifySessionCookie(`admin_session=${value}`, PASSWORD), true);
});

test('local (http) session cookie has no Secure flag', async () => {
  const setCookie = await createSessionCookie(PASSWORD, 'http://localhost:8787/api/admin/login');
  assert.doesNotMatch(setCookie, /Secure/);
  const value = setCookie.split(';')[0].split('=')[1];
  assert.equal(await verifySessionCookie(`admin_session=${value}`, PASSWORD), true);
});

test('tampered cookie is rejected', async () => {
  const setCookie = await createSessionCookie(PASSWORD, 'https://example.com/api/admin/login');
  const value = setCookie.split(';')[0].split('=')[1];
  const tampered = value.slice(0, -2) + 'AA';
  assert.equal(await verifySessionCookie(`admin_session=${tampered}`, PASSWORD), false);
});

test('cookie signed with another password is rejected', async () => {
  const setCookie = await createSessionCookie('other-password', 'https://example.com/api/admin/login');
  const value = setCookie.split(';')[0].split('=')[1];
  assert.equal(await verifySessionCookie(`admin_session=${value}`, PASSWORD), false);
});

test('expired cookie is rejected', async () => {
  const past = Math.floor(Date.now() / 1000) - 60;
  const payload = `admin-session.${past}`;
  const signature = await signPayload(payload, PASSWORD);
  assert.equal(await verifySessionCookie(`admin_session=${payload}.${signature}`, PASSWORD), false);
});

test('clearSessionCookie expires the cookie', () => {
  assert.match(clearSessionCookie(), /Max-Age=0/);
  assert.match(clearSessionCookie(), /HttpOnly/);
});
