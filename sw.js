/* V3.4.25: network-first static files; old JS/CSS must not mask a deployed update. */
const CACHE='pigfarm-shell-v3.4.25-network-first-20261110';
const ASSETS=[
 './index.html','./manifest.webmanifest','./favicon.ico',
 './assets/css/app.css','./assets/css/ui.css','./assets/js/ui.js','./assets/js/health.js',
 './assets/css/desktop.css','./assets/css/geo.css','./assets/js/desktop.js','./assets/js/geo.js',
 './assets/css/mobile.css','./assets/css/farm-info.css','./assets/css/help.css','./assets/js/mobile.js','./assets/js/mobile-viewport.js','./assets/js/f03-services.js',
 './assets/js/help.js','./assets/js/pig-core.js','./assets/js/cloud-config.js','./assets/js/address-lookup.js','./assets/js/community.js','./assets/js/app.js','./assets/js/pwa-install.js',
 './data/f03-y112-yunlin.js','./data/legacy-farms.js',
 './icons/app-192.png','./icons/app-512.png','./icons/app-maskable-512.png','./icons/apple-touch-icon.png'
];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('pigfarm-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET')return;
 const url=new URL(req.url);
 if(url.origin!==self.location.origin)return;
 const base=new URL('./',self.registration.scope);
 if(!url.pathname.startsWith(base.pathname))return;
 const shell=ASSETS.some(p=>new URL(p,base).pathname===url.pathname);
 const navigation=req.mode==='navigate';
 if(!shell && !navigation)return;
 // Every online load checks the deployment; offline keeps the last complete shell.
 // Avoid caching requests with query params as extra copies: normalize using a shell URL.
 const key=navigation?new URL('./index.html',base):new URL(url.pathname,base.origin);
 event.respondWith(fetch(req,{cache:'no-store'}).then(r=>{
  if(r.ok && r.type!=='opaque'){
   const copy=r.clone();
   event.waitUntil(caches.open(CACHE).then(c=>c.put(key,copy)).catch(()=>{}));
  }
  return r;
 }).catch(()=>caches.match(key).then(hit=>hit||new Response('目前離線且尚無可用的離線頁面。',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}}))));
});
