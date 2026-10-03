import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createApp} from '../server.mjs';
test('OAuth identity, explicit consent, CSRF, fixed role and replay protection',async()=>{
 const guildId='1555677916426141919',roleId='1555679995471462410',userId='1555677916426141920';let grants=0;
 const app=createApp({config:{publicUrl:'https://verify.example.com',clientId:guildId,clientSecret:'test-only',botToken:'test-only',guildId,roleId,termsApproved:true},terms:{version:'1',approved:true,sections:[]},fetchImpl:async(url,options)=>{
  if(url.endsWith('/oauth2/token'))return Response.json({access_token:'mock'});
  if(url.endsWith('/users/@me'))return Response.json({id:userId,username:'Ryan'});
  if(url.endsWith('/roles/'+roleId)){assert.equal(options.method,'PUT');assert.ok(url.includes('/members/'+userId+'/'));grants++;return new Response(null,{status:204});}
  if(url.endsWith('/members/'+userId))return Response.json({roles:[]});
  if(url.endsWith('/roles'))return Response.json([{id:roleId,name:'موافق على الشروط',managed:false}]);
  return Response.json({name:'ساندي',icon:null});
 }});
 const server=http.createServer(app.handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  const login=await fetch(base+'/auth/discord',{redirect:'manual'});let cookie=login.headers.get('set-cookie').split(';')[0];const state=new URL(login.headers.get('location')).searchParams.get('state');
  const callback=await fetch(base+'/auth/callback?state='+state+'&code=mock',{headers:{cookie},redirect:'manual'});const oldCookie=cookie;cookie=callback.headers.get('set-cookie').split(';')[0];
  const replay=await fetch(base+'/auth/callback?state='+state+'&code=mock',{headers:{cookie:oldCookie},redirect:'manual'});assert.match(replay.headers.get('location'),/invalid_state/);
  const data=await(await fetch(base+'/api/session',{headers:{cookie}})).json();assert.equal(data.user.id,userId);
  const headers={cookie,Origin:'https://verify.example.com','Content-Type':'application/json','X-CSRF-Token':data.csrf};
  assert.equal((await fetch(base+'/api/verify',{method:'POST',headers:{...headers,'X-CSRF-Token':'wrong'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/verify',{method:'POST',headers,body:JSON.stringify({accepted:false,termsHash:data.termsHash})})).status,400);
  assert.equal(grants,0);
  const result=await fetch(base+'/api/verify',{method:'POST',headers,body:JSON.stringify({accepted:true,termsHash:data.termsHash,userId:'attacker',roleId:'attacker'})});assert.equal(result.status,200);assert.equal(grants,1);
  assert.ok(app.db.prepare('SELECT role_granted_at FROM consent').get().role_granted_at);
  assert.equal((await fetch(base+'/.env')).status,404);
 }finally{await new Promise(r=>server.close(r));app.db.close();}
});
