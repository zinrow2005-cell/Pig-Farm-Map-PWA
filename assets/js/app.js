
'use strict';
/* 內建向量圖磚解碼層 */
/* F03 向量瓦片解碼器：僅讀取 MVT polygon geometry，獨立於 Leaflet。
 * 來源為林業及自然保育署 ArcGIS Hosted F03 (112/111)，依官方 style source-layer 命名。
 * 無法下載時會回報失敗，不虛構橘色區塊。 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.PigF03=api;})(typeof window!=='undefined'?window:globalThis,function(){'use strict';
 const ENDPOINT={4:'https://mapportal.forest.gov.tw/server/rest/services/Hosted/F03%E7%95%9C%E7%89%A7%E4%BD%BF%E7%94%A8_%E5%85%A8%E5%8F%B0_112_3857_20250702/VectorTileServer',5:'https://mapportal.forest.gov.tw/server/rest/services/Hosted/F03%E7%95%9C%E7%89%A7%E4%BD%BF%E7%94%A8_%E5%85%A8%E5%8F%B0_111_3857_20250702/VectorTileServer'};
 const LAYERS={4:'F03畜牧使用_全台_112',5:'F03畜牧使用_全台_111'};
 const MAX_NATIVE_ZOOM=12;
 // Official service lists Max LOD 12; overzoom child tiles must reuse their z12 parent.
 function sourceTile(coords){const z=Math.min(coords.z,MAX_NATIVE_ZOOM),factor=Math.pow(2,coords.z-z);return {z,x:Math.floor(coords.x/factor),y:Math.floor(coords.y/factor),factor,dx:coords.x%factor,dy:coords.y%factor};}
 const sourceCache=new Map();const missingSourceCache=new Map();const MAX_CACHE=192;
 // ArcGIS REST original polygon query. Optional supplement to missing 404 Z12 MVT tiles.
 // HTTP 403/CORS/error NEVER means the terrain is empty; fallback remains provisional.
 const F03_POLYGON_REST='https://gis.forest.gov.tw/arcgis/rest/services/BA/BA_%E8%BE%B2%E6%A5%AD%E5%8F%8A%E8%BE%B2%E5%9C%B0%E8%B3%87%E6%BA%90%E7%9B%A4%E6%9F%A5%E5%9C%96%E8%B3%87/MapServer';
 const originalCache=new Map(),ORIGINAL_MAX_CACHE=128;
 let originalActive=0;const originalQueue=[];const originalMetrics={success:0,empty:0,failed:0};
 function runOriginalQueued(fn){return new Promise((resolve,reject)=>{originalQueue.push({fn,resolve,reject});pumpOriginal();});}
 function pumpOriginal(){while(originalActive<4&&originalQueue.length){const q=originalQueue.shift();originalActive++;Promise.resolve().then(q.fn).then(q.resolve,q.reject).finally(()=>{originalActive--;pumpOriginal();});}}
 function originalTileBounds(z,x,y){
  const nw=toLngLat(0,0,z,x,y,4096),se=toLngLat(4096,4096,z,x,y,4096);
  return {xmin:nw[0],ymin:se[1],xmax:se[0],ymax:nw[1]};
 }
 function normalizeOriginalFeature(row){
  const rings=row?.geometry?.rings,objectId=Number(row?.attributes?.OBJECTID);
  if(!Array.isArray(rings)||!Number.isSafeInteger(objectId))return null;
  let pts=0;const result=[];
  for(const ring of rings){if(!Array.isArray(ring)||ring.length<3)continue;
   const cleaned=[];for(const p of ring){if(!Array.isArray(p)||!Number.isFinite(p[0])||!Number.isFinite(p[1])||Math.abs(p[0])>180||Math.abs(p[1])>90)continue;
    if(++pts>22000)throw Error('原始面圖資單筆頂點過多，請縮小查詢範圍');cleaned.push([p[0],p[1]]);
   }
   if(cleaned.length>=3)result.push(cleaned);
  }
  return result.length?{objectId,rings:result}:null;
 }
 async function requestOriginalTile(year,z,x,y){
  const b=originalTileBounds(z,x,y),all=[],seen=new Set(),pageSize=500;
  for(let page=0;page<6;page++){
   const p=new URLSearchParams({f:'json',where:'1=1',geometry:[b.xmin,b.ymin,b.xmax,b.ymax].join(','),geometryType:'esriGeometryEnvelope',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'OBJECTID',returnGeometry:'true',outSR:'4326',geometryPrecision:'7',resultOffset:String(page*pageSize),resultRecordCount:String(pageSize),orderByFields:'OBJECTID'});
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6500);
   let data;
   try{
    const response=await fetch(F03_POLYGON_REST+'/'+year+'/query?'+p,{signal:controller.signal,mode:'cors',cache:'default'});
    if(!response.ok){const e=Error('官方原始面 HTTP '+response.status);e.status=response.status;throw e;}
    data=await response.json();
   }finally{clearTimeout(timer);}
   if(data?.error)throw Error('ArcGIS 原始面查詢：'+String(data.error.message||data.error.code||'查詢失敗'));
   if(!Array.isArray(data?.features))throw Error('原始面服務回應格式錯誤');
   for(const row of data.features){const f=normalizeOriginalFeature(row);if(f&&!seen.has(f.objectId)){seen.add(f.objectId);all.push(f);}}
   if(data.features.length<pageSize&&data.exceededTransferLimit!==true)return all;
  }
  throw Error('原始面資料超過分頁上限，保留低倍率備援，請縮小範圍');
 }
 function getOriginalTilePolygons(year,z,x,y){
  const key=[year,z,x,y].join('/'),entry=originalCache.get(key);
  if(entry&&entry.expires>Date.now())return entry.promise;
  if(entry)originalCache.delete(key);
  const promise=runOriginalQueued(()=>requestOriginalTile(year,z,x,y)).then(features=>{
   originalMetrics[features.length?'success':'empty']++;
   return {ok:true,features};
  }).catch(e=>{originalMetrics.failed++;return {ok:false,features:[],reason:String(e?.message||e).slice(0,150)};});
  originalCache.set(key,{promise,expires:Date.now()+300000});
  while(originalCache.size>ORIGINAL_MAX_CACHE)originalCache.delete(originalCache.keys().next().value);
  return promise;
 }
 function renderOriginalPolygons(canvas,features,coords){
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas context unavailable');
  const side=canvas.width,z=coords.z,n=2**z;
  ctx.save();ctx.clearRect(0,0,side,side);ctx.beginPath();ctx.rect(0,0,side,side);ctx.clip();
  ctx.fillStyle='rgba(245,145,34,0.84)';ctx.strokeStyle='rgba(169,78,16,0.9)';ctx.lineWidth=1.1;
  let total=0;
  for(const f of features){ctx.beginPath();let hasPath=false;
   for(const ring of f.rings){if(ring.length<3)continue;
    for(let i=0;i<ring.length;i++){const lng=ring[i][0],lat=Math.max(-85.051128,Math.min(85.051128,ring[i][1]));
     const x=((lng+180)/360*n-coords.x)*side;
     const y=((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n-coords.y)*side;
     if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    }ctx.closePath();hasPath=true;
   }
   if(hasPath){ctx.fill('evenodd');ctx.stroke();total++;}
  }
  ctx.restore();return total;
 }
 function originalStatus(){return {...originalMetrics,pending:originalQueue.length,active:originalActive};}

 // Missing MVT tiles are *unknown coverage*, not proof that no farmland was surveyed.
 // Negative-cache 404 briefly to avoid hitting the same sparse endpoint on every pan.
 function makeMissingTileError(z,x,y){const e=Error('F03 HTTP 404 (z'+z+' x'+x+' y'+y+')');e.status=404;e.permanent=true;return e;}

 // A temporary network problem must not silently create an empty tile.
 // Retry transient responses before recording a genuine tile failure.
 function clearSourceCache(){sourceCache.clear();missingSourceCache.clear();originalCache.clear();}
 function getTileLayers(year,z,x,y){
  const key=[year,z,x,y].join('/');
  const missingUntil=missingSourceCache.get(key);
  if(missingUntil&&missingUntil>Date.now())return Promise.reject(makeMissingTileError(z,x,y));
  if(missingUntil)missingSourceCache.delete(key);
  if(sourceCache.has(key)){
   const cached=sourceCache.get(key);sourceCache.delete(key);sourceCache.set(key,cached);return cached;
  }
  const task=(async()=>{
   let lastError;
   for(let attempt=0;attempt<3;attempt++){
    const controller=new AbortController(),watchdog=setTimeout(()=>controller.abort(),12000);
    try{
     const response=await fetch(tileURL(year,z,x,y),{signal:controller.signal,mode:'cors',cache:'default'});
     if(!response.ok){
      const err=Error('F03 HTTP '+response.status+' (z'+z+' x'+x+' y'+y+')');
      err.status=response.status;
      err.permanent=response.status>=400&&response.status<500&&response.status!==408&&response.status!==429;
      throw err;
     }
     const layers=parseTile(await response.arrayBuffer(),LAYERS[year]);
     return layers;
    }catch(error){
     lastError=error;
     if(error.permanent||attempt===2)break;
     await new Promise(resolve=>setTimeout(resolve,200+350*attempt));
    }finally{clearTimeout(watchdog);}
   }
   if(lastError?.status===404)missingSourceCache.set(key,Date.now()+120000);
   throw lastError||Error('F03 來源無法載入');
  })().catch(error=>{if(sourceCache.get(key)===task)sourceCache.delete(key);throw error;});
  sourceCache.set(key,task);
  while(sourceCache.size>MAX_CACHE)sourceCache.delete(sourceCache.keys().next().value);
  return task;
 }

 // For presentation only: when a z12 tile is 404, try its official z11/z10 parent.
 // Parent geometries are generalized; NEVER feed them into authoritative audits,
 // parcel IDs, candidate scans, or user-confirmed polygon boundaries.
 async function getDisplayTileLayers(year,coords){
  let original404=false,polygonFailure='';
  for(let z=Math.min(coords.z,MAX_NATIVE_ZOOM);z>=10;z--){
   const factor=2**(coords.z-z),source={z,x:Math.floor(coords.x/factor),y:Math.floor(coords.y/factor),factor,dx:coords.x%factor,dy:coords.y%factor};
   try{
    const layers=await getTileLayers(year,z,source.x,source.y);
    return {layers,source,quality:original404?'approximate':'native',missingOriginal:original404,polygonFailure};
   }catch(error){
    if(error?.status!==404)throw error;
    if(!original404){
     original404=true;
     const original=await getOriginalTilePolygons(year,source.z,source.x,source.y);
     if(original.ok)return {layers:[],polygons:original.features,source,quality:'original-polygon',missingOriginal:true,polygonFailure:''};
     polygonFailure=original.reason;
    }
   }
  }
  return {layers:[],source:sourceTile(coords),quality:'unresolved',missingOriginal:true,polygonFailure};
 }
 function tileURL(year,z,x,y){return ENDPOINT[year]+'/tile/'+z+'/'+y+'/'+x+'.pbf';}
 function varint(b,p){let result=0,shift=0;for(let i=0;i<10;i++){if(p.i>=b.length)throw Error('PBF 資料被截斷');const v=b[p.i++];result+=(v&127)*Math.pow(2,shift);if(!(v&128))return result;shift+=7;}throw Error('PBF varint 過長');}
 function fields(b,fn){const p={i:0};while(p.i<b.length){const k=varint(b,p),id=k>>>3,wire=k&7;let v;if(wire===0)v=varint(b,p);else if(wire===1){if(p.i+8>b.length)throw Error('PBF 資料不足');v=b.subarray(p.i,p.i+8);p.i+=8;}else if(wire===5){if(p.i+4>b.length)throw Error('PBF 資料不足');v=b.subarray(p.i,p.i+4);p.i+=4;}else if(wire===2){const n=varint(b,p);if(n<0||p.i+n>b.length)throw Error('PBF 長度異常');v=b.subarray(p.i,p.i+n);p.i+=n;}else throw Error('不支援的 PBF wire type '+wire);fn(id,wire,v);}}
 const decodeText=typeof TextDecoder==='undefined'?null:new TextDecoder('utf-8');
 function str(b){if(decodeText)return decodeText.decode(b);return Array.from(b).map(x=>String.fromCharCode(x)).join('');}
 function packed(b){const p={i:0},out=[];while(p.i<b.length)out.push(varint(b,p));return out;}
 function parseFeature(b){const f={type:0,geom:[],id:null};fields(b,(k,w,v)=>{if(k===1&&w===0)f.id=v;else if(k===3&&w===0)f.type=v;else if(k===4&&w===2)f.geom=packed(v);});return f;}
 function parseLayer(b){let name='',extent=4096,raw=[];fields(b,(k,w,v)=>{if(k===1&&w===2)name=str(v);else if(k===2&&w===2)raw.push(v);else if(k===5&&w===0)extent=v;});return {name,extent,features:raw.map(parseFeature)};}
 function parseTile(input,expected){const b=input instanceof Uint8Array?input:new Uint8Array(input);const layers=[];fields(b,(k,w,v)=>{if(k===3&&w===2){const layer=parseLayer(v);if(!expected||layer.name===expected)layers.push(layer);}});return layers;}
 function zag(n){return (n&1)?-(n+1)/2:n/2;}
 function rings(nums){let x=0,y=0,p=0,r=[],result=[];while(p<nums.length){const cmd=nums[p++],op=cmd&7,count=cmd>>>3;if(count<1||count>500000)throw Error('無效 MVT Geometry 指令');if(op===1||op===2){for(let i=0;i<count;i++){if(p+1>=nums.length)throw Error('MVT 幾何座標不足');x+=zag(nums[p++]);y+=zag(nums[p++]);if(op===1){if(r.length>=3)result.push(r);r=[];}r.push([x,y]);}}else if(op===7){if(r.length>=3)result.push(r);r=[];}else throw Error('未知幾何指令 '+op);}if(r.length>=3)result.push(r);return result;}
 /* V3.3.6: Native z12 tile spatial binning. When zoomed in we only traverse
  * geometries touching the overzoom child's MVT bounds. This is a performance
  * index, never a land-parcel deduplication or an official parcel identifier. */
 const SPATIAL_CELLS=32;
 function featureBounds(feature){
  if(feature._bounds)return feature._bounds;
  const paths=feature._rings||(feature._rings=rings(feature.geom));
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const ring of paths)for(const [x,y] of ring){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}
  feature._bounds=[minX,maxX,minY,maxY];return feature._bounds;
 }
 function layerSpatialIndex(layer){
  if(layer._spatialIndex)return layer._spatialIndex;
  const cells=new Map(),extent=layer.extent||4096;
  for(let i=0;i<layer.features.length;i++){
   const f=layer.features[i];if(f.type!==3||!f.geom.length)continue;
   const [minX,maxX,minY,maxY]=featureBounds(f);
   if(maxX<0||minX>extent||maxY<0||minY>extent)continue;
   const cx0=Math.max(0,Math.min(SPATIAL_CELLS-1,Math.floor(minX/extent*SPATIAL_CELLS)));
   const cx1=Math.max(0,Math.min(SPATIAL_CELLS-1,Math.floor(maxX/extent*SPATIAL_CELLS)));
   const cy0=Math.max(0,Math.min(SPATIAL_CELLS-1,Math.floor(minY/extent*SPATIAL_CELLS)));
   const cy1=Math.max(0,Math.min(SPATIAL_CELLS-1,Math.floor(maxY/extent*SPATIAL_CELLS)));
   for(let cy=cy0;cy<=cy1;cy++)for(let cx=cx0;cx<=cx1;cx++){
    const key=cy*SPATIAL_CELLS+cx;let list=cells.get(key);if(!list){list=[];cells.set(key,list);}list.push(i);
   }
  }
  layer._spatialIndex={cells,extent};return layer._spatialIndex;
 }
 function croppedFeatures(layer,source){
  if(!source||source.factor<=1)return layer.features;
  const {cells,extent}=layerSpatialIndex(layer),factor=source.factor,dx=source.dx,dy=source.dy;
  // Include the same 5-unit overlap margin as the geometry clip below.
  const pad=8/extent;
  const c0=Math.max(0,Math.min(SPATIAL_CELLS-1,Math.floor((dx/factor-pad)*SPATIAL_CELLS)));
  const c1=Math.max(0,Math.min(SPATIAL_CELLS-1,Math.floor(((dx+1)/factor+pad)*SPATIAL_CELLS)));
  const r0=Math.max(0,Math.min(SPATIAL_CELLS-1,Math.floor((dy/factor-pad)*SPATIAL_CELLS)));
  const r1=Math.max(0,Math.min(SPATIAL_CELLS-1,Math.floor(((dy+1)/factor+pad)*SPATIAL_CELLS)));
  const hits=new Set();for(let row=r0;row<=r1;row++)for(let col=c0;col<=c1;col++){
   const ids=cells.get(row*SPATIAL_CELLS+col);if(ids)for(const id of ids)hits.add(id);
  }
  if(!hits.size){
   // Conservative fallback: a zero-hit spatial bin is verified against exact
   // polygon bounds, avoiding false gaps at narrow child/tile edges.
   const left=dx*extent/factor-8,right=(dx+1)*extent/factor+8;
   const top=dy*extent/factor-8,bottom=(dy+1)*extent/factor+8;
   for(let i=0;i<layer.features.length;i++){
    const f=layer.features[i];if(f.type!==3||!f.geom.length)continue;
    const [minX,maxX,minY,maxY]=featureBounds(f);
    if(maxX>=left&&minX<=right&&maxY>=top&&minY<=bottom)hits.add(i);
   }
  }
  return Array.from(hits).sort((a,b)=>a-b).map(i=>layer.features[i]);
 }
 function render(canvas,layers,source){const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas context unavailable');
  const factor=source?.factor||1,dx=source?.dx||0,dy=source?.dy||0,side=canvas.width;
  const approximate=!!source?.approximate;
  // Parent geometry coordinates cover one full native tile. Transform into child tile pixels.
  // Render directly as vectors (not stretched pixels), so outlines remain clear at zoom 13-20.
  ctx.save();ctx.clearRect(0,0,canvas.width,canvas.height);ctx.beginPath();ctx.rect(0,0,canvas.width,canvas.height);ctx.clip();
  ctx.setTransform(factor,0,0,factor,-dx*side,-dy*side);
  let polygons=0,candidatesChecked=0;
  for(const layer of layers){const scale=side/(layer.extent||4096);ctx.fillStyle=approximate?'rgba(255,202,49,0.24)':'rgba(245,145,34,0.91)';ctx.strokeStyle=approximate?'rgba(253,199,41,0.9)':'rgba(163,75,14,0.92)';ctx.lineWidth=(approximate?1.8:1.15)/factor;ctx.setLineDash(approximate?[4/factor,3/factor]:[]);
   const nearby=croppedFeatures(layer,source);
   for(const f of nearby){candidatesChecked++;if(f.type!==3||!f.geom.length)continue;const paths=f._rings||(f._rings=rings(f.geom));if(!paths.length)continue;
    featureBounds(f);
    const [minX,maxX,minY,maxY]=f._bounds,extent=layer.extent||4096;
    const cropLeft=dx*extent/factor,cropRight=(dx+1)*extent/factor,cropTop=dy*extent/factor,cropBottom=(dy+1)*extent/factor;
    if(maxX<cropLeft-5||minX>cropRight+5||maxY<cropTop-5||minY>cropBottom+5)continue;
    ctx.beginPath();for(const ring of paths){ctx.moveTo(ring[0][0]*scale,ring[0][1]*scale);for(let i=1;i<ring.length;i++)ctx.lineTo(ring[i][0]*scale,ring[i][1]*scale);ctx.closePath();}
    ctx.fill('evenodd');ctx.stroke();polygons++;
   }
  }
  ctx.restore();canvas.dataset.f03Checked=String(candidatesChecked);return polygons;
 }
 function insideRing(point,ring){let inside=false;const [px,py]=point;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [ax,ay]=ring[i],[bx,by]=ring[j];
  if((ay>py)!==(by>py)&&px<(bx-ax)*(py-ay)/(by-ay)+ax)inside=!inside;
 }return inside;}
 function insidePolygon(point,allRings){let inside=false;for(const r of allRings)if(insideRing(point,r))inside=!inside;return inside;}
 function toLngLat(px,py,z,x,y,extent){const n=2**z,worldX=(x+px/extent)/n,worldY=(y+py/extent)/n;
  const lon=worldX*360-180,lat=Math.atan(Math.sinh(Math.PI*(1-2*worldY)))*180/Math.PI;
  return [+lon.toFixed(6),+lat.toFixed(6)];}
 async function tileFragmentAt(year,lat,lng){
  const z=MAX_NATIVE_ZOOM,n=2**z,fx=(lng+180)/360*n,fy=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n;
  const x=Math.floor(fx),y=Math.floor(fy),layers=await getTileLayers(year,z,x,y);
  let partIndex=0;
  for(const layer of layers){const extent=layer.extent||4096,p=[(fx-x)*extent,(fy-y)*extent];
   for(const feature of layer.features){const idx=partIndex++;if(feature.type!==3)continue;
    const paths=feature._rings||(feature._rings=rings(feature.geom));if(!paths.length||!insidePolygon(p,paths))continue;
    let points=0;const geo=[];
    for(const ring of paths){if(ring.length<3)continue;const coords=ring.map(([xx,yy])=>toLngLat(xx,yy,z,x,y,extent));points+=coords.length;if(points>12000)return null;
     if(coords.length>=3){const a=coords[0],b=coords[coords.length-1];if(a[0]!==b[0]||a[1]!==b[1])coords.push([...a]);geo.push(coords);}}
    if(geo.length)return {key:`TILE-${year}-${z}-${x}-${y}-${idx}`,year,source:'tile',objectId:null,geometry:{type:'Polygon',coordinates:geo},tile:{z,x,y,idx}};
   }
  }
  return null;
 }

 /* A scan enumerates clipped MVT *fragments* only, never official complete land parcels. */
 function mercXY(lat,lng,z){const n=2**z,clamped=Math.max(-85.0511,Math.min(85.0511,lat));return {x:(lng+180)/360*n,y:(1-Math.asinh(Math.tan(clamped*Math.PI/180))/Math.PI)/2*n};}
 function tileRange(bounds,z=MAX_NATIVE_ZOOM){const nw=mercXY(bounds.north,bounds.west,z),se=mercXY(bounds.south,bounds.east,z),n=2**z;
  return {xmin:Math.max(0,Math.floor(nw.x)),xmax:Math.min(n-1,Math.floor(se.x)),ymin:Math.max(0,Math.floor(nw.y)),ymax:Math.min(n-1,Math.floor(se.y))};}
 function pickInterior(paths){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const ring of paths)for(const [x,y] of ring){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  if(!Number.isFinite(minX)||maxX===minX||maxY===minY)return null;
  for(const split of [1,3,7,15])for(let i=0;i<split;i++)for(let j=0;j<split;j++){
   const p=[minX+(i+.5)/split*(maxX-minX),minY+(j+.5)/split*(maxY-minY)];
   if(insidePolygon(p,paths))return p;
  }
  // For very thin slivers, use the midpoint of an edge slightly inset.
  for(const ring of paths){if(ring.length<3)continue;
   const avg=ring.reduce((a,p)=>[a[0]+p[0]/ring.length,a[1]+p[1]/ring.length],[0,0]);
   for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];const p=[(a[0]+b[0])/2*.999+avg[0]*.001,(a[1]+b[1])/2*.999+avg[1]*.001];if(insidePolygon(p,paths))return p;}
  }
  return null;
 }
 function candidatesFromTile(year,z,x,y,layers,bounds){const rows=[];let idx=0;
  for(const layer of layers){for(const f of layer.features){const current=idx++;if(f.type!==3||!f.geom.length)continue;
   const paths=f._rings||(f._rings=rings(f.geom)),p=pickInterior(paths);if(!p)continue;
   const [lng,lat]=toLngLat(p[0],p[1],z,x,y,layer.extent||4096);
   if(lat<bounds.south||lat>bounds.north||lng<bounds.west||lng>bounds.east)continue;
   rows.push({key:`TILE-${year}-${z}-${x}-${y}-${current}`,year,lat,lng,tile:{z,x,y,idx:current},source:'tile'});
  }}return rows;
 }
 return {ENDPOINT,LAYERS,MAX_NATIVE_ZOOM,tileURL,sourceTile,getTileLayers,getDisplayTileLayers,getOriginalTilePolygons,renderOriginalPolygons,originalTileBounds,originalStatus,clearSourceCache,parseTile,rings,render,insideRing,insidePolygon,toLngLat,tileFragmentAt,mercXY,tileRange,pickInterior,candidatesFromTile};
});

'use strict';
/* 豬場查詢 V3.3.6：底圖自動備援＋獨立圖磚診斷，舊版資料作底，不把未核定者當作已確認。 */
const $=id=>document.getElementById(id), C=window.PigCore;
const STORAGE='pig-farm-workbench-v3.0';
const STORAGE_DB='pig-farm-map-store';
const F03='https://gis.forest.gov.tw/arcgis/rest/services/BA/BA_%E8%BE%B2%E6%A5%AD%E5%8F%8A%E8%BE%B2%E5%9C%B0%E8%B3%87%E6%BA%90%E7%9B%A4%E6%9F%A5%E5%9C%96%E8%B3%87/MapServer';
const COLORS={pig:'#288764',maybe:'#efa134',other:'#7c9197',unchecked:'#4a81ad'};
const CATEGORY={pig:'豬場',maybe:'疑似豬場',other:'其他用途',unchecked:'待判讀'};
const STATE={zones:[],activeZoneId:null,queueZoneId:null,zoneAreaLayers:[],zoneCandidateLayers:[],showZoneOutlines:true,showZoneCandidates:true,candidateSkips:{},queueRows:[],queueSelectedKey:null,queueSeq:0,queueBounds:null,queueScanActive:false,queueHighlights:[],showAuditAreas:true,auditAreaGroups:[],inspectPreviewGroups:[],audits:{},inspectPoint:null,inspectParcel:null,inspectSeq:0,pendingSnap:null,mobileAimActive:false,savingAudit:false,failedAuditKey:null,records:[],selected:null,tool:'browse',locateId:null,draw:[],drawLayers:[],markerGroups:[],selectedFarmGroups:[],auditGroups:[],filtered:[],maps:[],bases:[],f03:null,f03Year:0,f03Gen:0,year:4,opacity:0.7,showF03:true,view:'both',mapReady:false,linking:false,saveTimer:null,viewSaveTimer:null,layerTimer:null,toastTimer:null,center:[23.704,120.398],zoom:12};
function html(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function notice(message){const el=$('toast');el.textContent=message;el.hidden=false;clearTimeout(STATE.toastTimer);STATE.toastTimer=setTimeout(()=>el.hidden=true,3600);}
/* V3.3.6: 每次寫入前固定資料快照；新增完整校驗和一次啟動期間的安全副本。
 * 舊版 pig-map-v3 JSON（沒有 integrity）仍可讀。 */
let dbPromise=null,writeChain=Promise.resolve(),dirtyRev=0,committedRev=0,lastSavedMethod='',lastWrittenAt='',saveFailed=false;
let safetyIdbWritten=false,safetyLocalWritten=false,externalConflict=false,loadedFromSafety=false;
let lastOwnSnapshotId='',latestHealth='尚未執行資料健檢';
const STORAGE_SAFETY=STORAGE+'-safety';
function database(){
 if(!window.indexedDB)return Promise.reject(Error('瀏覽器未提供 IndexedDB'));
 if(dbPromise)return dbPromise;
 dbPromise=new Promise((resolve,reject)=>{
  let finished=false,req,timeout=setTimeout(()=>finish(false,Error('IndexedDB 開啟逾時')),4500);
  function finish(ok,value){if(finished)return;finished=true;clearTimeout(timeout);ok?resolve(value):reject(value);}
  try{req=indexedDB.open(STORAGE_DB,1);}catch(e){finish(false,e);return;}
  req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('snapshots'))req.result.createObjectStore('snapshots');};
  req.onerror=()=>finish(false,req.error||Error('IndexedDB open error'));
  req.onblocked=()=>finish(false,Error('IndexedDB 被其他視窗阻擋'));
  req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>db.close();finish(true,db);};
 }).catch(err=>{dbPromise=null;throw err;});return dbPromise;
}
async function idbReadSlot(key='current'){const db=await database();return new Promise((resolve,reject)=>{
 try{const tx=db.transaction('snapshots','readonly'),req=tx.objectStore('snapshots').get(key);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error||Error('IndexedDB read error'));tx.onabort=()=>reject(tx.error||Error('IndexedDB read aborted'));}catch(e){reject(e);}
});}
async function idbRead(){return idbReadSlot('current');}
async function idbWrite(snapshot){const db=await database();return new Promise((resolve,reject)=>{
 try{
  const tx=db.transaction('snapshots','readwrite'),store=tx.objectStore('snapshots');
  if(!safetyIdbWritten){const old=store.get('current');old.onsuccess=()=>{if(validSnapshot(old.result))store.put(old.result,'safety');};}
  store.put(snapshot,'current');
  tx.oncomplete=()=>{safetyIdbWritten=true;resolve(true);};tx.onerror=()=>reject(tx.error||Error('IndexedDB write error'));tx.onabort=()=>reject(tx.error||Error('IndexedDB write aborted'));
 }catch(e){reject(e);}
});}
function localReadSlot(key=STORAGE){try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):null;}catch(e){console.warn('localStorage read unavailable',e);return null;}}
function localRead(){return localReadSlot();}
function localWrite(snapshot){try{
  if(!safetyLocalWritten){const old=localRead();if(validSnapshot(old)){try{localStorage.setItem(STORAGE_SAFETY,JSON.stringify(old));}catch(e){console.warn('安全副本寫入失敗',e);}}safetyLocalWritten=true;}
  localStorage.setItem(STORAGE,JSON.stringify(snapshot));return true;
 }catch(e){console.warn('localStorage write unavailable',e);return false;}}
