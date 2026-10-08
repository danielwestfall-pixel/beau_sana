import{api,error,status,action}from'./nav.js';
const el=id=>document.getElementById(id);let busy=false;let baseline=null;let timer;
function notice(text,path){const li=document.createElement('li'),a=document.createElement('a');a.textContent=text;a.href=path;li.append(a);el('updates').prepend(li);while(el('updates').children.length>20)el('updates').lastElementChild.remove();}
async function check(){if(busy)return;busy=true;let count=0;const errors=[];const now={};
 try{
  try{const session=await api('/api/session');const workspace=session.profile.workspaces[0];let tasks=[];if(workspace)tasks=(await api(`/api/tasks?workspace=${encodeURIComponent(workspace.gid)}`)).tasks;
   el('asana-summary').textContent=`${session.profile.name} · ${tasks.length} unfinished tasks in ${workspace?.name||'your workspace'}.`;now.tasks=new Set(tasks.map(t=>t.gid));
   if(baseline?.tasks){const added=tasks.filter(t=>!baseline.tasks.has(t.gid));if(added.length){notice(`${added.length} newly listed Asana tasks`,'/asana.html');count++;}}
  }catch(e){el('asana-summary').textContent='Open Asana to connect or try example tasks.';if(!e.message.includes('Connect to Asana'))errors.push(e.message);}
  try{const s=await api('/api/slack/status');el('slack-summary').textContent=s.connected?`Connected as ${s.name}.`:s.configured?'Connect Slack to check messages.':'Slack app setup pending. Demo is available.';
   if(s.connected){const result=await api(`/api/slack/messages?channel=${encodeURIComponent(s.defaultChannel)}`);now.latest=result.messages.at(-1)?.ts;
    if(baseline?.latest&&Number(now.latest)>Number(baseline.latest)){notice('New messages in #a11y-auditing',`/slack.html#channel=${s.defaultChannel}`);count++;}
    const conversations=(await api('/api/slack/conversations?summaries=true')).conversations;now.dms=new Set(conversations.filter(c=>c.kind==='dm').map(c=>c.id));now.dmLatest=new Map(conversations.filter(c=>c.kind==='dm').map(c=>[c.id,c.latest]));
    for(const c of conversations.filter(c=>c.kind==='dm'&&c.latest)){
      let read;try{read=localStorage.getItem(`beau-slack-read:${s.workspace}:${s.name}:${c.id}`);}catch{}
      const previous=baseline?.dmLatest?.get(c.id),unread=Number(c.latest)>Math.max(Number(read)||0,Number(c.lastRead)||0);
      if((previous&&Number(c.latest)>Number(previous))||(!baseline?.dmLatest&&unread)){notice(`${previous?'New messages':'Unread messages'} from ${c.name}`,`/slack.html#channel=${c.id}`);count++;}
    }
    if(baseline?.dms){const added=conversations.filter(c=>c.kind==='dm'&&!baseline.dms.has(c.id));for(const c of added){notice(`New direct conversation with ${c.name}`,`/slack.html#channel=${c.id}`);count++;}}
   }
  }catch(e){errors.push(`Slack: ${e.message}`);}
  baseline={...baseline,...now};el('checked').textContent=`Last checked ${new Date().toLocaleTimeString()}. Channel updates, new conversations and up to 20 active DM summaries are checked. Open Slack for the full conversation list.`;
  if(count)status(`${count} updates available in the Updates list.`);else if(!timer)status('Update check complete.');
  if(errors.length)error(errors.join(' '));
 }finally{busy=false;}
}
el('check-updates').addEventListener('click',e=>action(e.currentTarget,check));
el('auto-updates').addEventListener('change',e=>{clearInterval(timer);timer=undefined;if(e.target.checked)timer=setInterval(()=>{if(!document.hidden)check().catch(e=>error(e.message));},120000);status(e.target.checked?'Automatic update checks enabled.':'Automatic update checks stopped.');});
el('clear-updates').addEventListener('click',()=>{el('updates').replaceChildren();status('Dashboard notices cleared.');});
check().catch(e=>error(e.message));
