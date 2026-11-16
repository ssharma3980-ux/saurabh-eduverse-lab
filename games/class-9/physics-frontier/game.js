/* =========================================================================
   PHYSICS FRONTIER – THE OPEN WORLD OF SCIENCE   ·   Stage 1.5 (next-gen look)
   Three.js r128 · PBR materials · sky + image-based lighting · bloom + ACES
   Sections:
     1 core/save   2 renderer, sky, post-processing   3 textures
     4 world       5 characters (glTF, animated)      6 player car
     7 traffic + pedestrians   8 input   9 player + camera
     10 missions   11 UI       12 audio + effects      13 main loop
   ========================================================================= */
(function(){
'use strict';
const $=id=>document.getElementById(id);
if(!window.THREE||!THREE.GLTFLoader){$('err').style.display='flex';return;}

/* ========================= 1. CORE ========================= */
const G=9.8;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const fx=(v,n)=>Number(v).toFixed(n==null?1:n);
function rng(seed){return function(){seed=(seed*1664525+1013904223)%4294967296;return seed/4294967296;};}
const R=rng(11);
const angDiff=(a,b)=>{let d=(a-b)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return d;};
const coarse=!!(window.matchMedia&&matchMedia('(pointer:coarse)').matches);

const SAVE_KEY='physics_frontier_v1';
const save={xp:0,medals:{},ch:0,carMass:1200,carMu:0.8,quality:coarse?'medium':'high',sound:true,paint:0};
try{const s=JSON.parse(localStorage.getItem(SAVE_KEY));if(s&&typeof s==='object')Object.assign(save,s);}catch(e){}
if(!['high','medium','low'].includes(save.quality))save.quality='medium';
function persist(){try{localStorage.setItem(SAVE_KEY,JSON.stringify(save));}catch(e){}}

const S={ui:'menu',freeze:false,fixedCam:null,station:null,time:0,ready:false};
let M=null,driving=false;

// value noise for terrain and textures
const NP=[];for(let i=0;i<512;i++)NP.push(R());
function vnoise(x,y){const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  const h=(a,b)=>NP[((a*73856093)^(b*19349663))&511];
  const a=h(xi,yi),b=h(xi+1,yi),c=h(xi,yi+1),d=h(xi+1,yi+1);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;}
function fbm(x,y,o){let s=0,a=0.5,f=1;for(let i=0;i<(o||5);i++){s+=a*vnoise(x*f,y*f);f*=2.03;a*=0.5;}return s;}

/* ============ 2. RENDERER, SKY, LIGHT, POST-PROCESSING ============ */
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas:$('c'),antialias:true,powerPreference:'high-performance'});}
catch(e){$('err').style.display='flex';return;}
const QUAL={high:{pr:2,shadow:2048,post:true,peds:8,traffic:12},medium:{pr:1.5,shadow:1024,post:true,peds:5,traffic:9},low:{pr:1,shadow:0,post:false,peds:3,traffic:6}};
const canPost=renderer.capabilities.isWebGL2&&(renderer.extensions.has('EXT_color_buffer_float')||renderer.extensions.has('EXT_color_buffer_half_float'));
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const EXPOSURE=0.54;

const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(62,1,0.3,2200);

// sun direction: late-afternoon "golden hour"
const SUN_EL=24*Math.PI/180,SUN_AZ=215*Math.PI/180;
const sunDir=new THREE.Vector3(Math.cos(SUN_EL)*Math.sin(SUN_AZ),Math.sin(SUN_EL),Math.cos(SUN_EL)*Math.cos(SUN_AZ)).normalize();
function makeSky(){const s=new THREE.Sky();s.scale.setScalar(10000);const u=s.material.uniforms;
  u.turbidity.value=3.2;u.rayleigh.value=2.2;u.mieCoefficient.value=0.004;u.mieDirectionalG.value=0.82;u.sunPosition.value.copy(sunDir);return s;}
scene.add(makeSky());
// image-based lighting: bake the sky (plus a ground bounce) into an environment map
(function(){
  const es=new THREE.Scene();es.add(makeSky());
  const g=new THREE.Mesh(new THREE.CircleGeometry(5000,24),new THREE.MeshBasicMaterial({color:new THREE.Color(0.09,0.1,0.075)}));
  g.rotation.x=-Math.PI/2;g.position.y=-8;es.add(g);
  const pm=new THREE.PMREMGenerator(renderer);scene.environment=pm.fromScene(es,0.02).texture;pm.dispose();
})();
scene.fog=new THREE.FogExp2(new THREE.Color(0.55,0.63,0.74),0.0013);

const sun=new THREE.DirectionalLight(0xffe2b8,2.6);sun.castShadow=true;
sun.shadow.bias=-0.0004;sun.shadow.normalBias=0.03;
const sc=sun.shadow.camera;sc.left=-65;sc.right=65;sc.top=65;sc.bottom=-65;sc.near=10;sc.far=420;
scene.add(sun,sun.target);
scene.add(new THREE.HemisphereLight(0x9fc4ff,0x3a3428,0.25));

// post-processing chain: scene (HDR) → bloom → ACES tone map + grade + vignette + sRGB
const GradeShader={uniforms:{tDiffuse:{value:null},exposure:{value:EXPOSURE},vig:{value:0.32}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:[
  'uniform sampler2D tDiffuse;uniform float exposure;uniform float vig;varying vec2 vUv;',
  'vec3 RRTAndODTFit(vec3 v){vec3 a=v*(v+0.0245786)-0.000090537;vec3 b=v*(0.983729*v+0.4329510)+0.238081;return a/b;}',
  'vec3 aces(vec3 c){const mat3 I=mat3(0.59719,0.07600,0.02840,0.35458,0.90834,0.13383,0.04823,0.01566,0.83777);',
  ' const mat3 O=mat3(1.60475,-0.10208,-0.00327,-0.53108,1.10813,-0.07276,-0.07367,-0.00605,1.07602);',
  ' c*=exposure/0.6;c=I*c;c=RRTAndODTFit(c);c=O*c;return clamp(c,0.0,1.0);}',
  'void main(){vec3 c=texture2D(tDiffuse,vUv).rgb;c=aces(c);',
  ' float l=dot(c,vec3(0.2126,0.7152,0.0722));c=mix(vec3(l),c,1.2);c=mix(c,c*c*(3.0-2.0*c),0.22);',      // saturation
  ' c=mix(c,c*vec3(1.04,1.0,0.95),0.6);',                                   // warm grade
  ' vec2 d=vUv-0.5;c*=1.0-vig*dot(d,d)*2.2;',                               // vignette
  ' c=pow(c,vec3(1.0/2.2));gl_FragColor=vec4(c,1.0);}'].join('\n')};
let composer=null,bloom=null,usePost=false;
function setupRenderer(){
  const q=QUAL[save.quality];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,q.pr));
  usePost=q.post&&canPost;
  renderer.toneMapping=usePost?THREE.NoToneMapping:THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=EXPOSURE;
  renderer.outputEncoding=usePost?THREE.LinearEncoding:THREE.sRGBEncoding;
  sun.castShadow=q.shadow>0;
  if(q.shadow&&sun.shadow.mapSize.x!==q.shadow){sun.shadow.mapSize.set(q.shadow,q.shadow);if(sun.shadow.map){sun.shadow.map.dispose();sun.shadow.map=null;}}
  if(usePost&&!composer){
    const w=innerWidth,h=innerHeight;
    const rt=new THREE.WebGLMultisampleRenderTarget(w,h,{type:THREE.HalfFloatType,format:THREE.RGBAFormat});
    composer=new THREE.EffectComposer(renderer,rt);
    composer.addPass(new THREE.RenderPass(scene,camera));
    bloom=new THREE.UnrealBloomPass(new THREE.Vector2(w,h),0.42,0.55,0.92);composer.addPass(bloom);
    composer.addPass(new THREE.ShaderPass(GradeShader));
  }
  scene.traverse(o=>{if(o.material){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.needsUpdate=true);}});
  resize();
}
function resize(){const w=innerWidth,h=innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
  if(composer){composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(w,h);}}
window.addEventListener('resize',resize);

/* ========================= 3. TEXTURES ========================= */
const ANISO=Math.min(8,renderer.capabilities.getMaxAnisotropy());
function canvasTex(w,h,draw,srgb){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=ANISO;if(srgb!==false)t.encoding=THREE.sRGBEncoding;return t;}
function speckle(x,w,h,n,cols,sz){for(let i=0;i<n;i++){x.fillStyle=cols[(R()*cols.length)|0];const s=(sz||1.5)*(0.5+R());x.fillRect(R()*w,R()*h,s,s);}}
// one texture packs roughness (G) and metalness (B) the way three.js reads them
const rm=(r,m)=>'rgb(0,'+Math.round(r*255)+','+Math.round(m*255)+')';

const TX={};
// asphalt road: 12 m wide, 24 m per repeat
(function(){
  const puddles=[];for(let i=0;i<3;i++)puddles.push([50+R()*156,R()*512,8+R()*14,18+R()*30]);
  const lines=(x,w,h,col,isRM)=>{x.fillStyle=col;x.fillRect(w*0.04,0,4,h);x.fillRect(w*0.96-4,0,4,h);
    for(let y=0;y<h;y+=128){x.fillRect(w/2-3,y+10,6,64);}};
  TX.road=canvasTex(256,512,(x,w,h)=>{x.fillStyle='#3a3c40';x.fillRect(0,0,w,h);
    speckle(x,w,h,9000,['#45474c','#303236','#4c4e52','#2a2c30'],2);
    x.globalAlpha=0.25;for(let i=0;i<6;i++){x.fillStyle='#202226';x.fillRect(w*0.2+R()*w*0.1,0,10+R()*16,h);x.fillRect(w*0.7+R()*w*0.1,0,10+R()*16,h);}
    x.globalAlpha=1;puddles.forEach(p=>{x.fillStyle='rgba(24,26,30,.5)';x.beginPath();x.ellipse(p[0],p[1],p[2],p[3],0,0,7);x.fill();});
    lines(x,w,h,'#e9e6dc');});
  TX.roadRM=canvasTex(256,512,(x,w,h)=>{x.fillStyle=rm(0.82,0);x.fillRect(0,0,w,h);speckle(x,w,h,3000,[rm(0.7,0),rm(0.92,0)],3);
    puddles.forEach(p=>{const g=x.createRadialGradient(p[0],p[1],0,p[0],p[1],Math.max(p[2],p[3]));g.addColorStop(0,rm(0.22,0));g.addColorStop(0.7,rm(0.4,0));g.addColorStop(1,rm(0.82,0));
      x.fillStyle=g;x.beginPath();x.ellipse(p[0],p[1],p[2],p[3],0,0,7);x.fill();});lines(x,w,h,rm(0.55,0));},false);
  TX.junction=canvasTex(256,256,(x,w,h)=>{x.fillStyle='#3a3c40';x.fillRect(0,0,w,h);speckle(x,w,h,4500,['#45474c','#303236','#4c4e52'],2);});
  TX.zebra=canvasTex(256,64,(x,w,h)=>{x.fillStyle='#3a3c40';x.fillRect(0,0,w,h);speckle(x,w,h,1500,['#45474c','#303236'],2);
    x.fillStyle='#ecebe4';for(let i=0;i<8;i++)x.fillRect(8+i*31,6,18,52);});
  TX.walk=canvasTex(256,256,(x,w,h)=>{x.fillStyle='#a9a7a1';x.fillRect(0,0,w,h);speckle(x,w,h,6000,['#b4b2ac','#9d9b95','#c0beb8'],2);
    x.strokeStyle='#8a8882';x.lineWidth=2;for(let i=0;i<=4;i++){x.beginPath();x.moveTo(i*64,0);x.lineTo(i*64,h);x.stroke();x.beginPath();x.moveTo(0,i*64);x.lineTo(w,i*64);x.stroke();}});
  TX.grass=canvasTex(256,256,(x,w,h)=>{x.fillStyle='#4f7a34';x.fillRect(0,0,w,h);
    for(let i=0;i<40;i++){x.fillStyle=R()>.5?'rgba(96,130,55,.35)':'rgba(58,88,36,.35)';x.beginPath();x.arc(R()*w,R()*h,10+R()*30,0,7);x.fill();}
    speckle(x,w,h,9000,['#5c8a3c','#466d2e','#6a9645','#3e6229'],2);});
  TX.sand=canvasTex(256,256,(x,w,h)=>{x.fillStyle='#bfae84';x.fillRect(0,0,w,h);speckle(x,w,h,9000,['#c9b98f','#b09e74','#d2c39b'],2);});
  TX.roof=canvasTex(128,128,(x,w,h)=>{x.fillStyle='#6b6d70';x.fillRect(0,0,w,h);speckle(x,w,h,3000,['#77797c','#5f6164','#838588'],2);});
})();
// building facades: 4 bays × 4 floors per repeat (16 m × 14 m)
function facade(style){
  const W=512,H=512,bw=W/4,fh=H/4,lit=[];for(let i=0;i<16;i++)lit.push(R()<0.18);
  const draw=(x,mode)=>{
    for(let fy=0;fy<4;fy++)for(let bx=0;bx<4;bx++){
      const X=bx*bw,Y=fy*fh,k=fy*4+bx,on=lit[k];
      if(style.glass){
        x.fillStyle=mode==='rm'?rm(0.06,0.9):mode==='em'?(on?'#3a2a14':'#000'):style.glass;x.fillRect(X,Y,bw,fh);
        if(mode==='map'){const g=x.createLinearGradient(X,Y,X+bw,Y+fh);g.addColorStop(0,'rgba(255,255,255,.07)');g.addColorStop(1,'rgba(0,0,0,.12)');x.fillStyle=g;x.fillRect(X,Y,bw,fh);}
        x.fillStyle=mode==='rm'?rm(0.4,0.8):mode==='em'?'#000':style.frame;x.fillRect(X,Y,bw,5);x.fillRect(X,Y,4,fh);x.fillRect(X,Y+fh*0.5,bw,2);
      }else{
        x.fillStyle=mode==='rm'?rm(style.wr||0.85,0):mode==='em'?'#000':style.wall;x.fillRect(X,Y,bw,fh);
        if(mode==='map'){speckle(x,bw,fh,0);x.save();x.translate(X,Y);speckle(x,bw,fh,260,style.spk||['rgba(0,0,0,.06)','rgba(255,255,255,.05)'],2);x.restore();}
        const wx=X+bw*(style.ww?0.5-style.ww/2:0.18),ww=bw*(style.ww||0.64),wy=Y+fh*(style.wy||0.2),wh=fh*(style.wh||0.58);
        if(mode==='map'){x.fillStyle=style.frame;x.fillRect(wx-4,wy-4,ww+8,wh+8);}
        x.fillStyle=mode==='rm'?rm(0.05,0.85):mode==='em'?(on?'#ffcf8a':'#000'):(on?'#e8c58e':style.win);x.fillRect(wx,wy,ww,wh);
        if(mode==='map'&&!on&&R()<0.4){x.fillStyle='rgba(230,225,210,.55)';x.fillRect(wx,wy,ww,wh*(0.2+R()*0.5));}   // blinds
        if(mode==='map'){x.fillStyle=style.frame;x.fillRect(wx+ww/2-1.5,wy,3,wh);x.fillStyle='rgba(0,0,0,.25)';x.fillRect(wx-4,wy+wh+4,ww+8,4);}
        if(mode==='rm'){x.fillStyle=rm(0.5,0.2);x.fillRect(wx+ww/2-1.5,wy,3,wh);}
      }
    }};
  const map=canvasTex(W,H,x=>draw(x,'map'));const rmT=canvasTex(W,H,x=>draw(x,'rm'),false);const em=canvasTex(W,H,x=>draw(x,'em'));
  return new THREE.MeshStandardMaterial({map,roughnessMap:rmT,metalnessMap:rmT,roughness:1,metalness:1,emissiveMap:em,emissive:0xffffff,emissiveIntensity:0.55,envMapIntensity:1.0});
}
const FACADES=[
  facade({glass:'#2d5a73',frame:'#b8c2cc'}),
  facade({glass:'#3d4e5c',frame:'#2a2f35'}),
  facade({wall:'#c9c4b8',win:'#2c3e52',frame:'#e8e4da',ww:0.86,wy:0.3,wh:0.42}),
  facade({wall:'#8f4b38',win:'#24313f',frame:'#e6dfd2',spk:['rgba(0,0,0,.12)','rgba(255,220,200,.08)'],wr:0.92}),
  facade({wall:'#d8cdb4',win:'#33475b',frame:'#a69a80',ww:0.4,wy:0.12,wh:0.72}),
  facade({wall:'#3b3f45',win:'#1d2a36',frame:'#8c9299',ww:0.7,wy:0.16,wh:0.66})];
TX.shop=canvasTex(512,128,(x,w,h)=>{
  const cols=['#d9482f','#1f7fa8','#2f9d5a','#e0a21b'];
  for(let i=0;i<4;i++){const X=i*128;x.fillStyle='#2b2e33';x.fillRect(X,0,128,h);x.fillStyle=cols[i];x.fillRect(X+4,8,120,26);
    x.fillStyle='rgba(255,255,255,.85)';x.fillRect(X+22,17,84,8);
    x.fillStyle='#1a2733';x.fillRect(X+8,44,112,78);x.fillStyle='#d9b77c';x.fillRect(X+14,74,40,48);x.fillStyle='rgba(255,255,255,.08)';x.fillRect(X+8,44,112,30);
    x.fillStyle='#5a5f66';x.fillRect(X+62,44,4,78);}
});
TX.shopRM=canvasTex(512,128,(x,w,h)=>{x.fillStyle=rm(0.6,0.3);x.fillRect(0,0,w,h);for(let i=0;i<4;i++){x.fillStyle=rm(0.05,0.8);x.fillRect(i*128+8,44,112,78);}},false);
TX.shopEm=canvasTex(512,128,(x,w,h)=>{x.fillStyle='#000';x.fillRect(0,0,w,h);const cols=['#ff6a4a','#4ac8ff','#5aff94','#ffd04a'];
  for(let i=0;i<4;i++){x.fillStyle=cols[i];x.fillRect(i*128+4,8,120,26);x.fillStyle='#4a3a20';x.fillRect(i*128+8,44,112,78);}});
TX.smoke=canvasTex(64,64,(x,w,h)=>{const g=x.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'rgba(235,235,235,.9)');g.addColorStop(1,'rgba(235,235,235,0)');x.fillStyle=g;x.fillRect(0,0,64,64);});

/* ========================= 4. WORLD =========================
   To add a region: build meshes, then addCollider(x,z,w,d,h) for solids. */
const std=(c,o)=>new THREE.MeshStandardMaterial(Object.assign({color:c,roughness:0.8,metalness:0},o||{}));
const mat=std;
function box(w,h,d,m,x,y,z,par,sh){const me=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);me.position.set(x,y,z);if(sh!==false){me.castShadow=true;me.receiveShadow=true;}(par||scene).add(me);return me;}
function cyl(rt,rb,h,m,x,y,z,par,seg){const me=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg||20),m);me.position.set(x,y,z);me.castShadow=true;me.receiveShadow=true;(par||scene).add(me);return me;}
function label(text,color,size){
  const c=document.createElement('canvas');c.width=512;c.height=128;const x=c.getContext('2d');
  x.fillStyle='rgba(8,16,28,.82)';x.fillRect(0,14,512,100);x.fillStyle=color;x.fillRect(0,14,10,100);
  x.font='bold 46px system-ui,sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillStyle='#fff';x.fillText(text,261,66,480);
  const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,depthTest:false,transparent:true,fog:false,toneMapped:false}));
  s.scale.set(size*4,size,1);s.renderOrder=5;return s;
}
const merge=geos=>THREE.BufferGeometryUtils.mergeBufferGeometries(geos.map(g=>g.index?g.toNonIndexed():g));
function placed(g,x,y,z,ry,rx){if(rx)g.rotateX(rx);if(ry)g.rotateY(ry);g.translate(x,y,z);return g;}
function scaleUV(g,su,sv){const uv=g.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*su,uv.getY(i)*sv);return g;}
function meshOf(geo,m,shadow){const me=new THREE.Mesh(geo,m);me.receiveShadow=true;if(shadow!==false)me.castShadow=true;scene.add(me);return me;}

const colliders=[],mmRoads=[],mmBuild=[];
function addCollider(x,z,w,d,h){colliders.push({a:x-w/2,b:x+w/2,c:z-d/2,d:z+d/2,h:h||40});}
function resolve(p,r){
  let hit=false;
  for(let i=0;i<colliders.length;i++){const c=colliders[i];
    const nx=clamp(p.x,c.a,c.b),nz=clamp(p.z,c.c,c.d);const dx=p.x-nx,dz=p.z-nz,d2=dx*dx+dz*dz;
    if(d2>=r*r)continue;hit=true;
    if(d2>1e-8){const d=Math.sqrt(d2),k=(r-d)/d;p.x+=dx*k;p.z+=dz*k;}
    else{const l=p.x-c.a,rr=c.b-p.x,t=p.z-c.c,b=c.d-p.z,m=Math.min(l,rr,t,b);
      if(m===l)p.x=c.a-r;else if(m===rr)p.x=c.b+r;else if(m===t)p.z=c.c-r;else p.z=c.d+r;}
  }
  return hit;
}
const WORLD=298,GRID=[-120,-60,0,60,120];
const TREES=[],LAMPS=[];