function hashString(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');}
function snapshotDigest(v){return hashString(JSON.stringify([v.version,v.records,v.audits||{},v.zones||[],v.candidateSkips||{}]));}
function validSnapshot(v){return !!v&&v.version===C.VERSION&&Array.isArray(v.records)&&v.records.every(r=>r&&typeof r==='object')&&(!v.integrity||v.integrity.algorithm==='fnv1a32-v1'&&v.integrity.digest===snapshotDigest(v));}
function snapshotTime(v){return Date.parse(v?.savedAt||v?.exportedAt||'')||0;}
function currentSnapshot(){const map=STATE.maps[0];if(map){const c=map.getCenter();STATE.center=[c.lat,c.lng];STATE.zoom=map.getZoom();}
 // JSON clone prevents in-flight async writes from observing later user edits.
 const snap=JSON.parse(JSON.stringify({version:C.VERSION,savedAt:new Date().toISOString(),snapshotId:'s-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10),records:STATE.records,audits:STATE.audits,view:STATE.view,year:STATE.year,showF03:STATE.showF03,opacity:STATE.opacity,showAuditAreas:STATE.showAuditAreas,zones:STATE.zones,activeZoneId:STATE.activeZoneId,candidateSkips:STATE.candidateSkips,showZoneOutlines:STATE.showZoneOutlines,showZoneCandidates:STATE.showZoneCandidates,center:STATE.center,zoom:STATE.zoom}));
 snap.integrity={algorithm:'fnv1a32-v1',digest:snapshotDigest(snap)};return snap;
}
async function storageRead(){const local=localRead();let indexed=null;
 try{indexed=await idbRead();}catch(e){console.warn('IndexedDB read unavailable',e);}
 if(validSnapshot(indexed)&&(!validSnapshot(local)||snapshotTime(indexed)>=snapshotTime(local)))return {data:indexed,method:'IndexedDB'};
 if(validSnapshot(local))return {data:local,method:'localStorage'};
 return {data:null,method:''};
}
async function safetyRead(){let indexed=null;try{indexed=await idbReadSlot('safety');}catch(e){}
 const local=localReadSlot(STORAGE_SAFETY);
 if(validSnapshot(indexed)&&(!validSnapshot(local)||snapshotTime(indexed)>=snapshotTime(local)))return {data:indexed,method:'IndexedDB 安全副本'};
 if(validSnapshot(local))return {data:local,method:'localStorage 安全副本'};
 return {data:null,method:''};
}
function blockedByOtherTab(){if(!externalConflict)return false;saveFailed=true;$('saveState').textContent='其他分頁已修改資料：先備份，再重新開啟此頁';$('saveState').classList.add('save-error');return true;}
function persist(immediate=false){
 clearTimeout(STATE.viewSaveTimer);STATE.viewSaveTimer=null;
 dirtyRev++;$('saveState').textContent=externalConflict?'其他分頁已更新：此頁暫停寫入':'尚未完成儲存';clearTimeout(STATE.saveTimer);
 if(externalConflict){blockedByOtherTab();return;}
 if(immediate)return flushSave();
 STATE.saveTimer=setTimeout(()=>{flushSave();},350);
}
/* Moving a map does not change farm/audit content: coalesce view-only writes. */
function scheduleViewSave(){
 clearTimeout(STATE.viewSaveTimer);
 if(!externalConflict&&!saveFailed)$('saveState').textContent='地圖位置待儲存…';
 STATE.viewSaveTimer=setTimeout(()=>{STATE.viewSaveTimer=null;persist();},1800);
}
function flushSave(){
 clearTimeout(STATE.saveTimer);if(blockedByOtherTab())return Promise.resolve(false);
 const rev=dirtyRev,snap=currentSnapshot();
 if(rev<=committedRev)return writeChain;
 writeChain=writeChain.catch(()=>false).then(async()=>{
  if(blockedByOtherTab())return false;
  let idbOk=false,localOk=false;
  try{await idbWrite(snap);idbOk=true;}catch(e){console.warn('IndexedDB write failed',e);}
  localOk=localWrite(snap);
  const ok=idbOk||localOk;
  if(ok){committedRev=Math.max(committedRev,rev);saveFailed=false;lastWrittenAt=snap.savedAt;lastOwnSnapshotId=snap.snapshotId;lastSavedMethod=idbOk?(localOk?'IndexedDB＋備援':'IndexedDB'):'localStorage';}
  else {saveFailed=true;lastSavedMethod='';}
  if(rev===dirtyRev){$('saveState').textContent=ok?'已儲存：'+lastSavedMethod:'保存失敗，請立即下載 JSON 備份';$('saveState').classList.toggle('save-error',!ok);}
  return ok;
 });
 return writeChain;
}
async function saveNow(){if(blockedByOtherTab()){notice('另一分頁已有更新。請先下載 JSON 備份，再重新載入頁面，避免覆寫。');return;}
 persist(true);const ok=await writeChain;
 if(!ok){notice('瀏覽器無法儲存！請按「備份」下載完整 JSON。');return;}
 const a=await storageRead(),s=a.data;const current=currentSnapshot();
 const verified=validSnapshot(s)&&s.snapshotId===lastOwnSnapshotId&&snapshotDigest(s)===snapshotDigest(current);
 if(verified)notice('完整資料校驗成功：'+a.method+'；'+s.records.length+' 筆豬場、'+Object.keys(s.audits||{}).length+' 筆查核。');
 else notice('儲存後完整資料校驗未通過，請立即下載 JSON 備份。');
}
function applySavedState(saved){
 STATE.records=saved.records.map(C.normalize).filter(Boolean);STATE.audits=validAudits(saved.audits);STATE.zones=validZones(saved.zones);STATE.candidateSkips=validCandidateSkips(saved.candidateSkips);STATE.showZoneOutlines=saved.showZoneOutlines!==false;STATE.showZoneCandidates=saved.showZoneCandidates!==false;STATE.activeZoneId=STATE.zones.some(z=>z.id===saved.activeZoneId)?saved.activeZoneId:null;
 STATE.view=['both','survey','aerial'].includes(saved.view)?saved.view:'both';STATE.year=saved.year===5?5:4;STATE.showF03=saved.showF03!==false;
 STATE.opacity=Math.min(1,Math.max(.15,Number(saved.opacity)||.7));STATE.showAuditAreas=saved.showAuditAreas!==false;
 if(Array.isArray(saved.center)&&C.coord(+saved.center[0],+saved.center[1]))STATE.center=[+saved.center[0],+saved.center[1]];
 STATE.zoom=Math.max(7,Math.min(20,Number(saved.zoom)||12));
}
async function initializeData(){
 STATE.records=C.legacyToAll(window.PIG_FARM_LEGACY_SEED||[]);
 let {data:saved,method}=await storageRead();let restored=false;
 if(!saved){const prior=await safetyRead();if(prior.data){saved=prior.data;method=prior.method;loadedFromSafety=true;}}
 if(validSnapshot(saved)){
  applySavedState(saved);restored=true;lastOwnSnapshotId=saved.snapshotId||'';
  $('saveState').textContent='已讀取：'+method+(loadedFromSafety?'（原資料異常，請先下載備份）':'');lastSavedMethod=method;
  if(loadedFromSafety){$('saveState').classList.add('save-error');}
 }else{
  try{const old=localStorage.getItem('tw-pig-farm-survey-v2.0');if(old){const existing=C.importJson(JSON.parse(old));const merge=C.merge(STATE.records,existing);STATE.records=merge.records;if(merge.added)notice(`找到 V2 舊標記，已另外併入 ${merge.added} 筆。`);}}catch(e){console.warn('V2 migration skipped',e);}
  $('saveState').textContent='已載入內建資料，正在保存';
 }
 renderStats();renderList();renderZones();if(!restored||method==='localStorage')if(!loadedFromSafety)persist(true);
}
function renderStats(){const n=C.counts(STATE.records);$('nAll').textContent=n.total;$('nMapped').textContent=n.located;$('nUnmapped').textContent=n.missing;$('nApproved').textContent=n.approved;$('nAudited').textContent=Object.values(STATE.audits).filter(x=>['pig','maybe','other'].includes(x.decision)).length;renderAuditHistory();renderStatExplorer();if(window.F03Local?.getPackaged(4))updateF03MatchBadge();}
/* V3.3.26: every headline count opens its exact underlying records. */
let activeStatView=null;
const STAT_TITLES={all:'已匯入總數',located:'有座標',missing:'待定位',approved:'全部核定',audited:'已查地塊'};
function statExplorerItems(){
 if(activeStatView==='audited')return Object.values(STATE.audits).filter(a=>['pig','maybe','other'].includes(a.decision)).sort((a,b)=>(b.checkedAt||'').localeCompare(a.checkedAt||''));
 return STATE.records.filter(r=>activeStatView==='all'||activeStatView==='located'&&!!C.center(r)||activeStatView==='missing'&&!C.center(r)||activeStatView==='approved'&&r.review==='approved')
 .sort((a,b)=>(a.town||'').localeCompare(b.town||'','zh-Hant')||(a.name||'').localeCompare(b.name||'','zh-Hant'));
}
function showStatExplorer(view){
 if(!STAT_TITLES[view])return;
 activeStatView=view;
 $('statExplorer').hidden=false;$('statExplorerScrim').hidden=false;
 $('statExplorerTitle').textContent=STAT_TITLES[view]+' · 明細追查';
 $('statExplorerSearch').value='';$('statExplorerDecision').value='all';$('statExplorerDecision').hidden=view!=='audited';
 renderStatExplorer();$('statExplorerSearch').focus();
}
function closeStatExplorer(){activeStatView=null;$('statExplorer').hidden=true;$('statExplorerScrim').hidden=true;}
function renderStatExplorer(){
 if(!activeStatView||$('statExplorer').hidden)return;
 const all=statExplorerItems(),q=$('statExplorerSearch').value.trim().toLocaleLowerCase(),dec=$('statExplorerDecision').value;
 const filtered=all.filter(r=>{
  if(activeStatView==='audited'){
   if(dec!=='all'&&r.decision!==dec)return false;
   const linked=STATE.records.find(x=>x.uid===r.recordUid);
   return [auditLabel(r),r.source,r.note,r.key,r.objectId,linked?.name,linked?.town,linked?.address].join(' ').toLocaleLowerCase().includes(q);
  }
  return [r.name,r.county,r.town,r.village,r.address,r.legacyId,r.uid,r.note].join(' ').toLocaleLowerCase().includes(q);
 });
 $('statExplorerCount').textContent=`共 ${all.length} 筆 · 符合搜尋 ${filtered.length} 筆`;
 $('statExplorerList').innerHTML=filtered.length?filtered.map(r=>{
  if(activeStatView==='audited'){
   const linked=STATE.records.find(x=>x.uid===r.recordUid);
   const pos=C.coord(Number(r.lat),Number(r.lng))?`${Number(r.lat).toFixed(6)}, ${Number(r.lng).toFixed(6)}`:'座標未確認';
   return `<button type="button" class="stat-explorer-item" data-stat-audit="${html(r.key)}"><strong>${html(auditLabel(r))} · ${html(linked?.name||'人工查核地塊')}</strong><small>${html(r.source==='manual'?'人工位置':r.source==='tile'?'圖磚局部輪廓':'官方／匯入地塊')} · ${html(pos)} · ${html((r.checkedAt||'').slice(0,10))}</small><span>查看查核記錄與修改／取消標記 ›</span></button>`;
  }
  const p=C.center(r);
  return `<button type="button" class="stat-explorer-item" data-stat-farm="${html(r.uid)}"><strong>${html(r.name||'未命名地點')}</strong><small>${html([r.county||'縣市未填',r.town||'鄉鎮未填',r.address||'地址未填'].join(' · '))}</small><span>${p?'⌖ 定位地圖':'✎ 尚無座標，開啟編輯定位'} · ${r.review==='approved'?'已核定':'尚未核定'} ›</span></button>`;
 }).join(''):'<p class="empty">此條件沒有紀錄，請調整搜尋。</p>';
}
function initStatExplorer(){
 document.querySelectorAll('[data-stat-view]').forEach(button=>button.addEventListener('click',()=>showStatExplorer(button.dataset.statView)));
 $('statExplorerClose').addEventListener('click',closeStatExplorer);$('statExplorerScrim').addEventListener('click',closeStatExplorer);
 $('statExplorerSearch').addEventListener('input',renderStatExplorer);$('statExplorerDecision').addEventListener('change',renderStatExplorer);
 $('statExplorerList').addEventListener('click',e=>{
  const farm=e.target.closest('[data-stat-farm]'),audit=e.target.closest('[data-stat-audit]');
  if(farm){const uid=farm.dataset.statFarm,r=STATE.records.find(x=>x.uid===uid);closeStatExplorer();if(r){focusFarmRecord(uid,{move:true});if(!C.center(r)){if(window.PigCommunity?.enabled)window.PigCommunity.edit(uid);else openRecord(uid);}}}
  else if(audit){const key=audit.dataset.statAudit;closeStatExplorer();openSavedAudit(key);}
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('statExplorer').hidden){e.preventDefault();closeStatExplorer();}});
}
/* V3.3.15：台灣 22 縣市固定可選，豬場清單預設不鎖定鄉鎮。
   原始記錄不經此篩選修改；空的縣市仍顯示 0 筆以供日後擴充。 */
const TAIWAN_COUNTIES=['臺北市','新北市','桃園市','臺中市','臺南市','高雄市','基隆市','新竹市','嘉義市','新竹縣','苗栗縣','彰化縣','南投縣','雲林縣','嘉義縣','屏東縣','宜蘭縣','花蓮縣','臺東縣','澎湖縣','金門縣','連江縣'];
function countyKey(v){return String(v||'').trim().replace(/^台(?=北|中|南|東)/,'臺');}
function listFiltered(){
 const q=$('search').value.trim().toLocaleLowerCase(),county=$('filterCounty').value,town=$('filterTown').value,filter=$('filterReview').value;
 return STATE.records.filter(r=>{
  if(county!=='all'&&countyKey(r.county)!==county)return false;
  if(town!=='all'&&r.town!==town)return false;
  const located=!!C.center(r);
  if(filter==='located'&&!located||filter==='missing'&&located||filter==='approved'&&r.review!=='approved'||filter==='pending'&&r.review==='approved'||filter==='pig'&&r.category!=='pig'||filter==='maybe'&&r.category!=='maybe')return false;
  if(q&&!([r.name,r.county,r.town,r.village,r.address,r.legacyId,r.uid,r.note,r.source].join(' ').toLocaleLowerCase().includes(q)))return false;
  return true;
 }).sort((a,b)=>Number(!!C.center(b))-Number(!!C.center(a))||Number(b.review==='approved')-Number(a.review==='approved')||a.name.localeCompare(b.name,'zh-Hant'));
}
function renderList(){const filtered=listFiltered();STATE.filtered=filtered;$('resultCount').textContent=`${filtered.length} 筆`;
 const parent=$('farmList');parent.innerHTML=filtered.length?filtered.map(r=>{
  const located=!!C.center(r);let cls=r.review==='approved'?'approved':located?'':'missing',label=r.review==='approved'?'全部核定':located?'待核位置':'待定位';
  return `<div class="farm-entry" role="listitem"><button type="button" class="farm-item ${r.uid===STATE.selected?'active':''}" data-id="${html(r.uid)}" aria-pressed="${r.uid===STATE.selected?'true':'false'}" title="定位並醒目標示在地圖上"><span class="row1"><span class="title">${html(r.name||'未命名地點')}</span><span class="smalltag ${cls}">${label}</span></span><small>${html([countyKey(r.county)||'縣市待查',r.town||'鄉鎮待查'].join(' · '))} · ${html(r.address&&r.address!=='未公開地址，待人工確認'?r.address:'地址待查')} ${r.legacyId!=null?'· #'+html(r.legacyId):''}</small></button><button type="button" class="farm-edit-btn" data-open-editor="${html(r.uid)}" aria-label="編輯 ${html(r.name||'未命名地點')}" title="開啟詳細資料編輯">✎ 編輯</button></div>`;
 }).join(''):'<div class="empty">這個縣市／鄉鎮目前沒有符合條件的豬場紀錄。其他縣市可新增或匯入資料；請更換篩選條件。</div>';
 renderMarkers();renderSelectedFarmHighlight();}
function updateTownOptions({resetTown=false}={}){
 const countyEl=$('filterCounty'),townEl=$('filterTown');
 const selectedCounty=countyEl.value||'all';
 const counts=new Map();for(const r of STATE.records){const c=countyKey(r.county);counts.set(c,(counts.get(c)||0)+1);}
 const extra=[...counts.keys()].filter(x=>x&&!TAIWAN_COUNTIES.includes(x)).sort((a,b)=>a.localeCompare(b,'zh-Hant'));
 countyEl.innerHTML='<option value="all">全台灣（全部縣市）</option>'+[...TAIWAN_COUNTIES,...extra].map(c=>`<option value="${html(c)}">${html(c)}（${counts.get(c)||0}）</option>`).join('');
 countyEl.value=selectedCounty==='all'||[...TAIWAN_COUNTIES,...extra].includes(selectedCounty)?selectedCounty:'all';
 const activeCounty=countyEl.value;
 const towns=[...new Set(STATE.records.filter(r=>activeCounty==='all'||countyKey(r.county)===activeCounty).map(r=>r.town).filter(Boolean))];
 const sorted=towns.sort((a,b)=>{
  const rank=t=>t==='虎尾鎮'?0:t==='土庫鎮'?1:2;
  return rank(a)-rank(b)||a.localeCompare(b,'zh-Hant');
 });
 const selectedTown=resetTown?'all':townEl.value||'all';
 townEl.innerHTML='<option value="all">全部鄉鎮</option>'+sorted.map(t=>`<option value="${html(t)}">${html(t)}</option>`).join('');
 townEl.value=sorted.includes(selectedTown)?selectedTown:'all';
}
/* V3.3.15: 選取標記不受清單篩選或普通地塊圖層重繪影響。 */
function renderSelectedFarmHighlight(){
 const r=STATE.records.find(x=>x.uid===STATE.selected),p=r?C.center(r):null;
 for(const g of STATE.selectedFarmGroups||[])g.clearLayers();
 const card=$('selectedFarmCard');
 if(card){card.hidden=!r||!p;if(r&&p){$('selectedFarmName').textContent=r.name||'未命名地點';$('selectedFarmName').title=r.name||'未命名地點';$('selectedFarmCoordinates').textContent=`${r.town||'鄉鎮待查'} · ${p[0].toFixed(6)}, ${p[1].toFixed(6)}`;}}
 if(!r||!p||!STATE.mapReady||!STATE.selectedFarmGroups?.length)return;
 for(const g of STATE.selectedFarmGroups){
  const target=L.marker(p,{icon:L.divIcon({className:'farm-focus-icon',html:'<span class="farm-focus-target"><span class="farm-focus-halo"></span><span class="farm-focus-bullseye"></span></span>',iconSize:[44,44],iconAnchor:[22,22]}),pane:'selectedFarmPane',interactive:false,keyboard:false,zIndexOffset:1000});
  target.bindTooltip(`<button type="button" class="farm-tooltip-info" data-farm-info="${html(r.uid)}" aria-label="查看 ${html(r.name||'未命名地點')} 詳細資料"><span class="farm-tooltip-text">${html(r.name||'未命名地點')}</span><span class="farm-tooltip-symbol" aria-hidden="true">ⓘ</span></button>`,{permanent:true,direction:'top',offset:[0,-35],className:'farm-selected-tooltip',opacity:1,interactive:true}); // 點選橫向名稱才開資訊；定位本身不開視窗。
  g.addLayer(target);
 }
}
function focusFarmRecord(uid,{move=true}={}){
 const r=STATE.records.find(x=>x.uid===uid);if(!r)return false;
 STATE.selected=r.uid;const p=C.center(r);
 if(move&&p&&STATE.mapReady){
  const zoom=Math.max(16,STATE.maps[STATE.view==='aerial'?1:0]?.getZoom()||STATE.zoom);
  // 直接移動兩張地圖，無需等待事件同步。尤其須保證右邊的正射影像有定位。
  for(const m of STATE.maps)m.setView(p,zoom,{animate:false});
 }
 renderList(); // renderList 同步更新雙圖選取標記；避免重複清除、重畫
 if(!p)notice('「'+(r.name||'未命名地點')+'」尚無座標：請按右側「編輯」新增定位，不能在地圖上標示。');
 else if(!STATE.mapReady)notice('已選取豬場；地圖套件載入失敗，暫無法定位。');
 return true;
}
/* V3.3.21：將地圖選取與豬場資訊分開。只有資訊按鈕或名稱被點擊，才開啟唯讀詳情。 */
let farmInfoLastFocus=null;
function showFarmDetails(uid){
 const r=STATE.records.find(x=>x.uid===uid);if(!r)return false;
 const p=C.center(r);farmInfoLastFocus=document.activeElement;
 const put=(id,value)=>{const el=$(id);if(el)el.textContent=String(value??'—')||'—';};
 put('farmInfoName',r.name||'未命名地點');
 put('farmInfoId',r.legacyId!=null?'原始編號 #'+r.legacyId:'紀錄 ID '+r.uid);
 put('farmInfoLocation',[countyKey(r.county),r.town,r.village].filter(Boolean).join(' · ')||'待補縣市鄉鎮');
 put('farmInfoAddress',r.address&&r.address!=='未公開地址，待人工確認'?r.address:'地址待查');
 put('farmInfoCoordinates',p?`${p[0].toFixed(6)}° N, ${p[1].toFixed(6)}° E`:'尚未定位');
 put('farmInfoReview',r.review==='approved'?'已標記為全部核定（舊資料狀態）':'尚未全部核定');
 put('farmInfoCategory',({pig:'豬場（人工判定）',maybe:'疑似豬場',other:'其他／非豬場',unchecked:'尚未判定'})[r.category]||'尚未判定');
 put('farmInfoSource',r.source||'未註明');
 put('farmInfoNote',r.note||'未註明');
 $('farmInfoBackdrop').hidden=false;$('farmInfoDialog').hidden=false;
 $('farmInfoClose').focus();
 return true;
}
function closeFarmDetails(){
 if($('farmInfoDialog').hidden)return;
 $('farmInfoDialog').hidden=true;$('farmInfoBackdrop').hidden=true;
 if(farmInfoLastFocus?.isConnected)farmInfoLastFocus.focus({preventScroll:true});
 farmInfoLastFocus=null;
}
function editSelectedFarmFromDetails(){
 const uid=STATE.selected;if(!uid)return;
 closeFarmDetails();
 if(window.PigCommunity?.enabled)window.PigCommunity.edit(uid);
 else openRecord(uid,false);
}
function openRecord(uid,pan=true){const r=STATE.records.find(x=>x.uid===uid);if(!r)return;focusFarmRecord(uid,{move:pan});const c=C.center(r);$('editID').textContent=r.legacyId!=null?'舊版 #'+r.legacyId+'　｜　'+r.uid:r.uid;$('editTitle').textContent=r.name||'未命名地點';
 $('fieldName').value=r.name;$('fieldCounty').value=countyKey(r.county)||'雲林縣';if(!$('fieldCounty').value){const opt=new Option(r.county,r.county);$('fieldCounty').add(opt);$('fieldCounty').value=r.county;}$('fieldTown').value=r.town;$('fieldCategory').value=r.category;$('fieldAddress').value=r.address;$('fieldReview').value=r.review;$('fieldImageYear').value=r.imageYear;$('fieldEvidence').value=r.evidence;$('fieldNote').value=r.note;
 $('fieldLat').value=c?c[0].toFixed(8):'';$('fieldLng').value=c?c[1].toFixed(8):'';const polygon=r.geometry?.type==='Polygon';$('fieldLat').readOnly=polygon;$('fieldLng').readOnly=polygon;
 $('originalInfo').textContent=`舊狀態：${r.originalStatus||'無'}；舊資料位置審核：${r.legacy?.mapLocationReview||'無'}；舊資料最終核定：${r.legacy?.finalApproval||'無'}。${polygon?'多邊形不可直接用經緯度欄位修改外框。':''}`;
 $('editor').hidden=false;$('editorBackdrop').hidden=false;}
function closeEditor(){$('editor').hidden=true;$('editorBackdrop').hidden=true;}
function createPointAt(lat,lng,editExisting=null){if(window.PigCommunity?.enabled)return notice('公開協作模式不允許建立本機未同步場址；請先在清單選擇既有紀錄並提交共用修改。');if(editExisting){const r=STATE.records.find(x=>x.uid===editExisting);if(!r)return;r.geometry={type:'Point',coordinates:[lng,lat]};r.updatedAt=new Date().toISOString();r.review='pending';notice('已重新定位，請再次核對及儲存。');persist();renderList();openRecord(r.uid,false);return;}
 const r=C.normalize({uid:newId(),geometry:{type:'Point',coordinates:[lng,lat]},name:'未命名地點',category:'unchecked',review:'pending',county:$('filterCounty').value==='all'?'雲林縣':$('filterCounty').value,town:'',source:'人工地圖點選',evidence:'待比對 ATIS 影像',createdAt:new Date().toISOString()});STATE.records.push(r);updateTownOptions();renderStats();persist();renderList();openRecord(r.uid,false);}
function newId(){let id;do{id='manual-'+Date.now()+'-'+Math.random().toString(36).slice(2,7);}while(STATE.records.some(r=>r.uid===id));return id;}
function saveEditor(evt){evt.preventDefault();if(window.PigCommunity?.enabled){const uid=STATE.selected;closeEditor();window.PigCommunity.edit(uid);notice('公開協作模式：場址更正請送到雲端共用資料庫；不會寫入個人本機後假裝同步。');return;}const r=STATE.records.find(x=>x.uid===STATE.selected);if(!r)return;
 const latText=$('fieldLat').value.trim(),lngText=$('fieldLng').value.trim();let geometry=r.geometry;
 if(!latText&&!lngText){
  if(geometry?.type==='Polygon'){notice('圈選範圍不可透過清空中心座標刪除；若要清除範圍，請使用「清除定位」。');return;}
  geometry=null;
 }
 else if(!latText||!lngText||!C.coord(Number(latText),Number(lngText))){notice('經緯度不正確，請同時填寫有效數值。');return;}
 else if(!geometry||geometry.type==='Point')geometry={type:'Point',coordinates:[+lngText,+latText]};
 else if(geometry.type==='Polygon'){
  const center=C.center(r);
  if(!center||Math.abs(center[0]-Number(latText))>0.000001||Math.abs(center[1]-Number(lngText))>0.000001){
   notice('這筆是圈選範圍：不能只改中心點座標而留下舊邊界。請重新圈選範圍，或保留原座標。');return;
  }
 }
 Object.assign(r,{name:$('fieldName').value.trim(),county:$('fieldCounty').value,town:$('fieldTown').value.trim(),address:$('fieldAddress').value.trim(),category:$('fieldCategory').value,review:$('fieldReview').value,imageYear:$('fieldImageYear').value.trim(),evidence:$('fieldEvidence').value.trim(),note:$('fieldNote').value.trim(),geometry,updatedAt:new Date().toISOString()});
 if(r.review==='approved'){r.lastReviewed=new Date().toISOString();if(r.category==='unchecked')r.category='pig';}
 updateTownOptions();renderStats();renderList();persist();closeEditor();notice('資料已更新，正在寫入瀏覽器；請確認上方儲存狀態。');}
function removeLocation(){if(window.PigCommunity?.enabled)return notice('公開協作模式請透過「共同編輯」提出座標修改。');const r=STATE.records.find(x=>x.uid===STATE.selected);if(!r||!r.geometry)return; if(!confirm(`確定清除「${r.name}」的地圖座標？場名與資料仍會保留。`))return;r.geometry=null;r.review='pending';r.updatedAt=new Date().toISOString();renderStats();renderList();persist();closeEditor();notice('已清除定位，記錄留在待定位清單。');}
function deleteRecord(){if(window.PigCommunity?.enabled)return notice('公開協作模式禁止直接刪除豬場正式紀錄。');const r=STATE.records.find(x=>x.uid===STATE.selected);if(!r||!confirm(`要刪除「${r.name}」這一整筆資料嗎？刪除後只能從備份恢復。`))return;STATE.records=STATE.records.filter(x=>x.uid!==r.uid);STATE.selected=null;updateTownOptions();renderStats();renderList();persist();closeEditor();notice('已刪除。');}
function selectedPoint(){let r=STATE.records.find(x=>x.uid===STATE.selected);return C.center(r)||STATE.maps[0]?.getCenter()||STATE.center;}
function atisLink(point){const lat=Array.isArray(point)?point[0]:point.lat,lon=Array.isArray(point)?point[1]:point.lng;let z=STATE.maps[0]?.getZoom()||17;return `https://gis.asrs.gov.tw/atisweb/@${Number(lon).toFixed(10)},${Number(lat).toFixed(10)},${Math.max(8,Math.min(20,z)).toFixed(2)}z`;}
function openAtis(point){const p=point||selectedPoint();const win=window.open(atisLink(p),'_blank','noopener,noreferrer');if(!win)notice('請允許瀏覽器開啟新分頁。');}
function download(content,filename,mime){const blob=new Blob([content],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),6000);}
function exportJSON(){const snap=currentSnapshot();snap.exportedAt=new Date().toISOString();download(JSON.stringify(snap,null,2),'豬場查詢_V3.3.6_完整備份.json','application/json;charset=utf-8');notice('已下載含完整校驗碼的 JSON 備份，請保存在安全位置。');}
function exportCSV(){download(C.csv(STATE.records),'豬場查詢_全部場址.csv','text/csv;charset=utf-8');notice('CSV 已匯出（包括沒有座標的場址）。');}
function exportGeo(){download(JSON.stringify(C.geojson(STATE.records),null,2),'豬場查詢_已定位標記.geojson','application/geo+json;charset=utf-8');notice('GeoJSON 已匯出（只有有座標的地點）。');}
async function readImport(file){if(!file)return;try{const data=JSON.parse(await file.text());if(data?.integrity&&!validSnapshot(data))throw Error('備份的完整資料校驗不符，已停止匯入，避免覆蓋現有資料。');const incoming=C.importJson(data);
 if(data?.version===C.VERSION&&Array.isArray(data.records)){
   const restore=confirm(`這是 V3 完整備份（${incoming.length} 筆）。\n按「確定」＝以備份取代目前全部資料，保留備份中的所有編輯與核定。\n按「取消」＝不還原，接著可選擇只合併新增資料。`);
   if(restore){STATE.records=incoming;STATE.audits=validAudits(data.audits);STATE.zones=validZones(data.zones);STATE.candidateSkips=validCandidateSkips(data.candidateSkips);STATE.showZoneOutlines=data.showZoneOutlines!==false;STATE.showZoneCandidates=data.showZoneCandidates!==false;STATE.activeZoneId=STATE.zones.some(z=>z.id===data.activeZoneId)?data.activeZoneId:null;STATE.selected=null;updateTownOptions();renderStats();renderList();renderAuditPins();renderZones();persist();notice(`已從完整備份還原 ${incoming.length} 筆及 ${STATE.zones.length} 個工作區。`);return;}
   if(!confirm('是否保留目前資料，只合併備份中不存在的新紀錄？按取消則不匯入。'))return;
 }
 const merged=C.merge(STATE.records,incoming);const incomingAudits=validAudits(data?.audits);const newAudits=Object.entries(incomingAudits).filter(([key])=>!STATE.audits[key]);
 const upgradedShapes=Object.entries(incomingAudits).filter(([key,v])=>STATE.audits[key]&&!validAuditGeo(STATE.audits[key].geometry)&&!!validAuditGeo(v.geometry));
 const incomingZones=validZones(data?.zones).filter(z=>!STATE.zones.some(cur=>cur.id===z.id));
 const incomingSkips=Object.entries(validCandidateSkips(data?.candidateSkips)).filter(([key])=>!STATE.candidateSkips[key]);
 if(!merged.added&&!newAudits.length&&!upgradedShapes.length&&!incomingZones.length&&!incomingSkips.length){notice(`沒有新增豬場、查核紀錄或輪廓；${merged.skipped} 筆豬場重複。如要覆蓋原有編輯，請選擇完整還原。`);return;}
 if(!confirm(`新增豬場 ${merged.added} 筆、查核紀錄 ${newAudits.length} 筆、補齊輪廓 ${upgradedShapes.length} 筆、新增盤查工作區 ${incomingZones.length} 個、人工略過候選 ${incomingSkips.length} 筆；跳過重複豬場 ${merged.skipped} 筆。\n\n合併不會覆寫現有核定資料。是否繼續？`))return;
 STATE.records=merged.records;for(const [key,audit] of newAudits)STATE.audits[key]=audit;for(const [key,audit] of upgradedShapes)STATE.audits[key].geometry=audit.geometry;STATE.zones.push(...incomingZones.slice(0,Math.max(0,30-STATE.zones.length)));for(const [k,v] of incomingSkips)STATE.candidateSkips[k]=v;
 updateTownOptions();renderStats();renderList();renderAuditPins();renderZones();persist();notice(`合併完成：新增豬場 ${merged.added} 筆、查核 ${newAudits.length} 筆、補齊輪廓 ${upgradedShapes.length} 筆。`);}catch(e){notice('匯入失敗：'+e.message);}}

/* V3.3.6: non-destructive browser storage verification. Test keys are independent of user's data. */
async function storageHealth(){
 const results=[],current=await storageRead(),safe=await safetyRead();
 results.push('目前頁面：'+location.origin+location.pathname);
 results.push('資料：'+STATE.records.length+' 筆豬場、'+Object.keys(STATE.audits).length+' 筆查核、'+STATE.zones.length+' 個工作區');
 results.push('目前儲存：'+(current.data?current.method:'無有效快照'));
 results.push('現有資料完整校驗：'+(current.data?(current.data.integrity?'通過':'舊格式（尚無校驗碼）'):'無'));
 results.push('安全副本：'+(safe.data?safe.method+'（'+safe.data.records.length+' 筆）':'尚未建立'));
 results.push('其他分頁覆寫風險：'+(externalConflict?'已偵測，儲存已暫停':'目前未偵測'));
 let idbResult='失敗',localResult='失敗';
 try{const db=await database();const key='health-probe',value='test-'+Math.random();
  idbResult=await new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite'),store=tx.objectStore('snapshots');store.put(value,key);const r=store.get(key);let good=false;r.onsuccess=()=>{good=r.result===value;store.delete(key);};tx.oncomplete=()=>resolve(good?'寫入、讀回及清理成功':'資料不符');tx.onerror=()=>reject(tx.error||Error('IndexedDB probe error'));tx.onabort=()=>reject(tx.error||Error('IndexedDB probe aborted'));});
 }catch(e){idbResult='失敗：'+String(e.message||e).slice(0,100);}
 try{const key=STORAGE+'-health-probe',value='test-'+Math.random();localStorage.setItem(key,value);const good=localStorage.getItem(key)===value;localStorage.removeItem(key);localResult=good?'寫入、讀回及清理成功':'資料不符';}
 catch(e){localResult='失敗：'+String(e.message||e).slice(0,100);}
 results.push('IndexedDB：'+idbResult);results.push('localStorage：'+localResult);
 results.push('備註：此檢查不代表其他裝置可同步，亦不測試外部官方圖資。');
 latestHealth=results.join('\n');$('dataHealthReport').value=latestHealth;
 $('restoreSafety').disabled=!safe.data;$('downloadSafety').disabled=!safe.data;
 $('dataHealthSummary').textContent=externalConflict?'其他分頁資料已變動，請先備份本頁。':(!idbResult.startsWith('寫入')&&!localResult.startsWith('寫入'))?'兩種本機儲存方式都無法完成測試；請立即匯出 JSON 備份。':(!current.data?'尚未找到有效快照。儲存測試結果如下，請先自行備份。':'本機儲存至少有一種方式測試成功，詳情請看報告。');
 return results;
}
async function openDataHealth(){$('dataHealthPanel').hidden=false;$('dataHealthSummary').textContent='正在檢查資料…';await storageHealth();}
async function downloadSafety(){const {data}=await safetyRead();if(!data)return notice('找不到可使用的安全副本。');
 download(JSON.stringify({...data,exportedAt:new Date().toISOString()},null,2),'豬場查詢_V3.3.6_安全副本.json','application/json;charset=utf-8');notice('安全副本已下載，請先確認檔案內容。');}
async function restoreSafety(){const {data}=await safetyRead();if(!data)return notice('找不到有效安全副本。');
 if(!confirm(`安全副本日期：${data.savedAt||'未知'}，內含 ${data.records.length} 筆豬場。\n還原將取代目前畫面所有豬場、查核及工作區；請先按「備份」保存當前資料。確定繼續？`))return;
 if(!confirm('再次確認：目前未匯出的修改可能被安全副本取代。確定還原？'))return;
 // Don't reset current tab's data until the user explicitly approves.
 applySavedState(data);externalConflict=false;loadedFromSafety=false;dirtyRev++;committedRev=dirtyRev-1;
 updateTownOptions();renderStats();renderList();renderAuditPins();renderZones();renderZoneAreas();
 $('f03Year').value=String(STATE.year);$('showF03').checked=STATE.showF03;$('opacity').value=String(Math.round(STATE.opacity*100));$('opacityLabel').textContent=Math.round(STATE.opacity*100)+'%';
 if(STATE.mapReady){STATE.maps[0].setView(STATE.center,STATE.zoom);changeView(STATE.view);scheduleF03();}
 closeDataHealth();persist(true);await writeChain;notice(saveFailed?'還原後寫入失敗，請立即下載 JSON！':'安全副本已還原並寫入；建議再次備份。');}
function closeDataHealth(){$('dataHealthPanel').hidden=true;}
window.addEventListener('storage',e=>{
 if(e.key!==STORAGE||!e.newValue)return;
 try{const incoming=JSON.parse(e.newValue);if(validSnapshot(incoming)&&incoming.snapshotId!==lastOwnSnapshotId){externalConflict=true;blockedByOtherTab();}}catch(err){}
});
function getMapCenter(){return STATE.maps[0]?.getCenter()||{lat:STATE.center[0],lng:STATE.center[1]};}
function goto(p,zoom=14){if(!STATE.mapReady)return notice('地圖尚未載入。');STATE.maps[0].setView(p,zoom);if(STATE.view==='aerial')STATE.maps[1].setView(p,zoom);}
function mode(t){STATE.tool=t;if(t!=='inspect')setMobileAim(false);STATE.draw=[];clearDraw();$('polyActions').hidden=t!=='poly';document.querySelectorAll('[data-tool]').forEach(el=>el.classList.toggle('active',el.dataset.tool===t));$('drawInfo').textContent=({browse:'瀏覽模式',point:'點選地圖建立新標記',poly:'圈選中：點至少3個頂點',locate:'點選地圖重新定位指定紀錄',inspect:'點選橘色區塊進行查核；手機可用「查核中心」'})[t]||t;
 document.querySelectorAll('.map').forEach(el=>el.style.cursor=t==='browse'?'':'crosshair');}
function clearDraw(){for(let layer of STATE.drawLayers){layer.remove();}STATE.drawLayers=[];}
function refreshDraw(){clearDraw();if(!STATE.draw.length)return;for(const m of STATE.maps){let layer=STATE.draw.length>=3?L.polygon(STATE.draw,{color:'#ff991e',weight:3,dashArray:'5 6',fillOpacity:.16,interactive:false}):L.polyline(STATE.draw,{color:'#ff991e',weight:3,dashArray:'5 6',interactive:false});layer.addTo(m);STATE.drawLayers.push(layer);} $('drawInfo').textContent='圈選中：'+STATE.draw.length+' 個頂點';}
function finishPoly(){if(window.PigCommunity?.enabled)return notice('公開協作模式不允許本機圈選後誤認同步；目前開放的是既有場址修正。');if(STATE.draw.length<3)return notice('至少要標記 3 個角點。');const p=STATE.draw.map(x=>[x[1],x[0]]);p.push(p[0]);const newRow=C.normalize({uid:newId(),name:'未命名範圍',county:$('filterCounty').value==='all'?'雲林縣':$('filterCounty').value,geometry:{type:'Polygon',coordinates:[p]},category:'unchecked',review:'pending',source:'人工圈選',evidence:'正射影像人工比對',createdAt:new Date().toISOString()});STATE.records.push(newRow);renderStats();renderList();persist();mode('browse');openRecord(newRow.uid,false);}
function setMobileAim(active){
 STATE.mobileAimActive=!!active;
 const maps=$('maps'),main=$('mobileAimMain'),close=$('mobileAimClose');
 if(maps)maps.classList.toggle('aim-mode',!!active);
 if(main)main.textContent=active?'◎ 查核準星位置':'⌖ 進入準星查核';
 if(close)close.hidden=!active;
 window.PigMobileUI?.aimChanged?.(!!active);
}
function mobileAimAction(){
 if(!STATE.mapReady)return notice('地圖尚未準備好。');
 if(!STATE.mobileAimActive){
  closeWorkbench();$('auditPanel').hidden=true;
  if(STATE.view==='both')changeView('aerial');
  mode('inspect');setMobileAim(true);
  notice('移動正射影像，讓橘色區塊位於十字準星中央，再按「查核準星位置」。');return;
 }
 const map=STATE.maps[STATE.view==='survey'?0:1];const c=map.getCenter();inspectAt(c.lat,c.lng);
}
function resetSnapAssist(){STATE.pendingSnap=null;const el=$('auditSnapReview');if(el)el.hidden=true;}
function confirmSnappedFragment(){
 const snap=STATE.pendingSnap;
 if(!snap||snap.seq!==STATE.inspectSeq)return;
 STATE.inspectPoint=[snap.lat,snap.lng];STATE.inspectParcel=snap.parcel;
 $('auditPos').textContent=`已人工採用橘色片段位置：${snap.lat.toFixed(6)}, ${snap.lng.toFixed(6)} · 與點選處偏移 ${Math.round(snap.metres)} 公尺`;
 $('auditState').textContent='已確認使用附近 F03 向量圖磚局部輪廓（不是完整官方地塊）；請判讀及儲存。';
 $('auditActions').hidden=false;$('auditManual').hidden=true;
 const previous=STATE.audits[snap.parcel.key];
 if(previous){$('auditDecision').textContent='已查過此局部片段：'+auditLabel(previous);$('auditRemarks').value=previous.note||'';}
 resetSnapAssist();renderAuditNeighbors();updateAuditRemoveButton();renderInspectPreview();
}
function clickedMap(e){if(STATE.tool==='point'){mode('browse');createPointAt(e.latlng.lat,e.latlng.lng);}else if(STATE.tool==='locate'){let id=STATE.locateId;STATE.locateId=null;mode('browse');createPointAt(e.latlng.lat,e.latlng.lng,id);}else if(STATE.tool==='poly'){STATE.draw.push([e.latlng.lat,e.latlng.lng]);refreshDraw();}else if(STATE.tool==='inspect'){inspectAt(e.latlng.lat,e.latlng.lng);} }
function changeView(view){STATE.view=view;$('maps').className='maps '+view;document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));setTimeout(()=>{if(STATE.mapReady){for(const m of STATE.maps)m.invalidateSize();const a=STATE.maps[0];STATE.maps[1].setView(a.getCenter(),a.getZoom(),{animate:false});refreshF03();}},120);persist();}
/* V3.1.1 底圖監控：官方底圖逾時或圖磚失敗，自動換公開備援；每張地圖獨立處理。 */
const BASEMAPS={
 emap:[
  {label:'國土測繪 EMAP 電子地圖',url:'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}',attr:'&copy; 內政部國土測繪中心',maxNativeZoom:19},
  {label:'OpenStreetMap 道路地圖（備援）',url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',attr:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',maxNativeZoom:19}
 ],
 photo:[
  {label:'國土測繪 PHOTO2（EPSG:3857）正射影像',url:'https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/EPSG:3857/{z}/{y}/{x}',attr:'&copy; 內政部國土測繪中心',maxNativeZoom:19},
  {label:'Esri World Imagery 航衛星影像（備援）',url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',attr:'Tiles &copy; Esri, Maxar, Earthstar Geographics, GIS User Community',maxNativeZoom:19}
 ]
};
const PREVIEW_ENV=/(^|\.)oaiusercontent\.com$/.test(location.hostname)||location.hostname==='web-sandbox.oaiusercontent.com';
const CSP_VIOLATIONS=[];
window.addEventListener('securitypolicyviolation',e=>{if(CSP_VIOLATIONS.length<16)CSP_VIOLATIONS.push({directive:e.violatedDirective,blocked:e.blockedURI});});
const BASE_RUNTIME={emap:{seq:0,index:-1,timer:null,loaded:false,errors:0},photo:{seq:0,index:-1,timer:null,loaded:false,errors:0}};
function baseMapStatus(kind,message,warning=false){
 const el=$(kind==='emap'?'surveySourceStatus':'aerialSourceStatus');if(!el)return;
 el.textContent=message;el.classList.toggle('map-warning',warning);
}
function startBase(kind,index=0){
 const i=kind==='emap'?0:1,map=STATE.maps[i],run=BASE_RUNTIME[kind],sources=BASEMAPS[kind];if(!map)return;
 run.seq++;const seq=run.seq;clearTimeout(run.timer);run.timer=null;run.loaded=false;run.errors=0;run.index=index;
 if(STATE.bases[i]){map.removeLayer(STATE.bases[i]);STATE.bases[i]=null;}
 if(index>=sources.length){baseMapStatus(kind,'地圖來源無法連線，請按「重試地圖」',true);return;}
 const item=sources[index];baseMapStatus(kind,'載入中：'+item.label,index>0);
 const layer=L.tileLayer(item.url,{attribution:item.attr,maxZoom:21,maxNativeZoom:item.maxNativeZoom,tileSize:256,updateWhenIdle:true,keepBuffer:2});
 STATE.bases[i]=layer;
 function next(reason){if(seq!==run.seq||run.loaded)return;clearTimeout(run.timer);if(index+1<sources.length){baseMapStatus(kind,'官方來源無回應，正在切換備援…',true);startBase(kind,index+1);}else{map.removeLayer(layer);STATE.bases[i]=null;baseMapStatus(kind,PREVIEW_ENV?'⚠ 預覽環境疑似阻擋外部圖資，請到 GitHub Pages 驗收':'⚠ 外部圖資未載入，請用「圖資診斷」檢查原因',true);}}
 layer.on('tileload',()=>{if(seq!==run.seq)return;run.loaded=true;run.errors=0;clearTimeout(run.timer);baseMapStatus(kind,(index===0?'✓ ':'⚠ 備援：')+item.label,index>0);});
 layer.on('tileerror',()=>{if(seq!==run.seq)return;run.errors++;if(!run.loaded&&run.errors>=2)next('tileerror');else if(run.loaded&&run.errors>=5)baseMapStatus(kind,'部分圖磚讀取失敗，可按「重試地圖」',true);});
 layer.on('load',()=>{if(seq!==run.seq)return;if(!run.loaded)baseMapStatus(kind,'圖磚回應不完整，請重試',true);});
 layer.addTo(map);
 // 防止服務沒有回報 tileerror 時，灰底永遠停留在畫面。
 run.timer=setTimeout(()=>{if(seq===run.seq&&!run.loaded)next('timeout');},4500);
}
function restartBaseMaps(backup=false){
 for(const kind of ['emap','photo'])startBase(kind,backup?1:0);
 notice(backup?'已切換備援來源；如果仍無影像，請檢查網路連線。':'已重新嘗試官方電子地圖及 PHOTO2。');
}

function renderMarkers(){if(!STATE.mapReady)return;for(const group of STATE.markerGroups)group.clearLayers();for(const r of STATE.filtered){const p=C.center(r);if(!p)continue;const col=r.review==='approved'?'#147951':COLORS[r.category]||'#b88e4a';for(const group of STATE.markerGroups){let shape;if(r.geometry?.type==='Polygon')shape=L.polygon(r.geometry.coordinates[0].map(v=>[v[1],v[0]]),{color:col,weight:3,fillOpacity:.18,fillColor:col,bubblingMouseEvents:false});else shape=L.circleMarker(p,{radius:r.review==='approved'?8:6,weight:2,color:'#fff',fillColor:col,fillOpacity:.96,bubblingMouseEvents:false});shape.bindTooltip(html(r.name)+' · '+(r.review==='approved'?'全部核定':'待核'),{direction:'top'});shape.on('click',()=>{if(STATE.tool==='browse')focusFarmRecord(r.uid,{move:false});});group.addLayer(shape);}}}
function connectMaps(from,to){if(STATE.linking||!STATE.mapReady)return;const a=from.getCenter(),b=to.getCenter();if(Math.abs(a.lat-b.lat)<.0000001&&Math.abs(a.lng-b.lng)<.0000001&&from.getZoom()===to.getZoom())return;STATE.linking=true;to.setView(a,from.getZoom(),{animate:false});STATE.linking=false;}
function onMapMove(source,target){connectMaps(source,target);let c=source.getCenter();STATE.center=[c.lat,c.lng];STATE.zoom=source.getZoom();$('coordBar').textContent=`WGS84　${c.lat.toFixed(6)}° N, ${c.lng.toFixed(6)}° E · Z${source.getZoom()}`;scheduleF03();updateF03YearInfo();scheduleViewSave();}
function mercator(bounds){let p=L.CRS.EPSG3857.project;const a=p(bounds.getSouthWest()),b=p(bounds.getNorthEast());return [a.x,a.y,b.x,b.y].join(',');}
function f03URL(map,styled){let bounds=map.getBounds(),size=map.getSize();if(size.x<1||size.y<1)return null;let scale=Math.min(1,1800/Math.max(size.x,size.y));const params=new URLSearchParams({bbox:mercator(bounds),bboxSR:'3857',imageSR:'3857',size:`${Math.round(size.x*scale)},${Math.round(size.y*scale)}`,format:'png32',transparent:'true',f:'image'});
 if(styled){params.set('dynamicLayers',JSON.stringify([{id:STATE.year,source:{type:'mapLayer',mapLayerId:STATE.year},drawingInfo:{renderer:{type:'simple',symbol:{type:'esriSFS',style:'esriSFSSolid',color:[245,145,34,190],outline:{type:'esriSLS',style:'esriSLSSolid',color:[185,92,21,255],width:.6}}}}}]));}
 else params.set('layers','show:'+STATE.year);
 return `${F03}/export?${params}`;
}
/* V3.3.6: F03 MVT is primary; missing native tiles can query original ArcGIS MapServer geometry. */
/* V3.3.6: 雙地圖 F03。官方向量服務 Max LOD=12，放大時從 z12 原圖磚向量重繪。 */
function scheduleF03(){clearTimeout(STATE.layerTimer);STATE.layerTimer=setTimeout(refreshF03,150);}
function dropF03(){f03RenderedMode=null;++STATE.f03Gen;if(Array.isArray(STATE.f03)){for(const layer of STATE.f03)if(layer)layer.remove();}STATE.f03=null;STATE.f03Year=0;}
function setF03Status(text,error=false){const el=$('gisInfo');el.textContent=text;el.classList.toggle('error',error);updateF03YearInfo();}
/* V3.3.15: 顯示來源與當前畫面交集候選；不將已內建3,593個誤稱當前可見塊數。 */
function updateF03YearInfo(){
 const el=$('f03YearInfo');if(!el)return;
 const yr=STATE.year===4?'112':'111';
 let msg='',kind='';
 if(!STATE.showF03){msg=`${yr}年 F03 圖層已關閉`;kind='warn';}
 else if(STATE.year===4&&f03SourceMode==='builtin'){
  const local=window.F03Local?.getPackaged(4);
  if(!local){msg='112年內建地塊未載入，請查看錯誤';kind='err';}
  else{
   let visible='';
   try{
    const map=STATE.maps?.[STATE.view==='aerial'?1:0]||STATE.maps?.[0];
    if(STATE.mapReady&&map){const b=map.getBounds();const cs=window.F03Local.candidatesForBounds(local,[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()]);visible=` · 畫面外框相交候選 ${cs.length}`;}
   }catch(e){/* 地圖初始化前不宣告可見塊數 */}
   msg=`112年 · 內建雲林縣 ${local.meta.count.toLocaleString()} 個多邊形${visible}`;
  }
 }else if(f03SourceMode==='offline'){
  const local=window.F03Local?.get(STATE.year);
  msg=local?`${yr}年 · 自行匯入 ${local.meta.count.toLocaleString()} 個地塊（僅檔案範圍）`:`${yr}年 · 離線圖資未就緒`;kind=local?'':'warn';
 }else{msg=`${yr}年 · 官方線上來源（可能存在缺圖）`;kind='warn';}
 el.textContent=msg;el.classList.toggle('warn',kind==='warn');el.classList.toggle('err',kind==='err');
}
/* V3.3.6: offline F03 is a separate IDB data source. It never modifies farm seed or claims official registration. */
let f03SourceMode='builtin',f03OfflineDurable=false,f03OfflineLoadSeq=0,f03RenderedMode=null;
function f03ModeOffline(){return f03SourceMode==='offline'||(f03SourceMode==='builtin'&&STATE.year===4&&!!window.F03Local.getPackaged(4));}
function activeF03Dataset(year=STATE.year){return window.F03Local.getForMode(year,f03SourceMode);}
function offlineIntersectsMap(local){if(!local||!STATE.maps?.length||!STATE.mapReady)return true;const e=local.meta.extent;if(!e)return true;const b=STATE.maps[STATE.view==='aerial'?1:0].getBounds();if(!(e[0]<=b.getEast()&&e[2]>=b.getWest()&&e[1]<=b.getNorth()&&e[3]>=b.getSouth()))return false;return f03SourceMode==='builtin'?true:window.F03Local.candidatesForBounds(local,[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()]).length>0;}
function showImportedArea(){const d=activeF03Dataset(),m=d?.meta;if(!m?.extent)return notice('目前年度沒有可定位的離線 F03。');if(!STATE.mapReady)return notice('地圖尚未準備好。');const e=m.extent;const b=L.latLngBounds([e[1],e[0]],[e[3],e[2]]);STATE.maps[0].fitBounds(b,{padding:[35,35],maxZoom:17,animate:false});STATE.maps[1].fitBounds(b,{padding:[35,35],maxZoom:17,animate:false});refreshF03();notice('已定位到匯入的 '+m.count+' 塊 F03 範圍（這不代表全鄉鎮）。');}
function setF03Mode(mode){f03SourceMode=['builtin','online','offline'].includes(mode)?mode:'builtin';$('f03Source').value=f03SourceMode;try{localStorage.setItem('pig-f03-source-mode-v337',f03SourceMode);}catch(e){}updateF03YearInfo();}
function offlineStatus(msg,err=false){const el=$('f03OfflineStatus');if(el){el.textContent=msg;el.classList.toggle('error',err);}}
function offlineSummary(year=STATE.year){
  if(f03SourceMode==='builtin'&&year===4){const m=window.F03Local.getPackaged(4)?.meta;return m?`已內建：民國112年雲林縣 ${m.count.toLocaleString()} 個多邊形（官方圖徵 1 筆）；直接開啟即顯示，不需擷取、裁切、匯入或使用 IndexedDB。畜牧使用不等於養豬場。`:'內建 F03 載入失敗；請查看圖層狀態。';}
  const m=window.F03Local.meta(year);return m?`民國${year===4?'112':'111'}年 · ${m.count.toLocaleString()} 塊多邊形 · ${m.name} · ${m.hash} · ${m.acquisition?'官方來源紀錄（實際圖形以檔案為準）':'來源須人工確認'} · ${f03OfflineDurable?'已存 IndexedDB':'僅此工作階段（需另存檔）'}`:'目前年度沒有已匯入的個人 F03 地塊。';
}
async function reloadOfflineF03(year=STATE.year){const seq=++f03OfflineLoadSeq;f03OfflineDurable=false;
 offlineStatus('正在讀取民國'+(year===4?112:111)+'年離線地塊…');
 try{const data=await window.F03Local.restore(year);if(seq!==f03OfflineLoadSeq||STATE.year!==year)return;
  f03OfflineDurable=!!data;offlineStatus(offlineSummary());if(!data&&f03SourceMode==='offline'){setF03Mode(window.F03Local.getPackaged(year)?'builtin':'online');offlineStatus('原匯入檔未找到，已回到可用的內建或線上 F03，不會出現全空白圖層。');}
 }catch(e){if(seq!==f03OfflineLoadSeq)return;const available=window.F03Local.get(year);if(!available&&f03SourceMode==='offline')setF03Mode(window.F03Local.getPackaged(year)?'builtin':'online');offlineStatus(available?offlineSummary()+'；持久儲存讀取有問題：'+String(e.message||e):'離線圖資無法讀取，已恢復線上圖層：'+String(e.message||e),true);}
 if(seq===f03OfflineLoadSeq&&f03ModeOffline()&&STATE.mapReady){dropF03();refreshF03();}
}
function offlineDrawnLayer(){const year=STATE.year,local=activeF03Dataset(year);if(!local)return false;
 const Layer=L.GridLayer.extend({createTile:function(coords,done){const canvas=L.DomUtil.create('canvas','leaflet-tile');canvas.width=canvas.height=256;canvas.dataset.f03Offline='1';
  try{const count=window.F03Local.render(canvas,coords,year,f03SourceMode);canvas.dataset.f03Count=String(count);queueMicrotask(()=>done(null,canvas));}catch(e){canvas.dataset.f03Error=String(e.message||e);queueMicrotask(()=>done(e,canvas));}return canvas;}});
 const overlays=STATE.maps.map(map=>new Layer({opacity:STATE.opacity,pane:'f03Overlay',updateWhenIdle:true,keepBuffer:1,maxZoom:22}).addTo(map));
 STATE.f03=overlays;STATE.f03Year=year;f03RenderedMode=f03SourceMode;
  const current=local.meta;setF03Status(f03SourceMode==='builtin'
   ? `內建112年雲林 F03：${current.count.toLocaleString()} 個橘色多邊形 · 左右同步 · 不需要下載地塊圖磚（不代表豬場）`
   :`使用者匯入 F03：${current.count.toLocaleString()} 個多邊形（僅涵蓋匯入檔範圍）`);
 return true;
}
async function importOfflineF03(file){if(!file)return;const year=STATE.year;
 if(!$('f03ConfirmSource').checked)return notice('請先確認目前選取的年度與 F03 地塊來源。');
 if(file.size>window.F03Local.MAX_BYTES)return offlineStatus('檔案超過 60 MB，請先按地區分檔。',true);
 $('f03Import').disabled=true;offlineStatus('正在檢查檔案 '+file.name+'；完成前不改動現有橘色圖層…');
 try{
  await new Promise(resolve=>setTimeout(resolve,0));const text=await file.text();
  if(STATE.year!==year)throw Error('讀取檔案期間切換了年度，請重新選擇');
  const data=window.F03Local.prepare(text,year,file.name),prior=window.F03Local.meta(year);
  const extent=data.meta.extent;
  const area=`${extent[0].toFixed(5)}, ${extent[1].toFixed(5)} ～ ${extent[2].toFixed(5)}, ${extent[3].toFixed(5)}`;
  if(prior && !confirm(`本年度目前存有 ${prior.count} 塊離線地塊（${prior.name}）。\n準備匯入「${file.name}」，共 ${data.meta.count} 塊，範圍 ${area}。\n這會取代本年度離線檔案，不會刪除豬場資料。\n注意：小範圍檔案不等於全縣圖資。確定取代？`)){offlineStatus('已取消；原圖層與原圖資均保留。');return;}
  // Write and verify the complete new file before switching display or replacing in-memory data.
  await window.F03Local.persist(data,file);
  if(STATE.year!==year)throw Error('儲存期間切換了年度；請重新載入圖資');
  window.F03Local.activate(data);
  f03OfflineDurable=true;setF03Mode('offline');
  dropF03();refreshF03();
  offlineStatus(offlineSummary()+`；圖資座標範圍 ${area}。若目前畫面不在範圍內，會暫時顯示線上圖資。`);
  notice(`成功匯入 ${data.meta.count} 塊 F03 多邊形。可按「定位匯入範圍」查看。`);
  if(!offlineIntersectsMap(data))offlineStatus(`已匯入 ${data.meta.count} 塊，但你目前不在匯入範圍 ${area}；已暫時恢復線上圖層，按「定位匯入範圍」查看。`,true);
 }catch(e){
  const msg=String(e.message||e);
  offlineStatus('未完成匯入：'+msg+' 原本的橘色圖層及豬場標記未更改。',true);
  notice('地塊匯入失敗，原資料保留；請檢查檔案是否為官方 F03 多邊形。');
 }finally{$('f03Import').disabled=false;}
}
function downloadOfflineF03(){const local=activeF03Dataset();if(!local)return notice('此年度沒有可匯出的 F03 地塊。');
 const blob=new Blob([local.rawText],{type:'application/geo+json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=`F03_民國${STATE.year===4?112:111}_${local.meta.hash}.geojson`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),12000);notice('已匯出此年度離線圖資；豬場資料請另用「備份」。');
}
async function removeOfflineF03(){const year=STATE.year;if(!window.F03Local.get(year))return notice('此年度沒有離線圖資。');
 if(!confirm('確定移除此年度離線地塊檔？不會刪除豬場或人工查核紀錄，但離線橘色圖層會停止顯示。請先匯出 GeoJSON 備份。'))return;
 try{await window.F03Local.forget(year);f03OfflineDurable=false;if(f03ModeOffline())dropF03();offlineStatus(offlineSummary());refreshF03();notice('已移除此年度離線圖資，豬場與查核紀錄保留。');}catch(e){offlineStatus('移除失敗：'+e.message,true);}
}
function offlineCandidateRows(bounds){const dataset=activeF03Dataset();if(!dataset)return [];
 const list=window.F03Local.candidatesForBounds(dataset,bounds);
 return list.map(f=>{
  let lat=f.center[1],lng=f.center[0];
  const within=()=>lat>=bounds.south&&lat<=bounds.north&&lng>=bounds.west&&lng<=bounds.east&&window.F03Local.inside([lng,lat],f.rings);
  if(!within()){
   const west=Math.max(bounds.west,f.bbox[0]),east=Math.min(bounds.east,f.bbox[2]),south=Math.max(bounds.south,f.bbox[1]),north=Math.min(bounds.north,f.bbox[3]);
   let found=false;
   for(let y=1;y<=9&&!found;y++)for(let x=1;x<=9&&!found;x++){
    const py=south+(north-south)*y/10,px=west+(east-west)*x/10;
    if(window.F03Local.inside([px,py],f.rings)){lat=py;lng=px;found=true;}
   }
   if(!found)return null; // A sliver too small to sample is not listed as a validated scanned parcel.
  }
  return {key:f.key,year:STATE.year,lat,lng,source:'offline'};
 }).filter(Boolean);
}
function scanOfflineQueue(zone,bounds,map,z){const all=offlineCandidateRows(bounds),c=map.getCenter();
 const distance=r=>Math.hypot((r.lat-c.lat)*110574,(r.lng-c.lng)*111320*Math.cos(c.lat*Math.PI/180));all.sort((a,b)=>distance(a)-distance(b));
 STATE.queueRows=all.slice(0,200);STATE.queueSelectedKey=null;STATE.queueZoneId=zone?.id||null;STATE.queueBounds={bounds,year:STATE.year,zoom:z};
 if(zone){zone.lastScan={at:new Date().toISOString(),rows:STATE.queueRows.map(r=>({key:r.key,year:r.year,lat:r.lat,lng:r.lng})),tileCount:0,failedCount:0,truncated:all.length>200,foundCount:all.length};zone.lastKey=null;zone.updatedAt=new Date().toISOString();persist();renderZones();}
 $('queueStatus').textContent='離線 F03 找到 '+all.length+' 個候選多邊形'+(all.length>200?'（僅列出最近 200 個）':'')+'；這不是全鄉鎮完成盤查證明。';renderQueue();
}
function refreshF03(){
 if(!STATE.mapReady||!STATE.maps.length)return;
 if(!STATE.showF03){dropF03();setF03Status('F03 畜牧橘色圖層已關閉（兩側）');return;}
 const offlineData=f03ModeOffline()?activeF03Dataset():null;
 if(f03ModeOffline()&&offlineData&&offlineIntersectsMap(offlineData)){
  if(Array.isArray(STATE.f03)&&STATE.f03Year===STATE.year&&f03RenderedMode===f03SourceMode){for(const layer of STATE.f03)layer.setOpacity(STATE.opacity);return;}
  dropF03();offlineDrawnLayer();return;
 }
 if(f03ModeOffline()){
  if(!offlineData){setF03Mode(window.F03Local.getPackaged(STATE.year)?'builtin':'online');offlineStatus('此年度缺少所選來源，已切換至可用的內建或線上 F03。');}
  else offlineStatus(`目前位置不在已匯入的 ${offlineData.meta.count} 塊地塊涵蓋範圍；暫以線上 F03 顯示。可按「定位匯入範圍」查看。`,true);
 }
 if(Array.isArray(STATE.f03)&&STATE.f03Year===STATE.year&&f03RenderedMode==='online'){
  for(const layer of STATE.f03)layer.setOpacity(STATE.opacity);
  const a=currentF03Canvas(0),b=currentF03Canvas(1);
  if(a.rendered||b.rendered){const z=STATE.maps[0].getZoom();const visible=STATE.view==='aerial'?b:a;
   setF03Status('F03 畫面：'+visible.shapes+' 片段；官方原始面 '+visible.polygons+' 張、近似 '+visible.approximate+' 張、來源未確認 '+visible.unresolved+' 張、真正失敗 '+visible.errors+' 張'+(z>window.PigF03.MAX_NATIVE_ZOOM?'；Z'+z+' 放大來源圖磚':'')+'（淡黃虛線不是精確地塊）',visible.errors>0||visible.unresolved>0);}

  return;
 }
 dropF03();const year=STATE.year,token=++STATE.f03Gen;
 if(!window.PigF03){setF03Status('F03 向量解碼器未載入',true);return;}
 const cfg=window.PigF03;
 const F03Canvas=L.GridLayer.extend({
  createTile:function(coords,done){const canvas=L.DomUtil.create('canvas','leaflet-tile');canvas.width=canvas.height=256;
   const source=cfg.sourceTile(coords);canvas.dataset.f03SourceZoom=String(source.z);
   cfg.getDisplayTileLayers(year,coords).then(result=>{
    canvas.dataset.f03SourceZoom=String(result.source.z);
    const count=result.quality==='original-polygon'?cfg.renderOriginalPolygons(canvas,result.polygons,coords):cfg.render(canvas,result.layers,{...result.source,approximate:result.quality==='approximate'});
    if(result.quality==='original-polygon')canvas.dataset.f03OriginalPolygon='1';
    if(result.quality==='approximate'&&count>0)canvas.dataset.f03Fallback=String(result.source.z);
    if(result.polygonFailure)canvas.dataset.f03OriginalError=result.polygonFailure;
    if(result.quality==='unresolved'||(result.missingOriginal&&count===0&&result.quality!=='original-polygon'))canvas.dataset.f03Unresolved='1';
    canvas.dataset.f03Count=String(count);done(null,canvas);
   }).catch(err=>{canvas.dataset.f03Error=String(err?.message||err);done(err,canvas);});return canvas;
  }
 });
 let loaded=[0,0],errors=[0,0],firstError='',statusTimer=null;
 function updateVisibleStatus(){
  if(STATE.f03Gen!==token||!STATE.showF03)return;
  const visible=[currentF03Canvas(0),currentF03Canvas(1)],z=Math.max(STATE.maps[0].getZoom(),STATE.maps[1].getZoom());
  const ready=visible.map(a=>a.rendered>0),broken=visible.map(a=>a.errors>0);
  let status='F03 畫面：左圖 '+visible[0].shapes+' 片段（原始面 '+visible[0].polygons+'，近似 '+visible[0].approximate+'，來源未確認 '+visible[0].unresolved+'，讀取失敗 '+visible[0].errors+'）／航照 '+visible[1].shapes+' 片段（原始面 '+visible[1].polygons+'，近似 '+visible[1].approximate+'，未確認 '+visible[1].unresolved+'，失敗 '+visible[1].errors+'）';
  if(z>cfg.MAX_NATIVE_ZOOM)status+='；Z'+z+' 使用官方 Z'+cfg.MAX_NATIVE_ZOOM+' 向量放大';
  if(visible.some(v=>v.approximate||v.unresolved))status+='；淡黃近似不可作為精確地塊';
  if(visible.some(v=>v.polygonFailures))status+='；原始面服務有查詢失敗，可查看缺口診斷';
  if(broken.some(Boolean))status+='；部分圖磚載入失敗，請診斷';
  setF03Status(status+'（不等於豬場數）',broken.some(Boolean)||visible.some(v=>v.unresolved>0));
 }
 function queueVisibleStatus(){clearTimeout(statusTimer);statusTimer=setTimeout(updateVisibleStatus,95);}
 setF03Status('F03 載入中：向量 Z12 缺圖時嘗試官方原始面資料…');
 const indicator=setTimeout(()=>{if(STATE.f03Gen===token&&loaded.every(n=>n===0))setF03Status('F03 向量圖層無回應；可按「F03 測試」查詢',true);},16000);
 const overlays=STATE.maps.map((map,side)=>{
  const overlay=new F03Canvas({opacity:STATE.opacity,pane:'f03Overlay',updateWhenIdle:true,keepBuffer:1,maxZoom:22});
  overlay.on('tileload',()=>{if(STATE.f03Gen!==token)return;loaded[side]++;clearTimeout(indicator);queueVisibleStatus();});
  overlay.on('tileunload',queueVisibleStatus);
  overlay.on('load',queueVisibleStatus);
  overlay.on('tileerror',event=>{
   if(STATE.f03Gen!==token)return;
   errors[side]++;
   firstError=firstError||event.tile?.dataset?.f03Error||'無法讀取 PBF';
   if(errors[side]>=2&&loaded[side]===0){clearTimeout(indicator);setF03Status('F03 '+(side===0?'左圖':'航照')+'向量讀取失敗：'+firstError,true);}
   else queueVisibleStatus();
  });
  overlay.addTo(map);return overlay;
 });
 STATE.f03Year=year;STATE.f03=overlays;f03RenderedMode='online';
}
function initMap(){if(typeof window.L==='undefined'){$('gisInfo').textContent='無法取得 Leaflet 地圖套件；清單與匯出仍可使用';$('gisInfo').classList.add('error');$('saveState').textContent='地圖套件載入失敗';return;}
 try{const left=L.map('surveyMap',{zoomControl:true,preferCanvas:true}).setView(STATE.center,STATE.zoom),right=L.map('aerialMap',{zoomControl:true,preferCanvas:true}).setView(STATE.center,STATE.zoom);STATE.maps=[left,right];for(const map of [left,right]){map.createPane('f03Overlay');map.getPane('f03Overlay').style.zIndex=350;map.getPane('f03Overlay').style.pointerEvents='none';map.createPane('auditAreas');map.getPane('auditAreas').style.zIndex=365;map.createPane('auditPins');map.getPane('auditPins').style.zIndex=575;map.createPane('inspectPreview');map.getPane('inspectPreview').style.zIndex=570;map.getPane('inspectPreview').style.pointerEvents='none';map.createPane('selectedFarmPane');map.getPane('selectedFarmPane').style.zIndex=690;map.getPane('selectedFarmPane').style.pointerEvents='none';}STATE.bases=[null,null];startBase('emap');startBase('photo');STATE.auditAreaGroups=[L.featureGroup().addTo(left),L.featureGroup().addTo(right)];STATE.inspectPreviewGroups=[L.featureGroup().addTo(left),L.featureGroup().addTo(right)];STATE.auditGroups=[L.featureGroup().addTo(left),L.featureGroup().addTo(right)];STATE.markerGroups=[L.featureGroup().addTo(left),L.featureGroup().addTo(right)];STATE.selectedFarmGroups=[L.featureGroup().addTo(left),L.featureGroup().addTo(right)];STATE.queueHighlights=[L.featureGroup().addTo(left),L.featureGroup().addTo(right)];STATE.zoneAreaLayers=[L.featureGroup().addTo(left),L.featureGroup().addTo(right)];STATE.zoneCandidateLayers=[L.featureGroup().addTo(left),L.featureGroup().addTo(right)];STATE.mapReady=true;
 for(const map of STATE.maps){map.on('zoomend',renderAuditPins);} for(const map of STATE.maps)map.on('click',clickedMap);left.on('moveend',()=>onMapMove(left,right));right.on('moveend',()=>onMapMove(right,left));left.on('mousemove',e=>$('coordBar').textContent=`指標：${e.latlng.lat.toFixed(6)} N, ${e.latlng.lng.toFixed(6)} E`);right.on('mousemove',e=>$('coordBar').textContent=`指標：${e.latlng.lat.toFixed(6)} N, ${e.latlng.lng.toFixed(6)} E`);
 STATE.showF03=$('showF03').checked;renderMarkers();renderSelectedFarmHighlight();renderAuditPins();renderAuditAreas();renderQueueHighlight();renderZones();setTimeout(()=>{for(const m of STATE.maps)m.invalidateSize();scheduleF03();},350);
 }catch(e){$('gisInfo').textContent='地圖初始化失敗：'+e.message;$('gisInfo').classList.add('error');console.error(e);}}
/* V3.1: 官方 F03 點位查核；沒有從圖層成功讀到 OBJECTID 不建立虛假的地塊審查 ID。 */
function validAudits(value){if(!value||typeof value!=='object'||Array.isArray(value))return {};
 const out={};for(const [key,v] of Object.entries(value)){
  if(!(/^(F03-(4|5)-\d+)$/.test(key)||/^(?:TILE-[45]-12-\d+-\d+-\d+|OFFLINE-[45]-[0-9a-f]{8}-\d+-\d+)$/.test(key)||/^MANUAL-[45]-\d+\.\d{6}-\d+\.\d{6}$/.test(key))||!v||!['pig','maybe','other','defer'].includes(v.decision))continue;
  if(!C.coord(Number(v.lat),Number(v.lng)))continue;
  out[key]={...v,key,decision:v.decision,source:key.startsWith('MANUAL-')?'manual':key.startsWith('TILE-')?'tile':key.startsWith('OFFLINE-')?'offline':'official',geometry:!key.startsWith('MANUAL-')?validAuditGeo(v.geometry):null};
 }return out;}

/* V3.3.6: only official polygons returned by ArcGIS query can colour a full audited parcel.
 * A point-only old audit or manual marker never implies the whole orange polygon is checked. */
function officialAuditGeo(g){
 if(!g||!Array.isArray(g.rings))return null;
 const sr=g.spatialReference?.latestWkid||g.spatialReference?.wkid;
 if(sr&&sr!==4326) return null;
 const rings=[];let n=0;
 for(const raw of g.rings){
  if(!Array.isArray(raw))continue;
  const ring=[];
  for(const p of raw){if(!Array.isArray(p)||p.length<2)continue;
   const x=Number(p[0]),y=Number(p[1]);if(!C.coord(y,x))return null;
   ring.push([+x.toFixed(6),+y.toFixed(6)]);if(++n>12000)return null;
  }
  if(ring.length>=4){const a=ring[0],b=ring[ring.length-1];if(a[0]!==b[0]||a[1]!==b[1])ring.push([...a]);rings.push(ring);}
 }
 if(!rings.length)return null;
 return {type:'Polygon',coordinates:rings};
}
function validAuditGeo(g){
 if(!g||g.type!=='Polygon'||!Array.isArray(g.coordinates)||!g.coordinates.length)return null;
 let count=0;const rings=[];
 for(const raw of g.coordinates){if(!Array.isArray(raw))return null;
  const ring=[];for(const point of raw){if(!Array.isArray(point)||!C.coord(+point[1],+point[0]))return null;
   ring.push([+point[0],+point[1]]);if(++count>12000)return null;
  }if(ring.length>=4)rings.push(ring);
 }
 return rings.length?{type:'Polygon',coordinates:rings}:null;
}
const AUDIT_FILL={pig:'#168454',maybe:'#e3ab34',other:'#6a86a5',defer:'#8c70ad'};
function renderAuditAreas(){
 if(!STATE.mapReady||!STATE.auditAreaGroups?.length)return;
 for(const group of STATE.auditAreaGroups)group.clearLayers();
 let count=0;
 for(const a of Object.values(STATE.audits)){
  if(!['official','tile','offline'].includes(a.source)||+a.year!==STATE.year||!STATE.showAuditAreas)continue;
  // Non-farms remain in review history, but do not clutter regional map views.
  if(a.decision==='other' && STATE.maps?.[0]?.getZoom()<13)continue;
  const g=validAuditGeo(a.geometry);if(!g)continue;
  const rings=g.coordinates.map(r=>r.map(p=>[p[1],p[0]]));
  const fill=AUDIT_FILL[a.decision]||'#8c70ad';
  const popup='<b>人工查核：'+html(auditLabel(a))+'</b><div>'+(a.source==='tile'?'F03 圖磚局部輪廓（非完整地塊）':a.source==='offline'?'人工匯入 F03 GeoJSON（未重新核實）':'官方 F03 #'+html(a.objectId))+'</div><small>人工判讀結果，不代表政府核准或目前仍營運</small>';
  for(const group of STATE.auditAreaGroups){
   const shape=L.polygon(rings,{pane:'auditAreas',color:fill,weight:2.4,opacity:.95,fillColor:fill,fillOpacity:a.decision==='other'?.38:a.decision==='defer'?.30:.68,fillRule:'evenodd',dashArray:a.decision==='defer'?'5 4':null,bubblingMouseEvents:false});
   shape.bindTooltip(popup,{sticky:true});shape.on('click',()=>openSavedAudit(a.key));group.addLayer(shape);
  }
  count++;
 }
 const label=$('auditAreaStatus');if(label)label.textContent=count?`已著色 ${count} 塊（民國${STATE.year===4?112:111}年）`:'尚無可著色的已查地塊';
}
async function loadOfficialAuditGeometry(year,objectId){
 if(year!==4&&year!==5||!Number.isSafeInteger(+objectId)||+objectId<=0)return null;
 const params=new URLSearchParams({f:'json',where:'OBJECTID='+Number(objectId),outFields:'OBJECTID',returnGeometry:'true',outSR:'4326',geometryPrecision:'6',maxAllowableOffset:'0.000005'});
 const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),10000);
 try{const r=await fetch(`${F03}/${year}/query?${params}`,{signal:ctrl.signal,cache:'no-store'});if(!r.ok)throw Error(`HTTP ${r.status}`);
  const data=await r.json();if(data.error)throw Error(data.error.message||'官方查詢失敗');
  const found=(data.features||[]).find(x=>Number(x.attributes?.OBJECTID)===Number(objectId));
  return found?officialAuditGeo(found.geometry):null;
 }finally{clearTimeout(timer);}
}
async function repairAuditShape(key){
 const audit=STATE.audits[key];if(!audit||audit.source!=='official')return notice('只有官方已查地塊可以補抓輪廓。');
 const button=$('repairAuditShape');if(button){button.disabled=true;button.textContent='取得官方輪廓中…';}
 try{const geometry=await loadOfficialAuditGeometry(+audit.year,+audit.objectId);
  if(!geometry)throw Error('官方未回傳可用的完整地塊幾何');
  audit.geometry=geometry;renderAuditAreas();renderAuditHistory();persist();notice('已取得官方地塊輪廓，已查狀態會在雙圖著色。');
 }catch(error){notice('無法取得地塊輪廓，原查核紀錄已保留：'+String(error.message||error).slice(0,75));}
 finally{if(button){button.disabled=false;button.textContent='補抓官方地塊輪廓';}}
}
function auditLabel(a){return {pig:'人工判定豬場',maybe:'疑似豬場',other:'其他／非豬場',defer:'暫不判斷'}[a.decision]||'待判斷';}

/* V3.3.6: highlight only actual geometry supplied by F03 query or MVT fragment.
   Never invent a rectangle or treat this preview as an approved/fully checked parcel. */
function clearInspectPreview(){
 for(const g of STATE.inspectPreviewGroups||[])if(g?.clearLayers)g.clearLayers();
 const box=$('auditPreviewBox');if(box)box.hidden=true;
}
function setAuditSheetPeeking(peeking){
 const panel=$('auditPanel');if(!panel)return;
 panel.classList.toggle('is-peeking',!!peeking);
 const btn=$('auditSheetToggle');if(btn){btn.textContent=peeking?'展開查核':'收起';btn.setAttribute('aria-expanded',String(!peeking));btn.title=peeking?'展開以編輯或儲存判讀':'暫時收起面板以查看航照';}
}
function focusInspectGeometry(){
 if(!STATE.mapReady||!STATE.inspectPoint)return notice('請先選取查核位置。');
 const idx=STATE.view==='aerial'?1:0,main=STATE.maps[idx],other=STATE.maps[1-idx];
 if(!main)return;
 const geom=validAuditGeo(STATE.inspectParcel?.geometry);
 try{
  const points=geom?.coordinates?.flatMap(r=>r.map(p=>[p[1],p[0]]))||[];
  if(points.length>=3){
   const bounds=L.latLngBounds(points);
   if(bounds.isValid())main.fitBounds(bounds.pad(.18),{maxZoom:18,animate:false});
   else main.setView(STATE.inspectPoint,17,{animate:false});
  }else main.setView(STATE.inspectPoint,17,{animate:false});
  if(other)other.setView(main.getCenter(),main.getZoom(),{animate:false});
  notice(geom?'已定位到選取輪廓；藍綠虛線為暫時預覽。':'已定位至人工查核點；此處沒有完整土地輪廓。');
 }catch(e){notice('無法自動定位輪廓，請手動移動地圖。');}
}
function inspectNearbyAudits(point,year=STATE.year,maxDistance=100){
 if(!Array.isArray(point)||!C.coord(+point[0],+point[1]))return [];
 const lat=+point[0],lng=+point[1],cos=Math.cos(lat*Math.PI/180);
 const exactKey=STATE.inspectParcel?.key;
 return Object.values(STATE.audits).filter(a=>+a.year===+year&&C.coord(+a.lat,+a.lng)).map(a=>({audit:a,metres:Math.hypot((+a.lat-lat)*110574,(+a.lng-lng)*111320*cos),exact:!!exactKey&&a.key===exactKey}))
  .filter(x=>x.exact||x.metres<=maxDistance)
  .sort((a,b)=>Number(b.exact)-Number(a.exact)||a.metres-b.metres||String(b.audit.checkedAt||'').localeCompare(String(a.audit.checkedAt||''))).slice(0,5);
}
function renderInspectNearby(){
 const box=$('auditNearbyBox'),list=$('auditNearbyList');if(!box||!list)return;
 const nearby=inspectNearbyAudits(STATE.inspectPoint);
 box.hidden=!nearby.length;
 list.innerHTML=nearby.map(({audit:a,metres,exact})=>{
  const linked=STATE.records.find(r=>r.uid===a.recordUid);
  const locationType=a.source==='manual'?'人工點位':a.source==='tile'?'局部圖磚':'官方地塊編號';
  const hint=exact?'相同查核編號':'僅位置相近，不代表重複';
  return `<button type="button" class="audit-nearby-item" data-same-audit="${exact}" data-open-nearby-audit="${html(a.key)}"><span><b>${html(auditLabel(a))}</b><small class="match-hint">${hint}</small><small>${Math.round(metres)} 公尺 · ${html((a.checkedAt||'').slice(0,10))} · ${locationType}${linked?' · 關聯：'+html(linked.name):''}</small></span><span>複查／修改</span></button>`;
 }).join('');
}
function renderInspectPreview(){
 updateAuditRemoveButton();
 clearInspectPreview();
 if($('auditPanel')?.hidden)return;
 renderInspectNearby();
 const pos=STATE.inspectPoint,parcel=STATE.inspectParcel;
 if(!pos||!STATE.mapReady||!STATE.inspectPreviewGroups?.length)return;
 const geo=validAuditGeo(parcel?.geometry);const label=$('auditPreviewStatus');
 if(label){$('auditPreviewBox').hidden=false;label.textContent=geo?(parcel?.source==='tile'?'青色虛線＝目前選取的圖磚局部輪廓（不代表完整土地）':'青色虛線＝目前選取的官方地塊輪廓（尚待人工判讀）'):'青色圓圈＝目前查核點；尚無可確認的地塊輪廓';}
 const rings=geo?.coordinates?.map(r=>r.map(p=>[p[1],p[0]]));
 for(const group of STATE.inspectPreviewGroups){
  if(!group?.addLayer)continue;
  const shape=rings?L.polygon(rings,{pane:'inspectPreview',color:'#00b8cb',weight:4,opacity:1,dashArray:'9 6',fill:false,interactive:false}):
   L.circleMarker(pos,{pane:'inspectPreview',radius:14,color:'#00b8cb',weight:3,opacity:1,fill:false,interactive:false});
  group.addLayer(shape);
 }
}

function renderAuditHistory(){const target=$('auditHistoryList');if(!target)return;
 const all=Object.values(STATE.audits).sort((a,b)=>(b.checkedAt||'').localeCompare(a.checkedAt||''));
 target.innerHTML=all.length?all.map(a=>`<button type="button" data-audit-key="${html(a.key)}"><b>${html(auditLabel(a))}</b>${a.recordUid&&STATE.records.some(r=>r.uid===a.recordUid)?` · <span class="subtle">關聯 ${html(STATE.records.find(r=>r.uid===a.recordUid).name)}</span>`:''}　${a.source==='manual'?'人工位置':((a.source==='tile'?'圖磚局部輪廓':('官方地塊 #'+html(a.objectId)))+(validAuditGeo(a.geometry)?' · 已有輪廓':' · 僅座標'))}<small>${Number(a.lat).toFixed(6)}, ${Number(a.lng).toFixed(6)} · ${html((a.checkedAt||'').slice(0,10))}</small></button>`).join(''):'<p class="subtle" style="padding:8px">尚無查核記錄。點選橘色地塊，或以人工方式標記已查的位置。</p>';
}
function renderAuditPins(){if(!STATE.mapReady||!STATE.auditGroups?.length)return;
 for(const group of STATE.auditGroups)group.clearLayers();
 for(const a of Object.values(STATE.audits)){
  // 'other' is a decision about an area, not a farm marker. Its gray outline stays clickable nearby.
  if(a.decision==='other'||+a.year!==STATE.year||!C.coord(Number(a.lat),Number(a.lng)))continue;
  const status={pig:'豬',maybe:'？',other:'×',defer:'·'}[a.decision]||'·';
  for(let i=0;i<STATE.auditGroups.length;i++){const group=STATE.auditGroups[i], zoom=STATE.maps[i].getZoom();
   // At district-wide zoom, reduce clutter without erasing any saved review.
   if(zoom<11)continue;
   const size=zoom>=17?24:zoom>=15?20:zoom>=13?15:11;
   const ico=L.divIcon({className:'',html:`<span class="audit-map-pin ${a.decision}" style="width:${size}px;height:${size}px;border-width:${size>=20?2:1}px;font-size:${Math.max(8,Math.round(size*.49))}px;border-radius:${Math.max(3,Math.round(size/4))}px">${status}</span>`,iconSize:[size,size],iconAnchor:[size/2,size/2]});
   const pin=L.marker([+a.lat,+a.lng],{icon:ico,pane:'auditPins',keyboard:true,bubblingMouseEvents:false});
   pin.bindTooltip((a.source==='manual'?'人工位置':a.source==='tile'?'圖磚局部輪廓':'F03 #'+a.objectId)+' · '+auditLabel(a));pin.on('click',()=>openSavedAudit(a.key));group.addLayer(pin);}
 }
 renderAuditHistory();renderAuditAreas();
}
function updateAuditRemoveButton(){
 const btn=$('auditRemove');if(!btn)return;
 const a=STATE.inspectParcel&&STATE.audits[STATE.inspectParcel.key];
 btn.hidden=!a;btn.disabled=!!STATE.savingAudit;
}
async function removeCurrentAudit(){
 if(STATE.savingAudit)return notice('正在儲存，請完成後再操作。');
 if(blockedByOtherTab())return notice('其他分頁已更新，請先備份後重新整理。');
 const key=STATE.inspectParcel?.key,a=key&&STATE.audits[key];
 if(!a)return notice('此位置沒有已儲存的查核標記。');
 if(!confirm('確定取消「'+auditLabel(a)+'」標記與這筆人工查核紀錄？\n只移除本裝置保存的查核資料，不會刪除官方 F03 圖層或既有豬場資料。'))return;
 const orphan=a.newRecordUid;
 delete STATE.audits[key];
 // Only remove a generated, unapproved point if no other saved review references it.
 if(orphan&&!Object.values(STATE.audits).some(x=>x.recordUid===orphan||x.newRecordUid===orphan)){
  const row=STATE.records.find(x=>x.uid===orphan);
  if(row&&row.review==='pending'&&row.uid===a.recordUid)STATE.records=STATE.records.filter(x=>x.uid!==orphan);
 }
 STATE.inspectParcel=null;STATE.inspectPoint=null;STATE.queueSelectedKey=null;
 $('auditPanel').hidden=true;clearInspectPreview();
 renderAuditPins();renderStats();renderList();renderQueue();renderZones();renderMarkers();
 persist(true);const ok=await flushSave();
 notice(ok?'已取消標記並更新本機查核紀錄。':'畫面已取消標記，但本機儲存失敗；請立即備份後重新整理。');
}
function openSavedAudit(key){const a=STATE.audits[key];if(!a)return;setAuditSheetPeeking(false);STATE.queueSelectedKey=null;resetSnapAssist();$('auditMatchSearch').value='';$('auditSavingNote').textContent='';STATE.auditMatchCleared=false; // re-review must not auto-advance an unrelated queue
 if(STATE.year!==+a.year){STATE.year=+a.year;$('f03ConfirmSource').checked=false;$('f03Year').value=String(a.year);STATE.queueSeq++;STATE.queueRows=[];STATE.queueBounds=null;STATE.queueZoneId=null;STATE.queueSelectedKey=null;renderQueue();renderAuditPins();renderZones();if(STATE.mapReady)scheduleF03();reloadOfflineF03(STATE.year);persist();}
 ++STATE.inspectSeq;STATE.inspectPoint=[Number(a.lat),Number(a.lng)];STATE.inspectParcel={key:a.key,objectId:a.objectId||null,year:a.year,source:a.source||'official',geometry:validAuditGeo(a.geometry)};
 $('auditPanel').hidden=false;$('auditHistory').hidden=true;
 $('repairAuditShape').hidden=!(a.source==='official'&&!validAuditGeo(a.geometry));
 $('auditPos').textContent=`緯度 ${Number(a.lat).toFixed(6)}／經度 ${Number(a.lng).toFixed(6)}`;
 $('auditState').textContent=a.source==='manual'?'人工查核記號（非官方地塊編號）':a.source==='tile'?'F03 向量圖磚局部輪廓（不是完整官方地塊，僅對此片段作人工判讀）':a.source==='offline'?'匯入 F03 GeoJSON 地塊（非即時官方查詢）':`既有官方地塊紀錄 #${a.objectId}（顯示歷史紀錄，尚未重新查詢官方資料）`;
 $('auditDecision').textContent='已記錄：'+auditLabel(a)+' · '+(a.checkedAt||'').slice(0,10);$('auditRemarks').value=a.note||'';
 $('auditActions').hidden=false;$('auditManual').hidden=a.source!=='manual';updateAuditRemoveButton();renderAuditNeighbors();
 if(a.recordUid&&STATE.records.some(r=>r.uid===a.recordUid)){$('auditNeighbors').value=a.recordUid;renderAuditNeighbors();}
 renderInspectPreview();
 if(STATE.mapReady)goto([Number(a.lat),Number(a.lng)],Math.max(STATE.maps[0].getZoom(),16));
}
function enableManualAudit(){resetSnapAssist();const pos=STATE.inspectPoint;if(!pos)return notice('請先選取要判讀的位置。');
 ++STATE.inspectSeq;const [lat,lng]=pos,near=Object.values(STATE.audits).find(a=>a.source==='manual'&&a.year===STATE.year&&Math.hypot((a.lat-lat)*110574,(a.lng-lng)*111320*Math.cos(lat*Math.PI/180))<12);
 const key=near?.key||`MANUAL-${STATE.year}-${lat.toFixed(6)}-${lng.toFixed(6)}`;
 STATE.inspectParcel={key,objectId:null,year:STATE.year,source:'manual'};
 $('auditState').textContent='人工查核位置（無官方 F03 地塊編號，不等同整塊土地已查）';$('auditActions').hidden=false;updateAuditRemoveButton();
 if(near){$('auditDecision').textContent='附近已有人工查核：'+auditLabel(near);$('auditRemarks').value=near.note||'';}
 updateAuditRemoveButton();renderInspectPreview();notice('已切換成人工位置查核，請選擇判讀分類並保存。');
}
function localNeighbors(point,limit=9){const query={geometry:{type:'Point',coordinates:[point[1],point[0]]}};return STATE.records.map(r=>({r,d:C.distance(query,r)})).filter(x=>x.d<=300).sort((a,b)=>a.d-b.d).slice(0,limit);}
// V3.3.6: never infer a farm identity from a GIS tile or nearby coordinates.
// Match candidates are sorted and presented for human review; no automated linking or deleting.
function auditMatchRows(query,point){
 const term=String(query||'').trim().toLocaleLowerCase();
 const all=STATE.records.map(r=>{
  const d=point?C.distance({geometry:{type:'Point',coordinates:[point[1],point[0]]}},r):Infinity;
  return {r,d:Number.isFinite(d)?d:Infinity};
 });
 if(!term)return all.filter(x=>x.d<=300).sort((a,b)=>a.d-b.d).slice(0,8);
 return all.filter(x=>[x.r.name,x.r.town,x.r.address,x.r.legacyId,x.r.uid].some(t=>String(t??'').toLocaleLowerCase().includes(term)))
  .sort((a,b)=>(a.d<=300?0:1)-(b.d<=300?0:1)||a.d-b.d||String(a.r.name).localeCompare(String(b.r.name),'zh-Hant')).slice(0,10);
}
function renderAuditNeighbors(){
 const select=$('auditNeighbors'),chosen=STATE.auditMatchCleared?'':(select.value||STATE.audits[STATE.inspectParcel?.key]?.recordUid||'');
 const query=$('auditMatchSearch').value,near=STATE.inspectPoint?localNeighbors(STATE.inspectPoint,315):[],results=auditMatchRows(query,STATE.inspectPoint);
 // Always retain a manually linked record in the hidden selector, even when outside the radius.
 const matches=[...results];let linked=STATE.records.find(r=>r.uid===chosen);
 if(linked&&!matches.some(x=>x.r.uid===chosen)){
  const distance=STATE.inspectPoint?C.distance({geometry:{type:'Point',coordinates:[STATE.inspectPoint[1],STATE.inspectPoint[0]]}},linked):Infinity;
  matches.unshift({r:linked,d:Number.isFinite(distance)?distance:Infinity});
 }
 select.innerHTML='<option value="">不關聯（新建立標記）</option>'+matches.map(x=>`<option value="${html(x.r.uid)}">${html(x.r.name)}</option>`).join('');
 select.value=linked?chosen:'';
 const current=select.value;
 $('auditMatches').innerHTML=matches.length?matches.map(x=>{
   const old=x.r,selected=old.uid===current;
   const distance=Number.isFinite(x.d)?Math.round(x.d)+'m':'無座標';
   const meta=[old.town||'鄉鎮未填',distance,old.review==='approved'?'舊版全部核定':'尚未核定'].join(' · ');
   const address=old.address||'地址未填';
   return `<button type="button" class="audit-match-row ${selected?'selected':''}" data-match-id="${html(old.uid)}" aria-pressed="${selected}"><span><b>${html(old.name||'未命名豬場')}</b><small>${html(meta)}</small><small>${html(address)}</small></span><span class="match-tag">${selected?'已選取':'選擇'}</span></button>`;
 }).join(''):`<p class="subtle">${query.trim()?'找不到相符的舊紀錄。':'目前300公尺內沒有既有標記，可以搜尋全部315筆或人工建立新位置。'}</p>`;
 linked=STATE.records.find(r=>r.uid===current);
 $('auditLinked').hidden=!linked;
 if(linked){const dist=STATE.inspectPoint?C.distance({geometry:{type:'Point',coordinates:[STATE.inspectPoint[1],STATE.inspectPoint[0]]}},linked):Infinity;
  $('auditLinked').innerHTML=`<strong>準備關聯：${html(linked.name)}</strong><small>${Number.isFinite(dist)?'與判讀位置相距 '+Math.round(dist)+' 公尺':'舊場尚無座標'} · ${linked.review==='approved'?'舊版全部核定':'未核定'}。儲存判讀後只記錄關聯，舊場分類、名稱、座標及核定均不變。</small>`;
 }
 $('auditUnlink').hidden=!linked;$('auditOpenRecord').hidden=!linked;
 const nearbyCount=near.filter(x=>x.d<=300).length;
 $('nearbyInfo').textContent=query.trim()?`搜尋結果最多顯示10筆；目前位置300公尺內有${nearbyCount}筆既有標記。請以影像、場址及資料人工核對。`:
  `附近300公尺共有${nearbyCount}筆既有標記；距離接近不代表同一場。`;
}
function selectAuditMatch(uid){
 if(!STATE.records.some(r=>r.uid===uid))return;
 // The match is only a user selection, not an automatic approval.
 STATE.auditMatchCleared=false;const select=$('auditNeighbors');if(![...select.options].some(o=>o.value===uid))select.add(new Option('',uid));select.value=uid;
 renderAuditNeighbors();
}
function unlinkAuditMatch(){STATE.auditMatchCleared=true;$('auditNeighbors').value='';renderAuditNeighbors();}
function openAuditLinkedFarm(){const uid=$('auditNeighbors').value;if(!uid)return;openRecord(uid,false);}
async function inspectAt(lat,lng,queueKey=null){setAuditSheetPeeking(false);if(STATE.savingAudit)return notice('上一筆正在儲存，請完成後再查核下一處。');resetSnapAssist();$('auditSavingNote').textContent='';STATE.queueSelectedKey=queueKey;const seq=++STATE.inspectSeq;STATE.inspectPoint=[lat,lng];STATE.inspectParcel=null;$('auditPanel').hidden=false;$('auditPos').textContent=`緯度 ${lat.toFixed(6)}／經度 ${lng.toFixed(6)} · 民國${STATE.year===4?'112':'111'}年`;$('auditState').textContent='正在查詢官方 F03 地塊編號…';$('auditDecision').textContent='';$('auditRemarks').value='';$('auditActions').hidden=true;updateAuditRemoveButton();$('repairAuditShape').hidden=true;$('auditMakePoint').hidden=false;$('auditManual').hidden=false;$('auditMatchSearch').value='';$('auditNeighbors').value='';STATE.auditMatchCleared=false;clearInspectPreview();renderAuditNeighbors();renderInspectNearby();
 if(f03ModeOffline()){
  const f=window.F03Local.at(STATE.year,lat,lng,f03SourceMode);
  if(f){const geom=validAuditGeo({type:'Polygon',coordinates:f.rings});
   STATE.inspectParcel={key:f.key,objectId:null,year:STATE.year,source:'offline',geometry:geom};
   $('auditState').textContent='已找到 F03 多邊形（來源：內建雲林112年或人工匯入；不代表已核定豬場）。'+(geom?'可保存輪廓。':'輪廓超過查核儲存上限，僅保存點位。');
   $('auditActions').hidden=false;$('auditManual').hidden=true;$('repairAuditShape').hidden=true;
   const prior=STATE.audits[f.key];if(prior){$('auditDecision').textContent='已查過：'+auditLabel(prior);$('auditRemarks').value=prior.note||'';if(prior.recordUid){$('auditNeighbors').value=prior.recordUid;renderAuditNeighbors();}}
   renderInspectPreview();return;
  }
  $('auditState').textContent='此點不在已匯入 F03 地塊內（不代表官方沒有畜牧用地）；可改用人工查核記號。';$('auditManual').hidden=false;return;
 }
 const params=new URLSearchParams({f:'json',where:'1=1',geometry:JSON.stringify({x:lng,y:lat,spatialReference:{wkid:4326}}),geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'OBJECTID,縣市,盤查分類',returnGeometry:'true',outSR:'4326',geometryPrecision:'6',maxAllowableOffset:'0.000005'});
 try{const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);let response;try{response=await fetch(`${F03}/${STATE.year}/query?${params}`,{signal:ctrl.signal,cache:'no-store'});}finally{clearTimeout(timer);}if(!response.ok)throw Error(`HTTP ${response.status}`);const payload=await response.json();if(payload.error)throw Error(payload.error.message||'官方圖資查詢錯誤');if(seq!==STATE.inspectSeq)return;const rows=payload.features||[];
  const item=rows.find(f=>Number.isFinite(Number(f.attributes?.OBJECTID)));if(!item)throw Error('官方查無此點地塊編號');
  const key=`F03-${STATE.year}-${item.attributes.OBJECTID}`;STATE.inspectParcel={key,objectId:item.attributes.OBJECTID,year:STATE.year,geometry:officialAuditGeo(item.geometry)||validAuditGeo(STATE.audits[key]?.geometry)};$('auditState').textContent=`官方地塊 #${item.attributes.OBJECTID} · ${item.attributes['盤查分類']||'畜牧使用'} · ${STATE.inspectParcel.geometry?'已有可保存輪廓':'輪廓暫無法取得，保留點位'}（仍待人工判讀）`;$('auditActions').hidden=false;$('auditManual').hidden=true;$('repairAuditShape').hidden=!!STATE.inspectParcel.geometry;const previous=STATE.audits[key];if(previous){$('auditDecision').textContent=`已查過：${{pig:'人工判定豬場',maybe:'疑似豬場',other:'其他／非豬場',defer:'暫不判斷'}[previous.decision]} · ${previous.checkedAt?.slice(0,10)||''}`;$('auditRemarks').value=previous.note||'';if(previous.recordUid&&STATE.records.some(x=>x.uid===previous.recordUid)){$('auditNeighbors').value=previous.recordUid;renderAuditNeighbors();}}renderInspectPreview();
 }catch(err){
  if(seq!==STATE.inspectSeq)return;
  $('auditState').textContent='官方識別碼未能取得，正在利用已載入的 F03 向量圖磚辨識局部輪廓…';
  try{
   const local=await window.PigF03.tileFragmentAt(STATE.year,lat,lng);if(seq!==STATE.inspectSeq)return;
   if(local){STATE.inspectParcel=local;
    $('auditState').textContent='已取得 F03 圖磚局部輪廓（非完整官方地塊、非官方編號），可人工判讀。';
    $('auditActions').hidden=false;$('auditManual').hidden=true;
    const previous=STATE.audits[local.key];if(previous){$('auditDecision').textContent='已查過此局部範圍：'+auditLabel(previous);$('auditRemarks').value=previous.note||'';if(previous.recordUid){$('auditNeighbors').value=previous.recordUid;renderAuditNeighbors();}}renderInspectPreview();
   }else{
    // Touch assist: a narrowly missed F03 outline is suggested, never automatically selected.
    const map=STATE.maps[STATE.view==='survey'?0:1]||STATE.maps[0];
    let snap=null;
    if(map){const origin=map.latLngToContainerPoint([lat,lng]);
      const offsets=[[0,-8],[8,0],[0,8],[-8,0],[8,-8],[8,8],[-8,8],[-8,-8],[0,-16],[16,0],[0,16],[-16,0]];
      for(const [dx,dy] of offsets){if(seq!==STATE.inspectSeq)return;
       const ll=map.containerPointToLatLng(origin.add(L.point(dx,dy)));
       let fragment=null;try{fragment=await window.PigF03.tileFragmentAt(STATE.year,ll.lat,ll.lng);}catch(error){continue;}
       if(fragment){const metres=Math.hypot((ll.lat-lat)*110574,(ll.lng-lng)*111320*Math.cos(lat*Math.PI/180));snap={seq,lat:ll.lat,lng:ll.lng,metres,parcel:fragment};break;}
      }
    }
    if(seq!==STATE.inspectSeq)return;
    if(snap){STATE.pendingSnap=snap;$('auditSnapReview').hidden=false;renderInspectNearby();
      $('auditSnapInfo').textContent=`在距離點選處約 ${Math.round(snap.metres)} 公尺處找到橘色局部片段。請先看航照確認是否同一地塊；不確認就不會使用此片段。`;
      $('auditState').textContent='附近有橘色候選，需要按下方「確認使用」；也可改選人工查核記號。';
    }else $('auditState').textContent='此點及附近 16 畫素未找到可辨識的 F03 橘色片段；可改用人工查核記號。';
   }
  }catch(error){if(seq!==STATE.inspectSeq)return;$('auditState').textContent='官方地塊查詢與圖磚輪廓皆未成功。可以建立人工查核點；不會生成假的官方編號。';}
 }
}
async function saveAudit(decision){if(STATE.savingAudit)return false;if(blockedByOtherTab()){notice('另一分頁已有更新：請先備份，不要繼續判讀以免覆寫。');return false;}const parcel=STATE.inspectParcel,pos=STATE.inspectPoint;if(!parcel||!pos)return notice('請先取得官方編號，或點「人工查核記號」。');const chosen=$('auditNeighbors').value,now=new Date().toISOString();let uid='',generatedUid='';const queueKey=STATE.queueSelectedKey;
 if(decision==='pig'||decision==='maybe'){
   if(chosen){const existing=STATE.records.find(x=>x.uid===chosen);if(!existing)return notice('選取的舊豬場不存在，請重新選擇。');const d=C.distance({geometry:{type:'Point',coordinates:[pos[1],pos[0]]}},existing);
    const reason=Number.isFinite(d)?`距離 ${Math.round(d)} 公尺`:'舊紀錄尚無座標';
    if((!Number.isFinite(d)||d>300)&&!confirm(`你選擇關聯「${existing.name}」，但${reason}，無法直接驗證是否同場。\n確認已人工比對名稱、地址及航照，仍要關聯嗎？`))return;
    uid=existing.uid; // Leave existing name/category/review/coordinates untouched.
   }
   else if((STATE.failedAuditKey===parcel.key||!STATE.auditMatchCleared)&&STATE.audits[parcel.key]?.newRecordUid&&STATE.records.some(x=>x.uid===STATE.audits[parcel.key].newRecordUid)){
    uid=STATE.audits[parcel.key].newRecordUid;generatedUid=uid; // Retry existing unsaved mark instead of adding a duplicate.
   }
   else {const close=localNeighbors(pos).filter(x=>x.d<=300);if(close.length&&!confirm(`300公尺內已有 ${close.length} 筆舊標記，最近為「${close[0].r.name}」（${Math.round(close[0].d)}公尺）。\n請先比對是否同一場。確定要另建新的未核定標記嗎？`))return;
    const newRow=C.normalize({uid:newId(),name:parcel.source==='manual'?'人工判讀新地點':parcel.source==='tile'?'未命名畜牧區域（圖磚局部）':parcel.source==='offline'?'未命名畜牧區域（離線 F03）':'未命名地塊 '+parcel.objectId,town:'',geometry:{type:'Point',coordinates:[pos[1],pos[0]]},category:decision,review:'pending',source:parcel.source==='manual'?'人工航照位置判讀':parcel.source==='tile'?'F03 向量圖磚局部形狀＋人工判讀':parcel.source==='offline'?'匯入 F03 GeoJSON＋人工判讀（未經線上核實）':`F03 ${parcel.year===4?'112':'111'} 年畜牧使用＋人工判讀`,evidence:'人工初判，仍須 ATIS 航照／其他證據核對',note:$('auditRemarks').value.trim(),createdAt:now});STATE.records.push(newRow);uid=newRow.uid;generatedUid=uid;updateTownOptions();}
 }
 const prior=STATE.audits[parcel.key]||{};
 // Reclassifying a newly created provisional farm as 'other' must also retire
 // its generated map record, or a second farm dot would remain on the map.
 if(decision==='other' && prior.newRecordUid){
  const orphan=prior.newRecordUid;
  const stillLinked=Object.values(STATE.audits).some(a=>a.key!==parcel.key&&(a.recordUid===orphan||a.newRecordUid===orphan));
  const row=STATE.records.find(r=>r.uid===orphan);
  if(!stillLinked&&row?.review==='pending')STATE.records=STATE.records.filter(r=>r.uid!==orphan);
 }
 STATE.audits[parcel.key]={...prior,key:parcel.key,objectId:parcel.objectId,source:['manual','tile','offline'].includes(parcel.source)?parcel.source:'official',year:parcel.year,lat:pos[0],lng:pos[1],decision,geometry:parcel.source==='manual'?null:(validAuditGeo(parcel.geometry)||validAuditGeo(prior.geometry)),note:$('auditRemarks').value.trim(),recordUid:uid||'',newRecordUid:generatedUid||null,linkedBy:uid?'manual-selection':null,checkedAt:now,tileKey:queueKey||prior.tileKey||null};
 if(queueKey&&STATE.candidateSkips[queueKey])delete STATE.candidateSkips[queueKey];renderInspectNearby();renderQueue();renderStats();renderList();renderAuditNeighbors();renderAuditPins();renderZones();renderMarkers();
 STATE.savingAudit=true;const buttons=[...document.querySelectorAll('#auditActions [data-audit]')];buttons.forEach(b=>b.disabled=true);
 $('auditSavingNote').textContent='正在儲存查核結果…';
 let ok=false;
 try{persist();ok=await flushSave();}
 finally{STATE.savingAudit=false;buttons.forEach(b=>b.disabled=false);}
 if(!ok){STATE.failedAuditKey=parcel.key;$('auditSavingNote').textContent='⚠ 本機儲存失敗；已留在目前查核畫面。請立即下載 JSON 備份，確認儲存後再繼續。';notice('儲存失敗：不會自動前往下一處。請先下載備份。');return false;}
 STATE.failedAuditKey=null;$('auditSavingNote').textContent='✓ 查核結果已寫入 '+lastSavedMethod;
 $('auditDecision').textContent='已記錄此次人工判讀（非官方豬場證明）。';$('auditNeighbors').value=uid;updateAuditRemoveButton();
 notice(decision==='other'?'已儲存非豬場，沒有建立豬場標記。':'查核已儲存；新建豬場標記仍屬未核定。');
 if(queueKey&&$('queueAutoNext').checked)nextQueueCandidate();
 return true;
}

