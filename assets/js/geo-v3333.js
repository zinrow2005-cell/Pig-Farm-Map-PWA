/* V3.3.33 Device geolocation; explicitly opt-in, independent of farm records/cloud. */
(()=>{'use strict';
const key='pigfarm-auto-geolocation-v3333';
const button=document.getElementById('geoLocateNow');
const checkbox=document.getElementById('geoAutoLocate');
const status=document.getElementById('geoLocationStatus');
const settings=document.getElementById('geoLocationSettings');
if(!button||!checkbox||!status)return;
const markers=[];
let pending=false, attemptedAuto=false, locationSeq=0;
function isAuto(){try{return localStorage.getItem(key)==='yes';}catch(_){return false;}}
function saveAuto(v){try{localStorage.setItem(key,v?'yes':'no');}catch(_) {status.textContent='此裝置不允許保存設定；下次開啟需重新設定。';}}
checkbox.checked=isAuto();
checkbox.addEventListener('change',()=>{saveAuto(checkbox.checked);status.textContent=checkbox.checked?'已啟用開啟時自動定位':'已關閉自動定位';});
function message(s){status.textContent=s;if(typeof notice==='function')notice(s);else console.info(s);}
function usableMaps(){try{return typeof STATE!=='undefined'&&STATE.mapReady&&Array.isArray(STATE.maps)&&STATE.maps.length===2&&typeof L!=='undefined';}catch(_){return false;}}
function clearMarkers(){for(const l of markers){try{l.remove();}catch(_){}}markers.length=0;}
function errorText(err){switch(err?.code){case 1:return '定位權限遭拒絕，請到瀏覽器或手機設定允許此網站使用位置。';case 2:return '暫時無法取得裝置位置，請開啟手機定位服務後重試。';case 3:return '定位逾時，請到訊號較佳的位置後重試。';default:return '定位失敗，請確認裝置定位服務與網路設定。';}}
function locate(){
 if(pending)return;
 if(!usableMaps()){message('地圖尚未準備好，請稍後再按定位。');return;}
 if(!window.isSecureContext){message('定位需使用 HTTPS 網址（GitHub Pages）開啟。');return;}
 if(!navigator.geolocation){message('這個瀏覽器不支援裝置定位。');return;}
 pending=true;button.disabled=true;button.setAttribute('aria-busy','true');
 button.querySelector('span').textContent='定位中…';status.textContent='正在取得裝置位置';
 const req=++locationSeq;
 const finish=()=>{if(req!==locationSeq)return;pending=false;button.disabled=false;button.removeAttribute('aria-busy');button.querySelector('span').textContent='我的位置';};
 try{navigator.geolocation.getCurrentPosition(pos=>{
  finish();if(!usableMaps())return message('已取得位置，但地圖尚未準備好。');
  const lat=Number(pos.coords.latitude),lng=Number(pos.coords.longitude),accuracy=Number(pos.coords.accuracy);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return message('裝置回傳的位置資料無效。');
  clearMarkers();
  for(const map of STATE.maps){
    const dot=L.circleMarker([lat,lng],{radius:8,color:'#fff',weight:3,fillColor:'#1976d2',fillOpacity:1,interactive:false,pane:'deviceLocationPane',bubblingMouseEvents:false}).addTo(map);markers.push(dot);
    if(Number.isFinite(accuracy)&&accuracy>0&&accuracy<100000){
      const circle=L.circle([lat,lng],{radius:accuracy,color:'#1976d2',weight:1,fillColor:'#1976d2',fillOpacity:0.09,interactive:false,pane:'deviceLocationPane',bubblingMouseEvents:false}).addTo(map);markers.push(circle);
    }
    map.setView([lat,lng],Math.max(map.getZoom(),16),{animate:false});
  }
  message('已定位裝置目前位置'+(Number.isFinite(accuracy)?'（約 ±'+Math.round(accuracy)+' 公尺）':'')+'；此藍點不是豬場標記。');
 },err=>{finish();message(errorText(err));},{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
 }catch(err){finish();message('無法啟動定位：'+(err.message||err));}
}
button.addEventListener('click',locate);
if(settings){document.addEventListener('pointerdown',e=>{if(settings.open&&!settings.contains(e.target))settings.open=false;});}
window.PigGeolocate={onMapsReady(){if(attemptedAuto)return;attemptedAuto=true;if(isAuto())locate();}};
})();
