import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';

const WORKER_URL = 'https://bcmwriter.example.workers.dev';
const ALLOWED_ORIGIN = 'https://bigcatmellow.github.io';

function mockEnvironment() {
  const records = new Map();
  return {
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    FRONTEND_URL: 'https://bigcatmellow.github.io/BCMWriter',
    SESSIONS: {
      async get(key) { return records.get(key) ?? null; },
      async put(key, value) { records.set(key, value); },
      async delete(key) { records.delete(key); }
    }
  };
}

test('cross-origin callers cannot use the session token endpoint', async () => {
  const res = await worker.fetch(new Request(`${WORKER_URL}/auth/token`, {
    method: 'POST',
    headers: {
      Origin: 'https://untrusted.example',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ session_id: 'a'.repeat(64) })
  }), mockEnvironment(), {});

  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'origin_not_allowed');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
});

test('health endpoint does not disclose deployment configuration', async () => {
  const res = await worker.fetch(new Request(`${WORKER_URL}/health`), mockEnvironment(), {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('internal errors do not expose secrets or stack traces to clients', async () => {
  const env = mockEnvironment();
  env.SESSIONS.get = async () => { throw new Error('private-only-error-detail'); };
  const res = await worker.fetch(new Request(`${WORKER_URL}/auth/token`, {
    method: 'POST',
    headers: { Origin: ALLOWED_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: 'a'.repeat(64) })
  }), env, {});

  assert.equal(res.status, 500);
  const text = await res.text();
  assert.equal(JSON.parse(text).error, 'internal_error');
  assert.doesNotMatch(text, /private-only-error-detail|stack/i);
});

test('OAuth start requires state, and the callback consumes valid state', async () => {
  const env = mockEnvironment();
  const noState = await worker.fetch(new Request(`${WORKER_URL}/auth/start`), env, {});
  assert.equal(noState.status, 400);

  const state = '123e4567-e89b-42d3-a456-426614174000';
  const start = await worker.fetch(new Request(`${WORKER_URL}/auth/start?state=${state}`), env, {});
  assert.equal(start.status, 302);
  assert.ok(await env.SESSIONS.get(`state:${state}`));

  // Fail after state validation but before the Google network call.
  env.GOOGLE_CLIENT_SECRET = null;
  const callbackUrl = `${WORKER_URL}/auth/callback?code=unused-code&state=${state}`;
  const first = await worker.fetch(new Request(callbackUrl), env, {});
  assert.equal(new URL(first.headers.get('Location')).searchParams.get('error'), 'missing_client_secret');
  assert.equal(await env.SESSIONS.get(`state:${state}`), null);

  const replay = await worker.fetch(new Request(callbackUrl), env, {});
  assert.equal(new URL(replay.headers.get('Location')).searchParams.get('error'), 'invalid_state');
});

test('untrusted Drive/OAuth status messages are rendered as text', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /status\.textContent = String\(message\)/);
  assert.doesNotMatch(html, /getElementById\('driveStatus'\)\.innerHTML\s*=\s*message/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
});
