import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { CredentialStore } from './credentials.mjs';
import { SlackClient, SlackError, slackConfig, slackScopes, slackReady, exchangeSlack } from './slack.mjs';
import { DownloadStore } from './downloads.mjs';
export function createDashboardServices({ fetchImpl = fetch, config = slackConfig(), downloadStore = new DownloadStore({ fetchImpl }),
  slackStore = new CredentialStore({ directory: process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'BeauSana', 'Slack') }) } = {}) {
  const sessions = new Map(), pending = new Map();let credentialEpoch=0;
  function session(req, res) {
    const cookie = req.headers.cookie?.match(/(?:^|;\s*)beaudash=([a-f0-9]{64})(?:;|$)/)?.[1];
    let item = cookie && sessions.get(cookie);
    if (!item || item.expires < Date.now()) {
      const id = randomBytes(32).toString('hex'); item = { id, expires: Date.now() + 8*3600000 }; sessions.set(id, item);
      res.setHeader('Set-Cookie', `beaudash=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
    }
    return item;
  }
  function client(auth, remember) {
    const epoch=credentialEpoch;
    return new SlackClient(auth, config, fetchImpl, async value => { if (remember && epoch===credentialEpoch) await slackStore.save(JSON.stringify(value)); });
  }
  const timer = setInterval(() => {
    for (const [id,s] of sessions) if (s.expires < Date.now()) sessions.delete(id);
    for (const [id,p] of pending) if (p.expires < Date.now()) pending.delete(id);
  },60000).unref();
  return { downloadStore,
    close() { clearInterval(timer); sessions.clear(); pending.clear(); },
    isCallback(url, req) {
      if (!slackReady(config)) return false;
      const callback = new URL(config.redirectUri);
      return req.method === 'GET' && url.pathname === callback.pathname && req.headers.host === callback.host;
    },
    async handle(req, res, url, { json, readBody, readFileBody, localOrigin }) {
      if (!url.pathname.startsWith('/api/slack/') && !url.pathname.startsWith('/api/downloads')) return false;
      if (url.pathname === '/api/slack/oauth/callback') {
        if (!slackReady(config)) throw new SlackError(503, 'Slack login is not configured.');
        const p = pending.get(url.searchParams.get('state')); pending.delete(url.searchParams.get('state'));
        if (!p || p.expires < Date.now()) throw new SlackError(400, 'Slack login expired. Start again from the dashboard.');
        if (url.searchParams.has('error')) throw new SlackError(400, 'Slack permission was not granted. Return to the dashboard and try again.');
        const r = await exchangeSlack(config, { code: url.searchParams.get('code') || '', redirect_uri: config.redirectUri }, fetchImpl);
        const a = r.authed_user;
        if (!a?.access_token || !a.id || a.token_type && a.token_type !== 'user') throw new SlackError(400, 'This dashboard needs a Slack user authorization.');
        const test = await new SlackClient({ token: a.access_token },config,fetchImpl).call('auth.test');
        if (test.user_id !== a.id || test.team_id !== r.team?.id || (config.workspaceId && test.team_id !== config.workspaceId) || (config.workspaceDomain && new URL(test.url).hostname !== `${config.workspaceDomain}.slack.com`)) throw new SlackError(403, 'Connect using the configured Slack workspace.');
        const granted = new Set((a.scope || '').split(','));
        if (slackScopes(config).some(scope => !granted.has(scope))) throw new SlackError(400, 'Required Slack permissions were not granted. Update the Slack app and reconnect.');
        const auth = { token: a.access_token, userId: a.id, teamId: r.team.id, name: test.user,
          refreshToken: a.refresh_token, expiresAt: a.expires_in ? Date.now()+a.expires_in*1000 : undefined };
        const ticket = randomBytes(32).toString('hex'); pending.set(ticket, { ...p, auth, expires: Date.now()+60000 });
        res.writeHead(302,{ Location: `${p.localOrigin}/api/slack/oauth/finish?ticket=${ticket}` }); res.end(); return true;
      }
      const s = session(req,res);
      if (url.pathname === '/api/slack/oauth/finish') {
        const p = pending.get(url.searchParams.get('ticket')); pending.delete(url.searchParams.get('ticket'));
        if (!p || p.id !== s.id || p.expires < Date.now()) throw new SlackError(400, 'Return to the browser where you started Slack login and reconnect.');
        s.client = client(p.auth,p.remember); s.remember = p.remember;
        let warning = '';
        if (p.remember) { try { await slackStore.save(JSON.stringify(p.auth)); } catch { warning='not-saved'; s.remember=false;s.client=client(p.auth,false); } }
        else {credentialEpoch++;await slackStore.forget();}
        res.writeHead(302,{ Location: `/slack.html${warning ? '?warning='+warning : ''}` });res.end();return true;
      }
      if (url.pathname === '/api/downloads' && req.method === 'GET') { json(200,{ files: downloadStore.list(s.id), explorerSupported: process.platform==='win32' }); return true; }
      if (url.pathname === '/api/downloads/reveal' && req.method === 'POST') {
        const body=await readBody(req);await downloadStore.show(s.id,body.id);json(200,{shown:true});return true;
      }
      if (url.pathname === '/api/slack/status' && req.method === 'GET') {
        json(200,{ configured: slackReady(config), connected: !!s.client, name:s.client?.auth.name,
          defaultChannel:config.channelId, workspace:config.workspaceDomain, saved:await slackStore.exists(), rememberSupported:slackStore.supported });return true;
      }
      if (url.pathname === '/api/slack/connect' && req.method === 'POST') {
        if (!slackReady(config)) throw new SlackError(503,'Slack login needs administrator setup. Try the demo while the app is configured.');
        const body=await readBody(req), state=randomBytes(32).toString('hex');
        pending.set(state,{ id:s.id, remember:body.remember===true, expires:Date.now()+600000, localOrigin });
        const target=new URL('https://slack.com/oauth/v2/authorize');target.search=new URLSearchParams({client_id:config.clientId,user_scope:slackScopes(config).join(','),redirect_uri:config.redirectUri,state, ...(config.workspaceId ? {team:config.workspaceId}:{})});
        json(200,{url:target.href});return true;
      }
      if (url.pathname === '/api/slack/restore' && req.method === 'POST') {
        if (!slackReady(config)) throw new SlackError(503,'Slack login needs administrator setup.');
        let auth;try { auth=JSON.parse(await slackStore.load()); } catch { throw new SlackError(400,'The saved Slack connection cannot be read. Forget it and reconnect.'); }
        const c=client(auth,true), test=await c.call('auth.test');
        if (test.team_id!==auth.teamId || test.user_id!==auth.userId || (config.workspaceId && test.team_id!==config.workspaceId) || (config.workspaceDomain && new URL(test.url).hostname!==`${config.workspaceDomain}.slack.com`)) throw new SlackError(403,'The saved connection does not match the configured workspace.');
        s.client=c;s.remember=true;json(200,{connected:true});return true;
      }
      if (['/api/slack/disconnect','/api/slack/forget'].includes(url.pathname) && req.method==='POST') {
        if(url.pathname.endsWith('/forget')) {credentialEpoch++;await slackStore.forget();for(const item of sessions.values()){item.client=null;item.remember=false;}}
        s.client=null;json(200,{disconnected:true});return true;
      }
      if (!s.client) throw new SlackError(401,'Connect to Slack to use this feature.');
      const c=s.client, channel=url.searchParams.get('channel'), thread=url.searchParams.get('thread')||undefined;
      if (url.pathname==='/api/slack/conversations' && req.method==='GET') {json(200,{conversations:await c.conversations({summaries:url.searchParams.get('summaries')==='true'})});return true;}
      if (url.pathname==='/api/slack/messages' && req.method==='GET') {json(200,await c.messages(channel,{thread,cursor:url.searchParams.get('cursor')||undefined,oldest:url.searchParams.get('oldest')||undefined}));return true;}
      if (url.pathname==='/api/slack/send' && req.method==='POST') {const b=await readBody(req);json(200,await c.send(channel,b.text,thread));return true;}
      if (url.pathname==='/api/slack/react' && req.method==='POST') {const b=await readBody(req);await c.react(channel,b.ts,b.name,b.remove===true);json(200,{saved:true});return true;}
      if (url.pathname==='/api/slack/upload' && req.method==='POST') {
        const name=decodeURIComponent(req.headers['x-file-name']||'');if(!name||name.length>255||/[\x00-\x1f\\/]/.test(name)) throw new SlackError(400,'Choose a file with a simple name.');
        const bytes=await readFileBody(req);json(200,await c.upload(channel,bytes,name,thread));return true;
      }
      if (url.pathname==='/api/slack/file' && req.method==='POST') {
        const b=await readBody(req), f=await c.file(channel,b.id);json(200,{file:await downloadStore.save(s.id,f.url,f.name,f.token)});return true;
      }
      throw new SlackError(404,'Slack action not found.');
    },
    owner(req,res) { return session(req,res).id; },
    limit(req) {
      const id=req.headers.cookie?.match(/(?:^|;\s*)beaudash=([a-f0-9]{64})(?:;|$)/)?.[1],s=sessions.get(id);
      return s?.client && s.expires>Date.now() ? s.expires : undefined;
    },
    extend(req) {
      const id=req.headers.cookie?.match(/(?:^|;\s*)beaudash=([a-f0-9]{64})(?:;|$)/)?.[1],s=sessions.get(id);
      if(!s?.client || s.expires<Date.now())return;
      s.expires=Date.now()+8*3600000;
      return `beaudash=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`;
    }
  };
}
