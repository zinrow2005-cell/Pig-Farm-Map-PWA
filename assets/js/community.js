/* 豬場查核 V3.3.42｜地塊標記直填、管理員刪除與同步統計。 */
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
function status(msg,bad=false){const el=$('cloudStatus');if(el){el.textContent=msg;el.dataset.error=bad?'yes':'no';}const btn=$('cloudOpen');if(btn)btn.title=msg;}
function err(e){const code=String(e?.code||''); if(code.includes('permission-denied'))return '沒有資料庫存取權限：請確認 Firestore 規則已發布、Google 登入已啟用及管理員 UID 設定';
 if(code.includes('auth/unauthorized-domain'))return '目前網站網域尚未加入 Firebase Authentication 已授權網域';
 if(code.includes('popup-blocked'))return '瀏覽器擋住了 Google 登入視窗；請使用 Safari 或 Chrome 開啟網站並允許彈出視窗';
 if(code.includes('auth/popup-closed-by-user'))return '已取消 Google 登入';
 if(code.includes('unavailable')||code.includes('network'))return '網路或 Firebase 連線暫時不可用，資料尚未送達雲端';
 return clean(e?.message||e,200);}
function enabled(){return configured;}
function open(){const p=$('cloudPanel');if(!p)return;p.hidden=false;renderUser();renderProposals();if(!configured)status('尚未填入 Firebase Web 設定；目前仍使用本機豬場資料，沒有雲端同步',true);}
function close(){if($('cloudPanel')){$('cloudPanel').hidden=true;$('cloudPanel').classList.remove('cloud-form-active');}auditContext=null;}
function renderUser(){
 const who=$('cloudWho'),sign=$('cloudSignIn'),out=$('cloudSignOut'),submit=$('cloudSubmit'),seed=$('cloudSeed');
 const label=user?(admin?'管理員':(user.displayName||user.email||'已登入')):'Google 登入';
 const quick=$('cloudLoginQuick');if(quick){quick.textContent=user?(admin?'管理員 ✓':'我的帳號 ✓'):'Google 登入';quick.title=user?`已登入：${user.email||label}，點此開啟共同編輯`:'使用 Google 帳號登入';quick.setAttribute('aria-label',quick.title);}
 const mobileLabel=$('mobileAuthLabel');if(mobileLabel)mobileLabel.textContent=user?(admin?'管理員':'帳號'):'登入';
 if(who)who.textContent=user?`已登入 ${user.displayName||user.email||'Google 使用者'}${admin?' · 管理者':''}`:'尚未登入：可以查看正式場址；修改須 Google 登入';
 const deleteButton=$('cloudDelete');if(deleteButton){deleteButton.hidden=!(admin&&adminReady&&activeFarm&&liveFarms.has(activeFarm));deleteButton.disabled=deleteBusy||editBusy;}
 const create=$('cloudNewOpen');if(create){create.hidden=!admin||!db;create.disabled=!admin||!db;}
 if(sign)sign.hidden=!!user;if(out)out.hidden=!user;
 if(submit){submit.disabled=!user||!db||!adminReady||editBusy;submit.textContent=admin?'直接儲存正式豬場':'送出資料供管理員審核';} const newSubmit=$('cloudNewSubmit');if(newSubmit){newSubmit.disabled=!user||!db||!adminReady||newBusy;newSubmit.textContent=!adminReady?'確認身分權限中…':admin?'儲存正式豬場（免審核）':'送出豬場資料供審核';}
 if(seed){seed.hidden=!admin||!db;seed.disabled=seedBusy;seed.textContent=seedBusy?'正在建立雲端資料…':'初始化／補齊315筆初始豬場（只新增缺漏）';}
 const first=$('cloudAdminFirstRun');if(first)first.hidden=!(admin&&db&&liveFarms.size===0&&!farmsFromCache);
}