/* V3.3.6: current-viewport F03 MVT fragments -> non-persistent review queue.
 * A row is not an official parcel ID or a claim the viewport was completely surveyed. */
function queueBounds(){const m=STATE.maps[STATE.view==='aerial'?1:0]||STATE.maps[0];const b=m.getBounds();return {west:b.getWest(),east:b.getEast(),north:b.getNorth(),south:b.getSouth()};}
// V3.3.6 conservative duplicate management: NO automatic spatial deletion.
function validCandidateSkips(value){const o={};if(!value||typeof value!=='object'||Array.isArray(value))return o;
 for(const [key,v] of Object.entries(value).slice(0,2000)){
  if(!/^(?:TILE-[45]-12-\d+-\d+-\d+|OFFLINE-[45]-[0-9a-f]{8}-\d+-\d+)$/.test(key)||!v||typeof v!=='object')continue;
  o[key]={at:String(v.at||'').slice(0,40),reason:'人工判為重複候選（非地塊核定）'};
 }return o;
}
function candidateState(row){const a=queueAudit(row);if(a){return a.decision==='defer'?'defer':'done';}
 return STATE.candidateSkips[row?.key]?'skip':'pending';}
function nearbyCandidateCount(row,rows=STATE.queueRows,metres=25){
 if(!row)return 0;const lat=Number(row.lat),lng=Number(row.lng);if(!C.coord(lat,lng))return 0;
 return rows.filter(r=>r.key!==row.key&&r.year===row.year&&Math.hypot((r.lat-lat)*110574,(r.lng-lng)*111320*Math.cos(lat*Math.PI/180))<=metres).length;
}
function skipCurrentCandidate(){const key=STATE.queueSelectedKey;if(!key||!STATE.queueRows.some(r=>r.key===key))return notice('請先從候選清單選一處。');
 if(queueAudit(STATE.queueRows.find(r=>r.key===key)))return notice('此候選已有判讀紀錄，請在查核紀錄中調整，無法將已判讀地塊直接略過。');
 if(!confirm('確定把這個 F03 局部候選標為「人工略過重複」？\n這不是官方認定，也不會刪除地塊、豬場或查核紀錄；可以隨時撤銷。'))return;
 STATE.candidateSkips[key]={at:new Date().toISOString(),reason:'人工判為重複候選（非地塊核定）'};
 renderQueue();renderZones();persist();notice('已人工略過這個候選；沒有刪除原始 F03 圖資。');
 if($('queueAutoNext').checked)nextQueueCandidate();
}
function unskipCurrentCandidate(){const key=STATE.queueSelectedKey;if(!key||!STATE.candidateSkips[key])return;
 delete STATE.candidateSkips[key];renderQueue();renderZones();persist();notice('已撤銷略過，可重新查核。');
}
function renderSkipButtons(){if(!$('queueSkip'))return;const key=STATE.queueSelectedKey,row=STATE.queueRows.find(r=>r.key===key),skipped=!!STATE.candidateSkips[key];
 $('queueSkip').hidden=!row||skipped||!!queueAudit(row);$('queueUnskip').hidden=!row||!skipped;
 $('candidateNearby').textContent=row?(nearbyCandidateCount(row)?`提醒：25 公尺內有 ${nearbyCandidateCount(row)} 個其他候選片段，可能重疊，也可能是真正相鄰的不同設施；不會自動合併。`:'此候選附近沒有其他 25 公尺內候選；人工比對後再決定。'):'';
}
function queueAudit(row){if(!row)return null;
 const direct=STATE.audits[row.key];if(direct&&+direct.year===row.year)return direct;
 for(const audit of Object.values(STATE.audits)){
  if(+audit.year!==row.year)continue;
  if(audit.tileKey===row.key)return audit;
  // Only a saved official polygon can establish spatial coverage of this fragment point.
  if(audit.source==='official'&&validAuditGeo(audit.geometry)&&window.PigF03.insidePolygon([row.lng,row.lat],audit.geometry.coordinates))return audit;
 }
 return null;
}
function renderQueueHighlight(){for(const g of STATE.queueHighlights)g.clearLayers();
 if(!STATE.mapReady||!STATE.queueSelectedKey)return;
 const row=STATE.queueRows.find(x=>x.key===STATE.queueSelectedKey);if(!row)return;
 for(const g of STATE.queueHighlights){g.addLayer(L.circleMarker([row.lat,row.lng],{radius:10,color:'#d54820',fillColor:'#fff0c2',weight:3,fillOpacity:.6,interactive:false}));}
}
function renderQueue(){const list=$('queueList');if(!list)return;
 const rows=STATE.queueRows,reviewed=rows.filter(r=>candidateState(r)==='done').length,skipped=rows.filter(r=>candidateState(r)==='skip').length,deferred=rows.filter(r=>candidateState(r)==='defer').length;
 const pending=rows.filter(r=>candidateState(r)==='pending').length,all=rows.length;
 const s=$('queueSummary');if(!STATE.queueBounds){s.textContent='尚未掃描。先放大地圖，按「掃描目前畫面」。';}
 else{s.textContent=`${STATE.queueZoneId?'工作區 '+(STATE.zones.find(z=>z.id===STATE.queueZoneId)?.name||'')+' · ':''}本次 ${all} 個候選：已判讀 ${reviewed}、稍後查 ${deferred}、人工略過 ${skipped}、未查 ${pending}。僅限此次掃描。`;}
 const only=$('queueOnlyPending').checked;const show=rows.filter(r=>!only||['pending','defer'].includes(candidateState(r)));
 list.innerHTML=show.length?show.map(r=>{
  const state=candidateState(r),a=queueAudit(r),active=r.key===STATE.queueSelectedKey,near=nearbyCandidateCount(r);
  const label=state==='done'?auditLabel(a):state==='defer'?'稍後查':state==='skip'?'人工略過':'未查';
  return `<button type="button" class="queue-item ${active?'selected':''}" data-queue-key="${html(r.key)}"><span><span class="queue-number">${html(r.key.split('-').slice(-3).join('/'))} · 候選 ${rows.indexOf(r)+1}</span><small>${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}${near?' · 25m 內另有 '+near+' 候選':''}</small></span><span class="queue-tag ${state==='done'?'done':state}">${html(label)}</span></button>`;
 }).join(''):'<div class="empty">'+(rows.length?'沒有符合篩選的未查候選；可取消勾選查看人工略過／已查項目':'此畫面尚無候選；請放大或重新掃描')+'</div>';
 $('queueNext').disabled=(pending+deferred)===0;
 renderQueueHighlight();renderSkipButtons();renderZoneAreas();
}
async function scanQueue(zoneId=null){if(!STATE.mapReady)return notice('地圖尚未初始化。');
 const zone=typeof zoneId==='string'?STATE.zones.find(z=>z.id===zoneId):null;
 if(zone&&zone.year!==STATE.year)return notice('盤查年度不一致，請先按該工作區的「前往」，再重新掃描。');
 const map=STATE.maps[STATE.view==='aerial'?1:0]||STATE.maps[0],z=map.getZoom(),cfg=window.PigF03;
 if(!cfg){notice('F03 解碼程式未載入');return;}
 if(z<13&&!zone){$('queueStatus').textContent='建議先放大至 Z13 以上，才不會一次包含太多畜牧地塊。';notice('請先放大到 Z13 以上再掃描。');return;}
 const bounds=zone?zone.bounds:queueBounds();
 if(f03ModeOffline()){
  if(!activeF03Dataset())return notice('此年度尚無可用的內建或匯入 F03 地塊。');
  return scanOfflineQueue(zone,bounds,map,z);
 }
 const range=cfg.tileRange(bounds),tiles=[];
 for(let y=range.ymin;y<=range.ymax;y++)for(let x=range.xmin;x<=range.xmax;x++)tiles.push({z:12,x,y});
 if(tiles.length>12){$('queueStatus').textContent=`目前涵蓋 ${tiles.length} 張原生圖磚，範圍過大。請放大一些再掃描（最多12張）。`;return;}
 const token=++STATE.queueSeq;STATE.queueScanActive=true;$('queueScan').disabled=true;
 $('queueStatus').textContent=`讀取 ${tiles.length} 張官方 F03 原生圖磚中…`;
 const found=[],failed=[];
 // limited concurrency instead of an unbounded fetch storm
 let index=0;async function worker(){while(index<tiles.length){if(token!==STATE.queueSeq)return;const t=tiles[index++];
  try{const layers=await cfg.getTileLayers(STATE.year,12,t.x,t.y);if(token!==STATE.queueSeq)return;
   found.push(...cfg.candidatesFromTile(STATE.year,12,t.x,t.y,layers,bounds));
  }catch(e){failed.push(`${t.x}/${t.y}: ${String(e.message||e).slice(0,48)}`);}
 }}
 await Promise.all(Array.from({length:Math.min(3,tiles.length)},()=>worker()));
 if(token!==STATE.queueSeq)return;
 STATE.queueScanActive=false;$('queueScan').disabled=false;
 // V3.3.6：部分失敗也不能視為完整盤查；不覆蓋既有候選與工作區。
 // 注意：僅有一張圖磚失敗，就可能漏掉真正的畜牧使用區塊。
 if(failed.length){
   const good=tiles.length-failed.length;
   $('queueStatus').textContent=`F03 僅讀取 ${good}/${tiles.length} 張圖磚；為避免漏查，本次不取代原候選清單與進度。請重試掃描。`;
   $('queueStatus').title=failed.join('\n');
   notice('圖磚讀取不完整；原有盤查進度已保留。');
   return;
 }
 // 對已儲存的工作區，來源空白時保留原掃描，避免網路/服務回應異常誤清空。
 if(!found.length && zone?.lastScan?.rows?.length){
   $('queueStatus').textContent='本次沒有取得候選。原工作區仍有歷史候選，系統已保留舊資料；可檢查年份和範圍後重試。';
   notice('本次結果為零；已保留上次工作區候選。');
   return;
 }
 const c=map.getCenter(),toCenter=r=>Math.hypot((r.lat-c.lat)*110574,(r.lng-c.lng)*111320*Math.cos(c.lat*Math.PI/180));
 const unique=[...new Map(found.map(r=>[r.key,r])).values()];
 unique.sort((a,b)=>toCenter(a)-toCenter(b));
 STATE.queueRows=unique.slice(0,200);STATE.queueSelectedKey=null;STATE.queueZoneId=zone?.id||null;STATE.queueBounds={bounds,year:STATE.year,zoom:z};
 if(zone){zone.lastScan={at:new Date().toISOString(),rows:STATE.queueRows.map(r=>({key:r.key,year:r.year,lat:r.lat,lng:r.lng})),tileCount:tiles.length,failedCount:failed.length,truncated:unique.length>200,foundCount:unique.length};zone.lastKey=null;zone.updatedAt=new Date().toISOString();persist();renderZones();}
 $('queueStatus').textContent=`${tiles.length-failed.length}/${tiles.length} 張圖磚成功；找到 ${unique.length} 個可定位片段${unique.length>200?'，只顯示最近200個':''}${failed.length?'；'+failed.length+' 張失敗，結果不完整':''}。`;
 if(failed.length){$('queueStatus').title=failed.join('\n');}
 else $('queueStatus').removeAttribute('title');
 renderQueue();
}
function openQueueCandidate(key){if(STATE.savingAudit)return notice('正在儲存這筆查核，請完成後再切換。');const r=STATE.queueRows.find(x=>x.key===key);if(!r)return;
 $('queuePanel').hidden=true;
 if(STATE.mapReady){const m=STATE.maps[STATE.view==='aerial'?1:0]||STATE.maps[0];m.setView([r.lat,r.lng],Math.max(16,m.getZoom()),{animate:false});}
 STATE.queueSelectedKey=r.key;if(STATE.queueZoneId){const z=STATE.zones.find(z=>z.id===STATE.queueZoneId);if(z){z.lastKey=r.key;z.updatedAt=new Date().toISOString();persist();renderZones();}}renderQueueHighlight();renderSkipButtons();renderZoneAreas();inspectAt(r.lat,r.lng,r.key);
}
function nextQueueCandidate(){if(STATE.savingAudit)return notice('查核結果寫入中，請完成儲存後再接續。');const rows=STATE.queueRows;
 let pending=rows.filter(r=>candidateState(r)==='pending');
 const activeIndex=rows.findIndex(r=>r.key===STATE.queueSelectedKey);
 if(!pending.length){pending=rows.filter(r=>candidateState(r)==='defer'&&r.key!==STATE.queueSelectedKey);}
 if(!pending.length){$('auditPanel').hidden=true;$('queuePanel').hidden=false;renderQueue();notice('目前沒有其他可接續的未查候選；稍後查的地點可從清單重新選取。');return;}
 const next=pending.find(r=>rows.indexOf(r)>activeIndex)||pending[0];openQueueCandidate(next.key);
}

