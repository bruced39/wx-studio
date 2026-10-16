/* Private WX Studio asset cloud — uses the SAME account/session as cloud_presets.js.
   Only PUBLIC Supabase credentials in the iframe. Storage and metadata enforce
   owner isolation with Supabase RLS. PNG bytes are never re-encoded. */
(function(g){
 'use strict';
 const cfg=g.WX_CLOUD_CONFIG||{};
 const host=String(cfg.url||'').replace(/\/+$/,'');
 const apiKey=String(cfg.publishableKey||'');
 const bucket='wx-studio-banners';
 const limit=8*1024*1024;
 const kinds=['banner','graphic','background'];
 const authClient=()=>g.WXCloudPresets;
 const validKind=k=>kinds.includes(k);
 function fail(message){throw Error(message)}
 function parse(s){try{return JSON.parse(s)}catch(e){return null}}
 async function session(){
   if(!authClient()?.configured())fail('Cloud is not configured. Your local assets still work.');
   const s=await authClient().ensureSession();
   if(!s?.access_token||!s?.user?.id)fail('Sign in under Map Style → Saved Styles → Cloud Presets.');
   return s;
 }
 function headers(s,extras){return {apikey:apiKey,Authorization:'Bearer '+s.access_token,...extras}}
 async function request(path,options={},binary=false){
   const s=await session();
   let response;
   try{response=await fetch(host+path,{...options,headers:headers(s,options.headers||{})})}
   catch(e){fail('Cloud connection failed. Your local library is unchanged.')}
   if(!response.ok){
     const err=parse(await response.text().catch(()=>''))||{};
     fail(String(err.message||err.error||err.msg||'Cloud request failed (HTTP '+response.status+')'));
   }
   if(binary)return response.arrayBuffer();
   const txt=await response.text();
   return txt?parse(txt):null;
 }
 function dataUriToBytes(data){
   const match=/^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(data||''));
   if(!match)fail('Cloud assets must be PNG files; JPG/WebP files are not supported.');
   const encoded=match[1].replace(/\s/g,'');
   if(encoded.length>Math.ceil(limit/3)*4+8)fail('PNG exceeds the 8 MB cloud upload limit.');
   let decoded;
   try{decoded=atob(encoded)}catch(e){fail('PNG data is invalid or damaged.')}
   if(!decoded?.length||decoded.length>limit)fail('PNG must be smaller than 8 MB.');
   const bytes=new Uint8Array(decoded.length);
   for(let i=0;i<decoded.length;i++)bytes[i]=decoded.charCodeAt(i);
   const sig=[137,80,78,71,13,10,26,10];
   if(bytes.length<24||sig.some((b,i)=>bytes[i]!==b))fail('This file does not contain a valid PNG signature.');
   const dv=new DataView(bytes.buffer);
   const width=dv.getUint32(16),height=dv.getUint32(20);
   if(!width||!height||width>20000||height>20000)fail('PNG dimensions must be between 1 and 20,000 pixels.');
   return {bytes,width,height};
 }
 function bytesToDataUri(arrayBuffer){
   const bytes=new Uint8Array(arrayBuffer);
   if(!bytes.length||bytes.length>limit)fail('Downloaded PNG is too large or empty.');
   const sig=[137,80,78,71,13,10,26,10];
   if(bytes.length<24||sig.some((b,i)=>bytes[i]!==b))fail('Cloud file is not a valid PNG.');
   const parts=[];const chunk=0x8000;
   for(let i=0;i<bytes.length;i+=chunk)
     parts.push(String.fromCharCode.apply(null,bytes.subarray(i,i+chunk)));
   return 'data:image/png;base64,'+btoa(parts.join(''));
 }
 function validRecord(item){
   if(!item||!validKind(item.kind))fail('Invalid cloud asset type.');
   const name=String(item.name||'').trim();
   if(!name||name.length>100)fail('Asset name must be between 1 and 100 characters.');
   return name;
 }
 const safePath=path=>/^[0-9a-f-]{36}\/(banner|graphic|background)\/[0-9a-f-]{36}\.png$/i.test(String(path||''));
 const encodedPath=path=>String(path).split('/').map(encodeURIComponent).join('/');
 async function list(kind){
   if(!validKind(kind))fail('Invalid asset type.');
   const rows=await request('/rest/v1/wx_studio_assets?select=id,user_id,kind,name,storage_path,width,height,created_at,updated_at&kind=eq.'+kind+'&order=updated_at.desc&limit=500');
   return Array.isArray(rows)?rows:[];
 }
 async function save(item){
   const name=validRecord(item),kind=item.kind,s=await session();
   const image=dataUriToBytes(item.data);
   const all=await list(kind),old=all.find(r=>r.name===name);
   // Update an existing named asset in its original location, or use a
   // new random UUID path. No user input can affect the storage file path.
   const uuid=()=>{if(!g.crypto?.randomUUID)fail('Cloud uploads require a modern secure browser.');return g.crypto.randomUUID()};
   const path=old?.storage_path||s.user.id+'/'+kind+'/'+uuid()+'.png';
   if(!safePath(path)||!path.startsWith(s.user.id+'/'+kind+'/'))fail('Invalid cloud storage path.');
   await request('/storage/v1/object/'+bucket+'/'+encodedPath(path),{
     method:'POST',
     headers:{'Content-Type':'image/png','x-upsert':old?'true':'false'},
     body:image.bytes
   });
   const row={user_id:s.user.id,kind,name,storage_path:path,width:image.width,height:image.height,updated_at:new Date().toISOString()};
   try{
     const url='/rest/v1/wx_studio_assets'+(old?'?id=eq.'+encodeURIComponent(old.id):'');
     const result=await request(url,{
       method:old?'PATCH':'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},
       body:JSON.stringify(row)
     });
     return Array.isArray(result)?result[0]:result;
   }catch(e){
     if(!old){
       try{await request('/storage/v1/object/'+bucket+'/'+encodedPath(path),{method:'DELETE'})}catch(cleanupError){}
     }
     throw e;
   }
 }
 async function download(row){
   const s=await session();
   if(!validKind(row?.kind)||!safePath(row?.storage_path)||!row.storage_path.startsWith(s.user.id+'/'+row.kind+'/'))
     fail('The cloud file does not belong to this signed-in account.');
   const bytes=await request('/storage/v1/object/authenticated/'+bucket+'/'+encodedPath(row.storage_path),{},true);
   return bytesToDataUri(bytes);
 }
 async function signedThumbnail(row){
   const s=await session();
   if(!validKind(row?.kind)||!safePath(row?.storage_path)||!row.storage_path.startsWith(s.user.id+'/'+row.kind+'/'))
     fail('Invalid cloud thumbnail path.');
   const result=await request('/storage/v1/object/sign/'+bucket+'/'+encodedPath(row.storage_path),{
     method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:600})
   });
   const signed=result?.signedURL||result?.signedUrl||'';
   if(typeof signed!=='string'||!signed.startsWith('/object/sign/'))fail('Could not create a private thumbnail.');
   return host+'/storage/v1'+signed;
 }
 async function remove(row){
   const s=await session();
   if(!validKind(row?.kind)||!safePath(row?.storage_path)||!row.storage_path.startsWith(s.user.id+'/'+row.kind+'/'))
     fail('Invalid cloud asset.');
   if(!/^[0-9a-f-]{36}$/i.test(String(row.id||'')))fail('Invalid cloud record.');
   // File first; on a failed metadata deletion user can retry. Local stays.
   await request('/storage/v1/object/'+bucket+'/'+encodedPath(row.storage_path),{method:'DELETE'});
   await request('/rest/v1/wx_studio_assets?id=eq.'+encodeURIComponent(row.id),{
     method:'DELETE',headers:{Prefer:'return=minimal'}
   });
 }
 async function rename(row,newName){
   const s=await session(),name=validRecord({kind:row.kind,name:newName});
   if(!/^[0-9a-f-]{36}$/i.test(String(row?.id||'')))fail('Invalid cloud record.');
   if(!safePath(row.storage_path)||!row.storage_path.startsWith(s.user.id+'/'+row.kind+'/'))fail('Invalid cloud asset.');
   const result=await request('/rest/v1/wx_studio_assets?id=eq.'+encodeURIComponent(row.id),{
     method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=representation'},
     body:JSON.stringify({name,updated_at:new Date().toISOString()})
   });
   return Array.isArray(result)?result[0]:result;
 }
 g.WXCloudAssets=Object.freeze({configured:()=>!!authClient()?.configured(),
   session,list,save,download,signedThumbnail,remove,rename,dataUriToBytes,bytesToDataUri,
   maxBytes:limit});
})(typeof window!=='undefined'?window:globalThis);
