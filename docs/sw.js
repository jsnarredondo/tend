/* Tend service worker: shows reminder notifications */
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("push",e=>{
  let d={};try{d=e.data.json();}catch(x){d={title:"Tend",body:e.data&&e.data.text()};}
  e.waitUntil(self.registration.showNotification(d.title||"Tend",{body:d.body||"",tag:d.tag,icon:"tend-icon-192.png",badge:"tend-icon-192.png",data:{url:d.url||"./"}}));
});
self.addEventListener("notificationclick",e=>{
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(ws=>{
    for(const w of ws){if("focus" in w)return w.focus();}
    return self.clients.openWindow(e.notification.data.url||"./");}));
});
