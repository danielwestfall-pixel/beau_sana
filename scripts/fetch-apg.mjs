// Refresh official reference URLs; never executes example code.
import { writeFile } from 'node:fs/promises';
const base='https://www.w3.org/WAI/ARIA/apg/patterns/';
const index=await (await fetch(base)).text();
const urls=[...new Set([...index.matchAll(/href="([^"]+)"/g)].map(m=>new URL(m[1],base).href).filter(u=>u.startsWith(base)&&u!==base&&!u.includes('#')&&/\/patterns\/[^/]+\/$/.test(u)))];
const entries=[];
for(const url of urls){const html=await(await fetch(url)).text();
 const strip=s=>s.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').replaceAll('&amp;','&').trim();
 const examples=[...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m=>({url:new URL(m[1],url).href,name:strip(m[2])})).filter(x=>x.url.includes('/examples/')&&x.url.startsWith(base));
 entries.push({id:url.split('/').at(-2),name:strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]||''),url,examples:[...new Map(examples.map(e=>[e.url,e])).values()],keyboard:strip(html.split('id="keyboardinteraction"')[1]?.split('id="wai-ariaroles')[0]||'')});
}
await writeFile(process.argv[2],JSON.stringify(entries,null,2));console.log(`Retrieved ${entries.length} official APG patterns.`);