/* V3.3.6: user-defined screen-bounds workspaces. A zone is NEVER an administrative or cadastral boundary.
   The persisted queue is a sampling of MVT fragments. Countable progress is only within this sampling. */
function validZoneBounds(v){if(!v||typeof v!=='object')return null;
 const {west,east,south,north}=Object.fromEntries(['west','east','south','north'].map(k=>[k,Number(v[k])]));
 if(!C.coord(south,west)||!C.coord(north,east)||west>=east||south>=north)return null;
 if(east-west>2||north-south>2)return null;
 return {west,east,south,north};
}
function validZones(value){if(!Array.isArray(value))return [];
 const result=[],ids=new Set();
 for(const raw of value.slice(0,40)){
  if(!raw||typeof raw!=='object')continue;
  const id=String(raw.id||'').slice(0,70),bounds=validZoneBounds(raw.bounds),year=raw.year===5?5:4;
  if(!/^zone-[a-zA-Z0-9_-]{5,64}$/.test(id)||ids.has(id)||!bounds)continue;
  const rawRows=Array.isArray(raw.lastScan?.rows)?raw.lastScan.rows:[];
  const rows=rawRows.slice(0,200).filter(r=>r&&(/^(?:TILE-[45]-12-\d+-\d+-\d+|OFFLINE-[45]-[0-9a-f]{8}-\d+-\d+)$/.test(String(r.key)))&&C.coord(Number(r.lat),Number(r.lng)))
   .map(r=>({key:String(r.key),year,lat:Number(r.lat),lng:Number(r.lng)}));
  const scan=raw.lastScan&&typeof raw.lastScan==='object'?{at:String(raw.lastScan.at||'').slice(0,40),rows,
   tileCount:Math.min(500,Math.max(0,Math.floor(Number(raw.lastScan.tileCount)||0))),failedCount:Math.min(500,Math.max(0,Math.floor(Number(raw.lastScan.failedCount)||0))),
   truncated:raw.lastScan.truncated===true,foundCount:Math.min(100000,Math.max(rows.length,Math.floor(Number(raw.lastScan.foundCount)||0)))}:null;
  result.push({id,name:String(raw.name||'未命名工作區').trim().slice(0,60)||'未命名工作區',year,bounds,
   zoom:Math.min(20,Math.max(7,Number(raw.zoom)||15)),createdAt:String(raw.createdAt||'').slice(0,40),updatedAt:String(raw.updatedAt||'').slice(0,40),
   lastScan:scan,lastKey:rows.some(r=>r.key===raw.lastKey)?raw.lastKey:null});ids.add(id);
  if(result.length>=30)break;
 }
 return result;
}
function activeZone(){return STATE.zones.find(z=>z.id===STATE.activeZoneId)||null;}
function zoneScanStats(zone){const rows=zone.lastScan?.rows||[],states=rows.map(candidateState);
 return {total:rows.length,done:states.filter(x=>x==='done').length,skipped:states.filter(x=>x==='skip').length,deferred:states.filter(x=>x==='defer').length,pending:states.filter(x=>x==='pending').length,failed:zone.lastScan?.failedCount||0,truncated:!!zone.lastScan?.truncated};
}
function zoneDisplayDate(value){const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'尚未掃描';}
function renderZoneAreas(){if(!STATE.mapReady||!STATE.zoneAreaLayers.length)return;
 for(const g of STATE.zoneAreaLayers)g.clearLayers();for(const g of STATE.zoneCandidateLayers)g.clearLayers();
 if(STATE.showZoneOutlines){for(const z of STATE.zones){const active=z.id===STATE.activeZoneId,b=z.bounds;
  const stats=zoneScanStats(z),corners=[[b.south,b.west],[b.north,b.east]];
  for(const g of STATE.zoneAreaLayers){const rectangle=L.rectangle(corners,{color:active?'#087c65':'#7668a9',weight:active?3:1.7,dashArray:active?null:'6 5',fill:false,interactive:true,bubblingMouseEvents:false,pane:'auditAreas',className:'zone-area-outline'});
   rectangle.bindTooltip(`${html(z.name)}（民國${z.year===4?'112':'111'}年）· 本次已判讀 ${stats.done}/${stats.total}、略過 ${stats.skipped}、稍後查 ${stats.deferred}`,{sticky:true});rectangle.on('click',()=>{jumpZone(z.id);$('zonePanel').hidden=false;renderZones();});g.addLayer(rectangle);
  }
 }}
 const zone=activeZone();if(!STATE.showZoneCandidates||!zone?.lastScan?.rows?.length||zone.year!==STATE.year)return;
 const colors={pending:'#f19b36',done:'#218467',defer:'#8765ad',skip:'#82919a'};
 for(const row of zone.lastScan.rows.slice(0,200)){
  const state=candidateState(row),fill=colors[state];for(const g of STATE.zoneCandidateLayers){
   const pin=L.circleMarker([row.lat,row.lng],{radius:5.5,color:'#ffffff',weight:1.5,fillColor:fill,fillOpacity:.96,bubblingMouseEvents:false});
   pin.bindTooltip(`${html(zone.name)} · ${state==='done'?'已判讀':state==='defer'?'稍後查':state==='skip'?'人工略過':'待查核'}`);
   pin.on('click',()=>{if(STATE.queueZoneId!==zone.id||!STATE.queueRows.some(r=>r.key===row.key)){
    STATE.queueZoneId=zone.id;STATE.queueRows=zone.lastScan.rows.map(x=>({...x}));STATE.queueBounds={bounds:zone.bounds,year:zone.year,zoom:zone.zoom};
   }openQueueCandidate(row.key);});g.addLayer(pin);
  }
 }
}
function renderZones(){const el=$('zoneList');if(!el)return;
 const zones=STATE.zones;el.innerHTML=zones.length?zones.map(z=>{
  const info=zoneScanStats(z),percent=info.total?Math.round(info.done/info.total*100):0;
  const latest=z.lastScan;
  return `<article class="zone-card ${z.id===STATE.activeZoneId?'active':''}" data-zone-id="${html(z.id)}">
    <div class="zone-title"><b>${html(z.name)}</b><small>${z.year===4?'112':'111'} 年 · ${z.id===STATE.activeZoneId?'正在使用':'自訂工作區'}</small></div>
    <div class="zone-meta">${latest?`最近掃描：${html(zoneDisplayDate(latest.at))} · 目前保存 ${info.total} 個候選片段<br>已判讀 ${info.done} / ${info.total} · 未查 ${info.pending} · 稍後 ${info.deferred} · 略過 ${info.skipped}`:'尚無掃描紀錄，可以先「前往」再「掃描」'}</div>
    <div class="zone-progress" aria-label="本次候選已判讀比例 ${percent}%（人工略過不計完成）"><span style="width:${percent}%"></span></div>
    ${latest?(info.failed||info.truncated?`<div class="zone-caption">${info.failed?'有 '+info.failed+' 張圖磚失敗；':''}${info.truncated?'候選超過200筆，僅保存前200筆；':''}結果不完整</div>`:'<div class="zone-caption">進度僅限最近一次掃描到的候選，不等於整區完成</div>'):''}
    <div class="zone-actions"><button data-zone-action="go" data-zone-id="${html(z.id)}">前往</button><button data-zone-action="scan" data-zone-id="${html(z.id)}">重新掃描</button><button data-zone-action="resume" data-zone-id="${html(z.id)}" ${!latest?.rows?.length?'disabled':''}>繼續上次</button><button class="danger" data-zone-action="delete" data-zone-id="${html(z.id)}">刪除</button></div>
   </article>`;
 }).join(''):'<div class="zone-empty">還沒有工作區。移動地圖至想盤查的區域並放大，再按「儲存目前畫面」。</div>';
 renderZoneAreas();$('zoneShowOutlines').checked=STATE.showZoneOutlines;$('zoneShowCandidates').checked=STATE.showZoneCandidates;
}
function jumpZone(id){const z=STATE.zones.find(x=>x.id===id);if(!z)return;
 STATE.activeZoneId=id;STATE.year=z.year;$('f03Year').value=String(z.year);$('f03ConfirmSource').checked=false;reloadOfflineF03(STATE.year);
 STATE.queueSeq++;STATE.queueRows=[];STATE.queueBounds=null;STATE.queueZoneId=null;STATE.queueSelectedKey=null;
 if(STATE.mapReady){STATE.maps[0].fitBounds([[z.bounds.south,z.bounds.west],[z.bounds.north,z.bounds.east]],{padding:[18,18],animate:false});scheduleF03();renderAuditPins();}
 renderQueue();renderZones();persist();
}
function createZone(){if(!STATE.mapReady)return notice('地圖尚未載入。');if(STATE.zones.length>=30)return notice('最多建立30個工作區；可先備份並刪除不再使用的工作區。');
 const map=STATE.maps[STATE.view==='aerial'?1:0]||STATE.maps[0],z=map.getZoom();if(z<13)return notice('請先放大至 Z13 以上，再儲存目前畫面作為工作區。');
 const bounds=queueBounds(),range=window.PigF03?.tileRange(bounds);if(!range)return notice('F03 圖層尚未準備好，無法建立可掃描工作區。');
 const tileCount=(range.xmax-range.xmin+1)*(range.ymax-range.ymin+1);
 if(tileCount>12)return notice('工作區包含超過12張原生圖磚，請再放大後儲存，以免掃描不完整。');
 const name=prompt('為目前畫面命名工作區（這是自訂矩形，非行政區界線）：',`自訂盤查區 ${STATE.zones.length+1}`);
 if(name===null)return;
 if(!name.trim())return notice('請輸入工作區名稱。');
 const id='zone-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);
 const zone={id,name:name.trim().slice(0,60),year:STATE.year,bounds,zoom:z,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),lastScan:null,lastKey:null};
 STATE.zones.push(zone);STATE.activeZoneId=id;renderZones();persist();notice('已儲存自訂盤查範圍；請按「重新掃描」建立候選清單。');
}
function resumeZone(id){const z=STATE.zones.find(x=>x.id===id);if(!z||!z.lastScan?.rows?.length)return notice('這個工作區尚未掃描，請先按重新掃描。');
 jumpZone(id);STATE.queueZoneId=id;STATE.queueRows=z.lastScan.rows.map(x=>({...x}));STATE.queueBounds={bounds:z.bounds,year:z.year,zoom:z.zoom};
 STATE.queueSelectedKey=z.lastKey||null;
 $('queuePanel').hidden=false;$('zonePanel').hidden=true;
 $('queueStatus').textContent=`已恢復「${z.name}」最近一次掃描候選。${z.lastScan.failedCount?'原掃描有圖磚失敗。':''} 未自動重新掃描。`;
 let pending=STATE.queueRows.filter(r=>candidateState(r)==='pending');
 if(!pending.length)pending=STATE.queueRows.filter(r=>candidateState(r)==='defer');
 if(!pending.length){renderQueue();notice('這批候選已判讀或人工略過，沒有未查候選；可重新掃描補查。');return;}
 const preferred=pending.find(x=>x.key===z.lastKey)||pending[0];
 openQueueCandidate(preferred.key);
}
function removeZone(id){const z=STATE.zones.find(x=>x.id===id);if(!z)return;
 if(!confirm(`要刪除「${z.name}」工作區及其最近掃描清單？\n已保存的豬場標記和人工查核紀錄不會刪除。`))return;
 STATE.zones=STATE.zones.filter(x=>x.id!==id);if(STATE.activeZoneId===id)STATE.activeZoneId=null;if(STATE.queueZoneId===id)STATE.queueZoneId=null;
 renderZones();persist();notice('工作區已刪除，原有豬場及判讀紀錄保留。');
}
function exportZoneCSV(){const esc=s=>'"'+String(s??'').replace(/"/g,'""')+'"';
 const rows=[['工作區名稱','盤查年度','範圍南緯','範圍西經','範圍北緯','範圍東經','最後掃描','本次候選片段','已人工判讀','尚未判讀','稍後再查','人工略過重複候選','失敗圖磚','候選截斷']];
 for(const z of STATE.zones){const stats=zoneScanStats(z);rows.push([z.name,z.year===4?'112':'111',z.bounds.south,z.bounds.west,z.bounds.north,z.bounds.east,z.lastScan?.at||'',stats.total,stats.done,stats.pending,stats.deferred,stats.skipped,stats.failed,stats.truncated?'是':'否']);}
 download('\ufeff'+rows.map(r=>r.map(esc).join(',')).join('\r\n'),'豬場盤查_自訂工作區進度.csv','text/csv;charset=utf-8');
}

function bind(){
 $('f03Source').addEventListener('change',e=>{const wanted=e.target.value;
  if(wanted==='offline'&&!window.F03Local.get(STATE.year)){setF03Mode(window.F03Local.getPackaged(STATE.year)?'builtin':'online');offlineStatus('未找到另行匯入的 GeoJSON，已保留內建或線上橘色圖層。');return;}
  if(wanted==='builtin'&&!window.F03Local.getPackaged(STATE.year)){setF03Mode('online');offlineStatus('此年度尚無預先內建 F03，已改用官方線上圖層。',true);return;}
  setF03Mode(wanted);dropF03();refreshF03();offlineStatus(offlineSummary());});
 $('f03Collect').addEventListener('click',()=>{const map=STATE.maps?.[STATE.view==='aerial'?1:0]||STATE.maps?.[0];const b=map?.getBounds();
  const params=new URLSearchParams({year:String(STATE.year===4?112:111)});
  if(b)params.set('bbox',[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(v=>v.toFixed(6)).join(','));
  window.open('tools/f03-collector.html?'+params.toString(),'_blank','noopener');});
 $('f03Import').addEventListener('click',()=>{if(!$('f03ConfirmSource').checked){notice('請先確認年度與資料來源。');return;}$('f03LocalFile').click();});
 $('f03LocalFile').addEventListener('change',e=>{const file=e.target.files?.[0];e.target.value='';importOfflineF03(file);});
 $('f03Export').addEventListener('click',downloadOfflineF03);$('f03Remove').addEventListener('click',removeOfflineF03);$('f03Locate').addEventListener('click',showImportedArea);

 $('mobileAimMain').addEventListener('click',mobileAimAction);$('mobileAimClose').addEventListener('click',()=>{setMobileAim(false);mode('browse');});
 $('auditSnapConfirm').addEventListener('click',confirmSnappedFragment);
 $('zoneShowOutlines').addEventListener('change',e=>{STATE.showZoneOutlines=e.target.checked;renderZoneAreas();persist();});
 $('zoneShowCandidates').addEventListener('change',e=>{STATE.showZoneCandidates=e.target.checked;renderZoneAreas();persist();});
 $('queueSkip').addEventListener('click',skipCurrentCandidate);$('queueUnskip').addEventListener('click',unskipCurrentCandidate);
 $('zoneOpen').addEventListener('click',()=>{$('zonePanel').hidden=!$('zonePanel').hidden;if(!$('zonePanel').hidden){$('queuePanel').hidden=true;$('auditPanel').hidden=true;clearInspectPreview();renderZones();}});
 $('zoneClose').addEventListener('click',()=>{$('zonePanel').hidden=true;});
 $('zoneAdd').addEventListener('click',createZone);
 $('zoneToHuwei').addEventListener('click',()=>goto([23.710,120.438],14));
 $('zoneToTuku').addEventListener('click',()=>goto([23.681,120.391],14));
 $('zoneExportCsv').addEventListener('click',exportZoneCSV);
 $('zoneList').addEventListener('click',e=>{const b=e.target.closest('[data-zone-action]');if(!b)return;const id=b.dataset.zoneId,action=b.dataset.zoneAction;if(action==='go')jumpZone(id);else if(action==='scan'){jumpZone(id);$('queuePanel').hidden=false;$('zonePanel').hidden=true;scanQueue(id);}else if(action==='resume')resumeZone(id);else if(action==='delete')removeZone(id);});
 $('queueOpen').addEventListener('click',()=>{$('queuePanel').hidden=!$('queuePanel').hidden;if(!$('queuePanel').hidden){$('zonePanel').hidden=true;$('auditPanel').hidden=true;clearInspectPreview();renderQueue();}});
 $('queueClose').addEventListener('click',()=>{$('queuePanel').hidden=true;});
 $('queueScan').addEventListener('click',()=>scanQueue());
 $('queueOnlyPending').addEventListener('change',renderQueue);
 $('queueNext').addEventListener('click',nextQueueCandidate);
 $('queueList').addEventListener('click',e=>{const btn=e.target.closest('[data-queue-key]');if(btn)openQueueCandidate(btn.dataset.queueKey);});
 $('auditNextCandidate').addEventListener('click',nextQueueCandidate);
 $('auditRemove').addEventListener('click',removeCurrentAudit);$('dataHealthOpen').addEventListener('click',openDataHealth);$('dataHealthClose').addEventListener('click',closeDataHealth);$('dataHealthRun').addEventListener('click',storageHealth);$('downloadSafety').addEventListener('click',downloadSafety);$('restoreSafety').addEventListener('click',restoreSafety);$('dataHealthCopy').addEventListener('click',()=>{navigator.clipboard?.writeText?navigator.clipboard.writeText(latestHealth).then(()=>notice('已複製資料健檢報告')).catch(()=>notice('無法複製，可手動選取文字')):notice('此環境無法直接複製，請手動選取文字');});$('showAuditAreas').addEventListener('change',e=>{STATE.showAuditAreas=e.target.checked;renderAuditAreas();persist();});$('repairAuditShape').addEventListener('click',()=>{const p=STATE.inspectParcel;if(p?.key)repairAuditShape(p.key);});$('saveNow').addEventListener('click',saveNow);$('auditHistoryOpen').addEventListener('click',()=>{$('auditHistory').hidden=!$('auditHistory').hidden;renderAuditHistory();});$('auditHistoryClose').addEventListener('click',()=>{$('auditHistory').hidden=true;});$('auditHistoryList').addEventListener('click',e=>{const btn=e.target.closest('[data-audit-key]');if(btn)openSavedAudit(btn.dataset.auditKey);});$('auditManual').addEventListener('click',enableManualAudit);$('auditNearbyList').addEventListener('click',e=>{const button=e.target.closest('[data-open-nearby-audit]');if(button)openSavedAudit(button.dataset.openNearbyAudit);});$('auditMatchSearch').addEventListener('input',renderAuditNeighbors);$('auditNeighbors').addEventListener('change',renderAuditNeighbors);$('auditMatches').addEventListener('click',e=>{const b=e.target.closest('[data-match-id]');if(b)selectAuditMatch(b.dataset.matchId);});$('auditUnlink').addEventListener('click',unlinkAuditMatch);$('auditOpenRecord').addEventListener('click',openAuditLinkedFarm);$('farmList').addEventListener('click',e=>{const edit=e.target.closest('[data-open-editor]');if(edit){if(window.PigCommunity?.enabled){window.PigCommunity.edit(edit.dataset.openEditor);}else{openRecord(edit.dataset.openEditor);}return;}const row=e.target.closest('[data-id]');if(row)focusFarmRecord(row.dataset.id);});$('selectedFarmEdit').addEventListener('click',()=>{if(STATE.selected)showFarmDetails(STATE.selected);});
 $('selectedFarmName').addEventListener('click',()=>{if(STATE.selected)showFarmDetails(STATE.selected);});
 // Leaflet 互動 tooltip 可能在地圖內攔截冒泡：用捕獲階段接收名稱按鈕點擊。
 document.addEventListener('click',e=>{const info=e.target.closest?.('[data-farm-info]');if(!info)return;e.preventDefault();e.stopPropagation();showFarmDetails(info.dataset.farmInfo);},true);
 $('farmInfoClose').addEventListener('click',closeFarmDetails);
 $('farmInfoDismiss').addEventListener('click',closeFarmDetails);
 $('farmInfoBackdrop').addEventListener('click',closeFarmDetails);
 $('farmInfoEdit').addEventListener('click',editSelectedFarmFromDetails);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('farmInfoDialog').hidden){e.preventDefault();e.stopPropagation();closeFarmDetails();}});$('search').addEventListener('input',renderList);$('filterCounty').addEventListener('change',()=>{updateTownOptions({resetTown:true});renderList();});$('filterTown').addEventListener('change',renderList);$('filterReview').addEventListener('change',renderList);
 for(const el of document.querySelectorAll('[data-view]'))el.addEventListener('click',()=>changeView(el.dataset.view));
 for(const el of document.querySelectorAll('[data-tool]'))el.addEventListener('click',()=>mode(el.dataset.tool));
 $('addCenter').addEventListener('click',()=>{let c=getMapCenter();createPointAt(c.lat,c.lng);});$('inspectCenter').addEventListener('click',()=>{let c=STATE.maps[STATE.view==='aerial'?1:0]?.getCenter()||getMapCenter();inspectAt(c.lat,c.lng);});$('retryMaps').addEventListener('click',()=>restartBaseMaps(false));$('backupMaps').addEventListener('click',()=>restartBaseMaps(true));$('goTuku').addEventListener('click',()=>goto([23.705,120.398],13));$('goUserAtis').addEventListener('click',()=>goto([23.60546820286082,120.52590414505026],15));
 $('headATIS').addEventListener('click',()=>openAtis(getMapCenter()));$('auditATIS').addEventListener('click',()=>STATE.inspectPoint&&openAtis(STATE.inspectPoint));$('auditClose').addEventListener('click',()=>{resetSnapAssist();++STATE.inspectSeq;$('auditPanel').hidden=true;setAuditSheetPeeking(false);clearInspectPreview();});$('auditSheetToggle').addEventListener('click',()=>setAuditSheetPeeking(!$('auditPanel').classList.contains('is-peeking')));$('auditFocus').addEventListener('click',focusInspectGeometry);$('auditMakePoint').addEventListener('click',()=>{if(!STATE.inspectPoint)return;const [lat,lng]=STATE.inspectPoint;$('auditPanel').hidden=true;clearInspectPreview();mode('browse');createPointAt(lat,lng);});document.querySelectorAll('[data-audit]').forEach(el=>el.addEventListener('click',()=>saveAudit(el.dataset.audit))); $('recordAtis').addEventListener('click',()=>{let r=STATE.records.find(x=>x.uid===STATE.selected);const c=C.center(r);if(c)openAtis(c);else notice('此紀錄尚無座標，請先定位。');});
 $('finishPoly').addEventListener('click',finishPoly);$('undoPoly').addEventListener('click',()=>{STATE.draw.pop();refreshDraw();});$('cancelPoly').addEventListener('click',()=>mode('browse'));
 $('f03Reload').addEventListener('click',reloadF03Tiles);$('f03Coverage').addEventListener('click',()=>{openMapDiagnosis();inspectF03Coverage();});$('diagCoverage').addEventListener('click',inspectF03Coverage);
 $('showF03').addEventListener('change',e=>{STATE.showF03=e.target.checked;refreshF03();updateF03YearInfo();persist();});$('f03Year').addEventListener('change',e=>{STATE.year=+e.target.value;
 if(STATE.year===4&&window.F03Local.getPackaged(4)){
   setF03Mode('builtin'); // 112年切回本機已內建資料，避開線上向量圖磚404
 }else if(STATE.year===5&&f03SourceMode==='builtin'){
   setF03Mode('online'); // 111年未內建，沿用線上來源
 }
 reloadOfflineF03(STATE.year);clearInspectPreview();$('auditPanel').hidden=true;++STATE.inspectSeq;STATE.queueSeq++;STATE.queueRows=[];STATE.queueBounds=null;STATE.queueSelectedKey=null;STATE.queueScanActive=false;$('queueScan').disabled=false;$('queueStatus').textContent='年度已更改，請重新掃描目前畫面。';STATE.queueZoneId=null;renderQueue();renderZones();scheduleF03();renderAuditPins();persist();});$('opacity').addEventListener('input',e=>{STATE.opacity=+e.target.value/100;$('opacityLabel').textContent=e.target.value+'%';if(Array.isArray(STATE.f03))for(const layer of STATE.f03)layer.setOpacity(STATE.opacity);persist();});
 $('closeEditor').addEventListener('click',closeEditor);$('editorBackdrop').addEventListener('click',closeEditor);$('editorForm').addEventListener('submit',saveEditor);$('removeLocation').addEventListener('click',removeLocation);$('removeRecord').addEventListener('click',deleteRecord);
 $('pickLocation').addEventListener('click',()=>{STATE.locateId=STATE.selected;closeEditor();mode('locate');notice('請在地圖點選正確的豬場位置。');});
 for(let id of ['backupTop'])$(id).addEventListener('click',exportJSON);$('exportCsv').addEventListener('click',exportCSV);$('exportGeo').addEventListener('click',exportGeo);$('importButton').addEventListener('click',()=>$('importFile').click());$('importFile').addEventListener('change',e=>{readImport(e.target.files[0]);e.target.value='';});
 $('diagOpen').addEventListener('click',openMapDiagnosis);$('diagClose').addEventListener('click',closeMapDiagnosis);$('diagRun').addEventListener('click',runMapDiagnosis);$('acceptRun').addEventListener('click',runFieldAcceptance);$('diagCopy').addEventListener('click',diagCopy);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('editor').hidden)closeEditor();else if(STATE.tool!=='browse')mode('browse');}});
}

