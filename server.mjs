import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { CredentialStore } from './credentials.mjs';
import { createDashboardServices } from './dashboard-server.mjs';

const API = 'https://app.asana.com/api/1.0';
const SESSION_TTL = 8 * 60 * 60 * 1000;
export const MAX_FILE_SIZE = 25 * 1024 * 1024;
export const descriptionVersion = task => createHash('sha256').update(task.html_notes || task.notes || '').digest('hex');
const escapeXml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export function appendDescription(task, addition) {
  const html = task.html_notes || `<body>${escapeXml(task.notes || '')}</body>`;
  if (!html.endsWith('</body>')) throw new AppError(409, 'Could not preserve this description. Add a comment instead.');
  return html.slice(0, -7) + (task.notes ? '\n\n' : '') + escapeXml(addition) + '</body>';
}
export function previousAssignee(stories, currentUser) {
  const events = stories.filter(s => ['assigned', 'unassigned'].includes(s.resource_subtype))
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  let sawCurrent = false;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!sawCurrent) {
      if (event.resource_subtype !== 'assigned' || event.assignee?.gid !== currentUser) return null;
      sawCurrent = true; continue;
    }
    if (event.resource_subtype === 'unassigned') continue;
    if (!event.assignee?.gid) return null;
    return event.assignee.gid !== currentUser ? event.assignee : null;
  }
  return null;
}
export function handoffRecipient(task, stories, user) {
  const previous = previousAssignee(stories, user);
  if (previous) return { ...previous, reason: 'previous assignee' };
  const assigned = stories.filter(s => s.resource_subtype === 'assigned').sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  const first = assigned[0];
  const initial = first?.assignee?.gid === user ? first.created_by : !assigned.some(s => s.assignee?.gid && s.assignee.gid !== user) ? task.assigned_by : null;
  if (initial?.gid && initial.gid !== user) return { ...initial, reason: 'person who initially assigned this task' };
  if (task.created_by?.gid && task.created_by.gid !== user) return { ...task.created_by, reason: 'task creator' };
  return null;
}
export function safeAttachmentUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
const assets = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/mentions.js', ['public/mentions.js', 'text/javascript; charset=utf-8']],
  ['/content.js', ['public/content.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
  ...['asana', 'slack', 'resources', 'components', 'downloads'].map(name => [`/${name}.html`, [`public/${name}.html`, 'text/html; charset=utf-8']]),
  ...['nav', 'dashboard', 'slack-ui', 'resources', 'components', 'downloads-ui', 'download-control'].map(name => [`/${name}.js`, [`public/${name}.js`, 'text/javascript; charset=utf-8']]),
  ['/quick-links.json', ['public/quick-links.json', 'application/json; charset=utf-8']],
  ['/patterns.json', ['public/patterns.json', 'application/json; charset=utf-8']],
]);
class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export class AsanaReader {
  constructor(token, fetchImpl = fetch, waitImpl = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    this.token = token; this.fetch = fetchImpl; this.wait = waitImpl; this.mentionPeople = new Map();
  }
  async get(path, params = {}) { return this.request(path, params); }
  async request(path, params = {}, method = 'GET', body) {
    const url = new URL(API + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: body instanceof FormData ? body : JSON.stringify({ data: body }) } : {}),
        signal: AbortSignal.timeout(method === 'GET' ? 20000 : 120000), redirect: 'error',
      });
    } catch { throw new AppError(502, method === 'GET' ? 'Could not reach Asana. Check your internet connection and try again.' : 'The result could not be confirmed. Check the task in Asana before submitting again.'); }
    if (!response.ok) {
      const messages = {
        401: 'Asana did not accept this token. Disconnect and reconnect with a valid token.',
        403: 'Asana does not allow access to this information. Check your account permissions.',
        404: 'This task is no longer available.',
        429: 'Asana is receiving too many requests. Wait a minute, then try again.',
      };
      throw new AppError(response.status === 401 ? 401 : 502,
        messages[response.status] || (method === 'GET' ? 'Asana could not complete the request. Try again shortly.' : 'Asana could not confirm this update. Check the task in Asana before submitting again.'));
    }
    try { return await response.json(); }
    catch { throw new AppError(502, method === 'GET' ? 'Asana returned an unreadable response. Reload to try again.' : 'The result could not be confirmed. Check the task in Asana before submitting again.'); }
  }
  async all(path, params = {}) {
    const result = []; let offset; const seen = new Set();
    do {
      const page = await this.get(path, { ...params, limit: '100', ...(offset ? { offset } : {}) });
      result.push(...page.data);
      offset = page.next_page?.offset;
      if (offset && seen.has(offset)) throw new AppError(502, 'Asana could not finish loading the list. Refresh to try again.');
      if (offset) seen.add(offset);
    } while (offset);
    return result;
  }
  async profile() {
    const { data } = await this.get('/users/me', { opt_fields: 'name,workspaces.name' });
    return { gid: data.gid, name: data.name, workspaces: data.workspaces };
  }
  async tasks(workspace, user) {
    const tasks = await this.all('/tasks', {
      workspace, assignee: user, completed_since: 'now',
      opt_fields: 'name,completed,due_on,due_at,projects.name',
    });
    return tasks.filter(task => !task.completed).sort((a, b) =>
      (a.due_on || a.due_at || '9999').localeCompare(b.due_on || b.due_at || '9999') || a.name.localeCompare(b.name));
  }
  async task(gid, user, workspace) {
    const { data } = await this.get(`/tasks/${gid}`, {
      opt_fields: 'name,resource_subtype,notes,html_notes,completed,due_on,due_at,projects.name,assignee.gid,assigned_by.name,created_by.gid,workspace.gid,parent.name,permalink_url',
    });
    if (data.assignee?.gid !== user || data.workspace?.gid !== workspace) {
      throw new AppError(403, 'This task is not assigned to you in the selected workspace. Refresh your task list.');
    }
    return data;
  }
  async history(gid) {
    return this.all(`/tasks/${gid}/stories`, { opt_fields: 'created_at,resource_subtype,text,html_text,created_by.name,assignee.name' });
  }
  async detail(gid, user, workspace) {
    const task = await this.task(gid, user, workspace);
    const result = { ...task, html_notes: undefined, descriptionHtml: task.html_notes, descriptionVersion: descriptionVersion(task), previousAssignee: null, handoffRecipient: handoffRecipient(task, [], user), comments: [], attachments: [] };
    try {
      const history = await this.history(gid);
      result.previousAssignee = previousAssignee(history, user);
      result.handoffRecipient = handoffRecipient(task, history, user);
      result.comments = history.filter(s => s.resource_subtype === 'comment_added');
    } catch { result.historyUnavailable = true; }
    try { result.attachments = await this.all('/attachments', { parent: gid, opt_fields: 'name,resource_subtype,size,permanent_url,view_url' }); }
    catch { result.attachmentsUnavailable = true; }
    if (result.handoffRecipient && !result.handoffRecipient.name) {
      try { const { data } = await this.get(`/users/${result.handoffRecipient.gid}`, { opt_fields: 'name' }); result.handoffRecipient.name = data.name; }
      catch { /* The known recipient's ID remains visible if their name is unavailable. */ }
    }
    return result;
  }
  async attachmentUrl(gid, attachmentGid, user, workspace) {
    await this.task(gid, user, workspace);
    const { data } = await this.get(`/attachments/${attachmentGid}`, { opt_fields: 'parent.gid,download_url,view_url,permanent_url' });
    if (data.parent?.gid !== gid) throw new AppError(403, 'This file does not belong to the selected task.');
    const url = [data.download_url, data.view_url, data.permanent_url].map(safeAttachmentUrl).find(Boolean);
    if (!url) throw new AppError(404, 'A download link is not available for this attachment.');
    return url;
  }
  async append(gid, user, workspace, body) {
    const task = await this.task(gid, user, workspace);
    const text = validateText(body.text);
    if (body.descriptionVersion !== descriptionVersion(task)) throw new AppError(409, 'The description changed since you opened it. Reload the task, review the instructions, then submit your addition again. Your draft has been kept.');
    const html_notes = appendDescription(task, text);
    const { data } = await this.request(`/tasks/${gid}`, { opt_fields: 'notes,html_notes' }, 'PUT', { html_notes });
    return { notes: data.notes, descriptionHtml: data.html_notes, descriptionVersion: descriptionVersion(data) };
  }
  async comment(gid, user, workspace, body) {
    await this.task(gid, user, workspace);
    validateText(body.text);
    if (!body.mentions?.length) return (await this.request(`/tasks/${gid}/stories`, {}, 'POST', { text: validateText(body.text) })).data;
    const html_text = richComment(body.text, body.mentions, this.mentionPeople, workspace);
    const followers = [...new Set(body.mentions.map(mention => mention.gid))];
    await this.request(`/tasks/${gid}/addFollowers`, {}, 'POST', { followers });
    await this.wait(3000);
    try {
      // Ownership can change while Asana processes the follower update.
      await this.task(gid, user, workspace);
      return (await this.request(`/tasks/${gid}/stories`, {}, 'POST', { html_text })).data;
    } catch (err) {
      throw new AppError(err.status || 502, err.message + ' Selected people may already have been added as collaborators.');
    }
  }
  async people(gid, user, workspace, query) {
    await this.task(gid, user, workspace);
    if (typeof query !== 'string' || query.length > 80) throw new AppError(400, 'Use a shorter name to search for a person.');
    const { data } = await this.get(`/workspaces/${workspace}/typeahead`, { resource_type: 'user', query, count: '10', opt_fields: 'name' });
    const people = data.filter(person => /^\d+$/.test(person.gid) && person.name).map(person => ({ gid: person.gid, name: person.name }));
    for (const person of people) this.mentionPeople.set(`${workspace}:${person.gid}`, person);
    return people;
  }
  async reassign(gid, user, workspace, body) {
    const task = await this.task(gid, user, workspace);
    let history = [];
    try { history = await this.history(gid); } catch { /* Creator/assigner fallback is available on the task itself. */ }
    const previous = handoffRecipient(task, history, user);
    if (!previous || previous.gid !== body.assignee) throw new AppError(409, 'The hand-back recipient could not be confirmed or has changed. Reload the task before handing it back.');
    await this.task(gid, user, workspace);
    await this.request(`/tasks/${gid}`, {}, 'PUT', { assignee: previous.gid });
    return { assignee: previous };
  }
  async upload(gid, file, filename) {
    const form = new FormData();
    form.set('parent', gid); form.set('file', new Blob([file]), encodeURIComponent(filename));
    return (await this.request('/attachments', {}, 'POST', form)).data;
  }
  async complete(gid, user, workspace) {
    await this.task(gid, user, workspace);
    const { data } = await this.request(`/tasks/${gid}`, { opt_fields: 'completed' }, 'PUT', { completed: true });
    if (data.completed !== true) throw new AppError(502, 'Completion could not be confirmed. Check the task in Asana before trying again.');
    return { completed: true };
  }
}

