(() => {'use strict';
const STORE='tempo.schedule.v4',DAY=86400000,DEF_BREAK=10,DEF_START=420,DEF_END=1320;
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const frameStart=()=>state.settings.frameStart,frameEnd=()=>state.settings.frameEnd;
const breakLen=()=>state.settings.breakLength;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const minToHM=m=>`${pad(Math.floor(m/60)%24)}:${pad(m%60)}`;
const hmToMin=v=>{const m=/^(\d{1,2}):(\d{2})$/.exec(String(v||'').trim());return m?(+m[1]%24)*60+ +m[2]:NaN};
const GREETINGS=[
  ['Make time','feel possible.'],
  ['Less rush,','more room.'],
  ['Steal back',"your day."],
  ['One block','at a time.'],
  ['Slow down,','on purpose.'],
  ['Find the','breathing room.'],
  ['Make room','for what matters.'],
  ['Your time,','in your hands.'],
  ['Take it','one thing at a time.'],
  ['Protect','your peace.'],
  ['Give the day','a little air.'],
  ['Small blocks,','bigger calm.']
];
const pad=n=>String(n).padStart(2,'0');
const dateKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseDate=k=>{const[y,m,d]=k.split('-').map(Number);return new Date(y,m-1,d,12)};
const todayKey=()=>dateKey(new Date());
const uid=()=>crypto?.randomUUID?.()||`tempo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const minsLabel=n=>{const h=Math.floor(n/60),m=n%60;return`${h%12||12}:${pad(m)} ${h>=12?'PM':'AM'}`};
const durationLabel=m=>`${Math.floor(m/60)}h ${m%60}m`;
const TODO_META={
  peach:{label:'Homework',mins:60},
  lilac:{label:'Study',mins:60},
  aqua:{label:'Reset',mins:30},
  lime:{label:'Activity',mins:45}
};

function validEvent(e){
  if(!e||typeof e.id!=='string'||typeof e.title!=='string')return false;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(e.date))return false;
  if(!Number.isInteger(e.start)||!Number.isInteger(e.end))return false;
  if(e.start<0||e.end>1440||e.end<=e.start)return false;
  if(!['peach','lilac','aqua','lime'].includes(e.color))return false;
  if(!['once','daily','weekdays','weekly'].includes(e.repeat||'once'))return false;
  if(e.excludedDates&&!Array.isArray(e.excludedDates))return false;
  if(e.overrides&&typeof e.overrides!=='object')return false;
  if(e.locked!==undefined&&typeof e.locked!=='boolean')return false;
  return true;
}

function validTodo(t){
  if(!t||typeof t.id!=='string'||typeof t.title!=='string')return false;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(t.date))return false;
  if(!['peach','lilac','aqua','lime'].includes(t.color))return false;
  if(!Number.isInteger(t.mins)||t.mins<5||t.mins>720)return false;
  return true;
}

function load(){
  try{
    const x=JSON.parse(localStorage.getItem(STORE)||'{}');
    const raw=x.settings||{};
    return{
      events:Array.isArray(x.events)?x.events.filter(validEvent):[],
      todos:Array.isArray(x.todos)?x.todos.filter(validTodo):[],
      selectedDate:/^\d{4}-\d{2}-\d{2}$/.test(x.selectedDate||'')?x.selectedDate:todayKey(),
      settings:{
        breakLength:Number.isInteger(raw.breakLength)&&raw.breakLength>=0?raw.breakLength:DEF_BREAK,
        frameStart:Number.isInteger(raw.frameStart)&&raw.frameStart>=0&&raw.frameStart<1440?raw.frameStart:DEF_START,
        frameEnd:Number.isInteger(raw.frameEnd)&&raw.frameEnd>raw.frameStart&&raw.frameEnd<=1440?raw.frameEnd:DEF_END
      }
    };
  }catch{return{events:[],todos:[],selectedDate:todayKey(),settings:{breakLength:DEF_BREAK,frameStart:DEF_START,frameEnd:DEF_END}}}
}

let state=load(),activeEvent=null,returnFocus=null,editDate=null,activeType='peach',composerTouched=false;

function save(toCloud=true){
  try{localStorage.setItem(STORE,JSON.stringify(state))}catch{console.log("Couldn't save locally. Check browser storage settings.")}
  if(toCloud&&window.TempoFirebase&&window.TempoFirebase.ready()){
    window._tempoLastCloudSave=Date.now();
    window.TempoFirebase.saveToCloud();
  }
  if(window.TempoNotifications)window.TempoNotifications.scheduleUpdate();
}

function toast(m){
  const e=$('#toast');e.textContent=m;e.classList.add('show');
  clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),2800);
}

function occurs(e,k){
  if(e.date===k)return true;
  if(e.date>k||e.repeat==='once')return false;
  if(e.excludedDates&&e.excludedDates.includes(k))return false;
  const a=parseDate(e.date),b=parseDate(k);
  return e.repeat==='daily'
    ||(e.repeat==='weekdays'&&b.getDay()>0&&b.getDay()<6)
    ||(e.repeat==='weekly'&&a.getDay()===b.getDay());
}

function eventList(k){
  return state.events.filter(e=>occurs(e,k)).map(e=>{
    if(e.overrides&&e.overrides[k]){
      const o=e.overrides[k];
      const merged={...e,...o,id:e.id,date:e.date,repeat:e.repeat};
      if(o.start!==undefined&&o.end!==undefined){merged.start=o.start;merged.end=o.end}
      if(o.color!==undefined)merged.color=o.color;
      if(o.title!==undefined)merged.title=o.title;
      return merged;
    }
    return e;
  }).sort((a,b)=>a.start-b.start||a.end-b.end);
}

function dayGaps(k){
  const START=frameStart(),END=frameEnd();
  const iv=eventList(k).map(e=>[e.start,e.end]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const gaps=[];let cur=START;
  for(const[s,e]of iv){
    if(s>cur)gaps.push([cur,Math.min(s,END)]);
    cur=Math.max(cur,e);
  }
  if(cur<END)gaps.push([cur,END]);
  return gaps.filter(([s,e])=>e-s>=15);
}

function shortTitle(t){t=t.trim();return t.length>20?t.slice(0,19)+'\u2026':t}

function slotContext(k,c){
  const evs=eventList(k);let before=null,after=null;
  for(const e of evs){if(e.end<=c.start)before=e;if(e.start>=c.end&&!after)after=e}
  if(before&&after)return `after ${shortTitle(before.title)}`;
  if(before)return `after ${shortTitle(before.title)}`;
  if(after)return `before ${shortTitle(after.title)}`;
  return c.start<=frameStart()?'from the first break':'an open stretch';
}

function suggestSlots(k,mins,limit=3){
  const grid=15,out=[];
  let cands=[];
  const fits=dayGaps(k).filter(([s,e])=>e-s>=mins);
  for(const[gs,ge]of fits){
    let s=gs;if(s%grid)s+=grid-(s%grid);
    while(s+mins<=ge){cands.push({start:s,end:s+mins,gap:[gs,ge]});s+=grid}
  }
  if(!cands.length){
    const big=dayGaps(k).sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]))[0];
    if(big)cands.push({start:big[0],end:big[1],gap:big,partial:true});
  }
  cands=cands.filter(c=>c.end-c.start>0).sort((a,b)=>a.start-b.start);
  const isToday=k===todayKey(),n=new Date().getHours()*60+new Date().getMinutes();
  const rank=(c)=>isToday&&c.start<n?1:0;
  cands.sort((a,b)=>rank(a)-rank(b)||a.start-b.start);
  const seen=new Set();
  for(const c of cands){if(seen.has(c.start))continue;seen.add(c.start);out.push(c);if(out.length>=limit)break}
  return out;
}

function bestSlot(k,mins){return suggestSlots(k,mins,1)[0]||null}

function scheduleTodo(t,slot=null){
  const src=state.todos.find(x=>x.id===t.id);if(!src)return;
  if(src.scheduled&&src.eventId&&state.events.some(e=>e.id===src.eventId)){console.log('Already scheduled \u2014 check it off when it\u2019s done.');return}
  if(!slot)slot=bestSlot(src.date,src.mins);
  if(!slot){console.log('No open spot today to fit this in \u2014 free up some time first.');return}
  const s=slot.start,e=Math.min(s+src.mins,slot.end);
  const ev={id:uid(),todoId:src.id,title:src.title,date:src.date,start:s,end:e,color:src.color,repeat:'once',excludedDates:[],overrides:{}};
  state.events.push(ev);
  src.scheduled=true;src.eventId=ev.id;
  save();render();
  console.log(`Scheduled \u201c${shortTitle(src.title)}\u201d for ${minsLabel(s)} \u2013 ${minsLabel(e)}.`);
}

function todoDone(t){return !!(t&&t.done)}

function toggleTodoDone(id){
  const t=state.todos.find(x=>x.id===id);if(!t)return;
  t.done=!t.done;
  save();render();
  if(t.done)console.log(`Checked off \u201c${shortTitle(t.title)}\u201d \u2014 nice work.`);
}

function releaseTodoForEvent(id){
  const t=state.todos.find(x=>x.eventId===id);
  if(t){delete t.scheduled;delete t.eventId;delete t.done}
}

function setOccurrenceTimes(src,k,start,end){
  start=Math.round(start);end=Math.round(end);
  if(src.repeat==='once'){src.start=start;src.end=end;return}
  if(!src.overrides)src.overrides={};
  src.overrides[k]={...(src.overrides[k]||{}),start,end};
}

function applyBreaks(){  const k=state.selectedDate;
  const START=frameStart(),END=frameEnd(),brk=breakLen();
  const occ=eventList(k);
  const locked=occ.filter(e=>e.locked).sort((a,b)=>a.start-b.start||a.end-b.end);
  const movable=occ.filter(e=>!e.locked).sort((a,b)=>a.start-b.start||a.end-b.end);
  const spans=[];let cur=START;
  for(const l of locked){
    if(l.start>cur)spans.push([cur,Math.min(l.start,END)]);
    cur=Math.max(cur,l.end);
  }
  if(cur<END)spans.push([cur,END]);
  let si=0,cursor=spans.length?spans[0][0]:END;
  const spanEnd=()=>si<spans.length?spans[si][1]:END;
  let placed=0;
  for(const m of movable){
    const dur=m.end-m.start;
    if(dur<=0)continue;
    while(si<spans.length&&cursor+dur>spanEnd()){si++;cursor=si<spans.length?spans[si][0]:END}
    if(si>=spans.length||cursor+dur>frameEnd())continue;
    const src=state.events.find(x=>x.id===m.id);
    if(!src)continue;
    setOccurrenceTimes(src,k,cursor,cursor+dur);
    cursor+=dur+brk;placed++;
  }
  if(placed){save();render();console.log(placed===movable.length?`Added ${brk}-min breaks between your blocks.`:`Spaced out ${placed} block${placed===1?'':'s'} \u2014 some couldn\u2019t fit.`)}
  return placed;
}

function fmt(k,long=false){
  return parseDate(k).toLocaleDateString(undefined,long
    ?{weekday:'long',month:'long',day:'numeric'}
    :{weekday:'short',month:'short',day:'numeric'});
}

function esc(v){const s=document.createElement('span');s.textContent=v;return s.innerHTML}

let daysWindow=null;
const DAYS_SPAN=17;

function renderDays(){
  const sel=state.selectedDate;
  const prevIdx=daysWindow?daysWindow.indexOf(sel):-1;
  const base=parseDate(sel).getTime();
  daysWindow=[];
  for(let i=-2;i<DAYS_SPAN-2;i++)daysWindow.push(dateKey(new Date(base+i*DAY)));
  const track=document.createElement('div');
  track.className='days-track';
  track.innerHTML=daysWindow.map(k=>{
    const d=parseDate(k),yes=k===sel;
    return`<button data-date="${k}" class="${yes?'selected':''}" ${yes?'aria-current="date"':''}><span>${d.toLocaleDateString(undefined,{weekday:'short'}).toUpperCase()}</span><b>${d.getDate()}</b></button>`;
  }).join('');
  const nav=$('#days');
  nav.innerHTML='';nav.append(track);
  const step=(track.children[0]?.clientWidth||0)+6,to=0,from=prevIdx>=0?step*(prevIdx-2):0;
  track.style.transition='none';
  track.style.transform=`translateX(${from}px)`;
  if(prevIdx>=0&&prevIdx!==2){
    void track.getBoundingClientRect();
    track.style.transition='transform .45s cubic-bezier(.22,1,.36,1)';
    track.style.transform=`translateX(${to}px)`;
  }
  $('#dateLabel').textContent=fmt(sel,true).toUpperCase();
}

function renderTimeline(){
  const START=frameStart(),END=frameEnd();
  const all=eventList(state.selectedDate),used=[];
  let max=1;
  all.forEach(e=>{
    const occupied=new Set(used.filter(x=>x.end>e.start).map(x=>x.c));
    let c=0;while(occupied.has(c))c++;
    e.c=c;used.push(e);max=Math.max(max,c+1);
  });
  const box=$('#events');box.innerHTML='';
  $('#blockCount').textContent=`${all.length} block${all.length===1?'':'s'}`;
  $('#emptyState').hidden=!!all.length;
  all.forEach((e,i)=>{
    const s=Math.max(e.start,START),en=Math.min(e.end,END);
    if(en<=s)return;
    const b=document.createElement('button');
    const top=(s-START)/(END-START)*100;
    const h=Math.max(2.8,(en-s)/(END-START)*100);
    b.className=`event ${e.color}${e.locked?' locked':''}${e.todoId&&todoDone(state.todos.find(x=>x.id===e.todoId))?' done':''}`;
    b.style.cssText=`top:${top}%;height:${h}%;left:calc(${e.c/max*100}% + 5px);width:calc(${100/max}% - 7px);animation-delay:${i*45}ms`;
    b.innerHTML=`<b>${esc(e.title)}${e.repeat!=='once'?' <em>\u21bb</em>':''}<i class="lock-flag" title="Locked in place">${e.locked?'\u2298':''}</i></b><small>${minsLabel(e.start)} \u2013 ${minsLabel(e.end)}</small>`;
    b.onclick=()=>openDetail({...e,occurrenceDate:state.selectedDate});
    box.append(b);
  });
  const now=new Date(),n=now.getHours()*60+now.getMinutes();
  const yes=state.selectedDate===todayKey()&&n>=START&&n<=END;
  $('#nowLine').hidden=!yes;
  if(yes){$('#nowLine').style.top=`${(n-START)/(END-START)*100}%`;$('#nowLine span').textContent=minsLabel(n)}
}

function renderStats(){
  const START=frameStart(),END=frameEnd();
  const mins=eventList(state.selectedDate).reduce((n,e)=>n+e.end-e.start,0);
  const free=END-START-mins;
  $('#freeTime').textContent=free>0?`${durationLabel(free)} to recharge`:'Full day \u2014 you\u2019ve got this.';
  $('#budgetText').textContent=mins?`${durationLabel(mins)} protected for what matters.`:'Your plan has room to breathe.';
  const pct=Math.max(0,Math.min(100,mins/(END-START)*100));
  $('#budgetRing').style.background=`conic-gradient(#df7450 0 ${pct}%,#e7dbcb ${pct}% 100%)`;
  let total=0,bars='';
  for(let i=0;i<7;i++){
    const k=dateKey(new Date(parseDate(todayKey()).getTime()+i*DAY));
    const m=eventList(k).reduce((n,e)=>n+e.end-e.start,0);
    total+=m;
    bars+=`<i class="${k===state.selectedDate?'active':''}" style="height:${Math.max(8,m/(END-START)*100)}%"></i>`;
  }
  $('#weekTotal').textContent=durationLabel(total);
  $('#barChart').innerHTML=bars;
}

function renderTodos(){
  const k=state.selectedDate,list=state.todos.filter(t=>t.date===k);
  const pending=list.filter(t=>!todoDone(t)).length;
  $('#todoCount').textContent=list.length?`${pending} left`:'All set';
  const el=$('#todoList');el.innerHTML='';
  if(!list.length){
    el.innerHTML='<li class="todo-empty">Nothing on your plate \u2014 type one above and find it a home.</li>';
  }else list.forEach(t=>{
    const li=document.createElement('li');
    const go=t.scheduled?'':`<button class="todo-go" title="Schedule at ${esc(bestSlot(k,t.mins)?minsLabel(bestSlot(k,t.mins).start):'')}">\u2192</button>`;
    li.className='todo-item'+(t.scheduled?' scheduled':'')+(todoDone(t)?' done':'');
    let small;
    if(t.scheduled){
      const ev=state.events.find(e=>e.id===t.eventId);
      small=ev?`${minsLabel(ev.start)} \u2013 ${minsLabel(ev.end)} \u00b7 done`:'Scheduled';
    }else{
      const s=bestSlot(k,t.mins);
      small=s?`${minsLabel(s.start)} \u2013 ${minsLabel(s.end)}${slotContext(k,s)?` \u00b7 ${esc(slotContext(k,s))}`:''}`:'No open spot today';
    }
    li.dataset.id=t.id;
    li.innerHTML=`<span class="todo-dot ${t.color}"></span><button class="todo-main"><b>${esc(t.title)}</b><small>${esc(small)}</small></button>${go}<button class="todo-x" title="Remove from list"><span>\u00d7</span></button>`;
    el.append(li);
  });
  updateTodoSuggest();
}

function renderTodoMenu(){
  const k=state.selectedDate,list=state.todos.filter(t=>t.date===k);
  const pending=list.filter(t=>!todoDone(t)).length;
  const count=$('#todoMenuCount');if(count)count.textContent=list.length?`${pending} left`:'All set';
  const badge=$('#todoBadge');
  if(badge)badge.hidden=!(pending>0),badge.textContent=pending;
  const el=$('#todoMenuList');if(!el)return;
  el.innerHTML='';
  if(!list.length){
    el.innerHTML='<li class="tm-empty">No to-dos for this day yet.</li>';
    return;
  }
  list.forEach(t=>{
    const li=document.createElement('li');
    li.className='tm-item'+(todoDone(t)?' done':'');
    li.dataset.id=t.id;
    li.innerHTML=`<span class="tm-check" aria-hidden="true"></span><span class="tm-dot ${t.color}"></span><span class="tm-text">${esc(t.title)}</span>`;
    li.onclick=()=>toggleTodoDone(t.id);
    el.append(li);
  });
}

function render(){renderTimeAxis();renderDays();renderTimeline();renderStats();renderTodos();renderTodoMenu();if(typeof syncSettingsUI==='function')syncSettingsUI()}

function show(id,trigger){
  returnFocus=trigger||document.activeElement;
  $('#scrim').classList.add('active');
  const s=$('#'+id);s.hidden=false;
  requestAnimationFrame(()=>s.classList.add('active'));
  setTimeout(()=>s.querySelector('input,select,button')?.focus(),80);
}

function close(){
  $('#scrim').classList.remove('active');
  $$('.sheet.active').forEach(s=>{s.classList.remove('active');setTimeout(()=>s.hidden=true,260)});
  returnFocus?.focus?.();
  editDate=null;
}

function color(c){$$('.chip').forEach(b=>b.classList.toggle('active',b.dataset.color===c))}

function setComposerTime(s){$('#startTime').value=minToHM(s.start);$('#endTime').value=minToHM(s.end)}

function updateComposerSlots(prefill=true){
  const c=$('.chip.active')?.dataset.color||'peach';
  const slots=suggestSlots(state.selectedDate,TODO_META[c].mins,3);
  if(prefill&&!composerTouched&&slots[0])setComposerTime(slots[0]);
  $('#composerSlots').innerHTML=slots.map((s,i)=>`<button type="button" class="composer-slot" data-s="${s.start}" data-e="${s.end}"><b>${i===0?'Best fit \u2014 ':''}${minsLabel(s.start)} \u2013 ${minsLabel(s.end)}</b><small>${slotContext(state.selectedDate,s)}${s.partial?' \u00b7 small gap':''}</small></button>`).join('');
}

function openComposer(e=null,dateForEdit=null){
  editDate=dateForEdit;
  composerTouched=false;
  $('#taskForm').reset();$('#formError').textContent='';$('#editId').value='';
  $('#composerTitle').textContent='Plan time';
  $('#saveButton').innerHTML='Add to my day <span>\u2192</span>';
  color('peach');
  if(e){
    $('#editId').value=e.id;
    $('#taskName').value=e.title;
    if(dateForEdit&&e.overrides&&e.overrides[dateForEdit]){
      const o=e.overrides[dateForEdit];
      $('#startTime').value=minToHM(o.start??e.start);
      $('#endTime').value=minToHM(o.end??e.end);
      color(o.color??e.color);
    }else{
      $('#startTime').value=minToHM(e.start);
      $('#endTime').value=minToHM(e.end);
      color(e.color);
    }
    $('#repeatRule').value=e.repeat;
    $('#lockSwitch').checked=!!e.locked;
    $('#composerTitle').textContent='Edit this day';
    $('#saveButton').innerHTML='Save changes <span>\u2192</span>';
  }else{
    $('#lockSwitch').checked=false;
  }
  $('#composerSlots').hidden=!!e;
  if(!e)updateComposerSlots(true);
  show('composer',$('#planButton'));
}

function openDetail(e){
  activeEvent=e;
  $('#detailTitle').textContent=e.title;
  $('#detailTime').textContent=`${minsLabel(e.start)} \u2014 ${minsLabel(e.end)}`;
  $('#detailRepeat').textContent=e.repeat==='once'?'One-time plan':`Repeats ${e.repeat==='weekdays'?'every weekday':e.repeat}`;
  $('#detailColor').className=`detail-color ${e.color}`;
  $('#deleteSeries').hidden=e.repeat==='once';
  const lk=$('#lockOccurrence');
  if(lk){lk.classList.toggle('locked',!!e.locked);lk.innerHTML=`${e.locked?'\u2298 Unlock':'Lock in place'}`}
  show('detailSheet');
}

function demo(){
  if(state.events.length&&!confirm('Replace your current schedule with the demo?'))return;
  const d=todayKey();
  state.events=[
    {id:uid(),title:'Math homework',date:d,start:960,end:1020,color:'peach',repeat:'once',excludedDates:[],overrides:{}},
    {id:uid(),title:'PSAT prep',date:d,start:1035,end:1095,color:'lilac',repeat:'weekdays',excludedDates:[],overrides:{}},
    {id:uid(),title:'Dinner + reset',date:d,start:1110,end:1140,color:'aqua',repeat:'daily',excludedDates:[],overrides:{}}
  ];
  state.todos=[
    {id:uid(),title:'Finish English essay',date:d,color:'peach',mins:60},
    {id:uid(),title:'Call Nana',date:d,color:'aqua',mins:30}
  ];
  state.selectedDate=d;save();render();close();console.log('Demo schedule loaded.');
}

function exportData(){
  const a=document.createElement('a');
  const b=new Blob([JSON.stringify({version:2,exportedAt:new Date().toISOString(),...state},null,2)],{type:'application/json'});
  a.href=URL.createObjectURL(b);a.download=`tempo-schedule-${todayKey()}.json`;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);console.log('Schedule exported.');
}

async function importData(f){
  try{
    const d=JSON.parse(await f.text());
    if(!d||!Array.isArray(d.events)||d.events.some(e=>!validEvent(e)))throw 0;
    const s=d.settings||{};
    state={
      events:d.events.map(e=>({...e,excludedDates:Array.isArray(e.excludedDates)?e.excludedDates:[],overrides:e.overrides||{}})),
      todos:Array.isArray(d.todos)?d.todos.filter(validTodo):[],
      selectedDate:/^\d{4}-\d{2}-\d{2}$/.test(d.selectedDate||'')?d.selectedDate:todayKey(),
      settings:{
        breakLength:Number.isInteger(s.breakLength)&&s.breakLength>=0?s.breakLength:DEF_BREAK,
        frameStart:Number.isInteger(s.frameStart)&&s.frameStart>=0&&s.frameStart<1440?s.frameStart:DEF_START,
        frameEnd:Number.isInteger(s.frameEnd)&&s.frameEnd>s.frameStart&&s.frameEnd<=1440?s.frameEnd:DEF_END
      }
    };
    save();render();close();console.log(`Imported ${state.events.length} blocks.`);
  }catch{console.log("That isn't a valid Tempo backup.");}finally{$('#importFile').value=''}
}

function renderTimeAxis(){
  const START=frameStart(),END=frameEnd();
  const tl=$('#timeLabels'),hl=$('#hourLines');
  tl.innerHTML='';hl.innerHTML='';
  for(let h=START;h<=END;h+=60){
    tl.insertAdjacentHTML('beforeend',`<span>${minsLabel(h).replace(':00','')}</span>`);
    hl.insertAdjacentHTML('beforeend','<i></i>');
  }
}
$('#planButton').onclick=()=>openComposer();
$('#planButtonAside').onclick=()=>openComposer();
$('.inline-add').onclick=()=>openComposer();
$('#previousDay').onclick=()=>{state.selectedDate=dateKey(new Date(parseDate(state.selectedDate)-DAY));save();render()};
$('#nextDay').onclick=()=>{state.selectedDate=dateKey(new Date(parseDate(state.selectedDate).getTime()+DAY));save();render()};
$('#todayButton').onclick=()=>{state.selectedDate=todayKey();save();render()};
$('#days').onclick=e=>{const b=e.target.closest('[data-date]');if(b){state.selectedDate=b.dataset.date;save();render()}};
$('#colors').onclick=e=>{const b=e.target.closest('[data-color]');if(b){color(b.dataset.color);if(!$('#editId').value)updateComposerSlots(true)}};
$('#startTime').addEventListener('input',()=>composerTouched=true);
$('#endTime').addEventListener('input',()=>composerTouched=true);
$('#composerSlots').onclick=e=>{
  const b=e.target.closest('.composer-slot');if(!b)return;
  setComposerTime({start:+b.dataset.s,end:+b.dataset.e});
  composerTouched=true;
  $$('#composerSlots .composer-slot').forEach(x=>x.classList.toggle('active',x===b));
};

function updateTodoSuggest(){
  const v=$('#todoInput').value.trim(),box=$('#todoSuggest');
  if(!v){box.hidden=true;return}
  box.hidden=false;
  const slots=suggestSlots(state.selectedDate,TODO_META[activeType].mins,3),fit=$('#todoFitText');
  if(!slots.length){
    fit.innerHTML='<b>No open spot</b> on this day\u2019s schedule \u2014 free something up first.';
    $('#todoSlots').innerHTML='';return;
  }
  const b=slots[0];
  fit.innerHTML=`Best fit \u2014 <b>${minsLabel(b.start)} \u2013 ${minsLabel(b.end)}</b>${b.partial?' <em>(small gap)</em>':''}${` \u00b7 ${esc(slotContext(state.selectedDate,b))}`}`;
  $('#todoSlots').innerHTML=slots.map((s,i)=>`<button type="button" class="t-slot" data-s="${s.start}" data-e="${s.end}" title="Schedule ${esc(TODO_META[activeType].label)} here">${i===0?'Schedule ':'or '}<b>${minsLabel(s.start)}</b></button>`).join('');
}

function addTodo(fromSchedule=false){
  const v=$('#todoInput').value.trim();if(!v){$('#todoInput').focus();return}
  const t={id:uid(),title:v,color:activeType,mins:TODO_META[activeType].mins,date:state.selectedDate};
  state.todos.push(t);
  $('#todoInput').value='';
  if(fromSchedule){const slot=bestSlot(t.date,t.mins);if(slot)return scheduleTodo(t,slot)}
  save();render();
  console.log('Added to your to-do list \u2014 I\u2019ll find it a spot.');
}
$('#todoForm').onsubmit=e=>{e.preventDefault();addTodo(false)};
$('#todoTypes').onclick=e=>{
  const b=e.target.closest('.tchip');if(!b)return;
  activeType=b.dataset.color;
  $('#todoForm').dataset.type=activeType;
  $$('#todoTypes .tchip').forEach(c=>c.classList.toggle('active',c===b));
  updateTodoSuggest();
};
$('#todoInput').addEventListener('input',updateTodoSuggest);
$('#todoSlots').onclick=e=>{
  const b=e.target.closest('.t-slot');if(!b)return;
  const t={id:uid(),title:$('#todoInput').value.trim(),color:activeType,mins:TODO_META[activeType].mins,date:state.selectedDate};
  if(!t.title){$('#todoInput').focus();return}
  state.todos.push(t);$('#todoInput').value='';
  scheduleTodo(t,{start:+b.dataset.s,end:+b.dataset.e});
};
$('#todoList').onclick=e=>{
  const li=e.target.closest('.todo-item');if(!li)return;
  const t=state.todos.find(x=>x.id===li.dataset.id);if(!t)return;
  if(e.target.closest('.todo-x')){
    if(t.scheduled&&t.eventId)state.events=state.events.filter(x=>x.id!==t.eventId);
    state.todos=state.todos.filter(x=>x.id!==t.id);
    save();render();return;
  }
  if(e.target.closest('.todo-main')){
    if(t.scheduled)toggleTodoDone(t.id);
    else scheduleTodo(t);
    return;
  }
  if(e.target.closest('.todo-go'))scheduleTodo(t);
};
$('#todoForm').dataset.type=activeType;

$('#taskForm').onsubmit=e=>{
  e.preventDefault();
  const title=$('#taskName').value.trim(),start=hmToMin($('#startTime').value),end=hmToMin($('#endTime').value),err=$('#formError');
  if(!title){err.textContent='Add a task name first.';$('#taskName').focus();return}
  if(!Number.isInteger(start)||!Number.isInteger(end)||end<=start){err.textContent='Your end time needs to be after the start time.';(Number.isInteger(start)?$('#endTime'):$('#startTime')).focus();return}
  const id=$('#editId').value,old=state.events.find(e=>e.id===id);
  const locked=$('#lockSwitch').checked;
  if(old&&editDate&&old.repeat!=='once'){
    if(!old.overrides)old.overrides={};
    old.overrides[editDate]={title,start,end,color:$('.chip.active').dataset.color};
    old.locked=locked;
  }else if(old){
    Object.assign(old,{title,start,end,color:$('.chip.active').dataset.color,repeat:$('#repeatRule').value,locked});
  }else{
    state.events.push({id:uid(),title,date:state.selectedDate,start,end,color:$('.chip.active').dataset.color,repeat:$('#repeatRule').value,excludedDates:[],overrides:{},locked});
  }
  save();render();close();console.log(id?'Plan updated.':'Added to your day.');
};

$('#editOccurrence').onclick=()=>{close();setTimeout(()=>openComposer(activeEvent,activeEvent?.occurrenceDate),280)};

$('#lockOccurrence').onclick=()=>{
  if(!activeEvent)return;
  const src=state.events.find(e=>e.id===activeEvent.id);
  if(!src)return;
  const next=!src.locked;
  src.locked=next;
  save();render();
  openDetail({...activeEvent,locked:next});
};

$('#deleteOccurrence').onclick=()=>{
  if(!activeEvent)return;
  const src=state.events.find(e=>e.id===activeEvent.id);
  if(!src){releaseTodoForEvent(activeEvent.id);state.events=state.events.filter(e=>e.id!==activeEvent.id);save();render();close();return}
  if(src.repeat==='once'){
    state.events=state.events.filter(e=>e.id!==src.id);
    releaseTodoForEvent(src.id);
  }else{
    if(!src.excludedDates)src.excludedDates=[];
    if(!src.excludedDates.includes(activeEvent.occurrenceDate)){
      src.excludedDates.push(activeEvent.occurrenceDate);
    }
  }
  save();render();close();
};

$('#deleteSeries').onclick=()=>{
  if(activeEvent&&confirm('Delete this entire repeating series?')){
    state.events=state.events.filter(e=>e.id!==activeEvent.id);
    releaseTodoForEvent(activeEvent.id);
    save();render();close();
  }
};

$$('.close').forEach(b=>b.onclick=close);
$('#scrim').onclick=close;
$('#breaksButton').onclick=()=>applyBreaks();
$('#settingsButton').onclick=()=>show('settings',$('#settingsButton'));

function syncSettingsUI(){
  const fs=$('#frameStartTime'),fe=$('#frameEndTime'),bs=$('#breakSelect');
  if(fs)fs.value=minToHM(state.settings.frameStart);
  if(fe)fe.value=minToHM(state.settings.frameEnd);
  if(bs)bs.value=String(state.settings.breakLength);
}
function updateFrame(){
  const k=state.selectedDate,fs=hmToMin($('#frameStartTime').value),fe=hmToMin($('#frameEndTime').value);
  if(!Number.isInteger(fs)||!Number.isInteger(fe)||fe<=fs){console.log('End time needs to be after the start time.');return}
  state.settings.frameStart=clamp(fs,0,1439);
  state.settings.frameEnd=clamp(fe,1,1440);
  if(state.settings.frameEnd<=state.settings.frameStart)state.settings.frameEnd=state.settings.frameStart+30;
  save();render();
}
$('#frameStartTime').onchange=updateFrame;
$('#frameEndTime').onchange=updateFrame;
$('#breakSelect').onchange=()=>{
  state.settings.breakLength=Number($('#breakSelect').value)||0;
  save();
};
syncSettingsUI();
(function todoMenuInit(){
  const btn=$('#todoMenuButton'),menu=$('#todoMenu');
  if(!btn||!menu)return;
  const setOpen=open=>{
    menu.hidden=!open;
    btn.setAttribute('aria-expanded',open?'true':'false');
    if(open)renderTodoMenu();
  };
  const isOpen=()=>!menu.hidden;
  btn.onclick=e=>{e.stopPropagation();setOpen(!isOpen())};
  menu.onclick=e=>e.stopPropagation();
  document.addEventListener('click',e=>{if(!e.target.closest('#todoMenuButton')&&!e.target.closest('#todoMenu'))setOpen(false)});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')setOpen(false)});
  setOpen(false);
})();
$('#syncCard').onclick=e=>{if(e.target.tagName!=='BUTTON')show('syncSheet',$('#syncCard'))};
$('#syncButton').onclick=()=>show('syncSheet',$('#syncButton'));
$('#syncMessage').textContent='Offline mode \u2014 Tempo is saved in this browser on this device. Add Firebase configuration to enable cross-device sync.';
$('#exportButton').onclick=exportData;
$('#settingsExport').onclick=exportData;
const pick=()=>$('#importFile').click();
$('#importButton').onclick=pick;
$('#settingsImport').onclick=pick;
$('#importFile').onchange=e=>e.target.files[0]&&importData(e.target.files[0]);
$('#demoButton').onclick=demo;
$('#clearButton').onclick=()=>{
  if(confirm('Clear every Tempo task from this device? This cannot be undone.')){
    state={events:[],todos:[],selectedDate:todayKey(),settings:state.settings};save();render();close();console.log('Schedule cleared.');
  }
};
document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});

