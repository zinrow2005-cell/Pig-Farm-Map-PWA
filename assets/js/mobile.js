/* V3.3.20 行動版：抽屜清單、地圖優先、準星選單。與原地圖功能共用按鈕事件。 */
(function(){'use strict';
 const $=id=>document.getElementById(id);
 const mobile=()=>matchMedia('(max-width:1024px)').matches;
 let actionOpen=false;
 function invalidate(){setTimeout(()=>{try{window.dispatchEvent(new Event('resize'));document.dispatchEvent(new Event('desktop-layout-change'));}catch(e){}},240);}
 function closeDrawer(){const drawer=document.getElementById('sidebar');if(drawer){drawer.style.transform='';drawer.classList.remove('pig-drawer-dragging');}document.body.classList.remove('pig-drawer-open');$('mobileDrawerScrim').hidden=true;$('mobileFarmsOpen')?.setAttribute('aria-expanded','false');$('mobileFarmsOpen')?.classList.remove('is-active');invalidate();}
 function openDrawer(){if(!mobile())return;closeActions();document.body.classList.add('pig-drawer-open');$('mobileDrawerScrim').hidden=false;$('mobileFarmsOpen').setAttribute('aria-expanded','true');$('mobileFarmsOpen').classList.add('is-active');}
 // 選定資訊卡片獨立於雙地圖內部，避免切到盤查圖時資訊卡消失。
 let selectedUid=null,selectionDismissed=false;
 function syncSelected(){
  const source=$('selectedFarmCard'),tray=$('mobileSelectedFarm');if(!tray)return;
  const active=mobile()&&!!selectedUid&&!selectionDismissed&&source&&!source.hidden;
  tray.hidden=!active;
  if(active){$('mobileSelectedName').textContent=$('selectedFarmName')?.textContent||'未命名豬場';$('mobileSelectedCoords').textContent=$('selectedFarmCoordinates')?.textContent||'';}
 }
 function openSelectedInfo(){if(!selectedUid)return;clickOriginal('selectedFarmEdit');}
 function closeActions(){actionOpen=false;$('mobileActionMenu').hidden=true;$('mobileFabToggle').setAttribute('aria-expanded','false');$('mobileFabToggle').classList.remove('is-active');}
 function toggleActions(){if(!mobile())return;closeDrawer();actionOpen=!actionOpen;$('mobileActionMenu').hidden=!actionOpen;$('mobileFabToggle').setAttribute('aria-expanded',String(actionOpen));$('mobileFabToggle').classList.toggle('is-active',actionOpen);}
 function clickOriginal(id){const el=$(id);if(el)el.click();}
 function action(id){closeActions();closeDrawer();clickOriginal(id);}
 function aimChanged(active){const bar=$('mobileAimActiveBar');if(bar)bar.hidden=!active||!mobile();}
 window.PigMobileUI={closeDrawer,openDrawer,aimChanged};
 const panelIds=['mobileStatsPanel','mobileLayersPanel'];
 const panelButtonIds=['mobileStatsToggle','mobileLayersToggle'];
 function closePanels(){panelIds.forEach(id=>{const e=$(id);if(e)e.hidden=true;});panelButtonIds.forEach(id=>$(id)?.setAttribute('aria-expanded','false'));}
 function togglePanel(which){if(!mobile())return;const panel=$(which);if(!panel)return;const opening=panel.hidden;closeDrawer();closeActions();closePanels();if(opening){panel.hidden=false;const trigger=panelButtonIds[panelIds.indexOf(which)];$(trigger)?.setAttribute('aria-expanded','true');if(which==='mobileSearchPanel')setTimeout(()=>$('mobileSearchInput')?.focus(),0);if(which==='mobileLayersPanel')syncLayerButtons();}}
 function setFocus(active){if(!mobile())active=false;document.body.classList.toggle('pig-mobile-focus',active);$('mobileImmersiveToggle')?.setAttribute('aria-pressed',String(active));const bar=$('mobileFocusBar');if(bar)bar.hidden=!active;if(active){closeDrawer();closeActions();closePanels();}invalidate();}
 function syncLayerButtons(){document.querySelectorAll('[data-mobile-layer-view]').forEach(b=>b.classList.toggle('is-active',$('mode'+({both:'Both',survey:'Survey',aerial:'Aerial'}[b.dataset.mobileLayerView]))?.classList.contains('active')||false));}
 function mountLayerSettings(){const dest=$('mobileLayerSettings');const src=document.querySelector('.layer-controls');if(!src||!dest)return;const ids=['showF03','showFarmNames','showAuditAreas'];ids.forEach(id=>{const original=$(id);if(!original||!original.closest('label'))return;const label=document.createElement('label');const box=document.createElement('input');box.type='checkbox';box.checked=original.checked;box.setAttribute('aria-label',original.closest('label').textContent.trim()||id);box.addEventListener('change',()=>{original.checked=box.checked;original.dispatchEvent(new Event('change',{bubbles:true}));});original.addEventListener('change',()=>{box.checked=original.checked;});label.append(box,document.createTextNode(original.closest('label').textContent.trim()));dest.appendChild(label);});}
 function mountStats(){const dest=$('mobileStatsLinks');if(!dest)return;document.querySelectorAll('.metrics .metric-link').forEach(original=>{const b=document.createElement('button');b.type='button';const label=original.querySelector('span')?.textContent||'統計';const num=original.querySelector('b');b.append(document.createTextNode(label+' '));const n=document.createElement('b');n.textContent=num?.textContent||'—';b.appendChild(n);if(num)new MutationObserver(()=>{n.textContent=num.textContent;}).observe(num,{subtree:true,childList:true,characterData:true});b.addEventListener('click',()=>{closePanels();original.click();});dest.appendChild(b);});}
 // V3.4.19: 只暫時隱藏表單 DOM，不呼叫 close()，所以保留欄位、驗證與 map center。
 let peekKind=null,peekPreviousFocus=false,peekScrollTop=0,choosingPoint=false,candidatePoint=null,originalCamera=null;
 // 單一候選點預覽；原座標只保留在表單，不畫出比較線或距離。
 function refreshPickPreview(){window.PigMapPickPreview?.show?.(choosingPoint?candidatePoint:null);}
 function rejectMarker(){if(!peekKind||!choosingPoint)return false;const coords=$('mobileMapPeekCoords');if(coords)coords.textContent='這是既有豬場標記；請點選地圖空白處，避免誤選。';return true;}
 const peekForms={new:'cloudNewForm',edit:'cloudEditForm'};
 function isPeekFormOpen(kind){const panel=$('cloudPanel'),form=$(peekForms[kind]);return mobile()&&panel&&!panel.hidden&&form&&!form.hidden;}
 function formatPosition(kind){
  const prefix=kind==='new'?'cloudNew':'cloud';
  const lat=$((kind==='new'?'cloudNewLat':'cloudLat'))?.value;
  const lng=$((kind==='new'?'cloudNewLng':'cloudLng'))?.value;
  const county=$(prefix+'County')?.value?.trim()||'';
  const town=$(prefix+'Town')?.value?.trim()||'';
  const address=$(prefix+'Address')?.value?.trim()||'';
  return [county+town,address,lat&&lng?`${lat}, ${lng}`:'尚未填入座標'].filter(Boolean).join(' · ');
 }
 function updateMapPeekLabels(){
  for(const kind of ['new','edit']){
   const summary=$(kind==='new'?'mobileNewLocationSummary':'mobileEditLocationSummary');
   if(summary)summary.textContent=formatPosition(kind);
  }
 }
 function openMapPeek(kind){
  if(peekKind||!isPeekFormOpen(kind))return;
  updateMapPeekLabels();peekKind=kind;choosingPoint=false;candidatePoint=null;originalCamera=window.PigMapCamera?.get?.()||null;
  if($('mobileMapPeekCandidate'))$('mobileMapPeekCandidate').hidden=true;
  $('mobileMapPeekSelect')?.removeAttribute('hidden');
  peekPreviousFocus=document.body.classList.contains('pig-mobile-focus');
  peekScrollTop=$('cloudPanel').querySelector('.cloud-dialog')?.scrollTop||0;
  closeDrawer();closeActions();closePanels();
  $('cloudPanel').hidden=true;
  $('mobileMapPeekReturn').hidden=false;
  document.body.classList.add('pig-map-peeking');
  invalidate();
 }
 function setChoosing(on){
  if(!peekKind)return;
  choosingPoint=on;candidatePoint=null;
  const panel=$('mobileMapPeekCandidate'),select=$('mobileMapPeekSelect'),confirm=$('mobileMapPeekConfirm'),coords=$('mobileMapPeekCoords');
  if(panel)panel.hidden=!on;
  if(select){select.disabled=on;select.textContent=on?'選點中':'重新選點';}
  if(confirm)confirm.disabled=true;
  if(coords)coords.textContent='請點選地圖空白處，核對位置後按「確認新位置」。';
  refreshPickPreview();
  const hint=$('mobileMapPeekHint');if(hint)hint.textContent=on?'重新選點中 · 尚未修改表單':'地圖核對中 · 資料尚未送出';
  document.body.classList.toggle('pig-map-reselecting',on);
 }
 function chooseCandidate(lat,lng){
  if(!peekKind||!choosingPoint)return false;
  if(!window.PigAddressLookup?.valid(Number(lat),Number(lng))){$('mobileMapPeekCoords').textContent='座標不在可支援的臺灣範圍，請重新選取';return true;}
  candidatePoint={lat:Number(lat),lng:Number(lng)};
  $('mobileMapPeekCoords').textContent=`緯度 ${candidatePoint.lat.toFixed(8)} · 經度 ${candidatePoint.lng.toFixed(8)}`;
  $('mobileMapPeekConfirm').disabled=false;refreshPickPreview();
  return true;
 }
 function confirmCandidate(){
  if(!choosingPoint||!candidatePoint||!peekKind)return;
  const kind=peekKind,point=candidatePoint;
  const applied=window.PigCommunity?.updateDraftPoint?.(kind,point.lat,point.lng);
  if(!applied){$('mobileMapPeekCoords').textContent='表單已結束或無法更新，請取消重選後重新開啟。';return;}
  setChoosing(false);updateMapPeekLabels();
  const hint=$('mobileMapPeekHint');if(hint)hint.textContent='新位置已寫入表單（尚未送審） · 請核對地址';
  resumeMapPeek();
 }
 function cancelChoosing(){
  setChoosing(false);
  if(originalCamera)window.PigMapCamera?.restore?.(originalCamera);
 }
 window.PigMobileMapPick={handleMapPoint:chooseCandidate,rejectMarker,get active(){return !!(peekKind&&choosingPoint);}};
 function resumeMapPeek(){
  if(!peekKind)return;
  if(choosingPoint){cancelChoosing();}
  window.PigMapPickPreview?.clear?.();
  const kind=peekKind;peekKind=null;choosingPoint=false;candidatePoint=null;originalCamera=null;
  document.body.classList.remove('pig-map-peeking','pig-map-reselecting');
  $('mobileMapPeekReturn').hidden=true;
  const panel=$('cloudPanel');if(panel){panel.hidden=false;panel.classList.add('cloud-form-active');}
  const form=$(peekForms[kind]);if(!form||form.hidden){
   // 表單已由其他流程結束，不重新開啟已送出的內容。
   if(panel)panel.hidden=true;
   return;
  }
  const dialog=panel?.querySelector('.cloud-dialog');if(dialog)dialog.scrollTop=peekScrollTop;
  updateMapPeekLabels();invalidate();
 }
 function clearStaleMapPeek(){
  if(!peekKind)return;
  if(!mobile()){resumeMapPeek();return;}
  if($(peekForms[peekKind])?.hidden){peekKind=null;choosingPoint=false;candidatePoint=null;originalCamera=null;document.body.classList.remove('pig-map-peeking','pig-map-reselecting');$('mobileMapPeekReturn').hidden=true;$('mobileMapPeekCandidate').hidden=true;window.PigMapPickPreview?.clear?.();}
 }
 function init(){
 document.querySelectorAll('[data-mobile-map-peek]').forEach(button=>button.addEventListener('click',()=>openMapPeek(button.dataset.mobileMapPeek)));
 $('mobileMapPeekResume')?.addEventListener('click',resumeMapPeek);
 $('mobileMapPeekSelect')?.addEventListener('click',()=>setChoosing(true));
 $('mobileMapPeekCancel')?.addEventListener('click',cancelChoosing);
 $('mobileMapPeekConfirm')?.addEventListener('click',confirmCandidate);
 for(const id of ['cloudNewForm','cloudEditForm']){
  $(id)?.addEventListener('input',updateMapPeekLabels);
  $(id)?.addEventListener('change',updateMapPeekLabels);
 }
 const cloudPanel=$('cloudPanel');
 if(cloudPanel)new MutationObserver(()=>{clearStaleMapPeek();updateMapPeekLabels();}).observe(cloudPanel,{attributes:true,attributeFilter:['hidden']});
 document.addEventListener('pig-farm-selected',e=>{selectedUid=e.detail?.uid||null;selectionDismissed=false;closePanels();syncSelected();});
 $('mobileSelectedName')?.addEventListener('click',openSelectedInfo);
 $('mobileSelectedInfo')?.addEventListener('click',openSelectedInfo);
 $('mobileSelectedDismiss')?.addEventListener('click',()=>{selectionDismissed=true;syncSelected();});
 const selectedSource=$('selectedFarmCard');if(selectedSource)new MutationObserver(syncSelected).observe(selectedSource,{attributes:true,attributeFilter:['hidden']});
 // 讓抽屜成為真正位於地圖上方的觸控層：把手手勢不交給 Leaflet。
 const drawerHandle=$('mobileDrawerHandle'),drawer=$('sidebar');
 let dragStart=null,dragOffset=0,dragPointer=null;
 function drawerDragReset(){dragStart=null;dragOffset=0;dragPointer=null;if(drawer){drawer.style.transform='';drawer.classList.remove('pig-drawer-dragging');}}
 function drawerDragBegin(y){if(!document.body.classList.contains('pig-drawer-open'))return;dragStart=y;dragOffset=0;drawer?.classList.add('pig-drawer-dragging');}
 function drawerDragMove(y){if(dragStart===null)return;dragOffset=Math.max(0,y-dragStart);if(drawer)drawer.style.setProperty('transform',`translate3d(0,${dragOffset}px,0)`,'important');}
 function drawerDragEnd(){if(dragStart===null)return;const dy=dragOffset;drawerDragReset();if(dy>55)closeDrawer();}
 drawerHandle?.addEventListener('touchstart',e=>{if(e.touches.length!==1)return;e.stopPropagation();drawerDragBegin(e.touches[0].clientY);},{passive:true});
 drawerHandle?.addEventListener('touchmove',e=>{if(dragStart===null)return;e.preventDefault();e.stopPropagation();drawerDragMove(e.touches[0].clientY);},{passive:false});
 drawerHandle?.addEventListener('touchend',e=>{e.stopPropagation();drawerDragEnd();},{passive:true});
 drawerHandle?.addEventListener('touchcancel',drawerDragReset,{passive:true});
 // Pointer 事件涵蓋滑鼠及支援 pointer 的裝置，避免觸控/滑鼠雙重觸發。
 drawerHandle?.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')return;e.stopPropagation();dragPointer=e.pointerId;drawerDragBegin(e.clientY);drawerHandle.setPointerCapture?.(e.pointerId);});
 drawerHandle?.addEventListener('pointermove',e=>{if(e.pointerId!==dragPointer)return;e.stopPropagation();drawerDragMove(e.clientY);});
 drawerHandle?.addEventListener('pointerup',e=>{if(e.pointerId!==dragPointer)return;e.stopPropagation();drawerDragEnd();});
 drawerHandle?.addEventListener('pointercancel',drawerDragReset);
 // 在清單內滑動時維持清單自己的捲動，不把觸控事件傳給地圖。
 drawer?.addEventListener('touchstart',e=>e.stopPropagation(),{passive:true});
 drawer?.addEventListener('touchmove',e=>e.stopPropagation(),{passive:true});
 drawer?.addEventListener('wheel',e=>e.stopPropagation(),{passive:true});
 document.body.classList.remove('pig-drawer-open','pig-mobile-focus');
 const scrim=$('mobileDrawerScrim');if(scrim)scrim.hidden=true;
 const menu=$('mobileActionMenu');if(menu)menu.hidden=true;
 const oldAim=$('mobileAimTools');if(oldAim){oldAim.hidden=true;oldAim.setAttribute('aria-hidden','true');}

 const quickSearch=$('mobileQuickSearch');
 function syncQuickSearch(){const original=$('search');if(!original||!quickSearch)return;original.value=quickSearch.value;original.dispatchEvent(new Event('input',{bubbles:true}));}
 quickSearch?.addEventListener('focus',()=>{if(mobile()){closePanels();openDrawer();}});
 quickSearch?.addEventListener('input',()=>{if(!mobile())return;syncQuickSearch();if(!document.body.classList.contains('pig-drawer-open'))openDrawer();});
 quickSearch?.addEventListener('search',()=>{if(mobile()){syncQuickSearch();openDrawer();}});
 quickSearch?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();syncQuickSearch();openDrawer();quickSearch.blur();}});
 $('mobileSearchToggle')?.addEventListener('click',()=>{if(!mobile())return;quickSearch?.focus();syncQuickSearch();openDrawer();});
 // 搜尋結果被其他程式清除時，維持上方欄位同步。
 $('search')?.addEventListener('input',()=>{if(quickSearch&&document.activeElement!==quickSearch)quickSearch.value=$('search').value;});
 $('mobileStatsToggle')?.addEventListener('click',()=>togglePanel('mobileStatsPanel'));
 $('mobileLayersToggle')?.addEventListener('click',()=>togglePanel('mobileLayersPanel'));
 $('mobileImmersiveToggle')?.addEventListener('click',()=>setFocus(!document.body.classList.contains('pig-mobile-focus')));
 $('mobileFocusExit')?.addEventListener('click',()=>setFocus(false));
 $('mobileFocusLocate')?.addEventListener('click',()=>clickOriginal('geoLocateNow'));
 $('mobileFocusLayers')?.addEventListener('click',()=>togglePanel('mobileLayersPanel'));
 [['mobileSearchClose','mobileSearchPanel'],['mobileStatsClose','mobileStatsPanel'],['mobileLayersClose','mobileLayersPanel']].forEach(([id])=>$(id)?.addEventListener('click',closePanels));
  document.querySelectorAll('[data-mobile-layer-view]').forEach(b=>b.addEventListener('click',()=>{clickOriginal('mode'+({both:'Both',survey:'Survey',aerial:'Aerial'}[b.dataset.mobileLayerView]));syncLayerButtons();}));
 mountStats();mountLayerSettings();syncLayerButtons();
 const photoLabels=$('photoPlaceLabels');
 photoLabels?.addEventListener('change',()=>window.PigPhotoPlaceLabels?.set?.(photoLabels.checked));
 $('mobileFarmsOpen')?.addEventListener('click',()=>document.body.classList.contains('pig-drawer-open')?closeDrawer():openDrawer());
 $('mobileDrawerClose')?.addEventListener('click',closeDrawer);
 $('mobileDrawerScrim')?.addEventListener('click',closeDrawer);
 $('mobileMapHome')?.addEventListener('click',()=>{closeActions();closeDrawer();closePanels();setFocus(false);});
 $('mobileFabToggle')?.addEventListener('click',toggleActions);
 $('mobileActionBrowse')?.addEventListener('click',()=>action('toolBrowse'));
 $('mobileActionInspect')?.addEventListener('click',()=>action('toolInspect'));
 $('mobileActionPoint')?.addEventListener('click',()=>action('toolPoint'));
 $('mobileActionWorkbench')?.addEventListener('click',()=>action('workbenchOpen'));
 $('mobileActionATIS')?.addEventListener('click',()=>action('headATIS'));
 $('mobileActionHealth')?.addEventListener('click',()=>action('dataHealthOpen'));
 $('mobileActionBackup')?.addEventListener('click',()=>action('backupTop'));
 $('mobileActionAim')?.addEventListener('click',()=>{closeActions();clickOriginal('mobileAimMain');});
 $('mobileAimCapture')?.addEventListener('click',()=>clickOriginal('mobileAimMain'));
 $('mobileAimCancel')?.addEventListener('click',()=>clickOriginal('mobileAimClose'));
 $('cloudStatus')?.addEventListener('click',()=>{if(mobile())window.PigCommunity?.open();});
 $('farmList')?.addEventListener('click',e=>{if(mobile()&&e.target.closest('[data-id],[data-open-editor]'))closeDrawer();});
 $('search')?.addEventListener('focus',()=>{if(mobile())openDrawer();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeDrawer();closeActions();closePanels();if(document.body.classList.contains('pig-mobile-focus'))setFocus(false);}});
 window.addEventListener('resize',()=>{clearStaleMapPeek();syncSelected();if(!mobile()){closeDrawer();closeActions();closePanels();setFocus(false);}aimChanged($('maps')?.classList.contains('aim-mode'));});
 // 窄版手機第一次開啟優先只顯示正射影像，避免兩張小圖；使用者仍可點選雙圖對照。
 if(matchMedia('(max-width:600px)').matches&&$('modeBoth')?.classList.contains('active')){
   setTimeout(()=>{if($('modeBoth')?.classList.contains('active'))clickOriginal('modeAerial');},550);
 }
 aimChanged(false);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
