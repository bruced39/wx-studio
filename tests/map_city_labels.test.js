// Run: node --test tests/map_city_labels.test.js
// Verifies Mapbox Streets v8 label logic without network, credentials or WebGL.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../studio/mapbox.js'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'../studio/ui.js'),'utf8');

const between=(a,b)=>{
 const start=source.indexOf(a),end=source.indexOf(b,start);
 assert.ok(start!==-1&&end>start, 'Expected source snippet '+a);
 return source.slice(start,end);
};
const maker=new Function('wdFontStack','labelPadding',
 between('  function settlementLayer(','  // Natural Earth land polygons')+
 ';return settlementLayer;')(()=>['DIN Pro Bold','Arial Unicode MS Bold'],()=>9);
const buildCode=between("    ['wd-major-city-labels'",'\n  }\n\n  MB.token');
const build=new Function('cfg','map','source','settlementLayer',buildCode+';return map.layers;');
function render(cfg){
 const map={layers:[],getLayer(id){return this.layers.find(l=>l.id===id)},
  removeLayer(id){this.layers=this.layers.filter(l=>l.id!==id)},
  addLayer(layer){this.layers.push(layer)}};
 return build(cfg,map,'composite',maker);
}
const cfg={
 broadcastShowCities:true,broadcastPlaceDensity:'towns',
 broadcastLabelDensity:'normal',broadcastLabelOpacity:1,
 broadcastMajorCityRank:9,broadcastKeepMajorCities:true,
 broadcastCityMinZoom:6,broadcastCityMaxZoom:20,
 broadcastTownMinZoom:5,broadcastTownMaxZoom:21,
 broadcastVillageMinZoom:7,broadcastVillageMaxZoom:18,
 broadcastMajorCityMinZoom:0,
 broadcastCitySize:20,broadcastTownSize:16,broadcastVillageSize:13
};
const evalFilter=(e,p)=>{
 if(!Array.isArray(e))return e;
 const [op,...args]=e;
 if(op==='get')return p[args[0]];
 if(op==='coalesce')return args.map(x=>evalFilter(x,p)).find(x=>x!=null);
 if(op==='all')return args.every(x=>evalFilter(x,p));
 if(op==='any')return args.some(x=>evalFilter(x,p));
 if(op==='==')return evalFilter(args[0],p)===evalFilter(args[1],p);
 if(op==='<=')return evalFilter(args[0],p)<=evalFilter(args[1],p);
 if(op==='match')return args[1].includes(evalFilter(args[0],p))?args[2]:args[3];
 throw Error('Unknown filter '+op);
};
const prominent={class:'settlement',type:'city',filterrank:5,symbolrank:4};
const minor={class:'settlement',type:'city',filterrank:5,symbolrank:16};
test('zoom 0–20 retains prominent cities when city minimum is 6',()=>{
 const layers=render(cfg);
 const city=layers.find(l=>l.id==='wd-city-labels');
 const major=layers.find(l=>l.id==='wd-major-city-labels');
 assert.deepEqual([city.minzoom,city.maxzoom],[6,20]);
 assert.deepEqual([major.minzoom,major.maxzoom],[0,6]);
 assert.ok(evalFilter(city.filter,prominent));
 assert.ok(evalFilter(major.filter,prominent));
 assert.ok(!evalFilter(major.filter,minor));
 for(const zoom of [0,2,4,5,5.9,6,7,12,19.9])
  assert.ok(layers.some(l=>l.minzoom<=zoom&&(l.maxzoom??24)>zoom&&evalFilter(l.filter,prominent)),String(zoom));
});
test('town and village zoom windows follow map settings',()=>{
 const l=render({...cfg,broadcastPlaceDensity:'villages'});
 const town=l.find(x=>x.id==='wd-town-labels');
 const village=l.find(x=>x.id==='wd-small-place-labels');
 assert.deepEqual([town.minzoom,town.maxzoom],[5,21]);
 assert.deepEqual([village.minzoom,village.maxzoom],[7,18]);
});
test('turning off major cities retains intentional sparse settings',()=>{
 const l=render({...cfg,broadcastKeepMajorCities:false});
 assert.equal(l.some(x=>x.id==='wd-major-city-labels'),false);
 const city=l.find(x=>x.id==='wd-city-labels');
 assert.equal(evalFilter(city.filter,prominent),false);
});
test('default city minimum still shows important cities at overview zoom',()=>{
 const l=render({...cfg,broadcastCityMinZoom:3,broadcastCityMaxZoom:24});
 const city=l.find(x=>x.id==='wd-city-labels');
 assert.ok(evalFilter(city.filter,prominent),'prominent city survives changing filterrank');
});
test('UI exposes editable min and max zoom ranges for every place type',()=>{
 for(const name of ['City','Town','Village'])
  for(const edge of ['Min','Max'])
   assert.ok(ui.includes("B('broadcast"+name+edge+"Zoom','range'"),name+' '+edge);
 assert.ok(ui.includes("B('broadcastMajorCityMinZoom','range'"));
});
