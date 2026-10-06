import test from 'node:test';
import assert from 'node:assert/strict';
import { linkParts, safeLink } from '../public/content.js';
import { handoffRecipient, AsanaReader, safeAttachmentUrl } from '../server.mjs';

test('hand-back prefers previous owner, then initial assigner, then creator and avoids self', () => {
  const task = { created_by: { gid: '50', name: 'Creator' }, assigned_by: { gid: '40', name: 'Assigner' } };
  const assigned = (day, gid, author = '40') => ({ resource_subtype: 'assigned', created_at: `2026-10-0${day}`, assignee: { gid }, created_by: { gid: author, name: 'Assigner' } });
  assert.equal(handoffRecipient(task, [assigned(1, '30'), assigned(2, '10')], '10').gid, '30');
  assert.equal(handoffRecipient(task, [assigned(1, '10')], '10').gid, '40');
  assert.equal(handoffRecipient(task, [], '10').gid, '40');
  assert.equal(handoffRecipient({ created_by: task.created_by }, [], '10').gid, '50');
  assert.equal(handoffRecipient(task, [assigned(1, '10', '10')], '10').gid, '50');
  assert.equal(handoffRecipient({ created_by: { gid: '10' } }, [], '10'), null);
});

test('URLs become safe links without eating punctuation or accepting script schemes', () => {
  const input = 'Read (https://example.com/a?q=1&x=2), then www.example.org. Also https://example.com/a(b).';
  const parts = linkParts(input);
  assert.equal(parts.map(p => p.text).join(''), input);
  assert.deepEqual(parts.filter(p => p.href).map(p => p.text), ['https://example.com/a?q=1&x=2', 'www.example.org', 'https://example.com/a(b)']);
  assert.equal(safeLink('javascript:alert(1)'), null);
  assert.equal(safeLink('data:text/html,<script>'), null);
  assert.equal(safeLink('https://user:password@example.com'), null);
  assert.equal(safeLink('mailto:test@example.com'), 'mailto:test@example.com');
  assert.equal(safeAttachmentUrl('http://example.com/file'), null);
});

test('attachment links are refreshed on demand and restricted to the assigned task', async () => {
  let parent = '100'; let owner = '10';
  const calls = [];
  const reader = new AsanaReader('test', async url => {
    calls.push(url.pathname);
    if (url.pathname.endsWith('/tasks/100')) return Response.json({ data: { assignee: { gid: owner }, workspace: { gid: '20' } } });
    return Response.json({ data: { parent: { gid: parent }, download_url: 'https://files.example.com/fresh-signed-url', view_url: 'https://example.com/view' } });
  });
  assert.equal(await reader.attachmentUrl('100', '200', '10', '20'), 'https://files.example.com/fresh-signed-url');
  assert.deepEqual(calls, ['/api/1.0/tasks/100', '/api/1.0/attachments/200']);
  parent = '999'; await assert.rejects(reader.attachmentUrl('100', '200', '10', '20'), /does not belong/);
  owner = '30'; const count = calls.length;
  await assert.rejects(reader.attachmentUrl('100', '200', '10', '20'), /not assigned/);
  assert.equal(calls.length, count + 1);
});

test('first-assignee fallback can actually reassign to the original assigner', async () => {
  let updated;
  const reader = new AsanaReader('test', async (url, options) => {
    if (options.method === 'PUT') { updated = JSON.parse(options.body).data; return Response.json({ data: {} }); }
    if (url.pathname.endsWith('/stories')) return Response.json({ data: [{ resource_subtype: 'assigned', created_at: '2026-10-01', assignee: { gid: '10' }, created_by: { gid: '40', name: 'Original assigner' } }], next_page: null });
    return Response.json({ data: { assignee: { gid: '10' }, workspace: { gid: '20' }, created_by: { gid: '50' } } });
  });
  await assert.rejects(reader.reassign('100', '10', '20', { assignee: '50' }), /has changed/);
  assert.equal(updated, undefined);
  const result = await reader.reassign('100', '10', '20', { assignee: '40' });
  assert.deepEqual(updated, { assignee: '40' }); assert.equal(result.assignee.reason, 'person who initially assigned this task');
});
