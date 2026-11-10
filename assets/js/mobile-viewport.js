/* V3.4.25 iOS orientation repair: the visual viewport may settle after the orientation event. */
(function(){'use strict';
 const mobile=()=>window.matchMedia('(max-width:1024px)').matches;
 let pending=[];
 function updateHeight(){
  if(!mobile()){document.documentElement.style.removeProperty('--pig-viewport-height');document.body.style.removeProperty('--pig-viewport-height');return;}
  const vv=window.visualViewport;
  // 100dvh is the primary layout; this measurement is a fallback when iOS holds stale dvh.
  const h=vv?.height||window.innerHeight;
  if(Number.isFinite(h)&&h>200)document.body.style.setProperty('--pig-viewport-height',Math.round(h)+'px');
 }
 function apply(){updateHeight();window.PigMapViewportRepair?.();}
 function schedule(){
  pending.forEach(clearTimeout);pending=[];
  apply();
  [90,260,520,950].forEach(ms=>pending.push(setTimeout(apply,ms)));
 }
 const ready=()=>{
  schedule();
  window.addEventListener('orientationchange',schedule,{passive:true});
  window.addEventListener('resize',schedule,{passive:true});
  window.visualViewport?.addEventListener('resize',schedule,{passive:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
  window.addEventListener('pageshow',schedule);
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();
