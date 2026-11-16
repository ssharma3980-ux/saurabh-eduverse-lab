/* Saurabh Eduverse Laboratory — offline support.
   Everything the lab loads is kept in a cache, so it keeps working without internet. */
const V='eduverse-v1';
const CORE=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
const cacheable=u=>u.origin===location.origin||/cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(u.host);
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(!cacheable(u))return;
  const isPage=r.mode==='navigate'||u.pathname.endsWith('/index.html')||u.pathname.endsWith('/');
  if(isPage){/* page: try the network first so updates arrive, fall back to the saved copy */
    e.respondWith(fetch(r).then(res=>{const c=res.clone();caches.open(V).then(ca=>ca.put(r,c));return res}).catch(()=>caches.match(r,{ignoreSearch:true}).then(m=>m||caches.match('./index.html'))));return}
  e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>{if(res&&(res.ok||res.type==='opaque')){const c=res.clone();caches.open(V).then(ca=>ca.put(r,c))}return res})))});
/* "Save for offline": download every file of the lab in one go */
self.addEventListener('message',async e=>{if(!e.data||e.data.type!=='saveAll')return;const list=e.data.files;const c=await caches.open(V);let done=0;
  for(const f of list){try{if(!(await c.match(f))){const res=await fetch(f,{cache:'reload'});if(res.ok||res.type==='opaque')await c.put(f,res)}}catch(err){}done++;if(done%3===0||done===list.length)e.source.postMessage({type:'saveProgress',done,total:list.length})}});
