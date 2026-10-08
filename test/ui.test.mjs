import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SourceTextModule } from 'node:vm';
import { JSDOM } from 'jsdom';
const root=new URL('../public/',import.meta.url);
const read=name=>readFileSync(new URL(name,root),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
async function until(fn){for(let i=0;i<80;i++){if(fn())return;await tick();}assert(fn(),'UI did not reach expected state');}
async function page(t,name,script,fetchImpl){
  const dom=new JSDOM(read(name),{url:`http://127.0.0.1:4317/${name}`,runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window;w.fetch=fetchImpl;w.structuredClone=structuredClone;w.URL.createObjectURL=()=> 'blob:example';w.URL.revokeObjectURL=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
  const cache=new Map();function module(url){if(!cache.has(url.href))cache.set(url.href,new SourceTextModule(readFileSync(url,'utf8'),{context:dom.getInternalVMContext(),identifier:url.href}));return cache.get(url.href);}
  const entry=module(new URL(script,root));await entry.link((name,parent)=>module(new URL(name,parent.identifier)));await entry.evaluate();await tick();
  return {w,d:w.document,el:id=>w.document.getElementById(id)};
}
const disconnected=async()=>Response.json({configured:false,connected:false,defaultChannel:'C0C7Q7AJT7Y',workspace:'quavered',saved:false,rememberSupported:true});
test('Slack demo reactions, thread replies, drafts and browser Back work with semantic controls',async t=>{
  const {w,d,el}=await page(t,'slack.html','slack-ui.js',disconnected);assert(el('slack-login').disabled);
  el('slack-demo').click();await until(()=>!el('slack-work').hidden&&el('messages').children.length===1);
  assert(el('slack-connect').hidden);assert.equal(el('messages').querySelectorAll('article').length,1);
  const eyes=()=>el('messages').querySelector('[data-focus-key$=":eyes"]');eyes().focus();eyes().click();await until(()=>eyes().getAttribute('aria-pressed')==='true');assert.equal(d.activeElement,eyes());
  el('slack-text').value='Channel draft';d.querySelector('[data-channel="DDEMO"]').click();await until(()=>el('conversation-heading').textContent==='Example colleague');assert.equal(el('slack-text').value,'');el('slack-text').value='DM draft';
  d.querySelector('[data-channel="C0C7Q7AJT7Y"]').click();await until(()=>el('conversation-heading').textContent==='#a11y-auditing');assert.equal(el('slack-text').value,'Channel draft');
  el('messages').querySelector('a[href*="thread="]').click();await until(()=>el('conversation-heading').textContent==='Thread in #a11y-auditing');assert(!el('thread-back').hidden);assert.equal(el('messages').children.length,2);
  el('slack-text').value='Example reply';el('slack-send').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>el('messages').children.length===3&&!el('send-button').disabled);assert.match(el('status').textContent,/Example message added/);
  w.history.back();await until(()=>el('conversation-heading').textContent==='#a11y-auditing');assert.equal(el('slack-text').value,'Channel draft');
  el('slack-disconnect').click();await until(()=>el('slack-work').hidden);assert(!el('slack-connect').hidden);
});
test('Slack late mutation stays in original channel and does not clear a different conversation draft',async t=>{
  let finish;const writes=[];
  const fetchImpl=async(path,options)=>{
    if(path==='/api/slack/status')return Response.json({configured:true,connected:true,name:'Example',workspace:'quavered',defaultChannel:'C0C7Q7AJT7Y'});
    if(path.startsWith('/api/slack/conversations'))return Response.json({conversations:[{id:'C0C7Q7AJT7Y',name:'#audit'},{id:'DTEST',name:'Colleague'}]});
    if(path.startsWith('/api/slack/messages'))return Response.json({messages:[],cursor:''});
    if(path.startsWith('/api/slack/send')){writes.push({path,body:JSON.parse(options.body)});await new Promise(resolve=>{finish=resolve;});return Response.json({ts:'1791311000.000001'});}
    throw new Error('Unexpected UI call '+path);
  };
  const {w,d,el}=await page(t,'slack.html','slack-ui.js',fetchImpl);await until(()=>!el('conversation').hidden);
  el('slack-text').value='Send to channel';el('slack-send').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!!finish);
  d.querySelector('[data-channel="DTEST"]').click();await until(()=>el('conversation-heading').textContent==='Colleague');finish();await until(()=>!el('send-button').disabled);
  assert(writes[0].path.includes('channel=C0C7Q7AJT7Y'));assert.equal(writes[0].body.text,'Send to channel');assert.equal(el('slack-text').value,'');assert.match(el('status').textContent,/sent to #audit/);
});
test('component library filters all patterns and supplies manual copy fallback',async t=>{
  const {w,d,el}=await page(t,'components.html','components.js',async()=>Response.json(JSON.parse(read('patterns.json'))));assert.equal(el('pattern-list').children.length,30);
  el('pattern-search').value='combobox';el('pattern-search').dispatchEvent(new w.Event('input'));assert.equal(el('pattern-list').children.length,1);assert(el('pattern-list').querySelector('a').href.includes('/combobox/'));
  el('pattern-list').querySelector('button').click();await until(()=>!el('copy-url').hidden);assert.equal(d.activeElement,el('copy-url'));assert(el('copy-url').value.includes('/combobox/'));
  el('pattern-search').value='no-such-widget';el('pattern-search').dispatchEvent(new w.Event('input'));assert.equal(el('pattern-list').children.length,0);assert.equal(el('pattern-count').textContent,'0 of 30 patterns');
});
test('quick links do not turn unconfigured or unsafe destinations into links',async t=>{
  const {el}=await page(t,'resources.html','resources.js',async()=>Response.json([{name:'Live',url:null},{name:'Dev',url:'javascript:alert(1)'},{name:'Beta',url:'https://example.com/'}]));assert.equal(el('server-links').querySelectorAll('a').length,1);assert.match(el('server-links').textContent,/Live — URL pending/);
});
test('Asana demo task history returns to list and forward reopens the task',async t=>{
  const fetchImpl=async path=>path==='/api/saved-token'?Response.json({saved:false,supported:true}):Response.json({error:'Connect to Asana'},{status:401});
  const {w,d,el}=await page(t,'asana.html','app.js',fetchImpl);el('demo-button').click();await until(()=>!el('tasks-view').hidden);
  d.querySelector('#task-101').click();await until(()=>!el('detail-view').hidden);assert.equal(w.location.hash,'#task-101');assert.equal(d.activeElement,el('detail-heading'));
  el('back').click();await until(()=>!el('tasks-view').hidden);assert.equal(w.location.hash,'');
  w.history.forward();await until(()=>!el('detail-view').hidden);assert.equal(w.location.hash,'#task-101');
});
test('session expiry warning offers repeatable extensions before the deadline',async t=>{
  let extensions=0;const fetchImpl=async path=>Response.json(path==='/api/extend-session'?(extensions++,{slack:Date.now()+8*3600000}):{slack:Date.now()+5*60000});
  const {d}=await page(t,'downloads.html','nav.js',fetchImpl);const button=[...d.querySelectorAll('button')].find(b=>b.textContent.includes('Keep connections active'));
  assert(!button.parentElement.hidden);assert.match(button.parentElement.textContent,/expires within ten minutes/);button.click();await until(()=>extensions===1&&!button.disabled);assert.match(button.parentElement.textContent,/extended for eight more hours/);button.click();await until(()=>extensions===2&&!button.disabled);
});
