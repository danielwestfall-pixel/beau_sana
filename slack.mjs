export class SlackError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function slackConfig(env = process.env) {
  return { clientId: env.SLACK_CLIENT_ID, clientSecret: env.SLACK_CLIENT_SECRET,
    redirectUri: env.SLACK_REDIRECT_URI, workspaceId: env.SLACK_WORKSPACE_ID,
    workspaceDomain: env.SLACK_WORKSPACE_DOMAIN || 'quavered',
    channelId: env.SLACK_DEFAULT_CHANNEL_ID || 'C0C7Q7AJT7Y', privateChannel: env.SLACK_PRIVATE_CHANNEL === 'true',
    groupDms: env.SLACK_GROUP_DMS === 'true' };
}
export function slackScopes(config) {
  return ['channels:read', 'channels:history', 'im:read', 'im:history', 'users:read', 'chat:write',
    'files:read', 'files:write', 'reactions:read', 'reactions:write',
    ...(config.privateChannel ? ['groups:read', 'groups:history'] : []),
    ...(config.groupDms ? ['mpim:read', 'mpim:history'] : [])];
}
export function slackReady(config) {
  try { const u = new URL(config.redirectUri);
    return !!(config.clientId && config.clientSecret && (/^T[A-Z0-9]+$/.test(config.workspaceId) || /^[a-z0-9-]+$/.test(config.workspaceDomain)) &&
      /^[CG][A-Z0-9]+$/.test(config.channelId) && u.protocol === 'https:' &&
      u.pathname === '/api/slack/oauth/callback' && !u.search && !u.hash && !u.username && !u.password);
  } catch { return false; }
}
export function validTimestamp(ts) {
  if (typeof ts !== 'string' || !/^\d{10,16}\.\d{6}$/.test(ts)) throw new SlackError(400, 'Choose a valid Slack message.');
  return ts;
}
export async function slackCall(method, token, data, fetchImpl = fetch) {
  const response = await fetchImpl(`https://slack.com/api/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data), signal: AbortSignal.timeout(30000), redirect: 'error'
  });
  if (response.status === 429) throw new SlackError(429, `Slack is limiting requests. Try again in ${Math.max(1, Number(response.headers.get('retry-after')) || 60)} seconds.`);
  if (!response.ok) throw new SlackError(502, 'Slack could not complete this request. Try again later.');
  const result = await response.json();
  if (!result.ok) {
    if (method === 'reactions.add' && result.error === 'already_reacted' || method === 'reactions.remove' && result.error === 'no_reaction') return { ok: true };
    const messages = { missing_scope: 'Slack needs additional permission for this action. Ask the app administrator to update permissions and reconnect.',
      token_revoked: 'Your Slack authorization was revoked. Reconnect to Slack.', token_expired: 'Your Slack connection expired. Reconnect.',
      not_authed: 'Reconnect to Slack.', invalid_auth: 'Reconnect to Slack.', channel_not_found: 'This conversation is unavailable to your account.',
      not_in_channel: 'Join the configured channel in Slack first.', not_allowed_token_type: 'This action needs a Slack user authorization.',
      file_not_found: 'This file is no longer available.', restricted_action: 'Workspace policy does not allow this action.' };
    throw new SlackError(400, messages[result.error] || 'Slack could not confirm this action. Check Slack before repeating a send or upload.');
  }
  return result;
}
export async function exchangeSlack(config, data, fetchImpl = fetch) {
  const response = await fetchImpl('https://slack.com/api/oauth.v2.access', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...data }),
    signal: AbortSignal.timeout(30000), redirect: 'error'
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new SlackError(400, 'Slack authorization failed. Start Connect Slack again.');
  return result;
}
export class SlackClient {
  constructor(auth, config, fetchImpl = fetch, persist = async () => {}) {
    this.auth = auth; this.config = config; this.fetch = fetchImpl; this.persist = persist;
    this.names = new Map(); this.files = new Map(); this.refreshing = null;
  }
  async call(method, data = {}) {
    if (this.auth.expiresAt && Date.now() > this.auth.expiresAt - 60000) {
      if (!this.auth.refreshToken) throw new SlackError(401, 'Reconnect to Slack.');
      this.refreshing ||= (async () => {
        const r = await exchangeSlack(this.config, { grant_type: 'refresh_token', refresh_token: this.auth.refreshToken }, this.fetch);
        this.auth = { ...this.auth, token: r.access_token, refreshToken: r.refresh_token, expiresAt: Date.now() + r.expires_in * 1000 };
        await this.persist(this.auth);
      })().finally(() => { this.refreshing = null; });
      await this.refreshing;
    }
    return slackCall(method, this.auth.token, data, this.fetch);
  }
  async allowed(id) {
    if (typeof id !== 'string' || !/^[CDG][A-Z0-9]+$/.test(id)) throw new SlackError(400, 'Choose a conversation.');
    const { channel } = await this.call('conversations.info', { channel: id });
    if (id === this.config.channelId) {
      if (channel.is_member !== true) throw new SlackError(403, 'Join the configured channel in Slack first.');
    } else if (!channel.is_im && !(this.config.groupDms && channel.is_mpim)) {
      throw new SlackError(403, 'This dashboard only allows the default channel and your direct messages.');
    }
    return channel;
  }
  async name(id) {
    if (!id) return 'Slack app';
    if (!this.names.has(id)) {
      try { const { user } = await this.call('users.info', { user: id }); this.names.set(id, user.profile?.display_name || user.real_name || user.name || id); }
      catch { return id; }
    }
    return this.names.get(id);
  }
  async conversations({ summaries = false } = {}) {
    const main = await this.allowed(this.config.channelId);
    const list = [{ id: main.id, name: `#${main.name || 'Default channel'}`, kind: 'channel' }];
    let cursor; const seen = new Set();
    do {
      const r = await this.call('conversations.list', { types: this.config.groupDms ? 'im,mpim' : 'im', exclude_archived: true, limit: 100, ...(cursor ? { cursor } : {}) });
      for (const c of r.channels || []) {
        if (c.is_user_deleted || c.is_archived || c.is_open === false) continue;
        let summary={};
        if(summaries && list.filter(x=>x.kind==='dm').length<20){
          const detail=await this.allowed(c.id);summary={latest:detail.latest?.ts,lastRead:detail.last_read,unread:detail.unread_count_display};
        }
        list.push({ id: c.id, name: c.is_im ? await this.name(c.user) : c.name || 'Group direct message', kind: 'dm',...summary });
      }
      cursor = r.response_metadata?.next_cursor;
      if (cursor && seen.has(cursor)) throw new SlackError(502, 'Slack repeated a conversation page. Try again later.');
      seen.add(cursor);
    } while (cursor);
    return list;
  }
  async messages(channel, { thread, cursor, oldest } = {}) {
    await this.allowed(channel);
    if (thread) validTimestamp(thread);
    const r = await this.call(thread ? 'conversations.replies' : 'conversations.history', {
      channel, limit: 30, ...(thread ? { ts: thread } : {}), ...(cursor ? { cursor } : {}), ...(oldest ? { oldest: validTimestamp(oldest), inclusive: false } : {})
    });
    const messages = [];
    for (const m of r.messages || []) {
      if (!m.ts || (m.subtype && !['file_share', 'bot_message', 'thread_broadcast'].includes(m.subtype))) continue;
      const files = (m.files || []).filter(f => f.id && f.name).map(f => {
        this.files.set(`${channel}:${f.id}`, { ts: m.ts, thread });
        return { id: f.id, name: f.name, size: f.size, external: !!f.is_external };
      });
      let text = m.text || '';
      const ids = [...new Set([...text.matchAll(/<@([A-Z0-9]+)>/g)].map(x => x[1]))];
      for (const id of ids) text = text.replaceAll(`<@${id}>`, `@${await this.name(id)}`);
      text = text.replace(/<#([A-Z0-9]+)\|([^>]+)>/g, '#$2').replace(/<!here>/g, '@here').replace(/<!channel>/g, '@channel').replace(/<!everyone>/g, '@everyone');
      messages.push({ ts: m.ts, author: m.username || await this.name(m.user), text,
        replyCount: m.reply_count || 0, files, reactions: (m.reactions || []).map(r => ({ name: r.name, count: r.count, mine: r.users?.includes(this.auth.userId) || false })) });
    }
    messages.sort((a,b) => Number(a.ts) - Number(b.ts));
    return { messages, cursor: r.response_metadata?.next_cursor || '', hasMore: !!r.has_more };
  }
  async send(channel, text, thread) {
    await this.allowed(channel);
    if (typeof text !== 'string' || !text.trim() || text.length > 10000) throw new SlackError(400, 'Enter a message of 1 to 10,000 characters.');
    if (thread) validTimestamp(thread);
    const r = await this.call('chat.postMessage', { channel, text, ...(thread ? { thread_ts: thread } : {}), unfurl_links: false, unfurl_media: false });
    return { ts: r.ts };
  }
  async react(channel, ts, name, remove = false) {
    await this.allowed(channel); validTimestamp(ts);
    if (!['thumbsup', 'eyes', 'white_check_mark'].includes(name)) throw new SlackError(400, 'Choose one of the available responses.');
    await this.call(remove ? 'reactions.remove' : 'reactions.add', { channel, timestamp: ts, name });
  }
  async upload(channel, bytes, filename, thread, comment) {
    await this.allowed(channel); if (thread) validTimestamp(thread);
    const r = await this.call('files.getUploadURLExternal', { filename, length: bytes.length });
    const url = new URL(r.upload_url);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.slack.com') || url.username || url.password || url.port && url.port !== '443') throw new SlackError(502, 'Slack returned an invalid upload destination.');
    const response = await this.fetch(url.href, { method: 'POST', body: bytes, headers: { 'Content-Type': 'application/octet-stream' }, redirect: 'error', signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new SlackError(502, 'The upload was not completed.');
    await this.call('files.completeUploadExternal', { files: [{ id: r.file_id, title: filename }], channel_id: channel,
      ...(thread ? { thread_ts: thread } : {}), ...(comment ? { initial_comment: comment } : {}) });
    return { id: r.file_id, name: filename };
  }
  async file(channel, id) {
    await this.allowed(channel);
    const known = this.files.get(`${channel}:${id}`);
    if (!known) throw new SlackError(403, 'Open the message containing this file before downloading it.');
    const r = await this.call(known.thread ? 'conversations.replies' : 'conversations.history', {
      channel, oldest: known.ts, latest: known.ts, inclusive: true, limit: 1, ...(known.thread ? { ts: known.thread } : {})
    });
    if (!(r.messages || []).some(m => m.ts === known.ts && m.files?.some(f => f.id === id))) throw new SlackError(403, 'This file is no longer attached to this message.');
    const { file } = await this.call('files.info', { file: id });
    if (file.is_external || !file.url_private_download) throw new SlackError(400, 'This is an external file. Open it in Slack or its file provider.');
    return { url: file.url_private_download, name: file.name, token: this.auth.token };
  }
}