(function buildWorld(){
  // terrain ground
  const gm=std(0xffffff,{map:TX.grass,roughness:0.95});TX.grass.repeat.set(220,220);
  const gnd=new THREE.Mesh(new THREE.PlaneGeometry(2200,2200),gm);gnd.rotation.x=-Math.PI/2;gnd.receiveShadow=true;scene.add(gnd);

  // roads (merged): straight segments between junctions
  const roadM=std(0xffffff,{map:TX.road,roughnessMap:TX.roadRM,roughness:1,envMapIntensity:0.7,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  const rgs=[],jgs=[],zgs=[];
  function road(x1,z1,x2,z2){const len=Math.hypot(x2-x1,z2-z1),g=scaleUV(new THREE.PlaneGeometry(12,len),1,len/24);
    g.rotateX(-Math.PI/2);if(Math.abs(x2-x1)>Math.abs(z2-z1))g.rotateY(Math.PI/2);g.translate((x1+x2)/2,0.02,(z1+z2)/2);rgs.push(g);mmRoads.push([x1,z1,x2,z2,12]);}
  GRID.forEach(v=>{for(let k=0;k<4;k++){road(v,GRID[k]+6,v,GRID[k+1]-6);road(GRID[k]+6,v,GRID[k+1]-6,v);}
    road(v,-130,v,-126);road(v,126,v,130);road(-130,v,-126,v);road(126,v,130,v);});
  road(0,-196,0,-132);road(-112,-190,-6,-190);road(6,-190,10,-190);
  road(132,0,200,0);road(0,132,0,200);
  GRID.forEach(a=>GRID.forEach(b=>{
    const j=new THREE.PlaneGeometry(12,12);j.rotateX(-Math.PI/2);j.translate(a,0.025,b);jgs.push(j);
    [[0,7.6,0],[0,-7.6,0],[7.6,0,1],[-7.6,0,1]].forEach(o=>{const z=new THREE.PlaneGeometry(12,3);z.rotateX(-Math.PI/2);if(o[2])z.rotateY(Math.PI/2);z.translate(a+o[0],0.03,b+o[1]);zgs.push(z);});
  }));
  [[0,-190],[0,0]].forEach(p=>{const j=new THREE.PlaneGeometry(12,12);j.rotateX(-Math.PI/2);j.translate(p[0],0.025,p[1]);jgs.push(j);});
  meshOf(merge(rgs),roadM,false);
  meshOf(merge(jgs),std(0xffffff,{map:TX.junction,roughness:0.82,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3}),false);
  meshOf(merge(zgs),std(0xffffff,{map:TX.zebra,roughness:0.7,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4}),false);
  mmRoads.push([0,-130,0,130,12],[-130,0,130,0,12]);

  // city blocks: sidewalks, buildings, storefronts, roofs
  const centers=[-90,-30,30,90],byStyle=FACADES.map(()=>[]),roofs=[],shops=[],walks=[],parks=[],units=[];
  centers.forEach(bx=>centers.forEach(bz=>{
    const park=(bx===-30&&bz===30);
    const w=scaleUV(new THREE.BoxGeometry(48,0.16,48),12,12);w.translate(bx,0.08,bz);walks.push(w);
    if(park)return;
    [-11.5,11.5].forEach(ox=>[-11.5,11.5].forEach(oz=>{
      const w=14+R()*5,d=14+R()*5,dist=Math.hypot(bx,bz);
      const h=Math.max(12,Math.round((62-dist*0.34+R()*34-(R()>.8?22:0))/3.5)*3.5);
      const st=dist<60?(R()<0.6?0:1):((R()*FACADES.length)|0);
      const g=new THREE.BoxGeometry(w,h,d),uv=g.attributes.uv;
      for(let i=0;i<24;i++){const f=i>>2;if(f===2||f===3)continue;uv.setXY(i,uv.getX(i)*(f<2?d:w)/16,uv.getY(i)*h/14);}
      g.translate(bx+ox,h/2,bz+oz);byStyle[st].push(g);
      const r=scaleUV(new THREE.PlaneGeometry(w-0.6,d-0.6),w/8,d/8);r.rotateX(-Math.PI/2);r.translate(bx+ox,h+0.05,bz+oz);roofs.push(r);
      const pr=new THREE.BoxGeometry(w+0.2,0.9,d+0.2);pr.translate(bx+ox,h+0.45,bz+oz);   // parapet ring (solid cap)
      byStyle[st].push(scaleUV(pr,0.05,0.05));
      const s=new THREE.BoxGeometry(w+0.5,4.2,d+0.5),su=s.attributes.uv;
      for(let i=0;i<24;i++){const f=i>>2;if(f===2||f===3)continue;su.setXY(i,su.getX(i)*(f<2?d:w)/24,su.getY(i));}
      s.translate(bx+ox,2.1,bz+oz);shops.push(s);
      for(let k=0;k<2+((R()*3)|0);k++)units.push([bx+ox+(R()-.5)*(w-5),h+1.4,bz+oz+(R()-.5)*(d-5),2+R()*2]);
      addCollider(bx+ox,bz+oz,w+0.5,d+0.5,h);mmBuild.push([bx+ox-w/2,bz+oz-d/2,w,d]);
    }));
  }));
  byStyle.forEach((gs,i)=>{if(gs.length)meshOf(merge(gs),FACADES[i]);});
  meshOf(merge(roofs),std(0xffffff,{map:TX.roof,roughness:0.9}),false);
  meshOf(merge(shops),new THREE.MeshStandardMaterial({map:TX.shop,roughnessMap:TX.shopRM,metalnessMap:TX.shopRM,roughness:1,metalness:1,emissiveMap:TX.shopEm,emissive:0xffffff,emissiveIntensity:0.9}));
  meshOf(merge(walks),std(0xffffff,{map:TX.walk,roughness:0.85}),false);
  // rooftop AC units / water tanks
  const um=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),std(0x9aa0a6,{roughness:0.5,metalness:0.6}),units.length);
  const d=new THREE.Object3D();units.forEach((u,i)=>{d.position.set(u[0],u[1],u[2]);d.scale.set(u[3],2.6,u[3]*0.8);d.rotation.set(0,0,0);d.updateMatrix();um.setMatrixAt(i,d.matrix);});
  um.castShadow=true;scene.add(um);

  // street lamps + traffic lights
  GRID.forEach(v=>{for(let k=0;k<4;k++){const m=(GRID[k]+GRID[k+1])/2;[-15,15].forEach(o=>{LAMPS.push([v+6.8,m+o,-1]);LAMPS.push([v-6.8,m+o+5,1]);LAMPS.push([m+o,v+6.8,-2]);LAMPS.push([m+o+5,v-6.8,2]);});}});
  const lampG=merge([placed(new THREE.CylinderGeometry(0.09,0.14,7,8),0,3.5,0),placed(new THREE.BoxGeometry(1.8,0.12,0.14),0.85,6.95,0)]);
  const headG=placed(new THREE.BoxGeometry(0.6,0.14,0.32),1.55,6.86,0);
  const lp=new THREE.InstancedMesh(lampG,std(0x2c3036,{roughness:0.4,metalness:0.8}),LAMPS.length);
  const lh=new THREE.InstancedMesh(headG,std(0x222222,{emissive:0xfff0d0,emissiveIntensity:1.6}),LAMPS.length);
  LAMPS.forEach((l,i)=>{d.position.set(l[0],0,l[1]);d.scale.set(1,1,1);d.rotation.set(0,l[2]===-1?Math.PI:l[2]===1?0:l[2]===-2?Math.PI/2:-Math.PI/2,0);d.updateMatrix();lp.setMatrixAt(i,d.matrix);lh.setMatrixAt(i,d.matrix);addCollider(l[0],l[1],0.3,0.3,7);});
  lp.castShadow=true;scene.add(lp,lh);
  const TL=[];GRID.forEach(a=>GRID.forEach(b=>[[1,1],[-1,-1]].forEach(s=>TL.push([a+s[0]*7.2,b+s[1]*7.2,s[0]>0?0:Math.PI]))));
  const tlG=merge([placed(new THREE.CylinderGeometry(0.1,0.12,4.2,8),0,2.1,0),placed(new THREE.BoxGeometry(0.45,1.3,0.4),0,4.6,0)]);
  const tlp=new THREE.InstancedMesh(tlG,std(0x1e2226,{roughness:0.5,metalness:0.6}),TL.length);
  const tll=new THREE.InstancedMesh(placed(new THREE.SphereGeometry(0.12,8,6),0,4.3,0.22),std(0x111111,{emissive:0x30ff70,emissiveIntensity:2.2}),TL.length*2);
  TL.forEach((t,i)=>{d.position.set(t[0],0,t[1]);d.rotation.set(0,t[2],0);d.updateMatrix();tlp.setMatrixAt(i,d.matrix);tll.setMatrixAt(i*2,d.matrix);
    d.rotation.set(0,t[2]+Math.PI,0);d.updateMatrix();tll.setMatrixAt(i*2+1,d.matrix);addCollider(t[0],t[1],0.3,0.3,5);});
  tlp.castShadow=true;scene.add(tlp,tll);

  // trees: trunk + 3 foliage blobs, instanced
  let guard=0;
  while(TREES.length<230&&guard++<6000){
    const x=(R()-.5)*600,z=(R()-.5)*600;
    if(Math.max(Math.abs(x),Math.abs(z))<136)continue;
    if(x>188)continue;
    if(Math.abs(x)<14&&Math.abs(z)>120)continue;
    if(Math.abs(z)<14&&x>120)continue;
    if(x>-140&&x<30&&z<-176&&z>-232)continue;
    if(Math.abs(x)<32&&z>196&&z<262)continue;
    if(x<-196&&x>-272&&Math.abs(z)<96)continue;
    TREES.push([x,z]);
  }
  const trunkG=new THREE.CylinderGeometry(0.22,0.38,3.4,7);trunkG.translate(0,1.7,0);
  const leafG=merge([placed(new THREE.IcosahedronGeometry(2.2,1),0,4.6,0),placed(new THREE.IcosahedronGeometry(1.7,1),1.2,3.9,0.4),placed(new THREE.IcosahedronGeometry(1.6,1),-0.9,4.2,-0.9),placed(new THREE.IcosahedronGeometry(1.4,1),0.2,6.1,0.3)]);
  const lp2=leafG.attributes.position;for(let i=0;i<lp2.count;i++){const k=0.86+vnoise(lp2.getX(i)*2,lp2.getZ(i)*2+lp2.getY(i))*0.3;lp2.setXYZ(i,lp2.getX(i)*k,lp2.getY(i)*(0.95+k*0.05),lp2.getZ(i)*k);}
  leafG.computeVertexNormals();
  const tr=new THREE.InstancedMesh(trunkG,std(0x5a4330,{roughness:0.95}),TREES.length);
  const lf=new THREE.InstancedMesh(leafG,std(0xffffff,{roughness:0.9}),TREES.length);
  const tc=new THREE.Color();
  TREES.forEach((p,i)=>{const s=0.8+R()*0.7;d.position.set(p[0],0,p[1]);d.scale.set(s,s*(0.9+R()*0.3),s);d.rotation.set(0,R()*6,0);d.updateMatrix();
    tr.setMatrixAt(i,d.matrix);lf.setMatrixAt(i,d.matrix);tc.setHSL(0.24+R()*0.08,0.45+R()*0.2,0.2+R()*0.1);lf.setColorAt(i,tc);addCollider(p[0],p[1],0.9,0.9,6);});
  tr.castShadow=lf.castShadow=true;tr.receiveShadow=lf.receiveShadow=true;scene.add(tr,lf);

  // terrain: Gravity Mountains (north) + rolling hills around the map
  function terrain(cx,cz,w,dd,amp,seg,snow,fall){
    const g=new THREE.PlaneGeometry(w,dd,seg,Math.round(seg*dd/w));g.rotateX(-Math.PI/2);
    const p=g.attributes.position,col=[],c=new THREE.Color();
    for(let i=0;i<p.count;i++){const x=p.getX(i)+cx,z=p.getZ(i)+cz;
      const ridge=1-Math.abs(fbm(x*0.004,z*0.004,4)*2-1),n=fbm(x*0.012,z*0.012,5);
      const f=fall(x,z);let h=(ridge*ridge*0.75+n*0.45)*amp*f-2;p.setY(i,h);
      const t=h/amp;if(snow&&t>0.58)c.setRGB(0.92,0.94,0.97);else if(t>0.28)c.setRGB(0.42+n*0.12,0.41+n*0.1,0.4+n*0.1);else c.setRGB(0.3+n*0.1,0.42+n*0.12,0.22);
      col.push(c.r,c.g,c.b);}
    g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.translate(cx,0,cz);g.computeVertexNormals();
    const m=new THREE.Mesh(g,std(0xffffff,{vertexColors:true,roughness:0.95}));m.receiveShadow=true;scene.add(m);
  }
  terrain(0,-560,1500,560,240,130,true,(x,z)=>clamp((-z-300)/160,0,1));
  terrain(-560,0,560,1300,90,60,false,(x,z)=>clamp((-x-320)/120,0,1));
  terrain(0,560,1300,560,80,60,false,(x,z)=>clamp((z-320)/120,0,1));
  const range=new THREE.PlaneGeometry(150,26);range.rotateX(-Math.PI/2);range.translate(-55,0.03,-205);
  meshOf(range,std(0xffffff,{map:TX.sand,roughness:0.95}),false);

  // ocean + beach + harbor (Fluid Ocean)
  const sand=new THREE.PlaneGeometry(46,2200);scaleUV(sand,4,190);sand.rotateX(-Math.PI/2);sand.translate(232,0.03,0);meshOf(sand,std(0xffffff,{map:TX.sand,roughness:0.95}),false);
  const wn=new THREE.TextureLoader().load('textures/waternormals.jpg');wn.wrapS=wn.wrapT=THREE.RepeatWrapping;wn.repeat.set(36,64);
  S.waterN=wn;
  const sea=new THREE.Mesh(new THREE.PlaneGeometry(1400,2200),new THREE.MeshStandardMaterial({color:0x0a3a55,roughness:0.06,metalness:0,normalMap:wn,normalScale:new THREE.Vector2(0.45,0.45),envMapIntensity:1.3}));
  sea.rotation.x=-Math.PI/2;sea.position.set(950,0.06,0);sea.receiveShadow=true;scene.add(sea);
  addCollider(950,0,1424,2200,1);
  box(30,0.5,10,std(0x7a5b3a,{roughness:0.9}),258,0.3,-22);
  [[330,-120,40],[420,60,60],[360,210,34],[520,-260,80]].forEach(i=>{
    const g=new THREE.IcosahedronGeometry(i[2],4),p=g.attributes.position,col=[];
    for(let k=0;k<p.count;k++){let y=p.getY(k);const n=fbm(p.getX(k)*0.05+i[0],p.getZ(k)*0.05,4);y=Math.max(-3,y*0.32+n*8-4);p.setY(k,y);
      const t=y/(i[2]*0.32);col.push(...(t<0.08?[0.85,0.78,0.58]:[0.25+n*0.1,0.42+n*0.1,0.2]));}
    g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.computeVertexNormals();
    const m=new THREE.Mesh(g,std(0xffffff,{vertexColors:true,roughness:0.95}));m.position.set(i[0],0,i[1]);m.receiveShadow=true;scene.add(m);});
  box(16,5,9,std(0x2c6e9b,{roughness:0.5}),222,2.5,-22);addCollider(222,-22,16,9,5);

  // wind farm
  S.blades=[];
  [[-225,-60],[-250,-10],[-225,40],[-255,75]].forEach(p=>{
    cyl(0.9,1.5,34,std(0xeef2f5,{roughness:0.4}),p[0],17,p[1]);addCollider(p[0],p[1],3,3,34);
    const hub=new THREE.Group();hub.position.set(p[0]+1.6,34,p[1]);scene.add(hub);
    for(let k=0;k<3;k++){const b=box(0.3,13,1.1,std(0xf7f9fb,{roughness:0.35}),0,6.5,0,null);const piv=new THREE.Group();piv.add(b);piv.rotation.x=k*Math.PI*2/3;hub.add(piv);}
    S.blades.push(hub);});
  const l1=label('INDUSTRIAL REGION · STAGE 4','#9fb3c8',5);l1.position.set(-225,46,0);scene.add(l1);
  // rocket
  const white=std(0xf1f3f6,{roughness:0.3,metalness:0.2}),red=std(0xc93a22,{roughness:0.35,metalness:0.3});
  cyl(3,3,26,white,0,17,232);cyl(0.1,3,8,red,0,34,232);cyl(4.5,5,4,std(0x555c66,{metalness:0.7,roughness:0.4}),0,2,232);
  box(0.4,7,10,red,0,7.5,232);box(10,7,0.4,red,0,7.5,232);addCollider(0,232,10,10,38);
  box(3,30,3,std(0x8a929c,{metalness:0.7,roughness:0.4}),9,15,232);addCollider(9,232,3,3,30);
  const l2=label('SPACE FRONTIER · STAGE 6','#9fb3c8',5);l2.position.set(0,46,232);scene.add(l2);
})();

/* ================= 5. CHARACTERS (rigged glTF models) =================
   soldier: own Idle/Walk/Run clips · michelle + xbot: xbot's idle/walk/run */
const CHARS=[
  {name:'Arin',role:'Field Agent',model:'soldier',anim:'soldier'},
  {name:'Mira',role:'Research Scientist',model:'michelle',anim:'xbot'},
  {name:'Unit X',role:'Lab Android',model:'xbot',anim:'xbot'}];
const TPL={};let loadedCount=0;
function prepModel(key,gltf){
  const root=gltf.scene;root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;
    if(o.material){o.material.envMapIntensity=0.7;if(key==='xbot'){o.material.roughness=0.35;o.material.metalness=0.2;}}}});
  root.updateMatrixWorld(true);
  // skinned meshes report bind-pose bounds, so measure the skeleton instead
  let ymin=1e9,ymax=-1e9;const v=new THREE.Vector3();
  root.traverse(o=>{if(o.isBone){o.getWorldPosition(v);ymin=Math.min(ymin,v.y);ymax=Math.max(ymax,v.y);}});
  const bb=new THREE.Box3().setFromObject(root),bh=bb.max.y-bb.min.y,h=bh>0.5?bh:((ymax-ymin)*1.03||1.76);
  const clips={};gltf.animations.forEach(a=>{a.tracks=a.tracks.filter(t=>!t.name.endsWith('.scale'));clips[a.name.toLowerCase()]=a;});
  TPL[key]={scene:root,scale:1.76/h,clips};
}
const RETARGET={};
// world-space retarget: apply the source bone's rotation change (from its T-pose) to the
// target bone's own T-pose, so differently-built Mixamo rigs share animations cleanly
function retarget(srcKey,tgtKey,name){
  const src=TPL[srcKey],tgt=TPL[tgtKey],clip=src.clips[name];if(!clip)return null;
  const sObj=THREE.SkeletonUtils.clone(src.scene),tObj=THREE.SkeletonUtils.clone(tgt.scene);
  const sB={},tB=[];sObj.traverse(o=>{if(o.isBone)sB[o.name]=o;});tObj.traverse(o=>{if(o.isBone)tB.push(o);});
  const restW=(obj,map)=>{obj.updateMatrixWorld(true);const r={};obj.traverse(o=>{if(o.isBone)r[o.name]=o.getWorldQuaternion(new THREE.Quaternion());});return r;};
  const sRest=restW(sObj);
  if(tgt.clips.tpose){const m=new THREE.AnimationMixer(tObj);m.clipAction(tgt.clips.tpose).play();m.update(0);}
  const tRest=restW(tObj);
  const sm=new THREE.AnimationMixer(sObj),act=sm.clipAction(clip);act.play();
  const fps=30,n=Math.max(2,Math.round(clip.duration*fps)+1),times=[],vals={};tB.forEach(b=>vals[b.name]=[]);
  const q=new THREE.Quaternion(),w=new THREE.Quaternion(),pw=new THREE.Quaternion(),newW={};
  for(let f=0;f<n;f++){const t=Math.min(clip.duration,f/fps);times.push(t);act.time=t;sm.update(0);sObj.updateMatrixWorld(true);
    tB.forEach(b=>{const sb=sB[b.name];
      if(sb){sb.getWorldQuaternion(q);w.copy(sRest[b.name]).invert();q.multiply(w);newW[b.name]=q.clone().multiply(tRest[b.name]);}
      else newW[b.name]=null;
      const par=b.parent;if(par&&par.isBone&&newW[par.name])pw.copy(newW[par.name]);else{par.getWorldQuaternion(pw);}
      if(!newW[b.name]){newW[b.name]=pw.clone().multiply(b.quaternion);}
      const loc=pw.clone().invert().multiply(newW[b.name]);vals[b.name].push(loc.x,loc.y,loc.z,loc.w);});}
  const tracks=tB.filter(b=>sB[b.name]).map(b=>new THREE.QuaternionKeyframeTrack(b.name+'.quaternion',times,vals[b.name]));
  return new THREE.AnimationClip(name,clip.duration,tracks);
}
function clipFor(c,name){const src=TPL[c.anim]||TPL[c.model];if(!src)return null;if(c.anim===c.model||!TPL[c.anim])return (TPL[c.model]||src).clips[name];
  const k=c.model+'/'+name;if(!(k in RETARGET)){try{RETARGET[k]=retarget(c.anim,c.model,name);}catch(e){console.warn(e);RETARGET[k]=null;}}
  return RETARGET[k];}
function makeActor(ci){
  const c=CHARS[ci],t=TPL[c.model];if(!t)return null;
  const o=THREE.SkeletonUtils.clone(t.scene);o.scale.multiplyScalar(t.scale);if(c.model==='soldier')o.rotation.y=Math.PI;
  const g=new THREE.Group();g.add(o);
  const mixer=new THREE.AnimationMixer(o),acts={};
  ['idle','walk','run'].forEach(n=>{const cl=clipFor(c,n);if(cl){const a=mixer.clipAction(cl);a.play();a.setEffectiveWeight(n==='idle'?1:0);acts[n]=a;}});
  return {root:g,mixer,acts,w:{idle:1,walk:0,run:0},ci};
}
function animActor(a,speed,air,dt){
  if(!a.mixer){animBox(a.root,speed,air,dt);return;}
  const tgt=speed<0.25?'idle':speed<3.6?'walk':'run';
  ['idle','walk','run'].forEach(n=>{if(!a.acts[n])return;a.w[n]+=((n===tgt?1:0)-a.w[n])*Math.min(1,dt*8);a.acts[n].setEffectiveWeight(a.w[n]);});
  if(a.acts.walk)a.acts.walk.timeScale=clamp(speed/1.45,0.6,1.7);
  if(a.acts.run)a.acts.run.timeScale=air?0.25:clamp(speed/5.6,0.7,1.4);
  a.mixer.update(dt);
}
// fallback (if models fail to load): simple box figure
function makeBoxHuman(col){
  const g=new THREE.Group(),sk=std(0xc98f62),sh=std(col),pa=std(0x2b3a52);
  box(0.5,0.62,0.28,sh,0,1.13,0,g);box(0.46,0.2,0.26,pa,0,0.76,0,g);box(0.3,0.32,0.3,sk,0,1.62,0,g);
  const limb=(x,y,w,h,m)=>{const p=new THREE.Group();p.position.set(x,y,0);box(w,h,w,m,0,-h/2,0,p);g.add(p);return p;};
  g.userData={aL:limb(-0.33,1.42,0.13,0.6,sh),aR:limb(0.33,1.42,0.13,0.6,sh),lL:limb(-0.13,0.7,0.17,0.7,pa),lR:limb(0.13,0.7,0.17,0.7,pa),ph:0};
  return {root:g,mixer:null};
}
function animBox(g,speed,air,dt){const u=g.userData;if(!u||!u.lL)return;u.ph+=speed*dt*2.3;const amp=air?0:Math.min(1,speed/6)*0.85+(speed>0.2?0.25:0),s=Math.sin(u.ph)*amp;
  u.lL.rotation.x=s;u.lR.rotation.x=-s;u.aL.rotation.x=-s*0.9;u.aR.rotation.x=s*0.9;}

const P={pos:new THREE.Vector3(8.5,0,12),vy:0,yaw:0,ground:true,stam:1,speed:0,actor:null};
function setCharacter(i){save.ch=i;if(P.actor)scene.remove(P.actor.root);
  P.actor=makeActor(i)||makeBoxHuman(0xff8a1f);scene.add(P.actor.root);P.actor.root.visible=!driving;persist();}

/* ========================= 6. PLAYER CAR =========================
   Real relationships: F=ma, P=Fv, traction limit μmg, braking a=μg,
   cornering limit v²/r ≤ μg, air drag ∝ v², rolling resistance.        */
const PAINTS=[0xa50f1a,0x0f6f8a,0xd9a21b,0x1d1f24,0xe8ebef];
const paintMat=new THREE.MeshPhysicalMaterial({color:PAINTS[save.paint|0]||PAINTS[0],metalness:0.2,roughness:0.42,clearcoat:1,clearcoatRoughness:0.03,envMapIntensity:1.0});
const glassMat=new THREE.MeshPhysicalMaterial({color:0x05080b,metalness:0,roughness:0.05,clearcoat:1,clearcoatRoughness:0.02,envMapIntensity:0.55});
const trimMat=std(0x111316,{roughness:0.55,metalness:0.3});
const rubberMat=std(0x16171a,{roughness:0.92});
const chromeMat=std(0xd8dde3,{roughness:0.18,metalness:1});
const headMat=std(0x222222,{emissive:0xfff3d6,emissiveIntensity:5});
const tailMat=std(0x220000,{emissive:0xff1a14,emissiveIntensity:1.6});
function shapeGeo(pts,depth,bevel){
  const s=new THREE.Shape();s.moveTo(pts[0][0],pts[0][1]);for(let i=1;i<pts.length;i++){const p=pts[i];if(p.length===5)s.absarc(p[0],p[1],p[2],p[3],p[4],false);else s.lineTo(p[0],p[1]);}
  const g=new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:true,bevelThickness:bevel,bevelSize:bevel,bevelSegments:3,curveSegments:14});
  g.rotateY(-Math.PI/2);g.translate(depth/2,0,0);return g;   // shape x → world z (front +z)
}
function carParts(withWheels){
  const body=shapeGeo([[-2.12,0.3],[-2.26,0.44],[-2.27,0.78],[-2.12,0.93],[-1.5,0.97],[1.0,0.93],[1.85,0.82],[2.2,0.68],[2.28,0.5],[2.22,0.32],[1.9,0.32],[1.38,0.36,0.5,0,Math.PI],[0.88,0.32],[-0.88,0.32],[-1.38,0.36,0.5,0,Math.PI],[-1.88,0.32]],1.62,0.13);
  const cabin=shapeGeo([[1.05,0.92],[0.15,1.3],[-0.85,1.33],[-1.72,0.95]],1.42,0.05);
  const roof=shapeGeo([[0.1,1.31],[-0.82,1.335],[-0.9,1.27],[0.04,1.25]],1.4,0.05);
  const trim=merge([placed(new THREE.BoxGeometry(1.0,0.16,0.08),0,0.5,2.3),placed(new THREE.BoxGeometry(1.86,0.12,4.3),0,0.36,0),
    placed(new THREE.BoxGeometry(0.06,0.36,0.42),0.76,1.1,-0.32),placed(new THREE.BoxGeometry(0.06,0.36,0.42),-0.76,1.1,-0.32),
    placed(new THREE.BoxGeometry(0.22,0.12,0.12),1.0,0.98,0.85),placed(new THREE.BoxGeometry(0.22,0.12,0.12),-1.0,0.98,0.85)]);
  const head=merge([placed(new THREE.BoxGeometry(0.5,0.09,0.1),0.6,0.66,2.22),placed(new THREE.BoxGeometry(0.5,0.09,0.1),-0.6,0.66,2.22)]);
  const tail=merge([placed(new THREE.BoxGeometry(1.6,0.08,0.08),0,0.8,-2.28)]);
  const wheel=[];
  const tire=new THREE.CylinderGeometry(0.36,0.36,0.27,20);tire.rotateZ(Math.PI/2);
  const rim=merge([(()=>{const g=new THREE.CylinderGeometry(0.25,0.25,0.28,18);g.rotateZ(Math.PI/2);return g;})(),
    ...[0,1,2,3,4].map(k=>{const g=new THREE.BoxGeometry(0.05,0.44,0.06);g.translate(0.16,0,0);g.rotateX(k*Math.PI*2/5);return g;})]);
  const WP=[[-0.86,1.38],[0.86,1.38],[-0.86,-1.38],[0.86,-1.38]];
  if(withWheels){const ts=[],rs=[];WP.forEach(w=>{ts.push(tire.clone().translate(w[0],0.36,w[1]));const r=rim.clone();if(w[0]<0)r.rotateZ(Math.PI);rs.push(r.translate(w[0]+(w[0]<0?-0.01:0.01),0.36,w[1]));});
    return {paint:merge([body,roof]),glass:cabin,trim:merge([trim,...ts]),chrome:merge(rs),head,tail};}
  return {paint:merge([body,roof]),glass:cabin,trim,head,tail,tire,rim,WP};
}
const car={pos:new THREE.Vector3(4.6,0,18),yaw:0,v:0,a:0,steer:0,braking:false,
  mass:save.carMass,mu:save.carMu,F:5400,P:90000,L:2.76,mesh:null,wheels:[],fw:[]};
(function buildCar(){
  const p=carParts(false),g=new THREE.Group(),body=new THREE.Group();g.add(body);
  [[p.paint,paintMat],[p.glass,glassMat],[p.trim,trimMat],[p.head,headMat]].forEach(a=>{const m=new THREE.Mesh(a[0],a[1]);m.castShadow=true;m.receiveShadow=true;body.add(m);});
  car.tailMat=tailMat.clone();body.add(new THREE.Mesh(p.tail,car.tailMat));
  p.WP.forEach((w,i)=>{const piv=new THREE.Group();piv.position.set(w[0],0.36,w[1]);
    const spin=new THREE.Group();piv.add(spin);const t=new THREE.Mesh(p.tire,rubberMat);t.castShadow=true;spin.add(t);
    const r=new THREE.Mesh(p.rim,chromeMat);if(w[0]<0)r.rotation.z=Math.PI;r.position.x=w[0]<0?-0.01:0.01;spin.add(r);
    g.add(piv);car.wheels.push(spin);if(w[1]>0)car.fw.push(piv);});
  // soft contact shadow under the car
  const cs=new THREE.Mesh(new THREE.PlaneGeometry(2.3,4.8),new THREE.MeshBasicMaterial({map:TX.smoke,color:0x000000,transparent:true,opacity:0.55,depthWrite:false}));
  cs.rotation.x=-Math.PI/2;cs.position.y=0.05;g.add(cs);
  car.mesh=g;car.body=body;scene.add(g);
})();
function placeCar(x,z,yaw){car.pos.set(x,0,z);car.yaw=yaw;car.v=0;car.steer=0;}
function carDefaults(){car.mass=save.carMass;car.mu=save.carMu;car.F=5400;}
function enterCar(){dropCarry();driving=true;P.actor.root.visible=false;cam.yaw=car.yaw;audio.start();}
function exitCar(){driving=false;P.pos.set(car.pos.x+Math.cos(car.yaw)*2.3,0,car.pos.z-Math.sin(car.yaw)*2.3);resolve(P.pos,0.4);P.yaw=car.yaw;P.actor.root.visible=true;}

