/* Select NOAA NEXRAD radar site by clickable dots OVER the editor map.
 * NO Mapbox style/label renderer changes; temporary editor overlay only.
 * Full station directory: NOAA NCEI ArcGIS REST (fallback NE stations).
 * A selected station is saved as scene.dataLoop.site; does NOT connect a feed.
 */
(function(g){
'use strict';
const N=g.WXWeatherRadarSites={
  source:'NOAA NCEI NEXRAD',
  url:'https://gis.ncdc.noaa.gov/arcgis/rest/services/cdo/nexrad/MapServer/0/query?where=1%3D1&outFields=STATION_ID%2CSTATION_NAME%2CLATITUDE%2CLONGITUDE&returnGeometry=false&f=json',
  stations:[],selected:null,active:false
};
const backup=[
 ['KBOX','Boston / Norton',41.9558,-71.1375],
 ['KGYX','Portland / Gray',43.8914,-70.2565],
 ['KCXX','Burlington / Colchester',44.511,-73.1665],
 ['KENX','Albany',42.5865,-74.064],
 ['KOKX','New York City / Upton',40.8656,-72.8639],
 ['KBGM','Binghamton',42.1997,-75.9847],
 ['KTYX','Montague / Fort Drum',43.7557,-75.6799],
 ['KBUF','Buffalo',42.9487,-78.7369],
 ['KCBW','Caribou',46.0392,-67.8066],
 ['KCCX','State College',40.9231,-78.0039],
 ['KDIX','Philadelphia / Mount Holly',39.9469,-74.4107],
 ['KDOX','Dover',38.8258,-75.4401]
].map(([id,name,lat,lon])=>({id,name,lat,lon}));
N.stations=backup;
N.parse=data=>{
 if(!Array.isArray(data?.features))return [];
 const dedup=new Map();
 for(const f of data.features){
  const p=f.attributes||f.properties||{};
  let id=String(p.STATION_ID||p.station_id||'').trim().toUpperCase();
  if(/^[A-Z]{3}$/.test(id))id='K'+id;
  const lat=Number(p.LATITUDE??p.latitude),lon=Number(p.LONGITUDE??p.longitude);
  if(!/^[A-Z0-9]{4}$/.test(id)||!Number.isFinite(lat)||!Number.isFinite(lon))continue;
  if(lat<10||lat>75||lon< -180||lon> -50)continue;
  dedup.set(id,{id,name:String(p.STATION_NAME||p.station_name||id).trim(),lat,lon});
 }
 return [...dedup.values()];
};
N.load=async()=>{
 try{
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),8000);
  let response;
  try{response=await fetch(N.url,{signal:c.signal});}finally{clearTimeout(timer);}
  if(!response.ok)throw Error('NOAA directory HTTP '+response.status);
  const sites=N.parse(await response.json());
  if(sites.length>=20){
    N.stations=sites;
    const planned=g.WXData?.planned?.find(p=>p.id==='nexrad');
    if(planned){planned.sites=sites.map(x=>({id:x.id,label:x.id+' '+x.name}));planned.defaultSite='KBOX';}
    return sites;
  }
 }catch(e){N.lastError=String(e.message||e);}
 return N.stations;
};
N.nearest=(lon,lat,limitKm=80)=>{
 const r=Math.PI/180,sc=Math.cos(lat*r);
 let best=null,min=Infinity;
 for(const station of N.stations){
  const x=(station.lon-lon)*111.195*sc,y=(station.lat-lat)*111.195,d=Math.hypot(x,y);
  if(d<min){best=station;min=d;}
 }
 return min<=limitKm?best:null;
};
const css=`
#wxradar-pick-btn{position:absolute;left:1.3%;top:2%;z-index:12;
 background:#111d31;color:#dcedff;border:1px solid #459ff5;
 border-radius:5px;font:600 12px Arial;padding:6px 9px;cursor:pointer;}
#wxradar-picker{position:absolute;inset:0;z-index:11;pointer-events:none;}
#wxradar-picker .nxsite{position:absolute;width:13px;height:13px;margin:-6.5px;
 border:2px solid #fff;background:#168df7;border-radius:50%;cursor:pointer;
 pointer-events:auto;box-shadow:0 0 0 2px #122b50,0 0 5px #000;}
#wxradar-picker .nxsite.active{background:#ffb53f;border-color:#000;
 box-shadow:0 0 0 3px #fff;z-index:2;}
#wxradar-site-status{position:absolute;left:1.3%;top:6.4%;z-index:12;
 max-width:55%;font:600 11px Arial;background:#111d31dd;padding:3px 6px;
 border-radius:4px;color:#dcecff;pointer-events:none;}
`;
function boot(){
 const wrap=document.getElementById('stageWrap'),WX=g.WX;
 if(!wrap||!WX?.S||!WX?.E)return false;
 const style=document.createElement('style');style.textContent=css;document.head.appendChild(style);
 const layer=document.createElement('div');layer.id='wxradar-picker';
 const toggle=document.createElement('button');toggle.id='wxradar-pick-btn';
 toggle.textContent='Radar sites';
 toggle.title='Show selectable NOAA NEXRAD sites on the map';
 const status=document.createElement('div');status.id='wxradar-site-status';
 status.hidden=true;
 wrap.append(layer,toggle,status);
 toggle.addEventListener('click',()=>{
  N.active=!N.active;
  toggle.textContent=N.active?'Hide radar sites':'Radar sites';
  toggle.setAttribute('aria-pressed',String(N.active));
  render();
 });
 let lastKey='',lastRender=0;
 const cur=()=>WX.S.show?.scenes?.[WX.S.si];
 N.select=id=>{
  const site=N.stations.find(s=>s.id===id);
  const sc=cur();if(!site||!sc)return false;
  const before=sc.dataLoop||{};
  sc.dataLoop={...((g.WXData?.defaults?.()||{on:false,source:'nexrad',hours:1,speed:10})),
    ...before,source:'nexrad',site:id,on:before.source==='nexrad'&&before.on===true};
  // Selecting a site does NOT mark unavailable NOAA Level-II as connected.
  N.selected=id;
  WX.commit();
  render();
  return true;
 };
 function render(){
  const sc=cur(),canRender=N.active&&sc?.bg?.type==='mapbox'&&WX.S.mode==='edit'&&!WX.S.present;
  layer.style.display=canRender?'block':'none';
  status.hidden=!canRender;
  if(!canRender){layer.replaceChildren();return;}
  const xf=WX.E.xf(sc,WX.S.editEnd&&sc.bg.view2?(sc.bg.camDelay||0)+(sc.bg.camDur||3)+.01:0);
  const selected=sc.dataLoop?.site||N.selected;
  const frag=document.createDocumentFragment();
  let shown=0;
  for(const site of N.stations){
   const pos=xf?.fwd?.(site.lon,site.lat);
   if(!pos||!Number.isFinite(pos[0])||!Number.isFinite(pos[1])||
       pos[0]<8||pos[0]>1912||pos[1]<8||pos[1]>1072)continue;
   const dot=document.createElement('button');
   dot.className='nxsite'+(site.id===selected?' active':'');
   dot.style.left=(pos[0]/1920*100)+'%';
   dot.style.top=(pos[1]/1080*100)+'%';
   dot.title=site.id+' — '+site.name;dot.setAttribute('aria-label','Select '+site.id+' '+site.name);
   dot.addEventListener('click',e=>{e.stopPropagation();N.select(site.id);});
   frag.appendChild(dot);shown++;
  }
  layer.replaceChildren(frag);
  status.textContent=selected?'Selected '+selected+' · '+shown+' radar dots · feed pending':
    shown+' NOAA radar dots · click to choose a site (feed pending)';
 }
 N.render=render;
 function loop(ts){
  if(N.active&&(ts-lastRender>200)){
   const sc=cur(),camera=sc?.bg?.view,
     key=[WX.S.si,WX.S.mode,sc?.dataLoop?.site,camera?.c?.join(','),camera?.z,camera?.b,camera?.p,N.stations.length].join('|');
   if(key!==lastKey){lastKey=key;render();}
   lastRender=ts;
  }
  requestAnimationFrame(loop);
 }
 N.load().then(()=>{
    // Fix Claude's placeholder KBOS airport entry, including when NOAA's
    // all-station directory request is unavailable and NE fallback is used.
    const planned=g.WXData?.planned?.find(p=>p.id==='nexrad');
    if(planned){
      planned.sites=N.stations.map(x=>({id:x.id,label:x.id+' '+x.name}));
      planned.defaultSite='KBOX';
    }
    lastKey='';if(N.active)render();
  });
 requestAnimationFrame(loop);
 return true;
}
function retry(){if(!boot())setTimeout(retry,350);}
if(typeof document!=='undefined'){
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',retry);
 else retry();
}
})(typeof window!=='undefined'?window:globalThis);
