import { error } from './nav.js';
import { safeLink } from './content.js';
const list=document.getElementById('server-links');
fetch('/quick-links.json').then(r=>{if(!r.ok)throw new Error('Could not load quick links.');return r.json();}).then(links=>{
  for(const entry of links){const li=document.createElement('li'),url=safeLink(entry.url);if(url){const a=document.createElement('a');a.href=url;a.textContent=entry.name+' (opens in a new tab)';a.target='_blank';a.rel='noopener noreferrer';li.append(a);}else li.textContent=entry.name+' — URL pending';list.append(li);}
}).catch(e=>error(e.message));
const root='https://www2.freedomscientific.com/Training/Surfs-up/';
for(const [name,path] of [['Start here','_Surfs_Up_Start_Here.htm'],['Navigating pages, headings and links','Navigating.htm']]){const li=document.createElement('li'),a=document.createElement('a');a.href=root+path;a.textContent=name+' (opens in a new tab)';a.target='_blank';a.rel='noopener noreferrer';li.append(a);document.getElementById('jaws-links').append(li);}
