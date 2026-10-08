import test from 'node:test';
import assert from 'node:assert/strict';
import { SlackClient, slackScopes, slackConfig, slackReady, slackCall } from '../slack.mjs';
const config={...slackConfig({}),clientId:'123.456',clientSecret:'secret',redirectUri:'https://callback.example/api/slack/oauth/callback'};
const ts='1791311000.000001';
function fixture(overrides={}){
  const calls=[];
  const data={
    'conversations.info':b=>({channel:{id:b.channel,is_member:true,is_im:b.channel.startsWith('D'),name:'a11y-auditing',last_read:ts,latest:{ts},unread_count_display:2}}),
    'conversations.list':()=>({channels:[{id:'DTEST',user:'UOTHER',is_im:true,is_open:true},{id:'DCLOSED',is_open:false}],response_metadata:{next_cursor:''}}),
    'users.info':()=>({user:{profile:{display_name:'Colleague'}}}),
    'conversations.history':()=>({messages:[{ts,user:'UOTHER',text:'Hello <@UOTHER> <https://example.com|Reference>',files:[{id:'FTEST',name:'audit.txt',size:3}],reactions:[{name:'eyes',count:1,users:['UME']}]}]}),
    'conversations.replies':()=>({messages:[{ts,user:'UOTHER',text:'Thread',files:[{id:'FTEST',name:'audit.txt'}]}]}),
    'chat.postMessage':()=>({ts}), 'reactions.add':()=>({}), 'reactions.remove':()=>({}),
    'files.getUploadURLExternal':()=>({upload_url:'https://files.slack.com/upload/example',file_id:'FNEW'}),
    'files.completeUploadExternal':()=>({}),
    'files.info':()=>({file:{name:'audit.txt',url_private_download:'https://files.slack.com/audit.txt'}}),...overrides
  };
  const fetchImpl=async(url,options)=>{
    if(url.includes('/upload/')){calls.push({method:'bytes',options});return new Response('OK');}
    const method=url.split('/').at(-1),body=JSON.parse(options.body);calls.push({method,body,options});
    assert.equal(options.headers.Authorization,'Bearer test-user-token');
    if(!data[method])throw new Error('Unexpected method '+method);
    const value=await data[method](body);return Response.json({ok:true,...value});
  };
  return {client:new SlackClient({token:'test-user-token',userId:'UME'},config,fetchImpl),calls};
}
test('Slack setup uses user scopes, configured workspace and optional private/group scopes',()=>{
  assert(slackReady(config));assert(!slackReady({...config,redirectUri:'http://example.com/api/slack/oauth/callback'}));
  assert(!slackReady({...config,redirectUri:'https://example.com/wrong'}));assert(!slackScopes(config).includes('groups:history'));
  assert(slackScopes({...config,privateChannel:true,groupDms:true}).includes('mpim:history'));
});
test('Slack conversations list default channel and active DMs; metadata supports notices',async()=>{
  const {client}=fixture();const list=await client.conversations({summaries:true});assert.deepEqual(list.map(x=>x.id),[config.channelId,'DTEST']);assert.equal(list[1].name,'Colleague');assert.equal(list[1].unread,2);
});
test('Slack blocks arbitrary channels before a mutation, permits the configured channel and DMs',async()=>{
  const {client,calls}=fixture();await assert.rejects(client.send('COTHER','no'),/only allows/);assert(!calls.some(c=>c.method==='chat.postMessage'));
  await client.send('DTEST','yes',ts);const write=calls.find(c=>c.method==='chat.postMessage');assert.equal(write.body.thread_ts,ts);assert.equal(write.body.unfurl_links,false);
  await assert.rejects(client.send('DTEST',''),/Enter a message/);await assert.rejects(client.send('DTEST','x','bad'),/valid Slack message/);
});
test('Slack messages resolve mentions and identify reactions without rendering markup',async()=>{
  const {client}=fixture();const result=await client.messages(config.channelId);assert(result.messages[0].text.includes('@Colleague'));assert.equal(result.messages[0].reactions[0].mine,true);assert.equal(result.messages[0].files[0].id,'FTEST');
});
test('Slack responses use timestamp and fixed emojis; unsupported reactions never write',async()=>{
  const {client,calls}=fixture();await client.react('DTEST',ts,'eyes');await client.react('DTEST',ts,'thumbsup',true);
  assert.deepEqual(calls.find(c=>c.method==='reactions.add').body,{channel:'DTEST',timestamp:ts,name:'eyes'});
  await assert.rejects(client.react('DTEST',ts,'arbitrary'),/available responses/);
});
test('Slack modern upload relays bytes without token and completes into the chosen thread',async()=>{
  const {client,calls}=fixture();await client.upload('DTEST',Buffer.from('abc'),'audit.txt',ts);
  const raw=calls.find(c=>c.method==='bytes');assert.equal(raw.options.headers.Authorization,undefined);assert.equal(raw.options.body.toString(),'abc');
  const complete=calls.find(c=>c.method==='files.completeUploadExternal');assert.equal(complete.body.channel_id,'DTEST');assert.equal(complete.body.thread_ts,ts);
});
test('Slack upload rejects off-domain destinations before forwarding bytes',async()=>{
  const {client,calls}=fixture({'files.getUploadURLExternal':()=>({upload_url:'https://slack.com.evil.example/upload',file_id:'FNEW'})});await assert.rejects(client.upload('DTEST',Buffer.from('x'),'x'),/invalid upload/);assert(!calls.some(c=>c.method==='bytes'));
});
test('Slack file download requires loaded message association and revalidates removal',async()=>{
  let removed=false;const {client}=fixture({'conversations.history':()=>({messages:removed?[]:[{ts,text:'file',files:[{id:'FTEST',name:'audit.txt'}]}]})});
  await assert.rejects(client.file('DTEST','FTEST'),/Open the message/);await client.messages('DTEST');assert.equal((await client.file('DTEST','FTEST')).token,'test-user-token');removed=true;await assert.rejects(client.file('DTEST','FTEST'),/no longer attached/);
});
test('thread-file revalidation targets its exact timestamp rather than only the first reply page',async()=>{
  const {client,calls}=fixture();await client.messages('DTEST',{thread:ts});await client.file('DTEST','FTEST');
  const query=calls.filter(c=>c.method==='conversations.replies').at(-1).body;
  assert.equal(query.ts,ts);assert.equal(query.oldest,ts);assert.equal(query.latest,ts);assert.equal(query.inclusive,true);
});
test('Slack rate limits and remote failures give safe messages without exposing bodies',async()=>{
  await assert.rejects(slackCall('chat.postMessage','private',{},async()=>new Response('private remote text',{status:429,headers:{'Retry-After':'30'}})),/30 seconds/);
  await assert.rejects(slackCall('chat.postMessage','private',{},async()=>Response.json({ok:false,error:'private secret'})),e=>!e.message.includes('private'));
});
test('Slack rotating user token is refreshed once for concurrent requests and persisted',async()=>{
  let refreshes=0,persisted;const calls=[];
  const c=new SlackClient({token:'old',refreshToken:'old-refresh',expiresAt:Date.now()-1000,userId:'UME'},config,async(url,options)=>{
    if(url.endsWith('/oauth.v2.access')){refreshes++;assert(new URLSearchParams(options.body).get('refresh_token')==='old-refresh');await new Promise(resolve=>setTimeout(resolve,5));return Response.json({ok:true,access_token:'new',refresh_token:'new-refresh',expires_in:43200});}
    calls.push(options.headers.Authorization);return Response.json({ok:true,user_id:'UME'});
  },async auth=>{persisted={...auth};});
  await Promise.all([c.call('auth.test'),c.call('auth.test')]);assert.equal(refreshes,1);assert.deepEqual(calls,['Bearer new','Bearer new']);assert.equal(persisted.refreshToken,'new-refresh');assert(persisted.expiresAt>Date.now());
});
