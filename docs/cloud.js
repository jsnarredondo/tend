/* Tend cloud layer: provides window.claude.use("db"|"user"|"sample"|"mcp")
   backed by Supabase, so the app code runs unchanged outside Claude. */
(function(){
"use strict";
const SB_URL="https://gibjbbqajmnlnzqvuusq.supabase.co";
const SB_KEY="sb_publishable_0vxVostVAr24tMiZtwrGeA_jf-R3Zk1";
const sb=supabase.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"tend.auth"}});
window.tendSB=sb;

/* ---------- login ---------- */
let session=null,member=null,readyRes;const ready=new Promise(r=>readyRes=r);
const $=id=>document.getElementById(id);
function showLogin(msg){
  let el=$("login");
  if(!el){el=document.createElement("div");el.id="login";document.body.appendChild(el);
    el.innerHTML=`<div class="lg-card"><div class="lg-logo"></div><h1>Tend</h1><p class="lg-sub">Sign in to see the family's log.</p>
      <button type="button" id="lgGoogle" class="lg-google"><svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Continue with Google</button>
      <div class="lg-or">or</div>
      <form id="lgForm"><input id="lgEmail" type="email" autocomplete="username" placeholder="Email" required>
      <input id="lgPass" type="password" autocomplete="current-password" placeholder="Password" required>
      <button type="submit" id="lgGo">Sign in</button><div id="lgMsg" class="lg-msg"></div></form>
      <p class="lg-foot">Ask whoever set up Tend for an invite.</p></div>`;
    const icon=document.querySelector('link[rel="apple-touch-icon"]');if(icon)el.querySelector(".lg-logo").style.backgroundImage=`url("${icon.href}")`;
    $("lgGoogle").onclick=async()=>{$("lgMsg").textContent="";
      const {error}=await sb.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.origin+location.pathname,queryParams:{prompt:"select_account"}}});
      if(error)$("lgMsg").textContent=/not enabled|provider/i.test(error.message)?"Google sign-in isn't turned on yet. Use your email and password.":"Couldn't open Google sign-in.";};
    $("lgForm").onsubmit=async e=>{e.preventDefault();$("lgGo").disabled=true;$("lgMsg").textContent="Signing in…";
      const {error}=await sb.auth.signInWithPassword({email:$("lgEmail").value.trim(),password:$("lgPass").value});
      $("lgGo").disabled=false;if(error)$("lgMsg").textContent="That email and password didn't match.";};}
  el.style.display="flex";if(msg)$("lgMsg").textContent=msg;
}
function hideLogin(){const el=$("login");if(el)el.style.display="none";}
async function onSession(s){
  session=s;
  if(!s){showLogin();return;}
  let {data,error}=await sb.from("members").select("*").eq("user_id",s.user.id).maybeSingle();
  if(!error&&!data){const c=await sb.rpc("claim_my_invite");if(c.data===true)({data,error}=await sb.from("members").select("*").eq("user_id",s.user.id).maybeSingle());}
  if(error||!data){await sb.auth.signOut();showLogin("That account isn't on the care team. Ask the owner to invite this email.");return;}
  member=data;hideLogin();readyRes();
}
let started=false;
sb.auth.onAuthStateChange((ev,s)=>{
  if(ev==="SIGNED_OUT"){location.reload();return;}
  if(ev==="INITIAL_SESSION"||(ev==="SIGNED_IN"&&!member)){if(!started||ev==="SIGNED_IN"){started=true;setTimeout(()=>onSession(s),0);}}
  if(s)session=s;
});