function updateCar(dt){
  const c=car,on=driving&&!S.freeze&&!S.ui;
  const gas=on&&inp.gas,brk=on&&inp.brake,hand=on&&inp.hand,st=on?inp.mx:0;
  const m=c.mass,mu=c.mu,N=m*G,v=c.v,sg=Math.sign(v);
  const drag=0.4*v*v*sg,roll=Math.abs(v)>0.05?0.015*N*sg:0;
  let nv;c.braking=false;
  if((hand&&Math.abs(v)>0.02)||(brk&&v>0.3)||(gas&&v<-0.3)){
    c.braking=true;nv=v+(-sg*mu*G-drag/m)*dt;if(Math.sign(nv)!==sg)nv=0;
  }else{
    let F=0;
    if(gas)F=Math.min(c.F,c.P/Math.max(v,1),mu*N);
    else if(brk&&v>-8)F=-Math.min(c.F*0.5,mu*N);
    nv=v+(F-drag-roll)/m*dt;if(F===0&&sg!==0&&Math.sign(nv)!==sg)nv=0;
  }
  c.a=(nv-v)/dt;c.v=nv;
  const maxS=Math.min(0.55,Math.atan(mu*G*c.L/(nv*nv+0.01)));
  c.steer+=(st*maxS-c.steer)*Math.min(1,dt*7);
  c.yaw-=c.v*Math.tan(c.steer)/c.L*dt;
  c.pos.x+=Math.sin(c.yaw)*c.v*dt;c.pos.z+=Math.cos(c.yaw)*c.v*dt;
  let hit=resolve(c.pos,1.7);
  if(hitDynamic(c.pos,1.7,true))hit=true;
  if(hit&&Math.abs(c.v)>1.5){if(Math.abs(c.v)>6)fxBurst(c.pos);c.v*=-0.25;}
  c.pos.x=clamp(c.pos.x,-WORLD,WORLD);c.pos.z=clamp(c.pos.z,-WORLD,WORLD);
  c.mesh.position.copy(c.pos);c.mesh.rotation.y=c.yaw;
  c.body.rotation.x+=(clamp(-c.a*0.012,-0.07,0.07)-c.body.rotation.x)*Math.min(1,dt*6);
  c.body.rotation.z+=(clamp(c.v*c.v*Math.tan(c.steer)/c.L*0.006,-0.06,0.06)-c.body.rotation.z)*Math.min(1,dt*6);
  c.wheels.forEach(w=>w.rotation.x+=c.v/0.36*dt);c.fw.forEach(p=>p.rotation.y=-c.steer);
  c.tailMat.emissiveIntensity=c.braking?6:1.6;
  if(on&&(c.braking||hand)&&Math.abs(c.v)>7&&R()<dt*30)smoke(c);
}

/* ================= 7. TRAFFIC (left-hand driving) + PEDESTRIANS ================= */
const CARGEO=carParts(true),TRAF=[],PARKED=[],PEDS=[],dyn=[];
const tPaint=new THREE.MeshPhysicalMaterial({color:0xffffff,metalness:0.2,roughness:0.42,clearcoat:1,clearcoatRoughness:0.05,envMapIntensity:1.0});
const MAXC=24,TI={};
[['paint',tPaint],['glass',glassMat],['trim',trimMat],['chrome',chromeMat],['head',headMat],['tail',tailMat]].forEach(a=>{
  const im=new THREE.InstancedMesh(CARGEO[a[0]],a[1],MAXC);im.castShadow=a[0]!=='head'&&a[0]!=='tail';im.receiveShadow=true;im.count=0;scene.add(im);TI[a[0]]=im;});
const TCOL=[0xd8dcdf,0x1d2a3a,0x6e0f14,0x2f3438,0x0e5d7a,0xb7b9bb,0xe6c229,0x14532d,0xf1f1ee,0x7a3a12];
(function(){const pk=[[60,-90,1,0],[60,-30,1,0],[-60,90,-1,0],[-120,30,1,0],[120,-30,-1,0],[30,-120,0,1],[-90,-120,0,-1],[90,60,0,1],[-30,0,0,-1],[90,0,0,1]];
  pk.forEach(p=>{const ax=p[3]===0,x=ax?p[0]+p[2]*4.9:p[0],z=ax?p[1]:p[1]+p[3]*4.9;PARKED.push({x,z,yaw:ax?0:Math.PI/2,col:TCOL[(R()*TCOL.length)|0]});
    addCollider(x,z,ax?2:4.6,ax?4.6:2,1.5);});})();
const gi=v=>Math.round((v+120)/60);
function newTraffic(k){
  for(let tries=0;tries<50;tries++){
    const i=(R()*5)|0,j=(R()*4)|0,dirs=[[1,0],[-1,0],[0,1],[0,-1]],d=dirs[(R()*4)|0];
    const t={i,j,di:d[0],dj:d[1],s:R()*40,v:8,vx:0,vz:0,x:0,z:0,yaw:0,col:new THREE.Color(TCOL[k%TCOL.length])};
    if(!segOK(t.i,t.j,t.di,t.dj))continue;trafPos(t);t.x=t.lx;t.z=t.lz;t.yaw=t.lyaw;return t;}
  return null;
}
// the z=+120 road is reserved for the Brake Test Strip
function segOK(i,j,di,dj){const ni=i+di,nj=j+dj;if(ni<0||ni>4||nj<0||nj>4)return false;if(dj===0&&j===4)return false;return true;}
function trafPos(t){const ax=GRID[t.i]+t.di*t.s,az=GRID[t.j]+t.dj*t.s,lx=t.dj,lz=-t.di;
  t.lx=ax+lx*3;t.lz=az+lz*3;t.lyaw=Math.atan2(t.di,t.dj);}
function setTrafficCount(n){while(TRAF.length<n){const t=newTraffic(TRAF.length);if(!t)break;TRAF.push(t);}TRAF.length=Math.min(TRAF.length,n);}
function updateTraffic(dt){
  const hide=M&&M.def.id==='newton';
  dyn.length=0;
  const dm=new THREE.Object3D();let n=0;
  const put=(x,z,yaw,col)=>{dm.position.set(x,0,z);dm.rotation.set(0,yaw,0);dm.updateMatrix();for(const k in TI){TI[k].setMatrixAt(n,dm.matrix);}TI.paint.setColorAt(n,col);n++;};
  PARKED.forEach(p=>{if(!p.c)p.c=new THREE.Color(p.col);put(p.x,p.z,p.yaw,p.c);});
  if(!hide)TRAF.forEach(t=>{
    const fx_=Math.sin(t.yaw),fz_=Math.cos(t.yaw);let want=10;
    const look=(ox,oz,r)=>{const dx=ox-t.x,dz=oz-t.z,f=dx*fx_+dz*fz_,l=Math.abs(dx*fz_-dz*fx_);if(f>0&&f<16&&l<r)want=Math.min(want,Math.max(0,(f-5)*1.2));};
    look(car.pos.x,car.pos.z,2.4);if(!driving)look(P.pos.x,P.pos.z,2);
    TRAF.forEach(o=>{if(o!==t)look(o.x,o.z,1.9);});
    if(t.s>46&&!t.straight)want=Math.min(want,5);
    t.v+=clamp(want-t.v,-8*dt,3*dt);t.s+=t.v*dt;
    if(t.s>=60){t.i+=t.di;t.j+=t.dj;t.s-=60;
      const opts=[[t.di,t.dj],[t.dj,-t.di],[-t.dj,t.di]].filter(d=>segOK(t.i,t.j,d[0],d[1]));
      let d=opts.length?(R()<0.5&&segOK(t.i,t.j,t.di,t.dj)?[t.di,t.dj]:opts[(R()*opts.length)|0]):[-t.di,-t.dj];
      t.di=d[0];t.dj=d[1];}
    const nx=t.i+t.di,nj=t.j+t.dj,nd=[[t.di,t.dj]];t.straight=true;
    trafPos(t);
    const k=1-Math.exp(-dt*5);t.x+=(t.lx-t.x)*k;t.z+=(t.lz-t.z)*k;t.yaw+=angDiff(t.lyaw,t.yaw)*k;
    put(t.x,t.z,t.yaw,t.col);dyn.push([t.x,t.z,1.9]);
  });
  for(const k in TI){TI[k].count=n;TI[k].instanceMatrix.needsUpdate=true;}
  if(TI.paint.instanceColor)TI.paint.instanceColor.needsUpdate=true;
  PEDS.forEach(p=>{if(p.a.root.visible)dyn.push([p.a.root.position.x,p.a.root.position.z,0.45]);});
}
// circle obstacles (traffic, pedestrians): push the mover out
function hitDynamic(p,r){let hit=false;for(let i=0;i<dyn.length;i++){const o=dyn[i],dx=p.x-o[0],dz=p.z-o[1],d=Math.hypot(dx,dz),rr=r+o[2];
  if(d<rr&&d>1e-4){p.x+=dx/d*(rr-d);p.z+=dz/d*(rr-d);hit=true;}}return hit;}
function spawnPeds(n){
  PEDS.forEach(p=>p.a.root.visible=false);
  const blocks=[-90,-30,30,90];
  while(PEDS.length<n){const a=makeActor(R()<0.55?1:0);if(!a)break;scene.add(a.root);
    const bx=blocks[(R()*4)|0],bz=blocks[(R()*4)|0],o=22.4;
    PEDS.push({a,path:[[bx-o,bz-o],[bx+o,bz-o],[bx+o,bz+o],[bx-o,bz+o]],k:(R()*4)|0,f:R(),sp:1.25+R()*0.35,dir:R()<0.5?1:-1,wait:0});}
  PEDS.forEach((p,i)=>p.a.root.visible=i<n);
}
function updatePeds(dt){
  PEDS.forEach(p=>{if(!p.a.root.visible)return;
    const A=p.path[p.k],B=p.path[(p.k+(p.dir>0?1:3))%4],L=Math.hypot(B[0]-A[0],B[1]-A[1]);
    let sp=p.sp;const x=A[0]+(B[0]-A[0])*p.f,z=A[1]+(B[1]-A[1])*p.f;
    if(Math.hypot(car.pos.x-x,car.pos.z-z)<3.2||(!driving&&Math.hypot(P.pos.x-x,P.pos.z-z)<1.1))sp=0;
    p.f+=sp*dt/L;if(p.f>=1){p.f=0;p.k=(p.k+(p.dir>0?1:3))%4;}
    p.a.root.position.set(x,0.16,z);p.a.root.rotation.y=Math.atan2(B[0]-A[0],B[1]-A[1]);
    if(camera.position.distanceToSquared(p.a.root.position)<90*90)animActor(p.a,sp,false,dt);
  });
}

/* ============ 7b. RIGID BODIES: pick up, carry, throw, collide ============
   Gameplay physics (simplified): spheres move in 3D with gravity, bounce
   (coefficient of restitution e), roll, and feel air drag ½ρCdAv².
   Drums and cones stay upright and slide with kinetic friction μ (no tipping).
   Every collision uses an impulse that conserves momentum:
     j = −(1+e)·v_rel·n ÷ (1/m₁ + 1/m₂)                                   */
const BODY_TYPES={
  rubber:{name:'Rubber ball',shape:'sphere',r:0.3,m:1.0,e:0.78,mu:0.03,col:0xff6a1f},
  beach:{name:'Beach ball',shape:'sphere',r:0.45,m:0.25,e:0.65,mu:0.03,col:0xffffff},
  medicine:{name:'Medicine ball',shape:'sphere',r:0.3,m:5,e:0.2,mu:0.05,col:0x6b3b2a},
  iron:{name:'Iron sphere',shape:'sphere',r:0.38,m:60,e:0.15,mu:0.02,col:0x5a5f66},
  drum:{name:'Water drum',shape:'upright',r:0.3,h:0.9,m:60,e:0.2,mu:0.5,col:0x1f5fa8},
  cone:{name:'Traffic cone',shape:'upright',r:0.22,h:0.7,m:2,e:0.3,mu:0.6,col:0xff5a14}};
const LIFT_MAX=25,THROW_E=60;
const BODIES=[];
TX.beach=canvasTex(256,128,(x,w,h)=>{const c=['#e8322b','#ffffff','#1f7fe0','#ffffff','#ffd21f','#ffffff','#2fb24a','#ffffff'];c.forEach((col,i)=>{x.fillStyle=col;x.fillRect(i*w/8,0,w/8+1,h);});});
function bodyMesh(t){
  if(t.shape==='sphere'){
    const m=t===BODY_TYPES.beach?std(0xffffff,{map:TX.beach,roughness:0.35}):
      std(t.col,{roughness:t===BODY_TYPES.iron?0.35:0.55,metalness:t===BODY_TYPES.iron?0.9:0});
    const me=new THREE.Mesh(new THREE.SphereGeometry(t.r,24,16),m);me.castShadow=true;me.receiveShadow=true;return me;}
  const g=new THREE.Group();
  if(t===BODY_TYPES.drum){
    cyl(t.r,t.r,t.h,std(t.col,{roughness:0.45,metalness:0.3}),0,t.h/2,0,g,24);
    [0.12,t.h/2,t.h-0.12].forEach(y=>cyl(t.r+0.015,t.r+0.015,0.04,std(0x9aa3ad,{metalness:0.8,roughness:0.35}),0,y,0,g,24));
  }else{
    box(0.42,0.05,0.42,std(0x222222,{roughness:0.8}),0,0.025,0,g);
    cyl(0.03,t.r*0.85,t.h-0.05,std(t.col,{roughness:0.5}),0,0.025+(t.h-0.05)/2,0,g,18);
    cyl(0.085,0.12,0.12,std(0xf2f2f2,{roughness:0.4,emissive:0x333333}),0,0.42,0,g,18);
  }
  return g;
}
function addBody(type,x,z,y){
  const t=BODY_TYPES[type],mesh=bodyMesh(t);scene.add(mesh);
  const b={type,t,name:t.name,shape:t.shape,r:t.r,h:t.h||0,m:t.m,e:t.e,mu:t.mu,mesh,
    pos:new THREE.Vector3(x,y!=null?y:(t.shape==='sphere'?t.r+0.17:0.17),z),vel:new THREE.Vector3(),w:0,carry:false,home:[x,z]};
  BODIES.push(b);return b;
}
(function placeBodies(){
  // Lab Yard sandbox (centre of the yard)
  [['rubber',-33,33],['rubber',-31,34.5],['beach',-28,33],['medicine',-35,35.5],['iron',-26,35],['beach',-30.5,36.5]].forEach(p=>addBody(p[0],p[1],p[2]));
  [[-21,33],[-21,35],[-21,37],[-20.4,34],[-20.4,36],[-21.6,34],[-21.6,36]].forEach(p=>addBody('cone',p[0],p[1]));
  [[-40,34],[-40.7,34.6],[-40,35.3]].forEach(p=>addBody('drum',p[0],p[1]));
  // street slalom on the west avenue and drums by the harbour
  for(let i=0;i<6;i++)addBody('cone',-125.5,-40+i*12);
  [[214,-6],[215,-5.2],[214.4,-4.2],[236,-30]].forEach(p=>addBody('drum',p[0],p[1]));
  [[230,6],[226,-12]].forEach(p=>addBody('rubber',p[0],p[1]));
})();
const nV=new THREE.Vector3(),tV=new THREE.Vector3(),qR=new THREE.Quaternion(),axV=new THREE.Vector3();
let carryB=null;
const pPrev=new THREE.Vector3(),pVel=new THREE.Vector3();
function bodyBottom(b){return b.shape==='sphere'?b.pos.y-b.r:b.pos.y;}
function bodyTop(b){return b.shape==='sphere'?b.pos.y+b.r:b.pos.y+b.h;}
function groundAt(x,z){return onWalk({x,z})?0.16:0;}
// impulse between two bodies along normal n (from a to b); ma/mb may be Infinity
function impulse(va,vb,ma,mb,n,e){
  const vrel=(vb.x-va.x)*n.x+(vb.y-va.y)*n.y+(vb.z-va.z)*n.z;if(vrel>=0)return 0;
  const inv=(isFinite(ma)?1/ma:0)+(isFinite(mb)?1/mb:0);if(!inv)return 0;
  const j=-(1+e)*vrel/inv;
  if(isFinite(ma))va.addScaledVector(n,-j/ma);if(isFinite(mb))vb.addScaledVector(n,j/mb);return j;
}
function hitStatic(b){
  for(let i=0;i<colliders.length;i++){const c=colliders[i];if(bodyBottom(b)>=c.h)continue;
    const nx=clamp(b.pos.x,c.a,c.b),nz=clamp(b.pos.z,c.c,c.d);let dx=b.pos.x-nx,dz=b.pos.z-nz;const d2=dx*dx+dz*dz;
    if(d2>=b.r*b.r)continue;let d=Math.sqrt(d2);
    if(d<1e-6){const l=b.pos.x-c.a,rr=c.b-b.pos.x,t=b.pos.z-c.c,bb=c.d-b.pos.z,m=Math.min(l,rr,t,bb);
      dx=m===l?-1:m===rr?1:0;dz=m===t?-1:m===bb?1:0;d=0;}
    else{dx/=d;dz/=d;}
    b.pos.x=nx+dx*b.r;b.pos.z=nz+dz*b.r;if(d===0){b.pos.x+=dx*0.01;b.pos.z+=dz*0.01;}
    const vn=b.vel.x*dx+b.vel.z*dz;if(vn<0){b.vel.x-=(1+b.e)*vn*dx;b.vel.z-=(1+b.e)*vn*dz;if(vn<-3)bump(b,-vn*b.m);}
  }
}
function bump(b,j){if(j>6&&b.pos.distanceToSquared(camera.position)<900)audio.thud(Math.min(1,j/400));}
let trackB=null,trackT=0,throwRec=null;
function trackBody(b){trackB=b;trackT=6;}
function updateBodies(dt){
  pVel.copy(P.pos).sub(pPrev).divideScalar(Math.max(dt,1e-3));pPrev.copy(P.pos);
  if(pVel.lengthSq()>400)pVel.set(0,0,0);
  const steps=2,h=dt/steps,fwd=new THREE.Vector3(Math.sin(P.yaw),0,Math.cos(P.yaw));
  for(let s=0;s<steps;s++){
    BODIES.forEach(b=>{
      if(b.carry){b.pos.set(P.pos.x+fwd.x*0.78,P.pos.y+(b.shape==='sphere'?1.15:0.55)+(onWalk(P.pos)?0.16:0),P.pos.z+fwd.z*0.78);b.vel.copy(pVel);return;}
      const gy=groundAt(b.pos.x,b.pos.z);
      if(b.shape==='sphere'){
        b.vel.y-=G*h;
        const sp=b.vel.length();if(sp>0.01){const A=Math.PI*b.r*b.r,Fd=0.5*1.2*0.47*A*sp*sp;b.vel.multiplyScalar(Math.max(0,1-Fd/b.m*h/sp));}
        b.pos.addScaledVector(b.vel,h);
        if(b.pos.y-b.r<gy){b.pos.y=gy+b.r;if(b.vel.y<0){if(b.vel.y<-2)bump(b,-b.vel.y*b.m);b.vel.y=-b.e*b.vel.y;if(b.vel.y<0.5)b.vel.y=0;}
          const hs=Math.hypot(b.vel.x,b.vel.z);if(hs>0){const k=Math.max(0,hs-b.mu*G*h)/hs;b.vel.x*=k;b.vel.z*=k;}}
      }else{
        b.vel.y=0;b.pos.y=gy;
        const hs=Math.hypot(b.vel.x,b.vel.z);if(hs>0){const k=Math.max(0,hs-b.mu*G*h)/hs;b.vel.x*=k;b.vel.z*=k;}
        b.pos.x+=b.vel.x*h;b.pos.z+=b.vel.z*h;
      }
      hitStatic(b);
      b.pos.x=clamp(b.pos.x,-WORLD,WORLD);b.pos.z=clamp(b.pos.z,-WORLD,WORLD);
    });
    // body–body
    for(let i=0;i<BODIES.length;i++)for(let k=i+1;k<BODIES.length;k++){
      const a=BODIES[i],c=BODIES[k];if(a.carry||c.carry)continue;
      const dx=c.pos.x-a.pos.x,dz=c.pos.z-a.pos.z;if(Math.abs(dx)>1.2||Math.abs(dz)>1.2)continue;
      let dy=0;const both=a.shape==='sphere'&&c.shape==='sphere';
      if(both)dy=c.pos.y-a.pos.y;else if(bodyBottom(a)>bodyTop(c)||bodyBottom(c)>bodyTop(a))continue;
      const d=Math.sqrt(dx*dx+dy*dy+dz*dz),rr=a.r+c.r;if(d>=rr||d<1e-5)continue;
      nV.set(dx/d,dy/d,dz/d);const ov=rr-d,ia=1/a.m,ic=1/c.m;
      a.pos.addScaledVector(nV,-ov*ia/(ia+ic));c.pos.addScaledVector(nV,ov*ic/(ia+ic));
      const j=impulse(a.vel,c.vel,a.m,c.m,nV,Math.sqrt(a.e*c.e));if(j>0){bump(a,j);if(a.shape!=='sphere')a.w+=(R()-.5)*j/a.m*2;if(c.shape!=='sphere')c.w+=(R()-.5)*j/c.m*2;}
    }
    // player car (mass car.mass), traffic (treated as very heavy), walking player (70 kg)
    const cf=new THREE.Vector3(Math.sin(car.yaw),0,Math.cos(car.yaw)),cv=cf.clone().multiplyScalar(car.v);
    BODIES.forEach(b=>{if(b.carry||bodyBottom(b)>1.3)return;
      [-1.15,1.15].forEach(o=>{const cx=car.pos.x+cf.x*o,cz=car.pos.z+cf.z*o,dx=b.pos.x-cx,dz=b.pos.z-cz,d=Math.hypot(dx,dz),rr=0.98+b.r;
        if(d>=rr||d<1e-5)return;nV.set(dx/d,0,dz/d);const ov=rr-d,M=car.mass;
        b.pos.addScaledVector(nV,ov*M/(M+b.m));car.pos.addScaledVector(nV,-ov*b.m/(M+b.m));
        tV.copy(cv);const j=impulse(tV,b.vel,M,b.m,nV,0.3);
        if(j>0){car.v=tV.dot(cf);if(b.shape==='sphere')b.vel.y+=j/b.m*0.18;else b.w+=(R()-.5)*j/b.m*3;bump(b,j);trackBody(b);if(j>800)fxBurst(b.pos);}});
      if(!(M&&M.def.id==='newton'))TRAF.forEach(t=>{const tf=[Math.sin(t.yaw),Math.cos(t.yaw)];
        [-1.15,1.15].forEach(o=>{const cx=t.x+tf[0]*o,cz=t.z+tf[1]*o,dx=b.pos.x-cx,dz=b.pos.z-cz,d=Math.hypot(dx,dz),rr=0.98+b.r;
          if(d>=rr||d<1e-5)return;nV.set(dx/d,0,dz/d);b.pos.addScaledVector(nV,rr-d);
          tV.set(tf[0]*t.v,0,tf[1]*t.v);impulse(tV,b.vel,Infinity,b.m,nV,0.3);});});
      if(!driving&&!S.station){const dx=b.pos.x-P.pos.x,dz=b.pos.z-P.pos.z,d=Math.hypot(dx,dz),rr=0.38+b.r;
        if(d<rr&&d>1e-5&&bodyBottom(b)<P.pos.y+1.7){nV.set(dx/d,0,dz/d);const ov=rr-d,mp=70;
          b.pos.addScaledVector(nV,ov*mp/(mp+b.m));P.pos.addScaledVector(nV,-ov*b.m/(mp+b.m));
          tV.copy(pVel);tV.y=0;impulse(tV,b.vel,mp,b.m,nV,0.25);}}
    });
  }
  // visuals: rolling spheres, spinning uprights
  BODIES.forEach(b=>{b.mesh.position.copy(b.pos);
    if(b.shape==='sphere'){const hs=Math.hypot(b.vel.x,b.vel.z);if(hs>0.01&&!b.carry){axV.set(b.vel.z,0,-b.vel.x).normalize();qR.setFromAxisAngle(axV,hs*dt/b.r);b.mesh.quaternion.premultiply(qR);}}
    else{b.w*=Math.exp(-2.5*dt);b.mesh.rotation.y+=b.w*dt;const hs=Math.hypot(b.vel.x,b.vel.z);b.mesh.rotation.z=Math.sin(S.time*14)*Math.min(0.12,hs*0.03);}});
  // projectile record for thrown objects
  if(throwRec){const b=throwRec.b;throwRec.t+=dt;throwRec.maxH=Math.max(throwRec.maxH,b.pos.y-throwRec.y0);
    if(throwRec.t>0.15&&bodyBottom(b)<=groundAt(b.pos.x,b.pos.z)+0.02){
      const R_=Math.hypot(b.pos.x-throwRec.x0,b.pos.z-throwRec.z0);
      toast('Landed '+fx(R_)+' m away · peak +'+fx(throwRec.maxH)+' m · flight '+fx(throwRec.t,2)+' s');throwRec=null;}
    else if(throwRec.t>8)throwRec=null;}
  if(trackT>0)trackT-=dt;
}
function nearestBody(){let best=null,bd=1e9;BODIES.forEach(b=>{if(b.carry)return;const d=Math.hypot(b.pos.x-P.pos.x,b.pos.z-P.pos.z)-b.r;if(d<0.9&&d<bd&&bodyBottom(b)<P.pos.y+1.6){bd=d;best=b;}});return best;}
function pickUp(b){if(b.m>LIFT_MAX){toast(b.name+' is '+b.m+' kg — weight mg = '+fx(b.m*G,0)+' N is too heavy to lift. Push it or hit it with the car.');return;}
  carryB=b;b.carry=true;b.vel.set(0,0,0);trackBody(b);}
