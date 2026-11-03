/* 豬場查核 V3.3.20｜Google Firebase Authentication + Cloud Firestore。 */
(function (root) {'use strict';
const $=id=>document.getElementById(id);
const clean=(value,n)=>String(value??'').trim().slice(0,n);
const esc=value=>String(value??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const conf=root.PIG_FIREBASE_CONFIG||{};
const configured=!!(conf.apiKey&&conf.projectId&&conf.appId&&conf.authDomain&&!String(conf.apiKey).includes('請填'));
let auth=null,db=null,A=null,F=null,user=null,admin=false,hook=null,started=false;
let liveFarms=new Map(),proposals=[],activeFarm=null,unsubFarms=null,unsubProposals=null,loggedInSeq=0;
let farmsFromCache=true,seedBusy=false,newPoint=null,newBusy=false;
function status(msg,bad=false){const el=$('cloudStatus');if(el){el.textContent=msg;el.dataset.error=bad?'yes':'no';}const btn=$('cloudOpen');if(btn)btn.title=msg;}
function err(e){const code=String(e?.code||''); if(code.includes('permission-denied'))return '沒有資料庫存取權限：請確認 Firestore 規則已發布、Google 登入已啟用及管理員 UID 設定';
 if(code.includes('auth/unauthorized-domain'))return '目前網站網域尚未加入 Firebase Authentication 已授權網域';
 if(code.includes('popup-blocked'))return '瀏覽器擋住了 Google 登入視窗；請使用 Safari 或 Chrome 開啟網站並允許彈出視窗';
 if(code.includes('auth/popup-closed-by-user'))return '已取消 Google 登入';
 if(code.includes('unavailable')||code.includes('network'))return '網路或 Firebase 連線暫時不可用，資料尚未送達雲端';
 return clean(e?.message||e,200);}
function enabled(){return configured;}
function open(){const p=$('cloudPanel');if(!p)return;p.hidden=false;renderUser();renderProposals();if(!configured)status('尚未填入 Firebase Web 設定；目前仍使用本機豬場資料，沒有雲端同步',true);}
function close(){if($('cloudPanel'))$('cloudPanel').hidden=true;}
function renderUser(){
 const who=$('cloudWho'),sign=$('cloudSignIn'),out=$('cloudSignOut'),submit=$('cloudSubmit'),seed=$('cloudSeed');
 const label=user?(admin?'管理員':(user.displayName||user.email||'已登入')):'Google 登入';
 const quick=$('cloudLoginQuick');if(quick){quick.textContent=user?(admin?'管理員 ✓':'我的帳號 ✓'):'Google 登入';quick.title=user?`已登入：${user.email||label}，點此開啟共同編輯`:'使用 Google 帳號登入';quick.setAttribute('aria-label',quick.title);}
 const mobileLabel=$('mobileAuthLabel');if(mobileLabel)mobileLabel.textContent=user?(admin?'管理員':'帳號'):'登入';
 if(who)who.textContent=user?`已登入 ${user.displayName||user.email||'Google 使用者'}${admin?' · 管理者':''}`:'尚未登入：可以查看正式場址；修改須 Google 登入';
 const create=$('cloudNewOpen');if(create){create.hidden=!admin||!db;create.disabled=!admin||!db;}
 if(sign)sign.hidden=!!user;if(out)out.hidden=!user;
 if(submit)submit.disabled=!user||!db;
 if(seed){seed.hidden=!admin||!db;seed.disabled=seedBusy;seed.textContent=seedBusy?'正在建立雲端資料…':'初始化／補齊315筆初始豬場（只新增缺漏）';}
 const first=$('cloudAdminFirstRun');if(first)first.hidden=!(admin&&db&&liveFarms.size===0&&!farmsFromCache);
}

function proposalDate(value){if(value?.toDate)return value.toDate().toLocaleString('zh-TW');return '剛剛';}
function renderProposals(){const box=$('cloudProposals');if(!box)return;
 if(!user){box.innerHTML='<p class="subtle">登入後可查看最近50筆場址修改建議及其審核結果。</p>';return;}
 box.innerHTML=proposals.length?proposals.map(p=>`<article class="cloud-proposal"><div><strong>${esc(p.proposedName||p.farmUid)}</strong><small> ${esc(p.status==='approved'?'已採納':p.status==='rejected'?'未採納':'待確認')} · ${esc(proposalDate(p.submittedAt))}</small></div><div>${esc(p.proposedCounty)} ${esc(p.proposedTown)} · ${esc(p.proposedAddress)}</div><small>座標：${p.proposedLat===null?'未提供':esc(p.proposedLat)}, ${p.proposedLng===null?'未提供':esc(p.proposedLng)}</small>${p.note?`<small>依據：${esc(p.note)}</small>`:''}${admin&&p.status==='pending'?`<div class="cloud-actions"><button type="button" data-approve="${esc(p.id)}">確認採納</button><button type="button" data-reject="${esc(p.id)}">不採納</button></div>`:''}</article>`).join(''):'<p class="subtle">目前沒有共用編輯紀錄。</p>';
}
function edit(uid){open();const r=hook?.getRecord(uid);if(!r){status('找不到此豬場紀錄',true);return;}activeFarm=uid;
 const cloud=liveFarms.get(uid)||{};
 const geo=r.geometry?.type==='Point'?r.geometry.coordinates:null;
 $('cloudFarm').textContent=(cloud.name||r.name)+' · '+(cloud.town||r.town||'鄉鎮待查')+' · '+uid;
 $('cloudName').value=cloud.name??r.name;
 $('cloudCounty').value=cloud.county??r.county;
 $('cloudTown').value=cloud.town??r.town;
 $('cloudAddress').value=cloud.address??r.address;
 $('cloudLat').value=cloud.lat??(geo?geo[1]:'');$('cloudLng').value=cloud.lng??(geo?geo[0]:'');
 $('cloudNote').value='';$('cloudEditForm').hidden=false;
 if(!user)status('請先使用 Google 登入，再提交這筆修改建議',true);
}
function beginNew(lat=null,lng=null){
 open();if(!admin||!db||!user){status('目前無法新增正式豬場：必須完成 Google 登入、確認管理員權限及 Firestore 連線。',true);return false;}
 const hasCoords=lat!==null&&lng!==null;
 newPoint=hasCoords?{lat:Number(lat),lng:Number(lng)}:{};
 $('cloudEditForm').hidden=true;$('cloudNewForm').hidden=false;
 $('cloudNewName').value='';$('cloudNewCounty').value='雲林縣';$('cloudNewTown').value='';$('cloudNewAddress').value='';
 $('cloudNewLat').value=hasCoords?Number(lat).toFixed(8):'';
 $('cloudNewLng').value=hasCoords?Number(lng).toFixed(8):'';

 status(hasCoords?'已從地圖取得座標；請填寫豬場名稱、鄉鎮後儲存。':'請填寫豬場資料與 WGS84 經緯度，再儲存至雲端。');
 $('cloudNewName').focus();return true;
}
async function createFarm(event){
 event.preventDefault();if(!admin||!db||!user){status('無管理員新增權限，無法儲存。',true);return;}
 if(newBusy)return;
 const name=clean($('cloudNewName').value,150),county=clean($('cloudNewCounty').value,40),town=clean($('cloudNewTown').value,40),address=clean($('cloudNewAddress').value,220);
 const latText=$('cloudNewLat').value.trim(),lngText=$('cloudNewLng').value.trim();
 if(!name||!county||!town){status('請完整填寫豬場名稱、縣市及鄉鎮。',true);return;}
 if(!latText||!lngText){status('新增地圖標記必須有經緯度。請使用「＋ 標記點」在地圖選位置，或填入正確座標。',true);return;}
 const lat=Number(latText),lng=Number(lngText);
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<21||lat>27||lng<118||lng>123){status('經緯度不在台灣有效範圍，請檢查。',true);return;}
 if([...liveFarms.values()].some(f=>f.lat!=null&&f.lng!=null&&Math.abs(Number(f.lat)-lat)<0.00001&&Math.abs(Number(f.lng)-lng)<0.00001)){
  if(!confirm('已有豬場紀錄位於幾乎相同的位置。確定要新增不同豬場，避免重複建檔？'))return;
 }
 if(!confirm(`確定新增「${name}」至正式雲端豬場清單？\n位置：${county}${town} ${address}\n座標：${lat}, ${lng}`))return;
 newBusy=true;$('cloudNewSubmit').disabled=true;status('正在寫入 Firestore，尚未完成儲存…');
 try{
  const id='manual-'+Date.now()+'-'+Math.random().toString(36).slice(2,10);
  const data={uid:id,name,county,town,address,lat,lng,version:1,approvedSuggestionId:null,updatedAt:F.serverTimestamp()};
  await F.setDoc(F.doc(db,'farms',id),data);
  $('cloudNewForm').hidden=true;newPoint=null;
  status(`已成功新增「${name}」至 Firestore（ID：${id}）。地圖清單將即時更新。`);
 }catch(e){status('新增失敗：'+err(e)+'。請先檢查 Firebase /firestore.rules 是否已部署最新版；資料未確認寫入。',true);}
 finally{newBusy=false;$('cloudNewSubmit').disabled=false;renderUser();}
}
function publicRows(){return [...liveFarms.values()];}
function syncIndicator(){if(!db)return;const count=liveFarms.size;
 if(!count&&farmsFromCache){status('Firebase 已載入，正在向伺服器確認豬場資料…');return;}
 status(count?`${farmsFromCache?'離線快取／待確認連線':'Firestore 即時同步'} · ${count} 筆正式豬場 · ${proposals.filter(x=>x.status==='pending').length} 筆待審核`: '已連線至 Firebase，但資料庫尚無豬場；請先登入管理員並初始化315筆資料',!count||farmsFromCache);
}
async function submit(event){event.preventDefault();if(!user||!db){status('必須先 Google 登入並連接 Firebase 才能提交',true);return;}
 const current=liveFarms.get(activeFarm);if(!current){status('雲端沒有這筆豬場，請管理員先初始化資料',true);return;}
 const lat=clean($('cloudLat').value,32),lng=clean($('cloudLng').value,32);
 if(Boolean(lat)!==Boolean(lng)){status('緯度與經度需要同時填寫或同時留空',true);return;}
 const la=lat?Number(lat):null,lo=lng?Number(lng):null;
 if(la!==null&&(!Number.isFinite(la)||la<21||la>27||!Number.isFinite(lo)||lo<118||lo>123)){status('座標超出台灣合理範圍，請檢查WGS84經緯度',true);return;}
 const proposedName=clean($('cloudName').value,150),proposedCounty=clean($('cloudCounty').value,40),proposedTown=clean($('cloudTown').value,40);
 if(!proposedName||!proposedCounty||!proposedTown){status('豬場名稱、縣市及鄉鎮不能留空',true);return;}
 const payload={farmUid:activeFarm,baseVersion:current.version,proposedName,proposedCounty,proposedTown,proposedAddress:clean($('cloudAddress').value,220),proposedLat:la,proposedLng:lo,note:clean($('cloudNote').value,500),submittedBy:user.uid,submittedAt:F.serverTimestamp(),status:'pending',reviewedBy:null,reviewedAt:null};
 const btn=$('cloudSubmit');btn.disabled=true;status('正在提交至 Google Firestore…');
 try{await F.addDoc(F.collection(db,'suggestions'),payload);status('建議已提交到 Google Firestore，其他登入使用者可同步查看；正式場址須由管理員審核。');$('cloudEditForm').hidden=true;}
 catch(e){status('提交失敗：'+err(e)+'；請不要當成已成功同步。',true);}finally{renderUser();}
}
async function review(id,approve){if(!admin||!user||!db)return;const p=proposals.find(x=>x.id===id);if(!p||p.status!=='pending')return;
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
async function signIn(){if(!auth||!A){status('Firebase 尚未正確設定或套件尚未載入',true);return;}
 const btn=$('cloudSignIn');if(btn)btn.disabled=true;status('正在開啟 Google 登入視窗…');
 try{await A.signInWithPopup(auth,new A.GoogleAuthProvider());status('Google 帳號登入成功，正在同步資料…');}
 catch(e){status('登入未完成：'+err(e)+'。iPhone/iPad若使用主畫面PWA不支援彈窗，請先用 Safari 網頁登入。',true);}finally{if(btn)btn.disabled=false;}
}
async function signOut(){if(!auth)return;try{await A.signOut(auth);status('已登出 Google；仍可查看公開的正式豬場。');}catch(e){status(err(e),true);}}
async function checkAdmin(u){if(!u||!db)return false;try{const result=await F.getDoc(F.doc(db,'admins',u.uid));return result.exists()&&result.data()?.role==='admin';}catch(e){status('無法確認管理者權限：'+err(e),true);return false;}}
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
 if(next.size)hook?.applyApproved(publicRows());renderUser();syncIndicator();maybeShowAdminSetup();
 },e=>status('Firestore 正式豬場即時監聽失敗：'+err(e),true));}
