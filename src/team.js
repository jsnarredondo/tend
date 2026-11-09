function renderTeam(){
  const el=$("team");if(!el)return;
  const roleName={owner:"Owner",contributor:"Can log",viewer:"View only"};
  const draw=ms=>{
    const owner=user&&user.role&&user.role()==="owner";
    el.innerHTML=(ms||[]).map(m=>`<div class="row"><div class="avatar" style="background:var(--brand);width:34px;height:34px;font-size:15px">${esc((m.name||"?")[0])}</div>
      <div class="grow"><div class="t1">${esc(m.name||m.email)}${m.user_id===me?" (you)":""}</div><div class="t2">${esc(roleName[m.role]||m.role)}${owner&&m.email?" · "+esc(m.email):""}</div></div>
      ${owner&&m.user_id!==me?`<span class="link" data-rm="${esc(m.user_id)}" style="color:var(--red)">Remove</span>`:""}</div>`).join("")
    +(owner?`<div class="form" style="margin-top:12px"><div class="f-row"><label>Name</label><input id="tmName" placeholder="Their name"></div>
      <div class="f-row"><label>Email</label><input id="tmEmail" type="email" placeholder="name@email.com"></div>
      <div class="f-row"><label>Access</label><select id="tmRole"><option value="contributor">Can log</option><option value="viewer">View only</option></select></div></div>
      <button class="pbtn" id="tmAdd" style="margin-top:10px;width:100%">Invite</button><div id="tmOut"></div>`:"")
    +`<div class="smallnote">Everyone here sees the same history, live. Each entry shows who logged it.</div>
      <div style="display:flex;gap:18px;justify-content:center;margin-top:10px"><span class="link" id="tmPw">Change my password</span><span class="link" id="tmOutBtn">Sign out</span></div>`;
    el.querySelectorAll("[data-rm]").forEach(b=>b.onclick=async()=>{const m=ms.find(x=>x.user_id===b.dataset.rm);
      if(!confirm(`Remove ${m.name||m.email} from Tend? They won't be able to sign in.`))return;
      try{await user.remove(m.user_id);toast("Removed");renderTeam();}catch(e){toast(e.message||"Couldn't remove");}});
    const add=$("tmAdd");if(add)add.onclick=async()=>{add.disabled=true;
      try{const r=await user.invite(val("tmName"),val("tmEmail"),$("tmRole").value);
        const link=location.origin+location.pathname;
        const msg=`I set you up on Tend so we can both track the kids' meds and symptoms.\n\n1. Open ${link}\n2. Tap Continue with Google and pick ${r.email}\n   (or sign in with that email and the password ${r.password})\n\nOn iPhone, tap Share then "Add to Home Screen" so it works like an app.`;
        $("tmOut").innerHTML=`<div class="hint" style="margin-top:10px;white-space:pre-wrap;user-select:text">${esc(msg)}</div><button class="pbtn" id="tmCopy" style="margin-top:8px;width:100%">Copy invite message</button>`;
        $("tmCopy").onclick=async()=>{try{await navigator.clipboard.writeText(msg);toast("Copied. Text it to them.");}catch(e){toast("Select the text and copy it");}};
      }catch(e){toast(e.message||"Couldn't invite");}add.disabled=false;};
    $("tmPw").onclick=async()=>{const pw=prompt("New password (at least 8 characters)");if(!pw)return;if(pw.length<8){toast("Use at least 8 characters");return;}
      try{await user.changePassword(pw);toast("Password changed");}catch(e){toast(e.message||"Couldn't change it");}};
    $("tmOutBtn").onclick=()=>{if(confirm("Sign out of Tend on this device?"))user.signOut();};
  };
  if(!user||!user.members){el.innerHTML=`<div class="empty">Sign in to see the care team.</div>`;return;}
  if(renderTeam.cache)draw(renderTeam.cache);
  user.members().then(ms=>{const key=JSON.stringify(ms);if(key!==renderTeam.key){renderTeam.key=key;renderTeam.cache=ms;draw(ms);}}).catch(()=>{});
}