function dropCarry(){if(!carryB)return;const b=carryB;b.carry=false;carryB=null;b.vel.copy(pVel);}
function throwCarry(){if(!carryB)return;const b=carryB;dropCarry();
  const v=Math.min(14,Math.sqrt(2*THROW_E/b.m)),el=35*Math.PI/180,fw=new THREE.Vector3(Math.sin(P.yaw),0,Math.cos(P.yaw));
  b.vel.set(fw.x*v*Math.cos(el),v*Math.sin(el),fw.z*v*Math.cos(el)).add(pVel);
  throwRec={b,t:0,x0:b.pos.x,z0:b.pos.z,y0:b.pos.y,maxH:0};trackBody(b);
  toast('Throw: same '+THROW_E+' J each time → v = √(2E/m) = '+fx(v)+' m/s for '+b.m+' kg');}
function trackLine(){if(!trackB||trackT<=0)return null;const b=trackB,v=b.vel.length();
  return '<b>'+b.name+'</b> · m '+b.m+' kg · v '+fx(v)+' m/s<br>momentum p = mv = <b>'+fx(b.m*v)+'</b> kg·m/s · KE = ½mv² = <b>'+fx(0.5*b.m*v*v)+'</b> J';}

/* ========================= 8. INPUT ========================= */
const inp={mx:0,my:0,run:false,jump:false,gas:false,brake:false,hand:false,act:false,lookX:0,lookY:0,looking:false};
const keys={},tb={};let joy={id:null,x:0,y:0,ox:0,oy:0},lookId=null,lx=0,ly=0,actEdge=false,jumpEdge=false;
window.addEventListener('keydown',e=>{
  if(e.target&&e.target.tagName==='INPUT')return;
  const k=e.key.toLowerCase();if(!keys[k]){if(k==='e')actEdge=true;if(k===' ')jumpEdge=true;}
  keys[k]=true;if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(k))e.preventDefault();
  if(k==='escape'){if(S.ui&&S.ui!=='menu'&&S.ui!=='result'&&S.ui!=='brief')closeOv();else if(!S.ui)openMenu();}
  if(k==='m'&&!S.ui)openMap();
});
window.addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false;});
window.addEventListener('blur',()=>{for(const k in keys)keys[k]=false;});
function setTouch(){document.body.classList.remove('notouch');document.body.classList.add('touch');}
if(coarse)setTouch();
const cv=$('c');
cv.addEventListener('pointerdown',e=>{
  if(e.pointerType==='touch'){setTouch();
    if(joy.id===null&&e.clientX<innerWidth*0.5&&e.clientY>innerHeight*0.42&&!S.station){joy.id=e.pointerId;joy.ox=e.clientX;joy.oy=e.clientY;joy.x=joy.y=0;
      const j=$('joy');j.style.left=(e.clientX-56)+'px';j.style.bottom=(innerHeight-e.clientY-56)+'px';return;}
  }
  if(lookId===null){lookId=e.pointerId;lx=e.clientX;ly=e.clientY;inp.looking=true;}
});
window.addEventListener('pointermove',e=>{
  if(e.pointerId===joy.id){let dx=(e.clientX-joy.ox)/48,dy=(e.clientY-joy.oy)/48;const m=Math.hypot(dx,dy);if(m>1){dx/=m;dy/=m;}joy.x=dx;joy.y=-dy;
    $('joy').firstElementChild.style.transform='translate('+dx*34+'px,'+dy*34+'px)';}
  else if(e.pointerId===lookId){inp.lookX+=e.clientX-lx;inp.lookY+=e.clientY-ly;lx=e.clientX;ly=e.clientY;}
});
function pUp(e){
  if(e.pointerId===joy.id){joy.id=null;joy.x=joy.y=0;const j=$('joy');j.firstElementChild.style.transform='';j.style.left='';j.style.bottom='';}
  if(e.pointerId===lookId){lookId=null;inp.looking=false;}
}
window.addEventListener('pointerup',pUp);window.addEventListener('pointercancel',pUp);
cv.addEventListener('contextmenu',e=>e.preventDefault());
[['bGas','gas'],['bBrake','brake'],['bJump','jump'],['bAct','act']].forEach(b=>{
  const el=$(b[0]);
  el.addEventListener('pointerdown',e=>{e.preventDefault();tb[b[1]]=true;el.classList.add('dn');if(b[1]==='act')actEdge=true;if(b[1]==='jump')jumpEdge=true;});
  const up=()=>{tb[b[1]]=false;el.classList.remove('dn');};
  el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);el.addEventListener('pointerleave',up);
});
function readInput(){
  const kx=(keys.d||keys.arrowright?1:0)-(keys.a||keys.arrowleft?1:0),ky=(keys.w||keys.arrowup?1:0)-(keys.s||keys.arrowdown?1:0);
  inp.mx=clamp(kx+joy.x,-1,1);inp.my=clamp(ky+joy.y,-1,1);
  inp.run=!!keys.shift||Math.hypot(joy.x,joy.y)>0.9;
  inp.gas=ky>0||!!tb.gas||joy.y>0.45;inp.brake=ky<0||!!tb.brake||joy.y<-0.45;inp.hand=!!keys[' '];
  inp.jump=jumpEdge;inp.act=actEdge;jumpEdge=actEdge=false;
}

/* ========================= 9. PLAYER + CAMERA ========================= */
function updatePlayer(dt){
  const on=!S.freeze&&!S.ui&&!S.station;
  const mx=on?inp.mx:0,my=on?inp.my:0,mag=Math.min(1,Math.hypot(mx,my));
  const run=inp.run&&P.stam>0.03&&mag>0.2,sp=(run?6:2.2)*mag;
  if(mag>0.05){
    const s=Math.sin(cam.yaw),c=Math.cos(cam.yaw),h=Math.hypot(mx,my);
    const dx=(s*my-c*mx)/h,dz=(c*my+s*mx)/h;
    P.pos.x+=dx*sp*dt;P.pos.z+=dz*sp*dt;
    P.yaw+=angDiff(Math.atan2(dx,dz),P.yaw)*Math.min(1,dt*10);
  }
  P.stam=clamp(P.stam+(run?-0.14:0.12)*dt,0,1);P.speed=sp;
  if(on&&inp.jump){if(carryB)throwCarry();else if(P.ground){P.vy=5;P.ground=false;}}       // h = v²/2g ≈ 1.28 m
  if(!P.ground){P.vy-=G*dt;P.pos.y+=P.vy*dt;if(P.pos.y<=0){P.pos.y=0;P.vy=0;P.ground=true;}}
  resolve(P.pos,0.4);hitDynamic(P.pos,0.4);
  P.pos.x=clamp(P.pos.x,-WORLD,WORLD);P.pos.z=clamp(P.pos.z,-WORLD,WORLD);
  const r=P.actor.root;r.position.set(P.pos.x,P.pos.y+(onWalk(P.pos)?0.16:0),P.pos.z);r.rotation.y=P.yaw;animActor(P.actor,sp,!P.ground,dt);
}
function onWalk(p){const ax=Math.abs(p.x),az=Math.abs(p.z);if(ax>126||az>126)return false;
  const nx=Math.min(...GRID.map(g=>Math.abs(p.x-g))),nz=Math.min(...GRID.map(g=>Math.abs(p.z-g)));return nx>6&&nz>6;}
const cam={yaw:0,pitch:0.28};const tmpV=new THREE.Vector3(),lookV=new THREE.Vector3();
function insideBuilding(x,y,z){for(let i=0;i<colliders.length;i++){const c=colliders[i];if(x>c.a&&x<c.b&&z>c.c&&z<c.d&&y<c.h&&c.b-c.a>2)return true;}return false;}
function updateCamera(dt){
  let fov=S.station?72:62;
  if(S.ui==='menu'){const t=S.time*0.05;camera.position.set(Math.sin(t)*165,78,Math.cos(t)*165);camera.lookAt(0,8,0);setFov(58);followSun(0,0);return;}
  if(S.fixedCam){setFov(fov);const fc=S.fixedCam,sh=$('sheet'),W=innerWidth,H=innerHeight;let tp=fc.pos;
    if(!sh.classList.contains('hide')){
      // keep the equipment in the part of the screen the control sheet does not cover
      const tf=Math.tan(camera.fov*Math.PI/360);let hT,vT;
      if(W<H){const f=clamp(1-sh.offsetHeight/H,0.3,1),FH=H*(2-f);camera.setViewOffset(W,FH,0,H*(1-f),W,H);camera.aspect=W/FH;hT=tf*W/FH;vT=tf*f*H/FH;}
      else{const g=clamp(1-sh.offsetWidth/W,0.3,1),FW=W*(2-g);camera.setViewOffset(FW,H,W*(1-g),0,W,H);camera.aspect=FW/H;hT=tf*g*W/H;vT=tf;}
      camera.updateProjectionMatrix();
      if(fc.fit){const D=Math.max(4,fc.fit.w/2/hT*1.1,fc.fit.h/2/vT*1.1);tp=tmpV.copy(fc.pos).sub(fc.look).normalize().multiplyScalar(D).add(fc.look);}
    }else clearOffset();
    if(S.snap){camera.position.copy(tp);S.snap=false;}else camera.position.lerp(tp,Math.min(1,dt*4));camera.lookAt(fc.look);followSun(fc.look.x,fc.look.z);return;}
  clearOffset();
  const t=driving?car.pos:P.pos,h=driving?1.45:1.6;
  cam.yaw-=inp.lookX*0.006;cam.pitch=clamp(cam.pitch+inp.lookY*0.004,0.04,1.2);inp.lookX=inp.lookY=0;
  if(driving&&!inp.looking&&Math.abs(car.v)>1){const want=car.v<-1?car.yaw+Math.PI:car.yaw;cam.yaw+=angDiff(want,cam.yaw)*Math.min(1,dt*2.6);}
  if(driving){fov=62+Math.min(18,Math.abs(car.v)*0.45);if(!inp.looking)cam.pitch+=(0.2-cam.pitch)*Math.min(1,dt*0.8);}
  setFov(camera.fov+(fov-camera.fov)*Math.min(1,dt*3));
  let dist=driving?7.6+Math.abs(car.v)*0.05:4.4;
  const cp=Math.cos(cam.pitch),ox=-Math.sin(cam.yaw)*cp,oy=Math.sin(cam.pitch),oz=-Math.cos(cam.yaw)*cp;
  const sh=driving?0:0.55,rx=-Math.cos(cam.yaw)*sh,rz=Math.sin(cam.yaw)*sh;    // over-the-shoulder offset
  for(let k=1;k<=8;k++){const d=dist*k/8;if(insideBuilding(t.x+rx+ox*d,t.y+h+oy*d,t.z+rz+oz*d)){dist=Math.max(1.2,dist*(k-1)/8);break;}}
  tmpV.set(t.x+rx+ox*dist,Math.max(0.5,t.y+h+oy*dist),t.z+rz+oz*dist);
  camera.position.lerp(tmpV,1-Math.exp(-dt*12));
  lookV.set(t.x+rx,t.y+h,t.z+rz);
  if(driving&&Math.abs(car.v)>20){const k=(Math.abs(car.v)-20)*0.0025;lookV.x+=(R()-.5)*k;lookV.y+=(R()-.5)*k;}
  camera.lookAt(lookV);followSun(t.x,t.z);
}
function clearOffset(){if(camera.view&&camera.view.enabled){camera.clearViewOffset();camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}}
function setFov(f){if(Math.abs(camera.fov-f)>0.01){camera.fov=f;camera.updateProjectionMatrix();}}
function followSun(x,z){sun.position.set(x+sunDir.x*200,sunDir.y*200,z+sunDir.z*200);sun.target.position.set(x,0,z);}

/* ========================= 10. MISSIONS =========================
   To add a mission: push one object into MISSIONS with
     id, world, name, topic, pos:[x,z], officer, brief, objective, equip,
     science, eq, simNote, quiz:[{q,o:[..],a:index}],
     begin(), tick(dt), hud() -> html, cleanup()
   and call finishMission({pass,did,rows:[[label,value]],graph:fn(canvas)}). */
const ringMat=new THREE.MeshStandardMaterial({color:0x000000,emissive:0xffb62e,emissiveIntensity:2.2,transparent:true,opacity:0.9});
const ring=new THREE.Mesh(new THREE.TorusGeometry(5,0.3,10,40),ringMat);ring.visible=false;scene.add(ring);
const zone=new THREE.Mesh(new THREE.BoxGeometry(18,0.25,12),new THREE.MeshBasicMaterial({color:0x3ddc84,transparent:true,opacity:0.45,depthWrite:false}));zone.visible=false;scene.add(zone);
const zoneLbl=label('STOP ZONE','#3ddc84',2.4);zoneLbl.visible=false;scene.add(zoneLbl);

function vtGraph(samples,ylab){return function(cn){
  const x=cn.getContext('2d'),W=cn.width,H=cn.height,p=38;x.clearRect(0,0,W,H);
  const tm=Math.max(1,samples[samples.length-1][0]),vm=Math.max(5,...samples.map(s=>s[1]))*1.15;
  x.strokeStyle='#ffffff33';x.lineWidth=1;x.fillStyle='#9fb3c8';x.font='18px system-ui';
  for(let i=0;i<=4;i++){const y=H-p-(H-p-12)*i/4;x.beginPath();x.moveTo(p,y);x.lineTo(W-8,y);x.stroke();x.fillText(fx(vm*i/4,0),4,y+6);}
  x.fillText(ylab+' vs time (0–'+fx(tm,0)+' s)',p+6,22);
  x.strokeStyle='#37e0c8';x.lineWidth=3;x.beginPath();
  samples.forEach((s,i)=>{const X=p+(W-p-8)*s[0]/tm,Y=H-p-(H-p-12)*s[1]/vm;i?x.lineTo(X,Y):x.moveTo(X,Y);});x.stroke();
};}

const CPS=[[60,-60],[60,0],[60,60],[0,60],[-60,60],[-60,0],[-60,-60],[0,-60]];
const MISSIONS=[
{id:'motion',world:1,name:'Checkpoint Run',topic:'Distance, displacement, speed and velocity',pos:[0,-52],officer:'Officer Tara Venn',
 brief:'“Traffic control needs calibration data. Drive the city loop through all 8 checkpoints. I do not want it fast — I want it at an <b>average speed of 36 km/h</b>. Work out how long the 480 m loop should take, then hold that pace. Watch out for traffic — we drive on the left here.”',
 objective:'Complete the 480 m loop with an average speed of 36 km/h (±3 km/h).',equip:'Test car · odometer · stopwatch · speedometer',
 science:'Speed tells how fast distance is covered. Average speed uses the whole trip: total distance divided by total time. Because the loop ends where it began, your displacement is zero — so your average <i>velocity</i> for the lap is zero even though your average speed is not.',
 eq:'average speed = total distance ÷ total time\n36 km/h = 10 m/s   →   480 m ÷ 10 m/s = 48 s\naverage velocity = displacement ÷ time',
 simNote:'Simplified: the odometer integrates your actual path, so cutting or widening corners changes the distance slightly.',
 quiz:[{q:'You finished the loop exactly where you started. Your displacement is…',o:['480 m','0 m','240 m','It depends on your speed'],a:1},
       {q:'A car covers 480 m in 48 s. Its average speed is…',o:['4.8 m/s','36 m/s','10 m/s (36 km/h)','100 km/h'],a:2}],
 begin(){if(!driving)enterCar();placeCar(0,-60,Math.PI/2);cam.yaw=car.yaw;carDefaults();Object.assign(M,{i:0,t:0,d:0,go:false,sm:[[0,0]],st:0});ring.visible=true;},
 tick(dt){
   const c=CPS[M.i];ring.position.set(c[0],5,c[1]);ring.rotation.y=S.time*1.5;
   if(!M.go&&Math.abs(car.v)>0.3)M.go=true;
   if(M.go){M.t+=dt;M.d+=Math.abs(car.v)*dt;M.st+=dt;if(M.st>=0.5){M.st=0;M.sm.push([M.t,Math.abs(car.v)*3.6]);}}
   if(Math.hypot(car.pos.x-c[0],car.pos.z-c[1])<9){M.i++;
     if(M.i>=CPS.length){const avg=M.d/M.t*3.6,err=Math.abs(avg-36);M.sm.push([M.t,Math.abs(car.v)*3.6]);
       finishMission({pass:err<=3,did:'You drove the '+fx(M.d,0)+' m city loop through 8 checkpoints in '+fx(M.t)+' s.',
         rows:[['Odometer distance',fx(M.d,0)+' m'],['Time taken',fx(M.t)+' s'],['Average speed',fx(avg)+' km/h ('+fx(avg/3.6)+' m/s)'],['Target','36 km/h ± 3'],['Displacement','≈ 0 m (back at start)'],['Average velocity','≈ 0 m/s']],
         graph:vtGraph(M.sm,'Speed (km/h)')});}}
 },
 hud(){const avg=M.t>0?M.d/M.t*3.6:0;return '<b>Checkpoint '+Math.min(M.i+1,8)+'/8</b> · target average <b>36 km/h</b><br>Odometer '+fx(M.d,0)+' m · Time '+fx(M.t)+' s · Average '+fx(avg)+' km/h';},
 cleanup(){ring.visible=false;}
},
{id:'newton',world:2,name:'Brake Test Strip',topic:'Newton’s Second Law, inertia and friction',pos:[-110,113],officer:'Engineer Rohan Vale',
 brief:'“This rig has one engine setting: <b>6000 N</b> of driving force. You choose the vehicle mass and the road surface. Get above <b>54 km/h</b>, then brake so the vehicle stops <b>inside the green zone</b>. Watch how mass changes your acceleration — and whether it changes your stopping distance.”',
 objective:'Exceed 54 km/h, then stop completely inside the green stop zone.',equip:'Variable-mass test car · friction surface · speedometer',
 science:'With a fixed force, a heavier vehicle accelerates less: a = F/m. That is inertia. Under full braking the friction force is μmg, so the deceleration is μg — the mass cancels. Stopping distance depends on speed squared and on friction, not on mass.',
 eq:'a = F ÷ m\nfriction force = μ·m·g   →   braking deceleration = μ·g\nstopping distance d = v² ÷ (2·μ·g)',
 simNote:'Simplified: ideal brakes at the friction limit (like perfect ABS), a single friction coefficient, no brake fade or weight transfer. Air drag and rolling resistance are included, so measured values differ slightly from the ideal formulas.',
 quiz:[{q:'Same engine force, but the vehicle mass is doubled. The acceleration…',o:['doubles','halves','stays the same','becomes zero'],a:1},
       {q:'Braking at the friction limit from the same speed, a vehicle with double the mass stops in…',o:['double the distance','half the distance','about the same distance','four times the distance'],a:2}],
 begin(){if(!driving)enterCar();placeCar(-110,120,Math.PI/2);cam.yaw=car.yaw;car.F=6000;car.mass=1500;car.mu=0.4;
   Object.assign(M,{ph:'setup',t:0,peak:0,t15:null,bv:0,bx:0,wasB:false,sm:[[0,0]],st:0});S.freeze=true;
   zone.position.set(69,0.14,120);zone.visible=true;zoneLbl.position.set(69,7,120);zoneLbl.visible=true;
   openSheet('<h3>Brake Test Strip · set up the rig</h3><p>Engine force is fixed at <b>6000 N</b>.</p>'+
     '<label>Vehicle mass m <b id="nM"></b><input type="range" id="nMs" min="800" max="4000" step="100" value="1500"></label>'+
     '<div class="seg" id="nMu"><button data-v="0.8">Dry road μ=0.8</button><button data-v="0.4" class="on">Wet road μ=0.4</button></div>'+
     '<div class="out" id="nOut"></div><div class="row"><button class="pri" id="nGo">Start run</button></div>');
   const up=()=>{car.mass=+$('nMs').value;$('nM').textContent=car.mass+' kg';const tr=car.mu*car.mass*G,f=Math.min(6000,tr);
     $('nOut').innerHTML='Ideal acceleration a = F/m = <b>'+fx(f/car.mass,2)+' m/s²</b>'+(tr<6000?' <i>(tyres slip: grip μmg = '+fx(tr,0)+' N is below 6000 N)</i>':'')+
       '<br>Braking deceleration μg = <b>'+fx(car.mu*G,2)+' m/s²</b><br>Stopping distance from 54 km/h: work it out with d = v²/(2μg)';};
   $('nMs').oninput=up;seg('nMu',v=>{car.mu=+v;up();});up();
   $('nGo').onclick=()=>{closeSheet();S.freeze=false;M.ph='run';};
 },
 tick(dt){
   if(M.ph!=='run')return;const v=car.v;
   if(v>0.3||M.t>0){M.t+=dt;M.st+=dt;if(M.st>=0.25){M.st=0;M.sm.push([M.t,Math.max(0,v)*3.6]);}}
   M.peak=Math.max(M.peak,v);if(M.t15===null&&v>=15)M.t15=M.t;
   if(car.braking&&!M.wasB&&v>3){M.bv=v;M.bx=car.pos.x;}M.wasB=car.braking;
   if(M.peak>5&&Math.abs(v)<0.03){if(!M.bv){M.bv=0.01;M.bx=car.pos.x;}
     const sx=car.pos.x,inZ=sx>=60&&sx<=78,fast=M.peak>=15,pa=Math.min(6000,car.mu*car.mass*G)/car.mass;M.sm.push([M.t,0]);
     finishMission({pass:inZ&&fast,did:'You ran a '+car.mass+' kg vehicle on a '+(car.mu>0.5?'dry':'wet')+' road (μ = '+car.mu+'), reached '+fx(M.peak*3.6)+' km/h and '+(inZ?'stopped inside the zone.':(sx<60?'stopped '+fx(60-sx)+' m short of the zone.':'overshot the zone by '+fx(sx-78)+' m.'))+(fast?'':' You did not reach 54 km/h.'),
       rows:[['Mass',car.mass+' kg'],['Ideal a = F/m',fx(pa,2)+' m/s²'],['Measured a (0→54 km/h)',M.t15?fx(15/M.t15,2)+' m/s²':'not reached'],['Speed when brakes applied',fx(M.bv*3.6)+' km/h'],['Ideal d = v²/(2μg)',fx(M.bv*M.bv/(2*car.mu*G))+' m'],['Measured stopping distance',fx(sx-M.bx)+' m'],['Stopped in zone',inZ?'Yes':'No']],
       graph:vtGraph(M.sm,'Speed (km/h)')});}
 },
 hud(){if(M.ph==='setup')return '<b>Set up the rig</b>, then press Start run.';
   const toZ=60-car.pos.x;return '<b>Reach 54 km/h, stop in the green zone</b><br>m = '+car.mass+' kg · μ = '+car.mu+' · peak '+fx(M.peak*3.6,0)+' km/h · zone starts in '+fx(Math.max(0,toZ),0)+' m';},
 cleanup(){zone.visible=false;zoneLbl.visible=false;closeSheet();S.freeze=false;carDefaults();}
},
{id:'momentum',world:2,name:'Momentum Lab',lab:'collide',topic:'Momentum, collisions and kinetic energy',pos:[-38,48.2],officer:'Prof. Kiran Das',
 brief:'“Rail engineers need to know how wagons behave when they couple. On the collision track, cart B (<b>2.0 kg</b>) waits at rest. First, with the <b>spring bumper</b>, send cart B off at exactly <b>3.0 m/s</b>. Then, with <b>Velcro</b>, make the joined carts roll at <b>1.0 m/s</b>. Predict with momentum before you launch — fewer launches earn a better medal.”',
 objective:'Spring bumper: v_B = 3.0 m/s (±0.1). Velcro: joined speed 1.0 m/s (±0.05). Cart B stays 2.0 kg. Gold or Silver needs 10 launches or fewer.',
 equip:'Collision track · carts A and B · spring and Velcro bumpers · speed sensors',
 science:'Momentum p = mv is conserved in every collision because the carts push on each other with equal and opposite forces for the same time. In an elastic collision kinetic energy is also kept, so a light cart can send a heavier one off fast. When the carts stick together they share one velocity and some kinetic energy turns into heat and sound.',
 eq:'m_A·u_A + m_B·u_B = m_A·v_A + m_B·v_B\nelastic, B at rest:  v_B = 2·m_A·u_A ÷ (m_A + m_B)\nsticking:  v = m_A·u_A ÷ (m_A + m_B)\nKE = ½mv²',
 simNote:'Instantaneous collision with a coefficient of restitution (1 = spring, 0 = Velcro). No track friction or air drag.',
 quiz:[{q:'A 1 kg cart at 4 m/s sticks to a 1 kg cart at rest. They move off together at…',o:['4 m/s','2 m/s','1 m/s','0 m/s'],a:1},
       {q:'When two carts stick together after colliding, what is conserved?',o:['Kinetic energy only','Momentum only','Both momentum and kinetic energy','Neither'],a:1}],
 begin(){startLab('collide',true);},tick(){},hud(){return '<b>Momentum Lab</b> · spring: v_B = 3.0 m/s · Velcro: joined 1.0 m/s · launches '+((LS&&LS.tries)||0);},cleanup(){endLab();},
 finish(){const a=LS.elRes,b=LS.stRes,n=LS.tries||0;
   finishMission({pass:n<=10,did:'You met both targets in '+n+' launches.',rows:[
     ['Spring: m_A, u_A',fx(a.mA,1)+' kg, '+fx(a.uA,2)+' m/s'],['Spring: v_B (target 3.0)',fx(a.vB,2)+' m/s'],['Spring: p before → after',fx(a.pb,2)+' → '+fx(a.pa,2)+' kg·m/s'],['Spring: KE before → after',fx(a.kb,2)+' → '+fx(a.ka,2)+' J'],
     ['Velcro: m_A, u_A',fx(b.mA,1)+' kg, '+fx(b.uA,2)+' m/s'],['Velcro: joined v (target 1.0)',fx(b.vB,2)+' m/s'],['Velcro: p before → after',fx(b.pb,2)+' → '+fx(b.pa,2)+' kg·m/s'],['Velcro: KE lost',fx(b.kb-b.ka,2)+' J ('+fx((b.kb-b.ka)/b.kb*100,0)+' %)'],['Launches',n+' (≤ 10 for Silver/Gold)']]});}
},
{id:'gravity',world:4,name:'Supply Launcher',topic:'Projectile motion and gravity',pos:[-96,-196],officer:'Dr. Sana Okoye',
 brief:'“The mountain camp needs supplies and the road is out. Use the launcher to land a pod on the pad <b>90 m</b> away. You control the launch angle and speed. Experiment, read the results, and find a combination that lands on target.”',
 objective:'Land a pod within 3 m of the pad centre, 90 m from the launcher.',equip:'Pneumatic launcher · range finder · trajectory plotter',
 science:'A projectile moves sideways at constant speed while gravity accelerates it downward at g. The two motions are independent. On level ground the range depends on v², on sin 2θ and on g — so 45° gives the greatest range, and pairs of angles that add to 90° land at the same spot.',
 eq:'x = v·cosθ·t        y = v·sinθ·t − ½·g·t²\nRange R = v²·sin 2θ ÷ g\nMax height H = (v·sinθ)² ÷ (2g)      Flight time T = 2·v·sinθ ÷ g',
 simNote:'Simplified: no air resistance, level ground, launch from ground height. Real projectiles fall short of these values and their best angle is below 45°.',
 quiz:[{q:'With no air resistance on level ground, which launch angle gives the greatest range?',o:['30°','45°','60°','90°'],a:1},
       {q:'A 30° shot and a 60° shot at the same speed…',o:['land at the same range','the 60° shot lands farther','the 30° shot lands farther','stay in the air for the same time'],a:0}],
 begin(){startStation('gravity');},tick(dt){stationTick(dt);},hud(){return '<b>Supply Launcher</b> · land the pod on the pad 90 m away';},cleanup(){endStation();}
},
{id:'fluid',world:5,name:'Float the Salvage Crate',topic:'Density, buoyancy and Archimedes’ principle',pos:[204,0],officer:'Captain Ines Marlow',
 brief:'“We tow salvage crates behind the boat. Too light and they bob about; too heavy and they sink. Use the test tank: fill the 1 m³ crate until it floats with <b>70–80 % of its volume under water</b>. You can change the crate’s density and the liquid.”',
 objective:'Make the crate float at rest with 70–80 % of its volume submerged.',equip:'Glass test tank · 1 m³ crate · liquids of known density',
 science:'A liquid pushes up on an object with a force equal to the weight of liquid displaced (Archimedes’ principle). A floating object sinks until that upthrust equals its own weight, so the fraction under the surface equals the ratio of densities. If the object is denser than the liquid, full submersion still cannot support it and it sinks.',
 eq:'Buoyant force F_b = ρ_liquid · V_submerged · g\nFloating:  F_b = weight  →  fraction submerged = ρ_object ÷ ρ_liquid\nSinks when ρ_object > ρ_liquid',
 simNote:'Simplified: the crate stays upright, the liquid level does not rise as the crate displaces it, and water drag is a simple damping term.',
 quiz:[{q:'A crate floats with 75 % of its volume under sea water (1025 kg/m³). Its density is about…',o:['256 kg/m³','769 kg/m³','1025 kg/m³','1367 kg/m³'],a:1},
       {q:'For any object floating at rest, the buoyant force equals…',o:['the object’s volume','the weight of all the liquid in the tank','the object’s weight','zero'],a:2}],
 begin(){startStation('fluid');},tick(dt){stationTick(dt);},hud(){return '<b>Float the Salvage Crate</b> · target 70–80 % submerged';},cleanup(){endStation();}
}];
const missionById=id=>MISSIONS.find(m=>m.id===id);
const unlocked=i=>i===0||(save.medals[MISSIONS[i-1].id]||0)>=1||(save.medals[MISSIONS[i].id]||0)>=1;

