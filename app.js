import {createStore} from './store.js';
import {SEED} from './seed.js';
(function(){
'use strict';
var STATUS=['선금 완','지불 완','추후 지불 필요','추후 추가 발생 가능','미정'];
var TABS=[['summary','📊','요약'],['spend','💳','집행'],['pending','📝','대기'],['contract','📑','계약']];
var S={items:[],pending:[],plan:[],hall:[],budget:{income:0,sorin:0,jjinman:0,adjust:0}};
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
function toast(m){var t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(function(){t.classList.remove('show')},2200)}
function schedule(){if(raf)return;raf=requestAnimationFrame(function(){raf=0;render()})}

/* ---------- data ---------- */
function calc(){
  var it=S.items,pe=S.pending.filter(function(p){return !p.done}),b=S.budget;
  var fixed=sum(it,spend),wait=sum(pe,function(p){return p.cost});
  var total=fixed+wait+num(b.adjust);
  var burden=total-num(b.income),cap=num(b.sorin)+num(b.jjinman);
  return {fixed:fixed,wait:wait,total:total,burden:burden,cap:cap,room:cap-burden,
    paid:sum(it,paid),unpaid:sum(it,unpaid),waitN:pe.length};
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
      {key:'status',label:'비용 지불 단계',type:'select',options:STATUS},{key:'note',label:'비고',type:'area'}],
    onChange:function(k,inp){
      if(k==='balance'){auto=false;return}
      if(auto&&(k==='cost'||k==='deposit'))inp.balance.set(Math.max(0,inp.cost.get()-inp.deposit.get()));
    },
    onSave:function(o){
      o.ord=isNew?nextOrd('items'):num(v.ord);
      var id=isNew?newId('items'):i.id;
      save('items',id,o,preset?null:undefined).then(function(ok){if(ok&&after)after(id)})},
    onDelete:isNew?null:function(){remove('items',i.id)}
  });
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
      {key:'adjust',label:'기타 보정 (예상 집행비에 더함)',type:'money',help:'목록에 없는 추가 지출이나 시트와의 차이를 맞출 때 사용해요.'}],
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
  v.append(h('div',{class:'card hero'},
    h('div',{class:'lab',text:'두 사람 순수 부담 (예상 집행비 − 축의비)'}),
    h('div',{class:'big',text:won(c.burden)}),
    h('div',{class:'bar'},h('i',{style:'width:'+pct+'%'})),
    h('div',{class:'meta'},h('span',{text:'상한 합계 '+won(c.cap)}),
      h('span',{class:'pill',text:over?('상한 초과 '+won(-c.room)):('여유 '+won(c.room))}))));
  if(over)v.append(h('div',{class:'banner',text:'두 사람의 상한비를 넘었어요. 초과분은 축의에서 추가로 충당해야 해요.'}));
  v.append(h('div',{class:'grid'},
    stat('예상 집행비',won(c.total)),stat('예상 축의비',won(S.budget.income)),
    stat('확정 집행비',won(c.fixed)),stat('대기 예상비',won(c.wait)),
    stat('지불 완료',won(c.paid)),stat('남은 잔금',won(c.unpaid))));
  v.append(h('h2',null,'예산 설정',canWrite?h('button',{text:'수정',onclick:editBudget}):null));
  v.append(h('div',{class:'card'},
    sub('예상 축의비',won(S.budget.income)),sub('소림 상한비',won(S.budget.sorin)),
    sub('찐맨 상한비',won(S.budget.jjinman)),sub('기타 보정',won(S.budget.adjust))));
  var due=S.items.filter(function(i){return unpaid(i)>0});
  v.append(h('h2',null,'남은 잔금 ('+due.length+')',h('button',{text:'집행 보기',onclick:function(){go('spend')}})));
  if(!due.length)v.append(emptyMsg('남은 잔금이 없어요 🎉'));
  due.forEach(function(i){
    v.append(h('div',{class:'card item row',onclick:function(){editItem(i)}},
      h('div',{class:'l'},h('div',{class:'t'},h('span',{class:'no',text:i.no||''}),i.item||'-'),h('div',{class:'s',text:i.vendor||i.cat||''})),
      h('div',{class:'r'},h('div',{class:'amt',text:won(unpaid(i))}),chipFor(i.status))));
  });
  var todo=S.pending.filter(function(p){return !p.done}).length;
  var chk=S.items.filter(function(i){return flagged(i.note)}).length+S.plan.filter(function(r){return flagged(r.note)}).length;
  v.append(h('h2',null,'챙길 것'));
  v.append(h('div',{class:'grid'},
    h('div',{class:'stat item',onclick:function(){go('pending')}},h('div',{class:'k',text:'대기 중 항목'}),h('div',{class:'v',text:todo+'개'})),
    h('div',{class:'stat item',onclick:function(){go('contract')}},h('div',{class:'k',text:'확인 필요 메모'}),h('div',{class:'v',text:chk+'개'}))));
  return v;
  function stat(k,val){return h('div',{class:'stat'},h('div',{class:'k',text:k}),h('div',{class:'v',text:val}))}
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
          h('div',{class:'s',text:[i.cat,i.vendor].filter(Boolean).join(' · ')})),
        h('div',{class:'r'},h('div',{class:'amt',text:spend(i)?won(spend(i)):'-'}),chipFor(i.status),
          unpaid(i)>0?h('div',{class:'unpaid',text:'잔금 '+won(unpaid(i))}):null)),
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
      var d=Object.assign({},p);delete d.id;d.done=!p.done;save('pending',p.id,d,d.done?'완료 처리':'대기로 되돌림')}});
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
    S.budget=Object.assign({income:0,sorin:0,jjinman:0,adjust:0},d||{});ready('budget');
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
