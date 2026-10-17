/* Built-in WX Studio weather color palettes.
   Reflectivity colors are a documented BROADCAST STARTER inspired by common
   NWS dBZ legends; NOT asserted to be NOAA's exact official table.
   Product-specific LUTs remain editable/cloud-saveable separately.
*/
(function(g){
'use strict';
const P=g.WXWeatherPalettes={version:1,builtins:{},custom:{}};
const hex=x=>typeof x==='string'&&/^#[0-9a-f]{6}$/i.test(x);
P.validate=function(data){
 if(!data||typeof data.id!=='string'||!/^[a-z0-9/._-]{3,100}$/.test(data.id))throw Error('Invalid palette id');
 if(!['radar','satellite','rtma','models','custom'].includes(data.category))throw Error('Invalid palette category');
 if(!Array.isArray(data.stops)||data.stops.length<2||data.stops.length>256)throw Error('Palette must have 2–256 color stops');
 let before=-Infinity;
 for(const [v,color] of data.stops){
  if(!Number.isFinite(v)||v<=before||!hex(color))throw Error('Color stops must have increasing numerical values and #RRGGBB colors');
  before=v;
 }
 return true;
};
P.add=function(def,{builtin=false}={}){
 P.validate(def);
 const frozen=JSON.parse(JSON.stringify(def));
 (builtin?P.builtins:P.custom)[def.id]=Object.freeze(frozen);
 return frozen;
};
P.get=id=>P.custom[id]||P.builtins[id]||null;
P.list=category=>Object.values({...P.builtins,...P.custom}).filter(x=>!category||x.category===category);
P.paint=(id,value)=>{
 const p=P.get(id);if(!p||!Number.isFinite(value))return null;
 const stops=p.stops;
 if(value<stops[0][0])return p.belowColor??null;
 if(value>=stops[stops.length-1][0])return stops[stops.length-1][1];
 for(let i=1;i<stops.length;i++)if(value<stops[i][0])return stops[i-1][1];
 return null;
};
const add=x=>P.add(x,{builtin:true});
add({id:'radar/reflectivity',category:'radar',name:'Reflectivity — broadcast starter',
 productIds:['mrms_mosaic_reflectivity','nexrad_level2_base_reflectivity'],
 units:'dBZ',continuous:false,belowColor:null,
 note:'Initial NWS-inspired legend, not a certified NOAA or NEXRAD official LUT. Edit/save your custom table anytime.',
 stops:[[-10,'#000000'],[5,'#04e9e7'],[10,'#019ff4'],[15,'#0300f4'],
 [20,'#02fd02'],[25,'#01c501'],[30,'#008e00'],[35,'#fdf802'],
 [40,'#e5bc00'],[45,'#fd9500'],[50,'#fd0000'],[55,'#d40000'],
 [60,'#bc0000'],[65,'#f800fd'],[70,'#9854c6'],[75,'#ffffff']]});
add({id:'radar/velocity',category:'radar',name:'Radial velocity — diverging starter',
 productIds:['nexrad_level2_velocity'],units:'m/s',continuous:true,belowColor:'#083366',
 note:'Starter only; operational velocity displays depend on each radar scan Nyquist speed.',
 stops:[[-60,'#052b7a'],[-45,'#075db2'],[-30,'#0096c7'],[-15,'#2bc4bd'],
 [-4,'#97e0ca'],[0,'#777777'],[4,'#d6cf96'],[15,'#df9b2f'],
 [30,'#cc5021'],[45,'#a60000'],[60,'#62000f']]});
add({id:'satellite/ir-enhanced',category:'satellite',
 name:'Infrared brightness temperature — starter',
 productIds:['abi_c13'],units:'°C',continuous:true,
 note:'IR BT starter enhancement, distinct from physical Cloud Top Temperature. Adjust to your broadcast IR LUT.',
 stops:[[-95,'#ffffff'],[-85,'#d5b9ff'],[-75,'#8653cc'],[-65,'#ed494f'],
 [-55,'#f89c3c'],[-45,'#faec69'],[-35,'#59c37c'],[-25,'#44bfd5'],
 [-15,'#5775d8'],[-5,'#848e9d'],[5,'#9aa0a6'],[20,'#303842'],[40,'#0b1020']]});
add({id:'satellite/cloud-top-temperature',category:'satellite',
 name:'Cloud-top temperature — starter',productIds:['abi_cloud_top_temp'],
 units:'K',continuous:true,
 note:'Physical cloud top temperature Kelvin scale; masking invalid/clear pixels is a separate decoder step.',
 stops:[[175,'#eeeeff'],[190,'#e4b1f6'],[205,'#a855ca'],[220,'#e55565'],
 [235,'#f6ae4b'],[250,'#f9ed99'],[265,'#65c89c'],[280,'#4785bf'],[310,'#353f4a']]});
add({id:'satellite/cloud-top-height',category:'satellite',
 name:'Cloud-top height — starter',productIds:['abi_cloud_top_height'],units:'m',
 continuous:true,note:'Example height visualization; apply satellite quality flags and missing-data masks.',
 stops:[[0,'#c4c7cb'],[1000,'#a6c8e2'],[3000,'#4f9ecf'],[6000,'#3b63a9'],
 [9000,'#8c64bb'],[12000,'#da69a3'],[15000,'#f09a4d'],[18000,'#e7e7d9']]});
P.presetPaths={
 radar:'{user-id}/radar/{product-id}/{palette-name}.json',
 satellite:'{user-id}/satellite/{product-id}/{palette-name}.json',
 rtma:'{user-id}/rtma/{product-id}/{palette-name}.json',
 models:'{user-id}/models/{product-id}/{palette-name}.json',
 custom:'{user-id}/custom/{product-id}/{palette-name}.json'
};
})(typeof window!=='undefined'?window:globalThis);