MISSIONS.forEach(d=>{
  const g=new THREE.Group();g.position.set(d.pos[0],0,d.pos[1]);
  const beam=new THREE.Mesh(new THREE.CylinderGeometry(2.6,2.6,30,24,1,true),new THREE.MeshBasicMaterial({color:0xffb62e,transparent:true,opacity:0.16,side:THREE.DoubleSide,depthWrite:false,fog:false}));beam.position.y=15;g.add(beam);
  const base=new THREE.Mesh(new THREE.TorusGeometry(2.6,0.12,8,32),new THREE.MeshStandardMaterial({color:0,emissive:0xffb62e,emissiveIntensity:2.5}));base.rotation.x=Math.PI/2;base.position.y=0.22;g.add(base);
  const l=label('W'+d.world+' · '+d.name.toUpperCase(),'#ffb62e',2.6);l.position.y=9;g.add(l);scene.add(g);d.marker=g;
});
const OFFICERS=[];

const ST={};
(function buildStations(){
  const lg=new THREE.Group();lg.position.set(-100,0,-205);scene.add(lg);
  cyl(1.8,2.2,0.6,std(0x4a5568,{metalness:0.6,roughness:0.4}),0,0.3,0,lg);ST.barrelPiv=new THREE.Group();ST.barrelPiv.position.y=0.8;lg.add(ST.barrelPiv);
  const b=cyl(0.45,0.55,4,std(0xff8a1f,{metalness:0.4,roughness:0.35}),0,0,0,null);b.geometry.rotateZ(-Math.PI/2);b.geometry.translate(2,0,0);ST.barrelPiv.add(b);
  addCollider(-100,-205,4,4,3);
  const pad=new THREE.Mesh(new THREE.CylinderGeometry(3,3,0.3,32),std(0xd9482f,{roughness:0.5}));pad.position.set(-10,0.15,-205);pad.receiveShadow=true;scene.add(pad);
  const pin=new THREE.Mesh(new THREE.CylinderGeometry(1,1,0.34,24),std(0xffffff));pin.position.set(-10,0.16,-205);scene.add(pin);
  const pl=label('PAD · 90 m','#ff7a5c',2.2);pl.position.set(-10,5,-205);scene.add(pl);
  ST.ball=new THREE.Mesh(new THREE.SphereGeometry(0.8,20,14),std(0xffd23f,{emissive:0xffa000,emissiveIntensity:0.6,metalness:0.3,roughness:0.3}));ST.ball.visible=false;ST.ball.castShadow=true;scene.add(ST.ball);
  ST.trails=[];
  const tx=214,tz=10;ST.tx=tx;ST.tz=tz;
  box(5,0.2,5,std(0x4a5568,{metalness:0.6,roughness:0.4}),tx,0.1,tz);
  ST.water=new THREE.Mesh(new THREE.BoxGeometry(3.9,3,3.9),new THREE.MeshStandardMaterial({color:0x2a8fd6,transparent:true,opacity:0.5,depthWrite:false,roughness:0.05}));ST.water.position.set(tx,1.7,tz);scene.add(ST.water);
  const glass=new THREE.Mesh(new THREE.BoxGeometry(4,4.4,4),new THREE.MeshStandardMaterial({color:0xdff3ff,transparent:true,opacity:0.14,depthWrite:false,roughness:0.02,metalness:0.1}));glass.position.set(tx,2.4,tz);scene.add(glass);
  const ed=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(4,4.4,4)),new THREE.LineBasicMaterial({color:0xe8f6ff}));ed.position.copy(glass.position);scene.add(ed);
  ST.crate=box(1,1,1,std(0xb07a3f,{roughness:0.85}),tx,5.2,tz);
  ST.crate.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.01,1.01,1.01)),new THREE.LineBasicMaterial({color:0x3a2510})));
  addCollider(tx,tz,5,5,5);
})();
const trailCols=[0x37e0c8,0xffb62e,0xff6b8a,0x9b8cff,0x7be07b,0xffffff];

function startStation(kind){
  if(driving){driving=false;P.actor.root.visible=true;}
  S.station=kind;M.tries=0;M.hit=false;
  if(kind==='gravity'){
    P.pos.set(-100,0,-200.5);P.yaw=Math.PI/2;
    S.fixedCam={pos:new THREE.Vector3(-124,14,-205),look:new THREE.Vector3(-124+8.66,14-5,-205)};
    M.g=G;M.fly=null;M.shots=[];
    openSheet('<h3>Supply Launcher · Gravity Mountains</h3><p>Land the pod on the pad <b>90 m</b> away (within 3 m).</p>'+
      '<label>Launch angle θ <b id="gA"></b><input type="range" id="gAs" min="5" max="85" step="1" value="25"></label>'+
      '<label>Launch speed v <b id="gV"></b><input type="range" id="gVs" min="5" max="60" step="0.5" value="22"></label>'+
      '<div class="seg" id="gG"><button data-v="9.8" class="on">Earth g=9.8</button><button data-v="3.71">Mars g=3.71</button><button data-v="1.62">Moon g=1.62</button></div>'+
      '<canvas id="plot" width="640" height="190"></canvas><div class="out" id="gOut">R = v²·sin 2θ ÷ g &nbsp;·&nbsp; fire a test shot.</div>'+
      '<div class="row"><button class="pri" id="gFire">Launch</button><button id="gDone">Finish &amp; assess</button><button id="gQuit">Leave</button></div>');
    const up=()=>{$('gA').textContent=$('gAs').value+'°';$('gV').textContent=fx($('gVs').value)+' m/s';ST.barrelPiv.rotation.z=+$('gAs').value*Math.PI/180;};
    $('gAs').oninput=up;$('gVs').oninput=up;up();seg('gG',v=>{M.g=+v;});
    $('gFire').onclick=()=>{if(M.fly)return;const th=+$('gAs').value*Math.PI/180,v=+$('gVs').value;
      const T=2*v*Math.sin(th)/M.g,geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(303),3));
      const line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:trailCols[M.tries%6]}));line.frustumCulled=false;scene.add(line);ST.trails.push(line);
      if(ST.trails.length>6)scene.remove(ST.trails.shift());
      M.fly={th,v,g:M.g,T,t:0,k:Math.max(1,T/5),line,n:0};M.tries++;ST.ball.visible=true;audio.blip(180);};
    $('gDone').onclick=()=>{if(!M.tries)return;const best=M.shots.reduce((a,s)=>Math.abs(s.R-90)<Math.abs(a.R-90)?s:a,M.shots[0]);
      finishMission({pass:M.hit&&M.hitTry<=5,did:'You fired '+M.tries+' pod'+(M.tries>1?'s':'')+' and '+(M.hit?'hit the pad on attempt '+M.hitTry+'.':'did not hit the pad. Your closest shot missed by '+fx(Math.abs(best.R-90))+' m.'),
        rows:M.shots.slice(-5).map(s=>['θ '+s.a+'°, v '+fx(s.v)+' m/s, g '+s.g,'R '+fx(s.R)+' m · H '+fx(s.H)+' m · T '+fx(s.T)+' s']).concat([['Target range','90 m ± 3 m'],['Pad hit',M.hit?'Yes (attempt '+M.hitTry+')':'No']]),
        graph:cn=>drawPlot(cn)});};
    $('gQuit').onclick=quitMission;drawPlot($('plot'));
  }else{
    P.pos.set(ST.tx-4,0,ST.tz+1.5);P.yaw=Math.PI/2;
    S.fixedCam={pos:new THREE.Vector3(ST.tx,4.5,ST.tz+9),look:new THREE.Vector3(ST.tx,2.2,ST.tz),fit:{w:5,h:5.6}};
    M.rho=400;M.rf=1000;M.sim=null;M.last=null;M.log=[];
    openSheet('<h3>Test Tank · Fluid Ocean</h3><p>Float the 1 m³ crate with <b>70–80 %</b> of its volume submerged.</p>'+
      '<label>Crate density ρ <b id="fR"></b><input type="range" id="fRs" min="100" max="3000" step="10" value="400"></label>'+
      '<div class="seg" id="fL"><button data-v="1000" class="on">Fresh water 1000</button><button data-v="1025">Sea water 1025</button><button data-v="900">Oil 900</button></div>'+
      '<div class="out" id="fOut">Set a density and drop the crate.</div>'+
      '<div class="row"><button class="pri" id="fDrop">Drop crate</button><button id="fDone">Finish &amp; assess</button><button id="fQuit">Leave</button></div>');
    const up=()=>{M.rho=+$('fRs').value;$('fR').textContent=M.rho+' kg/m³ · mass '+M.rho+' kg';};
    $('fRs').oninput=up;up();
    seg('fL',v=>{M.rf=+v;ST.water.material.color.setHex(M.rf===900?0xc9a227:(M.rf===1025?0x1f7fa8:0x2a8fd6));});
    $('fDrop').onclick=()=>{M.sim={y:5.2,v:0,t:0,rho:M.rho,rf:M.rf};M.tries++;};
    $('fDone').onclick=()=>{if(!M.last)return;const L=M.last,ok=L.floats&&L.frac>=0.70&&L.frac<=0.80;
      finishMission({pass:ok&&M.tries<=5,did:'You tested '+M.tries+' crate'+(M.tries>1?'s':'')+'. The final crate ('+L.rho+' kg/m³ in liquid of '+L.rf+' kg/m³) '+(L.floats?'floated with '+fx(L.frac*100)+' % submerged.':'sank to the bottom.'),
        rows:M.log.slice(-4).map(l=>['ρ '+l.rho+' in '+l.rf,l.floats?fx(l.frac*100)+' % submerged':'sinks']).concat([['Weight W = m·g',fx(L.rho*G,0)+' N'],['Buoyant force at rest',fx(L.Fb,0)+' N'],['Predicted fraction ρ_obj/ρ_liq',L.rho<L.rf?fx(L.rho/L.rf*100)+' %':'> 100 % → sinks'],['Target','70–80 % submerged']])});};
    $('fQuit').onclick=quitMission;ST.crate.position.set(ST.tx,5.2,ST.tz);
  }
  P.actor.root.position.copy(P.pos);P.actor.root.rotation.y=P.yaw;
}
function endStation(){S.station=null;S.fixedCam=null;closeSheet();ST.ball.visible=false;ST.trails.forEach(t=>scene.remove(t));ST.trails=[];ST.crate.position.set(ST.tx,5.2,ST.tz);cam.yaw=P.yaw;}
function stationTick(dt){
  if(S.station==='gravity'&&M.fly){
    const f=M.fly;f.t=Math.min(f.T,f.t+dt*f.k);
    const x=f.v*Math.cos(f.th)*f.t,y=Math.max(0,f.v*Math.sin(f.th)*f.t-0.5*f.g*f.t*f.t);
    ST.ball.position.set(-100+x,y+0.8,-205);
    if(f.n<100&&f.t>=f.T*f.n/99){const p=f.line.geometry.attributes.position;while(f.n<100&&f.t>=f.T*f.n/99){const tt=f.T*f.n/99;p.setXYZ(f.n,-100+f.v*Math.cos(f.th)*tt,Math.max(0,f.v*Math.sin(f.th)*tt-0.5*f.g*tt*tt)+0.8,-205);f.n++;}p.needsUpdate=true;f.line.geometry.setDrawRange(0,f.n);}
    if(f.t>=f.T){const Rg=x,H=Math.pow(f.v*Math.sin(f.th),2)/(2*f.g),hit=Math.abs(Rg-90)<=3;
      M.shots.push({a:Math.round(f.th*180/Math.PI),v:f.v,g:f.g,R:Rg,H,T:f.T});if(hit&&!M.hit){M.hit=true;M.hitTry=M.tries;}
      fxBurst(ST.ball.position);
      $('gOut').innerHTML='Shot '+M.tries+': range <b>'+fx(Rg)+' m</b> · max height <b>'+fx(H)+' m</b> · flight time <b>'+fx(f.T)+' s</b><br>'+(hit?'<b style="color:#3ddc84">On target!</b> Press Finish &amp; assess.':(Rg<90?'Fell '+fx(90-Rg)+' m short.':'Overshot by '+fx(Rg-90)+' m.'))+(f.k>1?' <i>(shown at ×'+fx(f.k)+' speed)</i>':'');
      M.fly=null;drawPlot($('plot'));}
  }
  if(S.station==='fluid'&&M.sim){
    const s=M.sim,m=s.rho,steps=8,h=dt/steps,floor=0.2,surf=3.2;let Fb=0,sub=0;
    for(let i=0;i<steps;i++){sub=clamp(surf-(s.y-0.5),0,1);Fb=s.rf*sub*G;
      const drag=-(900*sub+15)*s.v*(1+Math.abs(s.v));s.v+=(Fb-m*G+drag)/m*h;s.y+=s.v*h;
      if(s.y<floor+0.5){s.y=floor+0.5;if(s.v<0)s.v=0;}}
    s.t+=dt;ST.crate.position.y=s.y;
    const onFloor=s.y<=floor+0.501,floats=!onFloor||s.rho<s.rf;
    $('fOut').innerHTML='Weight W = m·g = <b>'+fx(m*G,0)+' N</b> ↓ &nbsp; Buoyant force = <b>'+fx(Fb,0)+' N</b> ↑<br>Submerged: <b>'+fx(sub*100)+' %</b> · '+(s.t<1.2?'falling…':(onFloor&&s.rho>=s.rf?'<b style="color:#ff7a7a">sinks</b> — denser than the liquid':'floating'));
    s.calm=(Math.abs(s.v)<0.01&&(onFloor||Math.abs(Fb-m*G)<0.004*m*G))?(s.calm||0)+dt:0;
    if(s.t>1.5&&s.calm>0.4){M.last={rho:s.rho,rf:s.rf,frac:sub,Fb,floats:floats&&!(onFloor&&s.rho>=s.rf)};M.log.push(M.last);M.sim=null;
      const L=M.last,ok=L.floats&&L.frac>=0.7&&L.frac<=0.8;
      $('fOut').innerHTML+='<br>'+(ok?'<b style="color:#3ddc84">In the target band!</b> Press Finish &amp; assess.':(L.floats?(L.frac<0.7?'Floats too high — make it denser.':'Floats too low — make it less dense.'):'Try a density below the liquid’s.'));}
  }
}
function drawPlot(cn){
  if(!cn||!M&&!drawPlot.cache)return;const shots=M?M.shots:drawPlot.cache;if(M)drawPlot.cache=shots;
  const x=cn.getContext('2d'),W=cn.width,H=cn.height,p=30;x.clearRect(0,0,W,H);
  const xm=Math.max(110,...shots.map(s=>s.R*1.08)),ym=Math.max(xm*(H-p-10)/(W-p-10),...shots.map(s=>s.H*1.1)),sx=(W-p-10)/xm,sy=(H-p-10)/ym;
  x.strokeStyle='#ffffff44';x.lineWidth=1;x.beginPath();x.moveTo(p,10);x.lineTo(p,H-p);x.lineTo(W-10,H-p);x.stroke();
  x.fillStyle='#9fb3c8';x.font='17px system-ui';x.fillText('0',p-4,H-8);x.fillText(fx(xm,0)+' m',W-70,H-8);x.fillText(fx(ym,0)+' m',2,22);
  x.fillStyle='#ff7a5c';x.fillRect(p+87*sx,H-p-4,6*sx,8);x.fillText('pad 90 m',p+90*sx-34,H-p+22);
  shots.slice(-6).forEach((s,i)=>{const th=s.a*Math.PI/180;x.strokeStyle='#'+trailCols[(shots.length-Math.min(6,shots.length)+i)%6].toString(16).padStart(6,'0');x.lineWidth=2.5;x.beginPath();
    for(let k=0;k<=40;k++){const t=s.T*k/40,X=p+s.v*Math.cos(th)*t*sx,Y=H-p-(s.v*Math.sin(th)*t-0.5*s.g*t*t)*sy;k?x.lineTo(X,Y):x.moveTo(X,Y);}x.stroke();});
}

function openBrief(def){
  const i=MISSIONS.indexOf(def);
  if(!unlocked(i)){toast('Locked — complete “'+MISSIONS[i-1].name+'” first.');return;}
  S.ui='brief';
  showOv('World '+def.world+' · '+def.name,
    '<div class="card"><small>'+def.officer.toUpperCase()+'</small><p>'+def.brief+'</p></div>'+
    '<div class="card"><small>SCIENTIFIC OBJECTIVE</small><p>'+def.objective+'</p><p class="sub">Topic: '+def.topic+'</p></div>'+
    '<div class="card"><small>EQUIPMENT</small><p>'+def.equip+'</p></div>'+
    '<div class="card"><small>MEDALS</small><p class="sub">Bronze: finish the mission · Silver: meet the experimental target · Gold: target met and every concept question correct.</p></div>'+
    '<div class="row"><button class="btn" id="brNo">Not now</button><button class="btn pri" id="brGo">Start mission</button></div>',false);
  $('brNo').onclick=closeOv;
  $('brGo').onclick=()=>{hideOv();S.ui=null;M={def};def.begin();};
}
function quitMission(){if(!M)return;const d=M.def;d.cleanup();M=null;S.freeze=false;carDefaults();}
function finishMission(res){
  const def=M.def;def.cleanup();M=null;S.freeze=false;carDefaults();S.ui='result';audio.blip(res.pass?660:300);
  let h='<div class="card"><small>PHYSICS TOPIC LEARNED</small><h3>'+def.topic+'</h3></div>'+
    '<div class="card"><small>WHAT YOU DID</small><p>'+res.did+'</p></div>'+
    '<div class="card"><small>EXPERIMENTAL OBSERVATION</small><table>'+res.rows.map(r=>'<tr><td>'+r[0]+'</td><td>'+r[1]+'</td></tr>').join('')+'</table>'+(res.graph?'<canvas id="rg" width="640" height="250"></canvas>':'')+'</div>'+
    '<div class="card"><small>SCIENTIFIC EXPLANATION</small><p>'+def.science+'</p><div class="eq">'+def.eq+'</div><p class="note">'+def.simNote+'</p></div>'+
    '<div class="card" id="qz"><small>CONCEPT CHECK</small>'+def.quiz.map((q,qi)=>'<p class="q">'+(qi+1)+'. '+q.q+'</p>'+q.o.map((o,oi)=>'<button class="opt" data-q="'+qi+'" data-o="'+oi+'">'+o+'</button>').join('')).join('')+'</div>'+
    '<div class="row"><button class="btn pri" id="qSub">Submit answers</button></div><div id="qRes"></div>';
  showOv('Mission Report · '+def.name,h,false);
  if(res.graph)res.graph($('rg'));
  const ans=[];
  $('qz').querySelectorAll('.opt').forEach(b=>b.onclick=()=>{if($('qSub').disabled)return;const q=+b.dataset.q;ans[q]=+b.dataset.o;
    $('qz').querySelectorAll('.opt[data-q="'+q+'"]').forEach(x=>x.classList.toggle('on',x===b));});
  $('qSub').onclick=()=>{
    if(def.quiz.some((q,i)=>ans[i]==null)){toast('Answer every question first.');return;}
    $('qSub').disabled=true;$('qSub').classList.add('hide');let right=0;
    def.quiz.forEach((q,i)=>{if(ans[i]===q.a)right++;$('qz').querySelectorAll('.opt[data-q="'+i+'"]').forEach(x=>{const o=+x.dataset.o;if(o===q.a)x.classList.add('good');else if(o===ans[i])x.classList.add('bad');});});
    const medal=res.pass?(right===def.quiz.length?3:2):1,old=save.medals[def.id]||0,gain=Math.max(0,medal-old)*50+10;
    save.medals[def.id]=Math.max(old,medal);save.xp+=gain;persist();
    const nm=['','BRONZE','SILVER','GOLD'][medal],score=Math.round((res.pass?60:25)+40*right/def.quiz.length*(res.pass?1:0.6));
    const nx=MISSIONS[MISSIONS.indexOf(def)+1];
    $('qRes').innerHTML='<div class="card medal m'+medal+'">● '+nm+' MEDAL<div style="font-size:13px;font-weight:500;color:#e8f1fa;margin-top:6px">Performance score '+score+'/100 · Concept questions '+right+'/'+def.quiz.length+' · +'+gain+' XP'+
      (res.pass?'':'<br>Experimental target not met — retry for Silver or Gold.')+(nx&&old<1?'<br>Unlocked: World '+nx.world+' · '+nx.name:'')+'</div></div>'+
      '<div class="row"><button class="btn" id="rRetry">Retry</button><button class="btn pri" id="rCont">Continue</button></div>';
    $('rRetry').onclick=()=>{hideOv();S.ui=null;M={def};def.begin();};$('rCont').onclick=closeOv;
    $('ovBody').scrollTop=$('ovBody').scrollHeight;
  };
}
function travel(def){
  hideOv();S.ui=null;if(M)quitMission();
  if(driving){driving=false;P.actor.root.visible=true;}
  P.pos.set(def.pos[0]+1.5,0,def.pos[1]+3.5);resolve(P.pos,0.4);
  const rp=[[0,-52,4.5,-60,Math.PI/2],[-110,113,-104,120,Math.PI/2],[-38,48.2,-30,57,Math.PI/2]].find(r=>r[0]===def.pos[0]&&r[1]===def.pos[1]);
  if(rp)placeCar(rp[2],rp[3],rp[4]);else placeCar(def.pos[0]+5,def.pos[1]-4.5,Math.PI/2);
  cam.yaw=0;camera.position.set(P.pos.x,4,P.pos.z-6);openBrief(def);
}

/* ============ 10b. PHYSICS LAB YARD: interactive equipment ============
   To add equipment: call labDef({id,name,equip,pos:[x,z],cam:{p,l},purpose,
   principle,eq,procedure:[...],simNote,build(g),open(),tick(dt),record(),
   report(trials)->{head,rows,graph,result}}). Trials are saved per station. */
const LABS={},LAB_ORDER=[];
const YARD={x:-30,z:30};
const alu=std(0xc4cad1,{metalness:0.85,roughness:0.3}),brass=std(0xc9a14a,{metalness:0.9,roughness:0.25}),
  wood=std(0x9b6b3d,{roughness:0.7}),darkM=std(0x2a2f35,{metalness:0.5,roughness:0.45}),tealM=std(0x1fb6a6,{roughness:0.4});
function labDef(d){LABS[d.id]=d;LAB_ORDER.push(d.id);const g=new THREE.Group();g.position.set(d.pos[0],0.17,d.pos[1]);scene.add(g);d.g=g;d.build(g);
  // floor marker + sign
  const m=new THREE.Mesh(new THREE.TorusGeometry(1.1,0.07,8,32),new THREE.MeshStandardMaterial({color:0,emissive:0x37e0c8,emissiveIntensity:2.2}));
  m.rotation.x=Math.PI/2;m.position.set(d.pos[0]+d.mk[0],0.2,d.pos[1]+d.mk[1]);scene.add(m);d.ring=m;
  const l=label('LAB · '+d.name.toUpperCase(),'#37e0c8',1.5);l.position.set(d.pos[0]+d.mk[0],2.6,d.pos[1]+d.mk[1]);scene.add(l);d.lbl=l;}