/* V3.3.6: 每個底圖來源獨立測試單張圖磚，結果不依賴 Leaflet 渲染。 */
const DIAG_VERSION='V3.3.15-20261102';
let DIAG_LAST='尚未執行';
function diagTile(lat,lng,z){const n=2**z;return {x:Math.floor((lng+180)/360*n),y:Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n),z};}
function diagUrls(){let c=getMapCenter(),z=Math.max(10,Math.min(17,Math.floor(STATE.maps[0]?.getZoom()||13))),p=diagTile(c.lat,c.lng,z);const tpl=(s)=>s.replace('{z}',p.z).replace('{x}',p.x).replace('{y}',p.y);
 return {point:[c.lat,c.lng],p,tiles:[
 {label:'國土測繪 EMAP（官方）',url:tpl('https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}')},
 {label:'國土測繪 PHOTO2（官方）',url:tpl('https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/EPSG:3857/{z}/{y}/{x}')},
 {label:'OpenStreetMap（道路備援）',url:tpl('https://tile.openstreetmap.org/{z}/{x}/{y}.png')},
 {label:'Esri World Imagery（影像備援）',url:tpl('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}')}
  ]};}
function diagEnvironment(){let maps=[];for(let i=0;i<2;i++){const id=i===0?'surveyMap':'aerialMap',el=$(id),r=el?.getBoundingClientRect(),imgs=[...(el?.querySelectorAll('.leaflet-tile')||[])];maps.push(`${id}: ${Math.round(r?.width||0)}×${Math.round(r?.height||0)}, 圖磚DOM=${imgs.length}, 成功圖磚=${imgs.filter(x=>x.complete&&x.naturalWidth>0).length}, 失敗圖磚=${imgs.filter(x=>x.complete&&x.naturalWidth===0).length}, 目前來源=${BASE_RUNTIME[i===0?'emap':'photo'].index}`);}
 return [DIAG_VERSION,'頁面來源：'+location.origin+location.pathname,'Leaflet：'+(window.L?.version||'未載入'),'瀏覽器在線：'+navigator.onLine,'預覽環境：'+PREVIEW_ENV,'安全政策阻擋：'+JSON.stringify(CSP_VIOLATIONS),'介面：'+STATE.view,'資料數：'+STATE.records.length,'圖層：'+$('gisInfo').textContent,'左側：'+$('surveySourceStatus').textContent,'右側：'+$('aerialSourceStatus').textContent,...maps].join('\n');}
