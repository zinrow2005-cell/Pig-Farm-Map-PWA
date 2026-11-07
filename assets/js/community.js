/* 豬場查核 V3.3.64｜待審案件與頂端統計統一同步。 */
(function (root) {'use strict';
const $=id=>document.getElementById(id);
const clean=(value,n)=>String(value??'').trim().slice(0,n);
const esc=value=>String(value??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const conf=root.PIG_FIREBASE_CONFIG||{};
const configured=!!(conf.apiKey&&conf.projectId&&conf.appId&&conf.authDomain&&!String(conf.apiKey).includes('請填'));
let auth=null,db=null,A=null,F=null,user=null,admin=false,adminReady=false,hook=null,started=false;
let liveFarms=new Map(),proposals=[],activeFarm=null,unsubFarms=null,unsubProposals=null,loggedInSeq=0;
let farmsFromCache=true,seedBusy=false,newPoint=null,newBusy=false,auditContext=null,unsubNewSubmissions=null,newSubmissions=[];
let deletedFarmIds=new Set(),unsubDeleted=null,deleteBusy=false,editBusy=false;
let unifiedFlow=null;
let sharedAudits=[],syncBusy=false;
// Independent pending-only listeners: history windows are capped at 50, but counts must not be.
let pendingNew=[],pendingEdits=[],unsubPendingNew=null,unsubPendingEdits=null;
let pendingLoad={new:false,edit:false},pendingError={new:'',edit:''};
function mergeProposalRows(){
 const rows=new Map();
 for(const p of newSubmissions)if(!admin||p.status!=='pending'||!pendingLoad.new)rows.set('new:'+p.id,{...p,kind:'new'});
 for(const p of proposals)if(!admin||p.status!=='pending'||!pendingLoad.edit)rows.set('edit:'+p.id,{...p,kind:'edit'});
 if(admin){
  for(const p of pendingNew)rows.set('new:'+p.id,{...p,kind:'new'});
  for(const p of pendingEdits)rows.set('edit:'+p.id,{...p,kind:'edit'});
 }
 return [...rows.values()].sort((a,b)=>{
  const t=v=>v?.toMillis?.()||v?.toDate?.()?.getTime?.()||0;
  return t(b.submittedAt)-t(a.submittedAt);
 });
}
function pendingSummary(){
 if(!user)return {count:0,ready:true,error:false};
 if(admin){const ready=pendingLoad.new&&pendingLoad.edit;
  return {count:pendingNew.length+pendingEdits.length,ready,error:!!(pendingError.new||pendingError.edit)};
 }
 return {count:mergeProposalRows().filter(p=>p.status==='pending').length,ready:true,error:false};
}
function updatePendingUi(){
 const summary=pendingSummary();
 const badge=$('cloudPendingShortcut');
 if(badge){
  badge.hidden=!user;
  badge.textContent=summary.error?'待審數量無法確認':!summary.ready?'待審讀取中…':`待審 ${summary.count} 筆`;
  badge.title=summary.error?'待審資料讀取失敗，請進入共同編輯查看錯誤':!summary.ready?'正在同步新增與修改案件':'點此開啟待審核定';
 }
}
function stopPendingSubscriptions(){
 if(unsubPendingNew){unsubPendingNew();unsubPendingNew=null;}
 if(unsubPendingEdits){unsubPendingEdits();unsubPendingEdits=null;}
 pendingNew=[];pendingEdits=[];
 pendingLoad={new:false,edit:false};pendingError={new:'',edit:''};
}
function subscribePendingCases(){
 stopPendingSubscriptions();
 if(!user||!admin||!db){updatePendingUi();return;}
 for(const config of [{kind:'new',collection:'farmSubmissions'},{kind:'edit',collection:'suggestions'}]){
  const q=F.query(F.collection(db,config.collection),F.where('status','==','pending'));
  const sub=F.onSnapshot(q,snap=>{
   const rows=snap.docs.map(d=>({...d.data(),id:d.id}));
   if(config.kind==='new')pendingNew=rows;else pendingEdits=rows;
   pendingLoad[config.kind]=true;pendingError[config.kind]='';
   renderProposals();updatePendingUi();syncIndicator();
  },e=>{
   pendingLoad[config.kind]=false;pendingError[config.kind]=err(e);
   status(`待審案件同步失敗（${config.collection}）：${err(e)}`,true);
   renderProposals();updatePendingUi();
  });
  if(config.kind==='new')unsubPendingNew=sub;else unsubPendingEdits=sub;
 }
 updatePendingUi();
}
let cloudAuditPageSize=100,cloudFormDirty=false; // cloud copies never replace local data without explicit import
function status(msg,bad=false){
 for(const id of ['cloudStatus','cloudDialogStatus']){const el=$(id);if(el){el.textContent=msg;el.dataset.error=bad?'yes':'no';}}
 const inline=$('cloudNewSubmitFeedback');if(inline && !$('cloudNewForm')?.hidden){inline.textContent=msg;inline.dataset.error=bad?'yes':'no';inline.hidden=false;}
 const btn=$('cloudOpen');if(btn)btn.title=msg;
}
function setCloudView(view='manage'){
 const valid=['manage','review','sync'];if(!valid.includes(view))view='manage';
 const panel=$('cloudPanel');if(!panel)return;
 panel.dataset.view=view;
 for(const name of valid){const btn=$('cloudTab'+name[0].toUpperCase()+name.slice(1));if(btn){btn.setAttribute('aria-selected',name===view?'true':'false');}}
 if(view==='review')renderProposals();
 if(view==='sync'&&!user)syncMessage('請先使用 Google 帳號登入，才能讀取跨裝置查核。',true);
 const hints={manage:'豬場管理：新增、搜尋與修改既有豬場。',review:'待審核定：查看待審案件與核准結果。',sync:'跨裝置查核：讀取、上傳及匯入查核紀錄。'};
 const hint=$('cloudWorkflowHint');if(hint)hint.textContent=hints[view];
 const scroll=$('cloudWorkflowNav');if(scroll)scroll.scrollIntoView({block:'nearest'});
}

// Tabs must work even if GIS initialization or Firebase fails.
let cloudTabsBound=false;
function bindCloudTabs(){
 if(cloudTabsBound)return;
 const nav=$('cloudWorkflowNav');if(!nav)return;
 cloudTabsBound=true;
 nav.addEventListener('click',event=>{
  const button=event.target.closest('button[data-cloud-view]');
  if(!button||!nav.contains(button))return;
  event.preventDefault();
  const view=button.dataset.cloudView;
  const panel=$('cloudPanel');
  if(panel?.classList.contains('cloud-form-active')){
   if(!canLeaveCloudForm())return;
   clearCloudFormDirty();
   panel.classList.remove('cloud-form-active');
   const newForm=$('cloudNewForm'),editForm=$('cloudEditForm');
   if(newForm)newForm.hidden=true;
   if(editForm)editForm.hidden=true;
  }
  setCloudView(view);
 });
}
function initCloudFormNavigation(){
 const panel=$('cloudPanel'),back=$('cloudBackToWork'),bar=$('cloudFormNavigation');
 if(!panel||!back||!bar||back.dataset.bound==='1')return;
 back.dataset.bound='1';
 back.addEventListener('click',()=>{
  if(!canLeaveCloudForm())return;clearCloudFormDirty();
  if(unifiedFlow){unifiedBack();return;}
  const form=(!$('cloudEditForm')?.hidden)?$('cloudEditForm'):$('cloudNewForm');
  if(form&&!form.hidden){const active=document.activeElement;if(form.contains(active)&&active?.blur)active.blur();}
  panel.classList.remove('cloud-form-active');
  $('cloudEditForm').hidden=true;$('cloudNewForm').hidden=true;
  setCloudView('manage');
  const n=$('cloudDialogStatus');if(n)n.textContent='已返回豬場管理。可切換上方三個工作分頁。';
 });
 new MutationObserver(()=>{bar.hidden=!panel.classList.contains('cloud-form-active');}).observe(panel,{attributes:true,attributeFilter:['class']});
 bar.hidden=!panel.classList.contains('cloud-form-active');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{bindCloudTabs();initCloudFormNavigation();});
else {bindCloudTabs();initCloudFormNavigation();}
// Guard users against accidentally leaving an unfinished farm edit.
function canLeaveCloudForm(){
 if(!cloudFormDirty)return true;
 return root.confirm('豬場資料尚未儲存。確定要放棄剛才輸入的修改嗎？');
}
function clearCloudFormDirty(){cloudFormDirty=false;}
function err(e){const code=String(e?.code||''); if(code.includes('permission-denied'))return '沒有資料庫存取權限：請確認 Firestore 規則已發布、Google 登入已啟用及管理員 UID 設定';
 if(code.includes('auth/unauthorized-domain'))return '目前網站網域尚未加入 Firebase Authentication 已授權網域';
 if(code.includes('popup-blocked'))return '瀏覽器擋住了 Google 登入視窗；請使用 Safari 或 Chrome 開啟網站並允許彈出視窗';
 if(code.includes('auth/popup-closed-by-user'))return '已取消 Google 登入';
 if(code.includes('unavailable')||code.includes('network'))return '網路或 Firebase 連線暫時不可用，資料尚未送達雲端';
 return clean(e?.message||e,200);}
function enabled(){return configured;}
function open(){clearCloudFormDirty();const p=$('cloudPanel');if(!p)return;p.hidden=false;renderUser();renderProposals();updateLinkage();setCloudView('manage');if(!configured)status('尚未填入 Firebase Web 設定；目前仍使用本機豬場資料，沒有雲端同步',true);}
function close(){clearCloudFormDirty();if($('cloudPanel')){$('cloudPanel').hidden=true;$('cloudPanel').classList.remove('cloud-form-active');}if($('cloudUnifiedWizard'))$('cloudUnifiedWizard').hidden=true;unifiedFlow=null;auditContext=null;}
// Shared identity: the parcelKey is the stable link across local review,
// farmSubmissions and farms.auditParcelKey. Point-only records retain an explicit key.
function parcelSummary(parcelKey=''){
 const key=clean(parcelKey,160);if(!key)return '目前為人工座標點（未取得 F03 地塊 ID）';
 const farms=[...liveFarms.values()].filter(f=>f.auditParcelKey===key&&!deletedFarmIds.has(f.uid));
 const pending=newSubmissions.filter(x=>x.parcelKey===key&&x.status==='pending');
 const lines=[`地塊 ${key}｜正式豬場 ${farms.length} 筆｜待審 ${pending.length} 筆`];
 if(farms.length)lines.push('既有：'+farms.slice(0,3).map(x=>x.name).join('、'));
 if(farms.length>1)lines.push('同地塊有多筆正式豬場：請人工核對，不會自動合併');
 return lines.join('；');
}
function updateLinkage(key='') {const el=$('cloudLinkageStatus');if(el)el.textContent=parcelSummary(key||auditContext?.parcelKey||liveFarms.get(activeFarm)?.auditParcelKey||'');}
function syncMessage(msg,bad=false){const el=$('cloudSyncStatus');if(el){el.textContent=msg;el.dataset.error=bad?'yes':'no';}}
function auditSafe(a){
 const key=clean(a?.key,160),lat=Number(a?.lat),lng=Number(a?.lng),decision=a?.decision;
 if(!key||!['pig','maybe','other','defer'].includes(decision)||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<21||lat>27||lng<118||lng>123)return null;
 return {key,lat,lng,decision,year:Number(a.year)===3?3:4,source:['manual','tile','offline','official'].includes(a.source)?a.source:'manual',
 note:clean(a.note,500),recordUid:clean(a.recordUid,100),promotedToUid:clean(a.promotedToUid,100)};
}
// Cloud audit records are not farms and must never change the 315+ formal count.
async function publishAudit(a){
 if(!user||!db||!adminReady)return false;
 const row=auditSafe(a);if(!row)return false;
 const id='audit-'+user.uid+'-'+stableKey(row.key);
 try{await F.setDoc(F.doc(db,'sharedAudits',id),{...row,ownerUid:user.uid,updatedAt:F.serverTimestamp()});return true;}
 catch(e){syncMessage('本機查核已保存，但雲端查核同步失敗：'+err(e),true);return false;}
}
async function readSharedAudits(){
 if(!db||!user||!adminReady){syncMessage('請先登入 Google，確認身分後再讀取。',true);return false;}
 try{const q=admin?F.query(F.collection(db,'sharedAudits'),F.limit(500)):
   F.query(F.collection(db,'sharedAudits'),F.where('ownerUid','==',user.uid),F.limit(500));
  const snap=await F.getDocsFromServer(q);sharedAudits=snap.docs.map(d=>({...d.data(),cloudDocId:d.id}));renderSharedAudits();
  syncMessage(`雲端查核已讀取 ${sharedAudits.length} 筆（最多顯示 500 筆）；匯入時不覆寫本機資料。`);return true;
 }catch(e){syncMessage('讀取雲端查核失敗：'+err(e),true);return false;}
}
// Display useful location and farm data first; technical parcel IDs belong to details.
function auditLinkedFarm(a){
 const uid=clean(a.promotedToUid||a.recordUid,100);
 return uid?(liveFarms.get(uid)||hook?.getRecord?.(uid)||null):null;
}
function auditDecisionLabel(a){return {pig:'確認是豬場',maybe:'疑似豬場',other:'非豬場',defer:'待確認'}[a.decision]||'待確認';}
function auditStatusLabel(a){return a.promotedToUid?'已轉正式豬場':auditDecisionLabel(a);}
function auditTitle(a){
 const f=auditLinkedFarm(a);
 const title=clean(f?.name||a.farmName||a.name,120);
 return title||'未命名查核地塊';
}
function auditLocation(a){
 const f=auditLinkedFarm(a);
 const place=[clean(f?.county||a.county,30),clean(f?.town||a.town,30),clean(f?.address||a.address,140)].filter(Boolean).join(' ');
 if(place)return place;
 const lat=Number(a.lat),lng=Number(a.lng);
 return Number.isFinite(lat)&&Number.isFinite(lng)?`地圖位置 ${lat.toFixed(6)}, ${lng.toFixed(6)}`:'尚無可用位置';
}
function auditRowsFiltered(){
 const term=clean($('cloudAuditSearch')?.value,120).toLocaleLowerCase();
 const state=$('cloudAuditFilter')?.value||'all';
 return sharedAudits.filter(a=>{
  if(state==='promoted'&&!a.promotedToUid)return false;
  if(state!=='all'&&state!=='promoted'&&(a.promotedToUid||a.decision!==state))return false;
  const search=[auditTitle(a),auditLocation(a),auditDecisionLabel(a),a.key,a.cloudDocId].join(' ').toLocaleLowerCase();
  return !term||search.includes(term);
 });
}
function renderSharedAudits(){
 const target=$('cloudSyncList');if(!target)return;
 const filtered=auditRowsFiltered(),visible=filtered.slice(0,cloudAuditPageSize);
 const count=$('cloudAuditCount');if(count)count.textContent=`符合條件 ${filtered.length} 筆／雲端已讀取 ${sharedAudits.length} 筆`+(filtered.length>cloudAuditPageSize?`（已顯示前 ${cloudAuditPageSize} 筆，可點下方「顯示更多」）`:'');
 const more=$('cloudAuditMore');if(more){more.hidden=filtered.length<=cloudAuditPageSize;more.textContent=`顯示更多（尚有 ${Math.max(0,filtered.length-cloudAuditPageSize)} 筆）`;}
 target.innerHTML=visible.map(a=>{
  const id=esc(a.cloudDocId||''),title=esc(auditTitle(a)),loc=esc(auditLocation(a));
  const state=esc(auditStatusLabel(a)),own=a.ownerUid===user?.uid;
  const lat=Number(a.lat),lng=Number(a.lng),valid=Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=21&&lat<=27&&lng>=118&&lng<=123;
  const details=`<div class="cloud-audit-details"><div><b>判定：</b>${esc(auditDecisionLabel(a))}</div><div><b>來源：</b>${esc(own?'我的雲端紀錄':'其他登入者紀錄')}</div><div><b>座標：</b>${valid?esc(lat.toFixed(6)+', '+lng.toFixed(6)):'無'}</div><div><b>備註：</b>${esc(a.note||'未填寫')}</div><div><b>地塊內部識別碼：</b><code>${esc(a.key||'未提供')}</code></div>${a.promotedToUid?`<div><b>正式豬場關聯：</b><code>${esc(a.promotedToUid)}</code></div>`:''}</div>`;
  return `<article class="cloud-sync-entry cloud-audit-card"><div class="cloud-audit-top"><strong>${title}</strong><span class="cloud-audit-badge">${state}</span></div><div class="cloud-audit-place">${loc}</div><div class="cloud-audit-actions"><button type="button" data-cloud-audit-map="${id}" ${valid?'':'disabled'}>⌖ 查看地圖</button><button type="button" data-cloud-audit-detail="${id}" aria-expanded="false">查看詳情</button>${own?`<button type="button" class="cloud-audit-delete" data-cloud-audit-delete="${id}">刪除我的雲端副本</button>`:''}</div><div data-cloud-audit-detail-panel="${id}" hidden>${details}</div></article>`;
 }).join('')||'<p class="subtle">沒有符合條件的紀錄。可更換篩選條件或重新讀取雲端資料。</p>';
}
function viewSharedAuditOnMap(id){
 const a=sharedAudits.find(x=>x.cloudDocId===id);if(!a)return syncMessage('找不到這筆雲端查核，請重新讀取。',true);
 const lat=Number(a.lat),lng=Number(a.lng);
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<21||lat>27||lng<118||lng>123)return syncMessage('這筆紀錄沒有有效座標，無法定位。',true);
 const focused=hook?.focusSharedAudit?.(a)||false;
 if(!focused)return syncMessage('目前地圖尚未完成載入，請重新開啟地圖後再試。',true);
 close();
}
function toggleSharedAuditDetails(id,button){
 const panel=[...$('cloudSyncList').querySelectorAll('[data-cloud-audit-detail-panel]')].find(x=>x.dataset.cloudAuditDetailPanel===id);
 if(!panel)return;
 panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));button.textContent=panel.hidden?'查看詳情':'收起詳情';
}
async function deleteSharedAudit(id){
 if(!user||!db)return syncMessage('請先登入 Google。',true);
 const a=sharedAudits.find(x=>x.cloudDocId===id&&x.ownerUid===user.uid);if(!a)return syncMessage('僅能刪除自己的雲端查核。',true);
 if(!confirm('刪除這筆 Google 雲端查核副本？這不會刪除本機查核、正式豬場或送審案件。'))return;
 try{await F.deleteDoc(F.doc(db,'sharedAudits',id));sharedAudits=sharedAudits.filter(x=>x.cloudDocId!==id);renderSharedAudits();syncMessage('雲端查核副本已刪除；本機資料保持不變。');}
 catch(e){syncMessage('刪除雲端查核失敗：'+err(e),true);}
}
async function uploadLocalAudits(){
 if(syncBusy)return;if(!user||!db||!adminReady)return syncMessage('請先登入 Google。',true);
 const items=hook?.getLocalAudits?.()||[];
 if(!items.length)return syncMessage('本機沒有需要上傳的查核。');
 if(!confirm(`要將這台裝置的 ${items.length} 筆人工查核傳送至目前 Google 帳號的雲端嗎？不會新增正式豬場。`))return;
 syncBusy=true;let ok=0;try{for(const a of items){if(await publishAudit(a))ok++;}syncMessage(`已同步 ${ok}/${items.length} 筆。未成功的紀錄仍保存在本機。`);await readSharedAudits();}finally{syncBusy=false;}
}
async function importSharedAudits(){
 if(syncBusy)return;
 if(!user||!adminReady)return syncMessage('請先登入。',true);
 if(!sharedAudits.length){if(!await readSharedAudits())return;}
 if(!confirm('匯入雲端查核到本裝置？同地塊已存在的本機紀錄一律保留，不會覆寫。正式豬場資料不受影響。'))return;
 const result=await hook?.importSharedAudits?.(sharedAudits);
 syncMessage(result?`已匯入 ${result.added} 筆；略過 ${result.skipped} 筆既有／無效／超額紀錄。`:'本機匯入失敗或尚未準備完成。',!result);
}
function renderUser(){
 const who=$('cloudWho'),sign=$('cloudSignIn'),out=$('cloudSignOut'),submit=$('cloudSubmit'),seed=$('cloudSeed');
 const label=user?(admin?'管理員':(user.displayName||user.email||'已登入')):'Google 登入';
 const quick=$('cloudLoginQuick');if(quick){quick.textContent=user?(admin?'管理員 ✓':'我的帳號 ✓'):'Google 登入';quick.title=user?`已登入：${user.email||label}，點此開啟共同編輯`:'使用 Google 帳號登入';quick.setAttribute('aria-label',quick.title);}
 const mobileLabel=$('mobileAuthLabel');if(mobileLabel)mobileLabel.textContent=user?(admin?'管理員':'帳號'):'登入';
 if(who)who.textContent=user?`已登入 ${user.displayName||user.email||'Google 使用者'}${admin?' · 管理者':''}`:'尚未登入：可以查看正式場址；修改須 Google 登入';
 const deleteButton=$('cloudDelete');if(deleteButton){deleteButton.hidden=!(admin&&adminReady&&activeFarm&&liveFarms.has(activeFarm));deleteButton.disabled=deleteBusy||editBusy;}
 const approveButton=$('cloudApproveExisting');if(approveButton){approveButton.hidden=!(admin&&adminReady&&activeFarm&&liveFarms.has(activeFarm));approveButton.disabled=editBusy||!db||!user;}
 renderExistingApprovalStatus();
 const create=$('cloudNewOpen');if(create){create.hidden=!admin||!db;create.disabled=!admin||!db;}
 if(sign)sign.hidden=!!user;if(out)out.hidden=!user;
 if(submit){submit.disabled=!user||!db||!adminReady||editBusy;submit.textContent=admin?'直接儲存正式豬場':'送出資料供管理員審核';} const newSubmit=$('cloudNewSubmit');if(newSubmit){newSubmit.disabled=!user||!db||!adminReady||newBusy;newSubmit.textContent=!adminReady?'確認身分權限中…':admin?'儲存正式豬場（免審核）':'送出豬場資料供審核';}
 if(seed){seed.hidden=!admin||!db;seed.disabled=seedBusy;seed.textContent=seedBusy?'正在建立雲端資料…':'初始化／補齊315筆初始豬場（只新增缺漏）';}
 const first=$('cloudAdminFirstRun');if(first)first.hidden=!(admin&&db&&liveFarms.size===0&&!farmsFromCache);
}

