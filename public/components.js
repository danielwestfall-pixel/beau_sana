import { error, status } from './nav.js';
const el=id=>document.getElementById(id);let patterns=[];
function external(name,url){const a=document.createElement('a');a.textContent=name+' (opens in a new tab)';a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
async function copy(url,name){
  try{await navigator.clipboard.writeText(url);status(`${name} reference link copied.`);}
  catch{el('copy-fallback').hidden=el('copy-label').hidden=el('copy-url').hidden=false;el('copy-fallback').textContent='Automatic copying is unavailable. The link below is selected; press Ctrl+C to copy.';el('copy-url').value=url;el('copy-url').focus();el('copy-url').select();}
}
function filter(){
  const q=el('pattern-search').value.trim().toLowerCase();const matches=patterns.filter(p=>`${p.name} ${p.id} ${p.keyboard} ${p.aria}`.toLowerCase().includes(q));
  el('pattern-count').textContent=`${matches.length} of ${patterns.length} patterns`;el('pattern-list').replaceChildren();
  for(const p of matches){const section=document.createElement('section');section.className='pattern';section.id=p.id;const h=document.createElement('h2');h.textContent=p.name;section.append(h);
    const ul=document.createElement('ul');for(const [label,value] of [['Keyboard',p.keyboard],['Screen reader',p.screenReader],['ARIA needed',p.aria],['JavaScript needed',p.javascript]]){const li=document.createElement('li'),strong=document.createElement('strong');strong.textContent=label+': ';li.append(strong,value);ul.append(li);}section.append(ul);
    const tools=document.createElement('div');tools.className='toolbar';tools.append(external('APG details for '+p.name,p.url));const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Copy APG link for '+p.name;button.addEventListener('click',()=>copy(p.url,p.name));tools.append(button);section.append(tools);
    if(p.examples.length){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`Official examples (${p.examples.length})`;details.append(summary);const list=document.createElement('ul');for(const e of p.examples){const li=document.createElement('li');li.append(external(e.name||p.name+' example',e.url));list.append(li);}details.append(list);section.append(details);}
    else{const note=document.createElement('p');note.textContent='This pattern page has no separate APG example link. Review the details and linked related patterns.';section.append(note);}el('pattern-list').append(section);
  }
  if(location.hash&&!q)document.getElementById(location.hash.slice(1))?.scrollIntoView();
}
el('pattern-search').addEventListener('input',filter);
fetch('/patterns.json').then(r=>{if(!r.ok)throw new Error('Could not load component references.');return r.json();}).then(data=>{patterns=data;filter();}).catch(e=>error(e.message));
