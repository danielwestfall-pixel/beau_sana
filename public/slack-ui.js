import { api, status, error, action } from './nav.js';
import { saveButton } from './download-control.js';
import { safeLink } from './content.js';
const el=id=>document.getElementById(id);
let demo=false, ready=false, info, conversations=[], route={}, version=0, messages=[], cursor='', busy=false;
const drafts=new Map(), examples=new Map();
const key=r=>`${r.channel || ''}:${r.thread || ''}`;
const path=(name,r=route)=>`/api/slack/${name}?${new URLSearchParams({channel:r.channel,...(r.thread?{thread:r.thread}:{})})}`;
const hash=r=>'#'+new URLSearchParams({channel:r.channel,...(r.thread?{thread:r.thread}:{})});
const stamp=()=>`${Math.floor(Date.now()/1000)}.${String(Math.floor(Math.random()*1000000)).padStart(6,'0')}`;
function textContent(text){
  const p=document.createElement('p');p.className='message-text';let start=0;
  for(const m of text.matchAll(/<(https?:\/\/[^>|]+)(?:\|([^>]+))?>/g)){
    p.append(document.createTextNode(text.slice(start,m.index)));const url=safeLink(m[1].replaceAll('&amp;','&'));
    if(url){const a=document.createElement('a');a.href=url;a.textContent=m[2]||m[1];a.target='_blank';a.rel='noopener noreferrer';a.append(' (opens in a new tab)');p.append(a);}else p.append(document.createTextNode(m[0]));
    start=m.index+m[0].length;
  }
  p.append(document.createTextNode(text.slice(start).replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>')));return p;
}
function renderMessages(){
  const focused=document.activeElement?.dataset?.focusKey;
  el('messages').replaceChildren();
  for(const m of messages){
    const li=document.createElement('li'),article=document.createElement('article'),heading=document.createElement('h3');
    heading.textContent=`${m.author} · ${new Date(Number(m.ts)*1000).toLocaleString()}`;article.append(heading,textContent(m.text));
    const tools=document.createElement('div');tools.className='toolbar';
    for(const [name,label] of [['thumbsup','Thumbs up'],['eyes','Seen (eyes)'],['white_check_mark','Done (check mark)']]){
      const reaction=m.reactions.find(r=>r.name===name),button=document.createElement('button');button.type='button';button.className='secondary';
      button.dataset.focusKey=`${m.ts}:${name}`;button.textContent=`${label}${reaction?.count?` (${reaction.count})`:''}`;
      button.setAttribute('aria-label',`${label} response to ${m.author}'s message at ${new Date(Number(m.ts)*1000).toLocaleTimeString()}`);
      button.setAttribute('aria-pressed',String(!!reaction?.mine));
      button.disabled=busy;
      button.addEventListener('click',()=>action(button,async()=>{
        const target={...route},remove=!!m.reactions.find(r=>r.name===name)?.mine;
        if(!demo)await api(path('react',target),{ts:m.ts,name,remove});
        let r=m.reactions.find(r=>r.name===name);if(!r){r={name,count:0,mine:false};m.reactions.push(r);}r.count=Math.max(0,r.count+(remove?-1:1));r.mine=!remove;
        if(key(target)===key(route)){renderMessages();el('messages').querySelector(`[data-focus-key="${m.ts}:${name}"]`)?.focus();}
        status(`${demo?'Example response: ':''}${label} ${remove?'removed':'added'}.`);
      }));tools.append(button);
    }
    if(!route.thread){const a=document.createElement('a');a.href=hash({channel:route.channel,thread:m.ts});a.textContent=m.replyCount?`Thread: ${m.replyCount} ${m.replyCount===1?'reply':'replies'}`:'Reply in thread';a.dataset.focusKey=`${m.ts}:thread`;tools.append(a);}
    article.append(tools);
    if(m.files?.length){const ul=document.createElement('ul');ul.className='attachments';for(const f of m.files){const item=document.createElement('li');item.append(document.createTextNode(`${f.name} · ${Math.ceil((f.size||0)/1024)} KiB `));
      if(f.external)item.append('External file: open this message in Slack to access its provider.');
      else if(demo){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=`Download example ${f.name}`;b.addEventListener('click',()=>{status('Example file only. Live file downloads save to your Downloads/BeauSana folder and provide Show in Explorer.');});item.append(b);}
      else item.append(saveButton(f.name,path('file'),{id:f.id}));ul.append(item);}article.append(ul);}
    if(!demo){const a=document.createElement('a');a.href=`https://${info.workspace}.slack.com/archives/${route.channel}/p${m.ts.replace('.','')}`;a.textContent='Open message in Slack (opens in a new tab)';a.target='_blank';a.rel='noopener noreferrer';article.append(a);}
    li.append(article);el('messages').append(li);
  }
  if(!messages.length){const li=document.createElement('li');li.textContent='No messages in this conversation yet.';el('messages').append(li);}
  el('older-messages').hidden=!cursor;el('older-messages').textContent=route.thread?'Load more thread messages':'Load older messages';
  if(focused)el('messages').querySelector(`[data-focus-key="${focused}"]`)?.focus();
}
async function load(older=false,focus=false){
  if(!ready)return;const r={...route},v=++version;error();status(older?'Loading older messages.':'Loading messages.');
  el('new-messages').disabled=el('older-messages').disabled=true;
  try{
    const result=demo?{messages:structuredClone(examples.get(key(r))||[]),cursor:''}:await api(path('messages',r)+(older?`&cursor=${encodeURIComponent(cursor)}`:''));
    if(v!==version||key(r)!==key(route))return;
    messages=older?[...new Map([...result.messages,...messages].map(m=>[m.ts,m])).values()].sort((a,b)=>Number(a.ts)-Number(b.ts)):result.messages;
    cursor=result.cursor;renderMessages();status(`${messages.length} ${demo?'example ':''}messages loaded.${older?' Older messages were added at the start of the list.':''}`);
    if(focus)el('conversation-heading').focus();
    if(!demo&&!r.thread&&!older&&messages.length){try{localStorage.setItem(`beau-slack-read:${info.workspace}:${info.name}:${r.channel}`,messages.at(-1).ts);}catch{}}
  }catch(e){if(v===version){error(e.message);status('');}}
  finally{if(v===version)el('new-messages').disabled=el('older-messages').disabled=false;}
}
function routeChanged(focus=true){
  if(!ready)return;drafts.set(key(route),el('slack-text').value);
  const params=new URLSearchParams(location.hash.slice(1)),channel=params.get('channel')||info.defaultChannel,thread=params.get('thread')||undefined;
  if(!conversations.some(c=>c.id===channel)){error('Choose a conversation from the list.');return;}
  if(thread&&!/^\d{10,16}\.\d{6}$/.test(thread)){error('This thread link is invalid.');return;}
  route={channel,thread};messages=[];cursor='';el('messages').replaceChildren();el('slack-text').value=drafts.get(key(route))||'';el('slack-file').value='';
  el('conversation').hidden=false;const title=conversations.find(c=>c.id===channel).name;
  el('conversation-heading').textContent=`${thread?'Thread in ':''}${title}`;
  el('slack-text-label').textContent=thread?'Reply in this thread':'Message to '+title;
  el('thread-back').hidden=!thread;el('thread-back').href=hash({channel});
  for(const a of el('conversations').querySelectorAll('a')){if(a.dataset.channel===channel)a.setAttribute('aria-current','true');else a.removeAttribute('aria-current');}
  load(false,focus);
}
async function enter(){
  conversations=demo?[{id:info.defaultChannel,name:'#a11y-auditing',kind:'channel'},{id:'DDEMO',name:'Example colleague',kind:'dm'}]:(await api('/api/slack/conversations')).conversations;
  ready=true;el('slack-work').hidden=false;el('slack-connect').hidden=true;
  el('slack-connection').textContent=demo?'Demo mode · No messages or files are sent to Slack.':`Connected as ${info.name} in ${info.workspace}.`;
  el('slack-disconnect').textContent=demo?'Exit example conversations':'Disconnect Slack';
  el('conversations').replaceChildren();for(const c of conversations){const li=document.createElement('li'),a=document.createElement('a');a.href=hash({channel:c.id});a.dataset.channel=c.id;a.textContent=c.name;li.append(a);el('conversations').append(li);}
  routeChanged(false);
}
async function connection(){
  document.dispatchEvent(new Event('beau-connection-change'));
  info=await api('/api/slack/status');el('slack-remember').disabled=!info.rememberSupported;el('slack-restore').hidden=el('slack-forget').hidden=!info.saved;
  el('slack-login').disabled=!info.configured;
  el('slack-setup').textContent=info.configured?'Use Connect Slack to approve access with your own account.':'Slack app setup is pending. The administrator needs a client ID, client secret and registered HTTPS callback. Use the example conversations for now.';
  if(info.connected)await enter();else{ready=false;el('slack-work').hidden=true;el('slack-connect').hidden=false;el('slack-connection').textContent='Slack is disconnected.';}
}
el('slack-login').addEventListener('click',()=>action(el('slack-login'),async()=>{const result=await api('/api/slack/connect',{remember:el('slack-remember').checked});location.assign(result.url);}));
el('slack-restore').addEventListener('click',()=>action(el('slack-restore'),async()=>{await api('/api/slack/restore',{});await connection();el('conversation-heading').focus();}));
el('slack-forget').addEventListener('click',()=>action(el('slack-forget'),async()=>{await api('/api/slack/forget',{});await connection();status('Saved Slack connection forgotten on this computer.');}));
el('slack-demo').addEventListener('click',()=>action(el('slack-demo'),async()=>{
  demo=true;info||={defaultChannel:'C0C7Q7AJT7Y'};const ts='1791311000.000001';
  examples.set(`${info.defaultChannel}:`,[{ts,author:'Example coordinator',text:'Welcome to the accessibility audit channel. Reply in a thread, or use Seen to acknowledge this message.',replyCount:1,files:[{id:'FDEMO',name:'Example audit instructions.txt',size:1024}],reactions:[]}]);
  examples.set(`${info.defaultChannel}:${ts}`,[{ts,author:'Example coordinator',text:'Welcome to the accessibility audit channel.',reactions:[]},{ts:'1791311001.000001',author:'Example colleague',text:'I will review the keyboard navigation.',reactions:[]}]);
  examples.set('DDEMO:',[{ts,author:'Example colleague',text:'Can you check the dialog example? <https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/|Dialog reference>',reactions:[]}]);await enter();el('conversation-heading').focus();
}));
el('slack-disconnect').addEventListener('click',()=>action(el('slack-disconnect'),async()=>{++version;if(!demo)await api('/api/slack/disconnect',{});demo=false;drafts.clear();messages=[];route={};history.replaceState(history.state,'',location.pathname);await connection();el('slack-heading').focus();}));
el('slack-refresh').addEventListener('click',()=>action(el('slack-refresh'),enter));
el('new-messages').addEventListener('click',()=>load());el('older-messages').addEventListener('click',()=>load(true));
window.addEventListener('hashchange',()=>routeChanged());
function lock(value){busy=value;for(const form of [el('slack-send'),el('slack-upload')])for(const input of form.elements)input.disabled=value;}
async function compose(form,operation){
  if(busy||!ready)return;error();const target={...route},isDemo=demo;lock(true);
  status('Saving to '+conversations.find(c=>c.id===target.channel)?.name+'.');el('status').tabIndex=-1;el('status').focus();
  try{const announcement=await operation(target,isDemo);if(key(route)===key(target)&&demo===isDemo)await load();status(announcement);}
  catch(e){error(e.message||'The result could not be confirmed. Check Slack before trying again.');}
  finally{lock(false);if(key(route)===key(target)&&demo===isDemo)form.querySelector('textarea,input')?.focus();}
}
el('slack-send').addEventListener('submit',event=>{event.preventDefault();const text=el('slack-text').value;if(!text.trim())return;
  compose(el('slack-send'),async(target,isDemo)=>{status('Sending message.');
    if(isDemo){const list=examples.get(key(target))||[];list.push({ts:stamp(),author:'You (example)',text,reactions:[]});examples.set(key(target),list);}else await api(path('send',target),{text});
    drafts.delete(key(target));if(key(target)===key(route)&&el('slack-text').value===text)el('slack-text').value='';return `${isDemo?'Example message added':'Message sent'} to ${conversations.find(c=>c.id===target.channel)?.name}.`;
  });
});
el('slack-upload').addEventListener('submit',event=>{event.preventDefault();const file=el('slack-file').files[0];
  compose(el('slack-upload'),async(target,isDemo)=>{if(!file||!file.size||file.size>25*1024*1024)throw new Error('Choose a non-empty file of 25 MiB or smaller.');status('Sharing file.');
    if(isDemo){const list=examples.get(key(target))||[];list.push({ts:stamp(),author:'You (example)',text:'Example shared file',reactions:[],files:[{id:'FDEMO'+stamp(),name:file.name,size:file.size}]});examples.set(key(target),list);}else{
      const response=await fetch(path('upload',target),{method:'POST',headers:{'X-BeauSana':'local','X-File-Name':encodeURIComponent(file.name),'Content-Type':'application/octet-stream'},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error||'The upload could not be confirmed. Check Slack before repeating it.');}
    if(key(target)===key(route))el('slack-file').value='';return isDemo?'Example file added; it was not sent to Slack.':'File shared in Slack.';
  });
});
connection().then(()=>{if(new URLSearchParams(location.search).get('warning')==='not-saved')error('Connected, but Windows could not save your connection. Reconnect after restarting.');}).catch(e=>error(e.message));
