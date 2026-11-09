/* Desktop-only layout controls; no modification to farm data or auth. */
(()=>{'use strict';
const layout=document.querySelector('.layout'), side=document.getElementById('sidebar'), toggle=document.getElementById('desktopSidebarToggle'), hide=document.getElementById('desktopSidebarHide'), menu=document.getElementById('desktopToolsMenu'), workflow=document.getElementById('desktopWorkflow');
if(!layout||!side||!toggle||!hide)return;
const desktop=()=>window.matchMedia('(min-width:1025px)').matches;
function syncMobileMenus(){if(!desktop()){if(menu)menu.open=true;if(workflow)workflow.open=true}else{if(menu)menu.open=false}}
let closed=false;
function render(){const active=desktop()&&closed;layout.classList.toggle('desktop-sidebar-closed',active);toggle.setAttribute('aria-expanded',String(!active));toggle.textContent=active?'☷ 顯示清單':'☰ 收起清單';document.dispatchEvent(new Event('desktop-layout-change'));}
toggle.addEventListener('click',()=>{closed=!closed;render()});hide.addEventListener('click',()=>{closed=true;render()});
window.addEventListener('resize',render);
if(menu){document.addEventListener('pointerdown',e=>{if(desktop()&&menu.open&&!menu.contains(e.target))menu.open=false});menu.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{menu.open=false}))}
if(workflow){const mq=window.matchMedia('(max-width:1024px)');const sync=()=>syncMobileMenus();sync();mq.addEventListener?.('change',()=>{sync();render()})}
render();
})();
