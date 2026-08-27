(() => {'use strict';
const STORE='tempo.schedule.v2',START=420,END=1320,DAY=86400000;
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const pad=n=>String(n).padStart(2,'0');
const dateKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseDate=k=>{const[y,m,d]=k.split('-').map(Number);return new Date(y,m-1,d,12)};
const todayKey=()=>dateKey(new Date());
const uid=()=>crypto?.randomUUID?.()||`tempo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const minsLabel=n=>{const h=Math.floor(n/60),m=n%60;return`${h%12||12}:${pad(m)} ${h>=12?'PM':'AM'}`};
const durationLabel=m=>`${Math.floor(m/60)}h ${m%60}m`;

function validEvent(e){
  if(!e||typeof e.id!=='string'||typeof e.title!=='string')return false;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(e.date))return false;
  if(!Number.isInteger(e.start)||!Number.isInteger(e.end))return false;
  if(e.start<0||e.end>1440||e.end<=e.start)return false;
  if(!['peach','lilac','aqua','lime'].includes(e.color))return false;
  if(!['once','daily','weekdays','weekly'].includes(e.repeat||'once'))return false;
  if(e.excludedDates&&!Array.isArray(e.excludedDates))return false;
  if(e.overrides&&typeof e.overrides!=='object')return false;
  return true;
}

function load(){
  try{
    const x=JSON.parse(localStorage.getItem(STORE)||'{}');
    return{
      events:Array.isArray(x.events)?x.events.filter(validEvent):[],
      selectedDate:/^\d{4}-\d{2}-\d{2}$/.test(x.selectedDate||'')?x.selectedDate:todayKey()
    };
  }catch{return{events:[],selectedDate:todayKey()}}
}

let state=load(),activeEvent=null,returnFocus=null,editDate=null;

function save(toCloud=true){
  try{localStorage.setItem(STORE,JSON.stringify(state))}catch{toast("Couldn't save locally. Check browser storage settings.")}
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

function fmt(k,long=false){
  return parseDate(k).toLocaleDateString(undefined,long
    ?{weekday:'long',month:'long',day:'numeric'}
    :{weekday:'short',month:'short',day:'numeric'});
}

function esc(v){const s=document.createElement('span');s.textContent=v;return s.innerHTML}

function buildTimes(){
  let o='';
  for(let n=0;n<=1440;n+=15)o+=`<option value="${n}">${minsLabel(n)}</option>`;
  $('#startTime').innerHTML=o;$('#endTime').innerHTML=o;
}

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
    b.className=`event ${e.color}`;
    b.style.cssText=`top:${top}%;height:${h}%;left:calc(${e.c/max*100}% + 5px);width:calc(${100/max}% - 7px);animation-delay:${i*45}ms`;
    b.innerHTML=`<b>${esc(e.title)}${e.repeat!=='once'?' <em>\u21bb</em>':''}</b><small>${minsLabel(e.start)} \u2013 ${minsLabel(e.end)}</small>`;
    b.onclick=()=>openDetail({...e,occurrenceDate:state.selectedDate});
    box.append(b);
  });
  const now=new Date(),n=now.getHours()*60+now.getMinutes();
  const yes=state.selectedDate===todayKey()&&n>=START&&n<=END;
  $('#nowLine').hidden=!yes;
  if(yes){$('#nowLine').style.top=`${(n-START)/(END-START)*100}%`;$('#nowLine span').textContent=minsLabel(n)}
}

function renderStats(){
  const mins=eventList(state.selectedDate).reduce((n,e)=>n+e.end-e.start,0);
  const free=END-START-mins;
  $('#freeTime').textContent=free>0?`${durationLabel(free)} to recharge`:'Full day \u2014 you\u2019ve got this.';
  $('#budgetText').textContent=mins?`${durationLabel(mins)} protected for what matters.`:'Your plan has room to breathe.';
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

function render(){renderDays();renderTimeline();renderStats()}

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

function openComposer(e=null,dateForEdit=null){
  editDate=dateForEdit;
  $('#taskForm').reset();$('#formError').textContent='';$('#editId').value='';
  $('#composerTitle').textContent='Plan time';
  $('#saveButton').innerHTML='Add to my day <span>\u2192</span>';
  color('peach');
  if(e){
    $('#editId').value=e.id;
    $('#taskName').value=e.title;
    if(dateForEdit&&e.overrides&&e.overrides[dateForEdit]){
      const o=e.overrides[dateForEdit];
      $('#startTime').value=o.start??e.start;
      $('#endTime').value=o.end??e.end;
      color(o.color??e.color);
    }else{
      $('#startTime').value=e.start;
      $('#endTime').value=e.end;
      color(e.color);
    }
    $('#repeatRule').value=e.repeat;
    $('#composerTitle').textContent='Edit this day';
    $('#saveButton').innerHTML='Save changes <span>\u2192</span>';
  }
  show('composer',$('#planButton'));
}

function openDetail(e){
  activeEvent=e;
  $('#detailTitle').textContent=e.title;
  $('#detailTime').textContent=`${minsLabel(e.start)} \u2014 ${minsLabel(e.end)}`;
  $('#detailRepeat').textContent=e.repeat==='once'?'One-time plan':`Repeats ${e.repeat==='weekdays'?'every weekday':e.repeat}`;
  $('#detailColor').className=`detail-color ${e.color}`;
  $('#deleteSeries').hidden=e.repeat==='once';
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
  state.selectedDate=d;save();render();close();toast('Demo schedule loaded.');
}

function exportData(){
  const a=document.createElement('a');
  const b=new Blob([JSON.stringify({version:2,exportedAt:new Date().toISOString(),...state},null,2)],{type:'application/json'});
  a.href=URL.createObjectURL(b);a.download=`tempo-schedule-${todayKey()}.json`;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Schedule exported.');
}

async function importData(f){
  try{
    const d=JSON.parse(await f.text());
    if(!d||!Array.isArray(d.events)||d.events.some(e=>!validEvent(e)))throw 0;
    state={
      events:d.events.map(e=>({...e,excludedDates:Array.isArray(e.excludedDates)?e.excludedDates:[],overrides:e.overrides||{}})),
      selectedDate:/^\d{4}-\d{2}-\d{2}$/.test(d.selectedDate||'')?d.selectedDate:todayKey()
    };
    save();render();close();toast(`Imported ${state.events.length} blocks.`);
  }catch{toast("That isn't a valid Tempo backup.");}finally{$('#importFile').value=''}
}

buildTimes();
for(let h=START;h<=END;h+=60){
  $('#timeLabels').insertAdjacentHTML('beforeend',`<span>${minsLabel(h).replace(':00','')}</span>`);
  $('#hourLines').insertAdjacentHTML('beforeend','<i></i>');
}
$('#startTime').value=960;$('#endTime').value=1020;
$('#planButton').onclick=()=>openComposer();
$('#planButtonAside').onclick=()=>openComposer();
$('.inline-add').onclick=()=>openComposer();
$('#previousDay').onclick=()=>{state.selectedDate=dateKey(new Date(parseDate(state.selectedDate)-DAY));save();render()};
$('#nextDay').onclick=()=>{state.selectedDate=dateKey(new Date(parseDate(state.selectedDate).getTime()+DAY));save();render()};
$('#todayButton').onclick=()=>{state.selectedDate=todayKey();save();render()};
$('#days').onclick=e=>{const b=e.target.closest('[data-date]');if(b){state.selectedDate=b.dataset.date;save();render()}};
$('#colors').onclick=e=>{const b=e.target.closest('[data-color]');if(b)color(b.dataset.color)};

$('#taskForm').onsubmit=e=>{
  e.preventDefault();
  const title=$('#taskName').value.trim(),start=+$('#startTime').value,end=+$('#endTime').value,err=$('#formError');
  if(!title){err.textContent='Add a task name first.';$('#taskName').focus();return}
  if(end<=start){err.textContent='Your end time needs to be after the start time.';$('#endTime').focus();return}
  const id=$('#editId').value,old=state.events.find(e=>e.id===id);
  if(old&&editDate&&old.repeat!=='once'){
    if(!old.overrides)old.overrides={};
    old.overrides[editDate]={title,start,end,color:$('.chip.active').dataset.color};
  }else if(old){
    Object.assign(old,{title,start,end,color:$('.chip.active').dataset.color,repeat:$('#repeatRule').value});
  }else{
    state.events.push({id:uid(),title,date:state.selectedDate,start,end,color:$('.chip.active').dataset.color,repeat:$('#repeatRule').value,excludedDates:[],overrides:{}});
  }
  save();render();close();toast(id?'Plan updated.':'Added to your day.');
};

$('#editOccurrence').onclick=()=>{close();setTimeout(()=>openComposer(activeEvent,activeEvent?.occurrenceDate),280)};

$('#deleteOccurrence').onclick=()=>{
  if(!activeEvent)return;
  const src=state.events.find(e=>e.id===activeEvent.id);
  if(!src){state.events=state.events.filter(e=>e.id!==activeEvent.id);save();render();close();return}
  if(src.repeat==='once'){
    state.events=state.events.filter(e=>e.id!==src.id);
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
    save();render();close();
  }
};

$$('.close').forEach(b=>b.onclick=close);
$('#scrim').onclick=close;
$('#settingsButton').onclick=()=>show('settings',$('#settingsButton'));
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
    state={events:[],selectedDate:todayKey()};save();render();close();toast('Schedule cleared.');
  }
};
document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});

window.TempoApp={validEvent:validEvent,getState:()=>state,setEvents:function(events){state.events=events},setSelectedDate:function(d){state.selectedDate=d},save:function(toCloud){save(toCloud)},render:render,toast:toast,close:close,todayKey:todayKey};

if(window.TempoFirebase){
  window.TempoFirebase.init();
  $('#googleButton').onclick=()=>window.TempoFirebase.signIn();
  $('#signOutButton').onclick=()=>window.TempoFirebase.signOut();
  var syncMsg=$('#syncMessage');
  if(syncMsg)syncMsg.textContent='Offline mode \u2014 Tempo is saved in this browser on this device. Sign in with Google to sync across devices.';
}
if(window.TempoNotifications)window.TempoNotifications.init();

render();
if('serviceWorker'in navigator)addEventListener('load',()=>navigator.serviceWorker.register(window.TEMPO_FIREBASE_CONFIG?'./firebase-messaging-sw.js':'./service-worker.js').catch(()=>{}));
})();