function renderExistingApprovalStatus(){
 const box=$('cloudApprovalSummary');if(!box)return;
 const cloud=activeFarm?liveFarms.get(activeFarm):null;
 if(!cloud){box.textContent='請先從清單選擇已存在的雲端豬場，才能直接核定。';box.dataset.state='pending';return;}
 const hasPoint=cloud.lat!==null&&cloud.lat!==undefined&&cloud.lng!==null&&cloud.lng!==undefined&&Number.isFinite(Number(cloud.lat))&&Number.isFinite(Number(cloud.lng));
 const confirmed=hasPoint&&['pig','maybe'].includes(cloud.auditDecision);
 box.textContent=confirmed?`目前狀態：已核定 · ${cloud.name||'未命名豬場'} · 可重新核對位置及修改資料。`:`目前狀態：${hasPoint?'已有座標，但尚未完成管理員豬場判定':'待定位／未核定'} · 請核對名稱、地址與座標，再按「✓ 管理員直接核定此豬場」。`;
 box.dataset.state=confirmed?'approved':'pending';
}
function proposalDate(value){if(value?.toDate)return value.toDate().toLocaleString('zh-TW');return '剛剛';}
function renderProposals(){const box=$('cloudProposals');if(!box)return;
 if(!user){box.innerHTML='<p class="subtle">登入後可查看自己的申請及審核結果；管理員可查看待審清單。</p>';return;}
 const combined=mergeProposalRows();
 const pendingState=pendingSummary();
 box.innerHTML=(admin&&!pendingState.ready?'<p class="subtle">正在讀取全部待審案件，清單可能尚未完整。</p>':'')+(admin&&pendingState.error?'<p class="subtle">待審資料讀取失敗，請確認 Firebase 權限。統計暫不顯示 0。</p>':'')+(combined.length?combined.map(p=>`<article class="cloud-proposal"><div><strong>${esc(p.proposedName||p.farmUid)}</strong><small> ${esc(p.status==='approved'?'已採納':p.status==='rejected'?'未採納':'待確認')} · ${esc(proposalDate(p.submittedAt))}</small></div><div>${esc(p.proposedCounty)} ${esc(p.proposedTown)} · ${esc(p.proposedAddress)}</div><small>座標：${p.proposedLat===null?'未提供':esc(p.proposedLat)}, ${p.proposedLng===null?'未提供':esc(p.proposedLng)}</small>${p.note?`<small>依據：${esc(p.note)}</small>`:''}${p.kind==='new'?'<small>新增豬場申請</small>':''}${admin&&p.status==='pending'?`<div class="cloud-actions"><button type="button" data-approve="${esc(p.id)}" data-kind="${p.kind==='new'?'new':'edit'}">${p.kind==='new'?'核准新增':'確認採納'}</button><button type="button" data-reject="${esc(p.id)}" data-kind="${p.kind==='new'?'new':'edit'}">不採納</button></div>`:''}</article>`).join(''):'<p class="subtle">目前沒有共用編輯紀錄。</p>');
}
function edit(uid){open();clearCloudFormDirty();const r=hook?.getRecord(uid);if(!r){status('找不到此豬場紀錄',true);return;}activeFarm=uid;setCloudView('manage');$('cloudPanel').classList.add('cloud-form-active');
 const cloud=liveFarms.get(uid)||{};
 const geo=r.geometry?.type==='Point'?r.geometry.coordinates:null;
 $('cloudFarm').textContent=(cloud.name||r.name)+' · '+(cloud.town||r.town||'鄉鎮待查')+' · '+uid;
 $('cloudName').value=cloud.name??r.name;
 $('cloudCounty').value=cloud.county??r.county;
 $('cloudTown').value=cloud.town??r.town;
 $('cloudAddress').value=cloud.address??r.address;
 $('cloudLat').value=cloud.lat??(geo?geo[1]:'');$('cloudLng').value=cloud.lng??(geo?geo[0]:'');
 $('cloudNote').value='';$('cloudEditForm').hidden=false;renderUser();updateLinkage(cloud.auditParcelKey||'');
 if(!user)status('請先使用 Google 登入，再提交這筆豬場資料',true);
}
function editAt(uid,lat,lng){
 const rec=hook?.getRecord(uid);if(!rec){status('找不到此筆豬場，請重新搜尋。',true);return false;}
 const coordsValid=Number.isFinite(Number(lat))&&Number.isFinite(Number(lng))&&lat>=21&&lat<=27&&lng>=118&&lng<=123;
 if(!coordsValid){status('地圖選取的座標無效。',true);return false;}
 // Reusing the existing farm ID is essential: never create a second record.
 edit(uid);$('cloudNewForm').hidden=true;
 $('cloudLat').value=Number(lat).toFixed(8);$('cloudLng').value=Number(lng).toFixed(8);
 $('cloudFarm').textContent+=' · 已由地圖更新定位，請檢查並儲存';
 status(admin?'請確認這筆既有豬場位置，管理員儲存後直接更新正式資料。':'請確認這筆既有豬場位置，送審核准後才更新正式資料。');
 return true;
}
function renderLinkMatches(){
 const box=$('cloudLinkResults'),search=$('cloudLinkSearch');if(!box||!search)return;
 const term=search.value.trim().toLocaleLowerCase();if(!term){box.innerHTML='<small>輸入名稱、地址或舊版編號，搜尋現有豬場紀錄</small>';return;}
 const rows=hook?.findRecords?.(term)||[];
 box.innerHTML=rows.slice(0,20).map(r=>'<button type="button" data-link-existing="'+esc(r.uid)+'"><strong>'+esc(r.name||'未命名豬場')+'</strong><small>'+esc([r.county,r.town,r.address].filter(Boolean).join(' · '))+' · '+(r.located?'已有座標（將更新）':'待定位')+'</small></button>').join('')||'<small>沒有符合的豬場，可改為新增。</small>';
}
function linkExistingFromPoint(uid){
 if(!uid)return;
 const latText=$('cloudNewLat').value.trim(),lngText=$('cloudNewLng').value.trim();
 // Searching from the manager without first selecting a map point is EDIT,
 // never a silent location change to (0,0) or a new record.
 if(!latText&&!lngText){edit(uid);status('已開啟既有豬場；可編輯資料或選擇「在地圖選擇定位」。');return;}
 const lat=Number(latText),lng=Number(lngText);
 if(!Number.isFinite(lat)||!Number.isFinite(lng))return status('座標不完整，請先到地圖選點。',true);
 editAt(uid,lat,lng);
 if(unifiedFlow){$('cloudEditWizardBack').hidden=false;$('cloudEditWizardProgress').hidden=false;}
}
function beginNew(lat=null,lng=null){clearCloudFormDirty();
 open();if(!db||!user||!adminReady){status('請先登入，並等待管理員身分檢查完成，再新增或送審。',true);return false;}
 const hasCoords=lat!==null&&lng!==null;
 setCloudView('manage');
 newPoint=hasCoords?{lat:Number(lat),lng:Number(lng)}:{};
 activeFarm=null;$('cloudPanel').classList.add('cloud-form-active');$('cloudEditForm').hidden=true;$('cloudNewForm').hidden=false;renderUser();
 $('cloudNewDecision').value=auditContext?.decision||'pig';$('cloudNewParcel').textContent=auditContext?.parcelKey?'地塊識別：'+auditContext.parcelKey:'此點未取得 F03 地塊識別碼，將以座標建立標記';
 $('cloudNewName').value='';$('cloudNewCounty').value='雲林縣';$('cloudNewTown').value='';$('cloudNewAddress').value='';
 $('cloudNewLat').value=hasCoords?Number(lat).toFixed(8):'';
 $('cloudNewLng').value=hasCoords?Number(lng).toFixed(8):'';

 status(hasCoords?'已從地圖取得座標，請填入豬場名稱與地址後確認。':'請填入豬場資料與 WGS84 經緯度。');
 $('cloudLinkSearch').value='';renderLinkMatches();updateLinkage();$('cloudNewName').focus();return true;
}
// The identity of a parcel/point must remain stable across clicks and reloads.
// This is NOT a server-side uniqueness guarantee against arbitrary external clients.
function stableKey(value){let h=2166136261;for(const ch of String(value)){h^=ch.codePointAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
function draftIdentity(lat,lng){
 const key=clean(auditContext?.parcelKey,160);
 return key?`audit-${stableKey(key)}-${stableKey('parcel:'+key)}`:`point-${Math.round(lat*1e6)}-${Math.round(lng*1e6)}`;
}
function sameFarmPlace(f,lat,lng){return f.lat!=null&&f.lng!=null&&Math.hypot((Number(f.lat)-lat)*110574,(Number(f.lng)-lng)*111320*Math.cos(lat*Math.PI/180))<=8;}
async function createFarm(event){
 event.preventDefault();if(!db||!user||!adminReady){status('請等待 Google 身分及管理員權限確認完成再送出。',true);return;}
 if(newBusy)return;
 const name=clean($('cloudNewName').value,150),county=clean($('cloudNewCounty').value,40),town=clean($('cloudNewTown').value,40),address=clean($('cloudNewAddress').value,220);
 const latText=$('cloudNewLat').value.trim(),lngText=$('cloudNewLng').value.trim();
 if(!name||!county||!town){status('請完整填寫豬場名稱、縣市及鄉鎮。',true);return;}
 if(!latText||!lngText){status('新增地圖標記必須有經緯度。請使用「＋ 標記點」在地圖選位置，或填入正確座標。',true);return;}
 const lat=Number(latText),lng=Number(lngText);
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<21||lat>27||lng<118||lng>123){status('經緯度不在台灣有效範圍，請檢查。',true);return;}
 const parcelKey=clean(auditContext?.parcelKey,160),decision=$('cloudNewDecision')?.value||auditContext?.decision||'pig';
 const identifier=draftIdentity(lat,lng);
 const nearby=[...liveFarms.values()].filter(f=>sameFarmPlace(f,lat,lng)||(parcelKey&&f.auditParcelKey===parcelKey));
 // Several pre-existing records at one parcel may be genuine separate farms.
 // Never guess which one to overwrite and never add yet another duplicate.
 if(admin&&nearby.length>1){status(`附近或相同地塊已有 ${nearby.length} 筆正式紀錄：${nearby.slice(0,3).map(f=>f.name||f.uid).join('、')}。請先從清單選擇正確豬場進行「編輯」，暫停新增以避免重複。`,true);return;}
 if(admin&&farmsFromCache){status('正在等待伺服器同步正式豬場清單，尚不能安全判斷重複位置。請先按「↻ 同步」再儲存。',true);return;}
 if(!admin&&nearby.length){status('此位置已有正式豬場紀錄，請從清單選取該牧場後提交資料更正，避免重複送出新增申請。',true);return;}
 const exactNames=(hook?.findRecords?.(name)||[]).filter(r=>
  clean(r.name,150)===name&&clean(r.town,40)===town&&
  !nearby.some(f=>f.uid===r.uid));
 if(admin&&exactNames.length){status('名冊內已有同名同鄉鎮豬場「'+name+'」。請使用「搜尋既有豬場」選取原紀錄，再套用地圖位置及直接核定；為防止總數增加，本次停止新增。',true);return;}
 const candidate=admin&&nearby.length===1?nearby[0]:null;
 const targetUid=candidate?.uid||identifier;
 const action=candidate?'更新既有正式紀錄':'新增正式豬場';
 if(!confirm(`確定${admin?action:'提交管理員審查'}「${name}」？${candidate?`\n將更新現有紀錄「${candidate.name}」（不是增加新筆數）。`:''}\n位置：${county}${town} ${address}\n座標：${lat}, ${lng}`))return;
 newBusy=true;renderUser();status('正在向 Firestore 寫入並確認，請不要重複點擊…');
 try{
  let result;
  if(admin){
   const ref=F.doc(db,'farms',targetUid);
   // Transactions also recheck the server state; stale snapshots cannot create
   // the same deterministic document twice, even if Save is clicked again.
   await F.runTransaction(db,async tx=>{
    const snap=await tx.get(ref);
    const prev=snap.exists()?snap.data():null;
    if(prev&&!candidate){
      const matches=(parcelKey&&prev.auditParcelKey===parcelKey)||sameFarmPlace(prev,lat,lng);
      if(!matches)throw Error('此位置識別碼已被其他紀錄使用，請先檢查，不會覆寫。');
    }
    const payload={uid:targetUid,name,county,town,address,lat,lng,
      version:prev?Number(prev.version||1)+1:1,
      approvedSuggestionId:prev?.approvedSuggestionId??null,
      updatedAt:F.serverTimestamp(),auditDecision:decision,
      auditParcelKey:parcelKey||clean(prev?.auditParcelKey,160)};
    if(prev)tx.update(ref,payload);else tx.set(ref,payload);
   });
   // Update the visible list immediately after the acknowledged commit, not
   // just an unrelated locally generated placeholder entry.
   const cloud={uid:targetUid,name,county,town,address,lat,lng,version:candidate?Number(candidate.version||1)+1:1,auditDecision:decision,auditParcelKey:parcelKey};
   liveFarms.set(targetUid,cloud);hook?.applyApproved([cloud]);
   result={uid:targetUid,status:'approved',name,county,town,address,lat,lng,decision,parcelKey};
  } else {
   const submissionRef=F.doc(db,'farmSubmissions',parcelKey?`parcel-${stableKey(user.uid+':'+parcelKey)}`:`point-${stableKey(user.uid+':'+identifier)}`);
   // Do not read a not-yet-created farmSubmissions document first: the
   // owner-only GET rule needs resource.data and rejects a missing document.
   // A deterministic document ID plus create-only security rules means the
   // first setDoc is CREATE and later attempts are UPDATE (denied to users).
   // This safely prevents duplicates without a preflight read.
   const data={proposedName:name,proposedCounty:county,proposedTown:town,proposedAddress:address,
     proposedLat:lat,proposedLng:lng,decision,parcelKey,note:clean(auditContext?.note,500),
     submittedBy:user.uid,submittedAt:F.serverTimestamp(),status:'pending',reviewedBy:null,reviewedAt:null};
   await F.setDoc(submissionRef,data);
   result={uid:'',status:'pending'};
  }
  // Server has acknowledged this create/update/submission.  A later close
  // must not warn that the successfully committed form was unsaved.
  clearCloudFormDirty();
  $('cloudNewForm').hidden=true;newPoint=null;
  let localAuditOkay=true;
  if(auditContext){const ctx=auditContext;auditContext=null;if(admin&&ctx.onSaved)localAuditOkay=(await ctx.onSaved(result))!==false;}
  const message=!localAuditOkay?`豬場「${name}」已寫入雲端，但本機地塊查核尚未儲存成功。請先備份本機資料並檢查。`:admin?`已${candidate?'更新':'建立'}正式豬場「${name}」（ID：${targetUid}）。`:`「${name}」已送交管理員審查；未加入正式豬場筆數。`;
  status(message,!localAuditOkay);
  if(localAuditOkay){unifiedFlow=null;$('cloudUnifiedWizard').hidden=true;$('cloudPanel').hidden=true;$('cloudPanel').classList.remove('cloud-form-active');hook?.notifyApproved?.(message);if(admin)hook?.focusApproved?.(targetUid);}
 }catch(e){
  const code=String(e?.code||'unknown');
  let detail='';
  if(!admin&&code.includes('permission-denied')&&user&&db){
   try{
    const check=await F.getDocs(F.query(F.collection(db,'farmSubmissions'),F.where('submittedBy','==',user.uid),F.limit(100)));
    const expectedId=(parcelKey?`parcel-${stableKey(user.uid+':'+parcelKey)}`:`point-${stableKey(user.uid+':'+identifier)}`);
    const existing=check.docs.find(doc=>doc.id===expectedId);
    if(existing)detail=`這個位置已經有你的送審案件（狀態：${existing.data().status==='pending'?'待審':existing.data().status==='approved'?'已核准':'已處理'}），系統禁止重複覆寫。請至「待審核定」查詢。`;
    else detail='沒有查到相同 ID 的本人案件。請核對 Firebase 專案及已發布的 farmSubmissions 建立規則、Google 登入狀態。';
   }catch(probeError){detail='也無法讀取自己的送審案件（'+String(probeError?.code||'查詢失敗')+'），請確認 Firestore 正式規則與登入權杖。';}
  }
  const msg=detail||('儲存未完成：'+err(e));
  status(`${msg}（錯誤碼：${code}；Firebase 專案：${clean(conf.projectId,100)}）。資料尚未確認寫入，請不要連續送出。`,true);
 }
 finally{newBusy=false;renderUser();}
}
function publicRows(){return [...liveFarms.values()].filter(f=>!deletedFarmIds.has(f.uid));}
function subscribeDeleted(){if(unsubDeleted){unsubDeleted();unsubDeleted=null;}if(!db)return;unsubDeleted=F.onSnapshot(F.collection(db,'deletedFarms'),snapshot=>{deletedFarmIds=new Set(snapshot.docs.map(x=>x.id));hook?.removeDeleted?.([...deletedFarmIds]);hook?.applyApproved?.(publicRows());},e=>status('刪除紀錄同步失敗：'+err(e),true));}
async function deleteActiveFarm(uidOverride=null){
 if(uidOverride!==null)activeFarm=uidOverride;
 if(!admin||!adminReady||!db||!user||deleteBusy||editBusy){status('只有完成身分驗證的管理員才能刪除正式豬場。',true);return false;}
 const uid=activeFarm,record=liveFarms.get(uid);if(!record){status('正式紀錄不存在或已刪除，請重新同步。',true);return false;}
 if(farmsFromCache){status('目前仍是離線快取，無法安全刪除；請先同步雲端。',true);return false;}
 if(!confirm(`確定要刪除正式豬場「${record.name}」？\n這會同步移除地圖、清單和已匯入總數，不會刪除官方 F03 地塊。`))return false;
 const typed=prompt(`最後確認：請完整輸入「${record.name}」才能刪除。`);if(typed!==record.name){status('名稱不相符，已取消刪除。',true);return false;}
 deleteBusy=true;renderUser();status('正在刪除正式豬場並建立防重建紀錄…');
 try{await F.runTransaction(db,async tx=>{const farmRef=F.doc(db,'farms',uid),delRef=F.doc(db,'deletedFarms',uid);const farm=await tx.get(farmRef),tomb=await tx.get(delRef);if(!farm.exists())throw Error('雲端正式豬場已不存在，未執行刪除');if(tomb.exists())throw Error('此豬場已有刪除紀錄');if(Number(farm.data().version)!==Number(record.version))throw Error('資料已被其他裝置更新，請同步後再刪除');tx.set(delRef,{farmUid:uid,name:clean(farm.data().name,150),deletedBy:user.uid,deletedAt:F.serverTimestamp(),lastVersion:farm.data().version});tx.delete(farmRef);});
 clearCloudFormDirty();
 deletedFarmIds.add(uid);liveFarms.delete(uid);hook?.removeDeleted?.([uid]);hook?.notifyApproved?.(`已刪除「${record.name}」；地圖、清單與統計已更新。`);activeFarm=null;$('cloudEditForm').hidden=true;$('cloudPanel').hidden=true;$('cloudPanel').classList.remove('cloud-form-active');syncIndicator();return true;
 }catch(e){status('刪除未完成：'+err(e)+'。資料維持原狀。',true);return false;}finally{deleteBusy=false;renderUser();}
}
function syncIndicator(){if(!db)return;const count=liveFarms.size;
 if(!count&&farmsFromCache){status('Firebase 已載入，正在向伺服器確認豬場資料…');return;}
 const pending=pendingSummary();updatePendingUi();
 const waiting=pending.error?'待審讀取失敗':!pending.ready?'待審讀取中':`${pending.count} 筆待審核`;
 status(count?`${farmsFromCache?'離線快取／待確認連線':'Firestore 即時同步'} · ${count} 筆正式豬場 · ${waiting}`: '已連線至 Firebase，但資料庫尚無豬場；請先登入管理員並初始化315筆資料',!count||farmsFromCache);
}
async function submit(event,forceApprove=false){event.preventDefault();if(editBusy)return;if(!user||!db||!adminReady){status('請等待身分確認與 Firebase 連線完成再儲存',true);return;}
 const current=liveFarms.get(activeFarm);if(!current){status('雲端沒有這筆豬場，請管理員先初始化資料',true);return;}
 const lat=clean($('cloudLat').value,32),lng=clean($('cloudLng').value,32);
 if(Boolean(lat)!==Boolean(lng)){status('緯度與經度需要同時填寫或同時留空',true);return;}
 const la=lat?Number(lat):null,lo=lng?Number(lng):null;
 if(la!==null&&(!Number.isFinite(la)||la<21||la>27||!Number.isFinite(lo)||lo<118||lo>123)){status('座標超出台灣合理範圍，請檢查WGS84經緯度',true);return;}
 if(forceApprove){
  if(!admin){status('只有已驗證管理員可以直接核定。',true);return;}
  if(la===null||lo===null){status('直接核定前必須先在地圖選擇位置，並確認緯度、經度。',true);return;}
 }
 const proposedName=clean($('cloudName').value,150),proposedCounty=clean($('cloudCounty').value,40),proposedTown=clean($('cloudTown').value,40);
 if(!proposedName||!proposedCounty||!proposedTown){status('豬場名稱、縣市及鄉鎮不能留空',true);return;}
 if(forceApprove){
  const address=clean($('cloudAddress').value,220);
  if(!address&&!root.confirm('目前尚未填寫地址或地號。你仍可核定已確認的豬場位置，但地址將保留待補。確定繼續？'))return;
  if(!root.confirm(`確定直接核定「${proposedName}」嗎？\n將更新原有豬場（不新增 ID），並儲存目前座標與「確認豬場」判定。`))return;
 }
 const payload={farmUid:activeFarm,baseVersion:current.version,parcelKey:clean(auditContext?.parcelKey||current.auditParcelKey,160),decision:clean(auditContext?.decision||current.auditDecision||'pig',12),proposedName,proposedCounty,proposedTown,proposedAddress:clean($('cloudAddress').value,220),proposedLat:la,proposedLng:lo,note:clean($('cloudNote').value,500),submittedBy:user.uid,submittedAt:F.serverTimestamp(),status:'pending',reviewedBy:null,reviewedAt:null};
 const btn=$('cloudSubmit');editBusy=true;btn.disabled=true;status('正在提交至 Google Firestore…');
 try{if(admin){
  // V3.3.54: a map judgment on an EXISTING farm must commit the point,
  // the human decision and the parcel link to the SAME document/UID.
  // Do not rely on an earlier locally cached review to mark it approved.
  const context=auditContext;
  const decision=forceApprove?'pig':(context&&['pig','maybe'].includes(context.decision)?context.decision:null);
  const parcelKey=clean(context?.parcelKey||current.auditParcelKey||'',160);
  let updated;
  await F.runTransaction(db,async tx=>{
   const ref=F.doc(db,'farms',activeFarm),snap=await tx.get(ref);
   if(!snap.exists())throw Error('找不到正式豬場');
   const x=snap.data();
   updated={...x,uid:activeFarm,name:proposedName,county:proposedCounty,town:proposedTown,
    address:payload.proposedAddress,lat:la,lng:lo,version:Number(x.version||1)+1};
   const changes={name:updated.name,county:updated.county,town:updated.town,
    address:updated.address,lat:updated.lat,lng:updated.lng,version:updated.version,
    updatedAt:F.serverTimestamp()};
   if(decision){changes.auditDecision=decision;changes.auditParcelKey=parcelKey;
    updated.auditDecision=decision;updated.auditParcelKey=parcelKey;}
   tx.update(ref,changes);
  });
  // Immediately update the existing row (no appended farm record).
  // Firestore transaction has committed. Reset the local edit warning even
  // when the separate optional local-audit snapshot subsequently fails.
  clearCloudFormDirty();
  liveFarms.set(activeFarm,updated);hook?.applyApproved?.(publicRows());renderExistingApprovalStatus();
  const ctx=auditContext;
  let localAuditOk=true;
  if(ctx?.onSaved){localAuditOk=(await ctx.onSaved({uid:activeFarm,status:'approved',decision:decision||updated.auditDecision||'pig',parcelKey}))!==false;}
  auditContext=null;
  status(localAuditOk?(decision?'已核定原豬場：雲端已儲存原 ID、位置與判定；清單及統計正在同步。':'已儲存原豬場資料；若要改成已核定，請按「✓ 管理員直接核定此豬場」。'):'雲端原豬場已核定，但本機查核記錄尚未保存成功，請先備份並重新同步。',!localAuditOk);
  updateLinkage(parcelKey);
  if(localAuditOk){$('cloudEditForm').hidden=true;$('cloudPanel').classList.remove('cloud-form-active');
   hook?.notifyApproved?.((decision?'已核定':'已更新')+'原豬場「'+proposedName+'」；不會新增第二筆。');
   hook?.focusApproved?.(activeFarm);unifiedFlow=null;}
 }else{await F.addDoc(F.collection(db,'suggestions'),payload);
  clearCloudFormDirty();
  status('豬場資料已提交審查，核准後才更改正式地圖。');
  $('cloudEditForm').hidden=true;auditContext=null;unifiedFlow=null;
 }}
 catch(e){status('提交失敗：'+err(e)+'；請不要當成已成功同步。',true);}finally{editBusy=false;renderUser();}
}
async function review(id,approve,kind='edit'){if(kind==='new')return reviewNew(id,approve);if(!admin||!adminReady||!user||!db)return;const p=mergeProposalRows().find(x=>x.id===id&&x.kind==='edit');if(!p||p.status!=='pending')return;
 if(!confirm(`確定${approve?'採納':'退回'}「${p.proposedName}」的修改嗎？`))return;
 status('正在執行雲端交易與版本檢查…');
 try{await F.runTransaction(db,async tx=>{
   const sRef=F.doc(db,'suggestions',id),fRef=F.doc(db,'farms',p.farmUid);
   const sSnap=await tx.get(sRef),fSnap=await tx.get(fRef);
   if(!sSnap.exists()||!fSnap.exists())throw Error('待審紀錄或正式場址不存在');
   const s=sSnap.data(),farm=fSnap.data();if(s.status!=='pending')throw Error('這筆修改已被處理，請重新確認');
   if(approve&&farm.version!==s.baseVersion)throw Error('場址已有其他核准版本，不能覆蓋新資料；請重新提交建議');
   if(approve){const update={name:s.proposedName,county:s.proposedCounty,town:s.proposedTown,address:s.proposedAddress,lat:s.proposedLat,lng:s.proposedLng,version:farm.version+1,approvedSuggestionId:id,updatedAt:F.serverTimestamp()};
    if(['pig','maybe'].includes(s.decision)){update.auditParcelKey=clean(s.parcelKey||farm.auditParcelKey||'',160);update.auditDecision=s.decision;}
    tx.update(fRef,update);
   }
   tx.update(sRef,{status:approve?'approved':'rejected',reviewedBy:user.uid,reviewedAt:F.serverTimestamp()});
 });status(approve?'已採納：正式地址與地圖將透過即時監聽更新':'已標記不採納');}
 catch(e){status('審核失敗：'+err(e),true);}
}
async function reviewNew(id,approve){
 if(!admin||!adminReady||!db||!user)return;
 const p=mergeProposalRows().find(x=>x.id===id&&x.kind==='new');if(!p||p.status!=='pending')return;
 if(!confirm(`確定${approve?'核准建立':'退回'}「${p.proposedName}」？`))return;
 try{await F.runTransaction(db,async tx=>{
  const ref=F.doc(db,'farmSubmissions',id),farmRef=F.doc(db,'farms','submitted-'+id);
  const snap=await tx.get(ref);if(!snap.exists()||snap.data().status!=='pending')throw Error('案件已處理或不存在');
  const d=snap.data();if(approve){const duplicate=await tx.get(farmRef);if(duplicate.exists())throw Error('正式紀錄已存在');
   tx.set(farmRef,{uid:'submitted-'+id,name:d.proposedName,county:d.proposedCounty,town:d.proposedTown,address:d.proposedAddress,lat:d.proposedLat,lng:d.proposedLng,version:1,approvedSuggestionId:null,updatedAt:F.serverTimestamp(),auditDecision:d.decision,auditParcelKey:d.parcelKey||''});}
  tx.update(ref,{status:approve?'approved':'rejected',reviewedBy:user.uid,reviewedAt:F.serverTimestamp()});
 });status(approve?'已核准：送出者填寫的名稱、地址與座標已建立正式豬場。':'已退回申請。');}
 catch(e){status('審核失敗：'+err(e),true);}
}
// The integrated workflow keeps a single dialog from parcel selection through saving.
// Only the acknowledged cloud commit promotes an audit to a formal farm.
function beginUnified(lat,lng,parcelKey='',onSaved=null,initialDecision=''){
 if(!Number.isFinite(Number(lat))||!Number.isFinite(Number(lng)))return false;
 unifiedFlow={lat:Number(lat),lng:Number(lng),parcelKey:clean(parcelKey,160),onSaved,initialDecision};
 auditContext=null;open();setCloudView('manage');
 $('cloudPanel').classList.add('cloud-form-active');
 $('cloudNewForm').hidden=true;$('cloudEditForm').hidden=true;
 $('cloudUnifiedWizard').hidden=false;
 $('cloudWizardNote').value='';
 $('cloudWizardParcel').textContent=(parcelKey?'地塊：'+parcelKey+' · ':'人工地圖點 · ')+Number(lat).toFixed(6)+', '+Number(lng).toFixed(6);
 $('cloudWizardStatus').textContent=initialDecision?'已選擇地塊，請確認判定類別，然後進入資料表單。':'請先選擇判定類別。';
 $('cloudWizardBack').hidden=true;$('cloudEditWizardBack').hidden=true;
 $('cloudEditWizardProgress').hidden=true;
 status('步驟 2／4：先判定土地用途，再一次完成資料填寫及核定／送審。');
 return true;
}
function unifiedBack(){
 if(!unifiedFlow)return;
 $('cloudNewForm').hidden=true;$('cloudEditForm').hidden=true;
 $('cloudUnifiedWizard').hidden=false;
 $('cloudPanel').classList.add('cloud-form-active');
 auditContext=null;status('已返回判定步驟，尚未送出或更動正式豬場。');
}
async function unifiedDecision(decision){
 const flow=unifiedFlow;if(!flow)return;
 if(!['pig','maybe','other','defer'].includes(decision))return;
 const note=clean($('cloudWizardNote').value,500);
 if(decision==='other'||decision==='defer'){
  // No formal farm is created for a negative or deferred judgment.
  try{const outcome=await flow.onSaved?.({decision,status:'local-only',note});
   if(outcome===false)throw Error('本機紀錄尚未安全保存');
   unifiedFlow=null;close();status('地塊判定已保存為本機查核；沒有新增正式豬場。');
  }catch(e){$('cloudWizardStatus').textContent='儲存失敗：'+err(e)+'；資料尚未建立，請重試。';}
  return;
 }
 if(!user||!db||!adminReady){$('cloudWizardStatus').textContent='請先 Google 登入，並等待身分驗證完成。未登入不能正式送審。';status('請先登入 Google 後再繼續',true);return;}
 $('cloudUnifiedWizard').hidden=true;
 const ok=beginAudit(flow.lat,flow.lng,decision,'',note,flow.onSaved,flow.parcelKey);
 if(!ok){$('cloudUnifiedWizard').hidden=false;return;}
 $('cloudWizardBack').hidden=$('cloudNewForm').hidden;
 $('cloudEditWizardBack').hidden=$('cloudEditForm').hidden;
 $('cloudEditWizardProgress').hidden=$('cloudEditForm').hidden;
 $('cloudNewDecision').value=decision;
 status(admin?'步驟 3／4：填寫／連結舊場，確認後管理員直接核定。':'步驟 3／4：填寫／連結舊場，確認後送交管理員審核。');
}
function beginAudit(lat,lng,decision,linkedUid,note,onSaved,parcelKey=''){
 auditContext=null;
 if(!user||!db||!adminReady){open();status('請先 Google 登入並等待權限確認，才能填寫豬場資料。',true);return false;}
 auditContext={decision,note,onSaved,parcelKey:clean(parcelKey,160)};
 if(linkedUid&&liveFarms.has(linkedUid)){edit(linkedUid);$('cloudLat').value=lat.toFixed(8);$('cloudLng').value=lng.toFixed(8);$('cloudNote').value=note||'';
  status(admin?'請核對既有豬場資料，直接儲存後套用查核結果。':'請填寫豬場資料並送審；管理員核准後才更新正式資料。');return true;}
 beginNew(lat,lng);status(admin?'請填寫名稱與地址；管理員儲存後直接生效。':'請填寫名稱與地址；送審後須經管理員核准才會正式生效。');return true;
}
function subscribeNewSubmissions(){if(unsubNewSubmissions){unsubNewSubmissions();unsubNewSubmissions=null;}newSubmissions=[];renderProposals();sharedAudits=[];renderSharedAudits();if(!user)return;
 const q=admin?F.query(F.collection(db,'farmSubmissions'),F.orderBy('submittedAt','desc'),F.limit(50)):F.query(F.collection(db,'farmSubmissions'),F.where('submittedBy','==',user.uid),F.limit(50));
 unsubNewSubmissions=F.onSnapshot(q,s=>{newSubmissions=s.docs.map(d=>({...d.data(),id:d.id}));renderProposals();updateLinkage();syncIndicator();},e=>status('新增豬場審核清單讀取失敗：'+err(e),true));
}
async function signIn(){if(!auth||!A){status('Firebase 尚未正確設定或套件尚未載入',true);return;}
 const btn=$('cloudSignIn');if(btn)btn.disabled=true;status('正在開啟 Google 登入視窗…');
 try{await A.signInWithPopup(auth,new A.GoogleAuthProvider());status('Google 帳號登入成功，正在同步資料…');}
 catch(e){status('登入未完成：'+err(e)+'。iPhone/iPad若使用主畫面PWA不支援彈窗，請先用 Safari 網頁登入。',true);}finally{if(btn)btn.disabled=false;}
}
async function signOut(){if(!auth)return;try{await A.signOut(auth);status('已登出 Google；仍可查看公開的正式豬場。');}catch(e){status(err(e),true);}}
async function checkAdmin(u){if(!u||!db)throw Error('資料庫尚未連線');const result=await F.getDoc(F.doc(db,'admins',u.uid));return result.exists()&&result.data()?.role==='admin';}
function maybeShowAdminSetup(){
 if(!admin||!db||liveFarms.size!==0||farmsFromCache)return;
 let shown=false;try{shown=sessionStorage.getItem('pig3319-admin-setup-shown')==='1';}catch(_e){}
 if(shown)return;
 try{sessionStorage.setItem('pig3319-admin-setup-shown','1');}catch(_e){}
 open();status('已確認雲端沒有豬場，請按「初始化／補齊315筆初始豬場」。');
}
function subscribeFarms(){if(unsubFarms)unsubFarms();unsubFarms=F.onSnapshot(F.collection(db,'farms'),snapshot=>{
 const next=new Map();snapshot.forEach(d=>next.set(d.id,{...d.data(),uid:d.id}));liveFarms=next;updateLinkage();
 farmsFromCache=!!snapshot.metadata.fromCache;
 hook?.applyApproved(publicRows());if(deletedFarmIds.size)hook?.removeDeleted?.([...deletedFarmIds]);renderUser();syncIndicator();maybeShowAdminSetup();
 },e=>status('Firestore 正式豬場即時監聽失敗：'+err(e),true));}
function subscribeSuggestions(){if(unsubProposals){unsubProposals();unsubProposals=null;}
 proposals=[];renderProposals();if(!user)return;
 const q=admin?F.query(F.collection(db,'suggestions'),F.orderBy('submittedAt','desc'),F.limit(50)):F.query(F.collection(db,'suggestions'),F.where('submittedBy','==',user.uid),F.limit(50));
 unsubProposals=F.onSnapshot(q,snapshot=>{proposals=snapshot.docs.map(d=>({...d.data(),id:d.id}));renderProposals();syncIndicator();},e=>status('修改建議即時監聽失敗：'+err(e),true));
}
async function onUserChanged(u){const seq=++loggedInSeq;stopPendingSubscriptions();user=u;admin=false;adminReady=false;renderUser();updatePendingUi();subscribeSuggestions();subscribeNewSubmissions();if(!u){sharedAudits=[];renderSharedAudits();syncIndicator();return;}
 let value;try{value=await checkAdmin(u);}catch(e){if(seq===loggedInSeq){status('無法確認帳號權限，已暫停新增及送審：'+err(e),true);}return;}if(seq!==loggedInSeq)return;admin=value;adminReady=true;renderUser();subscribePendingCases();syncMessage('身分已確認，正在讀取雲端查核…');subscribeSuggestions();subscribeNewSubmissions();syncIndicator();
 maybeShowAdminSetup();readSharedAudits();}

async function refresh(){if(!db){status('Firebase 尚未連線',true);return;}
 try{const snapshot=await F.getDocsFromServer(F.collection(db,'farms'));const next=new Map();snapshot.forEach(d=>next.set(d.id,{...d.data(),uid:d.id}));liveFarms=next;farmsFromCache=false;hook?.applyApproved(publicRows());if(deletedFarmIds.size)hook?.removeDeleted?.([...deletedFarmIds]);syncIndicator();}
 catch(e){status('無法從雲端取得最新資料：'+err(e)+'。目前看到的可能是舊資料。',true);}
}
async function seed(){if(!admin||!user||!db||seedBusy)return;
 const original=hook?.getSeedRecords?.()||[];
 if(original.length!==315){status('原始315筆資料校驗失敗，不允許建立雲端名冊',true);return;}
 const missing=original.filter(r=>r.uid&&!liveFarms.has(r.uid)&&!deletedFarmIds.has(r.uid));
 if(!missing.length){status('雲端315筆初始名冊已存在；不會用舊檔覆蓋已核准更新。');return;}
 if(!confirm(`即將把 ${missing.length} 筆缺少的原始豬場新增至 Firebase。既有場址不會覆寫，是否確定？`))return;
 seedBusy=true;renderUser();
 let completed=0;
 try{for(let i=0;i<missing.length;i+=8){const batch=F.writeBatch(db);
  for(const r of missing.slice(i,i+8)){
   const coords=r.geometry?.type==='Point'?r.geometry.coordinates:null;
   batch.set(F.doc(db,'farms',r.uid),{uid:r.uid,name:clean(r.name,150)||'未命名豬場',county:clean(r.county,40)||'雲林縣',town:clean(r.town,40)||'待確認',address:clean(r.address,220),lat:coords?coords[1]:null,lng:coords?coords[0]:null,version:1,approvedSuggestionId:null,updatedAt:F.serverTimestamp()});
  }
  await batch.commit();completed+=Math.min(8,missing.length-i);status(`正在建立雲端名冊：完成 ${completed}/${missing.length} 筆`);
 }
 status(`已新增 ${completed} 筆初始場址；正式資料將自動同步。`);await refresh();
 }catch(e){status(`初始化中斷：已完成 ${completed} 筆。${err(e)}。可再次按「補齊」，不會覆寫既有資料。`,true);}finally{seedBusy=false;renderUser();}
}
async function start(options){if(started)return;started=true;hook=options;
 $('cloudPendingShortcut')?.addEventListener('click',()=>{open();setCloudView('review');});
 $('cloudOpen')?.addEventListener('click',open);$('cloudClose')?.addEventListener('click',()=>{if(!canLeaveCloudForm())return;close();});
 bindCloudTabs();
 $('cloudLoginQuick')?.addEventListener('click',()=>{if(user)open();else if(auth)signIn();else open();});
 $('mobileAuthToggle')?.addEventListener('click',()=>{if(user)open();else if(auth)signIn();else open();});
 $('cloudSignIn')?.addEventListener('click',signIn);$('cloudSignOut')?.addEventListener('click',signOut);
 $('cloudRefresh')?.addEventListener('click',refresh);$('cloudSeed')?.addEventListener('click',seed);
 $('cloudEditForm')?.addEventListener('submit',submit);
 $('cloudApproveExisting')?.addEventListener('click',event=>submit(event,true));
 $('cloudUnifiedWizard')?.addEventListener('click',e=>{const button=e.target.closest('[data-wizard-decision]');if(button)unifiedDecision(button.dataset.wizardDecision);});
 $('cloudWizardCancel')?.addEventListener('click',close);$('cloudWizardBack')?.addEventListener('click',unifiedBack);$('cloudEditWizardBack')?.addEventListener('click',unifiedBack);
 $('cloudNewOpen')?.addEventListener('click',()=>beginNew());
 $('cloudLinkSearch')?.addEventListener('input',renderLinkMatches);$('cloudLinkResults')?.addEventListener('click',e=>{const b=e.target.closest('[data-link-existing]');if(b)linkExistingFromPoint(b.dataset.linkExisting);});$('cloudPickExisting')?.addEventListener('click',()=>{if(!activeFarm)return;const uid=activeFarm;close();hook?.pickExistingOnMap?.(uid);});
 $('cloudManageNew')?.addEventListener('click',()=>{setCloudView('manage');beginNew();});
 $('cloudManageExisting')?.addEventListener('click',()=>{if(!user||!adminReady){status('請先完成 Google 登入及身分驗證，才能編輯正式場址。',true);return;}setCloudView('manage');auditContext=null;$('cloudNewForm').hidden=false;$('cloudEditForm').hidden=true;$('cloudPanel').classList.add('cloud-form-active');$('cloudNewLat').value='';$('cloudNewLng').value='';$('cloudLinkSearch').focus();renderLinkMatches();status('搜尋現有豬場後選取，將沿用原紀錄 ID，不會新增第二筆。');});
 $('cloudManagePending')?.addEventListener('click',()=>{setCloudView('review');status(user?'已切換至待審核定。沒有紀錄時代表目前帳號沒有可查看的案件。':'請先 Google 登入，才能查看待審案件。',!user);});
 $('cloudSyncRefresh')?.addEventListener('click',()=>{setCloudView('sync');syncMessage('正在讀取雲端查核…');readSharedAudits();});
 $('cloudSyncUpload')?.addEventListener('click',()=>{setCloudView('sync');uploadLocalAudits();});
 $('cloudSyncImport')?.addEventListener('click',()=>{setCloudView('sync');importSharedAudits();});
 $('cloudAuditSearch')?.addEventListener('input',()=>{cloudAuditPageSize=100;renderSharedAudits();});
 $('cloudAuditFilter')?.addEventListener('change',()=>{cloudAuditPageSize=100;renderSharedAudits();});
 $('cloudAuditClear')?.addEventListener('click',()=>{if($('cloudAuditSearch'))$('cloudAuditSearch').value='';if($('cloudAuditFilter'))$('cloudAuditFilter').value='all';cloudAuditPageSize=100;renderSharedAudits();$('cloudAuditSearch')?.focus();});
 $('cloudAuditMore')?.addEventListener('click',()=>{cloudAuditPageSize+=100;renderSharedAudits();});
 $('cloudSyncList')?.addEventListener('click',e=>{
  const del=e.target.closest('[data-cloud-audit-delete]');if(del){deleteSharedAudit(del.dataset.cloudAuditDelete);return;}
  const map=e.target.closest('[data-cloud-audit-map]');if(map){viewSharedAuditOnMap(map.dataset.cloudAuditMap);return;}
  const detail=e.target.closest('[data-cloud-audit-detail]');if(detail)toggleSharedAuditDetails(detail.dataset.cloudAuditDetail,detail);
 });
 for(const id of ['cloudNewForm','cloudEditForm']){const form=$(id);form?.addEventListener('input',()=>{cloudFormDirty=true;});form?.addEventListener('change',()=>{cloudFormDirty=true;});}
 $('cloudNewForm')?.addEventListener('submit',createFarm);$('cloudDelete')?.addEventListener('click',()=>deleteActiveFarm());
 $('cloudNewCancel')?.addEventListener('click',()=>{if(!canLeaveCloudForm())return;clearCloudFormDirty();$('cloudNewForm').hidden=true;$('cloudPanel').classList.remove('cloud-form-active');newPoint=null;auditContext=null;unifiedFlow=null;});
 $('cloudProposals')?.addEventListener('click',e=>{const target=e.target.closest('[data-approve],[data-reject]');if(target)review(target.dataset.approve||target.dataset.reject,!!target.dataset.approve,target.dataset.kind||'edit');});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('cloudPanel').hidden){if(!canLeaveCloudForm())return;close();}});
 const seedButton=$('cloudSeed');if(seedButton){const details=document.createElement('details');details.className='cloud-advanced';details.innerHTML='<summary>進階管理：初始化名冊（一般操作不需要）</summary><p>僅限雲端資料庫確實缺少初始名冊時使用，切勿反覆初始化。</p>';seedButton.parentNode?.append(details);details.append(seedButton);}
 if(!configured){status('尚未設定 Google Firebase：此版本目前仍是本機模式，沒有多人同步',true);renderUser();return;}
 if(location.protocol==='file:'){status('請透過 HTTPS GitHub Pages 開啟網站，才能使用 Firebase；直接開啟本機 HTML 無法驗收登入。',true);return;}
 status('載入 Google Firebase 並建立 Firestore 連線…');
 try{
 const sdk='https://www.gstatic.com/firebasejs/12.19.0/';
 const [app,authLib,firestore]=await Promise.all([import(sdk+'firebase-app.js'),import(sdk+'firebase-auth.js'),import(sdk+'firebase-firestore.js')]);
 A=authLib;F=firestore;
 const application=app.initializeApp(conf,'pig-farm-map');auth=A.getAuth(application);db=F.getFirestore(application);
 subscribeDeleted();subscribeFarms();A.onAuthStateChanged(auth,u=>{onUserChanged(u).catch(e=>status(err(e),true));},e=>status('Firebase Authentication 發生問題：'+err(e),true));
 }catch(e){status('Firebase 啟動失敗：'+err(e)+'。沒有啟用共用同步。',true);}
}
root.PigCommunity={get enabled(){return enabled();},get connected(){return !!db;},publishAudit,start,open,edit,beginNew,beginAudit,beginUnified,editAt,pull:refresh,
 deletionInfo(uid){return {isCloud:liveFarms.has(uid),canDelete:!!(user&&admin&&adminReady&&db&&liveFarms.has(uid))};},
 deleteFarm(uid){return deleteActiveFarm(uid);}};
})(window);
