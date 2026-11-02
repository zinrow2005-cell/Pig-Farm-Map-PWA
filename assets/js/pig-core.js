
/* 獨立資料處理層；供瀏覽器與 Node 測試使用 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.PigCore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const VERSION='pig-map-v3';
 function coord(lat,lon){return typeof lat==='number'&&typeof lon==='number'&&Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-90&&lat<=90&&lon>=-180&&lon<=180;}
 function s(value,n=500){return String(value??'').slice(0,n);}
 function cleanText(v){return s(v).trim().replace(/\s+/g,'').toLocaleLowerCase();}
 function time(){return new Date().toISOString();}
 function legacyRow(r){
  const location=coord(r.lat,r.lng),verified=r.finalApproval==='全部核定';
  return {
   uid:'legacy-'+s(r.id,30), legacyId:r.id, name:s(r.name,150),town:s(r.town,40),county:s(r.county||'雲林縣',30),village:s(r.village,70),address:s(r.address,220),
   geometry:location?{type:'Point',coordinates:[r.lng,r.lat]}:null,
   category: verified?'pig':'unchecked',review:verified?'approved':'pending',
   originalStatus:s(r.status,40),source:s(r.source,240),evidence:verified?'舊版人工全部核定':'舊版匯入，尚未重新核定',
   note:s(r.note,2000),imageYear:'',registration:'',lastReviewed:s(r.lastChecked,80),
   legacy:{addressLevel:r.addressLevel??'',nameAddressReview:r.nameAddressReview??'',mapLocationReview:r.mapLocationReview??'',finalApproval:r.finalApproval??''},
   createdAt:'',updatedAt:''
  };
 }
 function normalize(r){
  if(!r||typeof r!=='object')return null;
  const okCategories=['pig','maybe','other','unchecked'];const okReviews=['approved','pending'];
  const g=r.geometry;
  let geometry=null;
  if(g&&g.type==='Point'&&Array.isArray(g.coordinates)&&coord(g.coordinates[1],g.coordinates[0]))geometry={type:'Point',coordinates:[+g.coordinates[0],+g.coordinates[1]]};
  else if(g&&g.type==='Polygon'&&Array.isArray(g.coordinates)&&Array.isArray(g.coordinates[0])){
    let ring=g.coordinates[0].filter(p=>Array.isArray(p)&&coord(p[1],p[0])).map(p=>[+p[0],+p[1]]);
    if(ring.length>=4&&ring[0][0]===ring[ring.length-1][0]&&ring[0][1]===ring[ring.length-1][1])ring.pop();
    if(ring.length>=3)geometry={type:'Polygon',coordinates:[[...ring,ring[0]]]};
  }
  const out={uid:s(r.uid||'',80),legacyId:r.legacyId??null,name:s(r.name,150),town:s(r.town,40),county:s(r.county||'雲林縣',40),village:s(r.village,70),address:s(r.address,220),geometry,
   category:okCategories.includes(r.category)?r.category:'unchecked',review:okReviews.includes(r.review)?r.review:'pending',originalStatus:s(r.originalStatus,50),source:s(r.source,250),
   evidence:s(r.evidence,300),note:s(r.note,4000),imageYear:s(r.imageYear,30),registration:s(r.registration,100),lastReviewed:s(r.lastReviewed,100),
   legacy:r.legacy&&typeof r.legacy==='object'?r.legacy:{},createdAt:s(r.createdAt,100),updatedAt:s(r.updatedAt,100)};
  if(!out.uid)out.uid='manual-'+String(Date.now())+'-'+Math.random().toString(36).slice(2,8);
  return out;
 }
 function legacyToAll(a){return Array.isArray(a)?a.map(x=>normalize(legacyRow(x))).filter(Boolean):[];}
 function center(r){const g=r?.geometry;if(!g)return null;if(g.type==='Point')return [g.coordinates[1],g.coordinates[0]];if(g.type==='Polygon'){let pts=g.coordinates[0].slice(0,-1);return [pts.reduce((a,p)=>a+p[1],0)/pts.length,pts.reduce((a,p)=>a+p[0],0)/pts.length];}return null;}
 function distance(a,b){let p=center(a),q=center(b);if(!p||!q)return Infinity;const dy=(p[0]-q[0])*110574,dx=(p[1]-q[1])*111320*Math.cos(p[0]*Math.PI/180);return Math.hypot(dx,dy);}
 function sameLocation(a,b){if(a.uid===b.uid)return true;if(a.legacyId!=null&&b.legacyId!=null&&String(a.legacyId)===String(b.legacyId))return true;
  const na=cleanText(a.name),nb=cleanText(b.name);if(na&&nb&&na!=='xx畜牧場'&&na===nb&&distance(a,b)<20)return true;
  return false;}
 function merge(existing,incoming){const result=[...existing];let added=0,skipped=0;for(const src of incoming){const r=normalize(src);if(!r)continue;if(result.some(e=>sameLocation(e,r))){skipped++;continue;}result.push(r);added++;}return{records:result,added,skipped};}
 function importJson(data){let rows=[];
  if(Array.isArray(data)){rows=legacyToAll(data);}
  else if(data&&data.version===VERSION&&Array.isArray(data.records)){rows=data.records.map(normalize).filter(Boolean);}
  else if(data&&data.version==='pig-map-v2'&&Array.isArray(data.records)){rows=data.records.map(v2ToV3).filter(Boolean);}
  else if(data&&data.type==='FeatureCollection'&&Array.isArray(data.features)){rows=data.features.map(geoToRecord).filter(Boolean);}
  else throw Error('不支援此資料格式，請匯入舊版清單、V2/V3 JSON 或 GeoJSON');
  return rows;
 }
 function v2ToV3(r){let geom=null;if(r.kind==='polygon'&&Array.isArray(r.vertices)&&r.vertices.length>=3){const ring=r.vertices.map(x=>[+x[1],+x[0]]);if(!ring.every(p=>coord(p[1],p[0])))return null;geom={type:'Polygon',coordinates:[[...ring,ring[0]]]};}else if(coord(+r.lat,+r.lon)){geom={type:'Point',coordinates:[+r.lon,+r.lat]};}else return null;
  return normalize({uid:'v2-'+s(r.id,60),geometry:geom,name:r.name,county:r.county||r['縣市']||'',town:r.town,address:r.address,category:r.classification,review:'pending',source:'V2 舊版人工標記',evidence:r.evidence,note:r.note,imageYear:r.imageYear,updatedAt:r.updatedAt});}
 function geoToRecord(f){let p=f?.properties||{},g=f?.geometry;if(!g)return null;return normalize({uid:s(p.uid||p.id||'',80),name:p.name||p['名稱']||'',county:p.county||p['縣市']||p['縣市名稱']||'',town:p.town||p['鄉鎮']||'',address:p.address||p['地址或地號']||'',category:p.category||p.classification,review:p.review||'pending',source:p.source||'GeoJSON 匯入',evidence:p.evidence||'',note:p.note||p['備註']||'',geometry:g});}
 function counts(a){return{total:a.length,located:a.filter(r=>!!center(r)).length,missing:a.filter(r=>!center(r)).length,approved:a.filter(r=>r.review==='approved').length,pigs:a.filter(r=>r.category==='pig').length};}
 function geojson(a){return{type:'FeatureCollection',name:'豬場查詢系統 V3 人工地理查核',features:a.filter(r=>!!r.geometry).map(r=>({type:'Feature',properties:{uid:r.uid,legacyId:r.legacyId,名稱:r.name,county:r.county,縣市:r.county,鄉鎮:r.town,地址:r.address,category:r.category,review:r.review,originalStatus:r.originalStatus,source:r.source,evidence:r.evidence,note:r.note},geometry:r.geometry}))};}
 function csv(a){const headers=['資料ID','舊版ID','名稱','縣市','鄉鎮','村里','地址或地號','緯度','經度','分類','核定狀態','原始狀態','原始來源','判讀依據','備註'];const records=a.map(r=>{let c=center(r);return[r.uid,r.legacyId,r.name,r.county,r.town,r.village,r.address,c?c[0].toFixed(8):'',c?c[1].toFixed(8):'',r.category,r.review,r.originalStatus,r.source,r.evidence,r.note]});const esc=x=>'"'+String(x??'').replace(/"/g,'""')+'"';return '\ufeff'+[headers,...records].map(row=>row.map(esc).join(',')).join('\r\n');}
 return {VERSION,coord,legacyRow,normalize,legacyToAll,center,distance,sameLocation,merge,importJson,v2ToV3,counts,geojson,csv};
});


