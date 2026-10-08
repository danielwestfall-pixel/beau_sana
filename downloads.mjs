import { mkdir, writeFile, stat, lstat } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { Readable } from 'node:stream';
export const DOWNLOAD_LIMIT = 25 * 1024 * 1024;
export function downloadName(name) {
  const cleaned = String(name || 'download').replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').slice(0,160) || 'download';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned) ? `_${cleaned}` : cleaned;
}
function privateAddress(address) {
  return /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address) ||
    address === '::1' || address === '::' || /^(fc|fd|fe[89ab])/i.test(address) || address.startsWith('::ffff:') || /^(224|2[3-5]\d)\./.test(address);
}
class DownloadError extends Error { constructor(message){super(message);this.status=400;} }
// Pin the approved DNS result to the actual connection, including every redirect.
function pinnedFetch(target, headers, address){return new Promise((resolveResult,reject)=>{
  const req=request(target,{headers,signal:AbortSignal.timeout(120000),lookup:(_host,options,done)=>{
    if(options.all)done(null,[address]);else done(null,address.address,address.family);
  }},res=>{
    const responseHeaders=new Headers();for(const [name,value] of Object.entries(res.headers))if(value)responseHeaders.set(name,Array.isArray(value)?value.join(','):value);
    resolveResult(new Response([204,304].includes(res.statusCode)?null:Readable.toWeb(res),{status:res.statusCode,headers:responseHeaders}));
  });req.on('error',reject);req.end();
});}
export class DownloadStore {
  constructor({ directory = join(homedir(), 'Downloads', 'BeauSana'), fetchImpl = fetch, lookupImpl = lookup,
    revealImpl, platform = process.platform } = {}) {
    this.directory = resolve(directory); this.fetch = fetchImpl; this.lookup = lookupImpl; this.records = new Map(); this.platform = platform;
    this.reveal = revealImpl || (path => new Promise((resolveResult, reject) => {
      const child = spawn('explorer.exe', [`/select,${path}`], { windowsHide: true, stdio: 'ignore', shell: false });
      child.once('error', reject); child.once('spawn', resolveResult);
    }));
  }
  list(owner) { return [...this.records.values()].filter(r => r.owner === owner).map(({ id, name, created }) => ({ id, name, created })); }
  async save(owner, url, name, token) {
    let response;
    for (let redirects = 0; redirects <= 4; redirects++) {
      const target = new URL(url);
      if (target.protocol !== 'https:' || target.username || target.password || target.port && target.port !== '443') throw new DownloadError('This file destination is unsupported.');
      if (token && !(target.hostname.endsWith('.slack.com') || target.hostname.endsWith('.slack-edge.com'))) throw new DownloadError('Slack returned an unsupported file destination.');
      const addresses = await this.lookup(target.hostname, { all: true });
      if (!addresses.length || addresses.some(a => privateAddress(a.address))) throw new DownloadError('This file destination is unsupported.');
      const headers=token ? { Authorization: `Bearer ${token}` } : {};
      response = this.fetch===fetch ? await pinnedFetch(target,headers,addresses[0]) : await this.fetch(target.href, { headers, redirect: 'manual', signal: AbortSignal.timeout(120000) });
      if (![301,302,303,307,308].includes(response.status)) break;
      await response.body?.cancel();
      url = new URL(response.headers.get('location'), target).href;
      if (redirects === 4) throw new DownloadError('Too many file redirects.');
    }
    if (!response?.ok) throw new DownloadError('The file could not be downloaded.');
    if (Number(response.headers.get('content-length')) > DOWNLOAD_LIMIT) { await response.body?.cancel(); throw new DownloadError('Downloads are limited to 25 MiB.'); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > DOWNLOAD_LIMIT) throw new DownloadError('Downloads are limited to 25 MiB.'); chunks.push(chunk); }
    if (!size) throw new DownloadError('The file was empty.');
    await mkdir(this.directory, { recursive: true });
    if((await lstat(this.directory)).isSymbolicLink())throw new DownloadError('The download folder must be a regular folder.');
    const id = randomUUID(), filename = `${id.slice(0,8)}-${downloadName(name)}`, path = join(this.directory, filename);
    await writeFile(path, Buffer.concat(chunks), { flag: 'wx', mode: 0o600 });
    const record = { id, owner, path, name: filename, created: new Date().toISOString() }; this.records.set(id, record);
    return { id, name: filename, created: record.created };
  }
  async show(owner, id) {
    const record = this.records.get(id);
    if (!record || record.owner !== owner) throw new DownloadError('Choose a file downloaded in this app session.');
    const rel = relative(this.directory, resolve(record.path));
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('This download is unavailable.');
    if (this.platform !== 'win32') throw new Error('Show in Explorer is available on Windows.');
    if ((await lstat(this.directory)).isSymbolicLink() || (await lstat(record.path)).isSymbolicLink() || !(await stat(record.path)).isFile()) throw new Error('This download is unavailable.');
    await this.reveal(record.path);
  }
}