export function richComment(text, mentions, people, workspace) {
  validateText(text);
  if (!Array.isArray(mentions) || mentions.length > 20) throw new AppError(400, 'Use no more than 20 mentions in one comment.');
  let cursor = 0; let html = '<body>';
  for (const mention of [...mentions].sort((a, b) => a.start - b.start)) {
    const person = people.get(`${workspace}:${mention.gid}`);
    if (!person || !Number.isInteger(mention.start) || !Number.isInteger(mention.end) || mention.start < cursor || mention.end <= mention.start || mention.end > text.length || text.slice(mention.start, mention.end) !== `@${person.name}`) {
      throw new AppError(400, 'A selected mention changed. Remove it and select the person again before posting.');
    }
    html += escapeXml(text.slice(cursor, mention.start)) + `<a data-asana-gid="${person.gid}"></a>`;
    cursor = mention.end;
  }
  return html + escapeXml(text.slice(cursor)) + '</body>';
}

function validateText(value) {
  if (typeof value !== 'string' || !value.trim()) throw new AppError(400, 'Enter some text before submitting.');
  if (value.length > 10000) throw new AppError(400, 'Use 10,000 characters or fewer.');
  return value.trim();
}
async function readFileBody(req) {
  const chunks = []; let size = 0;
  if (Number(req.headers['content-length']) > MAX_FILE_SIZE) throw new AppError(413, 'Choose a file of 25 MiB or smaller.');
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_FILE_SIZE) throw new AppError(413, 'Choose a file of 25 MiB or smaller.');
    chunks.push(chunk);
  }
  if (!size) throw new AppError(400, 'Choose a non-empty file.');
  return Buffer.concat(chunks);
}

