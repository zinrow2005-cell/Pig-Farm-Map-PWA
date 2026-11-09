/* V3.3.66 - read-only farm/audit consistency review; never writes data. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.PigHealth=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const norm=s=>String(s??'').trim().replace(/\s+/g,'').toLocaleLowerCase();
 function point(r){const g=r&&r.geometry;if(!g)return null;
  if(g.type==='Point'&&Array.isArray(g.coordinates))return [+g.coordinates[1],+g.coordinates[0]];
  if(g.type==='Polygon'&&Array.isArray(g.coordinates?.[0])){const p=g.coordinates[0].filter(x=>Array.isArray(x)&&Number.isFinite(+x[0])&&Number.isFinite(+x[1]));if(!p.length)return null;return [p.reduce((a,x)=>a+(+x[1]),0)/p.length,p.reduce((a,x)=>a+(+x[0]),0)/p.length];}
  return null;
 }
 function dist(a,b){const p=point(a),q=point(b);if(!p||!q)return Infinity;return Math.hypot((p[0]-q[0])*110574,(p[1]-q[1])*111320*Math.cos(p[0]*Math.PI/180));}
 function analyze(records,audits){const list=Array.isArray(records)?records:[],auditList=Array.isArray(audits)?audits:Object.values(audits||{}),issues=[],seen=new Set(),ids=new Set(list.map(r=>String(r.uid||'')));
  const add=(type,severity,title,detail,subject,uid,key)=>{const fingerprint=[type,uid,key].join('|');if(seen.has(fingerprint))return;seen.add(fingerprint);issues.push({type,severity,title,detail,subject:subject||'',uid:uid||'',auditKey:key||''});};
  // Compare a meaningful known state, rather than assuming an arbitrary missing field implies failure.
  for(const r of list){const id=String(r.uid||''),label=r.name||'未命名豬場',located=!!point(r);
   if(r.review==='approved'&&!located)add('status','high','已核定但沒有地圖座標', '名冊標示已核定，卻無法在地圖定位，請核對是否需要補點。',label,id);
   if(r.review==='approved'&&r.category==='unchecked')add('status','medium','已核定但未判定用途','請確認核定是舊名冊狀態，或需要補登人工豬場判定。',label,id);
  }
  // Constrain comparisons by normalized name + town (avoid O(n²) all-farm scan).
  const groups=new Map();for(const r of list){const n=norm(r.name),t=norm(r.town);if(!n||n==='xx畜牧場'||n==='未命名畜牧區域'||!point(r))continue;const k=t+'|'+n;const group=groups.get(k)||[];group.push(r);groups.set(k,group);}
  for(const g of groups.values())if(g.length>1){for(let i=0;i<g.length;i++)for(let j=i+1;j<g.length;j++){if(g[i].uid===g[j].uid)continue;const d=dist(g[i],g[j]);if(d<=80){const a=g[i],b=g[j],uid=String(a.uid||'');add('duplicate','medium','可能重複豬場：同名且位置接近',`${a.town||'鄉鎮未填'}，距離約 ${Math.round(d)} 公尺；另一筆為 ${b.uid||'無 ID'}。請人工核對，系統不會合併。`,a.name,uid);}}}
  for(const a of auditList){if(!a||typeof a!=='object')continue;const key=String(a.key||''),uid=String(a.promotedToUid||a.recordUid||'');
   if(uid&&!ids.has(uid)&&a.linkedBy!=='cloud-deleted')add('link','medium','查核關聯找不到豬場','可能是其他裝置尚未同步、舊 ID，或正式場址已刪除；請確認後再處理。',key||'查核地塊', '',key);
   if(a.promotedToUid&&['pig','maybe'].includes(a.decision)&&!ids.has(String(a.promotedToUid))&&a.linkedBy!=='cloud-deleted')add('link','medium','已轉正式但缺少對應紀錄','查核歷史宣稱已轉正式豬場，但目前清單未找到對應 ID。可能是同步尚未完成。',key||'查核地塊','',key);
  }
  issues.sort((a,b)=>({high:0,medium:1,low:2}[a.severity]-{high:0,medium:1,low:2}[b.severity])||a.title.localeCompare(b.title,'zh-Hant'));
  return {checked:{farms:list.length,audits:auditList.length},issues,counts:{duplicate:issues.filter(i=>i.type==='duplicate').length,status:issues.filter(i=>i.type==='status').length,link:issues.filter(i=>i.type==='link').length},checkedAt:new Date().toISOString()};
 }
 return {analyze,point,dist};
});
