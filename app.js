import {createStore} from './store.js';
import {SEED} from './seed.js';
(function(){
'use strict';
var STATUS=['선금 완','지불 완','추후 지불 필요','추후 추가 발생 가능','미정'];
var TABS=[['summary','📊','요약'],['spend','💳','집행'],['pending','📝','대기'],['contract','📑','계약']];
var S={items:[],pending:[],plan:[],hall:[],budget:{income:0,sorin:0,jjinman:0,adjust:0,wedding:'',guests:250,guarantee:200,discountPct:10,mealPrice:58000,mealFull:58000}};
var db=null,canWrite=true,state='loading',tab='summary',filter='all',cseg='plan',slowTimer=null,raf=0;
var loaded={};

function h(tag,props){
  var e=document.createElement(tag),p=props||{};
  for(var k in p){var v=p[k];
    if(k==='class')e.className=v;
    else if(k==='text')e.textContent=v;
    else if(k.slice(0,2)==='on')e.addEventListener(k.slice(2),v);
    else if(v===true)e.setAttribute(k,'');
    else if(v!==false&&v!=null)e.setAttribute(k,v);}
  for(var i=2;i<arguments.length;i++){
    [].concat(arguments[i]).forEach(function(c){
      if(c==null||c===false)return;
      e.append(c.nodeType?c:document.createTextNode(String(c)));});}
  return e;
}
function $(s){return document.querySelector(s)}
var num=function(v){return Number(v)||0};
var won=function(n){n=Math.round(num(n));return (n<0?'-':'')+'₩'+Math.abs(n).toLocaleString('ko-KR')};
var spend=function(i){return Math.max(num(i.cost),num(i.deposit)+num(i.balance))};
var paid=function(i){return i.status==='지불 완'?spend(i):Math.min(num(i.deposit),spend(i))};
var unpaid=function(i){return i.status==='지불 완'?0:Math.max(0,spend(i)-paid(i))};
var sum=function(a,f){return a.reduce(function(s,x){return s+num(f(x))},0)};
var flagged=function(t){return /확인|필요|모색|결정/.test(t||'')};
function toast(m,actLabel,act){
  var t=$('#toast');t.replaceChildren(m);
  if(act){t.append(h('button',{type:'button',class:'tact',text:actLabel,onclick:function(){t.classList.remove('show','act');act()}}));t.classList.add('act')}
  else t.classList.remove('act');
  t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(function(){t.classList.remove('show','act')},act?5000:2200)}
function todayStr(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function dday(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return null;var p=s.split('-'),t=new Date(),a=new Date(+p[0],p[1]-1,+p[2]),b=new Date(t.getFullYear(),t.getMonth(),t.getDate());return Math.round((a-b)/864e5)}
function ddLabel(n){return n===0?'D-DAY':(n>0?'D-'+n:'D+'+(-n))}
function shortDate(s){var p=(s||'').split('-');return p.length===3?(+p[1])+'.'+(+p[2]):''}
function meal(){
  var b=S.budget,g=num(b.guests),q=num(b.guarantee),over=Math.max(0,g-q),band=Math.floor(q*num(b.discountPct)/100);
  var disc=Math.min(over,band),full=Math.max(0,over-band);
  return {over:over,disc:disc,full:full,cost:disc*num(b.mealPrice)+full*num(b.mealFull)};
}
var THEME_KEY='wedding-theme',PAL_KEY='wedding-palette';
var PALETTES=[['rose','로즈','#ac4763'],['lavender','라벤더','#6a58c9'],['sage','세이지','#3f7a5c'],
  ['sky','스카이','#2d69b6'],['gold','골드','#8b6317'],['bw','블랙&화이트','linear-gradient(135deg,#111 50%,#fff 50%)']];
function getTheme(){try{return localStorage.getItem(THEME_KEY)||'auto'}catch(e){return 'auto'}}
function getPalette(){try{var p=localStorage.getItem(PAL_KEY);return PALETTES.some(function(x){return x[0]===p})?p:'sage'}catch(e){return 'sage'}}
function syncThemeColor(){
  setTimeout(function(){
    var m=document.querySelector('meta[name="theme-color"]');
    if(m)m.setAttribute('content',getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()||'#f5f8f5');
  },30);
}
function applyLook(){
  var r=document.documentElement,t=getTheme();
  r.dataset.palette=getPalette();
  if(t==='auto')delete r.dataset.theme;else r.dataset.theme=t;
  var cs=t==='light'?'only light':(t==='dark'?'only dark':'light dark');
  r.style.colorScheme=cs;
  var mc=document.querySelector('meta[name="color-scheme"]');if(mc)mc.setAttribute('content',cs);
  syncThemeColor();
}
function setTheme(t){try{localStorage.setItem(THEME_KEY,t)}catch(e){}applyLook();render()}
function setPalette(p){try{localStorage.setItem(PAL_KEY,p)}catch(e){}applyLook();render()}
applyLook();
function schedule(){if(raf)return;raf=requestAnimationFrame(function(){raf=0;render()})}

/* ---------- data ---------- */
function calc(){
  var it=S.items,pe=S.pending.filter(function(p){return !p.done}),b=S.budget;
  var fixed=sum(it,spend),wait=sum(pe,function(p){return p.cost});
  var ml=meal(),total=fixed+wait+ml.cost+num(b.adjust);
  var burden=total-num(b.income),cap=num(b.sorin)+num(b.jjinman);
  return {fixed:fixed,wait:wait,total:total,burden:burden,cap:cap,room:cap-burden,
    paid:sum(it,paid),unpaid:sum(it,unpaid),waitN:pe.length,meal:ml};
}
async function save(col,id,data,label){
  if(!db){toast('저장소에 연결되지 않았어요');return false}
  try{await db.set(col,id,data);toast(label||'저장됨');return true}
  catch(e){toast('저장 실패 ('+((e&&e.code)||'error')+')');return false}
}
async function remove(col,id){
  if(!db)return;
  try{await db.del(col,id);toast('삭제됨')}
  catch(e){toast('삭제 실패 ('+((e&&e.code)||'error')+')')}
}
async function saveBudget(d){
  if(!db)return;
  try{await db.setBudget(d);toast('저장됨')}
  catch(e){toast('저장 실패 ('+((e&&e.code)||'error')+')')}
}
function nextOrd(col){return S[col].reduce(function(m,x){return Math.max(m,num(x.ord))},0)+1}
function newId(col){return db.newId(col)}

/* ---------- bottom sheet ---------- */
var sheetOpen=false;
function closeSheet(fromPop){
  var w=$('#sheetWrap');w.hidden=true;w.replaceChildren();
  if(sheetOpen){sheetOpen=false;if(fromPop!==true){try{history.back()}catch(e){}}}
}
window.addEventListener('popstate',function(){if(sheetOpen)closeSheet(true)});
function openSheet(cfg){
  var inputs={},body=h('div',{class:'body'});
  cfg.fields.forEach(function(f){
    var el,get,set;
    if(f.type==='money'){
      el=h('input',{type:'text',inputmode:'numeric',autocomplete:'off'});
      set=function(v){el.value=v?num(v).toLocaleString('ko-KR'):(v===0?'0':'')};
      get=function(){return Number(el.value.replace(/[^\d-]/g,''))||0};
      el.addEventListener('input',function(){
        var neg=el.value.trim().charAt(0)==='-',d=el.value.replace(/[^\d]/g,'');
        el.value=d?(neg?'-':'')+Number(d).toLocaleString('ko-KR'):(neg?'-':'');
        if(cfg.onChange)cfg.onChange(f.key,inputs)});
    }else if(f.type==='select'){
      el=h('select',null,f.options.map(function(o){return h('option',{value:o,text:o})}));
      set=function(v){el.value=v||f.options[0]};get=function(){return el.value};
    }else if(f.type==='date'){
      el=h('input',{type:'date'});set=function(v){el.value=v||''};get=function(){return el.value||''};
    }else if(f.type==='area'){
      el=h('textarea',{rows:3});set=function(v){el.value=v||''};get=function(){return el.value.trim()};
    }else{
      el=h('input',{type:'text',autocomplete:'off'});set=function(v){el.value=v==null?'':v};get=function(){return el.value.trim()};
    }
    set(cfg.values[f.key]);
    inputs[f.key]={el:el,get:get,set:set};
    body.append(h('label',{text:f.label}),el);
    if(f.help)body.append(h('div',{class:'help',text:f.help}));
  });
  var btns=h('div',{class:'btns'});
  if(cfg.onDelete){
    var d=h('button',{class:'btn del',text:'삭제'});
    d.addEventListener('click',function(){
      if(!d.dataset.armed){d.dataset.armed='1';d.textContent='한 번 더 누르면 삭제';setTimeout(function(){d.dataset.armed='';d.textContent='삭제'},3000);return}
      cfg.onDelete();closeSheet()});
    btns.append(d);
  }
  btns.append(h('button',{class:'btn',text:'취소',onclick:function(){closeSheet()}}),
    h('button',{class:'btn pri',text:'저장',onclick:function(){
      var out={};cfg.fields.forEach(function(f){out[f.key]=inputs[f.key].get()});
      cfg.onSave(out);closeSheet()}}));
  var w=$('#sheetWrap');w.replaceChildren(h('div',{class:'sheet'},h('h3',{text:cfg.title}),body,btns));
  w.hidden=false;
  if(!sheetOpen){try{history.pushState({sheet:1},'')}catch(e){}sheetOpen=true}
  w.onclick=function(e){if(e.target===w)closeSheet()};
  if(cfg.init)cfg.init(inputs);
}

function choiceSheet(title,msg,choices){
  var w=$('#sheetWrap');
  w.replaceChildren(h('div',{class:'sheet'},h('h3',{text:title}),h('div',{class:'body'},h('p',{style:'margin:4px 0 8px;font-size:14px;color:var(--mute)',text:msg})),
    h('div',{class:'btns',style:'flex-direction:column'},choices.map(function(c){
      return h('button',{class:'btn'+(c.cls?' '+c.cls:''),text:c.label,onclick:function(){closeSheet();if(c.fn)c.fn()}})}))));
  w.hidden=false;
  if(!sheetOpen){try{history.pushState({sheet:1},'')}catch(e){}sheetOpen=true}
  w.onclick=function(e){if(e.target===w)closeSheet()};
}

/* ---------- 백업 / 내보내기 ---------- */
function csvCell(v){v=v==null?'':String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
function csvRows(title,head,rows){return [[title],head].concat(rows,[[]]).map(function(r){return r.map(csvCell).join(',')}).join('\n')}
function buildCSV(){
  var c=calc(),b=S.budget;
  return [
    csvRows('[예산 요약]',['구분','금액'],[['예식일',b.wedding||''],['예상 축의비',num(b.income)],['소림 상한비',num(b.sorin)],['찐맨 상한비',num(b.jjinman)],
      ['확정 집행비',c.fixed],['대기 예상비',c.wait],['추가 식대('+c.meal.over+'명)',c.meal.cost],['기타 보정',num(b.adjust)],['예상 집행비',c.total],['두 사람 순수 부담',c.burden],['상한 대비 여유',c.room]]),
    csvRows('[예산 집행 현황]',['No','구분','항목','상세항목','비용','선금','잔금','지불 단계','잔금 납부일','비고'],
      S.items.map(function(i){return [i.no,i.cat,i.item,i.vendor,spend(i),num(i.deposit),num(i.balance),i.status,i.due||'',i.note]})),
    csvRows('[예산 집행 대기]',['구분','항목','예상 비용','완료','확인 필요사항'],S.pending.map(function(p){return [p.cat,p.item,num(p.cost),p.done?'O':'',p.note]})),
    csvRows('[플래너 계약]',['구분','업체','구성','필수 금액','별도 금액','비고'],S.plan.map(function(r){return [r.cat,r.vendor,r.comp,num(r.required),num(r.extra),r.note]})),
    csvRows('[웨딩홀 계약]',['구분','구성','금액','특이사항'],S.hall.map(function(r){return [r.cat,r.comp,num(r.amount),r.note]}))
  ].join('\n');
}
function strip(rows){return rows.map(function(r){var d=Object.assign({},r);var id=d.id;delete d.id;return [id,d]})}
function buildJSON(){return JSON.stringify({app:'srsj-wedding',v:1,at:new Date().toISOString(),budget:S.budget,
  items:strip(S.items),pending:strip(S.pending),plan:strip(S.plan),hall:strip(S.hall)},null,1)}
function downloadText(name,text,type){
  try{var blob=new Blob([text],{type:type}),u=URL.createObjectURL(blob),a=h('a',{href:u,download:name});
    document.body.append(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(u)},4000);toast('파일을 저장했어요')}
  catch(e){toast('저장 실패: 복사하기를 이용해 주세요')}
}
function copyText(text){
  function fb(){var t=h('textarea',{style:'position:fixed;opacity:0'});t.value=text;document.body.append(t);t.select();
    try{document.execCommand('copy');toast('복사했어요')}catch(e){toast('복사 실패')}t.remove()}
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(function(){toast('복사했어요')},fb);else fb();
}
function stamp(){return todayStr().replace(/-/g,'')}
function restoreFrom(file){
  var r=new FileReader();
  r.onload=function(){
    var d;try{d=JSON.parse(r.result)}catch(e){toast('백업 파일이 아니에요');return}
    if(!d||d.app!=='srsj-wedding'){toast('이 앱의 백업 파일이 아니에요');return}
    choiceSheet('백업 복원','백업 시점('+(d.at||'').slice(0,10)+')의 내용으로 덮어써요. 백업 이후 새로 추가한 항목은 그대로 남아요.',[
      {label:'복원하기',cls:'pri',fn:async function(){
        try{for(var col of ['items','pending','plan','hall'])for(var x of (d[col]||[]))await db.set(col,x[0],x[1]);
          if(d.budget)await db.setBudget(d.budget);toast('복원했어요')}catch(e){toast('복원 실패 ('+((e&&e.code)||'error')+')')}}},
      {label:'취소'}]);
  };
  r.readAsText(file);
}

/* ---------- 화면 설정 (우측 상단) ---------- */
function openLook(){
  var w=$('#sheetWrap');
  function build(){
    var body=h('div',{class:'body'},
      h('label',{text:'화면 색상'}),
      h('div',{class:'pal'},PALETTES.map(function(x){
        return h('button',{type:'button','aria-label':x[1],class:getPalette()===x[0]?'on':'',onclick:function(){setPalette(x[0]);build()}},
          h('i',{style:'background:'+x[2]}),x[1])})),
      h('label',{text:'화면 모드'}),
      h('div',{class:'seg'},[['auto','자동 (폰 설정)'],['light','라이트'],['dark','다크']].map(function(x){
        return h('button',{type:'button',class:getTheme()===x[0]?'on':'',text:x[1],onclick:function(){setTheme(x[0]);build()}})})),
      h('div',{class:'help',text:'색상·모드는 이 기기에만 저장돼요.'}),
      h('label',{text:'백업 / 내보내기'}),
      h('div',{class:'bk'},
        h('button',{type:'button',class:'btn',text:'엑셀용 CSV 저장',onclick:function(){downloadText('결혼준비_'+stamp()+'.csv','\ufeff'+buildCSV(),'text/csv;charset=utf-8')}}),
        h('button',{type:'button',class:'btn',text:'CSV 복사',onclick:function(){copyText(buildCSV())}}),
        h('button',{type:'button',class:'btn',text:'전체 백업 파일 저장',onclick:function(){downloadText('결혼준비_백업_'+stamp()+'.json',buildJSON(),'application/json')}}),
        (function(){var inp=h('input',{type:'file',accept:'.json,application/json',style:'display:none'});
          inp.addEventListener('change',function(){if(inp.files[0]){var f=inp.files[0];closeSheet();setTimeout(function(){restoreFrom(f)},400)}});
          return h('button',{type:'button',class:'btn',onclick:function(){if(!canWrite||!db)return;inp.click()}},'백업에서 복원',inp)})()),
      h('div',{class:'help',text:'CSV는 엑셀에서 바로 열려요. 백업 파일은 실수로 지웠을 때 복원용이에요.'}));
    w.replaceChildren(h('div',{class:'sheet'},h('h3',{text:'설정'}),body,
      h('div',{class:'btns'},h('button',{class:'btn pri',text:'닫기',onclick:function(){closeSheet()}}))));
  }
  build();w.hidden=false;
  if(!sheetOpen){try{history.pushState({sheet:1},'')}catch(e){}sheetOpen=true}
  w.onclick=function(e){if(e.target===w)closeSheet()};
}
$('#themeBtn').addEventListener('click',openLook);

/* ---------- editors ---------- */
function editItem(i,preset,after){
  if(!canWrite)return;
  var isNew=!i,v=i||preset||{no:'',cat:'',item:'',vendor:'',cost:0,deposit:0,balance:0,status:'미정',note:''};
  var auto=isNew||num(v.balance)===Math.max(0,num(v.cost)-num(v.deposit));
  openSheet({
    title:preset?'집행으로 옮기기':(isNew?'집행 항목 추가':'집행 항목 수정'),values:v,
    fields:[
      {key:'no',label:'번호 (예: 3-1)'},{key:'cat',label:'구분'},{key:'item',label:'항목'},{key:'vendor',label:'상세항목 / 업체'},
      {key:'cost',label:'비용',type:'money'},{key:'deposit',label:'선금(계약금)',type:'money'},
      {key:'balance',label:'잔금',type:'money',help:'비용·선금을 입력하면 자동 계산돼요. 직접 고치면 자동 계산이 꺼져요.'},
      {key:'status',label:'비용 지불 단계',type:'select',options:STATUS},{key:'due',label:'잔금 납부일',type:'date',help:'비워 두면 날짜 없이 표시돼요.'},{key:'note',label:'비고',type:'area'}],
    onChange:function(k,inp){
      if(k==='balance'){auto=false;return}
      if(auto&&(k==='cost'||k==='deposit'))inp.balance.set(Math.max(0,inp.cost.get()-inp.deposit.get()));
    },
    onSave:function(o){
      o.ord=isNew?nextOrd('items'):num(v.ord);
      if(!isNew&&v.paidAt&&o.status==='지불 완')o.paidAt=v.paidAt;
      var id=isNew?newId('items'):i.id;
      save('items',id,o,preset?null:undefined).then(function(ok){if(ok&&after)after(id)})},
    onDelete:isNew?null:function(){remove('items',i.id)}
  });
}
function payNow(i,e){
  if(e)e.stopPropagation();if(!canWrite)return;
  var prev=Object.assign({},i);delete prev.id;
  var d=Object.assign({},prev,{status:'지불 완',paidAt:todayStr()});
  save('items',i.id,d,'').then(function(ok){
    if(ok)toast((i.item||'항목')+' 지불 완료','되돌리기',function(){save('items',i.id,prev,'되돌렸어요')})});
}
function payBtn(i){return h('button',{type:'button',class:'paybtn',text:'지불 완료',onclick:function(e){payNow(i,e)}})}
function dueLine(i){
  if(!i.due)return null;var n=dday(i.due);
  return h('div',{class:'due'+(n!=null&&n<0?' over':(n!=null&&n<=7?' soon':''))},'납부 '+shortDate(i.due)+' · '+ddLabel(n));
}
function nextNo(){
  var m=0;S.items.forEach(function(x){var n=parseInt(x.no,10);if(n>m)m=n});return String(m+1)}
function moveToSpend(p){
  editItem(null,{no:nextNo(),cat:p.cat||'',item:p.item||'',vendor:'',cost:num(p.cost),deposit:0,balance:num(p.cost),
    status:'추후 지불 필요',note:p.note||''},function(id){
    var d=Object.assign({},p);delete d.id;d.done=true;d.itemId=id;save('pending',p.id,d,'집행으로 옮겼어요')});
}
function editPending(p){
  if(!canWrite)return;
  var isNew=!p,v=p||{cat:'본식',item:'',cost:0,note:'',done:false};
  openSheet({
    title:isNew?'대기 항목 추가':'대기 항목 수정',values:v,
    fields:[{key:'cat',label:'구분'},{key:'item',label:'항목'},{key:'cost',label:'예상 비용',type:'money'},
      {key:'note',label:'확인 필요사항',type:'area'}],
    onSave:function(o){
      o.done=!!v.done;o.ord=isNew?nextOrd('pending'):num(v.ord);
      save('pending',isNew?newId('pending'):p.id,o)},
    onDelete:isNew?null:function(){remove('pending',p.id)}
  });
}
function editContract(kind,r){
  if(!canWrite)return;
  var isNew=!r,plan=kind==='plan';
  var v=r||(plan?{cat:'',comp:'',vendor:'',required:0,extra:0,note:''}:{cat:'',comp:'',amount:0,note:''});
  var fields=plan?[{key:'cat',label:'구분'},{key:'vendor',label:'업체명'},{key:'comp',label:'구성'},
      {key:'required',label:'필수 금액',type:'money'},{key:'extra',label:'별도 금액 (발생 시)',type:'money'},{key:'note',label:'비고 / 확인 필요',type:'area'}]
    :[{key:'cat',label:'구분'},{key:'comp',label:'구성'},{key:'amount',label:'금액',type:'money'},{key:'note',label:'특이사항',type:'area'}];
  openSheet({
    title:(plan?'플래너 계약':'웨딩홀 계약')+(isNew?' 항목 추가':' 항목 수정'),values:v,fields:fields,
    onSave:function(o){o.ord=isNew?nextOrd(kind):num(v.ord);save(kind,isNew?newId(kind):r.id,o)},
    onDelete:isNew?null:function(){remove(kind,r.id)}
  });
}
function editBudget(){
  if(!canWrite)return;
  var b=S.budget;
  openSheet({
    title:'예산 설정',values:b,
    fields:[{key:'income',label:'예상 축의비',type:'money'},{key:'sorin',label:'소림 상한비',type:'money'},
      {key:'jjinman',label:'찐맨 상한비',type:'money'},
      {key:'adjust',label:'기타 보정 (예상 집행비에 더함)',type:'money',help:'목록에 없는 추가 지출이나 시트와의 차이를 맞출 때 사용해요.'},
      {key:'wedding',label:'예식일',type:'date'},
      {key:'guests',label:'예상 하객 수 (식사 인원)',type:'money'},
      {key:'guarantee',label:'보증 인원',type:'money'},
      {key:'discountPct',label:'할인가 적용 범위 (보증 인원의 %)',type:'money',help:'보증 200명·10%면 초과 20명까지 할인가, 그 이상은 정상가예요.'},
      {key:'mealPrice',label:'1인 식대 (할인가)',type:'money',help:'현재 계약 식대 11,600,000원 ÷ 보증 200명 = 58,000원 기준'},
      {key:'mealFull',label:'1인 식대 (정상가)',type:'money',help:'웨딩홀에 정상가를 확인해서 넣어 주세요.'}],
    onSave:function(o){saveBudget(o)}
  });
}

/* ---------- views ---------- */
function chipFor(s){
  var c={'지불 완':'c-ok','선금 완':'c-dep','추후 지불 필요':'c-due','추후 추가 발생 가능':'c-may','미정':'c-may'}[s]||'c-may';
  return h('span',{class:'chip '+c,text:s||'미정'});
}
function emptyMsg(t){return h('div',{class:'empty',text:t})}

function vSummary(){
  var c=calc(),pct=c.cap>0?Math.max(0,Math.min(100,c.burden/c.cap*100)):0,over=c.room<0;
  var v=h('div');
  if(state==='ready'&&!S.items.length&&!S.pending.length&&!S.plan.length&&!S.hall.length){
    v.append(h('div',{class:'card'},h('div',{class:'t',text:'아직 데이터가 없어요'}),
      h('div',{class:'s',style:'margin:4px 0 10px;color:var(--mute);font-size:13px',text:'기존 시트(집행 현황·대기·계약) 내용을 한 번에 넣을 수 있어요.'}),
      h('button',{class:'btn pri',style:'width:100%',text:'시트 내용으로 초기 데이터 넣기',onclick:seedAll})));
  }
  var wd=dday(S.budget.wedding);
  v.append(h('div',{class:'card hero'},
    wd!=null?h('div',{class:'dd'},h('b',{text:ddLabel(wd)}),' 예식 '+S.budget.wedding.replace(/-/g,'.')):null,
    h('div',{class:'lab',text:'두 사람 순수 부담 (예상 집행비 − 축의비)'}),
    h('div',{class:'big',text:won(c.burden)}),
    h('div',{class:'bar'},h('i',{style:'width:'+pct+'%'})),
    h('div',{class:'meta'},h('span',{text:'상한 합계 '+won(c.cap)}),
      h('span',{class:'pill',text:over?('상한 초과 '+won(-c.room)):('여유 '+won(c.room))}))));
  if(over)v.append(h('div',{class:'banner',text:'두 사람의 상한비를 넘었어요. 초과분은 축의에서 추가로 충당해야 해요.'}));
  v.append(h('div',{class:'grid'},
    stat('예상 집행비',won(c.total),'확정+대기+추가식대+보정'),stat('예상 축의비',won(S.budget.income)),
    stat('확정 집행비',won(c.fixed),'집행 탭 비용 합계'),stat('대기 예상비',won(c.wait),'대기 탭 미완료 합계'),
    stat('지불 완료',won(c.paid)),stat('남은 잔금',won(c.unpaid))));
  var ml=c.meal,mealNote=ml.full&&num(S.budget.mealFull)===num(S.budget.mealPrice);
  function fl(op,k,sub,val,cls,onclick){
    return h('div',{class:'fx'+(cls?' '+cls:''),onclick:onclick||null},h('span',{class:'op',text:op}),
      h('span',{class:'fk'},k,sub?h('small',{text:sub}):null),h('b',{text:val}))}
  v.append(h('h2',null,'예상 집행비 계산'));
  v.append(h('div',{class:'card'},
    fl('','확정 집행비','집행 탭 비용 합계',won(c.fixed),'',function(){go('spend')}),
    fl('+','대기 예상비','대기 탭 미완료 항목',won(c.wait),'',function(){go('pending')}),
    fl('+','추가 식대',ml.over>0?('보증 초과 '+ml.over+'명 · 할인가 '+ml.disc+'명'+(ml.full?' + 정상가 '+ml.full+'명':'')):'보증 인원 이내',won(ml.cost),'',editBudget),
    mealNote?h('div',{class:'note flag',style:'margin:0 0 6px 22px;padding-top:0;border:none',text:'정상가를 아직 할인가와 같게 두었어요. 예산 설정에서 정상가를 넣어 주세요.'}):null,
    fl('+','기타 보정','',won(S.budget.adjust),'',editBudget),
    fl('=','예상 집행비','',won(c.total),'sum'),
    fl('−','예상 축의비','',won(S.budget.income)),
    fl('=','두 사람 순수 부담','',won(c.burden),'sum')));
  v.append(h('h2',null,'예산 설정',canWrite?h('button',{text:'수정',onclick:editBudget}):null));
  v.append(h('div',{class:'card'},
    sub('예상 축의비',won(S.budget.income)),sub('소림 상한비',won(S.budget.sorin)),
    sub('찐맨 상한비',won(S.budget.jjinman)),sub('기타 보정',won(S.budget.adjust)),
    sub('예식일',S.budget.wedding?S.budget.wedding.replace(/-/g,'.'):'미입력'),
    sub('예상 하객 / 보증',num(S.budget.guests)+'명 / '+num(S.budget.guarantee)+'명')));
  var due=S.items.filter(function(i){return unpaid(i)>0}).slice().sort(function(a,b){
    return (a.due||'9999')<(b.due||'9999')?-1:(a.due||'9999')>(b.due||'9999')?1:num(a.ord)-num(b.ord)});
  v.append(h('h2',null,'남은 잔금 ('+due.length+')',h('button',{text:'집행 보기',onclick:function(){go('spend')}})));
  if(!due.length)v.append(emptyMsg('남은 잔금이 없어요 🎉'));
  due.forEach(function(i){
    v.append(h('div',{class:'card item',onclick:function(){editItem(i)}},
      h('div',{class:'row'},
        h('div',{class:'l'},h('div',{class:'t'},h('span',{class:'no',text:i.no||''}),i.item||'-'),h('div',{class:'s',text:i.vendor||i.cat||''}),dueLine(i)),
        h('div',{class:'r'},h('div',{class:'amt',text:won(unpaid(i))}),chipFor(i.status),canWrite?payBtn(i):null))));
  });
  var todo=S.pending.filter(function(p){return !p.done}).length;
  var chk=S.items.filter(function(i){return flagged(i.note)}).length+S.plan.filter(function(r){return flagged(r.note)}).length;
  v.append(h('h2',null,'챙길 것'));
  v.append(h('div',{class:'grid'},
    h('div',{class:'stat item',onclick:function(){go('pending')}},h('div',{class:'k',text:'대기 중 항목'}),h('div',{class:'v',text:todo+'개'})),
    h('div',{class:'stat item',onclick:function(){go('contract')}},h('div',{class:'k',text:'확인 필요 메모'}),h('div',{class:'v',text:chk+'개'}))));
  return v;
  function stat(k,val,hint){return h('div',{class:'stat'},h('div',{class:'k',text:k}),h('div',{class:'v',text:val}),hint?h('div',{class:'hint',text:hint}):null)}
  function sub(k,val){return h('div',{class:'subtot'},h('span',{text:k}),h('b',{text:val}))}
}

function vSpend(){
  var v=h('div'),fl=[['all','전체'],['due','잔금 남음'],['done','완료']];
  v.append(h('div',{class:'filters'},fl.map(function(f){
    return h('button',{class:filter===f[0]?'on':'',text:f[1],onclick:function(){filter=f[0];render()}})})));
  var list=S.items.filter(function(i){
    return filter==='all'||(filter==='due'?unpaid(i)>0:unpaid(i)===0)});
  v.append(h('div',{class:'total'},h('span',{text:'비용 합계'}),h('span',{text:won(sum(list,spend))})));
  if(!list.length)v.append(emptyMsg(S.items.length?'해당하는 항목이 없어요':'항목이 없어요. + 버튼으로 추가해 보세요'));
  list.forEach(function(i){
    var card=h('div',{class:'card item',onclick:function(){editItem(i)}},
      h('div',{class:'row'},
        h('div',{class:'l'},h('div',{class:'t'},h('span',{class:'no',text:i.no||''}),i.item||'-'),
          h('div',{class:'s',text:[i.cat,i.vendor].filter(Boolean).join(' · ')}),unpaid(i)>0?dueLine(i):null),
        h('div',{class:'r'},h('div',{class:'amt',text:spend(i)?won(spend(i)):'-'}),chipFor(i.status),
          unpaid(i)>0?h('div',{class:'unpaid',text:'잔금 '+won(unpaid(i))}):null,
          unpaid(i)>0&&canWrite?payBtn(i):null)),
      i.note?h('div',{class:'note'+(flagged(i.note)?' flag':''),text:i.note}):null);
    v.append(card);});
  return v;
}

function vPending(){
  var v=h('div'),open=S.pending.filter(function(p){return !p.done});
  v.append(h('div',{class:'total'},h('span',{text:'대기 예상비 ('+open.length+'개)'}),h('span',{text:won(sum(open,function(p){return p.cost}))})));
  if(!S.pending.length)v.append(emptyMsg('대기 항목이 없어요'));
  S.pending.forEach(function(p){
    var ck=h('div',{class:'check'+(p.done?' on':''),text:p.done?'✓':'',onclick:function(e){
      e.stopPropagation();if(!canWrite)return;
      if(!p.done){moveToSpend(p);return}
      var d=Object.assign({},p);delete d.id;d.done=false;
      var linked=p.itemId&&S.items.filter(function(x){return x.id===p.itemId})[0];
      if(!linked){delete d.itemId;save('pending',p.id,d,'대기로 되돌림');return}
      choiceSheet('대기로 되돌리기','집행에 옮겨 둔 "'+(linked.item||'항목')+'"('+won(spend(linked))+')도 함께 삭제할까요? 남겨 두면 금액이 두 번 잡혀요.',[
        {label:'집행 항목도 삭제하고 되돌리기',cls:'pri',fn:function(){delete d.itemId;remove('items',linked.id);save('pending',p.id,d,'대기로 되돌림')}},
        {label:'집행 항목은 남기고 되돌리기',fn:function(){delete d.itemId;save('pending',p.id,d,'대기로 되돌림')}},
        {label:'취소'}]);
    }});
    v.append(h('div',{class:'card item'+(p.done?' done':'')},
      h('div',{class:'row',onclick:function(){editPending(p)}},
        ck,h('div',{class:'l',style:'flex:1'},h('div',{class:'t',text:p.item||'-'}),h('div',{class:'s',text:p.cat||''})),
        h('div',{class:'r'},h('div',{class:'amt',text:num(p.cost)?won(p.cost):'미정'}))),
      p.note?h('div',{class:'note'+(flagged(p.note)&&!p.done?' flag':''),text:p.note}):null));
  });
  return v;
}

function vContract(){
  var v=h('div');
  v.append(h('div',{class:'seg'},[['plan','① 플래너 계약'],['hall','② 웨딩홀 계약']].map(function(s){
    return h('button',{class:cseg===s[0]?'on':'',text:s[1],onclick:function(){cseg=s[0];render()}})})));
  var rows=S[cseg],last=null;
  if(!rows.length)v.append(emptyMsg('항목이 없어요'));
  rows.forEach(function(r){
    if(r.cat!==last){last=r.cat;v.append(h('div',{class:'grp',text:r.cat||'기타'}))}
    var right=cseg==='plan'
      ?h('div',{class:'r'},h('div',{class:'amt',text:num(r.required)?won(r.required):'-'}),
          num(r.extra)?h('div',{class:'unpaid',text:'별도 '+won(r.extra)}):null)
      :h('div',{class:'r'},h('div',{class:'amt',text:num(r.amount)?won(r.amount):'포함/서비스'}));
    v.append(h('div',{class:'card item',onclick:function(){editContract(cseg,r)}},
      h('div',{class:'row'},h('div',{class:'l'},h('div',{class:'t',text:r.comp||'-'}),
        cseg==='plan'&&r.vendor?h('div',{class:'s',text:r.vendor}):null),right),
      r.note?h('div',{class:'note'+(flagged(r.note)?' flag':''),text:r.note}):null));
  });
  if(cseg==='plan'){
    v.append(h('div',{class:'card'},
      h('div',{class:'subtot'},h('span',{text:'필수 금액 합계'}),h('b',{text:won(sum(S.plan,function(r){return r.required}))})),
      h('div',{class:'subtot'},h('span',{text:'별도 금액 합계 (발생 시)'}),h('b',{text:won(sum(S.plan,function(r){return r.extra}))}))));
  }else{
    var t=sum(S.hall,function(r){return r.amount});
    var ref=S.items.filter(function(i){return String(i.no)==='2'})[0];
    v.append(h('div',{class:'total'},h('span',{text:'웨딩홀 합계'}),h('span',{text:won(t)})));
    var ml=meal();
    if(ml.over>0)v.append(h('div',{class:'banner',text:'예상 하객이 보증보다 '+ml.over+'명 많아 추가 식대 '+won(ml.cost)+'이 예상 집행비에 별도로 더해져요. (요약 › 예산 설정에서 수정)'}));
    if(ref){
      var diff=t-spend(ref);
      v.append(h('div',{class:'banner',style:diff?'':'background:var(--ok-soft);color:var(--ok)',
        text:diff?('집행 현황 2번('+won(spend(ref))+')과 '+won(Math.abs(diff))+' 차이가 나요'):'집행 현황 2번 금액과 일치해요'}));
    }
  }
  return v;
}

/* ---------- shell ---------- */
function go(t){tab=t;try{history.replaceState(null,'','#'+t)}catch(e){location.hash=t}render();window.scrollTo(0,0)}
function render(){
  var tabs=$('#tabs');
  tabs.replaceChildren.apply(tabs,TABS.map(function(t){
    return h('button',{class:tab===t[0]?'on':'',onclick:function(){go(t[0])}},h('span',{class:'ic',text:t[1]}),t[2])}));
  var sync=$('#sync');
  sync.replaceChildren(h('span',{class:'dot '+(state==='ready'?'on':(state==='nodb'||state==='slow'?'bad':''))}),
    {loading:'불러오는 중…',ready:(db&&db.mode==='local')?'이 기기에만 저장 중 (연결 전)':'실시간 저장 · 함께 편집 가능',nodb:'저장소 연결 안 됨',slow:'연결 지연 중'}[state]);
  var bn=$('#banner');bn.replaceChildren();
  if(state==='nodb')bn.append(h('div',{class:'banner',text:'저장소에 연결할 수 없어요. firebase-config.js 설정과 네트워크를 확인해 주세요.'}));
  if(state==='slow')bn.append(h('div',{class:'banner',text:'데이터를 아직 못 받았어요. 표시된 내용이 최신이 아닐 수 있어요.'}));
  var view={summary:vSummary,spend:vSpend,pending:vPending,contract:vContract}[tab]||vSummary;
  $('#view').replaceChildren(view());
  var fab=$('#fab');
  fab.hidden=!(canWrite&&db&&tab!=='summary');
}
$('#fab').addEventListener('click',function(){
  if(tab==='spend')editItem(null);else if(tab==='pending')editPending(null);else if(tab==='contract')editContract(cseg,null);
});
window.addEventListener('hashchange',function(){
  var t=location.hash.slice(1);if(TABS.some(function(x){return x[0]===t})&&t!==tab){tab=t;render()}});

/* ---------- seed ---------- */
async function seedAll(){
  try{
    for(var k=0;k<SEED.items.length;k++)await db.set('items',SEED.items[k][0],SEED.items[k][1]);
    for(var col of ['pending','plan','hall'])for(var r of SEED[col])await db.set(col,r[0],r[1]);
    await db.setBudget(SEED.budget);toast('초기 데이터를 넣었어요');
  }catch(e){toast('실패: '+((e&&e.code)||'error'))}
}

/* ---------- boot ---------- */
async function boot(){
  var t0=location.hash.slice(1);if(TABS.some(function(x){return x[0]===t0}))tab=t0;
  render();
  try{db=await createStore()}catch(e){console.error(e);db=null}
  if(!db){state='nodb';render();return}
  slowTimer=setTimeout(function(){if(state!=='ready'){state='slow';render()}},10000);
  function ready(k){loaded[k]=true;if(state!=='ready'){state='ready';clearTimeout(slowTimer)}schedule()}
  function onErr(){state='slow';schedule()}
  ['items','pending','plan','hall'].forEach(function(name){
    db.sub(name,function(rows){S[name]=rows;ready(name)},onErr);
  });
  db.subBudget(function(d){
    S.budget=Object.assign({income:0,sorin:0,jjinman:0,adjust:0,wedding:'',guests:250,guarantee:200,discountPct:10,mealPrice:58000,mealFull:58000},d||{});ready('budget');
  },onErr);
}
boot();
if('serviceWorker' in navigator){
  var hadSW=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange',function(){if(hadSW)location.reload()});
  window.addEventListener('load',function(){
    navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(function(r){r.update()}).catch(function(){});
  });
  document.addEventListener('visibilitychange',function(){
    if(!document.hidden)navigator.serviceWorker.getRegistration().then(function(r){r&&r.update()}).catch(function(){});
  });
}
})();
