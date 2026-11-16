// 앱 화면 파일만 캐시해서 오프라인에서도 열려요. (데이터는 Firestore 자체 오프라인 캐시 사용)
const CACHE='wedding-shell-v2';
const FILES=['./','./index.html','./styles.css','./app.js','./store.js','./seed.js','./firebase-config.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  // 네트워크 우선(브라우저 HTTP 캐시도 재확인), 실패하면 캐시 → 파일을 고쳐 올리면 바로 반영돼요
  e.respondWith(fetch(e.request,{cache:'no-cache'}).then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request)));
});
