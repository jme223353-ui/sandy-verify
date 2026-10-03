import http from 'node:http';
import { readFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
const random=()=>randomBytes(32).toString('base64url');
const hash=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const snowflake=value=>typeof value==='string'&&/^\d{17,20}$/.test(value);
export function createApp({config={},fetchImpl=fetch,dbPath=':memory:',terms=JSON.parse(readFileSync(new URL('terms.json',import.meta.url))),publicDir=resolve(new URL('public/',import.meta.url).pathname)}={}){
 const cfg={publicUrl:'http://localhost:3000',serverName:'مقاطعة ساندي',preview:false,termsApproved:false,...config};
 const origin=new URL(cfg.publicUrl).origin,secure=origin.startsWith('https:');
 const configured=Boolean(snowflake(cfg.clientId)&&cfg.clientSecret&&cfg.botToken&&snowflake(cfg.guildId)&&snowflake(cfg.roleId)&&secure);
 const approved=cfg.termsApproved===true&&terms.approved===true;
 const termsHash=hash(JSON.stringify(terms));
 const db=new DatabaseSync(dbPath);db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,state TEXT,expires INTEGER NOT NULL,user TEXT,csrf TEXT NOT NULL,verified INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS consent(user_id TEXT NOT NULL,guild_id TEXT NOT NULL,role_id TEXT NOT NULL,version TEXT NOT NULL,terms_hash TEXT NOT NULL,accepted_at INTEGER NOT NULL,role_granted_at INTEGER,PRIMARY KEY(user_id,guild_id,role_id,terms_hash));`);
 const busy=new Set();let guildCache=null,guildExpiry=0;
 const cookie=id=>`sandy_session=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600${secure?'; Secure':''}`;
 function session(req){const raw=(req.headers.cookie||'').split(';').find(x=>x.trim().startsWith('sandy_session='))?.trim().slice(14);if(!raw)return null;return db.prepare('SELECT * FROM sessions WHERE id=? AND expires>?').get(hash(raw),Date.now())||null;}
 function send(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));}
 function redirect(res,path,cookies){res.writeHead(303,{Location:path,'Cache-Control':'no-store',...(cookies?{'Set-Cookie':cookies}:{})});res.end();}
 async function discord(path,{method='GET',body,token=cfg.botToken,auth='Bot'}={}){
  const response=await fetchImpl(`https://discord.com/api/v10${path}`,{method,headers:{Authorization:`${auth} ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
  if(!response.ok){const error=new Error('Discord request failed');error.status=response.status;error.discord=true;throw error;}
  return response.status===204?null:await response.json();
 }
 async function guild(){if(guildCache&&Date.now()<guildExpiry)return guildCache;if(!configured)return {name:cfg.serverName,icon:'/server.svg'};const g=await discord(`/guilds/${cfg.guildId}`);guildCache={name:g.name,icon:g.icon?`https://cdn.discordapp.com/icons/${cfg.guildId}/${g.icon}.png?size=256`:'/server.svg'};guildExpiry=Date.now()+300000;return guildCache;}
 async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)throw new Error('Body too large');}return JSON.parse(raw||'{}');}
 async function handler(req,res){
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://cdn.discordapp.com; connect-src 'self'; font-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  const url=new URL(req.url,origin);
  try{
   if(req.method==='GET'&&url.pathname==='/api/session'){
    const s=session(req);let g;try{g=await guild();}catch{g={name:cfg.serverName,icon:'/server.svg'};}
    return send(res,200,{guild:g,user:s?.user?JSON.parse(s.user):null,csrf:s?.csrf||null,verified:Boolean(s?.verified),configured,termsApproved:approved,preview:cfg.preview,terms,termsHash,invite:cfg.inviteUrl||null});
   }
   if(req.method==='GET'&&url.pathname==='/auth/discord'){
    if(!configured)return redirect(res,'/?error=not_configured');
    db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    const id=random(),state=random(),csrf=random();db.prepare('INSERT INTO sessions(id,state,expires,csrf) VALUES (?,?,?,?)').run(hash(id),state,Date.now()+600000,csrf);
    const params=new URLSearchParams({client_id:cfg.clientId,redirect_uri:origin+'/auth/callback',response_type:'code',scope:'identify',state});
    return redirect(res,'https://discord.com/oauth2/authorize?'+params,cookie(id));
   }
   if(req.method==='GET'&&url.pathname==='/auth/callback'){
    const s=session(req),state=url.searchParams.get('state');
    if(!s||!s.state||!same(state,s.state))return redirect(res,'/?error=invalid_state');
    db.prepare('UPDATE sessions SET state=NULL WHERE id=?').run(s.id);
    if(url.searchParams.get('error')||!url.searchParams.get('code'))return redirect(res,'/?error=cancelled');
    const response=await fetchImpl('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:cfg.clientId,client_secret:cfg.clientSecret,grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:origin+'/auth/callback'}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)return redirect(res,'/?error=login_failed');
    const token=await response.json(),u=await discord('/users/@me',{token:token.access_token,auth:'Bearer'});
    if(!snowflake(u.id))return redirect(res,'/?error=login_failed');
    const index=Number((BigInt(u.id)>>22n)%6n);
    const user={id:u.id,name:u.global_name||u.username,username:u.username,avatar:u.avatar?`https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=256`:`https://cdn.discordapp.com/embed/avatars/${index}.png`};
    // Rotate after OAuth; access tokens stay in memory and never go to the browser or database.
    const id=random();db.prepare('DELETE FROM sessions WHERE id=?').run(s.id);db.prepare('INSERT INTO sessions(id,expires,user,csrf) VALUES (?,?,?,?)').run(hash(id),Date.now()+3600000,JSON.stringify(user),random());
    return redirect(res,'/',cookie(id));
   }
   if(req.method==='POST'&&url.pathname==='/api/verify'){
    if(req.headers.origin!==origin)return send(res,403,{error:'origin'});
    const s=session(req);if(!s?.user)return send(res,401,{error:'login_required'});
    if(!same(req.headers['x-csrf-token'],s.csrf))return send(res,403,{error:'csrf'});
    if(!configured||!approved)return send(res,409,{error:'not_ready'});
    const data=await body(req);if(data.accepted!==true||data.termsHash!==termsHash)return send(res,400,{error:'consent_required'});
    const u=JSON.parse(s.user);if(busy.has(u.id))return send(res,409,{error:'busy'});busy.add(u.id);
    try{
     let member;try{member=await discord(`/guilds/${cfg.guildId}/members/${u.id}`);}catch(e){if(e.status===404)return send(res,409,{error:'join_server',invite:cfg.inviteUrl||null});throw e;}
     const roles=await discord(`/guilds/${cfg.guildId}/roles`),target=roles.find(r=>r.id===cfg.roleId);
     if(!target||target.managed||target.id===cfg.guildId)return send(res,503,{error:'role_setup'});
     // OAuth supplies the user identity; browser input cannot pick guild, member, or role.
     db.prepare('INSERT OR IGNORE INTO consent(user_id,guild_id,role_id,version,terms_hash,accepted_at) VALUES (?,?,?,?,?,?)').run(u.id,cfg.guildId,cfg.roleId,terms.version,termsHash,Date.now());
     if(!member.roles.includes(cfg.roleId))await discord(`/guilds/${cfg.guildId}/members/${u.id}/roles/${cfg.roleId}`,{method:'PUT'});
     db.prepare('UPDATE consent SET role_granted_at=? WHERE user_id=? AND guild_id=? AND role_id=? AND terms_hash=?').run(Date.now(),u.id,cfg.guildId,cfg.roleId,termsHash);
     db.prepare('UPDATE sessions SET verified=1 WHERE id=?').run(s.id);
     return send(res,200,{ok:true,role:target.name,invite:cfg.inviteUrl||null});
    }finally{busy.delete(u.id);}
   }
   if(req.method==='POST'&&url.pathname==='/api/logout'){
    if(req.headers.origin!==origin)return send(res,403,{error:'origin'});const s=session(req);
    if(!s||!same(req.headers['x-csrf-token'],s.csrf))return send(res,403,{error:'csrf'});
    db.prepare('DELETE FROM sessions WHERE id=?').run(s.id);return send(res,200,{ok:true},{'Set-Cookie':`sandy_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure?'; Secure':''}`});
   }
   if(req.method==='GET'&&url.pathname==='/health')return send(res,200,{ok:true});
   if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'method'});
   let path;try{path=decodeURIComponent(url.pathname);}catch{return send(res,400,{error:'path'});}
   const file=resolve(publicDir,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(publicDir+'/'))return send(res,404,{error:'not_found'});
   let stat;try{stat=statSync(file);}catch{return send(res,404,{error:'not_found'});}if(!stat.isFile())return send(res,404,{error:'not_found'});
   const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2'};
   res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':file.endsWith('index.html')?'no-store':'public, max-age=300'});res.end(req.method==='HEAD'?undefined:readFileSync(file));
  }catch(e){if(url.pathname==='/auth/callback')return redirect(res,'/?error=login_failed');send(res,e.discord?503:400,{error:e.discord?(e.status===403?'bot_permissions':'discord_unavailable'):'request_failed'});}
 }
 return {handler,db};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const dir=resolve(process.env.DATA_DIR||'./data');mkdirSync(dir,{recursive:true});
 const {handler}=createApp({config:{publicUrl:process.env.PUBLIC_URL||'http://localhost:3000',serverName:process.env.SERVER_NAME||'مقاطعة ساندي',clientId:process.env.DISCORD_CLIENT_ID,clientSecret:process.env.DISCORD_CLIENT_SECRET,botToken:process.env.DISCORD_BOT_TOKEN,guildId:process.env.DISCORD_GUILD_ID,roleId:process.env.DISCORD_ROLE_ID,inviteUrl:process.env.DISCORD_INVITE_URL,termsApproved:process.env.TERMS_APPROVED==='true',preview:process.env.PREVIEW_MODE==='true'},dbPath:resolve(dir,'verification.sqlite')});
 http.createServer(handler).listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Sandy verification listening on port '+(process.env.PORT||3000)));
}