/* V3.3.6：只讀現有標記和底圖資訊；F03 單張原生圖磚確認；用獨立鍵測試本機儲存。
 * 此報告不能取代 GitHub Pages 在使用者裝置上的實際操作驗收。 */
let lastAcceptance=null;
function countMapTiles(el){
 const images=[...el.querySelectorAll('img.leaflet-tile')];
 const ok=images.filter(x=>x.complete&&x.naturalWidth>0).length;
 const fail=images.filter(x=>x.complete&&x.naturalWidth===0).length;
 return {images:images.length,ok,fail};
}
function currentF03Canvas(side){
 const el=$(side===0?'surveyMap':'aerialMap');
 const tiles=[...el.querySelectorAll('canvas.leaflet-tile')];
 const successful=tiles.filter(c=>c.classList.contains('leaflet-tile-loaded')&&!c.dataset.f03Error);
 const errors=tiles.filter(c=>!!c.dataset.f03Error);
 const counts=successful.reduce((n,c)=>n+Number(c.dataset.f03Count||0),0);
 return {canvas:tiles.length,rendered:successful.length,errors:errors.length,empty:successful.filter(c=>Number(c.dataset.f03Count||0)===0&&!c.dataset.f03Unresolved).length,shapes:counts,
  approximate:successful.filter(c=>!!c.dataset.f03Fallback).length,unresolved:successful.filter(c=>!!c.dataset.f03Unresolved).length,
  polygons:successful.filter(c=>!!c.dataset.f03OriginalPolygon).length,polygonFailures:successful.filter(c=>!!c.dataset.f03OriginalError).length};
}
// Source-completeness check: do not infer a pig farm where an official tile is empty.
// It never changes records, audit decisions, or workspaces.
function reloadF03Tiles(){
 if(!STATE.showF03)return notice('請先開啟畜牧使用圖層。');
 if(!STATE.mapReady)return notice('地圖尚未初始化。');
 if(!f03ModeOffline())window.PigF03?.clearSourceCache?.();
 if(Array.isArray(STATE.f03))for(const layer of STATE.f03)layer?.redraw();
 setF03Status(f03ModeOffline()?'已重新繪製目前畫面內建／離線 F03 地塊。':'已重新請求目前畫面的線上橘色圖磚；正在等候完成…');
 notice(f03ModeOffline()?'已重新繪製內建／離線橘色地塊，不需重新下載，也不修改豬場資料。':'F03 來源快取已清除並重試，不會修改豬場或查核資料。');
}
async function inspectF03Coverage(){
 const b=$('diagCoverage'),trigger=$('f03Coverage'),status=$('diagState');
 b.disabled=true;trigger.disabled=true;
 try{
  if(!STATE.mapReady||!window.PigF03)throw Error('地圖或 F03 解碼器未就緒');
  const map=STATE.maps[STATE.view==='aerial'?1:0],z=map.getZoom(),bounds=map.getBounds();
  const bnd={north:bounds.getNorth(),south:bounds.getSouth(),west:bounds.getWest(),east:bounds.getEast()};
  const local=f03ModeOffline()?activeF03Dataset():null;
  if(local&&offlineIntersectsMap(local)){
   const pieces=window.F03Local.candidatesForBounds(local,[bnd.west,bnd.south,bnd.east,bnd.north]);
   const left=currentF03Canvas(0),right=currentF03Canvas(1);
   const source=f03SourceMode==='builtin'?'已內建112年雲林 F03':'使用者離線 GeoJSON';
   const report=[`V3.3.15 內建／離線 F03 來源檢查（${new Date().toLocaleString('zh-TW')}）`,
    `資料來源：${source}；民國 ${STATE.year===4?'112':'111'} 年；畫面 Z${z}`,
    `全檔多邊形：${local.meta.count}；本次畫面外框相交候選：${pieces.length}`,
    `左側 Canvas ${left.rendered}/${left.canvas} 張已載入，繪製候選 ${left.shapes}，錯誤 ${left.errors}`,
    `右側 Canvas ${right.rendered}/${right.canvas} 張已載入，繪製候選 ${right.shapes}，錯誤 ${right.errors}`,
    `這些是畜牧使用多邊形片段，不是豬場數；外框相交不等於一定有可見像素。`,
    `目前使用本機資料，不需要檢查官方 Z12 向量圖磚 HTTP 404；地圖底圖仍需連網。`].join('\n');
   $('diagReport').value=report;status.textContent='已完成本機 F03 來源檢查：'+pieces.length+' 個畫面外框相交候選。';return;
  }
  const r=window.PigF03.tileRange(bnd,12);
  const tasks=[];for(let y=r.ymin;y<=r.ymax;y++)for(let x=r.xmin;x<=r.xmax;x++)tasks.push({x,y});
  const count=tasks.length,shown=STATE.view==='aerial'?currentF03Canvas(1):currentF03Canvas(0);
  const lines=[`V3.3.15 F03 線上圖磚來源檢查（${new Date().toLocaleString('zh-TW')}）`,
   `盤查年度：民國 ${STATE.year===4?'112':'111'} 年；畫面 Z${z}；官方最高 Z12`,
   `目前地圖：${STATE.view}；橘色 Canvas ${shown.rendered}/${shown.canvas} 張載入，${shown.errors} 張失敗，${shown.polygons} 張原始面補查，${shown.approximate} 張近似，${shown.unresolved} 張來源未確認，已繪 ${shown.shapes} 個片段`,
   `目前視窗涉及 ${count} 張官方原生 Z12 圖磚（下列是來源圖徵數，不是豬場數）`];
  if(count>32){
   lines.push('來源範圍過大，為避免大量下載，本次未逐張檢查。請將地圖放大到 Z12 以上、只查看一個較小的區域再執行。');
  }else{
   status.textContent=`正在檢查 ${count} 張官方 Z12 圖磚…`;
   const results=await Promise.all(tasks.map(async tile=>{
    try{const layers=await window.PigF03.getTileLayers(STATE.year,12,tile.x,tile.y);
     return {tile,features:layers.reduce((n,l)=>n+l.features.filter(f=>f.type===3).length,0),ok:true};
    }catch(e){
     if(e?.status===404){
      const visual=await window.PigF03.getDisplayTileLayers(STATE.year,{...tile,z:12}).catch(()=>null);
      return {tile,ok:false,missing:true,original:visual?.quality==='original-polygon'?visual.polygons.length:null,originalError:visual?.polygonFailure||'',approx:visual?.quality==='approximate'&&visual.layers.some(l=>l.features.some(f=>f.type===3))?visual.source.z:null,reason:'原生 Z12 HTTP 404'};
     }
     return {tile,ok:false,reason:String(e?.message||e).slice(0,150)};
    }
   }));
   const failed=results.filter(q=>!q.ok).length,missing=results.filter(q=>q.missing).length,approx=results.filter(q=>q.approx!=null).length,empty=results.filter(q=>q.ok&&q.features===0).length;
   const populated=results.filter(q=>q.ok&&q.features>0).length;
   lines.push(`原生成功 ${count-failed}/${count}；含畜牧圖形 ${populated} 張；原生空圖 ${empty} 張；原生404 ${missing} 張；原始面可查 ${results.filter(q=>q.original!=null).length} 張；其他失敗 ${failed-missing} 張；低倍率近似可用 ${approx} 張`);
   for(const row of results)lines.push(`${row.ok?(row.features?'原生圖徵 '+row.features:'原生空圖'):(row.missing?'原生 Z12 不存在'+(row.original!=null?'，原始面 '+row.original+' 筆':row.approx!=null?'，Z'+row.approx+' 近似顯示':'，原始面失敗 '+(row.originalError||'未取得備援')):'其他失敗 '+row.reason)}：Z12 / ${row.tile.x} / ${row.tile.y}`);
   if(failed)lines.push('判斷：Z12 原生圖磚不完整；部分位置會嘗試官方原始面查詢，若拒絕跨域或 HTTP 403/逾時，仍只能使用近似或標為未確認。');
   else if(!populated)lines.push('判斷：本次涉及的 Z12 原生圖磚沒有畜牧圖形；仍需與官方原始圖台核對資料年度及位置。');
   else if(shown.rendered===0||shown.errors>0)lines.push('判斷：官方有圖徵，但畫面未完整渲染；應先重載圖層並核對相同座標。');
   else lines.push('判斷：來源圖磚有資料，畫面也有載入；要判斷個別地塊是否缺漏，需固定地點比較 Z12 和放大後的相同座標。');
  }
  lines.push('注意：原生圖磚涵蓋範圍可能超過目前畫面；其圖徵數不等於畫面應有的橘色地塊數，也不是已核定豬場數。');
  const report=lines.join('\n');DIAG_LAST=report;$('diagReport').value=report;
  status.textContent=count>32?'請放大至 Z12 以上再檢查。':`完成 F03 來源檢查，已產生可複製報告。`;
 }catch(e){status.textContent='F03 缺口檢查失敗：'+String(e?.message||e);}
 finally{b.disabled=false;trigger.disabled=false;}
}
async function runFieldAcceptance(){
 const button=$('acceptRun');button.disabled=true;
 const state=$('diagState');state.textContent='現場驗收中：查核雙圖、官方 F03 圖磚與資料儲存（不變更豬場資料）…';
 const checks=[],add=(name,status,info)=>checks.push({name,status,info});
 try{
  const rec=STATE.records,loc=rec.filter(r=>!!C.center(r)).length;
  add('豬場資料','通過',`${rec.length} 筆；${loc} 筆有座標；${rec.length-loc} 筆待定位；舊版核定 ${rec.filter(r=>r.review==='approved').length} 筆`);
  add('既有盤查資料','資訊',`${Object.keys(STATE.audits).length} 筆查核；${STATE.zones.length} 個工作區；不會修改`);
  if(!STATE.mapReady||STATE.maps.length!==2){add('左右地圖','失敗','Leaflet 尚未初始化');}
  else {
   const [a,b]=STATE.maps,ca=a.getCenter(),cb=b.getCenter(),same=a.getZoom()===b.getZoom()&&Math.abs(ca.lat-cb.lat)<.00001&&Math.abs(ca.lng-cb.lng)<.00001;
   add('地圖同步',same?'通過':'失敗',`左 Z${a.getZoom()} (${ca.lat.toFixed(6)},${ca.lng.toFixed(6)})；右 Z${b.getZoom()} (${cb.lat.toFixed(6)},${cb.lng.toFixed(6)})`);
   [0,1].forEach(i=>{const t=countMapTiles($(i===0?'surveyMap':'aerialMap'));
    add(i===0?'左側電子底圖':'右側正射影像',t.ok>0?'通過':'待驗收',`${t.ok} 張已顯示／${t.images} 張圖片；失敗 ${t.fail} 張；來源：${BASE_RUNTIME[i===0?'emap':'photo'].index}`);
    const f=currentF03Canvas(i);
    add(i===0?'左側 F03 Canvas':'右側 F03 Canvas',f.rendered>0?'通過':'待驗收',`${f.rendered} 張渲染／${f.canvas} 張；出錯 ${f.errors} 張；描繪圖形數 ${f.shapes}（範圍可能無畜牧地塊）`);
   });
  }
  const cfg=window.PigF03;
  if(f03ModeOffline()){
   const m=activeF03Dataset()?.meta;
    add('目前 F03 來源：'+(f03SourceMode==='builtin'?'內建雲林112年':'使用者匯入'),m?'通過':'失敗',m?`${m.name}；${m.count} 個多邊形；${f03SourceMode==='builtin'?'每次開啟網頁即載入，毋須儲存':'已讀取本工作階段，'+(f03OfflineDurable?'已寫入 IndexedDB':'尚未確認持久保存')}`:'此年度沒有可用的地塊');
  }else if(!cfg){add('F03 原生向量圖磚','失敗','解碼器未載入');}
  else {
   const c=getMapCenter(),z=12,t=diagTile(c.lat,c.lng,z);
   try {
    // The same fetch/cache code used by both map overlays and the candidate scanner.
    const ls=await cfg.getTileLayers(STATE.year,z,t.x,t.y);
    const n=(Array.isArray(ls)?ls:[]).reduce((x,l)=>x+(l.features?.length||0),0);
    add('官方 F03 z12 圖磚','通過',`年度 ${STATE.year===4?'112':'111'}；z12/${t.x}/${t.y}；${n} 個原始圖徵（不代表 ${n} 處豬場）`);
   }catch(e){add('官方 F03 z12 圖磚','失敗',String(e.message||e).slice(0,160));}
  }
  const disk=await storageRead();
  add('本機資料快照',disk.data&&validSnapshot(disk.data)?'通過':'待驗收',disk.data?`來源 ${disk.method}，${disk.data.records.length} 筆；校驗 ${disk.data.integrity?'有':'舊格式'}`:'沒有可讀取的持久快照');
  try{
   const key=STORAGE+'-acceptance-test',token='probe-'+Math.random();
   localStorage.setItem(key,token);const ok=localStorage.getItem(key)===token;
   localStorage.removeItem(key);add('localStorage 寫入讀回',ok?'通過':'失敗',ok?'獨立測試鍵正常，未改動原資料':'獨立測試鍵讀回不一致');
  }catch(e){add('localStorage 寫入讀回','失敗',String(e.message||e).slice(0,120));}
  try{
   const db=await database(),key='acceptance-probe',token='test-'+Math.random();
   const ok=await new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite'),store=tx.objectStore('snapshots');let equal=false;
    store.put(token,key);const req=store.get(key);req.onsuccess=()=>{equal=req.result===token;store.delete(key);};
    tx.oncomplete=()=>resolve(equal);tx.onerror=()=>reject(tx.error||Error('DB 交易失敗'));tx.onabort=()=>reject(tx.error||Error('DB 交易中止'));
   });add('IndexedDB 寫入讀回',ok?'通過':'失敗',ok?'獨立測試鍵正常，未改動原資料':'測試值不符');
  }catch(e){add('IndexedDB 寫入讀回','失敗',String(e.message||e).slice(0,120));}
 }catch(e){add('驗收程序','失敗',String(e.message||e));}
 finally{button.disabled=false;}
 const failures=checks.filter(c=>c.status==='失敗').length,unknown=checks.filter(c=>c.status==='待驗收').length;
 const title=`V3.3.15 現場驗收（${new Date().toLocaleString('zh-TW')}）`;
 const report=[title,diagEnvironment(),...checks.map(c=>`[${c.status}] ${c.name}：${c.info}`),'注意：底圖載入與圖磚測試不等於完成實際豬場判讀，也不代表跨裝置已同步。'].join('\n');
 lastAcceptance={checks,failures,unknown,report};DIAG_LAST=report;$('diagReport').value=report;
 state.textContent=`完成：${checks.length} 項；失敗 ${failures}、待驗收 ${unknown}。可複製報告提供後續修正。`;
 return lastAcceptance;
}
function diagCopy(){const data=DIAG_LAST;const area=$('diagReport');area.value=data;area.focus();area.select();if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(data).then(()=>notice('診斷報告已複製。')).catch(()=>notice('已選取報告，請按 Ctrl+C 複製。'));}else{try{document.execCommand('copy');notice('診斷報告已選取並嘗試複製。');}catch(e){notice('請按 Ctrl+C 複製報告。');}}}
function runMapDiagnosis(){if(!$('diagPanel'))return;
 let item=diagUrls(),results=[];const body=$('diagRows');body.innerHTML='';$('diagState').textContent='正在逐一測試官方與備援圖磚…';
 const timeout=7000;
 item.tiles.forEach((spec,i)=>{
   const row=document.createElement('div');row.className='diag-row';
   const title=document.createElement('span');title.textContent=spec.label;
   const status=document.createElement('span');status.textContent='測試中…';status.className='diag-result';
   const link=document.createElement('a');link.textContent='檢視圖磚';link.href=spec.url;link.target='_blank';link.rel='noopener noreferrer';
   const preview=document.createElement('img');preview.alt=spec.label+' 圖磚預覽';preview.className='diag-preview';
   row.append(title,status,link,preview);body.append(row);
   const img=new Image(),started=Date.now();let done=false;
   const finish=(ok,reason)=>{if(done)return;done=true;clearTimeout(watchdog);let elapsed=Date.now()-started;status.textContent=(ok?'✓ 成功':'✕ '+reason)+` (${elapsed}ms)`;status.classList.toggle('diag-fail',!ok);if(ok)preview.src=spec.url;
   results.push({label:spec.label,ok,reason,elapsed,url:spec.url});if(results.length===item.tiles.length){results.sort((a,b)=>item.tiles.findIndex(t=>t.label===a.label)-item.tiles.findIndex(t=>t.label===b.label));const success=results.filter(r=>r.ok).length;
   $('diagState').textContent=`測試完成：${success}/${results.length} 個圖磚來源成功；${success===0?(PREVIEW_ENV?'預覽環境可能限制外部圖資，請到 GitHub Pages 測試':'此網頁目前無法取得測試圖片'):success===results.length?'外部圖磚可讀取，請進一步檢查圖層渲染／頁面快取':'部分服務無法連線，可優先使用成功的備援來源'}`;
   DIAG_LAST=diagEnvironment()+'\n經緯度：'+item.point.map(n=>n.toFixed(6)).join(', ')+'　圖磚：'+JSON.stringify(item.p)+'\n'+results.map(r=>`${r.ok?'成功':'失敗'} ${r.label} (${r.elapsed}ms) ${r.url}`).join('\n');$('diagReport').value=DIAG_LAST;
   }};
   img.onload=()=>finish(img.naturalWidth>0,'圖片內容為空');img.onerror=()=>finish(false,'圖片載入錯誤');const watchdog=setTimeout(()=>finish(false,'逾時'),timeout);img.src=spec.url;
 });
}
function openMapDiagnosis(){const box=$('diagPanel');box.hidden=false;DIAG_LAST=diagEnvironment();$('diagReport').value=DIAG_LAST;runMapDiagnosis();}
function closeMapDiagnosis(){$('diagPanel').hidden=true;}