window.TempoApp={validEvent:validEvent,validTodo:validTodo,getState:()=>state,setEvents:function(events){state.events=events},setTodos:function(todos){state.todos=todos},setSelectedDate:function(d){state.selectedDate=d},setSettings:function(settings){const r=settings||{},s=state.settings||{};state.settings={breakLength:Number.isInteger(r.breakLength)&&r.breakLength>=0?r.breakLength:s.breakLength??DEF_BREAK,frameStart:Number.isInteger(r.frameStart)&&r.frameStart>=0&&r.frameStart<1440?r.frameStart:s.frameStart??DEF_START,frameEnd:Number.isInteger(r.frameEnd)&&r.frameEnd>r.frameStart&&r.frameEnd<=1440?r.frameEnd:s.frameEnd??DEF_END}},save:function(toCloud){save(toCloud)},render:render,toast:toast,close:close,todayKey:todayKey,scheduleTodo:scheduleTodo,renderTodos:renderTodos};

if(window.TempoFirebase){
  window.TempoFirebase.init();
  $('#googleButton').onclick=()=>window.TempoFirebase.signIn();
  $('#signOutButton').onclick=()=>window.TempoFirebase.signOut();
  var syncMsg=$('#syncMessage');
  if(syncMsg)syncMsg.textContent='Offline mode \u2014 Tempo is saved in this browser on this device. Sign in with Google to sync across devices.';
}
if(window.TempoNotifications)window.TempoNotifications.init();

(function shuffleGreeting(){
  const [a,b]=GREETINGS[Math.floor(Math.random()*GREETINGS.length)];
  $('#greeting').innerHTML=`${a}<br><em>${b}</em>`;
})();
render();
if('serviceWorker'in navigator)addEventListener('load',()=>navigator.serviceWorker.register(window.TEMPO_FIREBASE_CONFIG?'./firebase-messaging-sw.js':'./service-worker.js').catch(()=>{}));
})();
