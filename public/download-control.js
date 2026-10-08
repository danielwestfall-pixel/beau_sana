import {api,status,error,action} from './nav.js';
export function revealButton(file){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=`Show ${file.name} in Explorer`;button.addEventListener('click',()=>action(button,async()=>{await api('/api/downloads/reveal',{id:file.id});status('File selected in Windows Explorer.');}));return button;}
export function saveButton(name, path, body={}){
  const wrap=document.createElement('span'),button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=`Save ${name} to BeauSana downloads`;
  button.addEventListener('click',()=>action(button,async()=>{status(`Downloading ${name}.`);try{const result=await api(path,body);const reveal=revealButton(result.file);wrap.replaceChildren(reveal);reveal.focus();status(`${result.file.name} saved. Show in Explorer is available.`);}catch(e){status('');throw e;}}));wrap.append(button);return wrap;
}