/* V3.3.15: packaged F03 dataset, preserving records and all user storage. */
function activeWorkbenchTab(){if(!$('zonePanel').hidden)return 'zones';if(!$('queuePanel').hidden)return 'queue';if(!$('auditHistory').hidden)return 'history';return null;}
function refreshWorkflowSummary(){
 const zone=STATE.zones.find(z=>z.id===STATE.activeZoneId),rows=STATE.queueRows;
 const pending=rows.filter(r=>candidateState(r)==='pending').length;
 const done=rows.filter(r=>candidateState(r)==='done').length;
 const deferred=rows.filter(r=>candidateState(r)==='defer').length;
 const skipped=rows.filter(r=>candidateState(r)==='skip').length;
 const auditCount=Object.keys(STATE.audits).length;
 const text=rows.length?`${zone?.name||'目前畫面'} · 本次候選 ${rows.length} · 已判讀 ${done} · 未查 ${pending} · 稍後 ${deferred} · 略過 ${skipped}`:zone?`${zone.name} · ${zone.lastScan?.rows?.length?'可繼續上次掃描':'尚未掃描'}`:`尚未選擇工作區 · 已有 ${auditCount} 筆人工查核紀錄`;
 const summary=$('workflowSummary');if(summary)summary.textContent=text;
 const stats=$('workbenchStats');if(stats)stats.textContent=zone?.name?`${zone.name} · 人工紀錄 ${auditCount} 筆`:`人工查核紀錄 ${auditCount} 筆`;
 const quick=$('quickContinue');if(quick)quick.textContent=rows.length?pending||deferred?'下一處未查':'查看候選':zone?.lastScan?.rows?.length?'繼續上次':'開始盤查';
}
function syncWorkbenchPanels(){
 const tab=activeWorkbenchTab();const wrapper=$('workbench');if(!wrapper)return;
 // Legacy actions can directly reveal a panel. Keep the single-workbench guarantee.
 if(tab){for(const id of ['zonePanel','queuePanel','auditHistory'])if(id!==({zones:'zonePanel',queue:'queuePanel',history:'auditHistory'}[tab])&&!$(id).hidden)$(id).hidden=true;}
 wrapper.hidden=!tab;$('workbenchOpen').setAttribute('aria-expanded',String(!!tab));
 document.querySelectorAll('[data-workbench-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.workbenchTab===tab)));
 refreshWorkflowSummary();
}
function closeWorkbench(){for(const id of ['zonePanel','queuePanel','auditHistory'])$(id).hidden=true;syncWorkbenchPanels();}
function openWorkbenchTab(tab){
 const map={zones:'zonePanel',queue:'queuePanel',history:'auditHistory'};if(!map[tab])return;
 for(const id of Object.values(map))$(id).hidden=id!==map[tab];
 $('auditPanel').hidden=true;
 if(tab==='zones')renderZones();if(tab==='queue')renderQueue();if(tab==='history')renderAuditHistory();
 syncWorkbenchPanels();
}
function setupCompactWorkbench(){
 $('workbenchOpen').addEventListener('click',()=>activeWorkbenchTab()?closeWorkbench():openWorkbenchTab(STATE.queueRows.length?'queue':'zones'));
 $('workbenchClose').addEventListener('click',closeWorkbench);
 for(const b of document.querySelectorAll('[data-workbench-tab]'))b.addEventListener('click',()=>openWorkbenchTab(b.dataset.workbenchTab));
 $('extraToolsToggle').addEventListener('click',()=>{const el=$('extraTools');el.hidden=!el.hidden;$('extraToolsToggle').setAttribute('aria-expanded',String(!el.hidden));});
 $('extraTools').addEventListener('click',e=>{if(e.target.closest('button')){$('extraTools').hidden=true;$('extraToolsToggle').setAttribute('aria-expanded','false');}});
 $('quickContinue').addEventListener('click',()=>{
  if(STATE.queueRows.length){const canGo=STATE.queueRows.some(r=>['pending','defer'].includes(candidateState(r)));if(canGo){closeWorkbench();nextQueueCandidate();}else openWorkbenchTab('queue');return;}
  const zone=STATE.zones.find(z=>z.id===STATE.activeZoneId);if(zone?.lastScan?.rows?.length){closeWorkbench();resumeZone(zone.id);return;}
  openWorkbenchTab('zones');
 });
 const observed=['zonePanel','queuePanel','auditHistory'];
 const observer=new MutationObserver(syncWorkbenchPanels);
 for(const id of observed)observer.observe($(id),{attributes:true,attributeFilter:['hidden']});
 for(const id of ['queueSummary','zoneList','auditHistoryList'])observer.observe($(id),{subtree:true,childList:true,characterData:true});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('extraTools').hidden){$('extraTools').hidden=true;$('extraToolsToggle').setAttribute('aria-expanded','false');}else if(activeWorkbenchTab())closeWorkbench();}});
 refreshWorkflowSummary();
}


