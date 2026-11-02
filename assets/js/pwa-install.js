
/* Optional installation. File:// still works as a map page but cannot register a PWA. */
(()=>{
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
 if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost'||location.hostname==='127.0.0.1')){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(err=>console.warn('PWA registration unavailable',err)));
 }
})();

