import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCredentials } from './validation.mjs';

const input = {
  supabaseUrl: 'https://buyerproject.supabase.co',
  publishableKey: 'sb_publishable_example_value',
  secretKey: 'sb_secret_example_value',
  databaseUrl: 'postgresql://postgres:password@db.buyerproject.supabase.co/postgres?sslmode=require',
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name === 'content-type' ? 'application/json' : null },
    json: async () => body,
  };
}

test('publishable key is verified through the public Auth settings endpoint', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return jsonResponse({});
  };

  await validateCredentials(input, { fetchImpl });

  assert.equal(requests[0].url, 'https://buyerproject.supabase.co/auth/v1/settings');
  assert.equal(requests[0].options.headers.apikey, input.publishableKey);
  assert.equal(requests[1].url, 'https://buyerproject.supabase.co/rest/v1/');
  assert.equal(requests[1].options.headers.apikey, input.secretKey);
});

test('credential rejection includes a safe Supabase reason without exposing the key', async () => {
  const fetchImpl = async () => jsonResponse({ message: 'Invalid API key' }, 401);

  await assert.rejects(
    validateCredentials(input, { fetchImpl }),
    (error) => {
      assert.match(error.message, /HTTP 401/);
      assert.match(error.message, /Invalid API key/);
      assert.doesNotMatch(error.message, /sb_publishable_example_value/);
      return true;
    },
  );
});
