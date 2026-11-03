/* V3.3.22 使用說明入口；不修改豬場、F03 或 Firebase 資料 */
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 const dialog=$('helpDialog'),backdrop=$('helpBackdrop'),scroller=$('helpScroll');
 if(!dialog||!backdrop)return;
 const tabs=['quick','map','edit','faq'];
 let lastFocused=null;
 const allTabButtons=tabs.map(t=>$('helpTab'+t[0].toUpperCase()+t.slice(1)));
 const allPages=tabs.map(t=>$('helpPage'+t[0].toUpperCase()+t.slice(1)));
 function switchTab(tab,moveFocus=false){
  const index=tabs.indexOf(tab);if(index<0)return;
  allTabButtons.forEach((b,i)=>{b.setAttribute('aria-selected',String(i===index));b.tabIndex=i===index?0:-1;});
  allPages.forEach((p,i)=>{p.hidden=i!==index;});
  if(scroller)scroller.scrollTop=0;
  if(moveFocus)allTabButtons[index].focus();
 }
 function openHelp(tab='quick'){
  lastFocused=document.activeElement;
  switchTab(tab);backdrop.hidden=false;dialog.hidden=false;
  document.body.classList.add('pig-help-open');
  dialog.focus({preventScroll:true});
 }
 function closeHelp(){
  if(dialog.hidden)return;
  dialog.hidden=true;backdrop.hidden=true;
  document.body.classList.remove('pig-help-open');
  if(lastFocused&&lastFocused.isConnected)lastFocused.focus({preventScroll:true});
 }
 for(const id of ['helpOpenTop','helpOpenMobile','helpOpenMore'])$(id)?.addEventListener('click',()=>openHelp('quick'));
 $('helpClose')?.addEventListener('click',closeHelp);
 $('helpDone')?.addEventListener('click',closeHelp);
 backdrop.addEventListener('click',closeHelp);
 document.querySelectorAll('[data-help-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.helpTab)));
 dialog.addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();closeHelp();return;}
  if(e.key==='Tab'){
   const list=[...dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),summary')].filter(el=>el.getClientRects().length>0&&el.offsetParent!==null);
   if(!list.length)return;
   const first=list[0],last=list[list.length-1];
   if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){e.preventDefault();last.focus();}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
 });
 allTabButtons.forEach((b,i)=>b.addEventListener('keydown',e=>{
  if(['ArrowRight','ArrowLeft','Home','End'].includes(e.key)){
   e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
   switchTab(tabs[next],true);
  }
 }));
 $('helpTrySearch')?.addEventListener('click',()=>{
  closeHelp();const input=$('search')||document.querySelector('.topsearch input');
  if(input){
   if(!input.getClientRects().length)document.body.classList.add('pig-help-search-open');
   input.focus();input.scrollIntoView({block:'nearest'});
   input.addEventListener('blur',()=>document.body.classList.remove('pig-help-search-open'),{once:true});
  }
 });
 $('helpTryList')?.addEventListener('click',()=>{
  closeHelp();if(matchMedia('(max-width:1024px)').matches){
   const button=$('mobileFarmsOpen');if(button?.getAttribute('aria-expanded')!=='true')button?.click();
  }else{document.querySelector('.sidebar')?.scrollIntoView({block:'nearest'});}
 });
 $('helpTryLogin')?.addEventListener('click',()=>{
  closeHelp();$('cloudLoginQuick')?.click();
 });
 window.PigUserHelp={open:openHelp,close:closeHelp};
})();
