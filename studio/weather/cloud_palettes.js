/* WX Studio private weather palette cloud API (same Supabase session as Map Style).
 * Owner-only Postgres RLS, private storage bucket for user-uploaded .json/.png LUTs.
 * No server keys. Built-in palettes stay available offline via weather/palettes.js.
 */
(function(g){
'use strict';
const W=g.WXWeatherPaletteCloud={bucket:'wx-studio-weather-palettes'};
const cfg=()=>g.WX_CLOUD_CONFIG||{};
const root=()=>String(cfg().url||'').replace(/\/+$/,'');
const auth=async()=>{
 const session=await g.WXCloudPresets?.ensureSession?.();
 if(!session?.user?.id||!session.access_token)throw Error('Sign in via Map Style → Saved Styles to save weather palettes.');
 return session;
};
const headers=(s,extra={})=>({'apikey':cfg().publishableKey,'Authorization':'Bearer '+s.access_token,...extra});
W.list=async(category)=>{
 const s=await auth();
 const where='user_id=eq.'+encodeURIComponent(s.user.id)+(category?'&category=eq.'+encodeURIComponent(category):'');
 const r=await fetch(root()+'/rest/v1/wx_studio_weather_palettes?'+where+'&order=name.asc',{headers:headers(s)});
 if(!r.ok)throw Error('Palette list failed: HTTP '+r.status);
 return r.json();
};
W.save=async({category,productId,name,stops,units='',description='',id=null})=>{
 const s=await auth();
 const datum={id:category+'/'+(productId||'custom').replace(/[^a-z0-9_-]/g,'-'),category,stops};
 g.WXWeatherPalettes.validate(datum);
 const body={user_id:s.user.id,category,product_id:productId,name:String(name||'My palette').slice(0,120),stops,units,description};
 const h=headers(s,{'Content-Type':'application/json','Prefer':'return=representation'});
 const endpoint=id?'/rest/v1/wx_studio_weather_palettes?id=eq.'+encodeURIComponent(id):'/rest/v1/wx_studio_weather_palettes';
 const r=await fetch(root()+endpoint,{method:id?'PATCH':'POST',headers:h,body:JSON.stringify(body)});
 if(!r.ok)throw Error('Palette save failed: HTTP '+r.status);
 return (await r.json())[0];
};
W.remove=async(id)=>{
 const s=await auth();
 const r=await fetch(root()+'/rest/v1/wx_studio_weather_palettes?id=eq.'+encodeURIComponent(id),{method:'DELETE',headers:headers(s)});
 if(!r.ok)throw Error('Palette delete failed: HTTP '+r.status);
};
W.uploadLut=async({category,productId,filename,blob})=>{
 const s=await auth();
 if(!['radar','satellite','rtma','models','custom'].includes(category))throw Error('Invalid category');
 if(!/^[a-z0-9_-]{1,90}$/i.test(productId))throw Error('Invalid product ID');
 if(!/^[a-z0-9_.-]{1,90}$/i.test(filename)||!/(\.json|\.png)$/i.test(filename))throw Error('Only .json or .png LUT files allowed');
 if(!blob||blob.size>2097152)throw Error('Palette LUT max size 2MB');
 const mime=filename.toLowerCase().endsWith('.png')?'image/png':'application/json';
 const key=[s.user.id,category,productId,filename].join('/');
 const r=await fetch(root()+'/storage/v1/object/'+W.bucket+'/'+key,{method:'POST',
  headers:headers(s,{'Content-Type':mime,'x-upsert':'true'}),body:blob});
 if(!r.ok)throw Error('LUT upload failed: HTTP '+r.status);
 return key;
};
W.downloadLut=async(key)=>{
 const s=await auth();
 if(!key.startsWith(s.user.id+'/'))throw Error('Access limited to your own LUTs');
 const r=await fetch(root()+'/storage/v1/object/authenticated/'+W.bucket+'/'+key,{headers:headers(s)});
 if(!r.ok)throw Error('LUT download failed: HTTP '+r.status);
 return r.blob();
};
})(typeof window!=='undefined'?window:globalThis);
