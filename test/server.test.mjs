import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { AsanaReader, createApp, previousAssignee, appendDescription, descriptionVersion, MAX_FILE_SIZE } from '../server.mjs';

const response = data => new Response(JSON.stringify(data), { status: 200 });
const profile = { gid: '10', name: 'Contractor', workspaces: [{ gid: '20', name: 'Work' }] };
const credentialStore = { supported: false, exists: async () => false, forget: async () => {} };

test('assigned task query follows pagination, removes completed tasks and sorts due dates', async () => {
  const calls = [];
  const reader = new AsanaReader('test-token', async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(url.origin, 'https://app.asana.com');
    assert.equal(url.searchParams.get('assignee'), '10');
    assert.equal(url.searchParams.get('workspace'), '20');
    assert.equal(url.searchParams.get('completed_since'), 'now');
    if (!url.searchParams.has('offset')) return response({
      data: [{ gid: '1', name: 'Undated', completed: false }, { gid: '2', name: 'Later', completed: false, due_on: '2026-10-09' }],
      next_page: { offset: 'next', uri: 'https://untrusted.invalid' },
    });
    assert.equal(url.searchParams.get('offset'), 'next');
    return response({ data: [{ gid: '3', name: 'Earlier', completed: false, due_on: '2026-10-06' }, { gid: '4', name: 'Finished', completed: true }], next_page: null });
  });
  assert.deepEqual((await reader.tasks('20', '10')).map(t => t.gid), ['3', '2', '1']);
  assert.equal(calls.length, 2);
});

test('description additions preserve existing rich text and escape new markup', () => {
  const task = { notes: 'Existing', html_notes: '<body><strong>Existing</strong></body>' };
  assert.equal(appendDescription(task, 'A < B & C'), '<body><strong>Existing</strong>\n\nA &lt; B &amp; C</body>');
  assert.equal(appendDescription({ notes: '' }, 'New'), '<body>New</body>');
  assert.throws(() => appendDescription({ html_notes: 'malformed' }, 'New'), /preserve/);
});

test('previous assignee uses structured assignment history, never the assigner or comment text', () => {
  const event = (day, gid) => ({ created_at: `2026-10-0${day}T12:00:00Z`, resource_subtype: 'assigned', assignee: gid ? { gid, name: gid } : undefined, created_by: { gid: 'assigner' } });
  assert.equal(previousAssignee([event(2, '10'), event(1, '30')], '10').gid, '30');
  assert.equal(previousAssignee([event(2, '10')], '10'), null);
  assert.equal(previousAssignee([event(1, null), event(2, '10')], '10'), null);
  assert.equal(previousAssignee([event(1, '10'), event(2, '10')], '10'), null);
  assert.equal(previousAssignee([event(1, '30'), event(2, '40')], '10'), null);
  assert.equal(previousAssignee([{ resource_subtype: 'comment_added', text: 'assigned to Someone' }], '10'), null);
});