/* ---------- db ---------- */
const store={};const listeners={};
const newId=()=>{const a=crypto.getRandomValues(new Uint8Array(12));return Array.from(a,b=>"abcdefghijklmnopqrstuvwxyz0123456789"[b%36]).join("");};
function emit(col){const m=store[col];if(!m)return;const docs=[...m.entries()].map(([id,data])=>({id,data:()=>JSON.parse(JSON.stringify(data))}));(listeners[col]||[]).forEach(l=>l.ok({docs}));}
async function load(col){
  const m=new Map();let from=0;
  for(;;){const {data,error}=await sb.from("docs").select("id,data").eq("col",col).range(from,from+999);
    if(error)throw error;data.forEach(r=>m.set(r.id,r.data));if(data.length<1000)break;from+=1000;}
  store[col]=m;emit(col);
}
let channel=null;
function subscribeRealtime(){
  if(channel)return;
  channel=sb.channel("docs").on("postgres_changes",{event:"*",schema:"public",table:"docs"},p=>{
    const r=p.eventType==="DELETE"?p.old:p.new;if(!r||!r.col||!store[r.col])return;
    if(p.eventType==="DELETE")store[r.col].delete(r.id);else store[r.col].set(r.id,r.data);emit(r.col);
  }).subscribe(st=>{if(st==="SUBSCRIBED"&&resync.armed)resync();resync.armed=true;});
}
async function resync(){for(const c of Object.keys(store))try{await load(c);}catch(e){}}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&member)resync();});
window.addEventListener("online",()=>{if(member)resync();});
const clean=o=>JSON.parse(JSON.stringify(o===undefined?{}:o));
function chk(r){if(r.error)throw r.error;return r;}
function docRef(col,id){return{
  id,
  async set(data){data=clean(data);const prev=store[col]&&store[col].get(id);if(store[col]){store[col].set(id,data);emit(col);}
    try{chk(await sb.from("docs").upsert({col,id,data}));}catch(e){if(store[col]){prev?store[col].set(id,prev):store[col].delete(id);emit(col);}throw e;}},
  async update(patch){patch=clean(patch);const prev=store[col]&&store[col].get(id);if(prev){store[col].set(id,Object.assign({},prev,patch));emit(col);}
    try{chk(await sb.rpc("doc_patch",{p_col:col,p_id:id,p_patch:patch}));}catch(e){if(prev){store[col].set(id,prev);emit(col);}throw e;}},
  async delete(){const prev=store[col]&&store[col].get(id);if(store[col]){store[col].delete(id);emit(col);}
    try{chk(await sb.from("docs").delete().eq("col",col).eq("id",id));}catch(e){if(prev){store[col].set(id,prev);emit(col);}throw e;}},
  async get(){const m=store[col];const d=m&&m.get(id);return{id,exists:!!d,data:()=>d?clean(d):undefined};}
};}
const db={collection(col){return{
  doc:id=>docRef(col,id),
  async add(data){const id=newId();await docRef(col,id).set(data);return{id};},
  onSnapshot(ok,err){(listeners[col]=listeners[col]||[]).push({ok,err});subscribeRealtime();
    if(store[col])emit(col);else load(col).catch(e=>err&&err(e));return()=>{listeners[col]=listeners[col].filter(l=>l.ok!==ok);};}
};}};

/* ---------- user ---------- */
let profilesCache=null;
async function allMembers(){if(!profilesCache){const {data}=await sb.from("members").select("user_id,name,role,email,legacy_ids");profilesCache=data||[];setTimeout(()=>profilesCache=null,60000);}return profilesCache;}
const user={
  id:async()=>session.user.id,
  isOwner:async()=>member.role==="owner",
  can:async p=>p==="data.write"?member.role!=="viewer":true,
  role:()=>member.role,
  name:()=>member.name,
  async profiles(ids){const ms=await allMembers();const out={};
    ids.forEach(id=>{const m=ms.find(x=>x.user_id===id||(x.legacy_ids||[]).includes(id));out[id]={name:m?m.name:""};});return out;},
  members:allMembers,
  async invite(name,email,role){await sb.from("invites").upsert({email:String(email).trim().toLowerCase(),name,role});return fn({action:"invite",name,email,role}).then(r=>{profilesCache=null;return r;});},
  async remove(uid){return fn({action:"remove",user_id:uid}).then(r=>{profilesCache=null;return r;});},
  async changePassword(pw){const {error}=await sb.auth.updateUser({password:pw});if(error)throw error;},
  signOut:()=>sb.auth.signOut()
};