function proposalDate(value){if(value?.toDate)return value.toDate().toLocaleString('zh-TW');return '剛剛';}
function renderProposals(){const box=$('cloudProposals');if(!box)return;
 if(!user){box.innerHTML='<p class="subtle">登入後可查看自己的申請及審核結果；管理員可查看待審清單。</p>';return;}
 const combined=[...newSubmissions.map(p=>({...p,kind:'new'})),...proposals];
 box.innerHTML=combined.length?combined.map(p=>`<article class="cloud-proposal"><div><strong>${esc(p.proposedName||p.farmUid)}</strong><small> ${esc(p.status==='approved'?'已採納':p.status==='rejected'?'未採納':'待確認')} · ${esc(proposalDate(p.submittedAt))}</small></div><div>${esc(p.proposedCounty)} ${esc(p.proposedTown)} · ${esc(p.proposedAddress)}</div><small>座標：${p.proposedLat===null?'未提供':esc(p.proposedLat)}, ${p.proposedLng===null?'未提供':esc(p.proposedLng)}</small>${p.note?`<small>依據：${esc(p.note)}</small>`:''}${p.kind==='new'?'<small>新增豬場申請</small>':''}${admin&&p.status==='pending'?`<div class="cloud-actions"><button type="button" data-approve="${esc(p.id)}" data-kind="${p.kind==='new'?'new':'edit'}">${p.kind==='new'?'核准新增':'確認採納'}</button><button type="button" data-reject="${esc(p.id)}" data-kind="${p.kind==='new'?'new':'edit'}">不採納</button></div>`:''}</article>`).join(''):'<p class="subtle">目前沒有共用編輯紀錄。</p>';
}
function edit(uid){open();const r=hook?.getRecord(uid);if(!r){status('找不到此豬場紀錄',true);return;}activeFarm=uid;$('cloudPanel').classList.add('cloud-form-active');
 const cloud=liveFarms.get(uid)||{};
 const geo=r.geometry?.type==='Point'?r.geometry.coordinates:null;
 $('cloudFarm').textContent=(cloud.name||r.name)+' · '+(cloud.town||r.town||'鄉鎮待查')+' · '+uid;
 $('cloudName').value=cloud.name??r.name;
 $('cloudCounty').value=cloud.county??r.county;
 $('cloudTown').value=cloud.town??r.town;
 $('cloudAddress').value=cloud.address??r.address;
 $('cloudLat').value=cloud.lat??(geo?geo[1]:'');$('cloudLng').value=cloud.lng??(geo?geo[0]:'');
 $('cloudNote').value='';$('cloudEditForm').hidden=false;renderUser();
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
function linkExistingFromPoint(uid){const lat=Number($('cloudNewLat').value),lng=Number($('cloudNewLng').value);if(!uid||!Number.isFinite(lat)||!Number.isFinite(lng))return;
 // Keep the original parcel context for post-approval audit linking.
 editAt(uid,lat,lng);
}
function beginNew(lat=null,lng=null){
 open();if(!db||!user||!adminReady){status('請先登入，並等待管理員身分檢查完成，再新增或送審。',true);return false;}
 const hasCoords=lat!==null&&lng!==null;
 newPoint=hasCoords?{lat:Number(lat),lng:Number(lng)}:{};
 activeFarm=null;$('cloudPanel').classList.add('cloud-form-active');$('cloudEditForm').hidden=true;$('cloudNewForm').hidden=false;renderUser();
 $('cloudNewDecision').value=auditContext?.decision||'pig';$('cloudNewParcel').textContent=auditContext?.parcelKey?'地塊識別：'+auditContext.parcelKey:'此點未取得 F03 地塊識別碼，將以座標建立標記';
 $('cloudNewName').value='';$('cloudNewCounty').value='雲林縣';$('cloudNewTown').value='';$('cloudNewAddress').value='';
 $('cloudNewLat').value=hasCoords?Number(lat).toFixed(8):'';
 $('cloudNewLng').value=hasCoords?Number(lng).toFixed(8):'';

 status(hasCoords?'已從地圖取得座標，請填入豬場名稱與地址後確認。':'請填入豬場資料與 WGS84 經緯度。');
 $('cloudLinkSearch').value='';renderLinkMatches();$('cloudNewName').focus();return true;
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
   await F.runTransaction(db,async tx=>{
    const snap=await tx.get(submissionRef);
    if(snap.exists())throw Error('此位置已有送審紀錄（狀態：'+(snap.data()?.status||'未知')+'），請從共同編輯查看，不會重複送審。');
    const data={proposedName:name,proposedCounty:county,proposedTown:town,proposedAddress:address,
      proposedLat:lat,proposedLng:lng,decision,parcelKey,note:clean(auditContext?.note,500),
      submittedBy:user.uid,submittedAt:F.serverTimestamp(),status:'pending',reviewedBy:null,reviewedAt:null};
    tx.set(submissionRef,data);
   });
   result={uid:'',status:'pending'};
  }
  $('cloudNewForm').hidden=true;newPoint=null;
  let localAuditOkay=true;
  if(auditContext){const ctx=auditContext;auditContext=null;if(admin&&ctx.onSaved)localAuditOkay=(await ctx.onSaved(result))!==false;}
  const message=!localAuditOkay?`豬場「${name}」已寫入雲端，但本機地塊查核尚未儲存成功。請先備份本機資料並檢查。`:admin?`已${candidate?'更新':'建立'}正式豬場「${name}」（ID：${targetUid}）。`:`「${name}」已送交管理員審查；未加入正式豬場筆數。`;
  status(message,!localAuditOkay);
  if(localAuditOkay){$('cloudPanel').hidden=true;$('cloudPanel').classList.remove('cloud-form-active');hook?.notifyApproved?.(message);if(admin)hook?.focusApproved?.(targetUid);}
 }catch(e){status('儲存未完成：'+err(e)+'。表單仍保留，請檢查後重試；不會自行再新增。',true);}
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
 deletedFarmIds.add(uid);liveFarms.delete(uid);hook?.removeDeleted?.([uid]);hook?.notifyApproved?.(`已刪除「${record.name}」；地圖、清單與統計已更新。`);activeFarm=null;$('cloudEditForm').hidden=true;$('cloudPanel').hidden=true;$('cloudPanel').classList.remove('cloud-form-active');syncIndicator();return true;
 }catch(e){status('刪除未完成：'+err(e)+'。資料維持原狀。',true);return false;}finally{deleteBusy=false;renderUser();}
}
function syncIndicator(){if(!db)return;const count=liveFarms.size;
 if(!count&&farmsFromCache){status('Firebase 已載入，正在向伺服器確認豬場資料…');return;}
 status(count?`${farmsFromCache?'離線快取／待確認連線':'Firestore 即時同步'} · ${count} 筆正式豬場 · ${proposals.filter(x=>x.status==='pending').length} 筆待審核`: '已連線至 Firebase，但資料庫尚無豬場；請先登入管理員並初始化315筆資料',!count||farmsFromCache);
}
async function submit(event){event.preventDefault();if(editBusy)return;if(!user||!db||!adminReady){status('請等待身分確認與 Firebase 連線完成再儲存',true);return;}
 const current=liveFarms.get(activeFarm);if(!current){status('雲端沒有這筆豬場，請管理員先初始化資料',true);return;}
 const lat=clean($('cloudLat').value,32),lng=clean($('cloudLng').value,32);
 if(Boolean(lat)!==Boolean(lng)){status('緯度與經度需要同時填寫或同時留空',true);return;}
 const la=lat?Number(lat):null,lo=lng?Number(lng):null;
 if(la!==null&&(!Number.isFinite(la)||la<21||la>27||!Number.isFinite(lo)||lo<118||lo>123)){status('座標超出台灣合理範圍，請檢查WGS84經緯度',true);return;}
 const proposedName=clean($('cloudName').value,150),proposedCounty=clean($('cloudCounty').value,40),proposedTown=clean($('cloudTown').value,40);
 if(!proposedName||!proposedCounty||!proposedTown){status('豬場名稱、縣市及鄉鎮不能留空',true);return;}
 const payload={farmUid:activeFarm,baseVersion:current.version,proposedName,proposedCounty,proposedTown,proposedAddress:clean($('cloudAddress').value,220),proposedLat:la,proposedLng:lo,note:clean($('cloudNote').value,500),submittedBy:user.uid,submittedAt:F.serverTimestamp(),status:'pending',reviewedBy:null,reviewedAt:null};
 const btn=$('cloudSubmit');editBusy=true;btn.disabled=true;status('正在提交至 Google Firestore…');
 try{if(admin){await F.runTransaction(db,async tx=>{const ref=F.doc(db,'farms',activeFarm),snap=await tx.get(ref);if(!snap.exists())throw Error('找不到正式豬場');const x=snap.data();tx.update(ref,{name:proposedName,county:proposedCounty,town:proposedTown,address:payload.proposedAddress,lat:la,lng:lo,version:x.version+1,updatedAt:F.serverTimestamp()});});status('管理員已直接更新正式豬場資料。');}else{await F.addDoc(F.collection(db,'suggestions'),payload);status('豬場資料已提交審查，核准後才更改正式地圖。');} $('cloudEditForm').hidden=true;if(auditContext){const ctx=auditContext;auditContext=null;if(admin)await ctx.onSaved?.({uid:activeFarm,status:'approved'});}}
 catch(e){status('提交失敗：'+err(e)+'；請不要當成已成功同步。',true);}finally{editBusy=false;renderUser();}
}
async function review(id,approve,kind='edit'){if(kind==='new')return reviewNew(id,approve);if(!admin||!adminReady||!user||!db)return;const p=proposals.find(x=>x.id===id);if(!p||p.status!=='pending')return;
 if(!confirm(`確定${approve?'採納':'退回'}「${p.proposedName}」的修改嗎？`))return;
 status('正在執行雲端交易與版本檢查…');
 try{await F.runTransaction(db,async tx=>{
   const sRef=F.doc(db,'suggestions',id),fRef=F.doc(db,'farms',p.farmUid);
   const sSnap=await tx.get(sRef),fSnap=await tx.get(fRef);
   if(!sSnap.exists()||!fSnap.exists())throw Error('待審紀錄或正式場址不存在');
   const s=sSnap.data(),farm=fSnap.data();if(s.status!=='pending')throw Error('這筆修改已被處理，請重新確認');
   if(approve&&farm.version!==s.baseVersion)throw Error('場址已有其他核准版本，不能覆蓋新資料；請重新提交建議');
   if(approve)tx.update(fRef,{name:s.proposedName,county:s.proposedCounty,town:s.proposedTown,address:s.proposedAddress,lat:s.proposedLat,lng:s.proposedLng,version:farm.version+1,approvedSuggestionId:id,updatedAt:F.serverTimestamp()});
   tx.update(sRef,{status:approve?'approved':'rejected',reviewedBy:user.uid,reviewedAt:F.serverTimestamp()});
 });status(approve?'已採納：正式地址與地圖將透過即時監聽更新':'已標記不採納');}
 catch(e){status('審核失敗：'+err(e),true);}
}
async function reviewNew(id,approve){
 if(!admin||!adminReady||!db||!user)return;
 const p=newSubmissions.find(x=>x.id===id);if(!p||p.status!=='pending')return;
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
function beginAudit(lat,lng,decision,linkedUid,note,onSaved,parcelKey=''){
 auditContext=null;
 if(!user||!db||!adminReady){open();status('請先 Google 登入並等待權限確認，才能填寫豬場資料。',true);return false;}
 auditContext={decision,note,onSaved,parcelKey:clean(parcelKey,160)};
 if(linkedUid&&liveFarms.has(linkedUid)){edit(linkedUid);$('cloudLat').value=lat.toFixed(8);$('cloudLng').value=lng.toFixed(8);$('cloudNote').value=note||'';
  status(admin?'請核對既有豬場資料，直接儲存後套用查核結果。':'請填寫豬場資料並送審；管理員核准後才更新正式資料。');return true;}
 beginNew(lat,lng);status(admin?'請填寫名稱與地址；管理員儲存後直接生效。':'請填寫名稱與地址；送審後須經管理員核准才會正式生效。');return true;
}
function subscribeNewSubmissions(){if(unsubNewSubmissions){unsubNewSubmissions();unsubNewSubmissions=null;}newSubmissions=[];renderProposals();if(!user)return;
 const q=admin?F.query(F.collection(db,'farmSubmissions'),F.orderBy('submittedAt','desc'),F.limit(50)):F.query(F.collection(db,'farmSubmissions'),F.where('submittedBy','==',user.uid),F.limit(50));
 unsubNewSubmissions=F.onSnapshot(q,s=>{newSubmissions=s.docs.map(d=>({...d.data(),id:d.id}));renderProposals();},e=>status('新增豬場審核清單讀取失敗：'+err(e),true));
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
 const next=new Map();snapshot.forEach(d=>next.set(d.id,{...d.data(),uid:d.id}));liveFarms=next;
 farmsFromCache=!!snapshot.metadata.fromCache;
 hook?.applyApproved(publicRows());if(deletedFarmIds.size)hook?.removeDeleted?.([...deletedFarmIds]);renderUser();syncIndicator();maybeShowAdminSetup();
 },e=>status('Firestore 正式豬場即時監聽失敗：'+err(e),true));}