function subscribeSuggestions(){if(unsubProposals){unsubProposals();unsubProposals=null;}
 proposals=[];renderProposals();if(!user)return;
 const q=F.query(F.collection(db,'suggestions'),F.orderBy('submittedAt','desc'),F.limit(50));
 unsubProposals=F.onSnapshot(q,snapshot=>{proposals=snapshot.docs.map(d=>({...d.data(),id:d.id}));renderProposals();syncIndicator();},e=>status('修改建議即時監聽失敗：'+err(e),true));
}
async function onUserChanged(u){const seq=++loggedInSeq;user=u;admin=false;renderUser();subscribeSuggestions();if(!u){syncIndicator();return;}
 const value=await checkAdmin(u);if(seq!==loggedInSeq)return;admin=value;renderUser();subscribeSuggestions();syncIndicator();
 maybeShowAdminSetup();}

async function refresh(){if(!db){status('Firebase 尚未連線',true);return;}
 try{const snapshot=await F.getDocsFromServer(F.collection(db,'farms'));const next=new Map();snapshot.forEach(d=>next.set(d.id,{...d.data(),uid:d.id}));liveFarms=next;farmsFromCache=false;if(next.size)hook?.applyApproved(publicRows());syncIndicator();}
 catch(e){status('無法從雲端取得最新資料：'+err(e)+'。目前看到的可能是舊資料。',true);}
}
async function seed(){if(!admin||!user||!db||seedBusy)return;
 const original=hook?.getSeedRecords?.()||[];
 if(original.length!==315){status('原始315筆資料校驗失敗，不允許建立雲端名冊',true);return;}
 const missing=original.filter(r=>r.uid&&!liveFarms.has(r.uid));
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
 $('cloudNewForm')?.addEventListener('submit',createFarm);
 $('cloudNewCancel')?.addEventListener('click',()=>{$('cloudNewForm').hidden=true;newPoint=null;});
 $('cloudProposals')?.addEventListener('click',e=>{const target=e.target.closest('[data-approve],[data-reject]');if(target)review(target.dataset.approve||target.dataset.reject,!!target.dataset.approve);});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('cloudPanel').hidden)close();});
 if(!configured){status('尚未設定 Google Firebase：此版本目前仍是本機模式，沒有多人同步',true);renderUser();return;}
 if(location.protocol==='file:'){status('請透過 HTTPS GitHub Pages 開啟網站，才能使用 Firebase；直接開啟本機 HTML 無法驗收登入。',true);return;}
 status('載入 Google Firebase 並建立 Firestore 連線…');
 try{
 const sdk='https://www.gstatic.com/firebasejs/12.19.0/';
 const [app,authLib,firestore]=await Promise.all([import(sdk+'firebase-app.js'),import(sdk+'firebase-auth.js'),import(sdk+'firebase-firestore.js')]);
 A=authLib;F=firestore;
 const application=app.initializeApp(conf,'pig-farm-map');auth=A.getAuth(application);db=F.getFirestore(application);
 subscribeFarms();A.onAuthStateChanged(auth,u=>{onUserChanged(u).catch(e=>status(err(e),true));},e=>status('Firebase Authentication 發生問題：'+err(e),true));
 }catch(e){status('Firebase 啟動失敗：'+err(e)+'。沒有啟用共用同步。',true);}
}
root.PigCommunity={get enabled(){return enabled();},get connected(){return !!db;},start,open,edit,beginNew,pull:refresh};
})(window);
