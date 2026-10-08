import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { slackConfig, slackScopes } from '../slack.mjs';
const config={...slackConfig({}),clientId:'123.456',clientSecret:'fictional-secret',redirectUri:'https://callback.example/api/slack/oauth/callback'};
async function app(t,{domain='quavered',user='UME'}={}){
  let saved;const store={supported:true,exists:async()=>!!saved,save:async value=>{saved=value;},load:async()=>saved,forget:async()=>{saved=undefined;}};
  const server=createApp({credentialStore:store,dashboardOptions:{config,slackStore:store},fetchImpl:async(url,options)=>{
    if(url.endsWith('/oauth.v2.access'))return Response.json({ok:true,team:{id:'TTEST'},authed_user:{id:'UME',token_type:'user',access_token:'fictional-user-token',scope:slackScopes(config).join(',')}});
    if(url.endsWith('/auth.test'))return Response.json({ok:true,user:'Example',user_id:user,team_id:'TTEST',url:`https://${domain}.slack.com/`});
    throw new Error('Unexpected external request '+url);
  }});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const port=server.address().port;
  function request(path,{method='GET',cookie,body,host=`127.0.0.1:${port}`,header=true,origin}={}){return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path,method,headers:{Host:host,...(header?{'X-BeauSana':'local'}:{}),...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...(origin?{Origin:origin}:{})}},res=>{
      let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text,json:()=>JSON.parse(text)}));
    });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
  });}
  const status=await request('/api/slack/status'),cookie=status.headers['set-cookie'][0].split(';')[0];
  async function start(){const r=await request('/api/slack/connect',{method:'POST',cookie,body:{remember:true}});const u=new URL(r.json().url);assert.equal(u.searchParams.get('scope'),null);assert(u.searchParams.get('user_scope').includes('files:write'));return u.searchParams.get('state');}
  return{request,cookie,start,saved:()=>saved,port};
}
test('Slack OAuth returns to original local session, stores no credentials in browser and rejects state replay',async t=>{
  const a=await app(t),state=await a.start();
  const callback=await a.request(`/api/slack/oauth/callback?state=${state}&code=temporary`,{host:'callback.example',header:false});assert.equal(callback.status,302);assert(!callback.headers.location.includes('fictional'));
  const finish=new URL(callback.headers.location);const connected=await a.request(finish.pathname+finish.search,{cookie:a.cookie,header:false});assert.equal(connected.status,302);assert.equal(connected.headers.location,'/slack.html');assert(a.saved().includes('fictional-user-token'));
  const status=await a.request('/api/slack/status',{cookie:a.cookie});assert.equal(status.json().connected,true);assert(!status.text.includes('fictional'));
  const limit=(await a.request('/api/connection-limits',{cookie:a.cookie})).json().slack;assert(limit>Date.now());
  const extended=await a.request('/api/extend-session',{method:'POST',cookie:a.cookie,body:{}});assert.equal(extended.status,200);assert(extended.json().slack>=limit);assert(extended.headers['set-cookie'][0].includes('beaudash='));
  assert.equal((await a.request(`/api/slack/oauth/callback?state=${state}&code=temporary`,{host:'callback.example',header:false})).status,400);
  assert.equal((await a.request(finish.pathname+finish.search,{cookie:a.cookie,header:false})).status,400);
  await a.request('/api/slack/forget',{cookie:a.cookie,method:'POST',body:{}});assert.equal(a.saved(),undefined);assert.equal((await a.request('/api/slack/status',{cookie:a.cookie})).json().connected,false);
});
test('Slack callback accepts only configured host/path and needs the initiating session to finish',async t=>{
  const a=await app(t);assert.equal((await a.request('/api/slack/status',{host:'evil.example'})).status,403);
  assert.equal((await a.request('/api/slack/connect',{cookie:a.cookie,method:'POST',body:{},header:false})).status,403);
  assert.equal((await a.request('/api/slack/connect',{cookie:a.cookie,method:'POST',body:{},origin:'https://evil.example'})).status,403);
  const state=await a.start();const callback=await a.request(`/api/slack/oauth/callback?state=${state}&code=temporary`,{host:'callback.example',header:false});const finish=new URL(callback.headers.location);
  assert.equal((await a.request(finish.pathname+finish.search,{header:false})).status,400);assert.equal(a.saved(),undefined);
});
test('Slack OAuth refuses another workspace or a mismatched user',async t=>{
  for(const options of [{domain:'other-workspace'},{user:'UOTHER'}]){const a=await app(t,options),state=await a.start();assert.equal((await a.request(`/api/slack/oauth/callback?state=${state}&code=temporary`,{host:'callback.example',header:false})).status,403);assert.equal(a.saved(),undefined);}
});
test('every dashboard asset is served and contains no embedded credentials',async t=>{
  const a=await app(t);for(const path of ['/','/asana.html','/slack.html','/resources.html','/components.html','/downloads.html','/slack-ui.js','/resources.js','/components.js','/patterns.json','/quick-links.json','/nav.js','/dashboard.js','/download-control.js','/downloads-ui.js']){const r=await a.request(path);assert.equal(r.status,200,path);assert(!r.text.includes('fictional-secret'));}
  const patterns=(await a.request('/patterns.json')).json();assert.equal(patterns.length,30);assert.equal(new Set(patterns.map(p=>p.id)).size,30);assert(patterns.every(p=>p.keyboard&&p.aria&&p.javascript&&p.screenReader));
  assert((await a.request('/quick-links.json')).json().every(p=>p.url===null));
});