/* ---------- AI (Tell Tend, Ask Tend, photo import) ---------- */
async function fn(body,signal){
  const {data:{session:s}}=await sb.auth.getSession();
  let res;
  try{res=await fetch(SB_URL+"/functions/v1/tend",{method:"POST",signal,headers:{"Content-Type":"application/json","Authorization":"Bearer "+s.access_token,"apikey":SB_KEY},body:JSON.stringify(body)});}
  catch(err){const e=new Error(err.name==="AbortError"?"cancelled":"Couldn't reach Tend. Check your connection.");e.code=err.name==="AbortError"?"cancelled":"offline";throw e;}
  let j={};try{j=await res.json();}catch(e){}
  if(!res.ok){const e=new Error(j.message||"Something went wrong");e.code=j.error||"error";throw e;}
  return j;
}
function fileToB64(f){return new Promise((ok,bad)=>{
  const img=new Image(),url=URL.createObjectURL(f);
  img.onload=()=>{const max=1800,s=Math.min(1,max/Math.max(img.width,img.height));const c=document.createElement("canvas");c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);
    c.getContext("2d").drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);ok({type:"image/jpeg",data:c.toDataURL("image/jpeg",0.85).split(",")[1]});};
  img.onerror=()=>{URL.revokeObjectURL(url);const e=new Error("image");e.code="image_rejected";bad(e);};img.src=url;});}
const sample={
  async json(prompt,opts){opts=opts||{};const images=[];for(const f of (opts.images||[]))images.push(await fileToB64(f));
    const r=await fn({action:"ai",prompt,images},opts.signal);return r.result;},
  limits:async()=>({images:true})
};

window.claude={use:async cap=>{await ready;
  if(cap==="db")return db;if(cap==="user")return user;if(cap==="sample")return sample;return null;}};
})();

/* ---------- phone notifications (web push) ---------- */
(function(){
const VAPID="BIjleQ40m-WrEW-656qLaSFLultgye7wOdXD5CAFb_0KnmPAfQWngAPcUEVo8Xlxw3KA5MhIXNjIVhUqn1l9AJY";
const b64=s=>{s=s.replace(/-/g,"+").replace(/_/g,"/");s+="=".repeat((4-s.length%4)%4);return Uint8Array.from(atob(s),c=>c.charCodeAt(0));};
let reg=null;
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").then(r=>reg=r).catch(()=>{});
const sb=window.tendSB;
window.tendPush={
  supported:()=>"serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window,
  standalone:()=>matchMedia("(display-mode: standalone)").matches||navigator.standalone===true,
  state:async()=>{if(!window.tendPush.supported())return"unsupported";if(Notification.permission==="denied")return"denied";
    const r=reg||await navigator.serviceWorker.ready;const s=await r.pushManager.getSubscription();return s?"on":"off";},
  async enable(){
    const perm=await Notification.requestPermission();if(perm!=="granted")throw new Error("Notifications were not allowed");
    const r=reg||await navigator.serviceWorker.ready;
    const s=(await r.pushManager.getSubscription())||await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(VAPID)});
    const j=s.toJSON();const {error}=await sb.from("push_subs").upsert({endpoint:j.endpoint,sub:j,tz:Intl.DateTimeFormat().resolvedOptions().timeZone});
    if(error)throw error;return true;},
  async disable(){const r=reg||await navigator.serviceWorker.ready;const s=await r.pushManager.getSubscription();
    if(s){await sb.from("push_subs").delete().eq("endpoint",s.endpoint);await s.unsubscribe();}}
};
})();
