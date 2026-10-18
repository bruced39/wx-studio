/* WX Studio NOAA decoder → Claude's WXData manifest registry and Mapbox bridge.
 * This module DOES NOT pretend catalog-only feeds are live. A provider is
 * registered only when an independent processor returns current manifest data.
 * Public HTTPS frame origin is set via WX_WEATHER_PROCESSOR_URL (Streamlit).
 */
(function(g){
  'use strict';
  const D=g.WXData;
  if(!D)return;
  const cfg=g.WX_WEATHER_PROCESSOR_URL;
  let endpoint='';
  try{
    if(typeof cfg==='string'){
      const url=new URL(cfg);
      if(url.protocol==='https:'||(url.hostname==='localhost'||url.hostname==='127.0.0.1')){
        endpoint=url.origin+url.pathname.replace(/\/$/,'');
      }
    }
  }catch(e){}
  const BR=g.WXWeatherProcessorBridge={endpoint,status:endpoint?'checking':'not-configured',
    products:[],error:'',lastCheck:0};
  let lastCatalogVersion='',managedSources=new Set();
  const idOf=product=>{
    if(/^goes-(east|west)-(conus|full|meso1|meso2)-C(?:02|13)$/.test(product))return 'goes';
    if(product==='mrms-reflectivity')return 'mrms';
    if(/^nexrad-(reflectivity|velocity)-K[A-Z0-9]{3}$/.test(product))return 'nexrad';
    return null;
  };
  const MAX_ROWS=180;
  async function readJson(path){
    const ctl=new AbortController();
    const abort=setTimeout(()=>ctl.abort(),12000);
    try{
      const r=await fetch(endpoint+path,{mode:'cors',signal:ctl.signal,cache:'no-store'});
      if(!r.ok)throw Error('processor returned '+r.status);
      return await r.json();
    }finally{clearTimeout(abort)}
  }
  function checkedFrame(frame){
    if(!frame||!Number.isFinite(frame.t)||!Array.isArray(frame.bbox)||frame.bbox.length!==4)return null;
    const [w,s,e,n]=frame.bbox;
    if(!(w>=-180&&e<=180&&w<e&&s>=-85&&n<=85&&s<n)||frame.crs!=='4326')return null;
    try{
      const url=new URL(frame.url);
      if(url.origin!==new URL(endpoint).origin||url.protocol!=='https:'&&url.hostname!=='localhost'&&url.hostname!=='127.0.0.1')return null;
      if(!/\/frames\/[a-z0-9-]+\/[0-9]{13}\.png$/.test(url.pathname))return null;
      return {t:frame.t,bbox:frame.bbox,crs:'4326',url:url.href};
    }catch(e){return null}
  }
  async function manifest(product,hours){
    const data=await readJson('/manifests/'+encodeURIComponent(product)+'.json');
    if(data.schema!=='wxstudio.frames.v1'||data.product!==product||!Array.isArray(data.frames))return [];
    const cutoff=Date.now()-Math.max(1,Math.min(12,+hours||1))*3600000;
    const frames=data.frames.map(checkedFrame).filter(Boolean).filter(x=>x.t>=cutoff&&x.t<=Date.now()+600000);
    return frames.sort((a,b)=>a.t-b.t).slice(-MAX_ROWS);
  }
  async function refresh(){
    if(!endpoint)return;
    try{
      const catalog=await readJson('/catalog');
      if(catalog.schema!=='wxstudio.frames.v1'||!Array.isArray(catalog.products))throw Error('invalid processor catalog');
      const products=catalog.products.map(p=>p.product).filter(p=>idOf(p));
      const version=JSON.stringify(catalog.products.map(p=>[p.product,p.latestObservationUtc,p.frameCount]).sort());
      const changed=version!==lastCatalogVersion;lastCatalogVersion=version;
      BR.products=products;BR.status=products.length?'available':'no-fresh-data';
      BR.error='';BR.lastCheck=Date.now();
      // ONLY register a source when it has actual NOAA-origin manifests.
      const goes=products.filter(p=>idOf(p)==='goes'),mrms=products.filter(p=>idOf(p)==='mrms'),
        nexrad=products.filter(p=>idOf(p)==='nexrad');
      // Preserve compatibility with old saved scenes ('goes' generic), but
      // also expose EACH actually decoded GOES-19 East / GOES-18 West sector
      // and channel as a separate source in Claude's existing dropdown.
      const present=new Set(products.map(p=>idOf(p)==='goes'?p:idOf(p)));
      if(goes.length)present.add('goes');
      for(const id of managedSources){
        if(!present.has(id)){delete D.sources[id];managedSources.delete(id);D.onSources?.();}
      }
      if(changed){
        // An open scene must load newly published NOAA frames, not keep
        // the promise cached for the previous product snapshot forever.
        for(const scene of g.WX?.S?.show?.scenes||[]){
          if(!scene?.dataLoop?.on)continue;
          const rt=D.state.get(scene);
          if(rt){rt.key='';rt.promise=null;rt.gen++;}
        }
      }
      if(goes.length){managedSources.add('goes');
        D.registerSource({id:'goes',label:'GOES ABI (processed NOAA)',lengths:[1,2,4,12],
          list:({hours})=>manifest(goes.find(x=>x==='goes-east-conus-C02')||goes[0],hours)});
      }
      for(const product of goes){
        const m=/^goes-(east|west)-(conus|full|meso1|meso2)-(C02|C13)$/.exec(product);
        if(!m)continue;
        const satellite=m[1]==='east'?'GOES-19 East':'GOES-18 West',
          sector={conus:'CONUS',full:'Full Disk',meso1:'Mesoscale 1',meso2:'Mesoscale 2'}[m[2]],
          channel=m[3]==='C02'?'Visible 0.5 km':'IR 2 km';
        managedSources.add(product);
        D.registerSource({id:product,label:satellite+' · '+sector+' · '+channel,
          lengths:[1,2,4,12],category:'satellite',
          list:({hours})=>manifest(product,hours)});
      }
      if(mrms.length){
        managedSources.add('mrms');
        D.registerSource({id:'mrms',label:'MRMS 1 km reflectivity',lengths:[1,2,4],
          list:({hours})=>manifest(mrms[0],hours)});
      }
      if(nexrad.length){
        managedSources.add('nexrad');
        const sites=nexrad.map(p=>p.split('-').at(-1)).filter((x,i,a)=>a.indexOf(x)===i)
          .map(id=>({id,label:id}));
        D.registerSource({id:'nexrad',label:'NEXRAD Level II (processed)',lengths:[1,2,4],
          sites,defaultSite:sites.some(s=>s.id==='KBOX')?'KBOX':sites[0].id,
          list:({site,hours})=>{
            const p=nexrad.find(x=>x==='nexrad-reflectivity-'+(site||'KBOX'));
            return p?manifest(p,hours):Promise.resolve([]);
          }});
      }
    }catch(e){BR.status='unavailable';BR.error=String(e?.message||e)}
  }
  BR.refresh=refresh;
  if(endpoint){refresh();setInterval(refresh,5*60000);}
  // Editor/export hooks: activate Mapbox's image-source UNDERLAY before
  // drawing the Mapbox canvas. The original canvas-over-labels path is bypassed
  // for map scenes; captions and weather-show graphics remain untouched.
  D.useMapboxUnderlay=function(scene,t,opts){
    if(!g.MB?.setWeatherFrame)return false;
    if(!scene||scene.bg?.type!=='mapbox'||!scene.dataLoop?.on){
      g.MB.setWeatherFrame(null);return false;
    }
    const dl=scene.dataLoop,rt=D.state.get(scene);
    const frames=rt?.frames?.filter(f=>f.img)||[];
    if(!frames.length){g.MB.setWeatherFrame(null);return false;}
    const idx=D.curIdx(scene,t,opts&&opts.editing),frame=frames[idx];
    // The old 2D weather draw path used to update lastIdx. The Mapbox
    // underlay bypasses it, so advance the displayed timestamp/blue knob
    // explicitly to the exact frame selected for the map and exports.
    rt.lastIdx=idx;
    if(!frame){g.MB.setWeatherFrame(null);return false;}
    let url=frame.url;
    // The demo loop supplies canvases. Encoding the same image into a
    // base64 PNG on EVERY 30fps editor redraw can starve Mapbox startup.
    // Each loaded frame is immutable for one provider response: encode once.
    if(!url&&frame.img?.toDataURL){
      if(!frame._wxUnderlayDataURL)
        frame._wxUnderlayDataURL=frame.img.toDataURL('image/png');
      url=frame._wxUnderlayDataURL;
    }
    if(!url){g.MB.setWeatherFrame(null);return false;}
    g.MB.setWeatherFrame({url,bbox:frame.bbox,crs:frame.crs||'4326',
      opacity:dl.opacity==null?.85:dl.opacity,
      id:(dl.source||'')+':'+frame.t+':'+(dl.site||'')});
    return true;
  };
  const oldDraw=D.draw;
  D.draw=function(c,scene,t,opts,xf){
    if(scene?.bg?.type==='mapbox')return; // never draw weather on top of map labels
    return oldDraw.call(D,c,scene,t,opts,xf);
  };
})(typeof window!=='undefined'?window:globalThis);