if(!save.lab||typeof save.lab!=='object')save.lab={};
if(!save.labDone||typeof save.labDone!=='object')save.labDone={};
function trials(id){return save.lab[id]||(save.lab[id]=[]);}
function addTrial(id,t){const a=trials(id);a.push(t);if(a.length>12)a.shift();persist();toast('Trial '+a.length+' recorded');audio.blip(520);}
// live strip chart inside the sheet
function strip(cn,series,tmax,ymin,ymax,ylab){if(!cn)return;const x=cn.getContext('2d'),W=cn.width,H=cn.height,p=30;x.clearRect(0,0,W,H);
  x.strokeStyle='#ffffff30';x.lineWidth=1;x.beginPath();x.moveTo(p,8);x.lineTo(p,H-18);x.lineTo(W-6,H-18);x.stroke();
  const zy=H-18-(H-26)*(0-ymin)/(ymax-ymin);if(ymin<0){x.beginPath();x.moveTo(p,zy);x.lineTo(W-6,zy);x.stroke();}
  x.fillStyle='#9fb3c8';x.font='15px system-ui';x.fillText(ylab,p+6,20);x.fillText(fx(ymax,1),2,16);x.fillText(fx(ymin,1),2,H-20);x.fillText(fx(tmax,0)+' s',W-40,H-2);
  series.forEach(s=>{if(!s.d.length)return;const t0=Math.max(0,s.d[s.d.length-1][0]-tmax);x.strokeStyle=s.c;x.lineWidth=2.5;x.beginPath();
    s.d.forEach((q,i)=>{const X=p+(W-p-6)*(q[0]-t0)/tmax,Y=H-18-(H-26)*(q[1]-ymin)/(ymax-ymin);i?x.lineTo(X,Y):x.moveTo(X,Y);});x.stroke();});}
// scatter + theory line for reports
function scatter(cn,pts,line,xl,yl){const x=cn.getContext('2d'),W=cn.width,H=cn.height,p=46;x.clearRect(0,0,W,H);
  const xm=Math.max(...pts.map(q=>q[0]),0.1)*1.15,ym=Math.max(...pts.map(q=>q[1]),line?line(xm):0,0.1)*1.15;
  x.strokeStyle='#ffffff40';x.lineWidth=1;x.beginPath();x.moveTo(p,10);x.lineTo(p,H-p+10);x.lineTo(W-10,H-p+10);x.stroke();
  x.fillStyle='#9fb3c8';x.font='17px system-ui';x.fillText(yl,p+8,24);x.fillText(xl,W-x.measureText(xl).width-12,H-8);
  x.fillText('0',p-14,H-p+14);x.fillText(fx(xm,2),W-60,H-p+30);x.fillText(fx(ym,2),2,18);
  const X=v=>p+(W-p-10)*v/xm,Y=v=>H-p+10-(H-p)*v/ym;
  if(line){x.strokeStyle='#ffb62e';x.lineWidth=2;x.setLineDash([8,6]);x.beginPath();for(let k=0;k<=40;k++){const v=xm*k/40;k?x.lineTo(X(v),Y(line(v))):x.moveTo(X(v),Y(line(v)));}x.stroke();x.setLineDash([]);}
  x.fillStyle='#37e0c8';pts.forEach(q=>{x.beginPath();x.arc(X(q[0]),Y(q[1]),6,0,7);x.fill();});}

let LS=null;   // live state of the open station
function startLab(id,mission){
  const d=LABS[id];if(driving){driving=false;P.actor.root.visible=true;}dropCarry();
  S.station='lab';S.lab=d;LS={mission:!!mission};
  S.fixedCam={pos:new THREE.Vector3(...d.cam.p),look:new THREE.Vector3(...d.cam.l),fit:d.fit};S.snap=true;
  P.pos.set(d.pos[0]+(d.fit?d.fit.w/2:1)+0.9,0,d.pos[1]+1.6);P.yaw=-Math.PI/2;if(id==='collide')P.pos.set(TRK.x1+0.8,0,TRK.z+1.4);P.actor.root.visible=false;P.actor.root.position.set(P.pos.x,0.16,P.pos.z);P.actor.root.rotation.y=P.yaw;
  openSheet('<h3>'+d.name+' · Lab Yard</h3><p class="sub" style="opacity:.8">'+d.purpose+'</p>'+d.controls()+
    '<canvas id="lc" width="640" height="170" style="width:100%;height:auto;background:#08111d;border-radius:8px;margin-top:8px;display:block"></canvas>'+
    '<div class="out" id="lo"></div><div class="row"><button class="pri" id="lGo">'+(d.goLabel||'Start')+'</button><button id="lRec">Record trial</button></div>'+
    '<div class="row"><button id="lRep">Report ('+trials(id).length+')</button><button id="lQuit">Leave</button></div>');
  $('lGo').onclick=()=>{d.go();audio.blip(330);};
  $('lRec').onclick=()=>{const t=d.record();if(t){addTrial(id,t);$('lRep').textContent='Report ('+trials(id).length+')';}};
  $('lRep').onclick=()=>labReport(d);
  $('lQuit').onclick=()=>{if(M&&M.def.lab===id)quitMission();else endLab();};
  d.open();
}
function endLab(){if(!S.lab)return;const d=S.lab;if(d.close)d.close();P.actor.root.visible=!driving;S.lab=null;S.station=null;S.fixedCam=null;LS=null;closeSheet();cam.yaw=P.yaw;}
function labReport(d,fromMenu){
  const tr=trials(d.id),r=d.report(tr);S.ui='report';ovFrom=fromMenu?'menu':'game';
  let first=false;if(tr.length>=3&&!save.labDone[d.id]){save.labDone[d.id]=true;save.xp+=40;persist();first=true;}
  showOv('Experiment Report · '+d.name,
    '<div class="card"><small>EQUIPMENT</small><h3>'+d.name+'</h3><p class="sub">'+d.equip+'</p></div>'+
    '<div class="card"><small>PURPOSE</small><p>'+d.purpose+'</p></div>'+
    '<div class="card"><small>PHYSICS PRINCIPLE</small><p>'+d.principle+'</p><div class="eq">'+d.eq+'</div></div>'+
    '<div class="card"><small>PROCEDURE</small><ol style="margin:4px 0;padding-left:20px">'+d.procedure.map(s=>'<li>'+s+'</li>').join('')+'</ol></div>'+
    '<div class="card"><small>OBSERVATIONS · '+tr.length+' TRIAL'+(tr.length===1?'':'S')+'</small>'+
      (tr.length?'<div style="overflow-x:auto"><table style="min-width:100%"><tr>'+r.head.map(h=>'<td style="color:#9fb3c8;font-weight:600">'+h+'</td>').join('')+'</tr>'+
        r.rows.map(row=>'<tr>'+row.map(c=>'<td style="text-align:left;color:#e8f1fa;font-weight:500">'+c+'</td>').join('')+'</tr>').join('')+'</table></div>':'<p class="sub">No trials yet. Run the experiment and tap “Record trial”.</p>')+
      (r.graph&&tr.length?'<canvas id="lrg" width="640" height="300"></canvas>':'')+'</div>'+
    '<div class="card"><small>RESULT</small><p>'+r.result+'</p>'+(first?'<p style="color:#ffcf40;font-weight:700">● Lab badge earned · +40 XP</p>':(tr.length<3?'<p class="sub">Record at least 3 trials to earn this lab’s badge.</p>':''))+'</div>'+
    '<div class="card"><small>SIMULATION NOTE</small><p class="note">'+d.simNote+'</p></div>'+
    '<div class="row"><button class="btn" id="rClr">Clear trials</button><button class="btn pri" id="rBack">Back</button></div>');
  if(r.graph&&tr.length)r.graph($('lrg'));
  $('rBack').onclick=closeOv;
  let arm=false;$('rClr').onclick=()=>{if(!arm){arm=true;$('rClr').textContent='Tap again to clear';return;}save.lab[d.id]=[];persist();closeOv();if(S.lab===d)$('lRep').textContent='Report (0)';};
}
const deg=Math.PI/180;
function setOut(h){const o=$('lo');if(o)o.innerHTML=h;}
function slider(id,label,min,max,step,val){return '<label>'+label+' <b id="'+id+'v"></b><input type="range" id="'+id+'" min="'+min+'" max="'+max+'" step="'+step+'" value="'+val+'"></label>';}
function bindS(id,fmt,cb){const el=$(id),f=()=>{$(id+'v').textContent=fmt(+el.value);cb(+el.value);};el.oninput=f;f();}
function gSeg(id){return '<div class="seg" id="'+id+'"><button data-v="9.8" class="on">Earth 9.8</button><button data-v="3.71">Mars 3.71</button><button data-v="1.62">Moon 1.62</button></div>';}

/* ---------- 1. Simple pendulum ---------- */
labDef({id:'pendulum',fit:{w:3.0,h:4.0},name:'Simple Pendulum',pos:[-43,18],mk:[0,3.4],cam:{p:[-43,2.4,26.6],l:[-43,2.05,18]},
  equip:'Rigid frame with pivot · light string · brass bob · protractor · stopwatch with light gate',
  purpose:'Find what sets a pendulum’s period, and use it to measure g.',
  principle:'The restoring force on the bob is −mg·sinθ. For small angles sinθ ≈ θ, so the motion is simple harmonic and the period depends only on the length and g. The mass cancels out. Large swings take a little longer than the formula predicts.',
  eq:'T = 2π √(L ÷ g)\nT² = (4π² ÷ g) · L    →   g = 4π² ÷ slope of the T² – L graph\nlarge swing:  T ≈ T₀ (1 + θ₀² ÷ 16)',
  procedure:['Choose the string length L, release angle θ₀ and bob mass.','Tap Release. The light gate times each full oscillation.','After at least two swings, tap Record trial.','Repeat for at least three different lengths, then open the report: the T² – L graph gives g.'],
  simNote:'Solved with the full equation θ″ = −(g/L)·sinθ − bθ′ (Runge–Kutta, tiny air damping b). The string is massless and inextensible.',
  goLabel:'Release',
  build(g){box(0.12,3.7,0.12,alu,-1.1,1.85,0,g);box(0.12,3.7,0.12,alu,1.1,1.85,0,g);box(2.4,0.12,0.16,alu,0,3.66,0,g);box(2.6,0.08,0.8,darkM,0,0.04,0,g);
    const piv=new THREE.Group();piv.position.set(0,3.58,0);g.add(piv);this.piv=piv;
    const s=new THREE.Mesh(new THREE.CylinderGeometry(0.008,0.008,1,6),std(0xeeeeee));s.geometry.translate(0,-0.5,0);piv.add(s);this.str=s;
    const b=new THREE.Mesh(new THREE.SphereGeometry(0.1,24,16),brass);b.castShadow=true;piv.add(b);this.bob=b;
    const pr=new THREE.Mesh(new THREE.RingGeometry(0.42,0.46,40,1,Math.PI*1.25,Math.PI*0.5),std(0xffffff,{side:THREE.DoubleSide,emissive:0x444444}));pr.position.set(0,3.58,-0.05);g.add(pr);
    box(0.06,0.2,0.2,std(0x111111,{emissive:0xff2020,emissiveIntensity:1.5}),0,0.5,0.25,g);
    this.L=1.5;this.pose(0);},
  pose(th){this.piv.rotation.z=th;this.str.scale.y=this.L;this.bob.position.y=-this.L;},
  controls(){return slider('pL','Length L',0.3,3.0,0.05,1.5)+slider('pA','Release angle θ₀',5,70,1,15)+slider('pM','Bob mass m',0.1,5,0.1,1)+gSeg('pG');},
  open(){Object.assign(LS,{L:1.5,A:15*deg,m:1,g:9.8,run:false,th:15*deg,w:0,t:0,cross:[],trace:[]});
    const d=this;const reset=()=>{LS.run=false;LS.th=LS.A;LS.w=0;LS.t=0;LS.cross=[];LS.trace=[];d.L=LS.L;d.bob.scale.setScalar(Math.cbrt(LS.m));d.pose(LS.th);};
    bindS('pL',v=>fx(v,2)+' m',v=>{LS.L=v;reset();});bindS('pA',v=>v+'°',v=>{LS.A=v*deg;reset();});bindS('pM',v=>fx(v,1)+' kg',v=>{LS.m=v;reset();});
    seg('pG',v=>{LS.g=+v;reset();});this.reset=reset;reset();},
  go(){this.reset();LS.run=true;},
  tick(dt){if(!LS)return;const n=24,h=dt/n,L=LS.L,g=LS.g,b=0.02;
    if(LS.run)for(let i=0;i<n;i++){const f=(th,w)=>[w,-(g/L)*Math.sin(th)-b*w];
      const k1=f(LS.th,LS.w),k2=f(LS.th+k1[0]*h/2,LS.w+k1[1]*h/2),k3=f(LS.th+k2[0]*h/2,LS.w+k2[1]*h/2),k4=f(LS.th+k3[0]*h,LS.w+k3[1]*h);
      const pth=LS.th;LS.th+=h/6*(k1[0]+2*k2[0]+2*k3[0]+k4[0]);LS.w+=h/6*(k1[1]+2*k2[1]+2*k3[1]+k4[1]);LS.t+=h;
      if(pth<0&&LS.th>=0)LS.cross.push(LS.t-h*LS.th/(LS.th-pth));}
    if(LS.run){LS.trace.push([LS.t,LS.th/deg]);if(LS.trace.length>600)LS.trace.shift();}
    this.pose(LS.th);
    const T0=2*Math.PI*Math.sqrt(L/g),c=LS.cross,Tm=c.length>=2?(c[c.length-1]-c[0])/(c.length-1):null;
    strip($('lc'),[{d:LS.trace,c:'#37e0c8'}],8,-LS.A/deg*1.1,LS.A/deg*1.1,'angle θ (°) vs time');
    setOut('Stopwatch <b>'+fx(LS.t,2)+' s</b> · oscillations <b>'+Math.max(0,c.length-1)+'</b> · θ = '+fx(LS.th/deg)+'°<br>Measured period T = <b>'+(Tm?fx(Tm,3)+' s':'—')+'</b> &nbsp; Formula 2π√(L/g) = <b>'+fx(T0,3)+' s</b>'+
      (LS.A>25*deg?'<br><i>Large swing: corrected T ≈ '+fx(T0*(1+LS.A*LS.A/16),3)+' s</i>':''));},
  record(){const c=LS.cross;if(c.length<3){toast('Let it swing at least two full oscillations first.');return null;}
    return {L:LS.L,A:Math.round(LS.A/deg),m:LS.m,g:LS.g,T:(c[c.length-1]-c[0])/(c.length-1),T0:2*Math.PI*Math.sqrt(LS.L/LS.g)};},
  report(tr){const e=tr.filter(t=>t.g===9.8),pts=e.map(t=>[t.L,t.T*t.T]);
    const sxy=pts.reduce((a,p)=>a+p[0]*p[1],0),sxx=pts.reduce((a,p)=>a+p[0]*p[0],0),slope=sxx?sxy/sxx:0,gEst=slope?4*Math.PI*Math.PI/slope:0;
    const Ls=new Set(e.map(t=>t.L)).size;
    return {head:['L (m)','θ₀','m (kg)','g','T measured','2π√(L/g)'],rows:tr.map(t=>[fx(t.L,2),t.A+'°',fx(t.m,1),t.g,fx(t.T,3)+' s',fx(t.T0,3)+' s']),
      graph:pts.length?cn=>scatter(cn,pts,slope?(v=>slope*v):null,'L (m)','T² (s²)'):null,
      result:Ls>=2?'On Earth, the slope of T² against L is '+fx(slope,3)+' s²/m, so g = 4π² ÷ slope = <b>'+fx(gEst,2)+' m/s²</b> (accepted value 9.8 m/s², difference '+fx(Math.abs(gEst-9.8)/9.8*100,1)+' %). '+
        (new Set(tr.map(t=>t.m)).size>1?'Changing the mass did not change the period.':'Try a different mass: the period should not change.'):
        'Record Earth trials at two or more different lengths to calculate g from the graph.'};}
});

/* ---------- 2. Spring balance / oscillator ---------- */
labDef({id:'spring',fit:{w:2.0,h:4.0},name:'Spring Balance',pos:[-31,18],mk:[0,3.4],cam:{p:[-31,2.3,26.4],l:[-31,2.0,18]},
  equip:'Retort stand · steel spring of stiffness k · slotted masses · metre scale · stopwatch',
  purpose:'Test Hooke’s law and find how a mass on a spring oscillates.',
  principle:'A spring pulls back with a force proportional to its extension (Hooke’s law). Hanging a mass stretches it until kx = mg. Pulled further and released, the mass oscillates with a period set by m and k — gravity only shifts the centre of the motion.',
  eq:'F = k·x   (Hooke’s law)      equilibrium: x₀ = m·g ÷ k\nT = 2π √(m ÷ k)     →   T² = (4π² ÷ k) · m',
  procedure:['Choose the spring stiffness k and the hanging mass m.','Read the equilibrium extension x₀ on the scale: the balance shows F = kx₀ = mg.','Tap Pull & release to start oscillations; the stopwatch times them.','Record trials for at least three masses, then open the report: the T² – m graph gives k.'],
  simNote:'x″ = g − (k/m)·x − c·x′ with light damping c. The spring is ideal (massless, perfectly elastic below 2 m extension).',
  goLabel:'Pull & release',
  build(g){box(0.6,0.08,0.6,darkM,0,0.04,0,g);box(0.1,3.8,0.1,alu,-0.25,1.9,0,g);box(0.8,0.08,0.1,alu,0.1,3.78,0,g);
    const pts=[];for(let i=0;i<=360;i++){const a=i/360*16*Math.PI*2;pts.push(new THREE.Vector3(Math.cos(a)*0.1,-i/360,Math.sin(a)*0.1));}
    const sp=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),720,0.012,6,false),std(0xb8c0c8,{metalness:0.9,roughness:0.3}));sp.position.set(0.35,3.74,0);g.add(sp);this.sp=sp;
    const ms=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.12,0.24,24),brass);ms.castShadow=true;g.add(ms);this.ms=ms;
    const sc=canvasTex(64,1024,(x,w,h)=>{x.fillStyle='#f4f1e8';x.fillRect(0,0,w,h);x.fillStyle='#222';x.font='bold 22px system-ui';
      for(let i=0;i<=200;i+=2){const y=i/200*h;x.fillRect(0,y,i%10===0?34:16,2);if(i%20===0&&i)x.fillText(i/100+'',36,y+8);}});
    const board=new THREE.Mesh(new THREE.PlaneGeometry(0.22,2.0),std(0xffffff,{map:sc,roughness:0.6}));board.position.set(0.68,3.24-1.0,0.02);g.add(board);
    const ptr=box(0.2,0.02,0.02,std(0xff3030,{emissive:0xff2020,emissiveIntensity:1.2}),0.53,0,0,g,false);this.ptr=ptr;this.pose(0.2);},
  pose(x){const len=0.5+x;this.sp.scale.y=len;this.ms.position.set(0.35,3.74-len-0.12,0);this.ptr.position.y=3.74-0.5-x;},
  controls(){return slider('sK','Spring stiffness k',12,100,1,40)+slider('sM','Hanging mass m',0.1,2,0.05,0.5)+slider('sA','Extra pull A',0.05,0.3,0.01,0.15);},
  open(){Object.assign(LS,{k:40,m:0.5,A:0.15,run:false,x:0,v:0,t:0,cross:[],trace:[]});
    const reset=()=>{LS.run=false;LS.x=LS.m*G/LS.k;LS.v=0;LS.t=0;LS.cross=[];LS.trace=[];};
    bindS('sK',v=>v+' N/m',v=>{LS.k=v;reset();});bindS('sM',v=>fx(v,2)+' kg',v=>{LS.m=v;reset();});bindS('sA',v=>fx(v*100,0)+' cm',v=>{LS.A=v;reset();});this.reset=reset;reset();},
  go(){this.reset();LS.x+=LS.A;LS.run=true;},
  tick(dt){if(!LS)return;const n=16,h=dt/n,x0=LS.m*G/LS.k;
    if(LS.run)for(let i=0;i<n;i++){const a=G-(LS.k/LS.m)*LS.x-0.06*LS.v;const px=LS.x-x0;LS.v+=a*h;LS.x+=LS.v*h;LS.t+=h;const nx=LS.x-x0;if(px<0&&nx>=0)LS.cross.push(LS.t-h*nx/(nx-px));}
    if(LS.run){LS.trace.push([LS.t,(LS.x-x0)*100]);if(LS.trace.length>600)LS.trace.shift();}
    this.pose(Math.min(2.0,LS.x));
    const c=LS.cross,Tm=c.length>=2?(c[c.length-1]-c[0])/(c.length-1):null,T0=2*Math.PI*Math.sqrt(LS.m/LS.k);
    strip($('lc'),[{d:LS.trace,c:'#ffb62e'}],6,-LS.A*110,LS.A*110,'displacement from equilibrium (cm)');
    setOut('Spring balance: x₀ = mg/k = <b>'+fx(x0*100,1)+' cm</b> → F = kx₀ = <b>'+fx(LS.k*x0,2)+' N</b> (= mg = '+fx(LS.m*G,2)+' N)<br>Stopwatch '+fx(LS.t,2)+' s · measured T = <b>'+(Tm?fx(Tm,3)+' s':'—')+'</b> · 2π√(m/k) = <b>'+fx(T0,3)+' s</b>'+(x0+LS.A>2?'<br><b style="color:#ff7a7a">Beyond the elastic limit — use a stiffer spring.</b>':''));},
  record(){const c=LS.cross;if(c.length<3){toast('Pull & release, then wait for two full oscillations.');return null;}
    return {k:LS.k,m:LS.m,x0:LS.m*G/LS.k,F:LS.m*G,T:(c[c.length-1]-c[0])/(c.length-1),T0:2*Math.PI*Math.sqrt(LS.m/LS.k)};},
  report(tr){const k0=tr.length?tr[tr.length-1].k:0,e=tr.filter(t=>t.k===k0),pts=e.map(t=>[t.m,t.T*t.T]);
    const sxy=pts.reduce((a,p)=>a+p[0]*p[1],0),sxx=pts.reduce((a,p)=>a+p[0]*p[0],0),slope=sxx?sxy/sxx:0,kEst=slope?4*Math.PI*Math.PI/slope:0;
    return {head:['k (N/m)','m (kg)','x₀ (cm)','F = kx₀ (N)','T measured','2π√(m/k)'],rows:tr.map(t=>[t.k,fx(t.m,2),fx(t.x0*100,1),fx(t.F,2),fx(t.T,3)+' s',fx(t.T0,3)+' s']),
      graph:pts.length?cn=>scatter(cn,pts,slope?(v=>slope*v):null,'m (kg)','T² (s²) for k = '+k0+' N/m'):null,
      result:new Set(e.map(t=>t.m)).size>=2?'For the '+k0+' N/m spring, the slope of T² against m is '+fx(slope,3)+' s²/kg, so k = 4π² ÷ slope = <b>'+fx(kEst,1)+' N/m</b> (set value '+k0+' N/m). The extension grew in proportion to the load, as Hooke’s law predicts.':'Record trials with two or more masses on the same spring to find k from the graph.'};}
});

