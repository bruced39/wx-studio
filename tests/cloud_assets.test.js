// Run: node --test tests/cloud_assets.test.js
// Uses only Node's built-in test runner; no real user credentials or network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('private PNG cloud upload, listing, download, overwrite, rename and delete', async () => {
  const source=fs.readFileSync(path.join(__dirname,'../studio/cloud_assets.js'),'utf8');
  const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const assetId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const rowId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const host='https://test.supabase.co';
  const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,
                            0,0,0,2,0,0,0,3,8,6,0,0,0]);
  const original='data:image/png;base64,'+Buffer.from(png).toString('base64');
  const uploaded=new Map(),rows=[],calls=[];
  function resp(value,status=200){
    return {ok:status<400,status,
      async text(){return value==null?'':JSON.stringify(value)},
      async arrayBuffer(){
        if(!(value instanceof Uint8Array))return new ArrayBuffer(0);
        return value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength);
      }};
  }
  async function fetchMock(url,opts={}){
    const target=url.slice(host.length),verb=opts.method||'GET';
    assert.equal(opts.headers?.Authorization,'Bearer sample-access-token');
    calls.push([verb,target]);
    if(target.startsWith('/rest/v1/wx_studio_assets?select='))return resp(rows);
    if(target==='/rest/v1/wx_studio_assets'&&verb==='POST'){
      const row={id:rowId,...JSON.parse(opts.body)};rows.push(row);return resp([row],201);
    }
    if(target.startsWith('/rest/v1/wx_studio_assets?id=')&&verb==='PATCH'){
      Object.assign(rows[0],JSON.parse(opts.body));return resp([rows[0]]);
    }
    if(target.startsWith('/rest/v1/wx_studio_assets?id=')&&verb==='DELETE'){
      rows.length=0;return resp(null,204);
    }
    if(target.startsWith('/storage/v1/object/sign/')&&verb==='POST')
      return resp({signedURL:'/object/sign/wx-studio-banners/'+owner+'/banner/'+assetId+'.png?token=temporary'});
    if(target.startsWith('/storage/v1/object/authenticated/')&&verb==='GET'){
      const value=uploaded.get(target.replace('/storage/v1/object/authenticated/','/storage/v1/object/'));
      return resp(value||{error:'Not found'},value?200:404);
    }
    if(target.startsWith('/storage/v1/object/')){
      if(verb==='POST'){assert.equal(opts.headers['Content-Type'],'image/png');uploaded.set(target,opts.body);return resp({Key:target});}
      if(verb==='DELETE'){uploaded.delete(target);return resp({},200);}
    }
    return resp({message:'Unexpected endpoint '+target},404);
  }
  const browser={WX_CLOUD_CONFIG:{url:host,publishableKey:'sb_publishable_test'},
    WXCloudPresets:{configured:()=>true,ensureSession:async()=>({access_token:'sample-access-token',user:{id:owner}})},
    crypto:{randomUUID:()=>assetId}};
  vm.runInNewContext(source,{window:browser,fetch:fetchMock,atob,btoa,Uint8Array,DataView,console});
  const api=browser.WXCloudAssets;
  assert.deepEqual([api.dataUriToBytes(original).width,api.dataUriToBytes(original).height],[2,3]);
  const saved=await api.save({name:'Forecast Banner',kind:'banner',data:original});
  assert.equal(saved.storage_path,owner+'/banner/'+assetId+'.png');
  assert.equal(saved.width,2);
  assert.equal(saved.height,3);
  assert.equal((await api.list('banner')).length,1);
  const thumb=await api.signedThumbnail(saved);
  assert.ok(thumb.startsWith(host+'/storage/v1/object/sign/'));
  assert.equal(await api.download(saved),original,'PNG bytes must remain identical');
  await api.rename(saved,'Evening Forecast');
  assert.equal(rows[0].name,'Evening Forecast');
  await api.save({name:'Evening Forecast',kind:'banner',data:original});
  assert.equal(rows.length,1,'same-name upsert should not duplicate records');
  await assert.rejects(api.download({kind:'banner',storage_path:'ffffffff-ffff-ffff-ffff-ffffffffffff/banner/'+assetId+'.png'}),/belong/);
  assert.throws(()=>api.dataUriToBytes('data:image/jpeg;base64,'+Buffer.from('no').toString('base64')),/PNG/);
  assert.throws(()=>api.dataUriToBytes('data:image/png;base64,'+Buffer.from('not a png').toString('base64')),/PNG/);
  await api.remove(rows[0]);
  assert.equal(rows.length,0);
  assert.equal(uploaded.size,0);
  assert.ok(calls.some(([verb,url])=>verb==='DELETE'&&url.startsWith('/storage/v1/object/')));
});
