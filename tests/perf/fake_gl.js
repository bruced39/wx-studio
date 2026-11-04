(function(){
  const W=1920,H=1080;
  window.WX_MAPBOX_TOKEN=window.WX_MAPBOX_TOKEN||'pk.eyJ1IjoidGVzdCJ9.FAKETESTTOKENabcd';
  window.__maps=[];window.__ev=[];window.__tiles={a:{state:'loaded'},b:{state:'loaded'},c:{state:'loaded'},d:{state:'loaded'}};
  const cache={_tiles:window.__tiles,_removeTile(k){delete this._tiles[k];},update(){for(const k of ['a','b','c','d']){if(!this._tiles[k])this._tiles[k]={state:'loaded'};}window.__paint();}};
  window.__listeners={};
  window.__paint=function(){const m=window.__map;if(!m)return;const c=m.__canvas.getContext('2d');c.fillStyle='#2a6a3a';c.fillRect(0,0,W,H);m.__renders=(m.__renders||0)+1;(window.__listeners.render||[]).slice().forEach(f=>f());};
  const mx=lng=>(180+lng)/360,my=lat=>(180-(180/Math.PI)*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360)))/360;
  class LngLat{constructor(a,b){this.lng=a;this.lat=b;}}
  class Map{
    constructor(o){
      this.__canvas=document.createElement('canvas');this.__canvas.width=W;this.__canvas.height=H;
      this.style={_sourceCaches:{'mapbox-satellite':cache}};this.__ls={};this.__loaded=false;this.__o=o;this.__isD=!!(o&&typeof o.style==='string');
      const c=o.center||[0,0];this.__st={c:[c.lng!==undefined?c.lng:c[0],c.lat!==undefined?c.lat:c[1]],z:o.zoom==null?1:o.zoom,b:o.bearing||0,p:o.pitch||0};
      this.__vw=(o.container&&o.container.clientWidth)||1280;this.__vh=(o.container&&o.container.clientHeight)||720;
      this.__proj=(o.projection&&o.projection.name)||o.projection||'mercator';
      window.__maps.push(this);window.__ev.push({t:'new',d:this.__isD});
      if(this.__isD){window.__map=this;o.container.appendChild(this.__canvas);setTimeout(()=>{this.__loaded=true;(this.__ls.load||[]).forEach(f=>f());window.__paint();},20);}
      const self=this;
      this.transform={clone(){const t={zoom:0,pitch:0,bearing:0,center:null,locationPoint(ll){return self.__pt(ll.lng,ll.lat,[t.center.lng,t.center.lat],t.zoom,t.bearing);}};return t;}};
    }
    __pt(lng,lat,c,z,b){const world=512*2**z,ang=-b*Math.PI/180,dx=(mx(lng)-mx(c[0]))*world,dy=(my(lat)-my(c[1]))*world;
      return {x:this.__vw/2+dx*Math.cos(ang)-dy*Math.sin(ang),y:this.__vh/2+dx*Math.sin(ang)+dy*Math.cos(ang)};}
    __un(x,y){const s=this.__st,world=512*2**s.z,ang=-s.b*Math.PI/180,u=x-this.__vw/2,v=y-this.__vh/2,dx=u*Math.cos(ang)+v*Math.sin(ang),dy=-u*Math.sin(ang)+v*Math.cos(ang);
      const X=mx(s.c[0])+dx/world,Y=my(s.c[1])+dy/world;return {lng:X*360-180,lat:Math.atan(Math.sinh(Math.PI*(1-2*Y)))*180/Math.PI};}
    on(ev,fn){(this.__ls[ev]=this.__ls[ev]||[]).push(fn);if(this.__isD){(window.__listeners[ev]=window.__listeners[ev]||[]).push(fn);}return this;}
    once(ev,fn){const w=(...a)=>{this.off(ev,w);fn(...a)};this.on(ev,w);if(ev==='style.load')setTimeout(()=>{(this.__ls['style.load']||[]).slice().forEach(f=>f());},window.__styleDelay||10);return this;}
    off(ev,fn){for(const t of [this.__ls,window.__listeners]){if(t[ev])t[ev]=t[ev].filter(f=>f!==fn);}return this;}
    getCanvas(){return this.__canvas;} loaded(){return this.__loaded&&!window.__slow&&performance.now()>=(this.__readyAt||0);} isMoving(){return false;}
    jumpTo(o){const s=this.__st;if(o.center){s.c=[o.center.lng!==undefined?o.center.lng:o.center[0],o.center.lat!==undefined?o.center.lat:o.center[1]];}
      if(o.zoom!=null)s.z=o.zoom;if(o.bearing!=null)s.b=o.bearing;if(o.pitch!=null)s.p=o.pitch;window.__jumps=(window.__jumps||0)+1;this.__readyAt=performance.now()+(window.__tileDelay||0);}
    triggerRepaint(){setTimeout(()=>window.__paint(),0);} resize(){} remove(){window.__ev.push({t:'remove',d:this.__isD});}
    getSource(){return undefined;} getLayer(){return undefined;} getStyle(){return {layers:[],sources:{}};}
    setStyle(){window.__setStyleCalls=(window.__setStyleCalls||0)+1;this.__readyAt=performance.now()+(window.__tileDelay||0);setTimeout(()=>{(this.__ls['style.load']||[]).slice().forEach(f=>f());},window.__styleDelay||5);}
    setProjection(p){this.__proj=(p&&p.name)||p;} getProjection(){return {name:this.__proj};} setFog(){} setTerrain(){}
    addSource(){} addLayer(){} removeLayer(){} removeSource(){} setPaintProperty(){} setLayoutProperty(){} setFilter(){} setPadding(){}
    getCenter(){return new LngLat(this.__st.c[0],this.__st.c[1]);} getZoom(){return this.__st.z;} getBearing(){return this.__st.b;} getPitch(){return this.__st.p;}
    project(a){window.__projectCalls=(window.__projectCalls||0)+1;const s=this.__st,l=Array.isArray(a)?{lng:a[0],lat:a[1]}:a;return this.__pt(l.lng,l.lat,s.c,s.z,s.b);}
    unproject(a){const p=Array.isArray(a)?{x:a[0],y:a[1]}:a;return this.__un(p.x,p.y);}
    panBy(o){const s=this.__st,q=this.__un(this.__vw/2+o[0],this.__vh/2+o[1]);s.c=[q.lng,q.lat];}
    areTilesLoaded(){return true;} queryRenderedFeatures(){return [];} querySourceFeatures(){return [];}
    get painter(){return {context:{gl:{VERSION:1,MAX_TEXTURE_SIZE:2,getParameter:(p)=>p===1?'WebGL 2.0 (fake)':16384,getExtension:()=>null,isContextLost:()=>false}}};}
  }
  window.mapboxgl={Map,LngLat,version:'3.9.0-fake',accessToken:''};
  window.__fireIdle=function(){(window.__listeners.idle||[]).slice().forEach(f=>f());};
})();
