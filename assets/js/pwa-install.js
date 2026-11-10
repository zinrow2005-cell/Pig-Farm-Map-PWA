/* GitHub Pages PWA installation + visible version-update notice.
   Does not clear localStorage/IndexedDB and does not reload unfinished edits automatically. */
(()=>{
 const VERSION='V3.4.27';
 window.PIG_FARM_APP_VERSION=VERSION;
 let installPrompt=null;
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});
 const btn=document.getElementById('installPwa');
 if(btn){btn.addEventListener('click',async()=>{
  if(installPrompt){const e=installPrompt;installPrompt=null;try{await e.prompt();}catch(err){console.warn('PWA install prompt failed',err);}return;}
  const ios=/iPad|iPhone|iPod/i.test(navigator.userAgent)||((navigator.platform||'')==='MacIntel'&&navigator.maxTouchPoints>1);
  const msg=location.protocol==='file:'?'請先將完整 ZIP 上傳 GitHub Pages，再用 HTTPS 網址開啟，才能安裝到主畫面。':
   ios?'請用 Safari 開啟網站，點「分享」→「加入主畫面」，就能使用小豬 APP 圖示。':
   '請使用瀏覽器選單中的「安裝應用程式」或「加到主畫面」。若尚未出現，請確認網站已使用 HTTPS 並上傳完整 ZIP。';
  alert(msg);
 });}
 window.addEventListener('appinstalled',()=>{if(btn){btn.textContent='✓ 已安裝 APP';btn.disabled=true;}});
 function updateNotice(){
  if(document.getElementById('pigUpdateNotice'))return;
  const el=document.createElement('div');el.id='pigUpdateNotice';el.setAttribute('role','status');
  el.style.cssText='position:fixed;z-index:2147483600;left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));padding:12px 14px;border-radius:12px;background:#173e38;color:white;box-shadow:0 8px 30px #0005;display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:14px';
  const msg=document.createElement('span');msg.textContent='網站新版已可使用。請先確認正在編輯的資料已儲存，再重新載入。';msg.style.flex='1';
  const refresh=document.createElement('button');refresh.type='button';refresh.textContent='更新網頁';refresh.style.cssText='background:white;color:#173e38;border:0;padding:9px 13px;border-radius:8px;font-weight:700';
  refresh.addEventListener('click',()=>location.reload());
  const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='稍後';dismiss.style.cssText='background:transparent;color:white;border:1px solid #fff8;padding:9px;border-radius:8px';dismiss.addEventListener('click',()=>el.remove());
  el.append(msg,refresh,dismiss);document.body.appendChild(el);
 }
 if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost'||location.hostname==='127.0.0.1')){
  window.addEventListener('load',async()=>{
   try{
    const hadController=!!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(hadController)updateNotice();});
    const reg=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
    if(reg.waiting && hadController)updateNotice();
    reg.addEventListener('updatefound',()=>{
     const worker=reg.installing;
     if(worker)worker.addEventListener('statechange',()=>{
      if(worker.state==='installed' && navigator.serviceWorker.controller)updateNotice();
     });
    });
    reg.update().catch(()=>{});
   }catch(err){console.warn('PWA registration unavailable',err);}
  });
 }
})();
