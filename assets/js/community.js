/* 豬場查核 V3.4.14｜申請人狀態讀回與跨裝置標記收斂。 */
(function (root) {'use strict';
const $=id=>document.getElementById(id);
const clean=(value,n)=>String(value??'').trim().slice(0,n);
const esc=value=>String(value??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const conf=root.PIG_FIREBASE_CONFIG||{};
const configured=!!(conf.apiKey&&conf.projectId&&conf.appId&&conf.authDomain&&!String(conf.apiKey).includes('請填'));
let auth=null,db=null,A=null,F=null,user=null,admin=false,adminReady=false,hook=null,started=false;
let liveFarms=new Map(),proposals=[],activeFarm=null,editBaseVersion=null,unsubFarms=null,unsubProposals=null,loggedInSeq=0;
let farmsFromCache=true,seedBusy=false,newPoint=null,newBusy=false,auditContext=null,unsubNewSubmissions=null,newSubmissions=[];
let deletedFarmIds=new Set(),unsubDeleted=null,deleteBusy=false,editBusy=false;
let unifiedFlow=null;
let sharedAudits=[],syncBusy=false;
// Administrator-only adjudication metadata, kept separate from immutable applicant fields.
let submissionResolutions=new Map(), reestablishmentReviews=new Map(), resolutionsLoadError="",resolutionHistoryLoaded=false,resolutionHistoryLimit=100,resolutionHistoryReadGeneration=0;
let lineageDetails=new Map(),lineageDetailGeneration=0,lineageHistoryLimit=100,lineageLoadError="";
// Admin-only one-shot server audit. No automatic writes/backfills.
let legacyLockAudit=null,legacyLockAuditError='',legacyLockAuditBusy=false,legacyLockAuditGeneration=0,legacyLockAuditLimit=100,legacyEligibilityLimit=100;
let legacyLockReviews=new Map(),legacyReviewBusy=false,legacyLockEligibility=null,legacyEvidenceReview=null,legacyEvidenceLimit=100,legacyWorklistLimit=100;
let legacyWorklistEditContext=null;
let legacyCloudEvidence=null,legacyCloudEvidenceBusy=false,legacyCloudEvidenceError="",legacyEvidenceCloudGeneration=0;
// A Firestore unsubscribe cannot retract callbacks already queued in the JS event loop.
// Generations prevent old callbacks (and old HTTP reads) from mutating a new session.
let suggestionsGeneration=0,submissionsGeneration=0,pendingGeneration=0,auditsReadGeneration=0;
let pendingRevision=0,farmsRevision=0,deletedRevision=0,refreshGeneration=0;
let ownerSubmissionCache={new:true,edit:true},ownerSubmissionError={new:false,edit:false};
let reviewSync={state:'idle',message:'完成審核後會檢查正式名冊、待審清單和地圖統計。',at:null};
let reviewCommitGeneration=0;
const sameSession=(seq,uid)=>seq===loggedInSeq && (user?.uid||null)===uid;
// V3.3.67: observable, honest acknowledgements: write success != read-back verified.
let syncEvidence={state:'idle',operation:'尚無本次操作',message:'等待正式豬場資料',writtenAt:null,serverAt:null,verifiedAt:null,code:''};
function syncClock(date){return date?new Date(date).toLocaleString('zh-TW',{hour12:false}):'尚未確認';}
function renderSyncEvidence(){
 const line=$('cloudSyncEvidenceLine'),box=$('cloudSyncEvidenceDetails');
 if(!line)return;
 const labels={idle:'待確認',writing:'寫入中',committed:'寫入已確認，待讀回',verified:'寫入與伺服器讀回皆確認',refreshed:'正式清單與刪除紀錄已重新讀取',uiError:'伺服器讀回成功，畫面更新異常',error:'操作失敗',readError:'讀回未確認'};
 const label=labels[syncEvidence.state]||'狀態未知';
 line.textContent=label+'｜'+syncEvidence.operation+'｜'+syncEvidence.message;
 line.dataset.state=syncEvidence.state;
 if(box)box.textContent='最後收到正式豬場伺服器資料：'+syncClock(syncEvidence.serverAt)+'\n最近寫入完成：'+syncClock(syncEvidence.writtenAt)+'\n最近伺服器讀回驗證：'+syncClock(syncEvidence.verifiedAt)+(syncEvidence.code?'\n錯誤碼：'+syncEvidence.code:'')+'\n注意：只能確認此裝置與 Firestore 的結果，不能證明其他裝置已顯示。';
}
function syncEvidenceSet(state,operation,message,code=''){
 syncEvidence={...syncEvidence,state,operation,message,code};
 if(state==='writing'){syncEvidence.verifiedAt=null;}
 if(state==='committed')syncEvidence.writtenAt=Date.now();
 if(state==='verified')syncEvidence.verifiedAt=Date.now();
 renderSyncEvidence();
}
async function checkCommittedDocument(collection,id,field,expected,label){
 syncEvidenceSet('committed',label,'Firestore 已接受寫入，正在向伺服器讀回確認');
 try{
  const snapshot=await F.getDocFromServer(F.doc(db,collection,id));
  const actual=snapshot.exists()?snapshot.data()?.[field]:undefined;
  if(expected===null ? !snapshot.exists() : snapshot.exists()&&(typeof expected==='object' ? Object.entries(expected).every(([k,v])=>snapshot.data()?.[k]===v) : actual===expected)){
   syncEvidenceSet('verified',label,'伺服器讀回符合預期');return true;
  }
  syncEvidenceSet('readError',label,'寫入已完成，但讀回內容不符；請進行同步檢查');return false;
 }catch(error){
  syncEvidenceSet('readError',label,'寫入已完成，但伺服器讀回失敗；請勿直接重複新增',String(error?.code||'read-failed'));return false;
 }
}
// V3.3.76: confirm every document participating in a multi-document operation.
// A committed transaction is successful even when the subsequent readback fails;
// readback failures are reported separately and never treated as commit failures.
async function checkCommittedDocuments(label, checks){
 syncEvidenceSet('committed',label,'Firestore 已接受交易，正在逐筆向伺服器核對');
 try{
  for(const item of checks){
   const snap=await F.getDocFromServer(F.doc(db,item.collection,item.id));
   const expected=item.expected;
   const matches=expected===null?!snap.exists():snap.exists()&&Object.entries(expected).every(([key,value])=>snap.data()?.[key]===value);
   if(!matches){
    syncEvidenceSet('readError',label,`寫入完成，但 ${item.collection}/${item.id} 讀回不符；請勿重複提交`);
    return false;
   }
  }
  syncEvidenceSet('verified',label,`伺服器已核對 ${checks.length} 筆關聯文件`);
  return true;
 }catch(error){
  syncEvidenceSet('readError',label,'寫入完成，但關聯文件讀回失敗；請勿重複提交',String(error?.code||'read-failed'));
  return false;
 }
}
async function verifyLatestFarms(){
 const session=loggedInSeq,uid=user?.uid||null;
 if(!db){syncEvidenceSet('error','重新讀取','Firebase 尚未連線');return;}
 syncEvidenceSet('writing','重新讀取','正在從伺服器讀取正式豬場清單');
 try{const ok=await refresh();if(!sameSession(session,uid))return;
  if(!ok){if(syncEvidence.state==='writing')syncEvidenceSet('readError','重新讀取','資料讀取期間已收到更新，未覆蓋較新的地圖內容；請再次驗證');return;}
  if(ok){
  const pending=admin?await reconcilePendingFromServer():await reconcileOwnerCasesFromServer();if(admin)await loadSubmissionResolutions();if(!sameSession(session,uid))return;
  syncEvidence.serverAt=Date.now();
  if(!pending.ok){
   syncEvidenceSet('readError','重新讀取','正式豬場及刪除紀錄已讀回，但審核案件無法完整驗證；請確認權限');
   status('正式豬場已更新，但審核案件讀取未完成：'+(pending.error||'登入狀態已變更'),true);
  }else{
   syncEvidenceSet('refreshed','重新讀取',admin?'正式豬場、刪除紀錄及全部待審案件已從伺服器讀回':'正式豬場、刪除紀錄及我的最近申請已從伺服器讀回');
  }
 }}
 catch(e){if(sameSession(session,uid))syncEvidenceSet('error','重新讀取',String(e?.message||e),String(e?.code||''));}
}

// V3.4.12: review writes and UI synchronization are separate outcomes.
// The transaction may already be committed even if a later server read fails.
function renderReviewSync(){
 const box=$('cloudReviewSyncState'),retry=$('cloudReviewSyncRetry');
 if(box){box.textContent=reviewSync.message;box.dataset.state=reviewSync.state;}
 if(retry)retry.hidden=!admin||!user||!db||!['partial','error'].includes(reviewSync.state);
}
function reviewSyncSet(state,message){reviewSync={state,message,at:Date.now()};renderReviewSync();}
async function reconcileReviewAfterCommit({kind,id,approved,farmUid,verified}){
 const session=loggedInSeq,uid=user?.uid||null;
 const request=++reviewCommitGeneration;
 reviewSyncSet('checking','交易已提交；正在從伺服器核對正式豬場、待審案件、左右地圖和統計…');
 let farmOk=false,pendingOk=false,serverFarmMatches=false;
 // A listener can legitimately advance the revision during a server fetch;
 // retry once rather than treating the listener update as a failed commit.
 for(let attempt=0;attempt<2;attempt++){
  if(!sameSession(session,uid)||request!==reviewCommitGeneration)return {ok:false,stale:true};
  try{farmOk=await refresh();}catch(error){farmOk=false;}
  if(farmOk)break;
 }
 if(!sameSession(session,uid)||request!==reviewCommitGeneration)return {ok:false,stale:true};
 let pending={ok:false};
 try{pending=await reconcilePendingFromServer();}catch(error){pending={ok:false,error:String(error)};}
 pendingOk=!!(pending.ok&&!pending.superseded&&!pending.skipped);
 if(pending.ok&&pending.superseded){
  try{const retry=await reconcilePendingFromServer();pendingOk=!!(retry.ok&&!retry.superseded&&!retry.skipped);}catch(error){pendingOk=false;}
 }
 if(!sameSession(session,uid)||request!==reviewCommitGeneration)return {ok:false,stale:true};
 if(farmOk){
  // Rejection should not create a submitted farm; modification rejection must
  // not modify an existing farm. The transaction readback checks exact status.
  if(approved){
   const record=liveFarms.get(farmUid);
   serverFarmMatches=!!record&&(kind==='new'?record.uid==='submitted-'+id:record.approvedSuggestionId===id);
  }else serverFarmMatches=true;
 }
 const ok=!!(verified&&farmOk&&pendingOk&&serverFarmMatches);
 const parts=[verified?'案件／關聯文件讀回已確認':'案件讀回未確認',farmOk?(serverFarmMatches?'正式名冊已確認':'正式名冊未找到本次核准內容'):'正式名冊或地圖刷新未確認',pendingOk?'待審清單及件數已確認':'待審清單件數未確認'];
 reviewSyncSet(ok?'ok':'partial',(ok?'本次審核已完成同步核對：':'審核交易可能已提交，但同步尚未完整確認：')+parts.join('；')+'。'+(ok?'左右地圖及統計已透過正式名冊更新。':'請按「重新核對雲端資料」，不要再次按核准或不採納。'));
 return {ok,farmOk,pendingOk,serverFarmMatches};
}
// Independent pending-only listeners: history windows are capped at 50, but counts must not be.
let pendingNew=[],pendingEdits=[],unsubPendingNew=null,unsubPendingEdits=null;
let pendingLoad={new:false,edit:false},pendingError={new:'',edit:''};
// A cached onSnapshot result may be empty even while the server has pending items.
let pendingFromCache={new:true,edit:true};
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
 if(admin){const ready=pendingLoad.new&&pendingLoad.edit&&!pendingFromCache.new&&!pendingFromCache.edit;
  return {count:pendingNew.length+pendingEdits.length,ready,error:!!(pendingError.new||pendingError.edit)};
 }
 return {count:mergeProposalRows().filter(p=>p.status==='pending').length,ready:true,error:false};
}
function updatePendingUi(){
 const summary=pendingSummary();
 const badge=$('cloudPendingShortcut');
 if(badge){
  badge.hidden=!user;
  badge.textContent=summary.error?'待審數量無法確認':!summary.ready?'待審等待雲端確認…':`待審 ${summary.count} 筆`;
  badge.title=summary.error?'待審資料讀取失敗，請進入共同編輯查看錯誤':!summary.ready?'目前可能只有本機快取，尚未確認全部待審案件':'點此開啟待審核定';
 }
}
// Applicant-only explicit server read: the admin pending query is not an applicant's case history.
// Do not overwrite fresher listener updates after a session change.
async function reconcileOwnerCasesFromServer(){
 if(!db||!user||admin||!adminReady)return {ok:false,skipped:true};
 const session=loggedInSeq,uid=user.uid,newGeneration=submissionsGeneration,editGeneration=suggestionsGeneration;
 try{
  const [newSnap,editSnap]=await Promise.all([
   F.getDocsFromServer(F.query(F.collection(db,'farmSubmissions'),F.where('submittedBy','==',uid),F.limit(50))),
   F.getDocsFromServer(F.query(F.collection(db,'suggestions'),F.where('submittedBy','==',uid),F.limit(50)))
  ]);
  if(!sameSession(session,uid)||newGeneration!==submissionsGeneration||editGeneration!==suggestionsGeneration)return {ok:false,stale:true};
  newSubmissions=newSnap.docs.map(d=>({...d.data(),id:d.id}));
  proposals=editSnap.docs.map(d=>({...d.data(),id:d.id}));
  ownerSubmissionCache={new:false,edit:false};ownerSubmissionError={new:false,edit:false};
  renderProposals();syncIndicator();return {ok:true};
 }catch(error){
  if(!sameSession(session,uid))return {ok:false,stale:true};
  ownerSubmissionError={new:true,edit:true};renderProposals();return {ok:false,error:err(error)};
 }
}
// V3.3.78: independent server reconciliation for the two admin pending queues.
// Do not replace either queue with half of a server response, and never treat
// a failed query as zero pending cases. No writes are performed here.
async function reconcilePendingFromServer(){
 if(!admin||!adminReady||!db||!user)return {ok:true,skipped:true};
 const session=loggedInSeq,uid=user.uid,revision=pendingRevision;
 try{
  const [newSnap,editSnap]=await Promise.all([
   F.getDocsFromServer(F.query(F.collection(db,'farmSubmissions'),F.where('status','==','pending'))),
   F.getDocsFromServer(F.query(F.collection(db,'suggestions'),F.where('status','==','pending')))
  ]);
  if(session!==loggedInSeq||!admin||user?.uid!==uid)return {ok:false,stale:true};
  if(revision!==pendingRevision)return {ok:true,superseded:true,count:pendingNew.length+pendingEdits.length};
  pendingNew=newSnap.docs.map(d=>({...d.data(),id:d.id}));
  pendingEdits=editSnap.docs.map(d=>({...d.data(),id:d.id}));
  pendingLoad={new:true,edit:true};pendingFromCache={new:false,edit:false};pendingError={new:'',edit:''};
  renderProposals();updatePendingUi();syncIndicator();
  return {ok:true,count:pendingNew.length+pendingEdits.length};
 }catch(e){
  if(session!==loggedInSeq||user?.uid!==uid)return {ok:false,stale:true};
  // The listeners may still be live, but the manual server verification failed:
  // badge must not imply its count is freshly and completely verified.
  pendingError={new:err(e),edit:err(e)};
  pendingLoad={new:false,edit:false};
  renderProposals();updatePendingUi();
  return {ok:false,error:err(e)};
 }
}
function stopPendingSubscriptions(){
 pendingGeneration++;pendingRevision++;
 if(unsubPendingNew){unsubPendingNew();unsubPendingNew=null;}
 if(unsubPendingEdits){unsubPendingEdits();unsubPendingEdits=null;}
 pendingNew=[];pendingEdits=[];
 pendingLoad={new:false,edit:false};pendingFromCache={new:true,edit:true};pendingError={new:'',edit:''};
}
function subscribePendingCases(){
 stopPendingSubscriptions();
 if(!user||!admin||!db){updatePendingUi();return;}
 const generation=pendingGeneration,session=loggedInSeq,uid=user.uid;
 for(const config of [{kind:'new',collection:'farmSubmissions'},{kind:'edit',collection:'suggestions'}]){
  const q=F.query(F.collection(db,config.collection),F.where('status','==','pending'));
  const sub=F.onSnapshot(q,{includeMetadataChanges:true},snap=>{
   if(generation!==pendingGeneration||!sameSession(session,uid)||!admin)return;
   pendingRevision++;
   const rows=snap.docs.map(d=>({...d.data(),id:d.id}));
   if(config.kind==='new')pendingNew=rows;else pendingEdits=rows;
   pendingLoad[config.kind]=true;pendingFromCache[config.kind]=!!snap.metadata?.fromCache || !!snap.metadata?.hasPendingWrites;pendingError[config.kind]='';
   renderProposals();updatePendingUi();syncIndicator();
  },e=>{
   if(generation!==pendingGeneration||!sameSession(session,uid)||!admin)return;
   pendingRevision++;
   pendingLoad[config.kind]=false;pendingFromCache[config.kind]=true;pendingError[config.kind]=err(e);
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
// V3.4.07: single-admin shortcuts keep low-frequency audit tools collapsed.
function bindSingleAdminShortcuts(){
 const history=$('cloudJumpReviewHistory'), legacy=$('cloudJumpLegacyReview');
 const go=(id)=>{const advanced=$('cloudAdvancedTools'),target=$(id);if(!advanced||!target)return;
  setCloudView('review');advanced.open=true;target.open=true;
  target.scrollIntoView({block:'start',behavior:'smooth'});
  const focus=target.querySelector('summary');if(focus){focus.tabIndex=0;focus.focus({preventScroll:true});}
 };
 if(history&&!history.dataset.bound){history.dataset.bound='1';history.addEventListener('click',()=>go('cloudResolutionHistoryPanel'));}
 if(legacy&&!legacy.dataset.bound){legacy.dataset.bound='1';legacy.addEventListener('click',()=>go('cloudLegacyLockPanel'));}
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
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{bindCloudTabs();initCloudFormNavigation();bindSingleAdminShortcuts();});
else {bindCloudTabs();initCloudFormNavigation();bindSingleAdminShortcuts();}
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
 const request=++auditsReadGeneration,session=loggedInSeq,uid=user?.uid||null;
 if(!db||!user||!adminReady){syncMessage('請先登入 Google，確認身分後再讀取。',true);return false;}
 try{const q=admin?F.query(F.collection(db,'sharedAudits'),F.limit(500)):
   F.query(F.collection(db,'sharedAudits'),F.where('ownerUid','==',user.uid),F.limit(500));
  const snap=await F.getDocsFromServer(q);
  if(request!==auditsReadGeneration||!sameSession(session,uid))return false;
  sharedAudits=snap.docs.map(d=>({...d.data(),cloudDocId:d.id}));renderSharedAudits();
  syncMessage(`雲端查核已讀取 ${sharedAudits.length} 筆（最多顯示 500 筆）；匯入時不覆寫本機資料。`);return true;
 }catch(e){if(request===auditsReadGeneration&&sameSession(session,uid))syncMessage('讀取雲端查核失敗：'+err(e),true);return false;}
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
// Preview only: use the same candidate logic as the authoritative V3.3.90 approval
// guard, but show the result before the administrator clicks Approve.
// This is not a transaction or a full server scan. Never auto-merge records.
function proposalDuplicatePreview(p, pendingRows=mergeProposalRows(), farms=[...liveFarms.values()]){
 if(p.kind!=='new'||p.status!=='pending')return {farms:[],pending:[]};
 const formal=approvalDuplicateCandidates(p,farms.filter(f=>!deletedFarmIds.has(f.uid)));
 const peers=pendingRows.filter(q=>q.kind==='new'&&q.status==='pending'&&q.id!==p.id)
  .filter(q=>approvalDuplicateCandidates(p,[{
   uid:'pending:'+q.id,name:q.proposedName,county:q.proposedCounty,town:q.proposedTown,
   address:q.proposedAddress,lat:q.proposedLat,lng:q.proposedLng,auditParcelKey:q.parcelKey
  }]).length>0);
 return {farms:formal,pending:peers};
}
// Never treat a preview or a locally cached decision as authoritative for approval.
async function loadSubmissionResolutions(){
 const generation=++resolutionHistoryReadGeneration;
 if(!admin||!adminReady||!db){submissionResolutions=new Map();reestablishmentReviews=new Map();resolutionHistoryLoaded=false;renderResolutionHistory();renderLineageHistory();return;}
 const seq=loggedInSeq,uid=user?.uid;
 resolutionHistoryLoaded=false;resolutionsLoadError='';lineageLoadError='';renderResolutionHistory();renderLineageHistory();
 try{
  const snap=await F.getDocsFromServer(F.collection(db,'submissionResolutions'));
  if(generation!==resolutionHistoryReadGeneration||!sameSession(seq,uid)||!admin)return;
  submissionResolutions=new Map(snap.docs.map(d=>[d.id,d.data()]));
  try{const reviews=await F.getDocsFromServer(F.collection(db,'farmReestablishmentReviews'));if(generation===resolutionHistoryReadGeneration&&sameSession(seq,uid)){reestablishmentReviews=new Map(reviews.docs.map(d=>[d.id,d.data()]));lineageLoadError='';}}catch(e){if(generation===resolutionHistoryReadGeneration&&sameSession(seq,uid)){lineageLoadError=err(e);reestablishmentReviews=new Map();status('重新設立審核資料無法讀取：'+lineageLoadError,true);}}
  resolutionsLoadError='';resolutionHistoryLoaded=true;renderProposals();renderResolutionHistory();renderLineageHistory();
 }catch(e){if(generation===resolutionHistoryReadGeneration&&sameSession(seq,uid)&&admin){resolutionsLoadError=err(e);resolutionHistoryLoaded=false;status('人工判定紀錄尚未讀回：'+err(e),true);renderProposals();renderResolutionHistory();renderLineageHistory();}}
}
// Read-only history. The case list is intentionally bounded by existing listeners;
// a missing case in that list is NOT evidence that a Firestore document was deleted.
function resolutionHistoryStatus(record,caseMap){
 const p=caseMap.get(record.submissionId);
 if(!p)return {code:'unknown',text:'案件未在目前已載入清單中（尚無法核對）'};
 if(p.kind!=='new')return {code:'warning',text:'案件類型與新增豬場判定不一致'};
 if(record.mode==='link_existing')return p.status==='rejected'?{code:'ok',text:'一致：已有豬場、案件已結案'}:{code:'warning',text:'需核對：已有豬場判定，但案件狀態為 '+p.status};
 if(record.mode==='distinct')return ['pending','approved','rejected'].includes(p.status)?{code:'ok',text:p.status==='pending'?'一致：不同經營者、仍待審':p.status==='approved'?'不同經營者已核准（後續審核）':'不同經營者，後續已結案'}:{code:'warning',text:'需核對：案件狀態異常'};
 return {code:'warning',text:'未知人工判定類型'};
}
function renderResolutionHistory(){
 const host=$('cloudResolutionHistory'),summary=$('cloudResolutionSummary');if(!host)return;
 const controls=$('cloudResolutionControls');if(controls)controls.hidden=!admin;
 if(!admin||!user){host.innerHTML='';if(summary)summary.textContent='僅管理員可檢視人工判定歷史。';return;}
 if(!resolutionHistoryLoaded){host.innerHTML='';if(summary)summary.textContent=resolutionsLoadError?'判定紀錄讀取失敗：'+resolutionsLoadError:'正在從伺服器讀取判定紀錄…';return;}
 const cases=new Map(mergeProposalRows().filter(x=>x.kind==='new').map(x=>[x.id,x]));
 const query=clean($('cloudResolutionSearch')?.value||'',150).toLocaleLowerCase();
 const filter=$('cloudResolutionFilter')?.value||'all';
 const records=[...submissionResolutions.entries()].map(([id,r])=>({...r,submissionId:r.submissionId||id})).sort((a,b)=>{
  const sec=v=>v?.toMillis?v.toMillis():v?.seconds?Number(v.seconds)*1000:0;
  return sec(b.reviewedAt)-sec(a.reviewedAt)||String(b.submissionId).localeCompare(String(a.submissionId));
 });
 const filtered=records.filter(r=>{
  const p=cases.get(r.submissionId);
  const state=resolutionHistoryStatus(r,cases);
  if(filter==='link_existing'||filter==='distinct'){if(r.mode!==filter)return false;}
  else if(filter==='warning'&&state.code!=='warning')return false;
  else if(filter==='unknown'&&state.code!=='unknown')return false;
  const haystack=[r.submissionId,r.farmUid,r.reason,r.adminUid,p?.proposedName,p?.proposedAddress,liveFarms.get(r.farmUid)?.name].join(' ').toLocaleLowerCase();
  return !query||haystack.includes(query);
 });
 const visible=filtered.slice(0,resolutionHistoryLimit);
 if(summary)summary.textContent=`已從伺服器讀回 ${records.length} 筆判定｜符合條件 ${filtered.length} 筆；案件核對僅涵蓋目前已載入的清單。`;
 host.innerHTML=visible.length?visible.map(r=>{
  const p=cases.get(r.submissionId),farm=liveFarms.get(r.farmUid),state=resolutionHistoryStatus(r,cases);
  const mode=r.mode==='link_existing'?'已有豬場（結案）':r.mode==='distinct'?'不同經營者':'未知判定';
  const when=r.reviewedAt?.toDate?.()?.toLocaleString('zh-TW',{hour12:false})||'日期尚未取得';
  return `<article class="cloud-resolution-history-card" data-resolution-history-row="${esc(r.submissionId)}"><div><strong>${esc(p?.proposedName||r.submissionId)}</strong><small> ${esc(mode)} · ${esc(when)}</small></div><small>案件 ID：${esc(r.submissionId)} · 關聯豬場：${esc(farm?.name||r.farmUid||'—')}</small><p>${esc(r.reason||'—')}</p><small>審核 UID：${esc(r.adminUid||'—')} · 原關聯候選 ${Array.isArray(r.matchedUids)?r.matchedUids.length:0} 筆</small><div class="cloud-resolution-history-state" data-state="${esc(state.code)}">${esc(state.text)}</div><div class="cloud-resolution-history-actions">${farm?`<button type="button" data-resolution-history-farm="${esc(r.farmUid)}">查看正式豬場</button>`:'<small>關聯豬場未在目前已載入名冊中</small>'}${p?`<button type="button" data-resolution-history-case="${esc(r.submissionId)}">查看案件</button>`:''}</div></article>`;
 }).join(''):'<p class="subtle">沒有符合搜尋條件的人工判定紀錄。</p>';
 const more=$('cloudResolutionMore');if(more){more.hidden=filtered.length<=resolutionHistoryLimit;more.textContent=`顯示更多（尚有 ${Math.max(0,filtered.length-resolutionHistoryLimit)} 筆）`;}
}
// V3.3.95: compare complete server snapshots of formal farms, deletion tombstones
// and immutable approval locks. A legacy import without a lock is informational,
// not corruption. This scan makes ZERO Firestore writes.
function auditLegacyApprovalLocks(farms,tombs,locks){
 const findings=[];const counts={legacy:0,warning:0,ok:0,deletedLegacy:0};
 const byFarm=new Map();
 for(const [id,lock] of locks){const uid=String(lock.farmUid||'');if(!byFarm.has(uid))byFarm.set(uid,[]);byFarm.get(uid).push({id,...lock});}
 for(const [uid,farm] of farms){
  const matches=byFarm.get(uid)||[],ref=String(farm.approvalLockId||'');
  if(tombs.has(uid)){findings.push({type:'warning',uid,name:farm.name||uid,reason:'正式豬場與刪除紀錄同時存在，需人工核對',target:'farm'});counts.warning++;continue;}
  if(!ref && !uid.startsWith('submitted-')){findings.push({type:'legacy',uid,name:farm.name||uid,reason:'早期正式名冊：原本未建立核准占用，屬歷史資料待核對',target:'farm'});counts.legacy++;continue;}
  if(!ref){findings.push({type:'warning',uid,name:farm.name||uid,reason:'送審核准的正式豬場缺少 approvalLockId',target:'farm'});counts.warning++;continue;}
  const lock=locks.get(ref);
  if(!lock || lock.farmUid!==uid || (uid.startsWith('submitted-')&&lock.submissionId!==uid.slice('submitted-'.length))){
   findings.push({type:'warning',uid,name:farm.name||uid,reason:'正式豬場的核准占用引用缺失或關聯不一致：'+ref,target:'farm'});counts.warning++;continue;
  }
  if(matches.length>1){findings.push({type:'warning',uid,name:farm.name||uid,reason:'同一正式豬場有多筆占用紀錄，請核對沿革',target:'farm'});counts.warning++;continue;}
  counts.ok++;
 }
 for(const [uid,tomb] of tombs){
  if(farms.has(uid))continue; // already reported
  const matches=byFarm.get(uid)||[];
  if(!matches.length){findings.push({type:'deletedLegacy',uid,name:tomb.name||uid,reason:'已刪除歷史紀錄，沒有新版核准占用；舊場可能原本未建立占用',target:'deleted'});counts.deletedLegacy++;}
  else counts.ok++;
 }
 for(const [id,lock] of locks){
  const uid=String(lock.farmUid||'');
  if(!farms.has(uid)&&!tombs.has(uid)){
   findings.push({type:'warning',uid,name:uid||id,reason:'占用 '+id+' 指向的豬場，在正式名冊與刪除紀錄皆不存在',target:'lock'});counts.warning++;
  }else if(farms.has(uid)&&farms.get(uid).approvalLockId!==id){
   // An immutable historical lock may legitimately remain after replacement;
   // report for manual review, never erase it.
   findings.push({type:'warning',uid,name:farms.get(uid).name||uid,reason:'占用 '+id+' 與正式豬場的目前占用識別不一致（可能為歷史承接）',target:'lock'});counts.warning++;
  }
 }
 const rank={warning:0,legacy:1,deletedLegacy:2};
 findings.sort((a,b)=>(rank[a.type]??3)-(rank[b.type]??3)||String(a.name).localeCompare(String(b.name),'zh-TW'));
 return {findings,counts,totals:{farms:farms.size,tombs:tombs.size,locks:locks.size},checkedAt:Date.now()};
}
// V3.3.98: conservative, read-only eligibility *assessment* for possible
// future approval-lock backfills. It never creates or reserves any lock.
// Not a final authorization: Firestore's live transaction must recheck all
// preconditions before a future write feature can be considered.
function assessLegacyBackfillReadiness(farms,tombs,locks,reviews){
 const rows=[],counts={candidate:0,blocked:0,needsReview:0};
 const parcel=v=>clean(v||'',160).toLocaleLowerCase();
 const activeByParcel=new Map(),deletedByParcel=new Map(),locksByParcel=new Map(),locksByFarm=new Map();
 const push=(map,key,id)=>{if(!key)return;if(!map.has(key))map.set(key,[]);map.get(key).push(id);};
 for(const [id,f] of farms)push(activeByParcel,parcel(f.auditParcelKey||f.parcelKey),id);
 for(const [id,t] of tombs)push(deletedByParcel,parcel(t.auditParcelKey||t.parcelKey),id);
 for(const [id,l] of locks){push(locksByParcel,parcel(l.parcelKey),id);push(locksByFarm,String(l.farmUid||''),id);}
 for(const [id,f] of farms){
  if(id.startsWith('submitted-')||f.approvalLockId)continue;
  const reasons=[],key=parcel(f.auditParcelKey||f.parcelKey),review=reviews.get(id);
  let state='candidate';
  if(tombs.has(id)){state='blocked';reasons.push('此正式豬場同時存在刪除紀錄');}
  if(locksByFarm.has(id)){state='blocked';reasons.push('已有關聯核准占用紀錄，不能重複補登');}
  if(key){
   const others=(activeByParcel.get(key)||[]).filter(x=>x!==id);
   if(others.length){state='blocked';reasons.push('同地塊還有其他正式豬場：'+others.slice(0,3).join('、'));}
   if((deletedByParcel.get(key)||[]).length){state='blocked';reasons.push('同地塊存在已刪除豬場歷史，須先核對承接關係');}
   if((locksByParcel.get(key)||[]).length){state='blocked';reasons.push('同地塊已被核准占用紀錄使用');}
  }else if(state!=='blocked'){state='needsReview';reasons.push('缺少可核對的 F03 地塊識別碼');}
  if(!review){if(state==='candidate')state='needsReview';reasons.push('尚無管理員歷史人工確認紀錄');}
  else{
   if(review.reviewType!=='legacy_history_only'||review.farmUid!==id||!Number.isInteger(review.farmVersion)||review.farmVersion!==f.version){
    if(state!=='blocked')state='needsReview';reasons.push('人工確認紀錄或豬場版本不一致，須重新核對');
   }
   if(parcel(review.parcelKey)!==key){if(state!=='blocked')state='needsReview';reasons.push('人工確認時的地塊與目前地塊不一致');}
  }
  if(state==='candidate')reasons.push('可列為後續人工補登評估候選；尚未建立占用鎖');
  counts[state]++;
  rows.push({uid:id,name:f.name||id,parcelKey:key,state,reasons,hasReview:!!review});
 }
 const rank={blocked:0,needsReview:1,candidate:2};
 rows.sort((a,b)=>rank[a.state]-rank[b.state]||String(a.name).localeCompare(String(b.name),'zh-TW'));
 return {rows,counts,checkedAt:Date.now()};
}
// V3.3.98: independent evidence review for legacy farms. Read-only;
// a matching parcel identifier is not proof of ownership or site uniqueness.
function assessLegacyEvidenceQuality(farms,tombs,locks,reviews,eligibility){
 const results=[],totals={review:0,conflict:0,wellDocumented:0};
 const tidy=v=>String(v??'').trim().replace(/\s+/g,'').toLocaleLowerCase();
 const coords=f=>{if(f?.lat==null||f?.lng==null||f.lat===''||f.lng==='')return null;const lat=Number(f.lat),lng=Number(f.lng);return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=21&&lat<=27&&lng>=118&&lng<=123?[lat,lng]:null;};
 const meters=(a,b)=>Math.hypot((a[0]-b[0])*110574,(a[1]-b[1])*111320*Math.cos((a[0]+b[0])*Math.PI/360));
 const byId=new Map(eligibility.rows.map(x=>[x.uid,x]));
 for(const row of eligibility.rows){
  const farm=farms.get(row.uid)||{},point=coords(farm),issues=[],matches=[];
  let severity=row.state==='blocked'?'conflict':'review';
  if(row.state==='blocked')issues.push('已有地塊或歷史占用衝突，必須先查清');
  if(row.state==='needsReview')issues.push('原補登資格尚缺必要佐證');
  if(!point)issues.push('缺少有效臺灣範圍座標，須實地或航照定位');
  const address=tidy(farm.address),county=tidy(farm.county),town=tidy(farm.town);
  if(!county||!town)issues.push('縣市或鄉鎮資料不足');
  if(!address)issues.push('缺少可比對的完整地址');
  for(const [id,other] of farms){
   if(id===row.uid)continue;
   const otherPoint=coords(other);const d=point&&otherPoint?meters(point,otherPoint):null;
   const sameAddress=!!(address&&address===tidy(other.address)&&county===tidy(other.county)&&town===tidy(other.town));
   if(d!==null&&d<=8){matches.push(id);issues.push('與正式豬場 '+id+' 距離約 '+Math.round(d)+' 公尺，須核對是否同場');severity='conflict';}
   else if(sameAddress){matches.push(id);issues.push('與正式豬場 '+id+' 地址完全相同，須核對經營者');severity='conflict';}
   else if(d!==null&&d<=30){matches.push(id);issues.push('與正式豬場 '+id+' 距離約 '+Math.round(d)+' 公尺，建議比對場界');}
  }
  for(const [id,t] of tombs){
   const dp=coords(t);const d=point&&dp?meters(point,dp):null;
   if(d!==null&&d<=8){issues.push('鄰近已刪除豬場 '+id+'（約 '+Math.round(d)+' 公尺），須查核承接沿革');severity='conflict';}
  }
  const state=severity==='conflict'?'conflict':issues.length||row.state!=='candidate'?'review':'wellDocumented';
  if(state==='wellDocumented')issues.push('資料欄位齊備且本次未發現近距離衝突，仍須管理員現場複查');
  totals[state]++;
  results.push({uid:row.uid,name:row.name,farmVersion:farm.version,parcelKey:row.parcelKey,state,point,issues,matches:[...new Set(matches)],hasReview:row.hasReview});
 }
 const rank={conflict:0,review:1,wellDocumented:2};
 results.sort((a,b)=>rank[a.state]-rank[b.state]||a.name.localeCompare(b.name,'zh-TW'));
 return {rows:results,totals,checkedAt:Date.now()};
}
function renderLegacyLockAudit(){
 const host=$('cloudLegacyLockResults'),summary=$('cloudLegacyLockSummary'),controls=$('cloudLegacyLockControls');if(!host)return;
 if(controls)controls.hidden=!admin;
 if(!admin||!user){host.innerHTML='';if(summary)summary.textContent='此功能只開放管理員讀取。';const e=$('cloudLegacyEligibilityResults'),v=$('cloudLegacyEligibilitySummary');if(e)e.innerHTML='';if(v)v.textContent='僅管理員可評估補登資格。';renderLegacyEvidence();return;}
 if(legacyLockAuditBusy){if(summary)summary.textContent='正在向伺服器完整讀取正式豬場、刪除紀錄、占用與人工確認…';host.innerHTML='';const e=$('cloudLegacyEligibilityResults'),v=$('cloudLegacyEligibilitySummary');if(e)e.innerHTML='';if(v)v.textContent='正在核對全部四個集合，請勿以舊結果判斷補登資格。';renderLegacyEvidence();return;}
 if(!legacyLockAudit){if(summary)summary.textContent=legacyLockAuditError?'本次資料稽核未完成：'+legacyLockAuditError:'尚未稽核。按「從伺服器開始唯讀稽核」，不會修改任何資料。';host.innerHTML='';const e=$('cloudLegacyEligibilityResults'),v=$('cloudLegacyEligibilitySummary');if(e)e.innerHTML='';if(v)v.textContent=legacyLockAuditError?'資格評估無法確認：'+legacyLockAuditError:'請先從伺服器執行完整稽核。';renderLegacyEvidence();return;}
 const {counts,totals,findings}=legacyLockAudit;
 const reviewedCount=[...legacyLockReviews.keys()].length;
 const filter=$('cloudLegacyLockFilter')?.value||'all',q=clean($('cloudLegacyLockSearch')?.value||'',150).toLocaleLowerCase();
 const filtered=findings.filter(x=>(filter==='all'||x.type===filter)&&(!q||[x.uid,x.name,x.reason].join(' ').toLocaleLowerCase().includes(q)));
 if(summary)summary.textContent=`本次伺服器讀取：正式 ${totals.farms}、刪除 ${totals.tombs}、占用 ${totals.locks}；警示 ${counts.warning}、早期名冊 ${counts.legacy}、舊刪除紀錄 ${counts.deletedLegacy}、一致 ${counts.ok}。篩選 ${filtered.length} 筆。`;
 const rows=filtered.slice(0,legacyLockAuditLimit);
 host.innerHTML=rows.length?rows.map(x=>`<article class="cloud-resolution-history-card"><div><strong>${esc(x.name)}</strong><small> · ${esc(x.uid)}</small></div><div class="cloud-resolution-history-state" data-state="${x.type==='warning'?'warning':'unknown'}">${esc(x.type==='warning'?'需要人工核對':x.type==='legacy'?'早期名冊（非錯誤）':'舊刪除歷史（非錯誤）')}</div><p>${esc(x.reason)}</p><div class="cloud-resolution-history-actions">${x.target==='farm'&&liveFarms.has(x.uid)?`<button type="button" data-legacy-audit-farm="${esc(x.uid)}">查看正式豬場</button>`:''}${x.type==='legacy'&&!legacyLockReviews.has(x.uid)?`<button type="button" data-legacy-review="${esc(x.uid)}">人工確認歷史（不建立占用鎖）</button>`:''}${legacyLockReviews.has(x.uid)?`<small>已人工確認：${esc(legacyLockReviews.get(x.uid).reason||'')}（審核 UID：${esc(legacyLockReviews.get(x.uid).reviewerUid||'')}）</small>`:''}<button type="button" data-legacy-audit-copy="${esc(x.uid)}">複製紀錄 ID</button></div></article>`).join(''):'<p class="subtle">目前篩選下無需列出的紀錄。只有在四個集合全部從伺服器讀取成功後，這個結果才成立。</p>';
 const more=$('cloudLegacyLockMore');if(more){more.hidden=filtered.length<=legacyLockAuditLimit;more.textContent='顯示更多（尚有 '+(filtered.length-legacyLockAuditLimit)+' 筆）';}
 const eligHost=$('cloudLegacyEligibilityResults'),eligSummary=$('cloudLegacyEligibilitySummary');
 if(eligHost&&eligSummary){
  const elig=legacyLockEligibility;
  if(!elig){eligSummary.textContent='本次尚未取得完整的補登資格評估資料。';eligHost.innerHTML='';}
  else{
   const {counts:ec,rows:er}=elig;
   const q2=clean($('cloudLegacyEligibilitySearch')?.value||'',150).toLocaleLowerCase();
   const filter2=$('cloudLegacyEligibilityFilter')?.value||'all';
   const visible=er.filter(x=>(filter2==='all'||x.state===filter2)&&(!q2||[x.uid,x.name,x.parcelKey,...x.reasons].join(' ').toLocaleLowerCase().includes(q2)));
   eligSummary.textContent=`正式舊場資格評估：候選 ${ec.candidate}、需補證 ${ec.needsReview}、有衝突 ${ec.blocked}。符合篩選 ${visible.length} 筆；此結果僅為唯讀評估，不是占用鎖。`;
   eligHost.innerHTML=visible.slice(0,legacyEligibilityLimit).map(x=>`<article class="cloud-resolution-history-card"><div><strong>${esc(x.name)}</strong><small> · ${esc(x.uid)}</small></div><div class="cloud-resolution-history-state" data-state="${x.state==='blocked'?'warning':x.state==='candidate'?'pending':'unknown'}">${x.state==='blocked'?'有衝突，停止補登':x.state==='candidate'?'補登候選（尚未寫入）':'需補充佐證'}</div><small>地塊：${esc(x.parcelKey||'未確認')}</small><p>${esc(x.reasons.join('；'))}</p><div class="cloud-resolution-history-actions">${liveFarms.has(x.uid)?`<button type="button" data-legacy-eligibility-farm="${esc(x.uid)}">查看正式豬場</button>`:''}<button type="button" data-legacy-eligibility-copy="${esc(x.uid)}">複製 ID</button></div></article>`).join('')||'<p class="subtle">目前篩選下沒有紀錄。</p>';
   const more2=$('cloudLegacyEligibilityMore');if(more2){more2.hidden=visible.length<=legacyEligibilityLimit;more2.textContent='顯示更多（尚有 '+(visible.length-legacyEligibilityLimit)+' 筆）';}
  }
 }
 renderLegacyEvidence();
 renderLegacyWorklist();
}
function renderLegacyEvidence(){
 const host=$('cloudLegacyEvidenceResults'),summary=$('cloudLegacyEvidenceSummary');if(!host||!summary)return;
 if(!admin||!user){summary.textContent='僅管理員可查看。';host.innerHTML='';return;}
 if(legacyLockAuditBusy){summary.textContent='伺服器資料讀取中，暫不顯示舊結果。';host.innerHTML='';return;}
 if(!legacyEvidenceReview||!legacyLockAudit){summary.textContent=legacyLockAuditError?'無法完成複查：'+legacyLockAuditError:'請先執行上方完整雲端稽核。';host.innerHTML='';return;}
 const q=clean($('cloudLegacyEvidenceSearch')?.value||'',150).toLocaleLowerCase(),filter=$('cloudLegacyEvidenceFilter')?.value||'all';
 const rows=legacyEvidenceReview.rows.filter(r=>(filter==='all'||filter===r.state)&&(!q||[r.uid,r.name,r.parcelKey,...r.issues].join(' ').toLocaleLowerCase().includes(q)));
 const t=legacyEvidenceReview.totals;summary.textContent=`資料品質複查：需釐清衝突 ${t.conflict}、需補證 ${t.review}、資料較完整 ${t.wellDocumented}；篩選 ${rows.length} 筆。僅根據目前伺服器資料判讀，不是官方地籍或經營者認定。`;
 host.innerHTML=rows.slice(0,legacyEvidenceLimit).map(r=>`<article class="cloud-resolution-history-card"><div><strong>${esc(r.name)}</strong><small> · ${esc(r.uid)}</small></div><div class="cloud-resolution-history-state" data-state="${r.state==='conflict'?'warning':'unknown'}">${r.state==='conflict'?'疑似衝突，暫緩':r.state==='review'?'需補充佐證':'資料較完整，仍須複查'}</div><small>地塊：${esc(r.parcelKey||'未確認')}｜座標：${r.point?r.point.map(x=>x.toFixed(6)).join(', '):'未確認'}</small><p>${esc(r.issues.join('；'))}</p><div class="cloud-resolution-history-actions"><button type="button" data-legacy-evidence-copy="${esc(r.uid)}">複製複查摘要</button>${liveFarms.has(r.uid)?`<button type="button" data-legacy-evidence-farm="${esc(r.uid)}">查看正式豬場</button>`:''}</div></article>`).join('')||'<p class="subtle">目前篩選沒有紀錄。</p>';
 const more=$('cloudLegacyEvidenceMore');if(more){more.hidden=rows.length<=legacyEvidenceLimit;more.textContent='顯示更多（尚有 '+(rows.length-legacyEvidenceLimit)+' 筆）';}
 renderLegacyWorklist();
}
// V3.4.00: action-oriented checklist derived entirely from a completed read-only audit.
// Progress is explicitly per-browser/per-account and is NOT a Firebase approval.
function legacyWorklistKey(uid){return 'pigfarm-legacy-worklist-v399:'+String(uid||'');}
function legacyWorklistSignature(r){return r.tasks.join('|')+'|'+r.parcelKey+'|'+r.state+'|'+r.issues.join('|');}
function legacyWorklistEvidenceValid(p){return !!(p&&['aerial','site','documents','combined'].includes(p.source)&&['confirmed','needsEvidence','conflict'].includes(p.finding)&&typeof p.note==='string'&&p.note.trim().length>=10);}
function legacyWorklistState(uid){
 if(!uid)return {};
 try{const obj=JSON.parse(localStorage.getItem(legacyWorklistKey(uid))||'{}');return obj&&typeof obj==='object'&&!Array.isArray(obj)?obj:{};}catch{return {};}
}
function legacyWorklistTasks(rows){
 return rows.map(r=>{
  const tasks=[];
  if(!r.point)tasks.push('核對航照或現場座標');
  if(!r.parcelKey)tasks.push('確認 F03 地塊識別碼及場界');
  if(!r.hasReview)tasks.push('檢視並補齊管理員歷史人工確認（非占用鎖）');
  if(r.state==='conflict')tasks.push('查證相鄰正式豬場、不同經營者與歷史承接');
  if(r.state==='review')tasks.push('補充地址、地塊與經營者佐證');
  if(r.state==='wellDocumented')tasks.push('完成現場／航照人工複查，決定是否進入後續審查');
  return {...r,tasks,priority:r.state==='conflict'?'高':r.state==='review'?'中':'一般'};
 });
}
// V3.4.05: read-only integration of confirmed cloud evidence alerts into local worklist.
// Null means cloud history has NOT been fully confirmed; never silently treat it as zero alerts.
function legacyWorklistCloudAlerts(archives,farms){
 if(!Array.isArray(archives))return null;
 return new Map(legacyEvidenceHistoryAlerts(archives,farms).map(a=>[a.farmUid,a]));
}
// V3.4.06: read-only follow-up derived strictly from immutable server archives.
// A newer "confirmed" note clears a historical concern only if audit signature AND
// farm version match the last adverse note and the currently loaded formal farm.
// This is NOT a formal approval, not a field inspection certification.
function legacyEvidenceFollowup(records,farmMap){
 if(!Array.isArray(records))return null; // unknown while offline, failed or not loaded
 const groups=new Map();
 for(const r of records){const id=String(r?.farmUid||'');if(!id)continue;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(r);}
 const result=new Map();
 for(const [uid,recordsForFarm] of groups){
  const [latest,previous]=legacyEvidenceHistoryOrder(recordsForFarm),farm=farmMap?.get?.(uid);
  const versionOK=!!farm&&Number.isInteger(farm.version)&&Number.isInteger(latest.farmVersion)&&farm.version===latest.farmVersion;
  const unchanged=!!previous&&String(previous.signature||'')===String(latest.signature||'')&&Number.isInteger(previous.farmVersion)&&previous.farmVersion===latest.farmVersion;
  let state='stable',reason='最新雲端佐證未顯示指定異常；仍須依資料品質複查。';
  if(!versionOK){state='unverified';reason='目前正式豬場未載入，或最新佐證版本與正式豬場不一致。';}
  else if(latest.finding==='conflict'){state='conflict';reason='最新雲端查核結論仍有衝突。';}
  else if(latest.finding==='needsEvidence'){state='evidence';reason='最新雲端查核仍待補充佐證。';}
  else if(previous&&(!unchanged)){state='unverified';reason='歷次稽核條件或豬場版本不同，無法以新佐證直接解除舊疑點。';}
  else if(latest.finding==='confirmed'&&previous&&['conflict','needsEvidence'].includes(previous.finding)){
   state='resolved';reason='較新的雲端佐證顯示原疑點已改善；版本及稽核條件一致（非正式核定）。';
  }
  result.set(uid,{state,reason,latestId:latest.id||'',previousId:previous?.id||''});
 }
 return result;
}
function legacyWorklistPrioritize(rows,cloudAlerts){
 return rows.map(r=>{
  const alert=cloudAlerts?.get(r.uid)||null;
  const cloudPriority=alert?.severity==='critical'?'高':alert?'中':null;
  const priority=r.priority==='高'||cloudPriority==='高'?'高':r.priority==='中'||cloudPriority==='中'?'中':'一般';
  return {...r,cloudAlert:alert,priority,needsRecheck:!!alert};
 }).sort((a,b)=>({'高':0,'中':1,'一般':2}[a.priority]-{'高':0,'中':1,'一般':2}[b.priority])||Number(b.needsRecheck)-Number(a.needsRecheck)||a.name.localeCompare(b.name,'zh-TW'));
}
function renderLegacyWorklist(){
 const host=$('cloudLegacyWorklistResults'),summary=$('cloudLegacyWorklistSummary');if(!host||!summary)return;
 if(!user||!admin){host.innerHTML='';summary.textContent='僅管理員可使用本機複查清單。';return;}
 if(legacyLockAuditBusy){host.innerHTML='';summary.textContent='正在重新讀取伺服器稽核；舊清單暫不顯示。';return;}
 if(!legacyLockAudit||!legacyEvidenceReview){host.innerHTML='';summary.textContent=legacyLockAuditError?'雲端稽核失敗：'+legacyLockAuditError:'請先執行上方完整伺服器稽核。';return;}
 const cloudAlerts=!legacyCloudEvidenceBusy&&!legacyCloudEvidenceError?legacyWorklistCloudAlerts(legacyCloudEvidence,liveFarms):null;
 const list=legacyWorklistPrioritize(legacyWorklistTasks(legacyEvidenceReview.rows),cloudAlerts),progress=legacyWorklistState(user.uid),followups=!legacyCloudEvidenceBusy&&!legacyCloudEvidenceError?legacyEvidenceFollowup(legacyCloudEvidence,liveFarms):null;
 const q=clean($('cloudLegacyWorklistSearch')?.value||'',150).toLocaleLowerCase(),risk=$('cloudLegacyWorklistRisk')?.value||'all',stage=$('cloudLegacyWorklistStatus')?.value||'all';
 const entries=list.map(r=>{const p=progress[r.uid];const fresh=!!(p&&p.signature===legacyWorklistSignature(r));const recordedStage=fresh?p.stage:'todo';return {...r,followup:followups?.get(r.uid)||null,stage:r.cloudAlert&&recordedStage==='reviewed'?'checking':recordedStage,stale:!!p&&!fresh,evidence:fresh?p:null,needsRecheck:!!r.cloudAlert,reviewPreviouslyCompleted:!!r.cloudAlert&&recordedStage==='reviewed'};});
 const rows=entries.filter(r=>(risk==='all'||(risk==='cloud'&&r.needsRecheck)||(risk==='critical-cloud'&&r.cloudAlert?.severity==='critical')||(risk==='resolved-cloud'&&r.followup?.state==='resolved')||(risk==='needs-evidence-cloud'&&r.followup?.state==='evidence')||(risk==='unverified-cloud'&&(!followups||!r.followup||r.followup.state==='unverified'))||r.state===risk)&&(stage==='all'||r.stage===stage)&&(!q||[r.uid,r.name,r.parcelKey,...r.issues,...r.tasks,r.followup?.reason||''].join(' ').toLocaleLowerCase().includes(q)));
 const counts={todo:0,checking:0,evidence:0,reviewed:0};entries.forEach(r=>counts[r.stage]++);const cloudCount=entries.filter(r=>r.needsRecheck).length,resolvedCount=entries.filter(r=>r.followup?.state==='resolved').length;
 summary.textContent=`本機已記錄佐證 ${entries.filter(r=>legacyWorklistEvidenceValid(r.evidence)).length} 筆｜完整稽核 ${entries.length} 筆｜待辦 ${counts.todo}、複查中 ${counts.checking}、待補證 ${counts.evidence}、本機已複查 ${counts.reviewed}｜雲端異常 ${cloudAlerts?cloudCount+' 筆':'尚未完成讀取／確認'}｜新佐證顯示改善 ${followups?resolvedCount+' 筆':'尚未確認'}（非核定）。篩選 ${rows.length} 筆。進度僅在本裝置，不是雲端核定。`;
 host.innerHTML=rows.slice(0,legacyWorklistLimit).map(r=>`<article class="cloud-resolution-history-card"><div><strong>${esc(r.name)}</strong><small> · ${esc(r.uid)}</small></div><div class="cloud-resolution-history-state" data-state="${r.state==='conflict'?'warning':'unknown'}">${esc('優先級 '+r.priority+' · '+(r.state==='conflict'?'疑似衝突':r.state==='review'?'待補證':'資料較完整'))}</div><p>${esc(r.issues.join('；'))}</p><strong>建議複查事項</strong><ul>${r.tasks.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>${r.stale?'<p class="subtle">資料／風險條件已改變，舊的本機進度已失效，請重新複查。</p>':''}${r.cloudAlert?`<p class="cloud-legacy-priority-alert" role="status">雲端佐證提醒：${esc(r.cloudAlert.reasons.join('；'))}。${r.reviewPreviouslyCompleted?'原本本機已複查，現改列待重新複查；原佐證仍保留。':'請優先重新複查。'}</p>`:''}${r.followup?`<p class="subtle">雲端佐證處理追蹤：${esc(r.followup.reason)}</p>`:(!followups?'<p class="subtle">雲端佐證尚未確認，不能判定疑點已解除。</p>':'')}<div class="cloud-resolution-history-actions"><label>本機進度 <select data-legacy-worklist-stage="${esc(r.uid)}"><option value="todo"${r.stage==='todo'?' selected':''}>尚未開始</option><option value="checking"${r.stage==='checking'?' selected':''}>複查中</option><option value="evidence"${r.stage==='evidence'?' selected':''}>待補佐證</option><option value="reviewed"${r.stage==='reviewed'?' selected':''}>本機已複查（非核定）</option></select></label><button type="button" data-legacy-worklist-copy="${esc(r.uid)}">複製待辦摘要</button><button type="button" data-legacy-worklist-farm="${esc(r.uid)}">查看正式豬場</button>${r.cloudAlert?`<button type="button" data-legacy-worklist-history="${esc(r.uid)}">查看雲端異常與歷史</button>`:''}</div><details class="cloud-legacy-evidence-form"><summary>複查佐證與結果（本機，非正式核定）${legacyWorklistEvidenceValid(r.evidence)?' · 已記錄':' · 尚未記錄'}</summary><div class="cloud-legacy-evidence-fields"><label>查核方式 <select data-legacy-evidence-source="${esc(r.uid)}"><option value="">請選擇</option><option value="aerial"${r.evidence?.source==='aerial'?' selected':''}>航照／地圖判讀</option><option value="site"${r.evidence?.source==='site'?' selected':''}>現場查核</option><option value="documents"${r.evidence?.source==='documents'?' selected':''}>書面資料</option><option value="combined"${r.evidence?.source==='combined'?' selected':''}>多種方式</option></select></label><label>複查結論 <select data-legacy-evidence-finding="${esc(r.uid)}"><option value="">請選擇</option><option value="confirmed"${r.evidence?.finding==='confirmed'?' selected':''}>資料已核對（仍非核定）</option><option value="needsEvidence"${r.evidence?.finding==='needsEvidence'?' selected':''}>需補充資料</option><option value="conflict"${r.evidence?.finding==='conflict'?' selected':''}>發現衝突須釐清</option></select></label><label class="cloud-legacy-evidence-note">佐證摘要（至少 10 字，不要填個資或密碼）<textarea rows="3" maxlength="500" data-legacy-evidence-note="${esc(r.uid)}" placeholder="例如：比對某年度航照與 F03 地塊，場界仍須現場確認">${esc(r.evidence?.note||'')}</textarea></label><div class="cloud-resolution-history-actions"><button type="button" data-legacy-evidence-save="${esc(r.uid)}">儲存本機佐證</button><small>最後記錄：${esc(r.evidence?.evidenceAt?new Date(r.evidence.evidenceAt).toLocaleString('zh-TW'):'尚無')}</small></div></div></details></article>`).join('')||'<p class="subtle">目前篩選條件沒有符合紀錄。</p>';
 const more=$('cloudLegacyWorklistMore');if(more){more.hidden=rows.length<=legacyWorklistLimit;more.textContent='顯示更多（尚有 '+(rows.length-legacyWorklistLimit)+' 筆）';}
}

// V3.4.02: an opt-in append-only cloud evidence archive. Never overwrites farms,
// approvals, other reviewers or the local copy. Comparing is read-only.
function legacyEvidenceArchiveDecision(local,cloud){
 if(!local)return 'local-missing';
 if(!legacyWorklistEvidenceValid(local))return 'local-incomplete';
 if(!cloud)return 'local-only';
 if(cloud.signature!==local.signature)return 'different-audit';
 if(cloud.source===local.source&&cloud.finding===local.finding&&cloud.note===local.note&&cloud.stage===local.stage)return 'same';
 return 'different-content';
}
function legacyEvidenceArchiveLatest(items){
 const latest=new Map();
 for(const x of items){
  const key=String(x.farmUid||'');if(!key)continue;
  const prev=latest.get(key),stamp=x.archivedAt?.toMillis?.()||0;
  if(!prev||stamp>(prev.archivedAt?.toMillis?.()||0))latest.set(key,x);
 }
 return latest;
}
// V3.4.04: Read-only cross-reviewer history comparison. This compares archived
// snapshots only; it never writes to Firestore or changes formal approval.
function legacyEvidenceHistoryOrder(rows){
 return [...rows].sort((a,b)=>{
  const stamp=x=>x.archivedAt?.toMillis?.()??(Number.isFinite(x.archivedAt?.seconds)?x.archivedAt.seconds*1000:0);
  return stamp(b)-stamp(a)||String(b.id||'').localeCompare(String(a.id||''));
 });
}
function legacyEvidenceHistoryDiff(a,b){
 const fields=['farmVersion','signature','source','finding','note','stage','reviewerUid'];
 return fields.filter(key=>String(a?.[key]??'')!==String(b?.[key]??''));
}
// V3.4.04: read-only alerts inferred from archived evidence snapshots.
// Historical conclusions are not formal approval decisions; missing live data is unknown.
function legacyEvidenceHistoryAlerts(records, farmMap){
 const grouped=new Map();
 for(const r of records||[]){
  const id=String(r?.farmUid||'');if(!id)continue;
  if(!grouped.has(id))grouped.set(id,[]);
  grouped.get(id).push(r);
 }
 const alerts=[];
 for(const [farmUid,items] of grouped){
  const ordered=legacyEvidenceHistoryOrder(items),latest=ordered[0],previous=ordered[1];
  const reasons=[];let severity='review';
  if(latest.finding==='conflict'){
   reasons.push(previous?.finding==='confirmed'?'結論由「資料已核對」轉為「發現衝突」':'最新佐證結論為「發現衝突」');
   severity='critical';
  }else if(previous?.finding==='confirmed'&&latest.finding==='needsEvidence'){
   reasons.push('結論由「資料已核對」轉為「需要補充佐證」');
  }
  if(previous&&String(previous.signature||'')!==String(latest.signature||''))reasons.push('最新兩筆佐證的稽核條件不同');
  const current=farmMap?.get?.(farmUid);
  if(!current){reasons.push('目前正式豬場未載入，無法核對版本');}
  else if(!Number.isInteger(current.version)||!Number.isInteger(latest.farmVersion))reasons.push('豬場或歷史版本未確認');
  else if(current.version!==latest.farmVersion)reasons.push('最新佐證對應的豬場版本已非目前版本');
  if(reasons.length)alerts.push({farmUid,name:current?.name||farmUid,severity,reasons,latestId:latest.id||'',previousId:previous?.id||''});
 }
 return alerts.sort((a,b)=>(a.severity==='critical'?0:1)-(b.severity==='critical'?0:1)||a.name.localeCompare(b.name,'zh-TW'));
}
function renderLegacyEvidenceAlerts(){
 const summary=$('cloudLegacyAlertSummary'),host=$('cloudLegacyAlertResults');if(!summary||!host)return;
 if(!admin||!user){summary.textContent='僅管理員可查看。';host.innerHTML='';return;}
 if(legacyCloudEvidenceBusy){summary.textContent='正在從伺服器讀取歷史…';host.innerHTML='';return;}
 if(legacyCloudEvidenceError){summary.textContent='無法確認異常：'+legacyCloudEvidenceError;host.innerHTML='';return;}
 if(!legacyCloudEvidence){summary.textContent='請先讀取雲端佐證歷史；尚未確認異常數量。';host.innerHTML='';return;}
 const alerts=legacyEvidenceHistoryAlerts(legacyCloudEvidence,liveFarms);
 const filter=$('cloudLegacyAlertFilter')?.value||'all';
 const visible=alerts.filter(x=>filter==='all'||(filter==='critical'?x.severity==='critical':x.severity!=='critical'));
 const critical=alerts.filter(x=>x.severity==='critical').length;
 summary.textContent=`佐證歷史提醒 ${alerts.length} 個豬場，其中最新結論發現衝突 ${critical} 個；目前顯示 ${visible.length} 個。這是歷史資料提示，不代表官方認定或正式核定。`;
 host.innerHTML=visible.slice(0,100).map(x=>`<article class="cloud-resolution-history-card"><div><strong>${esc(x.name)}</strong><small> · ${esc(x.farmUid)}</small></div><div class="cloud-resolution-history-state" data-state="${x.severity==='critical'?'warning':'unknown'}">${x.severity==='critical'?'優先人工複查':'需要人工核對'}</div><p>${esc(x.reasons.join('；'))}</p><div class="cloud-resolution-history-actions"><button type="button" data-legacy-alert-farm="${esc(x.farmUid)}">查看此場歷史</button></div></article>`).join('')||'<p class="subtle">目前篩選下沒有需要提醒的紀錄（不代表所有正式豬場已驗收）。</p>';
}
function renderLegacyEvidenceHistory(){
 const summary=$('cloudLegacyHistorySummary'),host=$('cloudLegacyHistoryResults'),farm=$('cloudLegacyHistoryFarm'),older=$('cloudLegacyHistoryOlder'),newer=$('cloudLegacyHistoryNewer');
 if(!summary||!host||!farm||!older||!newer)return;
 renderLegacyEvidenceAlerts();
 if(!admin||!user){summary.textContent='僅管理員可查閱佐證歷史。';host.innerHTML='';return;}
 if(legacyCloudEvidenceBusy){summary.textContent='正在讀取雲端歷史…';host.innerHTML='';return;}
 if(legacyCloudEvidenceError){summary.textContent='無法確認完整歷史：'+legacyCloudEvidenceError;host.innerHTML='';return;}
 if(!legacyCloudEvidence){summary.textContent='請先點擊「讀取雲端佐證並比對」。';host.innerHTML='';return;}
 const all=legacyEvidenceHistoryOrder(legacyCloudEvidence),byFarm=new Map();
 for(const record of all){const id=String(record.farmUid||'');if(!id)continue;if(!byFarm.has(id))byFarm.set(id,[]);byFarm.get(id).push(record);}
 const selected=farm.value;
 const ids=[...byFarm.keys()].sort((a,b)=>a.localeCompare(b));
 farm.innerHTML='<option value="">請選擇豬場</option>'+ids.map(id=>`<option value="${esc(id)}">${esc(liveFarms.get(id)?.name||id)} (${esc(id)}) · ${byFarm.get(id).length} 筆</option>`).join('');
 if(ids.includes(selected))farm.value=selected;
 const chosen=farm.value;if(!chosen){summary.textContent=`已讀回 ${all.length} 筆佐證，涵蓋 ${ids.length} 個豬場；選取一個豬場以查看完整歷史。`;host.innerHTML='';return;}
 const list=byFarm.get(chosen)||[];
 const options=list.map((r,i)=>`<option value="${esc(r.id)}">第 ${list.length-i} 筆｜${esc(r.archivedAt?.toDate?.().toLocaleString('zh-TW')||'時間未確認')}｜${esc(r.reviewerUid||'未知')}</option>`).join('');
 const previousOld=older.value,previousNew=newer.value;
 older.innerHTML=options;newer.innerHTML=options;
 older.value=list.some(x=>x.id===previousOld)?previousOld:(list[1]?.id||list[0]?.id||'');
 newer.value=list.some(x=>x.id===previousNew)?previousNew:(list[0]?.id||'');
 const fmt=r=>r?.archivedAt?.toDate?.().toLocaleString('zh-TW')||'未記錄';
 const currentVersion=liveFarms.get(chosen)?.version;
 const items=list.map(r=>`<article class="cloud-resolution-history-card"><div><strong>${esc(fmt(r))}</strong><small> · ${esc(r.id)}</small></div><p>管理員：${esc(r.reviewerUid||'未知')}｜豬場版本：${esc(String(r.farmVersion??'未記錄'))}${Number.isInteger(currentVersion)&&r.farmVersion!==currentVersion?'（不同於目前版本 '+esc(String(currentVersion))+'）':''}</p><p>方式：${esc(r.source||'')}｜結論：${esc(r.finding||'')}｜本機進度：${esc(r.stage||'')}</p><p>摘要：${esc(r.note||'')}</p><small>稽核條件：${esc(r.signature||'無')}</small></article>`).join('');
 const limit=Number($('cloudLegacyHistoryLimit')?.value)||20;
 summary.textContent=`${esc(chosen)}：共 ${list.length} 筆雲端佐證；顯示最近 ${Math.min(limit,list.length)} 筆。以下為歷史快照，不代表現行有效或正式核定。`;
 host.innerHTML=items.slice(0,limit).join('');
 const a=list.find(x=>x.id===older.value),b=list.find(x=>x.id===newer.value),diff=$('cloudLegacyHistoryDiff');
 if(diff){
  if(!a||!b){diff.textContent='沒有可比較的版本。';}
  else if(a.id===b.id){diff.textContent='兩側選取同一筆歷史，請選擇不同版本。';}
  else {
   const changes=legacyEvidenceHistoryDiff(a,b);
   if(!changes.length){diff.textContent='兩份紀錄的查核欄位一致（歸檔時間或文件 ID 仍不同）。';}
   else {
    const names={farmVersion:'豬場版本',signature:'稽核條件',source:'查核方式',finding:'查核結論',note:'佐證摘要',stage:'查核進度',reviewerUid:'管理員'};
    diff.innerHTML='<strong>發現 '+changes.length+' 個欄位不同</strong><div class="cloud-legacy-history-diffs">'+changes.map(key=>`<div class="cloud-legacy-history-diff"><strong>${esc(names[key]||key)}</strong><div class="cloud-legacy-history-sides"><p><small>較早：</small>${esc(String(a[key]??'未記錄'))}</p><p><small>較新：</small>${esc(String(b[key]??'未記錄'))}</p></div></div>`).join('')+'</div>';
   }
  }
 }
}
function resetLegacyEvidenceArchive(){
 legacyEvidenceCloudGeneration++;legacyCloudEvidence=null;legacyCloudEvidenceError='';legacyCloudEvidenceBusy=false;
 const summary=$('cloudLegacyArchiveSummary'),host=$('cloudLegacyArchiveResults');
 if(summary)summary.textContent='尚未讀取雲端佐證歷史。';if(host)host.innerHTML='';renderLegacyEvidenceHistory();
}
function renderLegacyEvidenceArchive(){
 const summary=$('cloudLegacyArchiveSummary'),host=$('cloudLegacyArchiveResults');if(!summary||!host)return;
 if(!admin||!user){summary.textContent='僅管理員可讀取與歸檔複查佐證。';host.innerHTML='';return;}
 if(!legacyEvidenceReview){summary.textContent='請先完成正式豬場的伺服器稽核。';host.innerHTML='';return;}
 if(legacyCloudEvidenceBusy){summary.textContent='正在從伺服器讀取佐證歷史…';renderLegacyEvidenceHistory();return;}
 if(legacyCloudEvidenceError){summary.textContent='雲端佐證讀取未完成：'+legacyCloudEvidenceError;host.innerHTML='';return;}
 if(!legacyCloudEvidence){summary.textContent='請點「讀取雲端佐證並比對」；不會自動上傳。';host.innerHTML='';return;}
 const local=legacyWorklistState(user.uid), latest=legacyEvidenceArchiveLatest(legacyCloudEvidence);
 const rows=legacyWorklistTasks(legacyEvidenceReview.rows).map(r=>{
  const p=local[r.uid],fresh=!!p&&p.signature===legacyWorklistSignature(r),cloud=latest.get(r.uid);
  const decision=!fresh?'stale-or-empty':legacyEvidenceArchiveDecision(p,cloud);
  return {...r,local:fresh?p:null,cloud,decision};
 });
 const tally={};rows.forEach(r=>tally[r.decision]=(tally[r.decision]||0)+1);
 summary.textContent=`雲端歷史 ${legacyCloudEvidence.length} 筆｜符合本次稽核 ${rows.length} 筆｜本機待上傳 ${tally['local-only']||0}｜內容有差異 ${tally['different-content']||0}｜需重新複查 ${tally['stale-or-empty']||0}。歷史為唯讀快照，不是正式核定。`;
 const labels={'local-only':'本機有佐證，雲端無歷史','same':'目前本機內容與最新雲端版本一致','different-content':'本機與最新雲端內容不同','different-audit':'雲端佐證對應不同稽核條件','stale-or-empty':'尚無有效本機佐證或原稽核已變更','local-incomplete':'本機佐證不完整'};
 const filter=$('cloudLegacyArchiveFilter')?.value||'all';
 host.innerHTML=rows.filter(r=>filter==='all'||r.decision===filter).slice(0,100).map(r=>`<article class="cloud-resolution-history-card"><strong>${esc(r.name)}</strong><small> · ${esc(r.uid)}</small><p>${esc(labels[r.decision]||r.decision)}</p><small>雲端最近：${esc(r.cloud?.reviewerUid||'無')}｜${esc(r.cloud?.archivedAt?.toDate?.().toLocaleString('zh-TW')||'無')}</small>${r.cloud?`<details><summary>查看最新雲端佐證（唯讀）</summary><p>方式：${esc(r.cloud.source)}｜結論：${esc(r.cloud.finding)}｜進度：${esc(r.cloud.stage)}</p><p>${esc(r.cloud.note)}</p></details>`:''}<div class="cloud-resolution-history-actions">${r.local&&legacyWorklistEvidenceValid(r.local)&&r.decision!=='same'?`<button type="button" data-legacy-archive-upload="${esc(r.uid)}">明確上傳本筆佐證（新增歷史）</button>`:''}</div></article>`).join('')||'<p class="subtle">目前沒有符合條件的紀錄。</p>';
}
async function readLegacyEvidenceArchive(){
 if(!admin||!adminReady||!db||!user||!legacyEvidenceReview){status('請先登入管理員並完成伺服器稽核。',true);return;}
 const generation=++legacyEvidenceCloudGeneration,session=loggedInSeq,uid=user.uid;
 legacyCloudEvidenceBusy=true;legacyCloudEvidenceError='';renderLegacyEvidenceArchive();
 try{
  const snap=await F.getDocsFromServer(F.collection(db,'legacyEvidenceArchives'));
  if(generation!==legacyEvidenceCloudGeneration||!sameSession(session,uid)||!admin)return;
  legacyCloudEvidence=snap.docs.map(d=>({id:d.id,...d.data()}));
 }catch(e){if(generation===legacyEvidenceCloudGeneration&&sameSession(session,uid)){legacyCloudEvidenceError=err(e);legacyCloudEvidence=null;status('雲端佐證讀取失敗：'+err(e),true);}}
 finally{if(generation===legacyEvidenceCloudGeneration&&sameSession(session,uid)){legacyCloudEvidenceBusy=false;renderLegacyEvidenceArchive();renderLegacyEvidenceHistory();renderLegacyWorklist();}}
}
async function uploadLegacyEvidenceArchive(farmUid){
 if(!admin||!adminReady||!db||!user||!legacyEvidenceReview||!legacyCloudEvidence||legacyCloudEvidenceBusy){status('請先完成伺服器稽核與雲端歷史比對。',true);return;}
 const row=legacyWorklistTasks(legacyEvidenceReview.rows).find(r=>r.uid===farmUid),local=legacyWorklistState(user.uid)[farmUid];
 if(!row||!local||local.signature!==legacyWorklistSignature(row)||!legacyWorklistEvidenceValid(local)){status('本機佐證已過期或不完整，請先重新複查。',true);return;}
 if(legacyEvidenceArchiveDecision(local,legacyEvidenceArchiveLatest(legacyCloudEvidence).get(farmUid))==='same'){status('目前雲端最新佐證內容已相同，無須重複上傳。');return;}
 const reviewerUid=user.uid,session=loggedInSeq,version=liveFarms.get(farmUid)?.version;
 if(!Number.isInteger(version)||version<1||version!==row.farmVersion){status('正式豬場版本與本次複查稽核不一致，請重新執行伺服器稽核。',true);return;}
 if(local.signature.length>1600){status('本次複查條件過長，無法安全歸檔，請縮短稽核摘要後重新檢查。',true);return;}
 if(!confirm('確定新增一筆雲端複查佐證歷史？這不會覆蓋舊紀錄，也不代表正式核定。'))return;
 legacyCloudEvidenceBusy=true;renderLegacyEvidenceArchive();
 const record={farmUid,farmVersion:version,reviewerUid,signature:local.signature,source:local.source,finding:local.finding,note:local.note.trim(),stage:['todo','checking','evidence','reviewed'].includes(local.stage)?local.stage:'checking',evidenceAt:local.evidenceAt||local.updatedAt||'',archivedAt:F.serverTimestamp()};
 const docRef=F.doc(F.collection(db,'legacyEvidenceArchives'));
 let committed=false;
 try{
  await F.runTransaction(db,async tx=>{
   const farm=await tx.get(F.doc(db,'farms',farmUid));
   if(!farm.exists()||farm.data().version!==version)throw new Error('正式豬場版本已變更，請重新稽核後再上傳。');
   tx.set(docRef,record);
  });committed=true;
  status('Firestore 已新增佐證歷史，正在讀回；原本的正式豬場與本機紀錄均未變更。');
  const check=await F.getDocFromServer(docRef);
  if(!sameSession(session,reviewerUid))return;
  if(!check.exists()||check.data()?.reviewerUid!==reviewerUid){status('雲端寫入已完成，但尚未讀回確認。請勿重複提交，請重新讀取歷史。',true);return;}
  status('雲端佐證歷史已寫入並讀回確認（非正式核定）。');
 }catch(e){if(sameSession(session,reviewerUid))status(committed?'已寫入雲端，但讀回失敗，請勿重複提交：'+err(e):'雲端佐證未成功提交：'+err(e),true);}
 finally{if(sameSession(session,reviewerUid)){legacyCloudEvidenceBusy=false;await readLegacyEvidenceArchive();}}
}

// V3.4.00: carry the originating checklist into the existing edit form,
// without turning a local review into a Firebase approval.
function renderLegacyEditContext(){
 const box=$('cloudLegacyEditContext'),details=$('cloudLegacyEditDetails');if(!box||!details)return;
 const c=admin&&user?legacyWorklistEditContext:null;
 box.hidden=!c;
 if(c)details.textContent=c.name+'｜'+c.uid+'｜'+c.priority+'優先｜待核對：'+c.tasks.join('；');
 else details.textContent='';
}
function openLegacyWorklistFarm(uid){
 if(!admin||!user||!legacyLockAudit||!legacyEvidenceReview){status('請先完成雲端稽核，並以管理員登入。',true);return;}
 const row=legacyWorklistTasks(legacyEvidenceReview.rows).find(r=>r.uid===uid);
 if(!row){status('原複查紀錄已不在目前稽核結果中，請重新稽核。',true);return;}
 edit(uid);
 if($('cloudEditForm')?.hidden)return;
 legacyWorklistEditContext={uid:row.uid,name:row.name,priority:row.priority,tasks:[...row.tasks]};
 renderLegacyEditContext();
}
function returnToLegacyWorklist(){
 if(!legacyWorklistEditContext)return;
 if(!canLeaveCloudForm())return;
 const uid=legacyWorklistEditContext.uid;
 legacyWorklistEditContext=null;renderLegacyEditContext();clearCloudFormDirty();
 $('cloudEditForm').hidden=true;$('cloudPanel').classList.remove('cloud-form-active');
 setCloudView('review');
 const panel=$('cloudLegacyWorklistPanel');if(panel){panel.open=true;renderLegacyWorklist();
  const item=[...($('cloudLegacyWorklistResults')?.querySelectorAll('[data-legacy-worklist-farm]')||[])].find(x=>x.dataset.legacyWorklistFarm===uid);
  (item||panel).scrollIntoView?.({block:'nearest'});
 }
 status('已返回原複查工作清單。尚未自行更新本機複查進度，也沒有變更正式核定。');
}
function saveLegacyWorklistEvidence(id){
 if(!admin||!user||!legacyEvidenceReview)return;
 const row=legacyWorklistTasks(legacyEvidenceReview.rows).find(r=>r.uid===id);if(!row)return;
 const host=$('cloudLegacyWorklistResults'),source=host?.querySelectorAll('[data-legacy-evidence-source]'),finding=host?.querySelectorAll('[data-legacy-evidence-finding]'),notes=host?.querySelectorAll('[data-legacy-evidence-note]');
 const match=(nodes,attr)=>[...(nodes||[])].find(n=>n.getAttribute(attr)===id);
 const evidence={source:match(source,'data-legacy-evidence-source')?.value||'',finding:match(finding,'data-legacy-evidence-finding')?.value||'',note:(match(notes,'data-legacy-evidence-note')?.value||'').trim().slice(0,500)};
 if(!legacyWorklistEvidenceValid(evidence)){status('請選擇查核方式、複查結論，並輸入至少 10 字的佐證摘要。',true);return;}
 const obj=legacyWorklistState(user.uid),prior=obj[id]||{};
 obj[id]={...prior,...evidence,stage:prior.signature===legacyWorklistSignature(row)?(prior.stage||'checking'):'checking',signature:legacyWorklistSignature(row),evidenceAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 try{localStorage.setItem(legacyWorklistKey(user.uid),JSON.stringify(obj));status('本機複查佐證已保存；尚未同步雲端，也不代表正式核定。');renderLegacyWorklist();renderLegacyEvidenceArchive();}catch(e){status('本機佐證儲存失敗：'+err(e),true);}
}
function saveLegacyWorklistStage(id,stage){
 if(!admin||!user||!legacyEvidenceReview||!['todo','checking','evidence','reviewed'].includes(stage))return;
 const r=legacyWorklistTasks(legacyEvidenceReview.rows).find(x=>x.uid===id);if(!r)return;
 const obj=legacyWorklistState(user.uid),old=obj[id]||{},same=old.signature===legacyWorklistSignature(r);
 if(stage==='reviewed'&&Array.isArray(legacyCloudEvidence)&&legacyEvidenceHistoryAlerts(legacyCloudEvidence,liveFarms).some(a=>a.farmUid===id)){status('此場仍有最新雲端佐證異常，請先新增有效複查佐證並重新讀取雲端歷史；原紀錄保留。',true);renderLegacyWorklist();return;}
 if(stage==='reviewed'&&(!same||!legacyWorklistEvidenceValid(old))){status('標記本機已複查前，請先儲存本筆查核方式、結論及至少 10 字的佐證摘要。',true);renderLegacyWorklist();return;}
 if(stage==='todo')delete obj[id];else obj[id]={...(same?old:{}),stage,signature:legacyWorklistSignature(r),updatedAt:new Date().toISOString()};
 try{localStorage.setItem(legacyWorklistKey(user.uid),JSON.stringify(obj));status('本機複查進度已保存（不會同步至 Firebase）。');}catch(e){status('本機儲存失敗：'+err(e),true);}
 renderLegacyWorklist();renderLegacyEvidenceArchive();
}
function exportLegacyWorklist(){
 if(!admin||!user||!legacyLockAudit||!legacyEvidenceReview){status('請先完成伺服器稽核。',true);return;}
 const cloudAlerts=!legacyCloudEvidenceBusy&&!legacyCloudEvidenceError?legacyWorklistCloudAlerts(legacyCloudEvidence,liveFarms):null;
 const rows=legacyWorklistPrioritize(legacyWorklistTasks(legacyEvidenceReview.rows),cloudAlerts),progress=legacyWorklistState(user.uid),followups=!legacyCloudEvidenceBusy&&!legacyCloudEvidenceError?legacyEvidenceFollowup(legacyCloudEvidence,liveFarms):null;
 const quote=s=>'"'+String(s??'').replace(/"/g,'""').replace(/^[=+@\-\t\r]/,'\u0027$&')+'"';
 const table=[['豬場ID','名稱','地塊','風險分類','優先級','本機進度','疑點','待辦事項','查核方式','複查結論','佐證摘要','佐證時間','本機更新時間','雲端佐證狀態','雲端異常原因','雲端處理追蹤','處理追蹤說明'],...rows.map(r=>{const p=progress[r.uid],valid=p?.signature===legacyWorklistSignature(r);return [r.uid,r.name,r.parcelKey,r.state,r.priority,valid?p.stage:'todo',r.issues.join('；'),r.tasks.join('；'),valid?p.source||'':'',valid?p.finding||'':'',valid?p.note||'':'',valid?p.evidenceAt||'':'',valid?p.updatedAt:'',cloudAlerts?(r.cloudAlert?'需重新複查':'未發現指定異常'):'尚未讀取／無法確認',r.cloudAlert?r.cloudAlert.reasons.join('；'):'',followups?(followups.get(r.uid)?.state||'沒有雲端歷史'):'尚未確認',followups?(followups.get(r.uid)?.reason||'尚無對應佐證'):'雲端佐證尚未完成讀取'];})];
 const csv='\uFEFF'+table.map(r=>r.map(quote).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='豬場舊場複查工作清單_V3.4.06.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);
 status('已匯出本次雲端稽核衍生的工作清單；本機進度非正式核定。');
}
async function runLegacyLockAudit(){
 if(!admin||!adminReady||!db||!user){status('請先以管理員登入，才能執行雲端占用稽核。',true);return;}
 const generation=++legacyLockAuditGeneration,seq=loggedInSeq,uid=user.uid;
 resetLegacyEvidenceArchive();legacyLockAuditBusy=true;legacyLockAudit=null;legacyLockEligibility=null;legacyEvidenceReview=null;legacyLockAuditError='';renderLegacyLockAudit();
 try{
  const [f,t,l,r]=await Promise.all([
   F.getDocsFromServer(F.collection(db,'farms')),
   F.getDocsFromServer(F.collection(db,'deletedFarms')),
   F.getDocsFromServer(F.collection(db,'farmApprovalLocks')),
   F.getDocsFromServer(F.collection(db,'legacyLockReviews'))
  ]);
  if(generation!==legacyLockAuditGeneration||!sameSession(seq,uid)||!admin)return;
  const toMap=snap=>new Map(snap.docs.map(doc=>[doc.id,doc.data()]));
  legacyLockAudit=auditLegacyApprovalLocks(toMap(f),toMap(t),toMap(l));
  legacyLockReviews=toMap(r);
  legacyLockEligibility=assessLegacyBackfillReadiness(toMap(f),toMap(t),toMap(l),legacyLockReviews);
  legacyEvidenceReview=assessLegacyEvidenceQuality(toMap(f),toMap(t),toMap(l),legacyLockReviews,legacyLockEligibility);
  legacyEvidenceLimit=100;
  legacyLockAuditLimit=100;
 }catch(e){if(generation===legacyLockAuditGeneration&&sameSession(seq,uid)){legacyLockAuditError=err(e);legacyLockAudit=null;status('占用稽核未完成：'+legacyLockAuditError,true);}}
 finally{if(generation===legacyLockAuditGeneration&&sameSession(seq,uid)){legacyLockAuditBusy=false;renderLegacyLockAudit();}}
}

// V3.3.96: immutable *human historical confirmation*, deliberately NOT a
// farmApprovalLocks document. Old imports may have no unique parcel identity.
// All preconditions are checked again inside the Firestore transaction.
async function confirmLegacyLockHistory(farmUid){
 if(legacyReviewBusy||!admin||!adminReady||!user||!db){status('請先以管理員登入並完成伺服器稽核。',true);return;}
 const audit=legacyLockAudit;
 const candidate=audit?.findings.find(x=>x.type==='legacy'&&x.uid===farmUid);
 if(!candidate||legacyLockReviews.has(farmUid)){status('此豬場不是待確認的早期正式名冊，或已有確認紀錄。請重新稽核。',true);return;}
 const reason=clean(prompt('請說明這筆早期豬場的歷史查核依據（10–500 字）。注意：本次只建立確認紀錄，不會建立正式占用鎖：')||'',500);
 if(reason.length<10){status('確認理由至少需 10 字。本次未修改任何資料。',true);return;}
 if(!confirm('確定為「'+candidate.name+'」新增不可覆寫的歷史人工確認紀錄？不會變更原豬場，也不會建立占用鎖。'))return;
 const seq=loggedInSeq,uid=user.uid;
 legacyReviewBusy=true;
 try{
  const farmRef=F.doc(db,'farms',farmUid),tombRef=F.doc(db,'deletedFarms',farmUid),reviewRef=F.doc(db,'legacyLockReviews',farmUid);
  const matchingLocks=[...legacyLockAudit.findings].filter(x=>x.uid===farmUid&&x.target==='lock');
  if(matchingLocks.length)throw Error('這筆豬場有占用關聯警示，不適合以早期缺漏方式確認');
  // An external lock created since the previous audit cannot be reliably
  // inferred from a farm document; require a fresh server-wide lock scan.
  const currentLocks=await F.getDocsFromServer(F.collection(db,'farmApprovalLocks'));
  if(currentLocks.docs.some(d=>d.data().farmUid===farmUid))throw Error('伺服器已存在關聯占用紀錄，請重新稽核');
  const accepted=await F.runTransaction(db,async tx=>{
   const [farm,tomb,review]=await Promise.all([tx.get(farmRef),tx.get(tombRef),tx.get(reviewRef)]);
   if(!farm.exists()||tomb.exists()||review.exists())throw Error('正式豬場已變更、刪除或已有歷史確認紀錄');
   const data=farm.data();
   if(farmUid.startsWith('submitted-')||data.approvalLockId)throw Error('只允許沒有占用的早期匯入豬場');
   if(!Number.isInteger(data.version)||data.version<1)throw Error('正式豬場版本異常，請先核對');
   tx.set(reviewRef,{farmUid,farmName:clean(data.name,150),farmVersion:data.version,parcelKey:clean(data.auditParcelKey||'',160),reason,reviewerUid:uid,reviewedAt:F.serverTimestamp(),reviewType:'legacy_history_only'});
   return {version:data.version};
  });
  if(!sameSession(seq,uid))return;
  const verified=await checkCommittedDocuments('早期歷史人工確認：'+farmUid,[{collection:'legacyLockReviews',id:farmUid,expected:{farmUid,farmVersion:accepted.version,reason,reviewerUid:uid,reviewType:'legacy_history_only'}}]);
  // A fresh scan also refreshes immutable confirmation records.
  await runLegacyLockAudit();
  status(verified?'已建立歷史人工確認紀錄並從伺服器核對；沒有建立正式占用鎖。':'雲端交易已提交，但讀回未確認；請重新稽核，不要重複提交。',!verified);
 }catch(e){status('歷史確認未完成：'+err(e)+'；請先重新稽核確認是否已存在紀錄，勿反覆送出。',true);}
 finally{legacyReviewBusy=false;}
}
// V3.3.94: read-only lineage browser; all details are fetched from server on demand.
// Missing historical links are reported, never reconstructed or auto-written.
function lineageEvidence(review, oldTomb,oldLock,newLock,newFarm,request){
 if(!review||!review.submissionId||!review.priorFarmUid||!review.priorLockId||!review.newLockId)return {code:'warning',text:'承接審核欄位不完整'};
 if(!oldTomb?.exists()||oldTomb.data()?.farmUid!==review.priorFarmUid)return {code:'warning',text:'原正式豬場刪除紀錄缺失或不一致'};
 if(!oldLock?.exists()||oldLock.data()?.farmUid!==review.priorFarmUid)return {code:'warning',text:'原地塊核准占用紀錄缺失或不一致'};
 if(!request?.exists())return {code:'unknown',text:'原申請未讀取到，無法完成核對'};
 const status=request.data()?.status;
 if(status==='pending')return newLock?.exists()||newFarm?.exists()?{code:'warning',text:'申請仍待審，但已有新占用或新正式豬場'}:{code:'pending',text:'原場歷史一致；新申請仍待審，尚未核准'};
 if(status!=='approved')return {code:'warning',text:'申請為 '+String(status||'未知')+'，與承接核准流程不一致'};
 if(!newLock?.exists()||newLock.data()?.farmUid!=='submitted-'+review.submissionId||newLock.data()?.submissionId!==review.submissionId)return {code:'warning',text:'新核准占用紀錄缺失或不一致'};
 if(newFarm?.exists())return {code:'ok',text:'已核准：新正式豬場與新舊占用及刪除歷史一致'};
 return {code:'unknown',text:'原案件已核准，新正式豬場目前不存在；可能已刪除，須查詢新場刪除紀錄'};
}
function renderLineageHistory(){
 const host=$('cloudLineageHistory'),summary=$('cloudLineageSummary');if(!host)return;
 const controls=$('cloudLineageControls');if(controls)controls.hidden=!admin;
 if(!admin||!user){host.innerHTML='';if(summary)summary.textContent='僅管理員可查看重新設立沿革。';return;}
 if(!resolutionHistoryLoaded||lineageLoadError){host.innerHTML='';if(summary)summary.textContent=lineageLoadError?'重新設立審核紀錄無法確認：'+lineageLoadError:resolutionsLoadError?'歷史載入失敗：'+resolutionsLoadError:'正在從伺服器讀取重新設立審核…';return;}
 const q=clean($('cloudLineageSearch')?.value||'',150).toLocaleLowerCase(),filter=$('cloudLineageFilter')?.value||'all';
 const cases=new Map(mergeProposalRows().filter(p=>p.kind==='new').map(p=>[p.id,p]));
 const records=[...reestablishmentReviews.entries()].map(([id,r])=>({...r,submissionId:r.submissionId||id}));
 records.sort((a,b)=>(b.reviewedAt?.toMillis?.()||b.reviewedAt?.seconds*1000||0)-(a.reviewedAt?.toMillis?.()||a.reviewedAt?.seconds*1000||0));
 const matched=records.filter(r=>{
  const pending=cases.get(r.submissionId),proof=lineageDetails.get(r.submissionId);
  if(filter==='verified'&&proof?.state?.code!=='ok')return false;
  if(filter==='pending'&&proof?.state?.code!=='pending')return false;
  if(filter==='warning'&&!['warning','unknown'].includes(proof?.state?.code))return false;
  if(filter==='unchecked'&&proof)return false;
  const hay=[r.submissionId,r.priorFarmUid,r.priorLockId,r.newLockId,r.reason,r.adminUid,pending?.proposedName].join(' ').toLocaleLowerCase();
  return !q||hay.includes(q);
 });
 if(summary)summary.textContent=`伺服器已讀取 ${records.length} 筆重新設立審核｜符合條件 ${matched.length} 筆。逐筆按「核對沿革」才會向伺服器確認歷史鏈。`;
 host.innerHTML=matched.slice(0,lineageHistoryLimit).map(r=>{
  const current=lineageDetails.get(r.submissionId),state=current?.state||{code:'unchecked',text:'尚未逐筆核對伺服器歷史'};
  const date=r.reviewedAt?.toDate?.()?.toLocaleString('zh-TW',{hour12:false})||'日期尚未取得';
  const newer='submitted-'+r.submissionId;
  const known=liveFarms.get(newer),p=cases.get(r.submissionId);
  const d=current?.details;
  return `<article class="cloud-resolution-history-card" data-lineage-row="${esc(r.submissionId)}"><div><strong>${esc(p?.proposedName||known?.name||'重新設立申請')}</strong><small> · ${esc(date)}</small></div><small>新正式豬場 ID：${esc(newer)} ｜ 原場 ID：${esc(r.priorFarmUid||'—')}</small><small>原占用：${esc(r.priorLockId||'—')} ｜ 新占用：${esc(r.newLockId||'—')}</small><p>承接原因：${esc(r.reason||'—')}</p><small>審核人員 UID：${esc(r.adminUid||'—')}</small><div class="cloud-resolution-history-state" data-state="${esc(state.code)}">${esc(state.text)}</div>${d?`<small>原場名稱：${esc(d.oldName||'無資料')} ｜ 刪除時間：${esc(d.deletedAt||'無資料')} ｜ 新場：${esc(d.newName||'尚無有效正式豬場')} ｜ 申請狀態：${esc(d.caseStatus||'無法取得')}</small>`:''}<div class="cloud-resolution-history-actions"><button type="button" data-lineage-verify="${esc(r.submissionId)}">↻ 核對沿革</button>${known?`<button type="button" data-lineage-farm="${esc(newer)}">查看新正式豬場</button>`:''}${p?`<button type="button" data-lineage-case="${esc(r.submissionId)}">查看原申請</button>`:''}</div></article>`;
 }).join('')||'<p class="subtle">沒有符合條件的重新設立紀錄。</p>';
 const more=$('cloudLineageMore');if(more){more.hidden=matched.length<=lineageHistoryLimit;more.textContent=`顯示更多（尚有 ${matched.length-lineageHistoryLimit} 筆）`;}
}
async function verifyLineageHistory(id){
 if(!admin||!adminReady||!db||!user)return;
 const review=reestablishmentReviews.get(id);if(!review)return;
 const seq=loggedInSeq,uid=user.uid,generation=lineageDetailGeneration;
 try{
  const specs=[['deletedFarms',review.priorFarmUid],['farmApprovalLocks',review.priorLockId],['farmApprovalLocks',review.newLockId],['farms','submitted-'+id],['farmSubmissions',id]];
  const snaps=await Promise.all(specs.map(([c,docId])=>F.getDocFromServer(F.doc(db,c,docId))));
  if(!sameSession(seq,uid)||generation!==lineageDetailGeneration||!admin)return;
  const [oldTomb,oldLock,newLock,newFarm,request]=snaps;
  const date=oldTomb.exists()?oldTomb.data()?.deletedAt?.toDate?.()?.toLocaleString('zh-TW',{hour12:false}):null;
  lineageDetails.set(id,{state:lineageEvidence(review,oldTomb,oldLock,newLock,newFarm,request),details:{oldName:oldTomb.exists()?oldTomb.data()?.name:'',deletedAt:date,newName:newFarm.exists()?newFarm.data()?.name:'',caseStatus:request.exists()?request.data()?.status:''}});
  renderLineageHistory();
 }catch(e){if(sameSession(seq,uid)&&generation===lineageDetailGeneration){lineageDetails.set(id,{state:{code:'unknown',text:'伺服器讀取失敗：'+err(e)+'；不能認定紀錄不存在'}});renderLineageHistory();}}
}
function resolutionLabel(p){
 if(!admin||p.kind!=='new')return '';
 const r=submissionResolutions.get(p.id);
 if(!r)return resolutionsLoadError?`<small class="cloud-resolution-note">判定紀錄讀取失敗：${esc(resolutionsLoadError)}</small>`:'';
 const title=r.mode==='link_existing'?'已關聯既有正式豬場':r.mode==='distinct'?'已註記不同經營者':'人工判定';
 return `<div class="cloud-resolution-note"><strong>${title}</strong> · ${esc(r.farmUid||'無關聯 ID')}<small>理由：${esc(r.reason||'—')} · 管理員 ${esc(r.adminUid||'')}</small></div>`;
}
function resolutionActions(p,rows){
 if(!admin||p.kind!=='new'||p.status!=='pending'||submissionResolutions.has(p.id))return '';
 const m=proposalDuplicatePreview(p,rows);
 if(!m.farms.length)return '';
 const options=m.farms.slice(0,20).map(f=>`<option value="${esc(f.uid)}">${esc(f.name||f.uid)} · ${esc(f.uid)}</option>`).join('');
 return `<div class="cloud-resolution-actions"><label>人工判定關聯豬場 <select data-resolution-target="${esc(p.id)}"><option value="">選擇既有正式豬場</option>${options}</select></label><button type="button" data-resolution-link="${esc(p.id)}">確認已有豬場（結案）</button><button type="button" data-resolution-distinct="${esc(p.id)}">確認不同經營者（保留待審）</button><small>每次判定須填寫理由；「不同經營者」只是解除已確認候選的預警阻擋，不等於自動核准。</small></div>`;
}
async function adjudicateSubmission(id,mode){
 if(!admin||!adminReady||!db||!user||!['link_existing','distinct'].includes(mode))return;
 const p=mergeProposalRows().find(q=>q.kind==='new'&&q.id===id&&q.status==='pending');if(!p)return;
 const node=[...$('cloudProposals').querySelectorAll('[data-proposal-row]')].find(x=>x.dataset.proposalRow===id);
 const targetUid=node?.querySelector('[data-resolution-target]')?.value||'';
 const reason=clean(prompt(mode==='link_existing'?'請說明為何認定這筆申請屬於既有豬場（必填，最多 500 字）：':'請說明為何判定是不同經營者（必填，最多 500 字）：')||'',500);
 if(!reason){status('未填寫判定理由，沒有修改任何紀錄。',true);return;}
 if(!targetUid){status('請先選擇一筆要核對的既有正式豬場。',true);return;}
 // The preview may be stale. Recheck both the submission and candidate on the server.
 try{
  const [candidateSnap,allMatches]=await Promise.all([F.getDocFromServer(F.doc(db,'farms',targetUid)),checkApprovalDuplicatesOnServer(p)]);
  if(!candidateSnap.exists()||!allMatches.some(f=>f.uid===targetUid))throw Error('所選豬場已不在最新疑似關聯清單，請重新同步後判定。');
  if(mode==='distinct'&&allMatches.length>20)throw Error('候選超過 20 筆，請先人工縮小範圍，不可直接略過去重。');
  const matchedUids=allMatches.map(f=>f.uid).sort();
  if(!confirm(mode==='link_existing'?`確定把「${p.proposedName}」關聯至「${candidateSnap.data().name}」並結束本件送審？不更改正式豬場資料。`:`確定記錄「${p.proposedName}」與「${candidateSnap.data().name}」為不同經營者？案件仍保持待審，後續核准前仍會檢查新出現的重複候選。`))return;
  const ref=F.doc(db,'farmSubmissions',id),record=F.doc(db,'submissionResolutions',id),seq=loggedInSeq,uid=user.uid;
  await F.runTransaction(db,async tx=>{
   const [caseSnap,resSnap,farmSnap]=await Promise.all([tx.get(ref),tx.get(record),tx.get(F.doc(db,'farms',targetUid))]);
   if(!caseSnap.exists()||caseSnap.data().status!=='pending')throw Error('案件已處理，不可重複判定');
   if(resSnap.exists())throw Error('本案已有人工判定紀錄，為避免覆蓋請重新同步。');
   if(!farmSnap.exists())throw Error('既有豬場已被移除');
   tx.set(record,{submissionId:id,mode,farmUid:targetUid,matchedUids,reason,adminUid:uid,reviewedAt:F.serverTimestamp()});
   if(mode==='link_existing')tx.update(ref,{status:'rejected',reviewedBy:uid,reviewedAt:F.serverTimestamp()});
  });
  if(!sameSession(seq,uid))return;
  const checks=[{collection:'submissionResolutions',id,expected:{submissionId:id,mode,farmUid:targetUid,reason,adminUid:uid}}];
  if(mode==='link_existing')checks.push({collection:'farmSubmissions',id,expected:{status:'rejected',reviewedBy:uid}});
  const verified=await checkCommittedDocuments('人工判定：'+id,checks);
  await loadSubmissionResolutions();await reconcilePendingFromServer();
  status(mode==='link_existing'?'已關聯既有豬場，申請以「不採納新增」結案；正式豬場未修改。':'已註記不同經營者，案件仍待審，請另行核准。'+(verified?' 伺服器讀回已確認。':' 讀回尚未確認，請先重新驗證。'),!verified);
 }catch(e){status('人工判定未完成：'+err(e)+'；請同步後確認是否已建立判定紀錄，勿直接重複操作。',true);}
}
// V3.4.09: keep review/map handoff local to this browser; never treat a map preview as approval.
let proposalListFilter='pending',proposalSearchTerm='',proposalDuplicateFilter='all',mapReviewReturnId='';
// V3.4.11: read-only administrator triage summary; never substitutes for server-side duplicate guard.
function proposalMatchReasons(p,other){
 const reasons=[];
 const parcel=clean(p.parcelKey,160),otherParcel=clean(other.auditParcelKey??other.parcelKey,160);
 if(parcel&&otherParcel&&parcel===otherParcel)reasons.push('相同 F03 地塊');
 const lat=p.proposedLat==null?NaN:Number(p.proposedLat),lng=p.proposedLng==null?NaN:Number(p.proposedLng);
 const otherLat=(other.lat??other.proposedLat),otherLng=(other.lng??other.proposedLng);
 if(Number.isFinite(lat)&&Number.isFinite(lng)&&otherLat!=null&&otherLng!=null&&sameFarmPlace({lat:otherLat,lng:otherLng},lat,lng))reasons.push('位置相距約 8 公尺內');
 const n=clean(p.proposedName,150).toLocaleLowerCase(),on=clean(other.name??other.proposedName,150).toLocaleLowerCase();
 const a=clean(p.proposedAddress,220).replace(/\s+/g,'').toLocaleLowerCase(),oa=clean(other.address??other.proposedAddress,220).replace(/\s+/g,'').toLocaleLowerCase();
 const county=clean(other.county??other.proposedCounty,40),town=clean(other.town??other.proposedTown,40);
 if(n&&a&&on===n&&oa===a&&county===clean(p.proposedCounty,40)&&town===clean(p.proposedTown,40))reasons.push('同鄉鎮、同名且同地址');
 return reasons;
}
function proposalTriage(p,rows){
 if(p.kind!=='new'||p.status!=='pending')return {level:'none',label:'非新增待審',matches:{farms:[],pending:[]}};
 const matches=proposalDuplicatePreview(p,rows);
 const reasons=[...matches.farms,...matches.pending.map(x=>({...x,auditParcelKey:x.parcelKey}))].flatMap(x=>proposalMatchReasons(p,x));
 const high=reasons.some(x=>x==='相同 F03 地塊'||x==='位置相距約 8 公尺內');
 const level=!reasons.length?'clear':high?'high':'review';
 return {level,label:high?'優先核對：相同地塊或近距離':level==='review'?'確認同名同地址':'未發現疑似重複',matches};
}
function reviewDisplayRows(rows,filter=proposalListFilter,term=proposalSearchTerm){
 const needle=String(term||'').trim().toLocaleLowerCase();
 return [...rows].filter(p=>{
  if(filter==='pending'&&p.status!=='pending')return false;
  if(filter==='closed'&&p.status==='pending')return false;
  if(needle&&![p.proposedName,p.proposedAddress,p.proposedCounty,p.proposedTown,p.id,p.farmUid,p.note].join(' ').toLocaleLowerCase().includes(needle))return false;
  if(admin&&proposalDuplicateFilter!=='all'){
   const risky=proposalTriage(p,rows).level;
   if(proposalDuplicateFilter==='risk'&&!['high','review'].includes(risky))return false;
   if(proposalDuplicateFilter==='clear'&&risky!=='clear')return false;
  }
  return true;
 }).sort((a,b)=>{
  const pending=Number(b.status==='pending')-Number(a.status==='pending');if(pending)return pending;
  if(admin&&a.status==='pending'&&b.status==='pending'){
   const rank={high:3,review:2,clear:1,none:0};const risk=(rank[proposalTriage(b,rows).level]||0)-(rank[proposalTriage(a,rows).level]||0);
   if(risk)return risk;
  }
  return sec(b.submittedAt)-sec(a.submittedAt)||String(b.id).localeCompare(String(a.id));
 });
}
function focusProposalOnMap(id){
 if(!admin||!adminReady)return status('只有已驗證管理員可以從待審清單進行地圖查核。',true);
 const p=mergeProposalRows().find(x=>x.id===id&&x.status==='pending');
 if(!p)return status('這筆待審案件已不存在或狀態已變更，請重新整理。',true);
 const lat=Number(p.proposedLat),lng=Number(p.proposedLng);
 if(p.proposedLat==null||p.proposedLng==null||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<21||lat>27||lng<118||lng>123){
  return status('申請未提供有效的台灣 WGS84 座標，無法直接定位；請先要求補充位置。',true);
 }
 if(!canLeaveCloudForm())return;
 if(!hook?.focusSubmissionPoint?.({lat,lng,name:p.proposedName||'待審位置',farmUid:p.farmUid||''}))return status('地圖尚未就緒，無法定位；請確認圖資載入後重試。',true);
 mapReviewReturnId=id;
 close();
 const back=$('cloudReturnReviewMap');if(back){back.hidden=false;back.textContent='↩ 返回待審：'+clean(p.proposedName||'這筆豬場',30);}
 status('已定位申請位置。請比對雙圖與附近正式豬場；地圖查核本身不會核准案件。');
}
function returnFromProposalMap(){
 const id=mapReviewReturnId;mapReviewReturnId='';hook?.clearSubmissionPoint?.();const back=$('cloudReturnReviewMap');if(back)back.hidden=true;
 open();setCloudView('review');proposalListFilter='pending';
 if($('cloudProposalFilter'))$('cloudProposalFilter').value='pending';
 // Do not overwrite the user's search unless it hides the item being reviewed.
 if(!reviewDisplayRows(mergeProposalRows()).some(x=>x.id===id)){
  proposalSearchTerm='';if($('cloudProposalSearch'))$('cloudProposalSearch').value='';
 }
 renderProposals();
 const row=[...($('cloudProposals')?.querySelectorAll('[data-proposal-row]')||[])].find(x=>x.dataset.proposalRow===id);
 if(row){row.scrollIntoView({block:'center',behavior:'smooth'});row.classList.add('cloud-duplicate-highlight');setTimeout(()=>row.classList.remove('cloud-duplicate-highlight'),1800);}
 else status('已返回待審頁，但原案件不在目前已載入的清單，請重新讀取雲端資料。',true);
}
function renderProposalDuplicatePreview(p,rows){
 if(!admin||p.kind!=='new'||p.status!=='pending')return '';
 const triage=proposalTriage(p,rows), matches=triage.matches;
 const count=matches.farms.length+matches.pending.length;
 const certainty=farmsFromCache?'正式豬場可能來自快取，請同步後核對':'目前已載入名冊的初步比對；核准時仍重新讀取伺服器';
 if(!count)return `<div class="cloud-duplicate-preview subtle"><strong>初步未見疑似重複</strong><small>${esc(certainty)}；仍可能有未載入資料。</small></div>`;
 const reasonText=(other)=>proposalMatchReasons(p,other).join('、')||'可能關聯，待核對';
 const farmButtons=matches.farms.slice(0,5).map(f=>`<button type="button" class="cloud-duplicate-link" data-duplicate-farm="${esc(f.uid)}" title="查看既有正式豬場">${esc(f.name||f.uid)}（正式）<small>${esc(reasonText(f))}</small></button>`).join('');
 const pendingButtons=matches.pending.slice(0,5).map(q=>`<button type="button" class="cloud-duplicate-link" data-duplicate-pending="${esc(q.id)}" title="跳至相似待審案件">${esc(q.proposedName||q.id)}（待審）<small>${esc(reasonText(q))}</small></button>`).join('');
 return `<div class="cloud-duplicate-preview" role="note" data-triage-level="${esc(triage.level)}"><strong>⚠ 疑似關聯｜${esc(triage.label)}｜正式 ${matches.farms.length} 筆／其他待審 ${matches.pending.length} 筆</strong><small>候選原因如下，僅提示而非確認重複，不會自動合併或刪除。</small><div class="cloud-duplicate-links">${farmButtons}${pendingButtons}</div><small>${esc(certainty)}。</small></div>`;
}
function renderProposals(){const box=$('cloudProposals');if(!box)return;
 renderResolutionHistory();
 if(!user){box.innerHTML='<p class="subtle">登入後可查看自己的申請及審核結果；管理員可查看待審清單。</p>';return;}
 const combined=mergeProposalRows();
 const pendingState=pendingSummary();
 const ownerAwaiting=!admin&&(ownerSubmissionCache.new||ownerSubmissionCache.edit||ownerSubmissionError.new||ownerSubmissionError.edit||farmsFromCache);
 const shown=reviewDisplayRows(combined);
 const triageCounts=admin?combined.filter(p=>p.kind==='new'&&p.status==='pending').reduce((acc,p)=>{const level=proposalTriage(p,combined).level;acc[level]=(acc[level]||0)+1;return acc;},{high:0,review:0,clear:0}):null;
 const sum=$('cloudProposalListSummary');if(sum)sum.textContent=`清單共 ${combined.length} 筆，其中待審 ${combined.filter(p=>p.status==='pending').length} 筆；目前顯示 ${shown.length} 筆${triageCounts?'；優先核對 '+triageCounts.high+' 筆、同名同址 '+triageCounts.review+' 筆':''}${pendingState.error?'（雲端讀取異常，數量未確認）':!pendingState.ready?'（等待伺服器確認）':''}`;
 box.innerHTML=(!admin&&ownerAwaiting?'<p class="subtle" role="status">申請案件／正式地圖尚未全部取得伺服器確認；目前可能是本機快取，不能據此判定核准結果。請連線後重新開啟或使用「從雲端重新驗證」。</p>':'')+(admin&&!pendingState.ready?'<p class="subtle">正在讀取全部待審案件，清單可能尚未完整。</p>':'')+(admin&&pendingState.error?'<p class="subtle">待審資料讀取失敗，請確認 Firebase 權限。統計暫不顯示 0。</p>':'')+(shown.length?shown.map(p=>`<article class="cloud-proposal" data-proposal-row="${esc(p.id)}"><div><strong>${esc(p.proposedName||p.farmUid)}</strong><small> ${esc(p.status==='approved'?(p.kind==='new'?(liveFarms.has('submitted-'+p.id)&&!farmsFromCache?'已核准・正式地圖已確認':'已核准・正式地圖待同步'):'已採納'):p.status==='rejected'?'未採納':'待確認')} · ${esc(proposalDate(p.submittedAt))}</small></div><div>${esc(p.proposedCounty)} ${esc(p.proposedTown)} · ${esc(p.proposedAddress)}</div><small>座標：${p.proposedLat===null?'未提供':esc(p.proposedLat)}, ${p.proposedLng===null?'未提供':esc(p.proposedLng)}</small>${p.note?`<small>依據：${esc(p.note)}</small>`:''}${p.kind==='new'?'<small>新增豬場申請</small>':''}${renderProposalDuplicatePreview(p,combined)}${resolutionLabel(p)}${resolutionActions(p,combined)}${admin&&p.kind==='new'&&p.status==='pending'?`<div class="cloud-reopen-actions"><button type="button" data-reopen-review="${esc(p.id)}">已刪除豬場重新設立：核對並留存審核</button>${reestablishmentReviews.has(p.id)?`<small>已記錄承接來源：${esc(reestablishmentReviews.get(p.id).priorFarmUid)}；正式核准時仍會再核對。</small>`:''}</div>`:''}${admin&&p.status==='pending'?`<div class="cloud-actions"><button type="button" data-review-map="${esc(p.id)}">⌖ 地圖核對</button><button type="button" data-approve="${esc(p.id)}" data-kind="${p.kind==='new'?'new':'edit'}">${p.kind==='new'?'核准新增':'確認採納'}</button><button type="button" data-reject="${esc(p.id)}" data-kind="${p.kind==='new'?'new':'edit'}">不採納</button></div>`:''}</article>`).join(''):'<p class="subtle">目前沒有符合篩選條件的紀錄。</p>');
}
function edit(uid){legacyWorklistEditContext=null;renderLegacyEditContext();open();clearCloudFormDirty();const r=hook?.getRecord(uid);if(!r){status('找不到此豬場紀錄',true);return;}activeFarm=uid;editBaseVersion=liveFarms.get(uid)?.version??null;setCloudView('manage');$('cloudPanel').classList.add('cloud-form-active');
 const cloud=liveFarms.get(uid)||{};
 const geo=r.geometry?.type==='Point'?r.geometry.coordinates:null;
 $('cloudFarm').textContent=(cloud.name||r.name)+' · '+(cloud.town||r.town||'鄉鎮待查')+' · '+uid;
 $('cloudName').value=cloud.name??r.name;
 $('cloudCounty').value=cloud.county??r.county;
 $('cloudTown').value=cloud.town??r.town;
 $('cloudAddress').value=cloud.address??r.address;
 $('cloudLat').value=cloud.lat??(geo?geo[1]:'');$('cloudLng').value=cloud.lng??(geo?geo[0]:'');
 ++addressLookupTokens.edit;if($('cloudAddressStatus'))$('cloudAddressStatus').textContent='原有地址不會被自動覆蓋；可按下方按鈕重新查詢。';
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
 lookupAddress('edit');
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
// Suggested addresses are never saved without the form's normal confirmation.
// Lookup tokens prevent an older map selection from overwriting a newer point.
// Bind address buttons independently of Firebase initialization, sign-in and network status.
// Delegated event also works if the form is re-rendered.
document.addEventListener('click', event=>{
 const button=event.target.closest?.('#cloudNewAddressLookup, #cloudAddressLookup');
 if(!button)return;
 event.preventDefault();
 lookupAddress(button.id==='cloudNewAddressLookup'?'new':'edit',true);
});
const addressLookupTokens={new:0,edit:0};
function lookupAddress(kind,force=false){
 const isNew=kind==='new', prefix=isNew?'cloudNew':'cloud';
 const latEl=$(prefix+'Lat'),lngEl=$(prefix+'Lng'),countyEl=$(prefix+'County'),townEl=$(prefix+'Town'),addressEl=$(prefix+'Address');
 const statusEl=$(isNew?'cloudNewAddressStatus':'cloudAddressStatus');
 const lat=Number(latEl?.value),lng=Number(lngEl?.value);
 const serial=++addressLookupTokens[kind];
 const record=message=>{if(statusEl)statusEl.textContent=message;};
 if(!latEl?.value||!lngEl?.value||!root.PigAddressLookup?.valid(lat,lng)){
  record('先選擇臺灣地圖上的有效位置，或填入正確經緯度。');return;
 }
 const original={county:countyEl.value,town:townEl.value,address:addressEl.value};
 record('正在查詢位置的縣市、鄉鎮與道路（資料來源：OpenStreetMap）…');
 root.PigAddressLookup.lookup(lat,lng).then(result=>{
  if(serial!==addressLookupTokens[kind]||Number(latEl.value)!==lat||Number(lngEl.value)!==lng)return;
  if((!isNew&&$('cloudEditForm').hidden)||(isNew&&$('cloudNewForm').hidden))return;
  const apply=(field,value,initial,placeholder=false)=>{if(!value||field.value!==initial)return false;if(initial&&!placeholder)return false;field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));return true;};
  let updated=0;
  if(apply(countyEl,result.county,original.county,isNew&&original.county==='雲林縣'))updated++;
  if(apply(townEl,result.town,original.town))updated++;
  if(apply(addressEl,result.address,original.address))updated++;
  const location=[result.county,result.town].filter(Boolean).join('');
  record(location?`查到：${location}${result.address?'；'+(result.precision==='門牌'?'含道路門牌':'含道路名稱'):'；沒有可靠道路門牌'}。${updated?'已填入 '+updated+' 欄，請核對後送出。':'原有資料受到保護；如要改用查詢結果，請先清空對應欄位再按一次。'} 資料：© OpenStreetMap contributors`:'未取得可靠縣市鄉鎮，請手動輸入；原有內容保持不變。');
 }).catch(e=>{if(serial===addressLookupTokens[kind])record('地址查詢未完成：'+(e?.name==='AbortError'?'服務逾時':(/Failed to fetch|NetworkError|Load failed/i.test(e?.message||'')?'連線或外部服務受到阻擋':String(e?.message||'服務不可用')))+'。請手動輸入縣市鄉鎮，原資料未更動。');});
}

// Draft-only coordinate replacement. Never saves or submits automatically.
function updateDraftPoint(kind,lat,lng){
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||!root.PigAddressLookup?.valid(lat,lng))return false;
 const isNew=kind==='new';
 const form=$(isNew?'cloudNewForm':'cloudEditForm');
 if(!form||form.hidden)return false;
 const prefix=isNew?'cloudNew':'cloud';
 const latEl=$(prefix+'Lat'),lngEl=$(prefix+'Lng');
 if(!latEl||!lngEl)return false;
 ++addressLookupTokens[kind]; // Invalidate all old reverse-geocode requests.
 latEl.value=lat.toFixed(8);lngEl.value=lng.toFixed(8);
 latEl.dispatchEvent(new Event('input',{bubbles:true}));lngEl.dispatchEvent(new Event('input',{bubbles:true}));
 // A different point cannot carry a confirmed F03 parcel identity from old coordinates.
 if(auditContext){auditContext.parcelKey='';updateLinkage();}
 if(isNew){newPoint={lat,lng};if($('cloudNewParcel'))$('cloudNewParcel').textContent='已重新選擇座標；原地塊編碼已清除，請核對新位置';renderNewSubmissionPrecheck();}
 const statusEl=$(isNew?'cloudNewAddressStatus':'cloudAddressStatus');
 if(statusEl)statusEl.textContent='座標已更新。正在反查新地址；已有的手動欄位不會被覆蓋。';
 lookupAddress(kind);
 return true;
}
function beginNew(lat=null,lng=null){clearCloudFormDirty();
 open();if(!db||!user||!adminReady){status('請先登入，並等待管理員身分檢查完成，再新增或送審。',true);return false;}
 const hasCoords=lat!==null&&lng!==null;
 setCloudView('manage');
 newPoint=hasCoords?{lat:Number(lat),lng:Number(lng)}:{};
 activeFarm=null;editBaseVersion=null;$('cloudPanel').classList.add('cloud-form-active');$('cloudEditForm').hidden=true;$('cloudNewForm').hidden=false;renderUser();
 $('cloudNewDecision').value=auditContext?.decision||'pig';$('cloudNewParcel').textContent=auditContext?.parcelKey?'地塊識別：'+auditContext.parcelKey:'此點未取得 F03 地塊識別碼，將以座標建立標記';
 $('cloudNewName').value='';$('cloudNewCounty').value=hasCoords?'':'雲林縣';$('cloudNewTown').value='';$('cloudNewAddress').value='';
 $('cloudNewLat').value=hasCoords?Number(lat).toFixed(8):'';
 $('cloudNewLng').value=hasCoords?Number(lng).toFixed(8):'';
 if($('cloudNewAddressStatus'))$('cloudNewAddressStatus').textContent=hasCoords?'準備依地圖位置查詢縣市鄉鎮…':'請先在地圖選點或輸入座標';
 ++addressLookupTokens.new;if(hasCoords)lookupAddress('new');

 status(hasCoords?'已從地圖取得座標，請填入豬場名稱與地址後確認。':'請填入豬場資料與 WGS84 經緯度。');
 $('cloudLinkSearch').value='';renderLinkMatches();updateLinkage();renderNewSubmissionPrecheck();$('cloudNewName').focus();return true;
}
// The identity of a parcel/point must remain stable across clicks and reloads.
// This is NOT a server-side uniqueness guarantee against arbitrary external clients.
function stableKey(value){let h=2166136261;for(const ch of String(value)){h^=ch.codePointAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
function draftIdentity(lat,lng){
 const key=clean(auditContext?.parcelKey,160);
 return key?`audit-${stableKey(key)}-${stableKey('parcel:'+key)}`:`point-${Math.round(lat*1e6)}-${Math.round(lng*1e6)}`;
}
function sameFarmPlace(f,lat,lng){return f.lat!=null&&f.lng!=null&&Math.hypot((Number(f.lat)-lat)*110574,(Number(f.lng)-lng)*111320*Math.cos(lat*Math.PI/180))<=8;}
// V3.4.10: Local, advisory pre-submit inspection. Final writes still use
// Firestore security rules and server-side/transactional protections.
function inspectNewSubmissionDraft(draft,farms,existingSubmissions,accountUid){
 const name=String(draft.name||'').trim(),town=String(draft.town||'').trim();
 const address=String(draft.address||'').trim(),parcelKey=String(draft.parcelKey||'').trim();
 const latText=String(draft.latText??'').trim(),lngText=String(draft.lngText??'').trim();
 const lat=Number(latText),lng=Number(lngText);
 const located=!!latText&&!!lngText&&Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=21&&lat<=27&&lng>=118&&lng<=123;
 const matches=located?[...farms].filter(f=>sameFarmPlace(f,lat,lng)||(parcelKey&&f.auditParcelKey===parcelKey)):[];
 const sameName=[...farms].filter(f=>name&&town&&String(f.name||'').trim()===name&&String(f.town||'').trim()===town&&!matches.some(m=>m.uid===f.uid));
 const ownPending=located?[...existingSubmissions].filter(x=>x.submittedBy===accountUid&&x.status==='pending'&&((parcelKey&&x.parcelKey===parcelKey)||(String(x.proposedLat??'').trim()!==''&&String(x.proposedLng??'').trim()!==''&&Math.hypot((Number(x.proposedLat)-lat)*110574,(Number(x.proposedLng)-lng)*111320*Math.cos(lat*Math.PI/180))<=8))):[];
 const missing=[!name?'豬場名稱':'',!town?'鄉鎮':'',!located?'有效座標':''].filter(Boolean);
 return {located,matches,sameName,ownPending,missing,addressMissing:!address&&!parcelKey};
}
function renderNewSubmissionPrecheck(){
 const box=$('cloudNewPrecheck');if(!box)return;
 const name=clean($('cloudNewName')?.value,150),town=clean($('cloudNewTown')?.value,40);
 const report=inspectNewSubmissionDraft({name,town,address:$('cloudNewAddress')?.value,parcelKey:auditContext?.parcelKey,latText:$('cloudNewLat')?.value,lngText:$('cloudNewLng')?.value},liveFarms.values(),newSubmissions,user?.uid);
 const warnings=[];
 if(report.missing.length)warnings.push('尚需填寫：'+report.missing.join('、'));
 if(report.addressMissing)warnings.push('建議填寫地址或地號，方便管理員查證');
 if(report.matches.length)warnings.push('附近 8 公尺或相同地塊有 '+report.matches.length+' 筆正式豬場，請先搜尋連結既有豬場：'+report.matches.slice(0,3).map(f=>f.name||f.uid).join('、'));
 if(report.sameName.length)warnings.push('找到 '+report.sameName.length+' 筆同名、同鄉鎮豬場，請確認是否為原有紀錄');
 if(report.ownPending.length)warnings.push('此位置有你尚未結案的送審案件，請先在待審清單查詢');
 const available=!!user&&adminReady;
 if(!available)warnings.unshift('必須完成 Google 登入及權限確認才可正式提交');
 const latest=admin?'管理員：儲存後直接影響正式豬場資料。':'一般使用者：送出後仍須由管理員審核，不會立即新增正式豬場。';
 box.dataset.risk=report.matches.length||report.ownPending.length?'high':warnings.length?'check':'ready';
 box.innerHTML='<strong>送出前資料檢查（僅供提醒）</strong><small>'+esc(latest)+'</small>'+(warnings.length?'<ul>'+warnings.map(w=>'<li>'+esc(w)+'</li>').join('')+'</ul>':'<p>名稱、鄉鎮與座標已填寫，未在目前載入的名冊發現指定重複條件。</p>')+'<small>提示依目前已載入資料計算；不代表雲端已確認無重複。正式儲存或核准仍需伺服器驗證。</small>';
}
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
 newBusy=true;renderUser();syncEvidenceSet('writing',admin?'新增／修改正式豬場':'提交待審案件','等待 Firestore 接受寫入');status('正在向 Firestore 寫入並確認，請不要重複點擊…');
 try{
  let result;
  let readbackConfirmed=false;
  if(admin){
   const ref=F.doc(db,'farms',targetUid);
   // Transactions also recheck the server state; stale snapshots cannot create
   // the same deterministic document twice, even if Save is clicked again.
   await F.runTransaction(db,async tx=>{
    const snap=await tx.get(ref);
    const prev=snap.exists()?snap.data():null;
    // A newer farm or a deleted farm must never be silently overwritten by
    // a stale map panel, even when its location or deterministic ID matches.
    if(candidate){
      if(!prev)throw Error('原豬場已由其他裝置刪除；請同步清單，不會重新建立。');
      if(Number(prev.version)!==Number(candidate.version))
        throw Error('這筆豬場已由其他裝置更新；請先同步後重新編輯，避免覆蓋新版資料。');
    }else if(prev){
      throw Error('相同識別碼的正式豬場已存在；請同步後從清單選擇「編輯」，不會直接覆寫。');
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
   readbackConfirmed=await checkCommittedDocument('farms',targetUid,'name',{name,lat,lng},'正式豬場：'+name);
   liveFarms.set(targetUid,cloud);
   try{hook?.applyApproved([cloud],{serverConfirmed:readbackConfirmed});}catch(uiError){console.warn('新豬場已寫入雲端，但本機地圖更新失敗：',uiError);}
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
   readbackConfirmed=await checkCommittedDocument('farmSubmissions',submissionRef.id,'status','pending','待審案件：'+name);
   result={uid:'',status:'pending'};
  }
  // Server has acknowledged this create/update/submission.  A later close
  // must not warn that the successfully committed form was unsaved.
  clearCloudFormDirty();
  $('cloudNewForm').hidden=true;newPoint=null;
  let localAuditOkay=true;
  if(auditContext){
   const ctx=auditContext;auditContext=null;
   if(admin&&ctx.onSaved){
    try{localAuditOkay=(await ctx.onSaved(result))!==false;}
    catch(localError){localAuditOkay=false;console.warn('雲端寫入已成功，本機查核另行失敗：',localError);}
   }
  }
  // No later local callback may turn an acknowledged remote write into a
  // misleading 'upload failed' message. A failed read-back is NOT verified.
  const cloudMessage=admin?`豬場「${name}」已送達 Firestore（ID：${targetUid}）。`:`「${name}」已送達 Firestore 待審案件；尚未加入正式豬場。`;
  const message=cloudMessage+(readbackConfirmed?'伺服器讀回已確認。':'伺服器讀回尚未確認，請使用「從雲端重新驗證」檢查，不要直接重複送出。')+
   (!localAuditOkay?'本機地塊查核未完成保存，請保留備份。':'');
  status(message,!localAuditOkay||!readbackConfirmed);
  if(localAuditOkay&&readbackConfirmed){
   unifiedFlow=null;$('cloudUnifiedWizard').hidden=true;$('cloudPanel').hidden=true;$('cloudPanel').classList.remove('cloud-form-active');
   try{hook?.notifyApproved?.(message);if(admin)hook?.focusApproved?.(targetUid);}catch(uiError){console.warn('雲端已寫入，地圖通知未完成：',uiError);}
  }
 }catch(e){
  syncEvidenceSet('error',admin?'正式豬場儲存':'送審',String(e?.message||e),String(e?.code||'unknown'));
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
// Deleted-farm tombstones are immutable by Firestore rules. A delayed or
// cache-only snapshot must never revoke a tombstone already observed by this
// session, otherwise a removed farm can briefly reappear on the map.
function mergeDeletedIds(known, snapshot){
 const incoming=new Set(snapshot.docs.map(doc=>doc.id));
 for(const id of known)incoming.add(id);
 return incoming;
}
function subscribeDeleted(){
 if(unsubDeleted){unsubDeleted();unsubDeleted=null;}
 if(!db)return;
 unsubDeleted=F.onSnapshot(F.collection(db,'deletedFarms'),snapshot=>{
  deletedRevision++;
  deletedFarmIds=mergeDeletedIds(deletedFarmIds,snapshot);
  hook?.removeDeleted?.([...deletedFarmIds]);
  hook?.applyApproved?.(publicRows());
 },e=>status('刪除紀錄同步失敗：'+err(e),true));
}
async function deleteActiveFarm(uidOverride=null){
 if(uidOverride!==null)activeFarm=uidOverride;
 if(!admin||!adminReady||!db||!user||deleteBusy||editBusy){status('只有完成身分驗證的管理員才能刪除正式豬場。',true);return false;}
 const uid=activeFarm,record=liveFarms.get(uid);if(!record){status('正式紀錄不存在或已刪除，請重新同步。',true);return false;}
 if(farmsFromCache){status('目前仍是離線快取，無法安全刪除；請先同步雲端。',true);return false;}
 if(!confirm(`確定要刪除正式豬場「${record.name}」？\n這會同步移除地圖、清單和已匯入總數，不會刪除官方 F03 地塊。`))return false;
 const typed=prompt(`最後確認：請完整輸入「${record.name}」才能刪除。`);if(typed!==record.name){status('名稱不相符，已取消刪除。',true);return false;}
 deleteBusy=true;renderUser();syncEvidenceSet('writing','刪除正式豬場：'+record.name,'等待 Firestore 交易');status('正在刪除正式豬場並建立防重建紀錄…');
 try{await F.runTransaction(db,async tx=>{const farmRef=F.doc(db,'farms',uid),delRef=F.doc(db,'deletedFarms',uid);const farm=await tx.get(farmRef),tomb=await tx.get(delRef);if(!farm.exists())throw Error('雲端正式豬場已不存在，未執行刪除');if(tomb.exists())throw Error('此豬場已有刪除紀錄');if(Number(farm.data().version)!==Number(record.version))throw Error('資料已被其他裝置更新，請同步後再刪除');tx.set(delRef,{farmUid:uid,name:clean(farm.data().name,150),deletedBy:user.uid,deletedAt:F.serverTimestamp(),lastVersion:farm.data().version});tx.delete(farmRef);});
 // The delete transaction has committed; readback/UI errors must never
 // be reported as a failed transaction or as proof that the farm still exists.
 clearCloudFormDirty();
 const readbackConfirmed=await checkCommittedDocuments('刪除正式豬場：'+record.name,[
  {collection:'farms',id:uid,expected:null},
  {collection:'deletedFarms',id:uid,expected:{farmUid:uid,deletedBy:user.uid,lastVersion:record.version}}
 ]);
 deletedFarmIds.add(uid);liveFarms.delete(uid);activeFarm=null;
 let uiOkay=true;
 try{hook?.removeDeleted?.([uid]);hook?.notifyApproved?.(`已刪除「${record.name}」；地圖、清單與統計正在同步。`);
  $('cloudEditForm').hidden=true;$('cloudPanel').hidden=true;$('cloudPanel').classList.remove('cloud-form-active');syncIndicator();
 }catch(uiError){uiOkay=false;console.warn('正式豬場已刪除，畫面更新另行失敗：',uiError);}
 if(!readbackConfirmed||!uiOkay)status(`Firestore 已接受刪除「${record.name}」，但${!readbackConfirmed?'伺服器讀回尚未確認':'畫面尚未完整更新'}；請從雲端重新驗證，不要嘗試重複刪除。`,true);
 return true;
 }catch(e){syncEvidenceSet('error','刪除正式豬場',String(e?.message||e),String(e?.code||''));status('刪除交易失敗：'+err(e)+'。請重新同步確認資料，勿直接重複操作。',true);return false;}finally{deleteBusy=false;renderUser();}
}
function syncIndicator(){renderSyncEvidence();if(!db)return;const count=liveFarms.size;
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
 const btn=$('cloudSubmit');editBusy=true;btn.disabled=true;syncEvidenceSet('writing',admin?'修改／核定既有豬場':'提交更正','正在向 Firestore 寫入');status('正在提交至 Google Firestore…');
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
   // Optimistic concurrency: the form was opened against current.version.
   // Reject a stale edit instead of applying its values to the latest server version.
   if(editBaseVersion===null||Number(x.version)!==Number(editBaseVersion))
     throw Error('這筆豬場已在另一台裝置或視窗更新；請先同步並重新開啟編輯，不會覆蓋新的修改。');
   updated={...x,uid:activeFarm,name:proposedName,county:proposedCounty,town:proposedTown,
    address:payload.proposedAddress,lat:la,lng:lo,version:Number(x.version||1)+1};
   const changes={name:updated.name,county:updated.county,town:updated.town,
    address:updated.address,lat:updated.lat,lng:updated.lng,version:updated.version,
    updatedAt:F.serverTimestamp()};
   if(decision){changes.auditDecision=decision;changes.auditParcelKey=parcelKey;
    updated.auditDecision=decision;updated.auditParcelKey=parcelKey;}
   tx.update(ref,changes);
  });
  const readbackConfirmed=await checkCommittedDocument('farms',activeFarm,'name',{name:proposedName,lat:la,lng:lo},'修改／核定：'+proposedName);
  // Immediately update the existing row (no appended farm record).
  // Firestore transaction has committed. Reset the local edit warning even
  // when the separate optional local-audit snapshot subsequently fails.
  clearCloudFormDirty();
  liveFarms.set(activeFarm,updated);
  let uiOkay=true;
  try{hook?.applyApproved?.(publicRows());renderExistingApprovalStatus();}
  catch(uiError){uiOkay=false;console.warn('正式豬場已寫入，地圖／介面更新失敗：',uiError);}
  const ctx=auditContext;
  let localAuditOk=true;
  if(ctx?.onSaved){try{localAuditOk=(await ctx.onSaved({uid:activeFarm,status:'approved',decision:decision||updated.auditDecision||'pig',parcelKey}))!==false;}catch(localError){localAuditOk=false;console.warn('既有豬場已寫入雲端，但本機查核保存失敗：',localError);}}
  auditContext=null;
  const confirmed=readbackConfirmed&&localAuditOk&&uiOkay;
  const message=(decision?'原豬場已送達 Firestore 並核定':'原豬場修改已送達 Firestore')+
   (readbackConfirmed?'；伺服器讀回已確認':'；伺服器讀回尚未確認，請不要重複儲存')+
   (!localAuditOk?'；本機地塊查核未完成保存':'')+
   (!uiOkay?'；畫面更新尚未完成':'');
  status(message,!confirmed);
  try{updateLinkage(parcelKey);}catch(uiError){uiOkay=false;status(message+'；連結畫面更新尚未完成，請重新整理。',true);console.warn('已儲存正式資料，但連結畫面更新失敗：',uiError);}
  if(readbackConfirmed&&localAuditOk&&uiOkay){$('cloudEditForm').hidden=true;$('cloudPanel').classList.remove('cloud-form-active');
   try{hook?.notifyApproved?.((decision?'已核定':'已更新')+'原豬場「'+proposedName+'」；不會新增第二筆。');
    hook?.focusApproved?.(activeFarm);}catch(uiError){console.warn('已儲存正式資料，但地圖聚焦失敗：',uiError);}unifiedFlow=null;}
 }else{const suggestedRef=await F.addDoc(F.collection(db,'suggestions'),payload);
  clearCloudFormDirty();
  const verified=await checkCommittedDocument('suggestions',suggestedRef.id,'status','pending','既有豬場修改建議');
  status('修改建議已送達 Firestore，核准後才更改正式地圖。'+(verified?'伺服器讀回已確認。':'伺服器讀回尚未確認；請不要直接重複送出。'),!verified);
  if(verified){$('cloudEditForm').hidden=true;auditContext=null;unifiedFlow=null;}
 }}
 catch(e){syncEvidenceSet('error','修改／核定既有豬場',String(e?.message||e),String(e?.code||''));status('提交失敗：'+err(e)+'；請不要當成已成功同步。',true);}finally{editBusy=false;renderUser();}
}
async function review(id,approve,kind='edit'){if(kind==='new')return reviewNew(id,approve);if(!admin||!adminReady||!user||!db)return;const p=mergeProposalRows().find(x=>x.id===id&&x.kind==='edit');if(!p||p.status!=='pending')return;
 if(!confirm(`確定${approve?'採納':'退回'}「${p.proposedName}」的修改嗎？`))return;
 syncEvidenceSet('writing','審核修改建議','正在提交審核結果');
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
 });const verified=await checkCommittedDocuments('審核修改建議：'+id,[
  {collection:'suggestions',id,expected:{status:approve?'approved':'rejected',reviewedBy:user.uid}},
  ...(approve?[{collection:'farms',id:p.farmUid,expected:{approvedSuggestionId:id,name:p.proposedName,county:p.proposedCounty,town:p.proposedTown,address:p.proposedAddress,lat:p.proposedLat,lng:p.proposedLng,version:p.baseVersion+1}}]:[])
 ]);
 const sync=typeof reconcileReviewAfterCommit==='function'?await reconcileReviewAfterCommit({kind:'edit',id,approved:approve,farmUid:p.farmUid,verified}):null;
 const pendingRefresh=sync?{ok:sync.pendingOk}:await reconcilePendingFromServer();
 status((approve?'修改建議交易已採納。':'修改建議交易已退回。')+(verified?'伺服器交易讀回已確認。':'伺服器交易讀回尚未確認。')+(sync?(sync.ok?' 正式名冊、地圖和待審數已同步核對。':' 畫面或待審數尚未完整確認，請使用同步驗證；勿重複提交。'):(pendingRefresh.ok?' 待審數已重新核對。':' 待審數尚未確認，請重新同步。')),!verified||!(sync?sync.ok:pendingRefresh.ok));}
 catch(e){syncEvidenceSet('error','審核案件',String(e?.message||e),String(e?.code||''));status('審核交易失敗：'+err(e)+'；請先同步再決定是否重試。',true);}
}
// Approval guard: inspect the authoritative full farm roster rather than just the
// new submission's deterministic ID. A shared parcel can legitimately contain
// several operators, so collisions require manual resolution, never auto-merge.
function approvalDuplicateCandidates(proposal,farms){
 const parcel=clean(proposal.parcelKey,160),name=clean(proposal.proposedName,150).toLocaleLowerCase(),
  county=clean(proposal.proposedCounty,40),town=clean(proposal.proposedTown,40),
  address=clean(proposal.proposedAddress,220).replace(/\s+/g,'').toLocaleLowerCase(),
  lat=Number(proposal.proposedLat),lng=Number(proposal.proposedLng);
 return farms.filter(f=>{
  if(!f||!f.uid)return false;
  if(parcel&&clean(f.auditParcelKey,160)===parcel)return true;
  if(Number.isFinite(lat)&&Number.isFinite(lng)&&sameFarmPlace(f,lat,lng))return true;
  const sameName=clean(f.name,150).toLocaleLowerCase()===name;
  const sameArea=clean(f.county,40)===county&&clean(f.town,40)===town;
  const sameAddress=address&&clean(f.address,220).replace(/\s+/g,'').toLocaleLowerCase()===address;
  return sameName&&sameArea&&!!sameAddress;
 });
}
async function checkApprovalDuplicatesOnServer(proposal){
 // The query is intentionally unbounded: a limited/latest-50 result could miss
 // an older existing farm. A failed read must block approval (fail closed).
 const snapshot=await F.getDocsFromServer(F.collection(db,'farms'));
 const farms=snapshot.docs.map(doc=>({uid:doc.id,...doc.data()}));
 return approvalDuplicateCandidates(proposal,farms);
}
// V3.3.93: each ordinary approval for the same F03 parcel competes for the
// same immutable document inside its Firestore transaction. A point-only
// application uses a small location bucket, which is a heuristic, not a
// cadastral uniqueness guarantee. A human-adjudicated distinct operator has
// an explicit separate lock and can never bypass the server duplicate review.
function approvalLockFor(p,distinct=false){
 const key=clean(p?.parcelKey,160);
 if(distinct)return {id:'distinct-'+stableKey('distinct:'+p.id),key:'distinct:'+p.id};
 if(key)return {id:'parcel-'+stableKey('parcel:'+key),key:'parcel:'+key};
 const lat=Number(p?.proposedLat),lng=Number(p?.proposedLng);
 if(!Number.isFinite(lat)||!Number.isFinite(lng))throw Error('無法建立核准占用識別：座標無效');
 const cell=`${Math.round(lat*10000)}:${Math.round(lng*10000)}`;
 return {id:'point-'+stableKey('point:'+cell),key:'point:'+cell};
}
// V3.3.93: explicit, immutable lineage review for a deleted approved farm.
// This NEVER deletes the old tombstone or reuses the original lock.
async function reviewReestablishment(id){
 if(!admin||!adminReady||!user||!db)return;
 const p=mergeProposalRows().find(x=>x.id===id&&x.kind==='new'&&x.status==='pending');if(!p)return;
 const previousUid=clean(prompt('請輸入已刪除的原正式豬場 ID（不是名稱）：')||'',100);
 if(!previousUid)return;
 const reason=clean(prompt('請說明重新設立依據、原場刪除原因與新經營者關係（必填，最多 500 字）：')||'',500);
 if(!reason){status('未填寫承接理由，沒有寫入審核紀錄。',true);return;}
 const original=approvalLockFor(p,false),newLock={id:'reopen-'+original.id,key:'reopen:'+original.key};
 try{
  const [oldLock,tomb,existingReview,currentMatches]=await Promise.all([
   F.getDocFromServer(F.doc(db,'farmApprovalLocks',original.id)),
   F.getDocFromServer(F.doc(db,'deletedFarms',previousUid)),
   F.getDocFromServer(F.doc(db,'farmReestablishmentReviews',id)),
   checkApprovalDuplicatesOnServer(p)]);
  if(existingReview.exists())throw Error('本案已有重新設立審核紀錄，不能覆寫');
  if(!oldLock.exists()||oldLock.data().farmUid!==previousUid)throw Error('原豬場與地塊占用紀錄不相符，或舊場沒有新版占用資料；請改以人工查核處理');
  if(!tomb.exists()||tomb.data().farmUid!==previousUid)throw Error('找不到原豬場的正式刪除紀錄，已停止承接');
  if(currentMatches.length)throw Error('同地塊或附近仍有正式豬場，請先完成疑似重複人工判定，不能直接用重新設立略過');
  if(!confirm('確認原場「'+(tomb.data().name||previousUid)+'」已刪除，並為「'+p.proposedName+'」建立不可覆寫的重新設立審核紀錄？這一步不會直接核准。'))return;
  const ref=F.doc(db,'farmReestablishmentReviews',id),sRef=F.doc(db,'farmSubmissions',id);
  await F.runTransaction(db,async tx=>{
   const [ps,rs,ls,ts,newLockSnap]=await Promise.all([tx.get(sRef),tx.get(ref),tx.get(F.doc(db,'farmApprovalLocks',original.id)),tx.get(F.doc(db,'deletedFarms',previousUid)),tx.get(F.doc(db,'farmApprovalLocks',newLock.id))]);
   if(!ps.exists()||ps.data().status!=='pending'||ps.data().parcelKey!==p.parcelKey)throw Error('待審案件已改變');
   if(rs.exists()||newLockSnap.exists())throw Error('已有承接審核或核准占用紀錄');
   if(!ls.exists()||ls.data().farmUid!==previousUid||!ts.exists())throw Error('原豬場刪除或占用紀錄不相符');
   tx.set(ref,{submissionId:id,priorFarmUid:previousUid,priorLockId:original.id,newLockId:newLock.id,reason,adminUid:user.uid,reviewedAt:F.serverTimestamp()});
  });
  const ok=await checkCommittedDocuments('重新設立人工審核：'+id,[{collection:'farmReestablishmentReviews',id,expected:{submissionId:id,priorFarmUid:previousUid,priorLockId:original.id,newLockId:newLock.id,reason}}]);
  await loadSubmissionResolutions();status('已記錄重新設立審核；本次尚未核准。'+(ok?' 伺服器讀回已確認。':' 讀回未確認，請勿重複提交。'),!ok);
 }catch(e){status('重新設立審核未完成：'+err(e),true);}
}
async function reviewNew(id,approve){
 if(!admin||!adminReady||!db||!user)return;
 const p=mergeProposalRows().find(x=>x.id===id&&x.kind==='new');if(!p||p.status!=='pending')return;
 if(!confirm(`確定${approve?'核准建立':'退回'}「${p.proposedName}」？`))return;
 syncEvidenceSet('writing','審核新增豬場','正在提交審核結果');
 try{
  let adjudicatedDistinct=false,reestablishment=null;
  let matches=[];
  if(approve){
   matches=await checkApprovalDuplicatesOnServer(p);
   const reviewSnap=await F.getDocFromServer(F.doc(db,'farmReestablishmentReviews',id));
   if(reviewSnap.exists()){
    const r=reviewSnap.data(),base=approvalLockFor(p,false);
    if(r.submissionId!==id||r.priorLockId!==base.id||r.newLockId!=='reopen-'+base.id||!r.reason)throw Error('重新設立審核資料與申請地塊不符');
    const [deleted,previousLock]=await Promise.all([F.getDocFromServer(F.doc(db,'deletedFarms',r.priorFarmUid)),F.getDocFromServer(F.doc(db,'farmApprovalLocks',r.priorLockId))]);
    if(!deleted.exists()||!previousLock.exists()||previousLock.data().farmUid!==r.priorFarmUid)throw Error('原豬場刪除／占用資料無法確認');
    if(matches.length)throw Error('重新設立審核後仍發現正式豬場，請先人工核對，不能略過去重');
    if(!confirm('此案已有人工重新設立審核，原刪除紀錄會永久保留。確定核准新豬場？'))return;
    reestablishment=r;
   }
   if(matches.length){
    let authorizedDistinct=false;
    try{
     const resolution=await F.getDocFromServer(F.doc(db,'submissionResolutions',id));
     const d=resolution.exists()?resolution.data():null;
     authorizedDistinct=!!(d&&d.submissionId===id&&d.mode==='distinct'&&Array.isArray(d.matchedUids)&&d.matchedUids.includes(d.farmUid)&&matches.every(f=>d.matchedUids.includes(f.uid))&&d.reason&&d.adminUid);
    }catch(e){throw Error('無法向伺服器確認人工判定紀錄，已停止核准：'+err(e));}
    if(!authorizedDistinct){
    status('暫停核准：伺服器正式名冊中已有 '+matches.length+' 筆相同地塊、極近位置或同名同地址的可能關聯豬場（'+matches.slice(0,3).map(f=>f.name||f.uid).join('、')+'）。請先查核並使用既有豬場編輯流程；此案仍保留待審，不會自動合併。',true);
    syncEvidenceSet('readError','重複豬場檢查','找到可能重複的正式紀錄，未執行核准交易');
    return;
    }
    if(!confirm('伺服器已有關聯豬場，但人工判定紀錄已確認為不同經營者。確定仍要核准建立另一筆正式豬場？'))return;
    adjudicatedDistinct=true;
   }
  }
  const lock=approve?(reestablishment?{id:reestablishment.newLockId,key:'reopen:'+approvalLockFor(p,false).key}:approvalLockFor(p,adjudicatedDistinct)):null;
  await F.runTransaction(db,async tx=>{
  const ref=F.doc(db,'farmSubmissions',id),farmRef=F.doc(db,'farms','submitted-'+id);
  const lockRef=approve?F.doc(db,'farmApprovalLocks',lock.id):null;
  // Read every relevant document BEFORE any write. Firestore retries the
  // transaction when another administrator creates the same lock meanwhile.
  const snap=await tx.get(ref);
  if(!snap.exists()||snap.data().status!=='pending')throw Error('案件已處理或不存在');
  const d=snap.data();
  if(approve){
   // A distinct-operator exception is only valid with a committed human
   // decision. Re-read it INSIDE the same transaction; the earlier preflight
   // is only a user-facing hint, not transactional authorization.
   const resolutionRef=adjudicatedDistinct?F.doc(db,'submissionResolutions',id):null;
   const reopenRef=reestablishment?F.doc(db,'farmReestablishmentReviews',id):null;
   const previousFarm=await tx.get(farmRef);
   const previousLock=await tx.get(lockRef);
   const resolutionSnap=resolutionRef?await tx.get(resolutionRef):null;
   const reopenSnap=reopenRef?await tx.get(reopenRef):null;
   const oldLockSnap=reestablishment?await tx.get(F.doc(db,'farmApprovalLocks',reestablishment.priorLockId)):null;
   const tombSnap=reestablishment?await tx.get(F.doc(db,'deletedFarms',reestablishment.priorFarmUid)):null;
   if(previousFarm.exists())throw Error('正式紀錄已存在');
   if(previousLock.exists())throw Error('地塊核准占用紀錄已存在（'+lock.key+'）。可能是另一管理員已核准，或原豬場已刪除但仍保留防重建紀錄；請查詢原紀錄及刪除歷史。系統不會直接重用占用 ID。');
   if(adjudicatedDistinct){
    const r=resolutionSnap?.exists()?resolutionSnap.data():null;
    if(!r||r.submissionId!==id||r.mode!=='distinct'||!Array.isArray(r.matchedUids)||!r.matchedUids.includes(r.farmUid)||!r.reason||!r.adminUid||!matches.every(f=>r.matchedUids.includes(f.uid)))
     throw Error('不同經營者判定紀錄已變更或不完整，請重新同步案件及關聯正式豬場，不可略過去重。');
   }
   if(reestablishment){
    const r=reopenSnap?.exists()?reopenSnap.data():null;
    if(!r||r.submissionId!==id||r.newLockId!==lock.id||r.priorFarmUid!==reestablishment.priorFarmUid||r.priorLockId!==reestablishment.priorLockId||!r.reason||!oldLockSnap?.exists()||oldLockSnap.data().farmUid!==r.priorFarmUid||!tombSnap?.exists()||tombSnap.data().farmUid!==r.priorFarmUid)
     throw Error('重新設立的審核、刪除紀錄或舊占用紀錄已不一致');
   }
   // Fail closed when the parcel/point key changed since the form was opened.
   const baseFresh=approvalLockFor({...p,parcelKey:d.parcelKey,proposedLat:d.proposedLat,proposedLng:d.proposedLng},adjudicatedDistinct);
   const fresh=reestablishment?{id:'reopen-'+baseFresh.id,key:'reopen:'+baseFresh.key}:baseFresh;
   if(fresh.id!==lock.id||fresh.key!==lock.key)throw Error('案件地塊或座標已改變，請重新載入');
   tx.set(lockRef,{lockKey:lock.key,farmUid:'submitted-'+id,submissionId:id,parcelKey:d.parcelKey||'',createdBy:user.uid,createdAt:F.serverTimestamp()});
   tx.set(farmRef,{uid:'submitted-'+id,name:d.proposedName,county:d.proposedCounty,town:d.proposedTown,address:d.proposedAddress,lat:d.proposedLat,lng:d.proposedLng,version:1,approvedSuggestionId:null,updatedAt:F.serverTimestamp(),auditDecision:d.decision,auditParcelKey:d.parcelKey||'',approvalLockId:lock.id});
  }
  tx.update(ref,{status:approve?'approved':'rejected',reviewedBy:user.uid,reviewedAt:F.serverTimestamp()});
 });const verified=await checkCommittedDocuments('審核新增豬場：'+id,[
  {collection:'farmSubmissions',id,expected:{status:approve?'approved':'rejected',reviewedBy:user.uid}},
  ...(approve?[
   {collection:'farms',id:'submitted-'+id,expected:{uid:'submitted-'+id,name:p.proposedName,county:p.proposedCounty,town:p.proposedTown,address:p.proposedAddress,lat:p.proposedLat,lng:p.proposedLng,auditDecision:p.decision,auditParcelKey:p.parcelKey||'',approvalLockId:lock.id,version:1}},
   {collection:'farmApprovalLocks',id:lock.id,expected:{lockKey:lock.key,farmUid:'submitted-'+id,submissionId:id}}
  ]:[])
 ]);
 const sync=typeof reconcileReviewAfterCommit==='function'?await reconcileReviewAfterCommit({kind:'new',id,approved:approve,farmUid:'submitted-'+id,verified}):null;
 const pendingRefresh=sync?{ok:sync.pendingOk}:await reconcilePendingFromServer();
 status((approve?'新增豬場核准交易已提交。':'新增申請退回交易已提交。')+(verified?'伺服器交易讀回已確認。':'伺服器交易讀回尚未確認。')+(sync?(sync.ok?' 正式名冊、地圖和待審數已同步核對。':' 畫面或待審數尚未完整確認，請使用同步驗證；勿重複提交。'):(pendingRefresh.ok?' 待審數已重新核對。':' 待審數尚未確認，請重新同步。')),!verified||!(sync?sync.ok:pendingRefresh.ok));}
 catch(e){syncEvidenceSet('error','審核案件',String(e?.message||e),String(e?.code||''));status('審核交易失敗：'+err(e)+'；請先同步再決定是否重試。',true);}
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
 if(linkedUid&&liveFarms.has(linkedUid)){edit(linkedUid);$('cloudLat').value=lat.toFixed(8);$('cloudLng').value=lng.toFixed(8);lookupAddress('edit');$('cloudNote').value=note||'';
  status(admin?'請核對既有豬場資料，直接儲存後套用查核結果。':'請填寫豬場資料並送審；管理員核准後才更新正式資料。');return true;}
 beginNew(lat,lng);status(admin?'請填寫名稱與地址；管理員儲存後直接生效。':'請填寫名稱與地址；送審後須經管理員核准才會正式生效。');return true;
}
function subscribeNewSubmissions(){ownerSubmissionCache.new=true;ownerSubmissionError.new=false;const generation=++submissionsGeneration,session=loggedInSeq,uid=user?.uid||null;if(unsubNewSubmissions){unsubNewSubmissions();unsubNewSubmissions=null;}newSubmissions=[];renderProposals();if(!user)return;
 const q=admin?F.query(F.collection(db,'farmSubmissions'),F.orderBy('submittedAt','desc'),F.limit(50)):F.query(F.collection(db,'farmSubmissions'),F.where('submittedBy','==',user.uid),F.limit(50));
 unsubNewSubmissions=F.onSnapshot(q,{includeMetadataChanges:true},s=>{if(generation!==submissionsGeneration||!sameSession(session,uid))return;ownerSubmissionCache.new=!!(s.metadata.fromCache||s.metadata.hasPendingWrites);ownerSubmissionError.new=false;newSubmissions=s.docs.map(d=>({...d.data(),id:d.id}));renderProposals();if(typeof renderNewSubmissionPrecheck==='function')renderNewSubmissionPrecheck();updateLinkage();syncIndicator();},e=>{if(generation===submissionsGeneration&&sameSession(session,uid)){ownerSubmissionError.new=true;renderProposals();status('新增豬場審核清單讀取失敗：'+err(e),true);}});
}
// Keep the session on this site/device. Google still controls whether its account
// chooser can reuse an existing browser session; the site cannot read phone accounts.
async function signIn(){
 if(!auth||!A){status('Firebase 尚未正確設定或套件尚未載入',true);return;}
 if(auth.currentUser){open();return;}
 const btn=$('cloudSignIn');if(btn)btn.disabled=true;
 status('正在開啟 Google 帳號選擇畫面；已登入瀏覽器的帳號通常不必重新輸入密碼…');
 try{
  // Persistence is configured during Firebase startup; open popup directly
  // from the tap handler so iPhone Safari does not block it.
  const provider=new A.GoogleAuthProvider();
  provider.setCustomParameters({prompt:'select_account'});
  await A.signInWithPopup(auth,provider);
  status('Google 登入成功，已設定保留此裝置的登入狀態，正在同步資料…');
 }catch(e){
  status('登入未完成：'+err(e)+'。手機可先用 Safari／Chrome 登入 Google，再回網站選帳號；若從主畫面 PWA 開啟無法彈窗，請改用瀏覽器開啟登入。',true);
 }finally{if(btn)btn.disabled=false;}
}
async function signOut(){if(!auth)return;try{await A.signOut(auth);status('已登出 Google；仍可查看公開的正式豬場。');}catch(e){status(err(e),true);}}
// Administrator role must be confirmed by the server, not a potentially stale
// cached admins/{uid} document. A network error leaves adminReady=false.
async function checkAdmin(u){
 if(!u||!db)throw Error('資料庫尚未連線');
 const result=await F.getDocFromServer(F.doc(db,'admins',u.uid));
 return result.exists()&&result.data()?.role==='admin';
}
function maybeShowAdminSetup(){
 if(!admin||!db||liveFarms.size!==0||farmsFromCache)return;
 let shown=false;try{shown=sessionStorage.getItem('pig3319-admin-setup-shown')==='1';}catch(_e){}
 if(shown)return;
 try{sessionStorage.setItem('pig3319-admin-setup-shown','1');}catch(_e){}
 open();status('已確認雲端沒有豬場，請按「初始化／補齊315筆初始豬場」。');
}
// Metadata-only updates are essential: a cache snapshot can become server-confirmed
// without changing any farm document. Keep farmsFromCache and admin controls fresh.
function subscribeFarms(){if(unsubFarms)unsubFarms();unsubFarms=F.onSnapshot(F.collection(db,'farms'),{includeMetadataChanges:true},snapshot=>{
 farmsRevision++;
 const next=new Map();snapshot.forEach(d=>next.set(d.id,{...d.data(),uid:d.id}));liveFarms=next;updateLinkage();
 farmsFromCache=!!snapshot.metadata.fromCache;renderProposals();
 if(!farmsFromCache && !snapshot.metadata.hasPendingWrites){syncEvidence.serverAt=Date.now();renderSyncEvidence();}
 hook?.applyApproved(publicRows(),{serverConfirmed:!farmsFromCache&&!snapshot.metadata.hasPendingWrites});if(deletedFarmIds.size)hook?.removeDeleted?.([...deletedFarmIds]);renderUser();syncIndicator();maybeShowAdminSetup();
 },e=>status('Firestore 正式豬場即時監聽失敗：'+err(e),true));}
function subscribeSuggestions(){ownerSubmissionCache.edit=true;ownerSubmissionError.edit=false;const generation=++suggestionsGeneration,session=loggedInSeq,uid=user?.uid||null;if(unsubProposals){unsubProposals();unsubProposals=null;}
 proposals=[];renderProposals();if(!user)return;
 const q=admin?F.query(F.collection(db,'suggestions'),F.orderBy('submittedAt','desc'),F.limit(50)):F.query(F.collection(db,'suggestions'),F.where('submittedBy','==',user.uid),F.limit(50));
 unsubProposals=F.onSnapshot(q,{includeMetadataChanges:true},snapshot=>{if(generation!==suggestionsGeneration||!sameSession(session,uid))return;ownerSubmissionCache.edit=!!(snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites);ownerSubmissionError.edit=false;proposals=snapshot.docs.map(d=>({...d.data(),id:d.id}));renderProposals();syncIndicator();},e=>{if(generation===suggestionsGeneration&&sameSession(session,uid)){ownerSubmissionError.edit=true;renderProposals();status('修改建議即時監聽失敗：'+err(e),true);}});
}
async function onUserChanged(u){const seq=++loggedInSeq;reviewCommitGeneration++;reviewSyncSet('idle','完成審核後會檢查正式名冊、待審清單和地圖統計。');
 // Invalidate account-scoped asynchronous reads, never retain another account's audits.
 auditsReadGeneration++;sharedAudits=[];renderSharedAudits();
 resetLegacyEvidenceArchive();legacyLockAuditGeneration++;legacyLockAudit=null;legacyLockEligibility=null;legacyEvidenceReview=null;legacyLockReviews=new Map();legacyLockAuditError="";legacyLockAuditBusy=false;renderLegacyLockAudit();
 stopPendingSubscriptions();resolutionHistoryReadGeneration++;submissionResolutions=new Map();reestablishmentReviews=new Map();resolutionHistoryLoaded=false;resolutionsLoadError='';resolutionHistoryLimit=100;lineageHistoryLimit=100;lineageDetailGeneration++;lineageDetails=new Map();lineageLoadError='';user=u;renderResolutionHistory();renderLineageHistory();admin=false;adminReady=false;renderUser();updatePendingUi();subscribeSuggestions();subscribeNewSubmissions();if(!u){sharedAudits=[];renderSharedAudits();syncIndicator();return;}
 let value;try{value=await checkAdmin(u);}catch(e){if(seq===loggedInSeq){status('無法確認帳號權限，已暫停新增及送審：'+err(e),true);}return;}if(seq!==loggedInSeq)return;admin=value;adminReady=true;renderUser();renderLegacyLockAudit();subscribePendingCases();if(admin)loadSubmissionResolutions();syncMessage('身分已確認，正在讀取雲端查核…');subscribeSuggestions();subscribeNewSubmissions();syncIndicator();
 maybeShowAdminSetup();readSharedAudits();}

async function refresh(){
 const request=++refreshGeneration,session=loggedInSeq,uid=user?.uid||null;
 const farmAtStart=farmsRevision,deletedAtStart=deletedRevision;
 if(!db){status('Firebase 尚未連線',true);syncEvidenceSet('error','重新讀取','Firebase 尚未連線');return false;}
 try{
  // A manual server verification is complete only after BOTH collections are read.
  // Do not apply one collection when the other fails: an old tombstone snapshot
  // could otherwise disagree with the freshly retrieved formal farm list.
  const [farmSnapshot,deletedSnapshot]=await Promise.all([
   F.getDocsFromServer(F.collection(db,'farms')),
   F.getDocsFromServer(F.collection(db,'deletedFarms'))
  ]);
  if(request!==refreshGeneration||!sameSession(session,uid))return false;
  if(farmAtStart!==farmsRevision||deletedAtStart!==deletedRevision){status('讀取期間已有新的即時資料，已保留較新的地圖狀態；如有需要請再次驗證。');return false;}
  const next=new Map();farmSnapshot.forEach(d=>next.set(d.id,{...d.data(),uid:d.id}));
  const nextDeleted=new Set();deletedSnapshot.forEach(d=>nextDeleted.add(d.id));
  liveFarms=next;deletedFarmIds=nextDeleted;farmsFromCache=false;
  syncEvidence.serverAt=Date.now();renderSyncEvidence();
  // Keep both lists and marker overlay in sync with the same server read.
  try{
   hook?.removeDeleted?.([...nextDeleted]);
   hook?.applyApproved?.(publicRows(),{serverConfirmed:true});
   updateLinkage();renderUser();syncIndicator();
  }catch(uiError){
   console.warn('Firestore 兩個集合已讀回，但畫面刷新發生錯誤：',uiError);
   syncEvidenceSet('uiError','重新讀取','正式豬場及刪除紀錄已讀回，但畫面更新不完整：'+err(uiError));
   status('正式豬場及刪除紀錄已從伺服器讀回，但畫面更新不完整：'+err(uiError),true);
   return false;
  }
  return true;
 }catch(e){
  if(request!==refreshGeneration||!sameSession(session,uid))return false;
  status('無法完整讀取正式豬場與刪除紀錄：'+err(e)+'。目前顯示的可能是舊資料。',true);
  syncEvidenceSet('error','重新讀取','正式豬場與刪除紀錄未能一起完成伺服器讀取：'+String(e?.message||e),String(e?.code||''));
  return false;
 }
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
 $('cloudReviewSyncRetry')?.addEventListener('click',async()=>{reviewSyncSet('checking','正在重新核對雲端正式豬場與待審資料，不會再次提交審核…');await verifyLatestFarms();reviewSyncSet(['refreshed','verified'].includes(syncEvidence.state)?'ok':'partial',['refreshed','verified'].includes(syncEvidence.state)?'正式名冊及待審清單已從伺服器重新確認，地圖與統計已刷新。':'尚未能完整確認雲端資料，請檢查連線及權限，勿重複提交。');});
 $('cloudRefresh')?.addEventListener('click',verifyLatestFarms);$('cloudSyncVerify')?.addEventListener('click',verifyLatestFarms);$('cloudSeed')?.addEventListener('click',seed);
 $('cloudEditForm')?.addEventListener('submit',submit);
 $('cloudApproveExisting')?.addEventListener('click',event=>submit(event,true));
 $('cloudUnifiedWizard')?.addEventListener('click',e=>{const button=e.target.closest('[data-wizard-decision]');if(button)unifiedDecision(button.dataset.wizardDecision);});
 $('cloudWizardCancel')?.addEventListener('click',close);$('cloudWizardBack')?.addEventListener('click',unifiedBack);$('cloudEditWizardBack')?.addEventListener('click',unifiedBack);
 $('cloudNewLat')?.addEventListener('change',()=>lookupAddress('new'));
 $('cloudNewLng')?.addEventListener('change',()=>lookupAddress('new'));
 $('cloudLat')?.addEventListener('change',()=>lookupAddress('edit'));
 $('cloudLng')?.addEventListener('change',()=>lookupAddress('edit'));
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
 $('cloudNewForm')?.addEventListener('input',renderNewSubmissionPrecheck);$('cloudNewForm')?.addEventListener('change',renderNewSubmissionPrecheck);
 $('cloudNewForm')?.addEventListener('submit',createFarm);$('cloudDelete')?.addEventListener('click',()=>deleteActiveFarm());
 $('cloudNewCancel')?.addEventListener('click',()=>{if(!canLeaveCloudForm())return;clearCloudFormDirty();$('cloudNewForm').hidden=true;$('cloudPanel').classList.remove('cloud-form-active');newPoint=null;auditContext=null;unifiedFlow=null;});
 $('cloudLegacyLockRun')?.addEventListener('click',runLegacyLockAudit);
 $('cloudLegacyWorklistSearch')?.addEventListener('input',()=>{legacyWorklistLimit=100;renderLegacyWorklist();});
 $('cloudLegacyWorklistRisk')?.addEventListener('change',()=>{legacyWorklistLimit=100;renderLegacyWorklist();});
 $('cloudLegacyWorklistStatus')?.addEventListener('change',()=>{legacyWorklistLimit=100;renderLegacyWorklist();});
 $('cloudLegacyWorklistMore')?.addEventListener('click',()=>{legacyWorklistLimit+=100;renderLegacyWorklist();});
 $('cloudLegacyWorklistExport')?.addEventListener('click',exportLegacyWorklist);
 $('cloudLegacyArchiveRead')?.addEventListener('click',readLegacyEvidenceArchive);
 $('cloudLegacyArchiveFilter')?.addEventListener('change',renderLegacyEvidenceArchive);
 $('cloudLegacyAlertFilter')?.addEventListener('change',renderLegacyEvidenceAlerts);
 $('cloudLegacyAlertResults')?.addEventListener('click',e=>{const btn=e.target.closest('[data-legacy-alert-farm]');if(!btn)return;const uid=btn.dataset.legacyAlertFarm;const select=$('cloudLegacyHistoryFarm');if(!select)return;select.value=uid;renderLegacyEvidenceHistory();$('cloudLegacyHistoryPanel')?.setAttribute('open','');$('cloudLegacyHistoryPanel')?.scrollIntoView?.({block:'nearest',behavior:'smooth'});});
 $('cloudLegacyHistoryFarm')?.addEventListener('change',()=>{ $('cloudLegacyHistoryOlder').value='';$('cloudLegacyHistoryNewer').value='';renderLegacyEvidenceHistory(); });
 $('cloudLegacyHistoryOlder')?.addEventListener('change',renderLegacyEvidenceHistory);
 $('cloudLegacyHistoryNewer')?.addEventListener('change',renderLegacyEvidenceHistory);
 $('cloudLegacyHistoryLimit')?.addEventListener('change',renderLegacyEvidenceHistory);
 $('cloudLegacyArchiveResults')?.addEventListener('click',e=>{const btn=e.target.closest('[data-legacy-archive-upload]');if(btn)uploadLegacyEvidenceArchive(btn.dataset.legacyArchiveUpload);});
 $('cloudLegacyReturn')?.addEventListener('click',returnToLegacyWorklist);
 $('cloudLegacyWorklistResults')?.addEventListener('change',e=>{const select=e.target.closest('[data-legacy-worklist-stage]');if(select)saveLegacyWorklistStage(select.dataset.legacyWorklistStage,select.value);});
 $('cloudLegacyWorklistResults')?.addEventListener('click',e=>{
  const history=e.target.closest('[data-legacy-worklist-history]');if(history){const select=$('cloudLegacyHistoryFarm');if(select){select.value=history.dataset.legacyWorklistHistory;renderLegacyEvidenceHistory();$('cloudLegacyArchivePanel')?.setAttribute('open','');$('cloudLegacyHistoryPanel')?.setAttribute('open','');$('cloudLegacyHistoryPanel')?.scrollIntoView?.({block:'nearest',behavior:'smooth'});}return;}
  const save=e.target.closest('[data-legacy-evidence-save]');if(save){saveLegacyWorklistEvidence(save.dataset.legacyEvidenceSave);return;}
  const farm=e.target.closest('[data-legacy-worklist-farm]');if(farm){openLegacyWorklistFarm(farm.dataset.legacyWorklistFarm);return;}
  const item=e.target.closest('[data-legacy-worklist-copy]');if(!item)return;
  const row=legacyWorklistTasks(legacyEvidenceReview?.rows||[]).find(r=>r.uid===item.dataset.legacyWorklistCopy);if(!row)return;
  const body=['舊版豬場複查工作清單（本機非正式核定）','ID：'+row.uid,'名稱：'+row.name,'地塊：'+(row.parcelKey||'未確認'),'風險：'+row.state,'疑點：'+row.issues.join('；'),'待辦：'+row.tasks.join('；')].join('\n');
  if(navigator.clipboard?.writeText)navigator.clipboard.writeText(body).then(()=>status('已複製複查待辦')).catch(()=>status(body,true));else status(body);
 });
 $('cloudLegacyEligibilitySearch')?.addEventListener('input',()=>{legacyEligibilityLimit=100;renderLegacyLockAudit();});
 $('cloudLegacyEligibilityFilter')?.addEventListener('change',()=>{legacyEligibilityLimit=100;renderLegacyLockAudit();});
 $('cloudLegacyEligibilityMore')?.addEventListener('click',()=>{legacyEligibilityLimit+=100;renderLegacyLockAudit();});
 $('cloudLegacyEligibilityResults')?.addEventListener('click',e=>{
  const farm=e.target.closest('[data-legacy-eligibility-farm]');if(farm){edit(farm.dataset.legacyEligibilityFarm);return;}
  const copy=e.target.closest('[data-legacy-eligibility-copy]');if(copy){const id=copy.dataset.legacyEligibilityCopy;if(navigator.clipboard?.writeText)navigator.clipboard.writeText(id).then(()=>status('已複製紀錄 ID')).catch(()=>status('無法複製：'+id,true));else status('紀錄 ID：'+id);}
 });
 $('cloudLegacyEvidenceSearch')?.addEventListener('input',()=>{legacyEvidenceLimit=100;renderLegacyEvidence();});
 $('cloudLegacyEvidenceFilter')?.addEventListener('change',()=>{legacyEvidenceLimit=100;renderLegacyEvidence();});
 $('cloudLegacyEvidenceMore')?.addEventListener('click',()=>{legacyEvidenceLimit+=100;renderLegacyEvidence();});
 $('cloudLegacyEvidenceResults')?.addEventListener('click',e=>{
  const farm=e.target.closest('[data-legacy-evidence-farm]');if(farm){edit(farm.dataset.legacyEvidenceFarm);return;}
  const copy=e.target.closest('[data-legacy-evidence-copy]');if(!copy)return;
  const r=legacyEvidenceReview?.rows.find(x=>x.uid===copy.dataset.legacyEvidenceCopy);if(!r)return;
  const body=['早期豬場資料品質複查（僅供人工判讀）','ID：'+r.uid,'名稱：'+r.name,'地塊：'+(r.parcelKey||'未確認'),'座標：'+(r.point?r.point.join(', '):'未確認'),'判斷：'+r.state,'待核對：'+r.issues.join('；'),'此摘要非官方地籍或經營者證明，未建立任何占用鎖。'].join('\n');
  if(navigator.clipboard?.writeText)navigator.clipboard.writeText(body).then(()=>status('已複製複查摘要')).catch(()=>status(body,true));else status(body);
 });
 $('cloudLegacyLockSearch')?.addEventListener('input',()=>{legacyLockAuditLimit=100;renderLegacyLockAudit();});
 $('cloudLegacyLockFilter')?.addEventListener('change',()=>{legacyLockAuditLimit=100;renderLegacyLockAudit();});
 $('cloudLegacyLockMore')?.addEventListener('click',()=>{legacyLockAuditLimit+=100;renderLegacyLockAudit();});
 $('cloudLegacyLockResults')?.addEventListener('click',e=>{
  const review=e.target.closest('[data-legacy-review]');if(review){confirmLegacyLockHistory(review.dataset.legacyReview);return;}
  const farm=e.target.closest('[data-legacy-audit-farm]');if(farm){edit(farm.dataset.legacyAuditFarm);return;}
  const copy=e.target.closest('[data-legacy-audit-copy]');if(copy){const id=copy.dataset.legacyAuditCopy;if(navigator.clipboard?.writeText)navigator.clipboard.writeText(id).then(()=>status('已複製紀錄 ID')).catch(()=>status('無法自動複製：'+id,true));else status('紀錄 ID：'+id);}
 });
 $('cloudLineageSearch')?.addEventListener('input',()=>{lineageHistoryLimit=100;renderLineageHistory();});
 $('cloudLineageFilter')?.addEventListener('change',()=>{lineageHistoryLimit=100;renderLineageHistory();});
 $('cloudLineageReload')?.addEventListener('click',()=>{lineageDetails=new Map();lineageDetailGeneration++;loadSubmissionResolutions();});
 $('cloudLineageMore')?.addEventListener('click',()=>{lineageHistoryLimit+=100;renderLineageHistory();});
 $('cloudLineageHistory')?.addEventListener('click',e=>{
  const verify=e.target.closest('[data-lineage-verify]');if(verify){verifyLineageHistory(verify.dataset.lineageVerify);return;}
  const farm=e.target.closest('[data-lineage-farm]');if(farm){edit(farm.dataset.lineageFarm);return;}
  const c=e.target.closest('[data-lineage-case]');if(c){const row=[...($('cloudProposals')?.querySelectorAll('[data-proposal-row]')||[])].find(x=>x.dataset.proposalRow===c.dataset.lineageCase);if(row)row.scrollIntoView({behavior:'smooth',block:'center'});else status('原申請未在目前已載入清單中，不能據此判定案件已刪除。',true);}
 });
 $('cloudResolutionSearch')?.addEventListener('input',()=>{resolutionHistoryLimit=100;renderResolutionHistory();});
 $('cloudResolutionFilter')?.addEventListener('change',()=>{resolutionHistoryLimit=100;renderResolutionHistory();});
 $('cloudResolutionReload')?.addEventListener('click',()=>loadSubmissionResolutions());
 $('cloudResolutionMore')?.addEventListener('click',()=>{resolutionHistoryLimit+=100;renderResolutionHistory();});
 $('cloudResolutionHistory')?.addEventListener('click',e=>{
  const farm=e.target.closest('[data-resolution-history-farm]');if(farm){edit(farm.dataset.resolutionHistoryFarm);return;}
  const link=e.target.closest('[data-resolution-history-case]');if(link){
   const id=link.dataset.resolutionHistoryCase;
   const row=[...($('cloudProposals')?.querySelectorAll('[data-proposal-row]')||[])].find(n=>n.dataset.proposalRow===id);
   if(row){row.scrollIntoView({behavior:'smooth',block:'center'});row.classList.add('cloud-duplicate-highlight');setTimeout(()=>row.classList.remove('cloud-duplicate-highlight'),1800);}
   else status('案件未包含於目前已載入的待審清單，不能據此判定原始案件不存在。',true);
  }
 });
 $('cloudProposalFilter')?.addEventListener('change',e=>{proposalListFilter=e.target.value;renderProposals();});
 $('cloudProposalSearch')?.addEventListener('input',e=>{proposalSearchTerm=e.target.value;renderProposals();});
 $('cloudProposalDuplicateFilter')?.addEventListener('change',e=>{proposalDuplicateFilter=e.target.value;renderProposals();});
 $('cloudReturnReviewMap')?.addEventListener('click',returnFromProposalMap);
 $('cloudProposals')?.addEventListener('click',e=>{
  const map=e.target.closest('[data-review-map]');if(map){focusProposalOnMap(map.dataset.reviewMap);return;}
  const formal=e.target.closest('[data-duplicate-farm]');
  if(formal){edit(formal.dataset.duplicateFarm);return;}
  const peer=e.target.closest('[data-duplicate-pending]');
  if(peer){const row=[...$('cloudProposals').querySelectorAll('[data-proposal-row]')].find(n=>n.dataset.proposalRow===peer.dataset.duplicatePending);if(row){row.scrollIntoView({behavior:'smooth',block:'center'});row.classList.add('cloud-duplicate-highlight');setTimeout(()=>row.classList.remove('cloud-duplicate-highlight'),1800);}return;}
  const reopen=e.target.closest('[data-reopen-review]');if(reopen){reviewReestablishment(reopen.dataset.reopenReview);return;}
  const link=e.target.closest('[data-resolution-link]');if(link){adjudicateSubmission(link.dataset.resolutionLink,'link_existing');return;}
  const distinct=e.target.closest('[data-resolution-distinct]');if(distinct){adjudicateSubmission(distinct.dataset.resolutionDistinct,'distinct');return;}
  const target=e.target.closest('[data-approve],[data-reject]');if(target)review(target.dataset.approve||target.dataset.reject,!!target.dataset.approve,target.dataset.kind||'edit');
 });
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
 // Best-effort persistence: keep observing auth even on private/restricted browsers.
 try{await A.setPersistence(auth,A.browserLocalPersistence);}catch(e){status('此瀏覽器可能無法永久保存登入狀態：'+err(e),true);}
 subscribeDeleted();subscribeFarms();A.onAuthStateChanged(auth,u=>{onUserChanged(u).catch(e=>status(err(e),true));},e=>status('Firebase Authentication 發生問題：'+err(e),true));
 }catch(e){status('Firebase 啟動失敗：'+err(e)+'。沒有啟用共用同步。',true);}
}
root.PigCommunity={get enabled(){return enabled();},get connected(){return !!db;},publishAudit,start,open,edit,beginNew,beginAudit,beginUnified,editAt,updateDraftPoint,pull:refresh,
 deletionInfo(uid){return {isCloud:liveFarms.has(uid),canDelete:!!(user&&admin&&adminReady&&db&&liveFarms.has(uid))};},
 deleteFarm(uid){return deleteActiveFarm(uid);}};
})(window);