test('all four actions save to the correct Asana endpoints with ownership and conflict checks', async t => {
  let task = { gid: '100', name: 'Assigned task', notes: 'Original', html_notes: '<body><strong>Original</strong></body>', assignee: { gid: '10' }, workspace: { gid: '20' } };
  let history = [
    { gid: '1', resource_subtype: 'assigned', created_at: '2026-10-01T12:00:00Z', assignee: { gid: '30', name: 'Previous owner' } },
    { gid: '2', resource_subtype: 'assigned', created_at: '2026-10-02T12:00:00Z', assignee: { gid: '10', name: 'Contractor' }, created_by: { gid: '40', name: 'Different assigner' } },
  ];
  const writes = [];
  const server = createApp({ credentialStore, fetchImpl: async (url, options) => {
    if (options.method === 'GET') {
      if (url.pathname.endsWith('/users/me')) return response({ data: profile });
      if (url.pathname.endsWith('/tasks/100')) return response({ data: task });
      if (url.pathname.endsWith('/tasks/100/stories')) return response({ data: history, next_page: null });
      if (url.pathname.endsWith('/attachments')) return response({ data: [], next_page: null });
    }
    writes.push({ url, options });
    if (url.pathname.endsWith('/attachments')) {
      assert.ok(options.body instanceof FormData);
      assert.equal(options.body.get('parent'), '100');
      assert.equal(options.body.get('file').name, 'r%C3%A9sum%C3%A9.txt');
      assert.equal(await options.body.get('file').text(), 'file contents');
      assert.equal(options.headers['Content-Type'], undefined);
      return response({ data: { gid: 'attachment', name: 'résumé.txt' } });
    }
    const { data } = JSON.parse(options.body);
    if (url.pathname.endsWith('/stories')) {
      assert.equal(options.method, 'POST'); assert.equal(data.text, 'My comment');
      const comment = { gid: '3', resource_subtype: 'comment_added', text: data.text, created_by: { name: 'Contractor' } };
      history.push(comment); return response({ data: comment });
    }
    assert.equal(options.method, 'PUT');
    if (data.html_notes) {
      assert.deepEqual(Object.keys(data), ['html_notes']);
      assert.equal(data.html_notes, '<body><strong>Original</strong>\n\nMore &amp; &lt;text&gt;</body>');
      task = { ...task, html_notes: data.html_notes, notes: 'Original\n\nMore & <text>' };
    } else {
      assert.deepEqual(data, { assignee: '30' }); task = { ...task, assignee: { gid: '30' } };
    }
    return response({ data: task });
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'X-BeauSana': 'local', 'Content-Type': 'application/json' };
  const connected = await fetch(base + '/api/connect', { method: 'POST', headers, body: JSON.stringify({ token: 'test-token' }) });
  headers.Cookie = connected.headers.get('set-cookie').split(';')[0];
  const post = (kind, body) => fetch(`${base}/api/tasks/100/${kind}?workspace=20`, { method: 'POST', headers, body: JSON.stringify(body) });
  const detail = (await (await fetch(base + '/api/tasks/100?workspace=20', { headers })).json()).task;
  assert.equal(detail.previousAssignee.gid, '30');
  assert.equal(detail.html_notes, undefined);
  assert.equal((await post('description', { text: 'More', descriptionVersion: 'stale' })).status, 409);
  assert.equal(writes.length, 0);
  const saved = await post('description', { text: 'More & <text>', descriptionVersion: detail.descriptionVersion });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).result.descriptionVersion, descriptionVersion(task));
  assert.equal((await post('comments', { text: ' ' })).status, 400);
  assert.equal((await post('comments', { text: 'My comment' })).status, 200);
  const fileHeaders = { ...headers, 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('résumé.txt') };
  const upload = body => fetch(`${base}/api/tasks/100/file?workspace=20`, { method: 'POST', headers: fileHeaders, body });
  assert.equal((await upload('')).status, 400);
  assert.equal((await upload('file contents')).status, 200);
  assert.equal((await post('reassign', { assignee: '40' })).status, 409);
  assert.equal((await post('reassign', { assignee: '30' })).status, 200);
  const writesBefore = writes.length;
  assert.equal((await post('comments', { text: 'After reassignment' })).status, 403);
  assert.equal((await post('description', { text: 'More', descriptionVersion: descriptionVersion(task) })).status, 403);
  assert.equal((await upload('file contents')).status, 403);
  assert.equal(writes.length, writesBefore);
  assert.equal(MAX_FILE_SIZE, 25 * 1024 * 1024);
});

test('detail refuses tasks assigned to someone else or in another workspace', async () => {
  const reader = new AsanaReader('test', async () => response({ data: { assignee: { gid: 'other' }, workspace: { gid: '20' } } }));
  await assert.rejects(reader.task('1', '10', '20'), { status: 403 });
  const wrongWorkspace = new AsanaReader('test', async () => response({ data: { assignee: { gid: '10' }, workspace: { gid: 'other' } } }));
  await assert.rejects(wrongWorkspace.task('1', '10', '20'), { status: 403 });
});

test('Asana errors do not expose remote error bodies or tokens', async () => {
  for (const code of [401, 403, 404, 429, 500]) {
    const reader = new AsanaReader('secret-test-token', async () => new Response('private upstream details', { status: code }));
    await assert.rejects(reader.profile(), err => {
      assert.doesNotMatch(err.message, /private|secret-test-token/);
      assert.ok(err.message.length > 10); return true;
    });
  }
  const offline = new AsanaReader('test', async () => { throw new Error('private network details'); });
  await assert.rejects(offline.profile(), /Check your internet connection/);
});

