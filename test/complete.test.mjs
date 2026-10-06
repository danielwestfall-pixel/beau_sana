import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.mjs';

test('completion route updates only completed, enforces ownership and requires confirmation', async t => {
  let owner = '10'; let confirmed = true; const writes = [];
  const server = createApp({ credentialStore: { supported: false, exists: async () => false, forget: async () => {} }, fetchImpl: async (url, options) => {
    if (url.pathname.endsWith('/users/me')) return Response.json({ data: { gid: '10', workspaces: [{ gid: '20' }] } });
    if (options.method === 'GET') return Response.json({ data: { assignee: { gid: owner }, workspace: { gid: '20' } } });
    writes.push(JSON.parse(options.body).data);
    assert.equal(options.method, 'PUT'); assert.equal(url.pathname, '/api/1.0/tasks/100');
    assert.equal(url.searchParams.get('opt_fields'), 'completed');
    return Response.json({ data: { completed: confirmed } });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'X-BeauSana': 'local', 'Content-Type': 'application/json' };
  const connected = await fetch(base + '/api/connect', { method: 'POST', headers, body: JSON.stringify({ token: 'fictional' }) });
  headers.Cookie = connected.headers.get('set-cookie').split(';')[0];
  const complete = () => fetch(base + '/api/tasks/100/complete?workspace=20', { method: 'POST', headers, body: '{}' });
  assert.equal((await complete()).status, 200); assert.deepEqual(writes, [{ completed: true }]);
  owner = '30'; assert.equal((await complete()).status, 403); assert.equal(writes.length, 1);
  owner = '10'; confirmed = false;
  const unconfirmed = await complete(); assert.equal(unconfirmed.status, 502);
  assert.match((await unconfirmed.json()).error, /Check the task in Asana/);
});
