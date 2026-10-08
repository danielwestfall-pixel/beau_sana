const links = [['Dashboard','/'],['Asana','/asana.html'],['Slack','/slack.html'],['Resources','/resources.html'],['Downloads','/downloads.html']];
const nav=document.getElementById('site-nav');
if(nav){
  const list=document.createElement('ul');
  for(const [name,path] of links){const li=document.createElement('li'),a=document.createElement('a');a.href=path;a.textContent=name;if(location.pathname===path)a.setAttribute('aria-current','page');li.append(a);list.append(li);}
  nav.append(list);
  if(location.pathname!=='/'){
    const back=document.createElement('button');back.type='button';back.className='secondary';back.textContent='Back';
    back.addEventListener('click',()=>{if(history.state?.beauVisit)history.back();else location.assign('/');});nav.append(back);
  }
}
// Only use Back for a known visit from this dashboard; direct entry falls back to Home.
function consumeVisit(){let known=false;try{const target=sessionStorage.getItem('beauNextPage');known=target===location.href;sessionStorage.removeItem('beauNextPage');}catch{}return known;}
if(history.state?.beauVisit===undefined)history.replaceState({...history.state,beauVisit:consumeVisit()},'',location.href);
document.addEventListener('click',event=>{const a=event.target.closest?.('a[href]');if(!a||event.defaultPrevented||event.ctrlKey||event.metaKey||event.shiftKey||a.target==='_blank')return;try{const url=new URL(a.href);if(url.origin===location.origin&&url.href!==location.href)sessionStorage.setItem('beauNextPage',url.href);}catch{}});
window.addEventListener('hashchange',()=>{if(consumeVisit())history.replaceState({...history.state,beauVisit:true},'',location.href);});
// User-controlled extensions and advance notice prevent a silent local-session timeout.
if(nav){
  const area=document.createElement('div'),note=document.createElement('p'),button=document.createElement('button');
  area.hidden=true;note.setAttribute('role','status');note.setAttribute('aria-atomic','true');button.type='button';button.className='secondary';button.textContent='Keep connections active for eight more hours';area.append(note,button);nav.append(area);
  let limits={},warned=false;
  function update(){const values=Object.values(limits).filter(Number.isFinite);area.hidden=!values.length;if(!values.length)return;const left=Math.min(...values)-Date.now();
    if(left<=0){if(!warned||!button.disabled)note.textContent='Your local connection time has ended. Reconnect to continue. Your drafts remain on this page.';button.disabled=true;warned=true;}
    else if(left<=10*60000&&!warned){note.textContent='A local connection expires within ten minutes. Use Keep connections active to continue without reconnecting.';warned=true;}
  }
  button.addEventListener('click',()=>action(button,async()=>{limits=await api('/api/extend-session',{});warned=false;note.textContent='Local connections extended for eight more hours.';update();}));
  function refreshLimits(){api('/api/connection-limits').then(value=>{limits=value;update();}).catch(()=>{});}
  refreshLimits();document.addEventListener('beau-connection-change',refreshLimits);
  let timer=setInterval(update,30000);window.addEventListener('pagehide',()=>clearInterval(timer));window.addEventListener('pageshow',()=>{clearInterval(timer);timer=setInterval(update,30000);refreshLimits();});document.addEventListener('visibilitychange',update);
}
export async function api(path, body, extraHeaders={}){
  const response=await fetch(path,{method:body!==undefined?'POST':'GET',headers:{'X-BeauSana':'local',...(body!==undefined ? {'Content-Type':'application/json'}:{}),...extraHeaders},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'The request could not be completed.');return result;
}
export const status=message=>{const e=document.getElementById('status');if(e)e.textContent=message;};
export const error=message=>{const e=document.getElementById('error');if(e)e.textContent=message||'';};
export async function action(button, work){if(button.disabled)return;button.disabled=true;error();try{return await work();}catch(e){error(e.message||'The app is not responding.');}finally{button.disabled=false;}}
