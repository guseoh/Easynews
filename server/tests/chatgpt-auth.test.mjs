import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'node:http';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createChatGPT } from '@siwc/local';
import { authorize } from '../../vendor/siwc-local/dist/oauth.js';
import { ConnectionStore } from '../../vendor/siwc-local/dist/storage.js';
import { createWindowsCredentialEncryption } from '../dist/credential-encryption.js';

const issuer = 'https://auth.openai.com', resource = 'https://api.openai.com/v1', clientId = 'oaiapp_easynews_test';
const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const keypair = await generateKeyPair('RS256');
const publicKey = await exportJWK(keypair.publicKey); Object.assign(publicKey, { kid: 'test-key', alg: 'RS256', use: 'sig' });
async function identity(nonce, subject = 'test-subject') {
  return new SignJWT({ sub: subject, nonce }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer).setAudience(clientId).setIssuedAt().setExpirationTime('1h').sign(keypair.privateKey);
}
function visit(url, host) {
  return new Promise((resolve, reject) => { get(url, { ...(host ? { headers: { Host: host } } : {}) }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject); });
}
function cleanup(t, directory) {
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  });
}
function testEncryption() {
  const key = randomBytes(32);
  return { id: 'synthetic-test-only', isAvailable: () => true,
    encrypt(text) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]); },
    decrypt(value) { const bytes = Buffer.from(value), cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'); } };
}

test('official OAuth validates fresh PKCE/state, callback Host/path, issued client ID, nonce and granted scopes', async (t) => {
  let authorization, responseScopes = scopes, wrongNonce = false, tokenCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === issuer + '/.well-known/openid-configuration') return Response.json({ issuer, authorization_endpoint: issuer + '/api/accounts/authorize', token_endpoint: issuer + '/api/accounts/oauth/token', jwks_uri: issuer + '/test-jwks', revocation_endpoint: issuer + '/test-revoke' });
    if (url === issuer + '/test-jwks') return Response.json({ keys: [publicKey] });
    if (url === issuer + '/api/accounts/oauth/token') {
      tokenCalls++;
      assert.equal(options.body.get('client_id'), clientId);
      assert.equal(options.body.get('resource'), resource);
      assert.equal(options.body.get('redirect_uri'), authorization.searchParams.get('redirect_uri'));
      assert.equal(createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'), authorization.searchParams.get('code_challenge'));
      return Response.json({ id_token: await identity(wrongNonce ? 'incorrect' : authorization.searchParams.get('nonce')), access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', token_type: 'Bearer', expires_in: 3600, scope: responseScopes });
    }
    throw new Error('External request forbidden in test');
  });
  const attempts = [];
  const config = { appName: 'Easynews', appId: 'easynews', redirectPort: 0, sendHostId: true, credentialEncryption: testEncryption(),
    openBrowser: async (url) => {
      authorization = new URL(url); attempts.push(authorization);
      assert.equal(authorization.searchParams.get('client_id'), 'dynamic_agent_client');
      assert.equal(authorization.searchParams.get('agent_name_hint'), 'Easynews');
      assert.equal(authorization.searchParams.get('ext_agent_host_id'), 'urn:uuid:00000000-0000-4000-8000-000000000000');
      assert.equal(authorization.searchParams.get('scope'), scopes);
      const callback = new URL(authorization.searchParams.get('redirect_uri'));
      assert.equal(callback.hostname, '127.0.0.1');
      const wrongPath = new URL(callback); wrongPath.pathname = '/callback';
      assert.equal(await visit(wrongPath), 404);
      assert.equal(await visit(callback, 'localhost:' + callback.port), 404);
      callback.searchParams.set('state', 'unrelated');
      assert.equal(await visit(callback), 400);
      assert.equal(tokenCalls, attempts.length - 1);
      callback.searchParams.set('state', authorization.searchParams.get('state'));
      callback.searchParams.set('code', 'synthetic-code'); callback.searchParams.set('client_id', clientId);
      assert.equal(await visit(callback), 200);
    } };
  const host = 'urn:uuid:00000000-0000-4000-8000-000000000000';
  const first = await authorize(config, undefined, host, AbortSignal.timeout(10_000));
  assert.equal(first.clientId, clientId); assert.ok(first.scopes.includes('chatgpt.tokens.use.direct'));
  responseScopes = 'openid profile email';
  const limited = await authorize(config, undefined, host, AbortSignal.timeout(10_000));
  assert.equal(limited.scopes.includes('chatgpt.tokens.use.direct'), false);
  assert.notEqual(attempts[0].searchParams.get('state'), attempts[1].searchParams.get('state'));
  assert.notEqual(attempts[0].searchParams.get('nonce'), attempts[1].searchParams.get('nonce'));
  assert.notEqual(attempts[0].searchParams.get('code_challenge'), attempts[1].searchParams.get('code_challenge'));
  wrongNonce = true;
  await assert.rejects(authorize(config, undefined, host, AbortSignal.timeout(10_000)), { code: 'invalid_id_token' });
  const countBeforeMismatch = tokenCalls;
  const mismatched = { ...config, openBrowser: async (url) => {
    const auth = new URL(url), callback = new URL(auth.searchParams.get('redirect_uri'));
    assert.equal(auth.searchParams.get('client_id'), clientId);
    assert.equal(auth.searchParams.has('agent_name_hint'), false);
    callback.searchParams.set('state', auth.searchParams.get('state'));
    callback.searchParams.set('code', 'synthetic-code'); callback.searchParams.set('client_id', 'different_client');
    await visit(callback);
  } };
  await assert.rejects(authorize(mismatched, first, host, AbortSignal.timeout(10_000)), { code: 'registration_incomplete' });
  assert.equal(tokenCalls, countBeforeMismatch);
});

