import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DownloadStore, downloadName, DOWNLOAD_LIMIT } from '../downloads.mjs';
test('download filenames are safe Windows names',()=>{
  assert.equal(downloadName('CON.txt'),'_CON.txt');assert(!downloadName('../../bad|name.exe').includes('/'));assert.equal(downloadName('audit.txt... '),'audit.txt');
});
test('downloads save actual bytes and reveal only a file owned by the same session',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'beau-download-'));t.after(()=>rm(dir,{recursive:true,force:true}));const shown=[];
  const store=new DownloadStore({directory:dir,lookupImpl:async()=>[{address:'93.184.215.14',family:4}],fetchImpl:async()=>new Response('audit contents'),platform:'win32',revealImpl:async path=>shown.push(path)});
  const saved=await store.save('owner','https://files.slack.com/file','audit.txt','token');assert.equal(store.list('other').length,0);assert.equal(store.list('owner')[0].id,saved.id);
  await assert.rejects(store.show('other',saved.id),/this app session/);await assert.rejects(store.show('owner','../../file'),/this app session/);
  await store.show('owner',saved.id);assert.equal(await readFile(shown[0],'utf8'),'audit contents');assert(shown[0].startsWith(dir));
});
test('private DNS and credential-bearing URLs are rejected before a file request',async()=>{
  let calls=0;const store=new DownloadStore({lookupImpl:async()=>[{address:'127.0.0.1',family:4}],fetchImpl:async()=>{calls++;return new Response('x');}});
  await assert.rejects(store.save('o','https://example.com/file','x'),/unsupported/);await assert.rejects(store.save('o','https://user:pass@example.com/file','x'),/unsupported/);assert.equal(calls,0);
});
test('download redirects never forward Slack credentials to another host family',async()=>{
  const called=[];const store=new DownloadStore({lookupImpl:async()=>[{address:'93.184.215.14',family:4}],fetchImpl:async url=>{called.push(url);return new Response(null,{status:302,headers:{Location:'https://evil.example/file'}});}});
  await assert.rejects(store.save('o','https://files.slack.com/file','x','private'),/unsupported/);assert.equal(called.length,1);
});
test('oversized download headers reject without saving a file',async()=>{
  const store=new DownloadStore({lookupImpl:async()=>[{address:'93.184.215.14',family:4}],fetchImpl:async()=>new Response('x',{headers:{'Content-Length':String(DOWNLOAD_LIMIT+1)}})});
  await assert.rejects(store.save('o','https://example.com/file','x'),/25 MiB/);assert.equal(store.list('o').length,0);
});