/* ---------- 3. Inclined plane ---------- */
labDef({id:'incline',fit:{w:5.4,h:3.2},name:'Inclined Plane',pos:[-17,18],mk:[-1.5,3.4],cam:{p:[-17.4,2.1,26.2],l:[-17.4,1.25,18]},
  equip:'Adjustable 4 m ramp · block · interchangeable surfaces · two light gates · stopwatch',
  purpose:'Find how the slope angle and friction decide whether a block slides and how fast it accelerates.',
  principle:'Gravity’s pull mg splits into a part along the slope, mg·sinθ, and a part pressing into it, mg·cosθ. Friction can resist up to μ·mg·cosθ. The block slides only when mg·sinθ is larger; then its acceleration is g(sinθ − μcosθ). The mass cancels, so heavy and light blocks accelerate equally.',
  eq:'along slope: F = mg sinθ − μ mg cosθ = m·a\na = g (sinθ − μ cosθ)       slides if tanθ > μ\ntime over L: t = √(2L ÷ a)',
  procedure:['Pick the ramp angle θ, the surface (μ) and the block mass.','Tap Release. The gates time the block over the 3.6 m between them.','Record the trial; the game works out a = 2L ÷ t².','Repeat at several angles. The report compares your measured a with g(sinθ − μcosθ).'],
  simNote:'One friction coefficient for starting and sliding (real static friction is a little higher). No rolling, no air drag.',
  goLabel:'Release',
  build(g){this.grp=new THREE.Group();this.grp.position.set(1.6,0.05,0);g.add(this.grp);
    const pl=new THREE.Mesh(new THREE.BoxGeometry(4,0.08,1.0),this.surfM=std(0x9b6b3d,{roughness:0.7}));pl.position.set(-2,0,0);pl.castShadow=pl.receiveShadow=true;this.grp.add(pl);
    this.leg=box(0.1,1,0.1,alu,0,0.5,0,g);box(4.6,0.06,1.4,darkM,-0.4,0.03,0,g);
    const blk=new THREE.Mesh(new THREE.BoxGeometry(0.34,0.22,0.34),std(0xd9482f,{roughness:0.5}));blk.castShadow=true;this.grp.add(blk);this.blk=blk;
    [-3.8,-0.2].forEach(u=>{const gt=new THREE.Group();gt.position.set(u,0.04,0);[0.55,-0.55].forEach(z=>box(0.05,0.5,0.05,darkM,0,0.25,z,gt));box(0.05,0.05,1.15,std(0x111111,{emissive:0x30ff70,emissiveIntensity:1.5}),0,0.5,0,gt);this.grp.add(gt);});
    this.arrows={};[['W',0xffffff],['N',0x37e0c8],['f',0xff8a1f]].forEach(a=>{const ar=new THREE.ArrowHelper(new THREE.Vector3(0,1,0),new THREE.Vector3(),1,a[1],0.15,0.09);ar.line.material.depthTest=false;ar.cone.material.depthTest=false;ar.renderOrder=6;blk.add(ar);this.arrows[a[0]]=ar;});
    this.setAngle(25*deg);this.place(0);},
  setAngle(th){this.th=th;this.grp.rotation.z=-th;const hx=1.6-4*Math.cos(th),hy=4*Math.sin(th);this.leg.position.set(hx,hy/2+0.05,0);this.leg.scale.y=Math.max(0.05,hy);},
  place(s){this.blk.position.set(-3.75+s,0.15,0);},
  controls(){return slider('iA','Ramp angle θ',5,60,1,25)+'<div class="seg" id="iMu"><button data-v="0.05">Ice μ=0.05</button><button data-v="0.3" class="on">Wood μ=0.30</button><button data-v="0.8">Rubber μ=0.80</button></div>'+slider('iM','Block mass m',0.5,10,0.5,2);},
  open(){Object.assign(LS,{th:25*deg,mu:0.3,m:2,run:false,s:0,v:0,t:0,tg:null,tA:null,trace:[]});const d=this;
    const reset=()=>{LS.run=false;LS.s=0;LS.v=0;LS.t=0;LS.tg=null;LS.tA=null;LS.trace=[];d.setAngle(LS.th);d.place(0);d.surfM.color.setHex(LS.mu<0.1?0xcfe9f5:LS.mu<0.5?0x9b6b3d:0x2a2a2a);};
    bindS('iA',v=>v+'°',v=>{LS.th=v*deg;reset();});bindS('iM',v=>fx(v,1)+' kg',v=>{LS.m=v;reset();});seg('iMu',v=>{LS.mu=+v;reset();});this.reset=reset;reset();},
  go(){this.reset();LS.run=true;},
  tick(dt){if(!LS)return;const th=LS.th,mu=LS.mu,m=LS.m,W=m*G,Nf=W*Math.cos(th),Fs=W*Math.sin(th),slides=Math.tan(th)>mu,a=slides?G*(Math.sin(th)-mu*Math.cos(th)):0;
    const fr=slides?mu*Nf:Fs;
    if(LS.run&&slides&&LS.s<3.5){const pv=LS.s;LS.v+=a*dt;LS.s=Math.min(3.5,LS.s+LS.v*dt);LS.t+=dt;
      if(LS.tA===null&&LS.s>=0.05)LS.tA=LS.t-dt*(LS.s-0.05)/Math.max(1e-6,LS.s-pv);
      if(LS.tg===null&&LS.s>=3.5&&LS.tA!==null){LS.tg=LS.t-LS.tA;audio.blip(700);}
      LS.trace.push([LS.t,LS.v]);}
    this.place(LS.s);
    const sc=1/Math.max(W,1)*0.9,setA=(k,dx,dy,f)=>{const ar=this.arrows[k];const L=Math.max(0.02,f*sc);ar.setDirection(new THREE.Vector3(dx,dy,0).normalize());ar.setLength(L,Math.min(0.15,L*0.4),0.09);};
    setA('W',Math.sin(th),-Math.cos(th),W);setA('N',0,1,Nf);setA('f',-1,0,fr);
    strip($('lc'),[{d:LS.trace,c:'#ff8a1f'}],Math.max(2,LS.t),0,Math.max(1,Math.sqrt(2*Math.max(a,0.1)*3.5)*1.1),'speed along ramp (m/s) vs time');
    setOut('Down-slope pull mg sinθ = <b>'+fx(Fs,1)+' N</b> · max friction μmg cosθ = <b>'+fx(mu*Nf,1)+' N</b> · normal force = '+fx(Nf,1)+' N<br>'+
      (slides?'Slides: a = g(sinθ − μcosθ) = <b>'+fx(a,2)+' m/s²</b> · gate time <b>'+(LS.tg?fx(LS.tg,2)+' s':LS.run?'timing…':'—')+'</b>'+(LS.tg?' → measured a ≈ 2L/t² (from rest at gate 1)':''):
       '<b style="color:#ffb62e">Block stays put:</b> tanθ = '+fx(Math.tan(th),2)+' ≤ μ = '+mu+' — friction balances the pull.')+
      '<br><span class="note">Arrows: white = weight, teal = normal force, orange = friction.</span>');},
  record(){const th=LS.th,mu=LS.mu,slides=Math.tan(th)>mu;
    if(slides&&!LS.tg){toast('Release the block and let it pass both gates first.');return null;}
    const at=slides?G*(Math.sin(th)-mu*Math.cos(th)):0;
    // block passes gate 1 almost from rest; use s = ½at² over the 3.45 m gate gap with the gate-1 speed included
    let am=0;if(slides){const v1=Math.sqrt(2*at*0.05),L=3.45,t=LS.tg;am=2*(L-v1*t)/(t*t);}
    return {th:Math.round(th/deg),mu,m:LS.m,slides,t:LS.tg||0,am,at};},
  report(tr){const sl=tr.filter(t=>t.slides),mu0=sl.length?sl[sl.length-1].mu:0.3,pts=sl.filter(t=>t.mu===mu0).map(t=>[Math.sin(t.th*deg),t.am]);
    const good=sl.filter(t=>Math.abs(t.am-t.at)<0.05*Math.max(t.at,0.2)).length;
    return {head:['θ','μ','m (kg)','slides?','gate time','a measured','g(sinθ−μcosθ)'],rows:tr.map(t=>[t.th+'°',t.mu,fx(t.m,1),t.slides?'yes':'no',t.slides?fx(t.t,2)+' s':'—',t.slides?fx(t.am,2):'0',fx(t.at,2)]),
      graph:pts.length?cn=>scatter(cn,pts,null,'sin θ','a (m/s²), μ = '+mu0):null,
      result:sl.length?good+' of '+sl.length+' sliding trials matched a = g(sinθ − μcosθ) within 5 %. '+(new Set(tr.map(t=>t.m)).size>1?'Changing the mass did not change the acceleration — mass cancels out.':'Try another mass: the acceleration should not change.')+(tr.some(t=>!t.slides)?' Trials where tanθ ≤ μ did not slide.':''):'No sliding trials yet. Increase the angle until tanθ is greater than μ.'};}
});

/* ---------- 4. Collision track (momentum) ---------- */
const TRK={x0:-45,x1:-31,z:43.5};
labDef({id:'collide',fit:{w:14.6,h:1.6},name:'Collision Track',pos:[-38,43.5],mk:[3.5,3.2],cam:{p:[-38,7.5,47.5],l:[-38,0.3,43.5]},
  equip:'14 m low-friction track · two carts with spring or Velcro bumpers · slotted masses · speed sensors',
  purpose:'Test the conservation of momentum and see when kinetic energy is lost.',
  principle:'In any collision the carts push on each other with equal and opposite forces for the same time (Newton’s third law), so the total momentum before equals the total after. Kinetic energy is only kept in a perfectly elastic collision; when the carts stick together, some becomes heat and sound.',
  eq:'momentum p = m·v       m_A·u_A + m_B·u_B = m_A·v_A + m_B·v_B\nKE = ½ m v²\nelastic (B at rest): v_B = 2m_A·u_A ÷ (m_A + m_B)\nstick together:  v = m_A·u_A ÷ (m_A + m_B)',
  procedure:['Set the masses of cart A and cart B and the launch speed of A (B starts at rest).','Choose the bumper: spring (elastic), soft (e = 0.5) or Velcro (carts stick).','Tap Launch. The sensors read both speeds before and after the collision.','Record the trial and compare total momentum and kinetic energy before and after.'],
  simNote:'The collision is instantaneous, using a coefficient of restitution e. Track friction and air drag are ignored.',
  goLabel:'Launch',
  build(g){const L=TRK.x1-TRK.x0;g.position.set((TRK.x0+TRK.x1)/2,0.17,TRK.z);
    box(L,0.12,0.36,alu,0,0.18,0,g);[-L/2+0.6,0,L/2-0.6].forEach(x=>box(0.1,0.12,0.5,darkM,x,0.06,0,g));
    box(0.1,0.35,0.4,darkM,-L/2,0.36,0,g);box(0.1,0.35,0.4,std(0xff8a1f,{roughness:0.6}),L/2,0.36,0,g);
    const cart=c=>{const k=new THREE.Group();box(0.44,0.14,0.3,std(c,{roughness:0.4,metalness:0.3}),0,0.34,0,k);[-0.15,0.15].forEach(x=>[-0.17,0.17].forEach(z=>{const w=cyl(0.05,0.05,0.04,darkM,x,0.27,z,k,12);w.rotation.x=Math.PI/2;}));
      const st=new THREE.Group();st.position.y=0.41;k.add(st);k.userData.st=st;g.add(k);return k;};
    this.cA=cart(0x1fb6a6);this.cB=cart(0xd9482f);
    this.bA=box(0.05,0.08,0.18,std(0xffd23f,{roughness:0.5}),0.245,0.34,0,this.cA);this.bB=box(0.05,0.08,0.18,std(0xffd23f,{roughness:0.5}),-0.245,0.34,0,this.cB);
    this.lA=label('A','#1fb6a6',0.7);this.lA.position.y=1.0;this.cA.add(this.lA);this.lB=label('B','#d9482f',0.7);this.lB.position.y=1.0;this.cB.add(this.lB);},
  stack(k,m){const st=k.userData.st;while(st.children.length)st.remove(st.children[0]);const n=Math.round(m/0.5);for(let i=1;i<n;i++)cyl(0.1,0.1,0.06,brass,0,0.035+(i-1)*0.065,0,st,16);},
  controls(){return slider('cMA','Cart A mass m_A',0.5,4,0.5,1)+slider('cMB','Cart B mass m_B',0.5,4,0.5,2)+slider('cU','Launch speed of A, u_A',0.5,6,0.1,3)+
    '<div class="seg" id="cE"><button data-v="1" class="on">Spring e=1</button><button data-v="0.5">Soft e=0.5</button><button data-v="0">Velcro (stick)</button></div><div id="cMis"></div>';},
  open(){Object.assign(LS,{mA:1,mB:2,uA:3,e:1,run:false,xA:TRK.x0+1.2,xB:TRK.x0+6.5,vA:0,vB:0,hit:false,t:0,done:false,trA:[],trB:[],res:null});const d=this;
    const reset=()=>{LS.run=false;LS.done=false;LS.hit=false;LS.xA=TRK.x0+1.2;LS.xB=TRK.x0+6.5;LS.vA=0;LS.vB=0;LS.t=0;LS.trA=[];LS.trB=[];LS.res=null;d.stack(d.cA,LS.mA);d.stack(d.cB,LS.mB);
      d.bA.material.color.setHex(LS.e===0?0x6b6b6b:0xffd23f);};
    bindS('cMA',v=>fx(v,1)+' kg',v=>{LS.mA=v;reset();});bindS('cMB',v=>fx(v,1)+' kg',v=>{LS.mB=v;reset();});bindS('cU',v=>fx(v,1)+' m/s',v=>{LS.uA=v;reset();});
    seg('cE',v=>{LS.e=+v;reset();});this.reset=reset;reset();
    if(LS.mission){LS.goals={el:false,st:false};this.misUI();}},
  misUI(){const g=LS.goals,el=$('cMis');if(!el)return;el.innerHTML='<div class="out" style="border-left:3px solid #ffb62e">Mission targets (cart B = 2.0 kg, at rest):<br>'+
    (g.el?'✅':'⬜')+' <b>Spring bumper:</b> make cart B leave at <b>3.0 m/s</b> (±0.1)<br>'+(g.st?'✅':'⬜')+' <b>Velcro:</b> make the joined carts move at <b>1.0 m/s</b> (±0.05)'+
    (g.el&&g.st?'<br><button class="btn pri" id="cFin" style="width:100%;margin-top:8px">Finish &amp; assess</button>':'')+'</div>';
    if(g.el&&g.st)$('cFin').onclick=()=>M&&M.def.finish();},
  go(){this.reset();LS.vA=LS.uA;LS.run=true;},
  tick(dt){if(!LS)return;const n=8,h=dt/n;
    if(LS.run&&!LS.done){for(let i=0;i<n;i++){LS.xA+=LS.vA*h;LS.xB+=LS.vB*h;LS.t+=h;
      if(!LS.hit&&LS.xB-LS.xA<=0.5&&LS.vA>LS.vB){const{mA,mB,e}=LS,uA=LS.vA,uB=LS.vB,p=mA*uA+mB*uB;
        LS.vA=(p-mB*e*(uA-uB))/(mA+mB);LS.vB=(p+mA*e*(uA-uB))/(mA+mB);LS.hit=true;LS.xA=LS.xB-0.5;audio.thud(0.5);
        LS.res={uA,uB,vA:LS.vA,vB:LS.vB,pb:p,pa:mA*LS.vA+mB*LS.vB,kb:0.5*mA*uA*uA+0.5*mB*uB*uB,ka:0.5*mA*LS.vA*LS.vA+0.5*mB*LS.vB*LS.vB};}
      if(LS.hit&&LS.e===0)LS.xA=LS.xB-0.5;
      if(LS.xB>=TRK.x1-0.35||LS.xA<=TRK.x0+0.3||(LS.hit&&Math.abs(LS.vA)<1e-3&&Math.abs(LS.vB)<1e-3)){LS.done=true;LS.run=false;this.check();break;}}
      LS.trA.push([LS.t,LS.vA]);LS.trB.push([LS.t,LS.vB]);}
    const cx=(TRK.x0+TRK.x1)/2;this.cA.position.x=LS.xA-cx;this.cB.position.x=LS.xB-cx;
    strip($('lc'),[{d:LS.trA,c:'#1fb6a6'},{d:LS.trB,c:'#ff6b5a'}],Math.max(3,LS.t),Math.min(0,...LS.trA.map(q=>q[1]))-0.2,Math.max(1,LS.uA*1.3,...LS.trB.map(q=>q[1]*1.1)),'velocity (m/s): A teal, B red');
    const r=LS.res;
    setOut(r?'Before: p = '+fx(LS.mA,1)+'×'+fx(r.uA,2)+' = <b>'+fx(r.pb,2)+' kg·m/s</b> · KE = <b>'+fx(r.kb,2)+' J</b><br>After: v_A = <b>'+fx(r.vA,2)+'</b>, v_B = <b>'+fx(r.vB,2)+' m/s</b> → p = <b>'+fx(r.pa,2)+' kg·m/s</b> · KE = <b>'+fx(r.ka,2)+' J</b>'+
      (r.kb-r.ka>0.005?' (<b>'+fx((r.kb-r.ka)/r.kb*100,0)+' %</b> KE lost)':' (KE kept)'):'Total momentum before launch: '+fx(LS.mA*LS.uA,2)+' kg·m/s (after launch). Tap Launch.');},
  check(){if(!LS.mission||!LS.res)return;const r=LS.res,g=LS.goals,okB=Math.abs(LS.mB-2)<1e-6;
    if(okB&&LS.e===1&&Math.abs(r.vB-3)<=0.1&&!g.el){g.el=true;toast('Target 1 met: cart B left at '+fx(r.vB,2)+' m/s');LS.elRes={...r,mA:LS.mA,mB:LS.mB};}
    if(okB&&LS.e===0&&Math.abs(r.vB-1)<=0.05&&!g.st){g.st=true;toast('Target 2 met: joined carts at '+fx(r.vB,2)+' m/s');LS.stRes={...r,mA:LS.mA,mB:LS.mB};}
    if(!okB)toast('Mission targets need cart B set to 2.0 kg.');
    LS.tries=(LS.tries||0)+1;this.misUI();},
  record(){if(!LS.res){toast('Launch the carts first.');return null;}const r=LS.res;return {mA:LS.mA,mB:LS.mB,e:LS.e,uA:r.uA,vA:r.vA,vB:r.vB,pb:r.pb,pa:r.pa,kb:r.kb,ka:r.ka};},
  report(tr){const ok=tr.filter(t=>Math.abs(t.pb-t.pa)<0.01*Math.max(1,t.pb)).length;
    return {head:['m_A','m_B','bumper','u_A','v_A','v_B','p before','p after','KE before','KE after'],rows:tr.map(t=>[t.mA,t.mB,t.e===1?'spring':t.e===0?'Velcro':'soft',fx(t.uA,2),fx(t.vA,2),fx(t.vB,2),fx(t.pb,2),fx(t.pa,2),fx(t.kb,2)+' J',fx(t.ka,2)+' J']),
      graph:tr.length?cn=>scatter(cn,tr.map(t=>[t.pb,t.pa]),v=>v,'p before (kg·m/s)','p after (kg·m/s)'):null,
      result:'Momentum was conserved in '+ok+' of '+tr.length+' trials (points lie on the line p_after = p_before). Kinetic energy '+(tr.some(t=>t.e<1)?'was lost whenever the bumper was soft or Velcro — the energy became heat and sound — but momentum was still conserved.':'was conserved with the spring bumper. Try Velcro to see energy lost while momentum is kept.')};}
});

/* ---------- 5. Lever / see-saw (moments) ---------- */
labDef({id:'lever',fit:{w:4.8,h:1.8},name:'Lever Balance',pos:[-21,43.5],mk:[0,3.2],cam:{p:[-21,2.2,50.4],l:[-21,0.75,43.5]},
  equip:'4.2 m beam on a central pivot · two pans · 0.5 kg slotted masses · metre markings',
  purpose:'Find the condition for a lever to balance (the principle of moments).',
  principle:'A force turns a lever with a moment equal to force × perpendicular distance from the pivot. The beam balances when the anticlockwise moments equal the clockwise moments. A small mass far from the pivot can balance a large mass close to it.',
  eq:'moment = F × d = m·g·d\nbalanced:  m₁·g·d₁ = m₂·g·d₂   →   m₁·d₁ = m₂·d₂\nbeam: I·α = Σ moments',
  procedure:['Place mass m₁ at distance d₁ on the left and m₂ at d₂ on the right.','Predict which way the beam will tip, then tap Release beam.','Adjust a mass or distance until the beam stays level.','Record balanced and unbalanced trials and compare m₁·d₁ with m₂·d₂.'],
  simNote:'The beam is a uniform rigid rod pivoted at its centre (so its own weight has no moment), with light damping. It stops when an end touches the ground.',
  goLabel:'Release beam',
  build(g){const fl=new THREE.Shape();fl.moveTo(-0.3,0);fl.lineTo(0.3,0);fl.lineTo(0,0.62);fl.lineTo(-0.3,0);
    const fm=new THREE.Mesh(new THREE.ExtrudeGeometry(fl,{depth:0.4,bevelEnabled:false}),darkM);fm.position.z=-0.2;fm.castShadow=true;g.add(fm);
    const bm=new THREE.Group();bm.position.y=0.66;g.add(bm);this.bm=bm;
    const sc=canvasTex(1024,32,(x,w,h)=>{x.fillStyle='#c79a63';x.fillRect(0,0,w,h);x.fillStyle='#3a2a18';for(let i=-21;i<=21;i++){const X=w/2+i*w/42;x.fillRect(X-1,0,2,i%5===0?h:h*0.45);}});
    const beam=new THREE.Mesh(new THREE.BoxGeometry(4.2,0.08,0.3),[wood,wood,std(0xffffff,{map:sc,roughness:0.7}),wood,wood,wood]);beam.castShadow=true;bm.add(beam);
    this.p1=new THREE.Group();this.p2=new THREE.Group();bm.add(this.p1,this.p2);},
  stack(gp,m){while(gp.children.length)gp.remove(gp.children[0]);const n=Math.round(m/0.5);for(let i=0;i<n;i++)cyl(0.12,0.12,0.07,brass,0,0.08+i*0.075,0,gp,18);},
  controls(){return slider('lM1','Left mass m₁',0.5,5,0.5,2)+slider('lD1','Left distance d₁',0.2,2,0.1,0.6)+slider('lM2','Right mass m₂',0.5,5,0.5,1)+slider('lD2','Right distance d₂',0.2,2,0.1,1.0);},
  open(){Object.assign(LS,{m1:2,d1:0.6,m2:1,d2:1,phi:0,w:0,run:false,t:0});const d=this;
    const reset=()=>{LS.run=false;LS.phi=0;LS.w=0;LS.t=0;d.p1.position.x=-LS.d1;d.p2.position.x=LS.d2;d.stack(d.p1,LS.m1);d.stack(d.p2,LS.m2);d.bm.rotation.z=0;};
    bindS('lM1',v=>fx(v,1)+' kg',v=>{LS.m1=v;reset();});bindS('lD1',v=>fx(v,1)+' m',v=>{LS.d1=v;reset();});bindS('lM2',v=>fx(v,1)+' kg',v=>{LS.m2=v;reset();});bindS('lD2',v=>fx(v,1)+' m',v=>{LS.d2=v;reset();});this.reset=reset;reset();},
  go(){this.reset();LS.run=true;},
  tick(dt){if(!LS)return;const M1=LS.m1*G*LS.d1,M2=LS.m2*G*LS.d2,I=3*4.2*4.2/12+LS.m1*LS.d1*LS.d1+LS.m2*LS.d2*LS.d2,lim=Math.asin(0.62/2.1);
    if(LS.run){LS.t+=dt;const tau=(M1-M2)*Math.cos(LS.phi);LS.w+=(tau/I-1.2*LS.w)*dt;LS.phi+=LS.w*dt;if(Math.abs(LS.phi)>lim){LS.phi=Math.sign(LS.phi)*lim;LS.w=0;}}
    this.bm.rotation.z=LS.phi;
    const bal=Math.abs(M1-M2)<0.01*Math.max(M1,M2);
    setOut('Anticlockwise moment (left) m₁gd₁ = <b>'+fx(M1,2)+' N·m</b><br>Clockwise moment (right) m₂gd₂ = <b>'+fx(M2,2)+' N·m</b><br>'+
      (bal?'<b style="color:#3ddc84">Balanced — moments are equal.</b>':'<b style="color:#ffb62e">'+(M1>M2?'Left':'Right')+' side goes down</b> (net moment '+fx(Math.abs(M1-M2),2)+' N·m)'));
    const c=$('lc');if(c){const x=c.getContext('2d'),W=c.width,H=c.height;x.clearRect(0,0,W,H);const mx=Math.max(M1,M2,1);
      [[M1,'#1fb6a6','m₁gd₁'],[M2,'#ff6b5a','m₂gd₂']].forEach((b,i)=>{x.fillStyle=b[1];x.fillRect(110,30+i*60,(W-140)*b[0]/mx,40);x.fillStyle='#9fb3c8';x.font='18px system-ui';x.fillText(b[2],10,58+i*60);});}},
  record(){const M1=LS.m1*LS.d1,M2=LS.m2*LS.d2;return {m1:LS.m1,d1:LS.d1,m2:LS.m2,d2:LS.d2,M1,M2,res:Math.abs(M1-M2)<0.01*Math.max(M1,M2)?'balanced':M1>M2?'left down':'right down'};},
  report(tr){const b=tr.filter(t=>t.res==='balanced');
    return {head:['m₁ (kg)','d₁ (m)','m₁d₁','m₂ (kg)','d₂ (m)','m₂d₂','result'],rows:tr.map(t=>[fx(t.m1,1),fx(t.d1,1),fx(t.M1,2),fx(t.m2,1),fx(t.d2,1),fx(t.M2,2),t.res]),
      graph:tr.length?cn=>scatter(cn,tr.map(t=>[t.M2,t.M1]),v=>v,'m₂·d₂ (kg·m)','m₁·d₁ (kg·m)'):null,
      result:b.length?(b.length===1?'In the balanced trial':'In all '+b.length+' balanced trials')+' m₁·d₁ equalled m₂·d₂ (points on the dashed line). Where they differed, the side with the larger moment went down — the principle of moments.':'Find a balanced arrangement: make m₁·d₁ equal m₂·d₂.'};}
});

// Yard decoration: sign, floor lines, benches
(function(){const s=label('PHYSICS LAB YARD','#37e0c8',3.2);s.position.set(-30,7.5,52.5);scene.add(s);YARD.sign=s;
  const ln=std(0xffd23f,{roughness:0.6,polygonOffset:true,polygonOffsetFactor:-6,polygonOffsetUnits:-6});
  [[-30,13.2,40,0.15],[-30,38.6,40,0.15],[-30,48.8,40,0.15]].forEach(l=>{const p=new THREE.Mesh(new THREE.PlaneGeometry(l[2],l[3]),ln);p.rotation.x=-Math.PI/2;p.position.set(l[0],0.175,l[1]);scene.add(p);});
  LAB_ORDER.forEach(id=>{const d=LABS[id];addCollider(d.pos[0],d.pos[1],id==='collide'?14:id==='incline'?5:2.6,id==='collide'?0.8:1.4,3.5);});
})();
function nearestLab(){let best=null;LAB_ORDER.forEach(id=>{const d=LABS[id];if(Math.hypot(P.pos.x-d.pos[0]-d.mk[0],P.pos.z-d.pos[1]-d.mk[1])<1.6)best=d;});return best;}
function tickLabs(dt){YARD.sign.visible=!S.station;LAB_ORDER.forEach(id=>{const d=LABS[id];d.ring.visible=d.lbl.visible=!S.station;});if(S.lab)S.lab.tick(dt);}

/* ========================= 11. UI ========================= */
function openSheet(html){$('sheetBody').innerHTML=html;$('sheet').classList.remove('hide');}
function closeSheet(){$('sheet').classList.add('hide');$('sheetBody').innerHTML='';}
function seg(id,cb){const el=$(id);el.querySelectorAll('button').forEach(b=>b.onclick=()=>{el.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));cb(b.dataset.v);});}
let toastT=0;function toast(t){const p=$('prompt');p.textContent=t;p.classList.remove('hide');toastT=2.4;}
function showOv(title,html,back){$('ovTitle').textContent=title;$('ovBody').innerHTML=html;$('ovBody').scrollTop=0;$('ovBack').classList.toggle('hide',back===false);$('ov').classList.remove('hide');$('menu').classList.add('hide');}
function hideOv(){$('ov').classList.add('hide');}
let ovFrom='menu',started=false;
function closeOv(){hideOv();if(S.ui==='brief'||S.ui==='result'||ovFrom==='game'){S.ui=null;}else openMenu();}
$('ovBack').onclick=closeOv;
function openMenu(){S.ui='menu';hideOv();$('menu').classList.remove('hide');$('mPlay').textContent=(save.xp>0||started)?'▶ CONTINUE':'▶ PLAY';}
function play(){if(!S.ready)return;started=true;S.ui=null;$('menu').classList.add('hide');hideOv();audio.start();}
$('mPlay').onclick=play;$('bMenu').onclick=()=>{if(!S.ui)openMenu();};$('bQuit').onclick=quitMission;