async function readBody(req) {
  let body = ''; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new AppError(413, 'The submitted information is too large.');
    body += chunk;
  }
  try { return JSON.parse(body); } catch { throw new AppError(400, 'Could not read the submitted information.'); }
}

export function createApp({ fetchImpl = fetch, waitImpl, credentialStore = new CredentialStore(), dashboardOptions = {} } = {}) {
  const dashboard = createDashboardServices({ fetchImpl, ...dashboardOptions });
  const sessions = new Map();
  const writing = new Set();
  const cleanup = setInterval(() => {
    for (const [id, session] of sessions) if (session.expires < Date.now()) sessions.delete(id);
  }, 60000).unref();
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };
    try {
      const expectedHost = `127.0.0.1:${server.address().port}`;
      const origin = `http://${expectedHost}`;
      const url = new URL(req.url, origin);
      const oauthCallback = dashboard.isCallback(url, req);
      if (req.headers.host !== expectedHost && !oauthCallback) throw new AppError(403, 'Open this app using its 127.0.0.1 address.');
      if (req.headers.origin && req.headers.origin !== origin && !oauthCallback) throw new AppError(403, 'This request must come from the local app.');
      if (assets.has(url.pathname) && req.method === 'GET') {
        const [path, type] = assets.get(url.pathname);
        res.writeHead(200, { 'Content-Type': type });
        res.end(await readFile(new URL(path, import.meta.url))); return;
      }
      if (!url.pathname.startsWith('/api/')) throw new AppError(404, 'Page not found.');
      // Custom header forces cross-origin requests to preflight; no CORS is enabled.
      const download = req.method === 'GET' && url.pathname.match(/^\/api\/tasks\/(\d+)\/attachments\/(\d+)\/download$/);
      // Download links use normal browser navigation with the same HttpOnly session cookie.
      const oauthNavigation = req.method === 'GET' && ['/api/slack/oauth/callback','/api/slack/oauth/finish'].includes(url.pathname);
      if (!download && !oauthNavigation && req.headers['x-beausana'] !== 'local') throw new AppError(403, 'This request must come from the local app.');
      if (await dashboard.handle(req,res,url,{json,readBody,readFileBody,localOrigin:origin})) return;
      const cookie = req.headers.cookie?.match(/(?:^|;\s*)beausana=([a-f0-9]{64})(?:;|$)/)?.[1];
      const session = cookie && sessions.get(cookie);
      if(url.pathname === '/api/connection-limits' && req.method==='GET'){
        json(200,{asana:session?.expires>Date.now()?session.expires:undefined,slack:dashboard.limit(req)});return;
      }
      if(url.pathname === '/api/extend-session' && req.method==='POST'){
        const cookies=[];
        if(session?.expires>Date.now()){
          session.expires=Date.now()+SESSION_TTL;
          cookies.push(`beausana=${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
        }
        const slackCookie=dashboard.extend(req);if(slackCookie)cookies.push(slackCookie);
        if(!cookies.length)throw new AppError(401,'Reconnect to extend your connection. Your drafts remain on this page.');
        res.setHeader('Set-Cookie',cookies);json(200,{asana:session?.expires>Date.now()?session.expires:undefined,slack:dashboard.limit(req)});return;
      }
      if (url.pathname === '/api/saved-token' && req.method === 'GET') {
        json(200, { supported: credentialStore.supported, saved: await credentialStore.exists() }); return;
      }
      if (url.pathname === '/api/forget-token' && req.method === 'POST') {
        try { await credentialStore.forget(); } catch { throw new AppError(500, 'The saved token could not be removed. Please try again.'); }
        sessions.clear();
        res.setHeader('Set-Cookie', 'beausana=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        json(200, { forgotten: true }); return;
      }
      if (url.pathname === '/api/connect' && req.method === 'POST') {
        const body = await readBody(req);
        if (body.useSaved === true) {
          try { body.token = await credentialStore.load(); } catch { throw new AppError(400, 'The saved token could not be read. Forget it and enter your token again.'); }
        }
        if (typeof body.token !== 'string' || !body.token.trim() || body.token.length > 4096) {
          throw new AppError(400, 'Enter your own Asana personal access token.');
        }
        const client = new AsanaReader(body.token.trim(), fetchImpl, waitImpl);
        const profile = await client.profile();
        let warning;
        if (body.useSaved !== true) {
          try {
            if (body.remember === true) await credentialStore.save(body.token.trim());
            else await credentialStore.forget();
          } catch {
            if (body.remember !== true) throw new AppError(500, 'The previously saved token could not be removed. Use Forget saved token before connecting with a different token.');
            warning = 'Connected for this session, but Windows could not save this token. Any previously saved token has not been replaced. Keep your token available and try remembering it again later.';
          }
        }
        if (cookie) sessions.delete(cookie);
        const id = randomBytes(32).toString('hex');
        sessions.set(id, { client, profile, expires: Date.now() + SESSION_TTL });
        res.setHeader('Set-Cookie', `beausana=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
        json(200, { profile, ...(warning ? { warning } : {}) }); return;
      }
      if (url.pathname === '/api/disconnect' && req.method === 'POST') {
        if (cookie) sessions.delete(cookie);
        res.setHeader('Set-Cookie', 'beausana=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        json(200, { disconnected: true }); return;
      }
      if (!session || session.expires < Date.now()) {
        if (cookie) sessions.delete(cookie);
        throw new AppError(401, 'Connect to Asana to load your tasks. Your connection may have expired.');
      }
      if (url.pathname === '/api/session' && req.method === 'GET') { json(200, { profile: session.profile }); return; }
      const workspace = url.searchParams.get('workspace');
      if (!session.profile.workspaces.some(item => item.gid === workspace)) {
        throw new AppError(400, 'Choose one of your Asana workspaces.');
      }
      if (download) {
        const location = await session.client.attachmentUrl(download[1], download[2], session.profile.gid, workspace);
        res.writeHead(302, { Location: location }); res.end(); return;
      }
      const saveDownload = url.pathname.match(/^\/api\/tasks\/(\d+)\/attachments\/(\d+)\/save$/);
      if (saveDownload && req.method === 'POST') {
        const task = await session.client.detail(saveDownload[1], session.profile.gid, workspace);
        const file = task.attachments.find(a => a.gid === saveDownload[2]);
        if (!file || file.resource_subtype && file.resource_subtype !== 'asana') throw new AppError(400, 'Use the file-provider link for this attachment.');
        const location = await session.client.attachmentUrl(saveDownload[1],saveDownload[2],session.profile.gid,workspace);
        json(200,{file:await dashboard.downloadStore.save(dashboard.owner(req,res),location,file.name)});return;
      }
      if (url.pathname === '/api/tasks' && req.method === 'GET') {
        json(200, { tasks: await session.client.tasks(workspace, session.profile.gid) }); return;
      }
      const match = url.pathname.match(/^\/api\/tasks\/(\d+)$/);
      if (match && req.method === 'GET') {
        json(200, { task: await session.client.detail(match[1], session.profile.gid, workspace) }); return;
      }
      const peopleMatch = url.pathname.match(/^\/api\/tasks\/(\d+)\/people$/);
      if (peopleMatch && req.method === 'GET') {
        json(200, { people: await session.client.people(peopleMatch[1], session.profile.gid, workspace, url.searchParams.get('query') || '') }); return;
      }
      const action = url.pathname.match(/^\/api\/tasks\/(\d+)\/(description|comments|file|reassign|complete)$/);
      if (action && req.method === 'POST') {
        const [, gid, kind] = action;
        if (writing.has(gid)) throw new AppError(409, 'Another update is still being saved for this task. Wait for it to finish.');
        writing.add(gid);
        try {
          const client = session.client; const user = session.profile.gid;
          let result;
          if (kind === 'file') {
            await client.task(gid, user, workspace);
            let filename;
            try { filename = decodeURIComponent(req.headers['x-file-name'] || ''); } catch { throw new AppError(400, 'The file name is invalid.'); }
            if (!filename || filename.length > 255 || /[\x00-\x1f\\/]/.test(filename)) throw new AppError(400, 'Choose a file with a simple file name.');
            const file = await readFileBody(req);
            await client.task(gid, user, workspace);
            result = await client.upload(gid, file, filename);
          } else {
            const body = await readBody(req);
            if (kind === 'description') result = await client.append(gid, user, workspace, body);
            if (kind === 'comments') result = await client.comment(gid, user, workspace, body);
            if (kind === 'reassign') result = await client.reassign(gid, user, workspace, body);
            if (kind === 'complete') result = await client.complete(gid, user, workspace);
          }
          json(200, { result }); return;
        } finally { writing.delete(gid); }
      }
      if (req.method !== 'GET') throw new AppError(405, 'This action is not available.');
      throw new AppError(404, 'Page not found.');
    } catch (error) {
      json(error.status || 500, { error: error.status ? error.message : 'Something went wrong. Please try again.' });
    }
  });
  server.on('close', () => { clearInterval(cleanup); sessions.clear(); dashboard.close(); });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createApp();
  const openBrowser = () => {
    if (process.argv.includes('--open') && process.platform === 'win32') {
      const child = spawn('cmd.exe', ['/c', 'start', '', 'http://127.0.0.1:4317'], { windowsHide: true, stdio: 'ignore' });
      child.on('error', () => console.log('Open http://127.0.0.1:4317 in your browser.'));
    }
  };
  server.listen(4317, '127.0.0.1', () => {
    console.log('BeauSana is ready: http://127.0.0.1:4317\nKeep this window open. Press Ctrl+C to stop.');
    openBrowser();
  });
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? 'BeauSana may already be running. Open http://127.0.0.1:4317' : 'Could not start BeauSana.');
    if (error.code === 'EADDRINUSE') openBrowser();
    process.exitCode = 1;
  });
}