test('SDK serializes simultaneous refresh and uses only rotated credentials', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'easynews-refresh-')); cleanup(t, directory);
  const encryption = testEncryption(), store = new ConnectionStore(directory, encryption);
  await store.withLock(() => store.write({ version: 2, activeProfileId: 'profile', pendingRegistrations: [], profiles: [{ version: 1, id: 'profile', label: 'Test', clientId, subject: 'test-subject', status: 'connected', scopes: scopes.split(' '), savedAt: new Date().toISOString(), credentials: { accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: Date.now() - 1000 } }] }));
  let refreshes = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === issuer + '/.well-known/openid-configuration') return Response.json({ issuer, authorization_endpoint: issuer + '/api/accounts/authorize', token_endpoint: issuer + '/api/accounts/oauth/token', jwks_uri: issuer + '/test-jwks', revocation_endpoint: issuer + '/test-revoke' });
    if (url === issuer + '/test-jwks') return Response.json({ keys: [publicKey] });
    if (url === issuer + '/api/accounts/oauth/token') {
      refreshes++; assert.equal(options.body.get('refresh_token'), 'old-refresh'); assert.equal(options.body.get('scope'), null);
      return Response.json({ id_token: await identity(undefined), access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 3600, scope: scopes });
    }
    if (url === 'https://api.openai.com/v1/models') {
      assert.equal(options.headers.authorization, 'Bearer new-access');
      return Response.json({ models: [{ slug: 'available-luna', display_name: 'Luna', visibility: 'list' }] });
    }
    throw new Error('External request forbidden');
  });
  const sdk = createChatGPT({ appName: 'Easynews', appId: 'easynews', redirectPort: 0, sendHostId: true, storageDir: directory, credentialEncryption: encryption });
  await Promise.all([sdk.listModels(), sdk.listModels()]); assert.equal(refreshes, 1);
  const saved = await store.withLock(() => store.read());
  assert.equal(saved.profiles[0].credentials.refreshToken, 'new-refresh');
});

test('actual Windows DPAPI protects synthetic credentials across processes and rejects corruption', { skip: process.platform !== 'win32' }, async () => {
  const encryption = createWindowsCredentialEncryption();
  assert.equal(await encryption.isAvailable(), true);
  const text = 'synthetic access/refresh/ID credentials';
  const encrypted = await encryption.encrypt(text);
  const run = promisify(execFile);
  const source = `import {createWindowsCredentialEncryption} from ${JSON.stringify(new URL('../dist/credential-encryption.js', import.meta.url).href)}; const e=createWindowsCredentialEncryption(); const text=await e.decrypt(Buffer.from(process.argv[1],'base64')); if(text!==${JSON.stringify(text)})process.exit(1); console.log('cross-process DPAPI passed');`;
  const result = await run(process.execPath, ['--input-type=module', '-e', source, encrypted.toString('base64')], { windowsHide: true });
  assert.match(result.stdout, /passed/);
  const damaged = Buffer.from(encrypted); damaged[damaged.length - 1] ^= 0xff;
  await assert.rejects(encryption.decrypt(damaged));
});
