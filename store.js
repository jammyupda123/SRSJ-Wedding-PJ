import {firebaseConfig, coupleCode} from './firebase-config.js';

const byOrd=(a,b)=>(Number(a.ord)||1e9)-(Number(b.ord)||1e9);
const rid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);

/* ---- 이 기기에만 저장 (설정 전 체험용) ---- */
function localStore(){
  const KEY='wedding-v1';
  const load=()=>{try{return JSON.parse(localStorage.getItem(KEY))||{}}catch(e){return {}}};
  let data=load();
  const subs=[];
  const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify(data))}catch(e){}};
  const emit=()=>subs.forEach(f=>f());
  window.addEventListener('storage',e=>{if(e.key===KEY){data=load();emit()}});
  return {
    mode:'local',
    newId:()=>rid(),
    sub(col,cb){const f=()=>cb(Object.entries(data[col]||{}).map(([id,d])=>({id,...d})).sort(byOrd));subs.push(f);f()},
    subBudget(cb){const f=()=>cb(data['meta']&&data['meta'].budget);subs.push(f);f()},
    async set(col,id,d){(data[col]=data[col]||{})[id]=d;persist();emit()},
    async del(col,id){if(data[col])delete data[col][id];persist();emit()},
    async setBudget(d){(data.meta=data.meta||{}).budget=d;persist();emit()}
  };
}

/* ---- Firebase (실시간 공유) ---- */
async function firebaseStore(){
  const V='10.12.2',base='https://www.gstatic.com/firebasejs/'+V+'/';
  const [{initializeApp},fs,au]=await Promise.all([
    import(base+'firebase-app.js'),import(base+'firebase-firestore.js'),import(base+'firebase-auth.js')]);
  const app=initializeApp(firebaseConfig);
  const auth=au.getAuth(app);
  await au.signInAnonymously(auth);
  const db=fs.initializeFirestore(app,{localCache:fs.persistentLocalCache({tabManager:fs.persistentMultipleTabManager()})});
  const root='couples/'+coupleCode;
  return {
    mode:'firebase',
    newId:()=>rid(),
    sub(col,cb,err){
      return fs.onSnapshot(fs.query(fs.collection(db,root+'/'+col),fs.orderBy('ord')),
        snap=>cb(snap.docs.map(d=>({id:d.id,...d.data()}))),err)},
    subBudget(cb,err){
      return fs.onSnapshot(fs.doc(db,root+'/meta/budget'),s=>cb(s.exists()?s.data():null),err)},
    set:(col,id,d)=>fs.setDoc(fs.doc(db,root+'/'+col+'/'+id),d),
    del:(col,id)=>fs.deleteDoc(fs.doc(db,root+'/'+col+'/'+id)),
    setBudget:d=>fs.setDoc(fs.doc(db,root+'/meta/budget'),d)
  };
}

export async function createStore(){
  const ok=firebaseConfig.apiKey&&firebaseConfig.projectId;
  if(!ok)return localStore();
  if(coupleCode.length<20||coupleCode.startsWith('change-me'))throw new Error('coupleCode를 긴 임의 문자열로 바꿔 주세요');
  return firebaseStore();
}
