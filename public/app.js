const $=id=>document.getElementById(id);let data=null,demo=false,pending=false;
const messages={not_configured:'بوابة التحقق لم تُفعّل بعد. تواصل مع إدارة السيرفر.',invalid_state:'انتهت جلسة الربط. سجّل دخولك مجددًا.',cancelled:'ألغيت ربط الحساب. يمكنك المحاولة وقت ما تحب.',login_failed:'تعذّر ربط الحساب. جرّب تسجيل الدخول من جديد.',join_server:'انضم لسيرفر Discord أولًا، ثم ارجع وأكمل التحقق.',role_setup:'رول الموافقة يحتاج ضبطًا من الإدارة.',bot_permissions:'البوت يحتاج صلاحية إدارة الرولات وأن يكون روله أعلى من رول الموافقة.',discord_unavailable:'Discord غير متاح الآن. حاول بعد لحظات.',consent_required:'وافق على النسخة الحالية من الشروط أولًا.',not_ready:'التحقق غير مفعّل بعد، أو الشروط ما زالت قيد المراجعة.',busy:'طلبك قيد التنفيذ. انتظر لحظة.',login_required:'سجّل دخولك مجددًا لإكمال التحقق.',csrf:'انتهت جلسة التحقق. حدّث الصفحة.',request_failed:'تعذرت العملية، حاول مرة أخرى.'};
function alertError(code){$('alert').textContent=messages[code]||messages.request_failed;$('alert').hidden=false;}
function update(){
 document.querySelectorAll('.guild-name').forEach(n=>n.textContent=data.guild.name);document.querySelectorAll('.guild-icon').forEach(n=>n.src=data.guild.icon);
 const user=demo?{name:'حسابك على Discord',avatar:'/user.svg'}:data.user;
 $('user-name').textContent=user?.name||'حسابك';$('user-image').src=user?.avatar||'/user.svg';
 $('login-panel').hidden=Boolean(user);$('consent-panel').hidden=!user||data.verified;$('success-panel').hidden=!data.verified;
 $('status').textContent=data.verified?'تم التحقق':user?'الحساب مرتبط':'بانتظار الربط';$('status').classList.toggle('ok',Boolean(user));
 $('step1').className=user?'done':'active';$('step2').className=data.verified?'done':user?'active':'';$('step3').className=data.verified?'done':'';
 $('preview-panel').hidden=!data.preview;$('demo').hidden=data.verified;
 $('verify').disabled=pending||!$('accepted').checked||(!demo&&(!data.configured||!data.termsApproved));
 const readyInvite=data.invite&&/^https:\/\/(discord\.gg\/|discord\.com\/invite\/)/.test(data.invite);
 $('return').href=readyInvite?data.invite:'https://discord.com/channels/@me';
}
async function api(path,payload){const r=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':data.csrf||''},body:JSON.stringify(payload)});const out=await r.json();if(!r.ok)throw out;return out;}
function openTerms(){if(!$('terms-dialog').open)$('terms-dialog').showModal();}
$('terms-open').onclick=$('footer-terms').onclick=openTerms;$('terms-close').onclick=$('terms-done').onclick=()=>$('terms-dialog').close();
$('accepted').onchange=()=>update();$('year').textContent=new Date().getFullYear();
$('demo').onclick=()=>{demo=true;data.verified=false;$('alert').hidden=true;update();};
$('logout').onclick=async()=>{if(demo){demo=false;data.verified=false;$('accepted').checked=false;return update();}try{await api('/api/logout',{});location.assign('/');}catch(e){alertError(e.error);}};
$('verify').onclick=async()=>{
 if(pending||!$('accepted').checked)return;pending=true;$('verify').textContent='جارٍ تأكيد حسابك…';$('alert').hidden=true;update();
 try{if(demo){await new Promise(r=>setTimeout(r,700));data.verified=true;$('success-text').textContent='هذه معاينة للنجاح فقط؛ لم يُمنح أي رول.';}else{const result=await api('/api/verify',{accepted:true,termsHash:data.termsHash});data.verified=true;$('success-text').textContent='تمت إضافة رول «'+result.role+'» إلى حسابك. تقدر ترجع للسيرفر الآن.';}}
 catch(e){alertError(e.error);if(e.error==='join_server'&&data.invite){const a=document.createElement('a');a.href=data.invite;a.textContent=' فتح دعوة السيرفر';a.className='terms-link';$('alert').append(a);}}
 finally{pending=false;$('verify').innerHTML='تأكيد الموافقة والانضمام<span class="arrow">←</span>';update();}
};
(async()=>{try{const response=await fetch('/api/session',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error();data=await response.json();
 for(const section of data.terms.sections){const h=document.createElement('h3'),p=document.createElement('p');h.textContent=section.title;p.textContent=section.body;$('terms-content').append(h,p);}
 $('draft-note').hidden=data.termsApproved;
 if(!data.configured){$('login').removeAttribute('href');$('login').setAttribute('aria-disabled','true');$('login').onclick=()=>alertError('not_configured');}
 const error=new URL(location.href).searchParams.get('error');if(error){alertError(error);history.replaceState({},'',location.pathname);}
 update();
 }catch{alertError('request_failed');$('login').removeAttribute('href');}})();