const WORLDS=[
 [1,'Motion City','Distance, displacement, speed, velocity, acceleration','Vectors · relative motion · motion graphs','motion'],
 [2,'Newton’s Force Zone','Newton’s three laws, inertia, force, friction','Momentum · impulse · rotational motion · torque',['newton','momentum']],
 [3,'Energy Industrial World','Work, energy, power, conservation of energy','Collisions · simple machines · elasticity and springs',3],
 [4,'Gravity Mountains','Gravitation, free fall, projectile motion','Circular motion · banking · escape speed','gravity'],
 [5,'Fluid Ocean','Density, pressure, buoyancy, Archimedes’ principle','Pascal’s law · Bernoulli · submarine ballast','fluid'],
 [6,'Wave Lab','Frequency, wavelength, amplitude, wave speed','Superposition · standing waves · Doppler effect',6],
 [7,'Sound Valley','Sound, pitch, loudness, echo, resonance','Ultrasound · SONAR · musical instruments',6],
 [8,'Thermal Power City','Temperature, heat, expansion, conduction, convection, radiation','Thermodynamics · heat engines · specific heat',6],
 [9,'Optics World','Reflection, refraction, mirrors, lenses, dispersion','Total internal reflection · telescopes · microscopes',6],
 [10,'Electricity City','Charge, current, voltage, resistance, Ohm’s law','Electrostatics · capacitors · electric field',6],
 [11,'Power Grid','Circuits, electrical power, energy, household wiring','Series and parallel · AC · safety devices',6],
 [12,'Magnetism','Build an electromagnet','Magnetic fields · force on a current · electric motor',6],
 [13,'Electromagnetic Induction','Generate electricity','Faraday’s law · generators · transformers · AC',6],
 [14,'Modern Physics','Atomic research centre','Atomic structure · photoelectric effect · semiconductors',6],
 [15,'Nuclear Physics','Nuclear science simulator','Radioactivity · half-life · fission and fusion',6],
 [16,'Astronomy','Space station and satellites','Orbital motion · Kepler’s laws · rockets',6]];
function openMap(){
  if(!S.ready)return;
  ovFrom=S.ui==='menu'?'menu':'game';S.ui='map';
  const btn=d=>{const i=MISSIONS.indexOf(d),ok=unlocked(i),md=save.medals[d.id]||0;
    return ok?'<span class="tagp ok">PLAYABLE · '+d.name+(md?' · '+['','Bronze','Silver','Gold'][md]:'')+'</span><br><button data-m="'+d.id+'">Travel &amp; start</button><br>'
      :'<span class="tagp lock">LOCKED · '+d.name+' · finish “'+MISSIONS[i-1].name+'” first</span><br>';};
  showOv('World Map · 16 Physics Worlds','<div class="card wcard play"><div class="wnum">L</div><div class="grow"><h3>Physics Lab Yard</h3><p>Free experiments: pendulum, spring balance, inclined plane, collision track, lever. Plus balls, cones and drums to pick up, throw and crash into.</p><p class="sub">'+LAB_ORDER.filter(id=>save.labDone[id]).length+' of '+LAB_ORDER.length+' lab badges earned</p><button data-y="1">Travel to Lab Yard</button></div></div>'+
    WORLDS.map(w=>{const ids=Array.isArray(w[4])?w[4]:typeof w[4]==='string'?[w[4]]:[];const ds=ids.map(missionById);
    return '<div class="card wcard'+(ds.length?' play':'')+'"><div class="wnum">'+w[0]+'</div><div class="grow"><h3>'+w[1]+'</h3><p>'+w[2]+'</p><p class="sub">Sub-levels: '+w[3]+'</p>'+
      (ds.length?ds.map(btn).join(''):'<span class="tagp">NOT BUILT YET · planned for Stage '+w[4]+'</span>')+'</div></div>';}).join(''));
  $('ovBody').querySelectorAll('button[data-m]').forEach(b=>b.onclick=()=>{started=true;audio.start();travel(missionById(b.dataset.m));});
  $('ovBody').querySelector('button[data-y]').onclick=()=>{started=true;audio.start();hideOv();S.ui=null;if(M)quitMission();if(driving){driving=false;P.actor.root.visible=true;}
    P.pos.set(-30,0,49.5);P.yaw=Math.PI;placeCar(-36,57,Math.PI/2);cam.yaw=Math.PI;camera.position.set(-30,4,55);};
}
$('mMap').onclick=openMap;
$('mChar').onclick=()=>{if(!S.ready)return;ovFrom='menu';S.ui='char';
  const draw=()=>{showOv('Character Selection','<div class="chars">'+CHARS.map((c,i)=>'<button data-i="'+i+'" class="'+(i===save.ch?'on':'')+'"><i style="background:'+['#5b6b4a','#b85a8a','#9aa3ad'][i]+'"></i><b>'+c.name+'</b><br><span class="sub" style="font-size:11.5px;opacity:.75">'+c.role+'</span></button>').join('')+'</div><div class="card" style="margin-top:10px"><p class="sub">Rigged 3D characters with idle, walk and run animation that blend with your speed. Outfits and vehicle-entry animations are planned for Stage 5.</p></div>');
    $('ovBody').querySelectorAll('button[data-i]').forEach(b=>b.onclick=()=>{setCharacter(+b.dataset.i);draw();});};draw();};
$('mGar').onclick=()=>{ovFrom='menu';S.ui='gar';
  showOv('Vehicle Garage · Car Lab','<div class="card"><small>FRONTIER GT TEST CAR</small><h3>Tune the physics for free roam</h3>'+
    '<div class="seg" id="cPaint">'+PAINTS.map((p,i)=>'<button data-v="'+i+'" style="background:#'+p.toString(16).padStart(6,'0')+';height:34px"></button>').join('')+'</div>'+
    '<label>Vehicle mass <b id="cM" style="float:right;color:#ffb62e"></b><input type="range" id="cMs" min="600" max="4000" step="100" value="'+save.carMass+'"></label>'+
    '<div class="seg" id="cMu"><button data-v="0.8">Dry μ=0.8</button><button data-v="0.4">Wet μ=0.4</button><button data-v="0.1">Ice μ=0.1</button></div>'+
    '<div class="out" id="cOut"></div><p class="note">Engine: 5400 N driving force, 90 kW power limit. Missions use their own settings.</p></div>'+
    '<div class="card"><small>MORE VEHICLES</small><p class="sub">Bus, truck, motorcycle, train, aeroplane, helicopter, boat, submarine, rocket and rover arrive in Stage 3, each with its own Physics model.</p></div>');
  const up=()=>{save.carMass=+$('cMs').value;$('cM').textContent=save.carMass+' kg';const tr=save.carMu*save.carMass*G;
    $('cOut').innerHTML='Launch acceleration = min(F, μmg) ÷ m = <b>'+fx(Math.min(5400,tr)/save.carMass,2)+' m/s²</b><br>Braking deceleration μg = <b>'+fx(save.carMu*G,2)+' m/s²</b><br>Stopping distance from 72 km/h = <b>'+fx(400/(2*save.carMu*G))+' m</b><br>Max cornering speed on a 20 m curve = <b>'+fx(Math.sqrt(save.carMu*G*20)*3.6,0)+' km/h</b>';
    if(!M)carDefaults();persist();};
  $('cMs').oninput=up;$('cMu').querySelectorAll('button').forEach(b=>b.classList.toggle('on',+b.dataset.v===save.carMu));seg('cMu',v=>{save.carMu=+v;up();});
  $('cPaint').querySelectorAll('button').forEach(b=>b.classList.toggle('on',+b.dataset.v===save.paint));
  seg('cPaint',v=>{save.paint=+v;paintMat.color.setHex(PAINTS[save.paint]);persist();});up();};
$('mAca').onclick=()=>{ovFrom='menu';S.ui='aca';
  showOv('Physics Academy',MISSIONS.map(d=>'<div class="card"><small>WORLD '+d.world+'</small><h3>'+d.topic+'</h3><p>'+d.science+'</p><div class="eq">'+d.eq+'</div><p class="note">Game model: '+d.simNote+'</p></div>').join('')+
   '<div class="card"><small>LAB NOTEBOOK · PHYSICS LAB YARD</small>'+LAB_ORDER.map(id=>'<p style="display:flex;align-items:center;gap:8px;margin:7px 0"><span style="flex:1"><b>'+LABS[id].name+'</b><br><span class="sub">'+trials(id).length+' trials'+(save.labDone[id]?' · ● badge earned':'')+'</span></span><button class="btn" data-lab="'+id+'" style="flex:none;padding:7px 12px">Report</button></p>').join('')+'</div>'+
   '<div class="card"><small>UNITS USED IN THE GAME</small><p>Distance m · time s · speed m/s (×3.6 = km/h) · mass kg · force N · acceleration m/s² · density kg/m³ · power W · momentum kg·m/s · moment N·m · g = 9.8 m/s² on Earth.</p></div>');
  $('ovBody').querySelectorAll('button[data-lab]').forEach(b=>b.onclick=()=>labReport(LABS[b.dataset.lab],true));};
$('mAch').onclick=()=>{ovFrom='menu';S.ui='ach';
  const tot=MISSIONS.reduce((a,d)=>a+(save.medals[d.id]||0),0),pks=Math.round(tot/(MISSIONS.length*3)*100),cert=MISSIONS.every(d=>(save.medals[d.id]||0)>=2);
  showOv('Achievements','<div class="card"><small>PHYSICS KNOWLEDGE SCORE</small><h3>'+pks+' / 100</h3><p class="sub">Level '+(Math.floor(save.xp/200)+1)+' · '+save.xp+' XP</p></div>'+
   MISSIONS.map(d=>{const m=save.medals[d.id]||0;return '<div class="card"><small>WORLD '+d.world+'</small><h3>'+d.name+'</h3><p class="'+(m?'m'+m:'sub')+'" style="font-weight:700">'+(m?'● '+['','Bronze','Silver','Gold'][m]+' medal':'No medal yet')+'</p></div>';}).join('')+
   '<div class="card"><small>LAB BADGES</small>'+LAB_ORDER.map(id=>'<p class="'+(save.labDone[id]?'m3':'sub')+'" style="font-weight:700;margin:5px 0">'+(save.labDone[id]?'● ':'○ ')+LABS[id].name+'</p>').join('')+'<p class="sub">Earn a badge by recording 3 trials and opening the report.</p></div>'+
   '<div class="card"><small>SCIENCE CERTIFICATE</small><h3>Mechanics &amp; Fluids Cadet</h3><p class="sub">'+(cert?'Unlocked — Silver or better in every mission.':'Locked — earn Silver or better in every mission.')+'</p></div>');};
$('mSet').onclick=()=>{ovFrom='menu';S.ui='set';
  showOv('Settings','<div class="card"><small>GRAPHICS QUALITY</small><div class="seg" id="sQ"><button data-v="high">High</button><button data-v="medium">Medium</button><button data-v="low">Low (fastest)</button></div>'+
   '<p class="sub">High: bloom, film tone mapping, sharp shadows, 8 pedestrians, 12 traffic cars. Low: no post-processing or shadows, for older phones.'+(canPost?'':' <b>Your device does not support post-processing, so High and Medium run without bloom.</b>')+'</p></div>'+
   '<div class="card"><small>SOUND</small><div class="seg" id="sS"><button data-v="1">Engine sound on</button><button data-v="0">Off</button></div></div>'+
   '<div class="card"><small>PROGRESS</small><p class="sub">Medals and XP are stored in this browser only.</p><button class="btn" id="sRe" style="width:100%">Reset progress</button></div>'+
   '<div class="card"><small>CONTROLS</small><p class="sub">Touch: left thumb joystick, drag on the right to look, buttons to jump, use, accelerate and brake. Keyboard: WASD or arrows, Shift run, Space jump / handbrake, E use, M map, Esc menu.</p></div>'+
   '<div class="card"><small>CREDITS</small><p class="sub">Character models and animations: Mixamo (Adobe), from the three.js examples. Water normal map: three.js examples. Engine: three.js r128. Everything else is generated in code.</p></div>');
  $('sQ').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.v===save.quality));
  seg('sQ',v=>{save.quality=v;persist();applyQuality();});
  $('sS').querySelectorAll('button').forEach(b=>b.classList.toggle('on',(b.dataset.v==='1')===!!save.sound));
  seg('sS',v=>{save.sound=v==='1';persist();if(!save.sound)audio.stop();});
  let arm=false;$('sRe').onclick=()=>{if(!arm){arm=true;$('sRe').textContent='Tap again to erase medals and XP';return;}save.xp=0;save.medals={};persist();$('sRe').textContent='Progress reset';};};
function applyQuality(){setupRenderer();const q=QUAL[save.quality];setTrafficCount(q.traffic);if(S.ready)spawnPeds(q.peds);}

const mm=$('mm'),mx=mm.getContext('2d');
function drawMini(){
  const W=208,c=W/2,s=c/150,t=driving?car.pos:P.pos;
  mx.save();mx.clearRect(0,0,W,W);mx.beginPath();mx.arc(c,c,c,0,7);mx.clip();mx.fillStyle='#4d7a3c';mx.fillRect(0,0,W,W);
  const X=x=>c+(x-t.x)*s,Z=z=>c+(z-t.z)*s;
  mx.fillStyle='#1f6a9a';mx.fillRect(X(244),0,W,W);
  mx.strokeStyle='#33363b';mmRoads.forEach(r=>{mx.lineWidth=Math.max(2,r[4]*s);mx.beginPath();mx.moveTo(X(r[0]),Z(r[1]));mx.lineTo(X(r[2]),Z(r[3]));mx.stroke();});
  mx.fillStyle='#b9bec6';mmBuild.forEach(b=>mx.fillRect(X(b[0]),Z(b[1]),b[2]*s,b[3]*s));
  mx.fillStyle='#e8ecf0';TRAF.forEach(q=>{mx.fillRect(X(q.x)-1.5,Z(q.z)-1.5,3,3);});
  MISSIONS.forEach((d,i)=>{let dx=(d.pos[0]-t.x)*s,dz=(d.pos[1]-t.z)*s;const m=Math.hypot(dx,dz);if(m>c-9){dx*=(c-9)/m;dz*=(c-9)/m;}
    mx.fillStyle=unlocked(i)?'#ffb62e':'#8a7a5a';mx.beginPath();mx.arc(c+dx,c+dz,7,0,7);mx.fill();mx.fillStyle='#1a1300';mx.font='bold 11px system-ui';mx.textAlign='center';mx.fillText(d.world,c+dx,c+dz+4);});
  if(M&&M.def.id==='motion'&&M.i<CPS.length){mx.strokeStyle='#fff';mx.lineWidth=3;mx.beginPath();mx.arc(X(CPS[M.i][0]),Z(CPS[M.i][1]),8,0,7);mx.stroke();}
  {let dx=(YARD.x-t.x)*s,dz=(YARD.z-t.z)*s;const m=Math.hypot(dx,dz);if(m>c-9){dx*=(c-9)/m;dz*=(c-9)/m;}mx.fillStyle='#37e0c8';mx.fillRect(c+dx-7,c+dz-7,14,14);mx.fillStyle='#06221e';mx.font='bold 11px system-ui';mx.textAlign='center';mx.fillText('L',c+dx,c+dz+4);}
  if(!driving){mx.fillStyle='#e8f1fa';mx.fillRect(X(car.pos.x)-4,Z(car.pos.z)-4,8,8);}
  const yaw=driving?car.yaw:P.yaw;mx.translate(c,c);mx.rotate(Math.atan2(Math.sin(yaw),-Math.cos(yaw)));
  mx.fillStyle='#fff';mx.beginPath();mx.moveTo(0,-10);mx.lineTo(7,8);mx.lineTo(0,4);mx.lineTo(-7,8);mx.closePath();mx.fill();mx.restore();
}

let near=null,frame=0;
function updateHUD(dt){
  const hud=$('hud'),showHud=!S.ui;hud.classList.toggle('hide',!showHud);if(!showHud)return;
  const st=!!S.station;
  $('joy').classList.toggle('hide',st);$('btns').classList.toggle('hide',st);$('keys').classList.toggle('hide',st||!!M);
  $('bGas').classList.toggle('hide',!driving);$('bJump').textContent=carryB?'THROW':'JUMP';$('bAct').textContent=carryB?'DROP':'USE';$('bBrake').classList.toggle('hide',!driving);$('bJump').classList.toggle('hide',driving);
  $('spd').classList.toggle('hide',!driving);$('bQuit').classList.toggle('hide',!M||st);
  if(driving){$('spd').firstElementChild.textContent=Math.round(Math.abs(car.v)*3.6);$('spd').lastElementChild.textContent='a '+(car.a>=0?'+':'')+fx(car.a)+' m/s² · '+car.mass+' kg';}
  $('stam').firstElementChild.style.width=(P.stam*100)+'%';
  $('lv').textContent='LV '+(Math.floor(save.xp/200)+1);$('xpb').firstElementChild.style.width=(save.xp%200/2)+'%';
  $('mi').innerHTML=M?M.def.hud():S.lab?'<b>'+S.lab.name+'</b> · '+S.lab.equip:(trackLine()||'<b>Free roam</b> · drive to an orange beacon, or visit the <b>Physics Lab Yard</b> (teal L on the map). ☰ → World Map to travel.');
  near=null;let txt='';
  if(!M){const p=driving?car.pos:P.pos;
    MISSIONS.forEach((d,i)=>{if(Math.hypot(p.x-d.pos[0],p.z-d.pos[1])<(driving?6:4.5)){near={t:'m',d};txt=(unlocked(i)?'Start: ':'Locked: ')+d.name;}});}
  if(!near&&!st&&!driving){const lb=carryB?null:nearestLab();if(lb){near={t:'l',d:lb};txt='Open lab: '+lb.name;}}
  if(!near&&!st&&!driving){if(carryB){near={t:'drop'};txt='Drop '+carryB.name+(coarse?' · THROW to throw':' · Space to throw');}
    else{const b=nearestBody();if(b){near={t:'b',b};txt=(b.m>LIFT_MAX?'Too heavy: ':'Pick up ')+b.name+' · '+b.m+' kg';}}}
  if(!near&&!st){
    if(driving){if(Math.abs(car.v)<1.2&&!(M&&S.freeze)){near={t:'x'};txt='Exit car';}}
    else if(P.pos.distanceTo(car.pos)<4.5){near={t:'c'};txt='Drive car';}
  }
  if(toastT>0){toastT-=dt;if(toastT<=0)$('prompt').classList.add('hide');}
  else{$('prompt').classList.toggle('hide',!near);if(near)$('prompt').textContent=(document.body.classList.contains('touch')?'USE · ':'E · ')+txt;}
  if(inp.act&&near){if(near.t==='l')startLab(near.d.id);else if(near.t==='b')pickUp(near.b);else if(near.t==='drop')dropCarry();else if(near.t==='m')openBrief(near.d);else if(near.t==='c')enterCar();else if(near.t==='x'&&!(M&&!S.station))exitCar();else if(near.t==='x')toast('Finish or quit the mission to leave the car.');}
  if((frame++&3)===0)drawMini();
}

/* ========================= 12. AUDIO + EFFECTS ========================= */
const audio={ctx:null,
  start(){if(!save.sound||this.ctx)return;try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const a=new C();this.ctx=a;
    const g=a.createGain();g.gain.value=0;const f=a.createBiquadFilter();f.type='lowpass';f.frequency.value=700;
    const o1=a.createOscillator(),o2=a.createOscillator();o1.type='sawtooth';o2.type='square';o2.detune.value=-1200;
    const g2=a.createGain();g2.gain.value=0.35;o1.connect(f);o2.connect(g2);g2.connect(f);f.connect(g);g.connect(a.destination);o1.start();o2.start();
    Object.assign(this,{g,f,o1,o2});}catch(e){this.ctx=null;}},
  stop(){if(this.ctx){try{this.ctx.close();}catch(e){}this.ctx=null;}},
  tick(){if(!this.ctx)return;const v=Math.abs(car.v),gear=Math.min(4,Math.floor(v/9)),rpm=(v-gear*9)/9;
    const fr=45+gear*8+rpm*70+(driving&&inp.gas?12:0),t=this.ctx.currentTime;
    this.o1.frequency.setTargetAtTime(fr,t,0.05);this.o2.frequency.setTargetAtTime(fr,t,0.05);
    this.f.frequency.setTargetAtTime(500+v*30+(inp.gas?400:0),t,0.08);
    this.g.gain.setTargetAtTime(driving&&!S.ui?0.045+Math.min(0.05,v*0.002):0,t,0.1);},
  thud(v){if(!this.ctx)return;try{const a=this.ctx,o=a.createOscillator(),g=a.createGain();o.type='triangle';o.frequency.value=70+v*60;o.frequency.setTargetAtTime(40,a.currentTime,0.05);g.gain.value=0.05+v*0.2;g.gain.setTargetAtTime(0,a.currentTime+0.02,0.05);o.connect(g);g.connect(a.destination);o.start();o.stop(a.currentTime+0.3);}catch(e){}},
  blip(f){if(!this.ctx)return;try{const a=this.ctx,o=a.createOscillator(),g=a.createGain();o.frequency.value=f;g.gain.value=0.08;g.gain.setTargetAtTime(0,a.currentTime+0.08,0.06);o.connect(g);g.connect(a.destination);o.start();o.stop(a.currentTime+0.4);}catch(e){}}};
const PUFFS=[];const puffMat=new THREE.SpriteMaterial({map:TX.smoke,transparent:true,depthWrite:false,opacity:0.6,color:0xdddddd});
for(let i=0;i<40;i++){const s=new THREE.Sprite(puffMat.clone());s.visible=false;scene.add(s);PUFFS.push({s,t:9,vx:0,vy:0,vz:0});}
let puffI=0;
function puff(x,y,z,vx,vy,vz,size){const p=PUFFS[puffI++%PUFFS.length];p.s.position.set(x,y,z);p.vx=vx;p.vy=vy;p.vz=vz;p.t=0;p.size=size||1;p.s.visible=true;}
function smoke(c){[-0.86,0.86].forEach(o=>{puff(c.pos.x+Math.cos(c.yaw)*o-Math.sin(c.yaw)*1.4,0.4,c.pos.z-Math.sin(c.yaw)*o-Math.cos(c.yaw)*1.4,(R()-.5)*0.6,0.5,(R()-.5)*0.6,1);});}
function fxBurst(p){for(let i=0;i<8;i++)puff(p.x,p.y+0.6,p.z,(R()-.5)*3,1+R()*2,(R()-.5)*3,1.4);}
function updatePuffs(dt){PUFFS.forEach(p=>{if(p.t>1.4){p.s.visible=false;return;}p.t+=dt;p.s.position.x+=p.vx*dt;p.s.position.y+=p.vy*dt;p.s.position.z+=p.vz*dt;
  const k=p.t/1.4,s=(0.8+k*3)*p.size;p.s.scale.set(s,s,s);p.s.material.opacity=0.55*(1-k);});}

/* ========================= ASSET LOADING ========================= */
// models ship as base64 inside .js files (the host serves scripts, not .glb)
function loadModels(){
  const keys=['soldier','michelle','xbot'];let done=0;
  const loader=new THREE.GLTFLoader();
  const fin=()=>{done++;$('load').textContent='Loading 3D characters… '+Math.round(done/keys.length*100)+'%';if(done===keys.length)ready();};
  keys.forEach(k=>{const sc=document.createElement('script');sc.src='models/'+k+'.js';
    sc.onload=()=>{try{const b64=(window.PF_MODELS||{})[k],bin=atob(b64),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
        delete window.PF_MODELS[k];loader.parse(u.buffer,'',g=>{prepModel(k,g);fin();},e=>{console.warn('model failed',k,e);fin();});}catch(e){console.warn('model failed',k,e);fin();}};
    sc.onerror=()=>{console.warn('model script failed',k);fin();};document.head.appendChild(sc);});
}
function ready(){
  S.ready=true;$('load').textContent=Object.keys(TPL).length?'Ready':'Characters could not load — using simple figures';
  setCharacter(clamp(save.ch|0,0,CHARS.length-1));
  [[4,-48.5,1],[-106,108,0],[-93,-198,1],[206,5,0]].forEach((n,i)=>{const a=makeActor(n[2]);if(!a)return;a.root.position.set(n[0],0.16,n[1]);a.root.rotation.y=i*1.7;scene.add(a.root);OFFICERS.push(a);});
  spawnPeds(QUAL[save.quality].peds);
}

/* ========================= 13. MAIN LOOP ========================= */
setupRenderer();setTrafficCount(QUAL[save.quality].traffic);
P.actor=makeBoxHuman(0xff8a1f);P.actor.root.visible=false;scene.add(P.actor.root);
loadModels();
let last=performance.now();
function loop(now){
  requestAnimationFrame(loop);
  const dt=Math.min(0.05,(now-last)/1000);last=now;S.time+=dt;
  readInput();
  const paused=!!S.ui&&S.ui!=='menu';
  if(!paused){
    if(!S.ui){if(!driving)updatePlayer(dt);updateCar(dt);if(M)M.def.tick(dt);}
    updateTraffic(dt);updatePeds(dt);if(S.ui!=='menu'){updateBodies(dt);tickLabs(dt);}
  }
  OFFICERS.forEach(o=>animActor(o,0,false,dt));if(window.__pf&&__pf.hook)__pf.hook(dt);
  S.blades.forEach((b,i)=>b.rotation.x+=dt*(0.8+i*0.15));
  MISSIONS.forEach(d=>{d.marker.visible=!M&&!S.station;d.marker.children[1].rotation.z+=dt;});
  if(S.waterN){S.waterN.offset.x+=dt*0.004;S.waterN.offset.y+=dt*0.007;}
  updatePuffs(dt);audio.tick();
  updateCamera(dt);
  updateHUD(dt);
  if(usePost&&composer)composer.render(dt);else renderer.render(scene,camera);
}
window.__pf={LABS,BODIES,startLab,get LS(){return LS;},get carryB(){return carryB;},pickUp,throwCarry,mk:makeActor,anim:animActor,hook:null,S,P,car,save,MISSIONS,get M(){return M;},travel,inp,keys,TPL,TRAF,PEDS,renderer,scene,camera,applyQuality};
requestAnimationFrame(loop);
})();
