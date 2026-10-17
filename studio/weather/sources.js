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
const push=p=>C.products.push(Object.freeze({...p,status:'decoder-needed'}));
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
 stations:'https://gis.ncdc.noaa.gov/arcgis/rest/services/cdo/nexrad/MapServer/0'
};
})(typeof window!=='undefined'?window:globalThis);
