/* V3.3.19 行動版：抽屜清單、地圖優先、準星選單。與原地圖功能共用按鈕事件。 */
(function(){'use strict';
 const $=id=>document.getElementById(id);
 const mobile=()=>matchMedia('(max-width:1024px)').matches;
 let actionOpen=false;
 function invalidate(){setTimeout(()=>{try{document.querySelectorAll('.leaflet-container').forEach(el=>{const event=new Event('resize');window.dispatchEvent(event);});}catch(e){}},240);}
 function closeDrawer(){document.body.classList.remove('pig-drawer-open');$('mobileDrawerScrim').hidden=true;$('mobileFarmsOpen')?.setAttribute('aria-expanded','false');$('mobileFarmsOpen')?.classList.remove('is-active');invalidate();}
 function openDrawer(){if(!mobile())return;closeActions();document.body.classList.add('pig-drawer-open');$('mobileDrawerScrim').hidden=false;$('mobileFarmsOpen').setAttribute('aria-expanded','true');$('mobileFarmsOpen').classList.add('is-active');}
 function closeActions(){actionOpen=false;$('mobileActionMenu').hidden=true;$('mobileFabToggle').setAttribute('aria-expanded','false');$('mobileFabToggle').classList.remove('is-active');}
 function toggleActions(){if(!mobile())return;closeDrawer();actionOpen=!actionOpen;$('mobileActionMenu').hidden=!actionOpen;$('mobileFabToggle').setAttribute('aria-expanded',String(actionOpen));$('mobileFabToggle').classList.toggle('is-active',actionOpen);}
 function clickOriginal(id){const el=$(id);if(el)el.click();}
 function action(id){closeActions();closeDrawer();clickOriginal(id);}
 function aimChanged(active){const bar=$('mobileAimActiveBar');if(bar)bar.hidden=!active||!mobile();}
 window.PigMobileUI={closeDrawer,openDrawer,aimChanged};
 function init(){
 $('mobileFarmsOpen')?.addEventListener('click',()=>document.body.classList.contains('pig-drawer-open')?closeDrawer():openDrawer());
 $('mobileDrawerClose')?.addEventListener('click',closeDrawer);
 $('mobileDrawerScrim')?.addEventListener('click',closeDrawer);
 $('mobileMapHome')?.addEventListener('click',()=>{closeActions();closeDrawer();});
 $('mobileFabToggle')?.addEventListener('click',toggleActions);
 $('mobileActionBrowse')?.addEventListener('click',()=>action('toolBrowse'));
 $('mobileActionInspect')?.addEventListener('click',()=>action('toolInspect'));
 $('mobileActionPoint')?.addEventListener('click',()=>action('toolPoint'));
 $('mobileActionWorkbench')?.addEventListener('click',()=>action('workbenchOpen'));
 $('mobileActionAim')?.addEventListener('click',()=>{closeActions();clickOriginal('mobileAimMain');});
 $('mobileAimCapture')?.addEventListener('click',()=>clickOriginal('mobileAimMain'));
 $('mobileAimCancel')?.addEventListener('click',()=>clickOriginal('mobileAimClose'));
 $('cloudStatus')?.addEventListener('click',()=>{if(mobile())window.PigCommunity?.open();});
 $('farmList')?.addEventListener('click',e=>{if(mobile()&&e.target.closest('[data-id],[data-open-editor]'))closeDrawer();});
 $('search')?.addEventListener('focus',()=>{if(mobile())openDrawer();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeDrawer();closeActions();}});
 window.addEventListener('resize',()=>{if(!mobile()){closeDrawer();closeActions();}aimChanged($('maps')?.classList.contains('aim-mode'));});
 // 窄版手機第一次開啟優先只顯示正射影像，避免兩張小圖；使用者仍可點選雙圖對照。
 if(matchMedia('(max-width:600px)').matches&&$('modeBoth')?.classList.contains('active')){
   setTimeout(()=>{if($('modeBoth')?.classList.contains('active'))clickOriginal('modeAerial');},550);
 }
 aimChanged(false);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
