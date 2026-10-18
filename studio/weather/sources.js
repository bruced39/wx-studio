/* Weather source manifest: authoritative highest-native-resolution FREE data;
   this is a readiness/catalog module, NOT a fake WXData provider.
   NetCDF4/GRIB2/NEXRAD Level-II need server-side decoding/reprojection to
   geolocated, transparent images before WXData.registerSource can be called.
   NOAA NODD: https://registry.opendata.aws/noaa-goes/
   NEXRAD: https://registry.opendata.aws/noaa-nexrad/
   MRMS: https://mrms.ncep.noaa.gov/data/ and NOAA RIDGE2.
*/
(function(g){
'use strict';
const C=g.WXWeatherSources={
 version:1, providerStatus:'catalog-only',
 categories:['satellite','radar','rtma','models'],
 products:[], byId(id){return this.products.find(p=>p.id===id)||null;},
 list(category){return this.products.filter(p=>!category||p.category===category);}
};
const push=p=>C.products.push(Object.freeze({status:'decoder-needed',...p}));
const goes=[
 {id:'g19',satellite:'GOES-19',region:'East',bucket:'noaa-goes19'},
 {id:'g18',satellite:'GOES-18',region:'West',bucket:'noaa-goes18'}
];
const sectors=[
 {id:'conus',code:'C',label:'CONUS',cadenceMinutes:5},
 {id:'fulldisk',code:'F',label:'Full Disk',cadenceMinutes:10},
 {id:'meso1',code:'M1',label:'Mesoscale 1',cadenceMinutes:1},
 {id:'meso2',code:'M2',label:'Mesoscale 2',cadenceMinutes:1}
];
for(const sat of goes)for(const sector of sectors){
 const common={category:'satellite',satellite:sat.satellite,region:sat.region,
  sector:sector.id,sectorName:sector.label,bucket:sat.bucket,
  endpoint:'https://'+sat.bucket+'.s3.amazonaws.com/',
  cadenceMinutes:sector.cadenceMinutes,format:'netCDF4',source:'NOAA GOES NODD (AWS)',
  projection:'GOES fixed grid',retentionHours:null,
  caveat:'Mesoscale sectors M1/M2 MOVE: derive footprint from each file, not a fixed map bbox.'};
 const products=[
  {id:'abi_c02',label:'ABI 0.64µm Visible — native 0.5 km',prefix:'ABI-L2-CMIP'+(sector.code.startsWith('M')?'M':sector.code),
   channel:'C02',resolutionKm:0.5,palette:null,display:'single-band grayscale reflectance'},
  {id:'abi_c13',label:'ABI 10.3µm Clean IR — native 2 km',prefix:'ABI-L2-CMIP'+(sector.code.startsWith('M')?'M':sector.code),
   channel:'C13',resolutionKm:2,palette:'satellite/ir-enhanced',display:'brightness temperature'},
  {id:'abi_multichannel',label:'ABI multi-channel color foundation',prefix:'ABI-L2-MCMIP'+(sector.code.startsWith('M')?'M':sector.code),
   channel:'multiple',resolutionKm:'0.5–2',palette:null,display:'derived GeoColor/RGB; no scalar LUT'},
  {id:'abi_cloud_top_temp',label:'Cloud Top Temperature (ACHT)',prefix:'ABI-L2-ACHT'+(sector.code.startsWith('M')?'M':sector.code),
   channel:'derived',resolutionKm:2,palette:'satellite/cloud-top-temperature',display:'kelvin'},
  {id:'abi_cloud_top_height',label:'Cloud Top Height (ACHA)',prefix:'ABI-L2-ACHA'+(sector.code.startsWith('M')?'M':sector.code),
   channel:'derived',resolutionKm:2,palette:'satellite/cloud-top-height',display:'meters'}
 ];
 for(const p of products)push({...common,...p,id:sat.id+'_'+sector.id+'_'+p.id,
   note:p.prefix+' is a verified NOAA product family; actual channel scans and availability must be checked before enabling.'});
}
push({id:'mrms_mosaic_reflectivity',category:'radar',label:'MRMS 1 km quality-controlled reflectivity mosaic',
 source:'NOAA MRMS',endpoint:'https://mrms.ncep.noaa.gov/2D/MergedReflectivityQC/',
 format:'GRIB2 gzip',resolutionKm:1,cadenceMinutes:2,palette:'radar/reflectivity',
 scope:'CONUS mosaic',historyHours:null,
 caveat:'NOAA RIDGE2 MapServer is a LIVE 1 km image, NOT an historical four-hour frames API. Capture/archive raw MRMS frames explicitly.'});
// Separate official NWS time-enabled MRMS ImageServer, with its own rolling
// four-hour history. Source-native 1 km mosaic remains the primary product;
// this is a time-addressable *rendered image*, not raw dBZ for custom LUTs.
push({id:'mrms_nws_4hour_image',category:'radar',
 label:'NWS MRMS four-hour historical radar images',
 source:'NOAA NWS ArcGIS ImageServer',
 endpoint:'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer',
 format:'ArcGIS time-enabled raster image',status:'browser-preview-under-test',
 cadenceMinutes:5,resolutionKm:1,historyHours:4,
 palette:null,display:'Pre-rendered NWS reflectivity (cannot recolor source values with LUT)',
 caveat:'Use ImageServer exportImage time=UTC epoch milliseconds; 4h rolling advertised but query current service time extent. Preserve source/native scale; do not misrepresent server resampling as higher detail.'});
push({id:'nexrad_level2_base_reflectivity',category:'radar',
 label:'WSR-88D Level II — native polar high-resolution base reflectivity',
 source:'NOAA/Unidata NODD',bucket:'unidata-nexrad-level2',
 liveBucket:'unidata-nexrad-level2-chunks',
 endpoint:'https://unidata-nexrad-level2.s3.amazonaws.com/',
 format:'NEXRAD Archive II radar volumes (bzip2-compressed messages)',
 palette:'radar/reflectivity',cadenceMinutes:'volume-dependent',
 resolutionMeters:'native variable, approximately 250m radial gates for super-resolution sweeps',
 caveat:'Must decode polar volumes, pick tilt/elevation, georeference and color-map before overlay; do not substitute RIDGE2 imagery for Level II.'});
push({id:'nexrad_level2_velocity',category:'radar',
 label:'WSR-88D Level II — native high-resolution radial velocity',
 source:'NOAA/Unidata NODD',bucket:'unidata-nexrad-level2',
 liveBucket:'unidata-nexrad-level2-chunks',
 format:'NEXRAD Level II',palette:'radar/velocity',cadenceMinutes:'volume-dependent',
 caveat:'Requires per-site nyquist-aware velocity display, unaliased output only if separately processed.'});
C.pending=[{id:'rtma',label:'RTMA analysis: variable choices pending user',note:'Grid/projection/interpolation required; no variables selected.'},
 {id:'forecast',label:'Model fields: awaiting user model/product choices',note:'No GRIB products provisioned.'}];
C.NOAA={
 goes:'https://registry.opendata.aws/noaa-goes/',
 nexrad:'https://registry.opendata.aws/noaa-nexrad/',
 mrms:'https://mrms.ncep.noaa.gov/data/',
 radarLive:'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity/MapServer',
 radarHistory:'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer',
 stations:'https://gis.ncdc.noaa.gov/arcgis/rest/services/cdo/nexrad/MapServer/0'
};

/* ---------- First REAL weather source: NOAA MRMS regional radar preview ----------
 * NOAA's time-enabled image service renders MRMS reflectivity imagery at
 * ~5-minute update cadence with a moving history. THIS IS NOT raw 1-km
 * GRIB2 and cannot support a custom reflectivity LUT. That decoder remains
 * pending; this direct ArcGIS preview is an integration test for timestamps,
 * georeferencing, WebGL-under-label placement, and playback.
 *
 * Keep requests in a fixed Northeast geographic test region initially.
 * Do not claim national-native resolution or silently resample all CONUS:
 * a separate view-aware cache/tile pipeline is required to achieve that.
 * NO synthetic timestamps: query the actual NOAA image catalog.
 */
const IMAGE_SERVER=C.NOAA.radarHistory;
const TEST_BBOX=Object.freeze([-82.0,35.5,-64.5,49.0]);
const TEST_SIZE=Object.freeze([3072,2304]);
const MS_5MIN=300000;
const MAX_FRAMES=12;  // Initial one-hour test. Avoid 48 3072px textures in RAM.
const epochTime=t=>Number.isFinite(+t)&&+t>1e12?Number(t):null;
const frameUrl=(epochMs,bbox=TEST_BBOX,size=TEST_SIZE)=>{
 const q=new URLSearchParams({
   bbox:bbox.join(','),bboxSR:'4326',imageSR:'4326',
   size:size.join(','),format:'png32',transparent:'true',
   interpolation:'+RSP_NearestNeighbor',
   time:String(epochMs),f:'image'
 });
 return IMAGE_SERVER+'/exportImage?'+q.toString();
};
async function noaaJson(url){
 const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),15000);
 try{
  const r=await fetch(url,{mode:'cors',cache:'no-store',signal:abort.signal});
  if(!r.ok)throw Error('NOAA radar service HTTP '+r.status);
  const json=await r.json();
  if(json.error)throw Error('NOAA radar service: '+(json.error.message||'ArcGIS error'));
  return json;
 }finally{clearTimeout(timeout)}
}
async function listNwsMrms({hours=1}={}){
 // NOAA endpoint MUST be read at runtime; no assumed "latest" frame times.
 const metadata=await noaaJson(IMAGE_SERVER+'?f=pjson');
 const window=metadata.timeInfo?.timeExtent;
 if(!Array.isArray(window)||window.length!==2)throw Error('NOAA MRMS time extent unavailable');
 const start=epochTime(window[0]),end=epochTime(window[1]),now=Date.now();
 if(!start||!end||start>=end)throw Error('Invalid NOAA MRMS time extent');
 if(end<now-45*60000||end>now+10*60000)
  throw Error('NOAA MRMS service time extent is not current (refusing stale radar)');
 // Query actual image timestamps so every shown frame represents a real scan,
 // not a guessed five-minute time offset with a misleading date/time.
 const query=new URLSearchParams({
  where:'1=1',outFields:'idp_validtime',returnGeometry:'false',
  returnDistinctValues:'true',orderByFields:'idp_validtime DESC',
  resultRecordCount:'150',f:'json'
 });
 const catalog=await noaaJson(IMAGE_SERVER+'/query?'+query.toString());
 if(!Array.isArray(catalog.features))throw Error('NOAA MRMS timestamp catalog unavailable');
 const requested=Math.max(1,Math.min(1,+hours||1)); // test phase: exactly 1 hour
 const min=Math.max(start,end-requested*3600000,now-5*3600000);
 const values=[...new Set(catalog.features.map(f=>epochTime(f.attributes?.idp_validtime)).filter(t=>
  t!==null&&t>=min&&t<=end+MS_5MIN))].sort((a,b)=>a-b).slice(-MAX_FRAMES);
 if(values.length<2)throw Error('NOAA MRMS returned fewer than two valid timed scans');
 return values.map(t=>({
  t,bbox:TEST_BBOX.slice(),crs:'4326',url:frameUrl(t)
 }));
}
C.mrmsBrowserTest=Object.freeze({
 service:IMAGE_SERVER,bbox:TEST_BBOX,size:TEST_SIZE,
 frameUrl,list:listNwsMrms,note:'NOAA-rendered regional preview, not source-native decoded GRIB2'
});
if(g.WXData&&typeof g.WXData.registerSource==='function'){
 g.WXData.registerSource({
  id:'mrms',label:'NOAA MRMS · Northeast (test)',lengths:[1],
  list:listNwsMrms,category:'radar',provider:'NOAA NWS ImageServer',
  nativeData:false,format:'server-rendered PNG32',
  attribution:'NOAA/NWS MRMS radar mosaic'
 });
 C.providerStatus='mrms-regional-browser-test';
}
})(typeof window!=='undefined'?window:globalThis);
