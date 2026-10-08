// ══════════════════════════════════════════════════════════════
// EUFORIA — Estadísticas (Mis stats + Equipo)
// Lee el Sheet público de estadísticas vía gviz (mismas pestañas que el
// tablero anterior) y replica sus cálculos: Hold%, Break%, +/−, líneas.
// Depende de index.html: $, esc, ic, SESSION, DATA, toast.
// ══════════════════════════════════════════════════════════════
const STATS_SHEET='1fgCeC_OlKUiK_T9i1F-R8OU_aLSqIdjySkVwmkunbwM';
const ST={promise:null,ready:false,partidos:[],puntos:[],xp:[],players:[],torneo:'all',sub:'resumen',
  game:null,player:null,cmpA:null,cmpB:null,metric:'goles',lineType:'O',minPts:2,progMetric:'impacto',allPts:false};

const num=v=>parseFloat(v)||0;
const normTokens=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().split(/[\s-]+/).filter(Boolean);
const short=n=>{const w=String(n||'').trim().split(/\s+/);return w.length<=2?w.join(' '):w[0]+' '+w[w.length>3?2:1];};
const ini=n=>String(n||'').trim().split(/[\s-]+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();
const fDate=d=>{const t=new Date(d+'T12:00:00');return isNaN(t)?d:t.toLocaleDateString('es-CO',{day:'numeric',month:'short'}).replace(' de ',' ').replace('.','');};
const pct=(a,b)=>b>0?Math.round(a/b*1000)/10:0;

// ── Carga ──────────────────────────────────────────────────────
function parseCSV(txt){
  const rows=[];let row=[],cur='',q=false;
  for(let i=0;i<txt.length;i++){const c=txt[i];
    if(q){if(c==='"'){if(txt[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=c;}
    else if(c==='"')q=true;else if(c===','){row.push(cur);cur='';}
    else if(c==='\n'){row.push(cur);rows.push(row);row=[];cur='';}else if(c!=='\r')cur+=c;}
  if(cur||row.length){row.push(cur);rows.push(row);}
  const h=(rows.shift()||[]).map(x=>x.trim());
  return rows.filter(r=>r.some(x=>x.trim())).map(r=>Object.fromEntries(h.map((k,i)=>[k,(r[i]||'').trim()])));
}
async function csv(tab){
  const r=await fetch(`https://docs.google.com/spreadsheets/d/${STATS_SHEET}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`);
  if(!r.ok)throw new Error('No se pudo cargar '+tab);
  return parseCSV(await r.text());
}
function loadStats(){
  if(!ST.promise)ST.promise=Promise.all(['partidos','puntos','stats_x_partido'].map(csv)).then(([p,pts,xp])=>{
    ST.partidos=p.filter(g=>g.game_id).sort((a,b)=>(a.fecha+a.hora).localeCompare(b.fecha+b.hora));
    ST.puntos=pts;ST.xp=xp.filter(x=>x.jugador);
    ST.players=[...new Set(ST.xp.map(x=>x.jugador.trim()))].sort((a,b)=>a.localeCompare(b,'es'));
    ST.ready=true;
  }).catch(e=>{ST.promise=null;throw e;});
  return ST.promise;
}

// Nombre del jugador en la base de stats: columna "Nombre stats" de USUARIOS, o cruce automático
function myStatsName(){
  const given=(DATA&&DATA.statsName)||'';
  if(given){const g=ST.players.find(p=>p.toLowerCase()===given.trim().toLowerCase());if(g)return g;}
  const t=normTokens(SESSION?.nombre);if(!t.length)return null;
  const c=ST.players.filter(p=>{const s=new Set(normTokens(p));return t.every(x=>s.has(x));});
  return c.length===1?c[0]:null;
}

// ── Filtros y agregados ────────────────────────────────────────
const games=()=>ST.torneo==='all'?ST.partidos:ST.partidos.filter(g=>g.torneo===ST.torneo);
const gameIds=()=>new Set(games().map(g=>g.game_id));
const gameById=id=>ST.partidos.find(g=>g.game_id===id);
function xpRows(){const ids=gameIds();return ST.xp.filter(x=>ids.has(x.game_id));}
function ptsRows(){const ids=gameIds();return ST.puntos.filter(p=>ids.has(p.game_id));}
const FIELDS=['puntos_jugados','puntos_O','puntos_D','goles','asistencias','catches','lanzamientos','completados','throwaways','drops','defensas','holds','holds_lost','breaks','breaks_conceded'];
function sum(rows){
  const t=Object.fromEntries(FIELDS.map(f=>[f,0]));rows.forEach(r=>FIELDS.forEach(f=>t[f]+=num(r[f])));
  t.pm=t.goles+t.asistencias+t.defensas-t.drops-t.throwaways;   // mismo +/− del tablero anterior
  t.comp=pct(t.completados,t.lanzamientos);t.pmO=t.holds-t.holds_lost;t.pmD=t.breaks-t.breaks_conceded;
  t.hold=pct(t.holds,t.puntos_O);t.brk=pct(t.breaks,t.puntos_D);t.partidos=new Set(rows.map(r=>r.game_id)).size;
  return t;
}
function table(){const g={};xpRows().forEach(r=>(g[r.jugador.trim()]=g[r.jugador.trim()]||[]).push(r));
  return Object.entries(g).map(([n,rows])=>({n,...sum(rows)})).filter(p=>p.puntos_jugados>0);}
const METRICS={goles:['Goles','goles'],asistencias:['Asistencias','asistencias'],defensas:['Defensas','defensas'],pm:['+/−','pm'],comp:['Comp %','comp']};
function ranked(metric){const t=table();const k=METRICS[metric][1];
  const pool=metric==='comp'?t.filter(p=>p.lanzamientos>=20):t;
  return pool.sort((a,b)=>b[k]-a[k]||b.puntos_jugados-a.puntos_jugados);}
function rankOf(name,metric){const r=ranked(metric);const i=r.findIndex(p=>p.n===name);return i<0?null:{pos:i+1,of:r.length};}
const fmt=(m,v)=>m==='comp'?v+'%':(m==='pm'&&v>0?'+'+v:String(v));

// ── Gráficas SVG (sin librerías) ───────────────────────────────
function lineChart(series,o={}){
  const W=320,H=o.h||140,p=26,all=series.flatMap(s=>s.v),n=series[0].v.length;
  if(n<2)return '<div class="empty">Se necesitan al menos 2 datos</div>';
  const mx=o.max??Math.max(...all,1),mn=o.min??Math.min(0,...all);
  const x=i=>p+i*(W-p-10)/(n-1),y=a=>H-20-(a-mn)/((mx-mn)||1)*(H-34);
  let g='';(o.grid||[]).forEach(t=>g+=`<line x1="${p}" x2="${W-10}" y1="${y(t)}" y2="${y(t)}" stroke="rgba(255,255,255,.07)"/><text x="${p-5}" y="${y(t)+3}" fill="rgba(255,255,255,.4)" font-size="9" text-anchor="end">${t}${o.unit||''}</text>`);
  const paths=series.map((s,k)=>{const d=s.v.map((a,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(a).toFixed(1)).join(' ');
    return (k===0&&o.fill?`<path d="${d} L${x(n-1)} ${y(mn)} L${x(0)} ${y(mn)}Z" fill="${s.c}" opacity=".16"/>`:'')+
      `<path d="${d}" fill="none" stroke="${s.c}" stroke-width="2.4" stroke-linejoin="round" style="filter:drop-shadow(0 0 4px ${s.c}88)"/>`+
      (n<=30?s.v.map((a,i)=>`<circle cx="${x(i)}" cy="${y(a)}" r="2.6" fill="${s.c}"/>`).join(''):'');}).join('');
  const step=Math.ceil(n/8);
  const labs=(o.labels||[]).map((l,i)=>(i%step===0&&n-1-i>=step/2)||i===n-1?`<text x="${x(i)}" y="${H-4}" fill="rgba(255,255,255,.4)" font-size="8.5" text-anchor="middle">${esc(l)}</text>`:'').join('');
  return `<svg viewBox="0 0 ${W} ${H}" font-family="Barlow">${g}${paths}${labs}</svg>`;
}
function radar(sets,labels){
  const P=(v,i,r=80)=>{const a=-Math.PI/2+i*2*Math.PI/labels.length;return[120+r*v*Math.cos(a),100+r*v*Math.sin(a)];};
  const grid=[1,.66,.33].map(r=>`<polygon points="${labels.map((_,i)=>P(r,i).join(',')).join(' ')}" fill="none" stroke="rgba(255,255,255,.08)"/>`).join('');
  const polys=sets.map(s=>`<polygon points="${s.v.map((v,i)=>P(Math.max(.04,v),i).join(',')).join(' ')}" fill="${s.c}33" stroke="${s.c}" stroke-width="2"/>`).join('');
  const t=labels.map((l,i)=>{const[x,y]=P(1.22,i);return`<text x="${x}" y="${y+3}" fill="rgba(255,255,255,.55)" font-size="10" text-anchor="middle">${l}</text>`;}).join('');
  return `<svg viewBox="0 0 240 200" width="250" font-family="Barlow">${grid}${polys}${t}</svg>`;
}
const ring=(p,val,lbl,size=110)=>{const C=326.7;return `<div class="ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 120 120"><circle class="trk" cx="60" cy="60" r="52"/><circle class="val" cx="60" cy="60" r="52" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-off="${C*(1-p)}"/></svg><div class="ctr"><div class="pct">${val}</div><div class="lbl">${lbl}</div></div></div>`;};
function animate(root){requestAnimationFrame(()=>requestAnimationFrame(()=>{
  root.querySelectorAll('.ring .val[data-off]').forEach(c=>c.style.strokeDashoffset=c.dataset.off);
  root.querySelectorAll('.bar i[data-w]').forEach(b=>b.style.width=b.dataset.w+'%');}));}

// ── Controles comunes ──────────────────────────────────────────
function torneoSel(){
  const ts=[...new Set(ST.partidos.map(g=>g.torneo).filter(Boolean))];
  return `<label class="sel">🏆<select onchange="ST.torneo=this.value;ST.game=null;rerenderStats()"><option value="all">Toda la temporada</option>${ts.map(t=>`<option ${ST.torneo===t?'selected':''}>${esc(t)}</option>`).join('')}</select></label>`;
}
function playerSel(cur,handler,label='👤'){
  return `<label class="sel">${label}<select onchange="${handler}">${ST.players.map(p=>`<option ${p===cur?'selected':''} value="${esc(p)}">${esc(p)}</option>`).join('')}</select></label>`;
}
const loadingHTML='<div class="sk" style="height:56px;margin-top:6px"></div><div class="sk" style="height:180px;margin-top:12px"></div><div class="sk" style="height:120px;margin-top:12px"></div>';
const errHTML=e=>`<div class="card empty" style="margin-top:14px">No pudimos cargar las estadísticas.<br><small>${esc(e.message||'')}</small><br><br><button class="btn" onclick="ST.promise=null;rerenderStats()">Reintentar</button></div>`;

async function withStats(el,fn){
  if(!ST.ready){el.innerHTML=loadingHTML;try{await loadStats();}catch(e){el.innerHTML=errHTML(e);return;}}
  fn();animate(el);
}
function rerenderStats(){
  if($('v-mis').classList.contains('on'))renderMis();
  if($('v-equipo').classList.contains('on'))renderTeam();
}

// ── Ficha de jugador (Mis stats y pestaña Jugador) ─────────────
function profileHTML(name,mine){
  const rows=xpRows().filter(r=>r.jugador.trim()===name);
  if(!rows.length)return `<div class="card empty" style="margin-top:14px">${mine?'Aún no tienes':'No hay'} partidos registrados${ST.torneo!=='all'?' en este torneo':''}.</div>`;
  const s=sum(rows);
  const byGame=rows.map(r=>({g:gameById(r.game_id),s:sum([r])})).filter(x=>x.g).sort((a,b)=>(a.g.fecha+a.g.hora).localeCompare(b.g.fecha+b.g.hora));
  const best=[...byGame].sort((a,b)=>b.s.pm-a.s.pm)[0];
  const PM={impacto:['Impacto (+/−)',x=>x.pm],produccion:['Goles + asist.',x=>x.goles+x.asistencias],eficiencia:['Comp %',x=>x.comp]};
  const [pl,pf]=PM[ST.progMetric];
  const tiles=mine?['goles','asistencias','defensas','pm'].map(m=>{const r=rankOf(name,m);if(!r)return'';
      return `<div class="card"><div class="cap">${METRICS[m][0]}</div><div class="v" style="${r.pos<=3?'color:var(--gold)':''}">#${r.pos}</div><small>de ${r.of} · ${fmt(m,s[METRICS[m][1]])}</small></div>`;}).join(''):'';
  const myLines=linesData().filter(l=>l.players.includes(name)).sort((a,b)=>b.pts-a.pts).slice(0,2);
  return `
  <div class="prof"><div class="h"><div class="avatar">${esc(ini(name))}</div><div><b class="nm">${esc(short(name))}</b><small>${s.partidos} partidos · ${s.puntos_jugados} puntos jugados</small></div></div>
    <div class="five"><div><b>${s.goles}</b><small>Goles</small></div><div><b>${s.asistencias}</b><small>Asist.</small></div><div><b>${s.defensas}</b><small>D's</small></div><div><b class="${s.pm>0?'g':s.pm<0?'r':''}">${fmt('pm',s.pm)}</b><small>+/−</small></div><div><b>${s.lanzamientos?Math.round(s.comp)+'%':'—'}</b><small>Comp.</small></div></div></div>
  ${mine&&tiles?`<div class="sec"><div class="sec-h"><span class="cap">Tu lugar en el equipo</span></div><div class="tr" style="margin-top:0">${tiles}</div></div>`:''}
  <div class="od">
    <div class="card"><div class="cap">🔴 Línea O · ${s.puntos_O} pts</div><div class="v ${s.pmO>0?'g':s.pmO<0?'r':''}">${fmt('pm',s.pmO)}</div><div class="bar"><i data-w="${s.hold}"></i></div><small class="mini-s">Hold ${s.hold}% · ${s.holds}/${s.puntos_O}</small></div>
    <div class="card"><div class="cap">🔵 Línea D · ${s.puntos_D} pts</div><div class="v ${s.pmD>0?'g':s.pmD<0?'r':''}">${fmt('pm',s.pmD)}</div><div class="bar"><i class="blue" data-w="${s.brk}"></i></div><small class="mini-s">Break ${s.brk}% · ${s.breaks}/${s.puntos_D}</small></div></div>
  <div class="sec"><div class="sec-h"><span class="cap">Progresión por partido</span></div>
    <div class="chips" style="margin:0 -16px 10px">${Object.entries(PM).map(([k,[l]])=>`<button class="chip sm ${ST.progMetric===k?'on':''}" onclick="ST.progMetric='${k}';rerenderStats()">${l}</button>`).join('')}</div>
    <div class="card chart">${lineChart([{v:byGame.map(x=>pf(x.s)),c:'#e5383e'}],{fill:true,labels:byGame.map(x=>fDate(x.g.fecha)),grid:ST.progMetric==='eficiencia'?[0,50,100]:undefined,unit:ST.progMetric==='eficiencia'?'%':'',min:ST.progMetric==='eficiencia'?0:undefined,max:ST.progMetric==='eficiencia'?100:undefined})}</div></div>
  ${best?`<div class="card streak" style="margin-top:14px"><span class="em">⭐</span><div><b>${mine?'Tu mejor':'Mejor'} partido</b><small>vs ${esc(best.g.rival)} · ${fDate(best.g.fecha)} · ${best.s.goles} G, ${best.s.asistencias} A, ${best.s.defensas} D · ${fmt('pm',best.s.pm)}</small></div></div>`:''}
  ${myLines.length?`<div class="sec"><div class="sec-h"><span class="cap">${mine?'Tus líneas':'Sus líneas'} más usadas</span></div>${myLines.map(l=>lineCard(l,name)).join('')}</div>`:''}
  <div class="sec"><div class="sec-h"><span class="cap">Partido a partido</span></div>
    <div class="card">${[...byGame].reverse().slice(0,8).map(x=>`<div class="match"><div class="res ${x.g.resultado==='W'?'w':'l'}">${x.g.resultado==='W'?'V':'D'}</div><div class="nm"><b>vs ${esc(x.g.rival)}</b><small>${fDate(x.g.fecha)} · ${x.s.puntos_jugados} pts · ${x.s.goles}G ${x.s.asistencias}A ${x.s.defensas}D</small></div><div class="sc ${x.s.pm>0?'g':x.s.pm<0?'r':''}">${fmt('pm',x.s.pm)}</div></div>`).join('')}</div></div>`;
}

function renderMis(){
  const el=$('v-mis');
  withStats(el,()=>{
    const me=myStatsName();
    el.innerHTML=`<div class="page-h"><h2>Mis stats</h2><small>Temporada 2026</small></div>
      <div class="f">${torneoSel()}</div>
      ${me?profileHTML(me,true):`<div class="card empty" style="margin-top:14px">Aún no encontramos tus estadísticas.<br><small>Si ya jugaste torneos registrados, pide al capitán que revise tu "Nombre stats" en la hoja USUARIOS.</small></div>`}`;
  });
}

// ── Equipo ─────────────────────────────────────────────────────
const SUBS=[['resumen','Resumen'],['partidos','Partidos'],['jugador','Jugador'],['comparar','Comparar'],['lineas','Líneas'],['evolucion','Evolución']];
function renderTeam(){
  const el=$('v-equipo');
  withStats(el,()=>{
    const body={resumen:tResumen,partidos:tPartidos,jugador:tJugador,comparar:tComparar,lineas:tLineas,evolucion:tEvolucion}[ST.sub]();
    el.innerHTML=`<div class="page-h"><h2>Equipo</h2><small>Estadísticas · Temporada 2026</small></div>
      <div class="chips" id="team-tabs">${SUBS.map(([k,l])=>`<button class="chip ${ST.sub===k?'on':''}" onclick="ST.sub='${k}';rerenderStats();scrollTo({top:0})">${l}</button>`).join('')}</div>
      ${body}`;
    const on=el.querySelector('#team-tabs .on');if(on)on.scrollIntoView({inline:'center',block:'nearest'});
  });
}

function tResumen(){
  const g=games(),w=g.filter(x=>x.resultado==='W').length,gf=g.reduce((s,x)=>s+num(x.nuestros),0),gc=g.reduce((s,x)=>s+num(x.suyos),0);
  const last=g.slice(-8);
  const lead=['goles','asistencias','defensas'].map(m=>({m,p:ranked(m)[0]})).filter(x=>x.p);
  const byT={};ST.partidos.forEach(x=>{const t=x.torneo||'—';(byT[t]=byT[t]||{t,w:0,l:0,f:x.fecha}).w+=x.resultado==='W'?1:0;byT[t].l+=x.resultado==='W'?0:1;});
  const rk=ranked(ST.metric),me=myStatsName();
  return `<div class="f">${torneoSel()}</div>
  <div class="card rec">${ring(g.length?w/g.length:0,g.length?Math.round(w/g.length*100)+'%':'—','victorias')}
    <div><div class="cap">Récord</div><div class="big-n">${w} – ${g.length-w}</div><div class="mini-s">${g.length} partidos jugados</div>
    <div class="wl">${last.map(x=>`<i class="${x.resultado==='W'?'w':'l'}">${x.resultado==='W'?'V':'D'}</i>`).join('')}</div></div></div>
  <div class="kp"><div><small>A favor</small><b>${gf}</b></div><div><small>En contra</small><b>${gc}</b></div><div><small>Diferencia</small><b class="${gf-gc>=0?'g':'r'}">${gf-gc>0?'+':''}${gf-gc}</b></div></div>
  ${lead.length===3?`<div class="sec"><div class="sec-h"><span class="cap">Líderes</span></div><div class="podium">
    ${[lead[1],lead[0],lead[2]].map((x,i)=>`<div class="${i===1?'p1':''}"><div class="avatar" ${i===1?'style="width:52px;height:52px"':''}>${esc(ini(x.p.n))}</div><b>${esc(short(x.p.n)).replace(' ','<br>')}</b><div class="n" ${i===1?'style="color:var(--gold)"':''}>${x.p[METRICS[x.m][1]]}</div><small>${METRICS[x.m][0].toLowerCase()}</small></div>`).join('')}
  </div></div>`:''}
  <div class="sec"><div class="sec-h"><span class="cap">Tabla de jugadores</span></div>
    <div class="chips" style="margin:0 -16px 10px">${Object.entries(METRICS).map(([k,[l]])=>`<button class="chip sm ${ST.metric===k?'on':''}" onclick="ST.metric='${k}';rerenderStats()">${l}</button>`).join('')}</div>
    <div class="card">${rk.slice(0,ST.allPts?99:10).map((p,i)=>{const max=Math.max(1,Math.abs(rk[0][METRICS[ST.metric][1]]));const v=p[METRICS[ST.metric][1]];
      return `<div class="rank ${p.n===me?'me':''}"><div class="pos ${i<3?'gd':''}">${i+1}</div><div class="avatar">${esc(ini(p.n))}</div><div class="nm"><b>${esc(p.n===me?'Tú · '+short(p.n):short(p.n))}</b><div class="bar"><i data-w="${Math.max(0,Math.round(v/max*100))}"></i></div></div><div class="v">${fmt(ST.metric,v)}<small>${p.puntos_jugados} pts</small></div></div>`;}).join('')}
    ${rk.length>10?`<button class="more" onclick="ST.allPts=!ST.allPts;rerenderStats()">${ST.allPts?'Ver menos':'Ver los '+rk.length}</button>`:''}</div>
    ${ST.metric==='comp'?'<small class="mini-s">Solo jugadores con 20+ lanzamientos.</small>':''}</div>
  <div class="sec"><div class="sec-h"><span class="cap">Por torneo</span></div><div class="card">
    ${Object.values(byT).sort((a,b)=>b.f.localeCompare(a.f)).map(t=>`<button class="match" style="width:100%;text-align:left" onclick="ST.torneo='${esc(t.t)}';ST.sub='partidos';ST.game=null;rerenderStats();scrollTo({top:0})"><div class="res ${t.w>=t.l?'w':'l'}">${t.w>=t.l?'V':'D'}</div><div class="nm"><b>${esc(t.t)}</b><small>${t.w+t.l} partidos${isHist?.(t.t)?' · historial':''}</small></div><div class="sc">${t.w}–${t.l}</div></button>`).join('')}</div></div>`;
}

function tPartidos(){
  const g=games();if(!g.length)return `<div class="f">${torneoSel()}</div><div class="card empty">Sin partidos.</div>`;
  if(!ST.game||!g.find(x=>x.game_id===ST.game))ST.game=g[g.length-1].game_id;
  const m=gameById(ST.game),pts=ST.puntos.filter(p=>p.game_id===ST.game).sort((a,b)=>num(a.punto_num)-num(b.punto_num));
  const xp=ST.xp.filter(x=>x.game_id===ST.game);
  const O=pts.filter(p=>p.line_type==='O'),D=pts.filter(p=>p.line_type==='D');
  const hO=O.filter(p=>p.goleador).length,bD=D.filter(p=>p.goleador).length;
  const to=xp.reduce((s,x)=>s+num(x.throwaways)+num(x.drops),0);
  const dur=pts.reduce((s,p)=>s+num(p.duracion_seg),0);
  const win=m.resultado==='W';
  const players=Object.values(xp.reduce((a,x)=>{(a[x.jugador]=a[x.jugador]||{n:x.jugador,rows:[]}).rows.push(x);return a;},{})).map(p=>({n:p.n,...sum(p.rows)})).sort((a,b)=>b.pm-a.pm);
  const ours=pts.map((p,i)=>num(p.score_nuestros)>(i?num(pts[i-1].score_nuestros):0));
  const noLines=!O.length&&!D.length;
  const show=ST.allPts?pts:pts.slice(0,8);
  return `<div class="f">${torneoSel()}<label class="sel"><select onchange="ST.game=this.value;ST.allPts=false;rerenderStats()">${[...g].reverse().map(x=>`<option value="${x.game_id}" ${x.game_id===ST.game?'selected':''}>${fDate(x.fecha)} · vs ${esc(x.rival)} (${x.nuestros}-${x.suyos})</option>`).join('')}</select></label></div>
  <div class="card score ${win?'':'lost'}"><div class="t"><div><div class="cap" style="color:${win?'var(--ok)':'var(--due)'}">${win?'Victoria':'Derrota'}</div><div class="n">${m.nuestros} – ${m.suyos}</div></div><div class="vs"><b>vs ${esc(m.rival)}</b><small>${esc(m.torneo)} · ${fDate(m.fecha)}</small></div></div></div>
  ${noLines?`<div class="card empty" style="margin-top:10px">Este partido no tiene registradas las líneas O/D, así que no hay Hold ni Break.</div>`:`<div class="kp"><div><small>Hold</small><b>${hO}/${O.length}</b></div><div><small>Break</small><b>${bD}/${D.length}</b></div><div><small>Turnovers</small><b>${to}</b></div></div>
  <div class="card hb">
    <div class="l"><span>🔴 O-Line Hold%</span><b>${pct(hO,O.length)}%</b></div><div class="bar"><i data-w="${pct(hO,O.length)}"></i></div>
    <div class="l"><span>🔵 D-Line Break%</span><b>${pct(bD,D.length)}%</b></div><div class="bar"><i class="blue" data-w="${pct(bD,D.length)}"></i></div>
    ${dur?`<div class="l mini-s"><span>Duración ${Math.floor(dur/60)}:${String(dur%60).padStart(2,'0')} · ~${Math.round(dur/pts.length)} s por punto</span></div>`:''}</div>`}
  ${pts.length>1?`<div class="sec"><div class="sec-h"><span class="cap">Marcador punto a punto</span></div>
    <div class="card chart">${lineChart([{v:pts.map(p=>num(p.score_nuestros)),c:'#e5383e'},{v:pts.map(p=>num(p.score_suyos)),c:'#7d7d85'}],{fill:true,grid:[0,5,10,15],labels:pts.map(p=>p.punto_num)})}
    <div class="leg"><span><i style="background:#e5383e"></i>Euforia</span><span><i style="background:#7d7d85"></i>${esc(m.rival)}</span></div></div></div>`:''}
  <div class="sec"><div class="sec-h"><span class="cap">Puntos</span></div><div class="card">
    ${show.map((p,i)=>{const us=ours[i];return `<div class="pt"><span class="k">${p.punto_num}</span><span class="ty ${p.line_type==='D'?'d':'o'}">${p.line_type||'·'}</span><div class="who"><b>${us?'Gol '+esc(short(p.goleador)):'Punto de '+esc(m.rival)}</b><small>${[us&&p.asistente?'Asist. '+esc(short(p.asistente)):'',p.line_type==='O'?(us?'Hold':'Perdido'):p.line_type==='D'?(us?'Break':'Concedido'):'',num(p.duracion_seg)?p.duracion_seg+' s':''].filter(Boolean).join(' · ')}</small></div><span class="sc">${p.score_nuestros}–${p.score_suyos}</span></div>`;}).join('')}
    ${pts.length>8?`<button class="more" onclick="ST.allPts=!ST.allPts;rerenderStats()">${ST.allPts?'Ver menos':'Ver los '+pts.length+' puntos'}</button>`:''}</div></div>
  <div class="sec"><div class="sec-h"><span class="cap">Jugadores del partido</span></div><div class="card">
    ${players.map((p,i)=>`<div class="rank"><div class="pos ${i<3?'gd':''}">${i+1}</div><div class="nm"><b>${esc(short(p.n))}</b><small class="mini-s">${p.puntos_jugados} pts · ${p.goles}G ${p.asistencias}A ${p.defensas}D${p.lanzamientos?' · '+Math.round(p.comp)+'% comp':''}</small></div><div class="v ${p.pm>0?'g':p.pm<0?'r':''}">${fmt('pm',p.pm)}</div></div>`).join('')}</div></div>`;
}

function tJugador(){
  if(!ST.player||!ST.players.includes(ST.player))ST.player=myStatsName()||ST.players[0];
  return `<div class="f">${playerSel(ST.player,"ST.player=this.value;rerenderStats()")}${torneoSel()}</div>${profileHTML(ST.player,ST.player===myStatsName())}`;
}

function tComparar(){
  const t=table(),me=myStatsName();
  if(!ST.cmpA||!ST.players.includes(ST.cmpA))ST.cmpA=me||ST.players[0];
  if(!ST.cmpB||!ST.players.includes(ST.cmpB))ST.cmpB=(ranked('goles').find(p=>p.n!==ST.cmpA)||{n:ST.players[1]}).n;
  const A=t.find(p=>p.n===ST.cmpA),B=t.find(p=>p.n===ST.cmpB);
  const head=`<div class="f">${torneoSel()}</div>
    <div class="vs2"><div class="p"><div class="avatar">${esc(ini(ST.cmpA))}</div>${playerSel(ST.cmpA,"ST.cmpA=this.value;rerenderStats()",'')}</div><div class="x">VS</div>
    <div class="p"><div class="avatar blue">${esc(ini(ST.cmpB))}</div>${playerSel(ST.cmpB,"ST.cmpB=this.value;rerenderStats()",'')}</div></div>`;
  if(!A||!B)return head+'<div class="card empty">Uno de los dos no tiene partidos en este filtro.</div>';
  const rows=[['Goles','goles'],['Asistencias','asistencias'],['Defensas','defensas'],['+/−','pm'],['Comp %','comp'],['Hold %','hold'],['Break %','brk'],['Puntos jugados','puntos_jugados']];
  const mx=k=>Math.max(1,...t.map(p=>p[k]));
  return head+`<div class="card h2h">${rows.map(([l,k])=>{const a=A[k],b=B[k],sa=Math.max(a,0),sb=Math.max(b,0);return `<div class="r"><div class="lab"><em class="${a>=b?'w':''}">${fmt(k==='comp'||k==='hold'||k==='brk'?'comp':k==='pm'?'pm':'x',a)}</em><span>${l}</span><em class="${b>a?'w':''}">${fmt(k==='comp'||k==='hold'||k==='brk'?'comp':k==='pm'?'pm':'x',b)}</em></div>
    <div class="dual"><i style="flex:${sa||0.001};background:${a>=b?'var(--red2)':'rgba(229,56,62,.3)'}"></i><i style="flex:${sb||0.001};background:${b>a?'#5b8cff':'rgba(91,140,255,.3)'}"></i></div></div>`;}).join('')}</div>
  <div class="sec"><div class="sec-h"><span class="cap">Perfil frente al equipo</span></div><div class="card chart" style="display:grid;place-items:center">
    ${radar([{v:['goles','asistencias','defensas','pm','comp'].map(k=>Math.max(0,A[k])/mx(k)),c:'#e5383e'},{v:['goles','asistencias','defensas','pm','comp'].map(k=>Math.max(0,B[k])/mx(k)),c:'#5b8cff'}],['Goles','Asist.',"D's",'+/−','Comp%'])}
    <div class="leg"><span><i style="background:#e5383e"></i>${esc(short(ST.cmpA))}</span><span><i style="background:#5b8cff"></i>${esc(short(ST.cmpB))}</span></div></div></div>`;
}

// Líneas: combinaciones de 4+ jugadores que jugaron juntos (misma lógica del tablero anterior)
function linesData(){
  const lm={};
  ptsRows().forEach(p=>{if(!p.linea)return;const j=p.linea.split(',').map(x=>x.trim()).filter(Boolean).sort();if(j.length<4)return;
    const k=p.line_type+'|'+j.join('|');const l=lm[k]=lm[k]||{players:j,type:p.line_type,pts:0,conv:0,games:new Set()};
    l.pts++;l.games.add(p.game_id);if(p.goleador)l.conv++;});
  return Object.values(lm);
}
function lineCard(l,hl){
  const p=Math.round(l.conv/l.pts*100);
  return `<div class="card line"><div class="t"><span class="cap">${l.type==='D'?'🔵 Break%':'🔴 Hold%'}</span><b class="${(l.type==='D'?p>=40:p>=70)?'g':(l.type==='D'?p<20:p<50)?'r':'y'}">${p}%</b></div>
    <div class="ppl">${l.players.map(n=>`<span class="${n===hl?'me':''}">${esc(short(n))}</span>`).join('')}</div>
    <div class="bar"><i class="${l.type==='D'?'blue':''}" data-w="${p}"></i></div><small class="mini-s">${l.pts} puntos juntos · ${l.conv} convertidos · ${l.games.size} partidos</small></div>`;
}
function tLineas(){
  const P=ptsRows(),O=P.filter(p=>p.line_type==='O'),D=P.filter(p=>p.line_type==='D');
  const hO=O.filter(p=>p.goleador).length,bD=D.filter(p=>p.goleador).length,me=myStatsName();
  const L=linesData().filter(l=>l.type===ST.lineType&&l.pts>=ST.minPts)
    .sort((a,b)=>ST.lineType==='O'?b.pts-a.pts:(b.conv/b.pts)-(a.conv/a.pts)||b.pts-a.pts);
  return `<div class="f">${torneoSel()}<label class="sel">Mín.<select onchange="ST.minPts=+this.value;rerenderStats()">${[2,3,5,10].map(v=>`<option value="${v}" ${ST.minPts===v?'selected':''}>${v}+ pts</option>`).join('')}</select></label></div>
  <div class="od">
    <div class="card"><div class="cap">Hold% global</div><div class="v">${Math.round(pct(hO,O.length))}%</div><div class="bar"><i data-w="${pct(hO,O.length)}"></i></div><small class="mini-s">${hO}/${O.length} puntos O</small></div>
    <div class="card"><div class="cap">Break% global</div><div class="v">${Math.round(pct(bD,D.length))}%</div><div class="bar"><i class="blue" data-w="${pct(bD,D.length)}"></i></div><small class="mini-s">${bD}/${D.length} puntos D</small></div></div>
  <div class="chips" style="margin-top:16px">${[['O','🔴 Ofensivas'],['D','🔵 Defensivas']].map(([k,l])=>`<button class="chip ${ST.lineType===k?'on':''}" onclick="ST.lineType='${k}';rerenderStats()">${l}</button>`).join('')}</div>
  <p class="mini-s" style="margin:10px 2px 0">${ST.lineType==='O'?'Ordenadas por puntos jugados juntos.':'Ordenadas por % de break.'}</p>
  ${L.length?L.slice(0,10).map(l=>lineCard(l,me)).join(''):'<div class="card empty" style="margin-top:10px">Sin combinaciones con ese filtro.</div>'}`;
}

function tEvolucion(){
  const by={};ST.partidos.forEach(g=>{const t=g.torneo||'—';(by[t]=by[t]||{t,f:g.fecha,g:[]}).g.push(g);if(g.fecha<by[t].f)by[t].f=g.fecha;});
  const S=Object.values(by).map(i=>{const ids=new Set(i.g.map(g=>g.game_id));const P=ST.puntos.filter(p=>ids.has(p.game_id)),X=ST.xp.filter(x=>ids.has(x.game_id));
    const O=P.filter(p=>p.line_type==='O'),D=P.filter(p=>p.line_type==='D');const w=i.g.filter(g=>g.resultado==='W').length;
    const gf=i.g.reduce((s,g)=>s+num(g.nuestros),0),gc=i.g.reduce((s,g)=>s+num(g.suyos),0);
    return{t:i.t,f:i.f,n:i.g.length,w,hold:pct(O.filter(p=>p.goleador).length,O.length),brk:pct(D.filter(p=>p.goleador).length,D.length),
      diff:(gf-gc)/i.g.length,to:O.length?X.reduce((s,x)=>s+num(x.throwaways)+num(x.drops),0)/O.length:0};}).sort((a,b)=>a.f.localeCompare(b.f));
  if(S.length<2)return '<div class="card empty">Se necesitan al menos 2 torneos.</div>';
  const a=S[0],z=S[S.length-1];
  const tc=(l,va,vz,u,inv)=>{const d=vz-va,good=inv?d<0:d>0,flat=Math.abs(d)<.05;
    return `<div class="card"><div class="cap">${l}</div><div class="v ${flat?'':good?'up':'dn'}">${flat?'—':d>0?'▲':'▼'} ${Math.abs(d).toFixed(1)}</div><small>${va.toFixed(1)}${u} → ${vz.toFixed(1)}${u}${flat?'':good?' · mejoró':''}</small></div>`;};
  const ab=t=>t.split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,4);
  return `<p class="mini-s" style="margin:10px 2px 0">Compara todos los torneos en orden (no usa el filtro de torneo). De ${esc(a.t)} a ${esc(z.t)}:</p>
  <div class="tr">${tc('Hold%',a.hold,z.hold,'%')}${tc('Break%',a.brk,z.brk,'%')}${tc('Diferencial / partido',a.diff,z.diff,'')}${tc('Turnovers / pto O',a.to,z.to,'',true)}</div>
  <div class="sec"><div class="sec-h"><span class="cap">Hold% vs Break% por torneo</span></div>
    <div class="card chart">${lineChart([{v:S.map(s=>s.hold),c:'#e5383e'},{v:S.map(s=>s.brk),c:'#5b8cff'}],{min:0,max:100,grid:[0,50,100],unit:'%',labels:S.map(s=>ab(s.t))})}
    <div class="leg"><span><i style="background:#e5383e"></i>Hold%</span><span><i style="background:#5b8cff"></i>Break%</span></div></div></div>
  <div class="sec"><div class="sec-h"><span class="cap">Resumen por torneo</span></div><div class="card">
    <div class="trow h"><b>Torneo</b><span>Récord</span><span>Hold</span><span>Break</span></div>
    ${S.map(s=>`<div class="trow"><b>${esc(s.t)}</b><span>${s.w}–${s.n-s.w}</span><span class="${s.hold>=75?'g':s.hold<60?'r':''}">${Math.round(s.hold)}%</span><span class="${s.brk>=45?'g':s.brk<30?'r':''}">${Math.round(s.brk)}%</span></div>`).join('')}</div></div>`;
}