test('repeated page offsets stop with an error instead of looping forever', async () => {
  const reader = new AsanaReader('test', async () => response({ data: [], next_page: { offset: 'same' } }));
  await assert.rejects(reader.tasks('20', '10'), /could not finish loading/);
});

test('local HTTP session, host/origin checks, workspace boundary and disconnect', async t => {
  const server = createApp({ credentialStore, fetchImpl: async url => {
    if (url.pathname.endsWith('/users/me')) return response({ data: profile });
    if (url.pathname.endsWith('/tasks')) return response({ data: [{ gid: '100', name: 'Assigned task', completed: false }], next_page: null });
    if (url.pathname.endsWith('/tasks/100')) return response({ data: { gid: '100', name: 'Assigned task', assignee: { gid: '10' }, workspace: { gid: '20' }, notes: '<script>untrusted text</script>' } });
    if (url.pathname.endsWith('/attachments/200')) return response({ data: { parent: { gid: '100' }, download_url: 'https://files.example.com/fresh' } });
    if (url.pathname.endsWith('/attachments/201')) return response({ data: { parent: { gid: '999' }, download_url: 'https://files.example.com/other' } });
    throw new Error('Unexpected request');
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'X-BeauSana': 'local', 'Content-Type': 'application/json' };
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(base + '/api/session', { headers })).status, 401);
  assert.equal((await fetch(base + '/api/connect', { method: 'POST', body: '{}'})).status, 403);
  assert.equal((await fetch(base + '/api/connect', { method: 'POST', headers: { ...headers, Origin: 'https://evil.invalid' }, body: '{}'})).status, 403);
  const wrongHostStatus = await new Promise((resolve, reject) => {
    const request = http.get(base, { headers: { Host: 'evil.invalid' } }, response => {
      response.resume(); resolve(response.statusCode);
    });
    request.on('error', reject);
  });
  assert.equal(wrongHostStatus, 403);
  assert.equal((await fetch(base + '/api/connect', { method: 'POST', headers, body: '{invalid'})).status, 400);
  const connected = await fetch(base + '/api/connect', { method: 'POST', headers, body: JSON.stringify({ token: 'test-token' }) });
  assert.equal(connected.status, 200);
  const payload = await connected.json(); assert.deepEqual(payload.profile, profile);
  assert.doesNotMatch(JSON.stringify(payload), /test-token/);
  const setCookie = connected.headers.get('set-cookie'); assert.match(setCookie, /HttpOnly; SameSite=Strict/);
  headers.Cookie = setCookie.split(';')[0];
  const download = base + '/api/tasks/100/attachments/200/download?workspace=20';
  assert.equal((await fetch(download, { redirect: 'manual' })).status, 401);
  const downloaded = await fetch(download, { headers: { Cookie: headers.Cookie }, redirect: 'manual' });
  assert.equal(downloaded.status, 302);
  assert.equal(downloaded.headers.get('location'), 'https://files.example.com/fresh');
  assert.equal((await fetch(download, { headers: { Cookie: headers.Cookie, Origin: 'https://evil.invalid' }, redirect: 'manual' })).status, 403);
  assert.equal((await fetch(download.replace('workspace=20', 'workspace=other'), { headers: { Cookie: headers.Cookie }, redirect: 'manual' })).status, 400);
  assert.equal((await fetch(download.replace('/200/', '/201/'), { headers: { Cookie: headers.Cookie }, redirect: 'manual' })).status, 403);
  assert.equal((await fetch(base + '/api/session', { headers })).status, 200);
  assert.equal((await fetch(base + '/api/tasks?workspace=other', { headers })).status, 400);
  const tasks = await fetch(base + '/api/tasks?workspace=20', { headers });
  assert.equal((await tasks.json()).tasks[0].gid, '100');
  const detail = await fetch(base + '/api/tasks/100?workspace=20', { headers });
  assert.equal((await detail.json()).task.notes, '<script>untrusted text</script>');
  assert.equal((await fetch(base + '/api/tasks/100?workspace=20', { method: 'POST', headers, body: '{}' })).status, 405);
  assert.equal((await fetch(base + '/api/disconnect', { method: 'POST', headers, body: '{}' })).status, 200);
  assert.equal((await fetch(base + '/api/session', { headers })).status, 401);
});
