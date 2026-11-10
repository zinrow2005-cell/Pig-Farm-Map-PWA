/* V3.4.15 — optional, user-initiated/map-point reverse geocoding.
   OpenStreetMap Nominatim public service: maximum one request per second,
   no bulk use, no persistent bulk cache. Retrieved addresses are suggestions.
   © OpenStreetMap contributors: https://www.openstreetmap.org/copyright */
(function(root){'use strict';
 const COUNTY=/^(?:臺北市|台北市|新北市|桃園市|臺中市|台中市|臺南市|台南市|高雄市|基隆市|新竹市|嘉義市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義縣|屏東縣|宜蘭縣|花蓮縣|臺東縣|台東縣|澎湖縣|金門縣|連江縣)$/;
 const clean=s=>String(s||'').trim().replace(/^台(?=[北中南東]市|東縣)/,'臺');
 const isCounty=s=>COUNTY.test(clean(s));
 const isTown=s=>/[鄉鎮市區]$/.test(s)&&!isCounty(s)&&!/^(?:臺灣省|台灣省)$/.test(s);
 let lastStart=0,chain=Promise.resolve();
 const cached=new Map();
 function parse(json){const a=json&&json.address||{};
  const raw=[a.county,a.city,a.state,a.municipality,a.state_district,a.region].map(clean);
  const county=raw.find(isCounty)||'';
  const locality=[a.town,a.city_district,a.district,a.suburb,a.city,a.municipality,a.county,a.village].map(clean);
  let town=locality.find(isTown)||'';
  // For county-level cities, OSM sometimes stores the city as county and district as suburb.
  if(!town&&county.endsWith('市'))town=[a.borough,a.quarter,a.suburb].map(clean).find(isTown)||'';
  const road=clean(a.road||a.pedestrian||a.residential||a.path||a.hamlet);
  const number=clean(a.house_number);
  // Never manufacture a street address from a place label or a nearby POI.
  const address=road?(county+town+road+number).slice(0,220):'';
  return {county,town,address,precision:road?(number?'門牌':'道路'):(town?'行政區':'未定位'),provider:'OpenStreetMap / Nominatim'};
 }
 function valid(lat,lng){return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=21&&lat<=27&&lng>=118&&lng<=123;}
 function lookup(lat,lng){lat=Number(lat);lng=Number(lng);if(!valid(lat,lng))return Promise.reject(Error('請先選擇有效的臺灣地圖座標'));
  const key=lat.toFixed(5)+','+lng.toFixed(5);
  if(cached.has(key))return Promise.resolve(cached.get(key));
  const task=chain.catch(()=>{}).then(async()=>{
   const delay=Math.max(0,1100-(Date.now()-lastStart));if(delay)await new Promise(r=>setTimeout(r,delay));
   lastStart=Date.now();const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),10000);
   try{
    const q=new URLSearchParams({format:'jsonv2',lat:String(lat),lon:String(lng),addressdetails:'1',zoom:'18','accept-language':'zh-TW,zh-Hant,zh'});
    const response=await fetch('https://nominatim.openstreetmap.org/reverse?'+q.toString(),{headers:{Accept:'application/json'},signal:controller.signal,referrerPolicy:'strict-origin-when-cross-origin'});
    if(!response.ok)throw Error('地址服務暫時不可用（'+response.status+'）');
    const parsed=parse(await response.json());cached.set(key,parsed);if(cached.size>60)cached.delete(cached.keys().next().value);return parsed;
   }finally{clearTimeout(timeout);}
  });chain=task.catch(()=>{});return task;
 }
 root.PigAddressLookup={lookup,parse,valid};
})(window);