/* V3.3.15 — use official 112 F03 polygon OUTLINES to prioritize manual follow-up.
   Results are ephemeral and never affect record verification, categories, or saved JSON. */
const F03_MATCH={rows:[],summary:null,dirty:true};
const F03_MATCH_GUIDES=[];
const F03Boundary=(()=>{
 const RAD=Math.PI/180;
 function scales(lat){return [111320*Math.max(.01,Math.cos(lat*RAD)),110574];}
 function boxLower(point,box){const [sx,sy]=scales(point[0]),lon=point[1],lat=point[0];
  const dx=lon<box[0]?(box[0]-lon)*sx:lon>box[2]?(lon-box[2])*sx:0;
  const dy=lat<box[1]?(box[1]-lat)*sy:lat>box[3]?(lat-box[3])*sy:0;
  return Math.hypot(dx,dy);
 }
 // Approximate planar metric distance near Yunlin latitude; segment projection, not distance to vertices.
 function nearestToFeature(point,feature,limit=Infinity){
  if(!point||!feature?.rings)return null;
  const [sx,sy]=scales(point[0]);let best=limit,nearest=null;
  for(const ring of feature.rings){
   for(let i=1;i<ring.length;i++){
    const a=ring[i-1],b=ring[i],ax=(a[0]-point[1])*sx,ay=(a[1]-point[0])*sy;
    const dx=(b[0]-a[0])*sx,dy=(b[1]-a[1])*sy,l2=dx*dx+dy*dy;
    const t=l2?Math.min(1,Math.max(0,-(ax*dx+ay*dy)/l2)):0;
    const cx=ax+t*dx,cy=ay+t*dy,dist=Math.hypot(cx,cy);
    if(dist<best){best=dist;nearest=[point[0]+cy/sy,point[1]+cx/sx];}
   }
  }
  return nearest?{meters:best,nearPoint:nearest,key:feature.key,objectId:feature.objectId}:null;
 }
 function nearest(point,dataset,insideFeature=null){
  if(insideFeature)return nearestToFeature(point,insideFeature);
  if(!dataset)return null;
  let best=null;
  // An extent lower bound gives exact pruning for local linear metric approximation;
  // every possible feature can be visited, so nearby shapes are not silently omitted.
  for(const feature of dataset.features){
   const lower=boxLower(point,feature.bbox);
   if(best&&lower>best.meters+1e-7)continue;
   const result=nearestToFeature(point,feature,best?.meters??Infinity);
   if(result&&(!best||result.meters<best.meters))best=result;
  }
  return best;
 }
 return {nearestToFeature,nearest,boxLower};
})();
window.F03Boundary=F03Boundary; // read-only geometry helper for controlled regression tests
function computeF03Match(){
 const dataset=window.F03Local?.getPackaged(4);
 if(!dataset)return null;
 const b=dataset.meta.extent,rows=[],threshold=Number($('f03MatchThreshold')?.value)||5;
 for(const record of STATE.records){
  const point=C.center(record),outside=!!point&&(point[1]<b[0]||point[1]>b[2]||point[0]<b[1]||point[0]>b[3]);
  const insideFeature=point&&!outside?window.F03Local.at(4,point[0],point[1],'builtin'):null;
  const status=!point?'no-coordinate':outside?'outside':insideFeature?'inside':'not-inside';
  const edge=point?F03Boundary.nearest(point,dataset,insideFeature):null;
  const priority= status==='not-inside'||status==='outside'||(status==='inside'&&edge&&edge.meters<=threshold);
  rows.push({record,point,status,edge,priority,nearInside:status==='inside'&&!!edge&&edge.meters<=threshold,
   nearOutside:status==='not-inside'&&!!edge&&edge.meters<=100});
 }
 const total={all:rows.length,inside:0,'not-inside':0,outside:0,'no-coordinate':0,priority:0,nearInside:0,nearOutside:0};
 total.threshold=threshold;
 for(const row of rows){total[row.status]++;if(row.priority)total.priority++;if(row.nearInside)total.nearInside++;if(row.nearOutside)total.nearOutside++;}
 F03_MATCH.rows=rows;F03_MATCH.summary=total;F03_MATCH.dirty=false;
 return total;
}
function updateF03MatchBadge(){
 const button=$('f03MatchOpen');if(!button)return;
 const s=computeF03Match();
 if(!s){button.textContent='▤ F03 × 舊場';button.title='民國112年內建地塊未載入';return;}
 button.textContent=`▤ F03 比對 ${s.inside}/${s.all-s['no-coordinate']}`;
 button.title=`112年 F03 空間比對：${s.inside} 個定位點落入地塊，${s.priority} 筆建議人工複核。不是核定資料。`;
 if(!$('f03MatchPanel').hidden)renderF03MatchPanel(false);
}
function f03MatchVisibleRows(){
 const filter=$('f03MatchFilter').value,town=$('f03MatchTown').value,query=$('f03MatchSearch').value.trim().toLocaleLowerCase();
 const sort=$('f03MatchSort').value;
 const rows=F03_MATCH.rows.filter(row=>{
  if(filter==='priority'&&!row.priority)return false;
  else if(filter==='boundary'&&!row.nearInside)return false;
  else if(filter!=='all'&&filter!=='priority'&&filter!=='boundary'&&row.status!==filter)return false;
  const r=row.record;
  if(town!=='all'&&r.town!==town)return false;
  if(query&&!([r.name,r.address,r.town,r.village,r.legacyId,r.uid].join(' ').toLocaleLowerCase().includes(query)))return false;
  return true;
 });
 const townSort=(a,b)=>a.record.town.localeCompare(b.record.town,'zh-Hant')||a.record.name.localeCompare(b.record.name,'zh-Hant');
 const distSort=(a,b)=>(a.edge?.meters??Infinity)-(b.edge?.meters??Infinity)||townSort(a,b);
 if(sort==='town')rows.sort(townSort);
 else if(sort==='distance')rows.sort(distSort);
 else rows.sort((a,b)=>{
  const rank=r=>r.status==='not-inside'?(r.nearOutside?0:1):r.status==='outside'?2:r.nearInside?3:r.status==='no-coordinate'?4:5;
  return rank(a)-rank(b)||distSort(a,b);
 });
 return rows;
}
function matchDistance(row){
 if(!row.edge)return '距離尚無法計算';
 const m=row.edge.meters;
 const unit=m<1000?`${Math.round(m)} 公尺`:`${(m/1000).toFixed(2)} 公里`;
 return row.status==='inside'?`位於 F03 內，距其邊界約 ${unit}`:`距最近 F03 邊界約 ${unit}`;
}
function renderF03MatchPanel(recalc=true){
 const data=recalc?computeF03Match():F03_MATCH.summary;
 if(!data){$('f03MatchCounts').textContent='112 年 F03 內建圖資尚未成功載入，暫時無法比對。';$('f03MatchList').innerHTML='';return;}
 const mapped=data.all-data['no-coordinate'];
 $('f03MatchCounts').textContent=`原有 ${data.all} 筆 · 已定位 ${mapped} · 落入 F03 ${data.inside} · 未落入 ${data['not-inside']} · 超出外框 ${data.outside} · 待定位 ${data['no-coordinate']}`;
 $('f03MatchPriorityCounts').textContent=`⚑ 建議人工複核 ${data.priority} 筆（未落入或靠近邊界）｜地塊內距邊界≤${data.threshold}m：${data.nearInside} 筆；未落入且距邊界≤100m：${data.nearOutside} 筆。距離為近似值，不代表座標誤差或違規。`;
 const rows=f03MatchVisibleRows(),labels={inside:'落入 F03','not-inside':'未落入',outside:'外框之外','no-coordinate':'待定位'};
 $('f03MatchList').innerHTML=rows.length?rows.slice(0,500).map(row=>{
  const {record:r,point,status}=row;
  const note=row.nearInside?'靠近地塊邊界，先核對定位點':row.nearOutside?'未落入但距離近，先核對定位點':'';
  return `<button type="button" class="match-row ${row.priority?'priority-row':''}" role="listitem" data-match-id="${html(r.uid)}"><span><strong>${html(r.name||'未命名地點')}</strong><small>${html(r.town||'鄉鎮待確認')} · ${point?`${point[0].toFixed(6)}, ${point[1].toFixed(6)}`:'尚無可靠座標'}</small><small>${html(point?matchDistance(row):'先補上定位點')}</small>${note?`<span class="near-note">⚑ ${html(note)}</span>`:''}</span><span class="match-row-tags"><span class="match-tag ${status}">${labels[status]}</span>${row.priority?'<span class="match-tag near">建議複核</span>':''}</span></button>`;
 }).join(''):'<p class="empty">沒有符合條件的紀錄。</p>';
 $('f03MatchFoot').textContent=`符合篩選 ${rows.length} 筆${rows.length>500?'，畫面先顯示前500筆；CSV可匯出全部結果':''}。以112年內建地塊的輪廓線估算距離；不是地籍界線，不等於合法核定、非豬場或實際營業情況。點選紀錄只會定位並畫出最近邊界參考線；要看詳細資料請按地圖名稱或「ⓘ 資訊」。本比對不會寫入資料庫。`;
}
function clearF03MatchGuide(){
 for(const {map,layer} of F03_MATCH_GUIDES.splice(0))try{map.removeLayer(layer);}catch(_e){}
}
function showF03MatchGuide(row){
 clearF03MatchGuide();
 if(!row?.point||!row.edge?.nearPoint||!STATE.mapReady||!window.L)return;
 const point=row.point,edge=row.edge.nearPoint;
 for(const map of STATE.maps){
  if(!map)continue;
  const options={color:'#dc5233',weight:3,opacity:1,dashArray:'5 6',interactive:false};
  const line=L.polyline([point,edge],options).addTo(map);
  const dot=L.circleMarker(edge,{radius:5,color:'#982d16',weight:2,fillColor:'#ffffff',fillOpacity:1,interactive:false}).addTo(map);
  F03_MATCH_GUIDES.push({map,layer:line},{map,layer:dot});
 }
}
function initF03MatchPanel(){
 $('f03MatchOpen').addEventListener('click',()=>{
  const p=$('f03MatchPanel');p.hidden=!p.hidden;
  if(!p.hidden){const options=[...new Set(STATE.records.map(r=>r.town).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
   const t=$('f03MatchTown'),prev=t.value;t.innerHTML='<option value="all">全部鄉鎮</option>'+options.sort((a,b)=>(a==='虎尾鎮'?0:a==='土庫鎮'?1:2)-(b==='虎尾鎮'?0:b==='土庫鎮'?1:2)||a.localeCompare(b,'zh-Hant')).map(x=>`<option value="${html(x)}">${html(x)}</option>`).join('');t.value=[...options,'all'].includes(prev)?prev:'all';renderF03MatchPanel();}
 });
 $('f03MatchClose').addEventListener('click',()=>{$('f03MatchPanel').hidden=true;});
 for(const id of ['f03MatchFilter','f03MatchTown','f03MatchSearch','f03MatchSort','f03MatchThreshold'])$(id).addEventListener(id==='f03MatchSearch'?'input':'change',()=>renderF03MatchPanel(id==='f03MatchThreshold'));
 $('f03MatchReview').addEventListener('click',()=>{$('f03MatchFilter').value='priority';$('f03MatchSort').value='review';renderF03MatchPanel(false);});
 $('f03MatchClearGuide').addEventListener('click',()=>{clearF03MatchGuide();notice('已清除地圖距離指引；豬場資料未變更。');});
 $('f03Year').addEventListener('change',clearF03MatchGuide);
 $('f03MatchList').addEventListener('click',e=>{const item=e.target.closest('[data-match-id]');if(!item)return;
  const row=F03_MATCH.rows.find(x=>x.record.uid===item.dataset.matchId);if(!row)return;
  $('f03MatchPanel').hidden=true;
  if(STATE.year!==4){$('f03Year').value='4';$('f03Year').dispatchEvent(new Event('change',{bubbles:true}));}
  focusFarmRecord(row.record.uid,{move:true});showF03MatchGuide(row);
 });
 $('f03MatchExport').addEventListener('click',()=>{
  if(!F03_MATCH.summary){notice('112年內建地塊未準備好，無法匯出。');return;}
  const data=f03MatchVisibleRows(),cell=v=>{let s=String(v??'');if(/^[\s\t\r\n]*[=+@-]/.test(s)&&!(/^-?\d+(?:\.\d+)?$/.test(s.trim())))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const labels={inside:'座標落入112年F03', 'not-inside':'座標未落入112年F03',outside:'超出內建圖資外框','no-coordinate':'缺少定位'};
  const header=['紀錄識別碼','場名','鄉鎮','地址','緯度','經度','112年F03空間疊合結果','最近F03輪廓約距離_公尺','距離位置','是否建議人工複核','最近邊界緯度','最近邊界經度','來源年度','提醒'];
  const rows=data.map(row=>{const {record:r,point,status,edge}=row;return [r.uid,r.name,r.town,r.address,point?.[0]??'',point?.[1]??'',labels[status],edge?Math.round(edge.meters):'',status==='inside'?'地塊內到邊界':point?'地塊外到最近邊界':'無座標',row.priority?'是':'否',edge?.nearPoint?.[0]??'',edge?.nearPoint?.[1]??'',112,'距離採局部平面近似，供人工查核；不代表地籍、核定或現況'];});
  const csv='\ufeff'+[header,...rows].map(r=>r.map(cell).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`F03_112_邊界距離與待複核_${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
  notice(`已匯出 ${rows.length} 筆邊界距離與比對結果；未修改核定資料。`);
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('f03MatchPanel').hidden)$('f03MatchPanel').hidden=true;});
}

/* V3.3.18 共用場址只覆蓋名稱、縣市、鄉鎮、地址和座標，不碰人工核定/查核資料。 */
function applyCloudFarms(rows){
 if(!Array.isArray(rows)||!rows.length)return;
 let changed=false;
 for(const cloud of rows){const r=STATE.records.find(x=>x.uid===cloud.uid);if(!r)continue;
  const loc=(cloud.lat!=null&&cloud.lng!=null&&C.coord(Number(cloud.lat),Number(cloud.lng)))?{type:'Point',coordinates:[Number(cloud.lng),Number(cloud.lat)]}:null;
  const prior=C.center(r),now=loc?[loc.coordinates[1],loc.coordinates[0]]:null;
  if(r.name!==cloud.name||r.county!==cloud.county||r.town!==cloud.town||r.address!==cloud.address||JSON.stringify(prior)!==JSON.stringify(now)){
   Object.assign(r,{name:cloud.name||r.name,county:cloud.county||r.county,town:cloud.town||r.town,address:cloud.address??''});
   if(r.geometry?.type!=='Polygon')r.geometry=loc;
   changed=true;
  }
 }
 if(changed){updateTownOptions();renderStats();renderList();}
}
async function init(){const f03Diag=$('f03Diag');if(f03Diag)f03Diag.addEventListener('click',()=>window.open('tools/f03-test.html','_blank','noopener'));if(PREVIEW_ENV){const box=$('previewNotice');if(box)box.hidden=false;}bind();setupCompactWorkbench();initF03MatchPanel();initStatExplorer();await initializeData();updateTownOptions();renderList();refreshWorkflowSummary();$('showF03').checked=STATE.showF03;$('f03Year').value=String(STATE.year);$('opacity').value=String(Math.round(STATE.opacity*100));$('opacityLabel').textContent=Math.round(STATE.opacity*100)+'%';$('showAuditAreas').checked=STATE.showAuditAreas;$('maps').className='maps '+STATE.view;document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===STATE.view));try{const savedMode=localStorage.getItem('pig-f03-source-mode-v337');if(['builtin','online','offline'].includes(savedMode))f03SourceMode=savedMode;}catch(e){}
  let bundledError='';try{
    const raw=window.PIG_F03_BUNDLED_TEXT;
    if(!raw)throw Error('系統缺少預裝 F03 資料');
    const pack=window.F03Local.loadPackaged(raw,4,'雲林縣112年F03畜牧使用（預先內建）');
    if(pack.meta.count!==3593)throw Error('內建資料數量異常，預期3593，得到'+pack.meta.count);
  }catch(e){bundledError=String(e.message||e);console.error('bundled F03',e);if(f03SourceMode==='builtin')f03SourceMode='online';}
  if(STATE.year===4&&window.F03Local.getPackaged(4)){
    // 112 年優先內建資料，忽略先前在線上圖磚模式遺留的 localStorage 偏好。
    // 使用者仍可在本次工作階段手動選擇其他來源。
    f03SourceMode='builtin';
    try{localStorage.setItem('pig-f03-source-mode-v337','builtin');}catch(e){}
  }else if(f03SourceMode==='builtin')f03SourceMode='online';
  $('f03Source').value=f03SourceMode;updateF03YearInfo();await reloadOfflineF03(STATE.year);
  if(bundledError)offlineStatus('內建圖資校驗失敗，已退回線上圖層：'+bundledError,true);
  else if(f03SourceMode==='builtin')offlineStatus(offlineSummary());
  updateF03MatchBadge();initMap();window.PigCommunity?.start({getRecord:uid=>STATE.records.find(x=>x.uid===uid),applyApproved:applyCloudFarms,getSeedRecords:()=>C.legacyToAll(window.PIG_FARM_LEGACY_SEED||[])});}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){
 if(STATE.viewSaveTimer){clearTimeout(STATE.viewSaveTimer);STATE.viewSaveTimer=null;persist();}
 if(dirtyRev>committedRev)flushSave();
}});
window.addEventListener('beforeunload',e=>{if(dirtyRev>committedRev&&saveFailed){e.preventDefault();e.returnValue='';}});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();