function subscribeSuggestions(){if(unsubProposals){unsubProposals();unsubProposals=null;}
 proposals=[];renderProposals();if(!user)return;
 const q=admin?F.query(F.collection(db,'suggestions'),F.orderBy('submittedAt','desc'),F.limit(50)):F.query(F.collection(db,'suggestions'),F.where('submittedBy','==',user.uid),F.limit(50));
 unsubProposals=F.onSnapshot(q,snapshot=>{proposals=snapshot.docs.map(d=>({...d.data(),id:d.id}));renderProposals();syncIndicator();},e=>status('修改建議即時監聽失敗：'+err(e),true));
}
async function onUserChanged(u){const seq=++loggedInSeq;user=u;admin=false;adminReady=false;renderUser();subscribeSuggestions();subscribeNewSubmissions();if(!u){syncIndicator();return;}
 let value;try{value=await checkAdmin(u);}catch(e){if(seq===loggedInSeq){status('無法確認帳號權限，已暫停新增及送審：'+err(e),true);}return;}if(seq!==loggedInSeq)return;admin=value;adminReady=true;renderUser();subscribeSuggestions();subscribeNewSubmissions();syncIndicator();
 maybeShowAdminSetup();}

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
 $('cloudOpen')?.addEventListener('click',open);$('cloudClose')?.addEventListener('click',close);
 $('cloudLoginQuick')?.addEventListener('click',()=>{if(user)open();else if(auth)signIn();else open();});
 $('mobileAuthToggle')?.addEventListener('click',()=>{if(user)open();else if(auth)signIn();else open();});
 $('cloudSignIn')?.addEventListener('click',signIn);$('cloudSignOut')?.addEventListener('click',signOut);
 $('cloudRefresh')?.addEventListener('click',refresh);$('cloudSeed')?.addEventListener('click',seed);
 $('cloudEditForm')?.addEventListener('submit',submit);
 $('cloudNewOpen')?.addEventListener('click',()=>beginNew());
 $('cloudLinkSearch')?.addEventListener('input',renderLinkMatches);$('cloudLinkResults')?.addEventListener('click',e=>{const b=e.target.closest('[data-link-existing]');if(b)linkExistingFromPoint(b.dataset.linkExisting);});$('cloudPickExisting')?.addEventListener('click',()=>{if(!activeFarm)return;const uid=activeFarm;close();hook?.pickExistingOnMap?.(uid);});
 $('cloudNewForm')?.addEventListener('submit',createFarm);$('cloudDelete')?.addEventListener('click',()=>deleteActiveFarm());
 $('cloudNewCancel')?.addEventListener('click',()=>{$('cloudNewForm').hidden=true;$('cloudPanel').classList.remove('cloud-form-active');newPoint=null;auditContext=null;});
 $('cloudProposals')?.addEventListener('click',e=>{const target=e.target.closest('[data-approve],[data-reject]');if(target)review(target.dataset.approve||target.dataset.reject,!!target.dataset.approve,target.dataset.kind||'edit');});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('cloudPanel').hidden)close();});
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
root.PigCommunity={get enabled(){return enabled();},get connected(){return !!db;},start,open,edit,beginNew,beginAudit,editAt,pull:refresh,
 deletionInfo(uid){return {isCloud:liveFarms.has(uid),canDelete:!!(user&&admin&&adminReady&&db&&liveFarms.has(uid))};},
 deleteFarm(uid){return deleteActiveFarm(uid);}};
})(window);
