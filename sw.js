/* 豬場地圖查核 V3.4.22：可更新的 PWA 外殼快取；不快取使用者資料與官方地圖圖磚。 */
const CACHE='pigfarm-shell-v3.4.22-map-pick-simple-20261110';
const ASSETS=[
 './index.html','./manifest.webmanifest','./favicon.ico',
 './assets/css/app.css','./assets/css/ui.css','./assets/js/ui.js','./assets/js/health.js',
  './assets/css/desktop.css','./assets/css/geo.css',
  './assets/js/desktop.js','./assets/js/geo.js','./assets/css/mobile.css','./assets/css/farm-info.css','./assets/css/help.css','./assets/js/mobile.js','./assets/js/f03-services.js',
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
 const req=event.request;if(req.method!=='GET')return;
 const url=new URL(req.url);if(url.origin!==self.location.origin)return;
 const base=new URL('./',self.registration.scope);
 if(!url.pathname.startsWith(base.pathname))return;
 // Firebase 設定不能永久被舊快取鎖住：有網路時以伺服器最新檔為準。
 if(url.pathname===new URL('./assets/js/cloud-config.js',base).pathname){
  event.respondWith(fetch(req,{cache:'no-store'}).then(r=>{
   if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});}return r;
  }).catch(()=>caches.match(req)));
  return;
 }
 if(req.mode==='navigate'){
  event.respondWith(fetch(req).then(r=>{
   if(r.ok && new URL(req.url).pathname===new URL('./index.html',base).pathname){
    const copy=r.clone();caches.open(CACHE).then(c=>c.put(new URL('./index.html',base).href,copy)).catch(()=>{});
   }return r;
  }).catch(()=>caches.match(new URL('./index.html',base).href).then(r=>r||new Response('目前離線且未取得系統檔案。',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}}))));
  return;
 }
 if(ASSETS.some(p=>new URL(p,base).pathname===url.pathname)){
  event.respondWith(caches.match(req,{ignoreSearch:true}).then(hit=>hit||fetch(req).then(r=>{
   if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});}return r;
  })));
 }
});
