import test from 'node:test';
import assert from 'node:assert/strict';
import { AsanaReader, richComment } from '../server.mjs';
import { moveMentions, mentionQuery } from '../public/mentions.js';

test('mention markup escapes comment text and links only explicitly selected people', () => {
  const people = new Map([['20:30', { gid: '30', name: 'Alex Smith' }]]);
  const text = '  Hi @Alex Smith, A < B & C. @Nobody';
  const start = text.indexOf('@Alex');
  const mentions = [{ gid: '30', start, end: start + '@Alex Smith'.length }];
  assert.equal(richComment(text, mentions, people, '20'), '<body>  Hi <a data-asana-gid="30"></a>, A &lt; B &amp; C. @Nobody</body>');
  assert.throws(() => richComment(text, [{ ...mentions[0], gid: '40' }], people, '20'), /mention changed/);
  assert.throws(() => richComment(text, mentions, people, 'other'), /mention changed/);
  assert.throws(() => richComment(text, [mentions[0], mentions[0]], people, '20'), /mention changed/);
  assert.throws(() => richComment(text, [{ ...mentions[0], end: text.length + 1 }], people, '20'), /mention changed/);
});

test('editing shifts intact tags and removes tags whose names or boundaries changed', () => {
  const text = 'Hi @Alex Smith, thanks';
  const mention = { gid: '30', label: '@Alex Smith', start: 3, end: 14 };
  assert.equal(moveMentions(text, 'Hello @Alex Smith, thanks', [mention])[0].start, 6);
  assert.equal(moveMentions(text, 'Hi @Alec Smith, thanks', [mention]).length, 0);
  assert.equal(moveMentions(text, 'Hi @Alex Smithx, thanks', [mention]).length, 0);
  assert.equal(moveMentions(text, 'Hi x@Alex Smith, thanks', [mention]).length, 0);
  assert.equal(moveMentions(text, 'Hi , thanks', [mention]).length, 0);
  assert.deepEqual(moveMentions(text, text + '!', [mention]), [mention]);
});

test('picker recognizes partial names and excludes emails and already selected tags', () => {
  assert.deepEqual(mentionQuery('Hi @Alex Sm', 11, []), { start: 3, end: 11, query: 'Alex Sm' });
  assert.equal(mentionQuery('alex@example.com', 16, []), null);
  assert.equal(mentionQuery('Hi @Alex Smith ', 15, [{ start: 3, end: 14 }]), null);
  assert.deepEqual(mentionQuery('@', 1, []), { start: 0, end: 1, query: '' });
});

test('person selection uses Asana typeahead then posts followers before rich comment', async () => {
  const calls = []; const waits = [];
  const reader = new AsanaReader('test', async (url, options) => {
    calls.push({ path: url.pathname, options });
    if (url.pathname.endsWith('/typeahead')) {
      assert.equal(url.searchParams.get('resource_type'), 'user');
      assert.equal(url.searchParams.get('query'), 'Alex');
      return Response.json({ data: [{ gid: '30', name: 'Alex Smith' }] });
    }
    if (url.pathname.endsWith('/tasks/100')) return Response.json({ data: { assignee: { gid: '10' }, workspace: { gid: '20' } } });
    if (url.pathname.endsWith('/addFollowers')) {
      assert.deepEqual(JSON.parse(options.body).data, { followers: ['30'] });
      return Response.json({ data: {} });
    }
    if (url.pathname.endsWith('/stories')) {
      assert.deepEqual(JSON.parse(options.body).data, { html_text: '<body>Hello <a data-asana-gid="30"></a>!</body>' });
      return Response.json({ data: { gid: 'comment', text: 'Hello @Alex Smith!' } });
    }
    throw new Error('Unexpected request');
  }, async ms => waits.push(ms));
  assert.deepEqual(await reader.people('100', '10', '20', 'Alex'), [{ gid: '30', name: 'Alex Smith' }]);
  const result = await reader.comment('100', '10', '20', { text: 'Hello @Alex Smith!', mentions: [{ gid: '30', start: 6, end: 17 }] });
  assert.equal(result.gid, 'comment'); assert.deepEqual(waits, [3000]);
  assert.ok(calls.findIndex(c => c.path.endsWith('/addFollowers')) < calls.findIndex(c => c.path.endsWith('/stories')));
  const count = calls.filter(c => c.options.method === 'POST').length;
  await assert.rejects(reader.comment('100', '10', '20', { text: '@Unknown', mentions: [{ gid: '40', start: 0, end: 8 }] }), /mention changed/);
  assert.equal(calls.filter(c => c.options.method === 'POST').length, count);
});
