import { useState, useMemo, useRef, useEffect } from "react";

const POSITIONS = ["GK","CB","LB","RB","CDM","CM","CAM","LW","RW","ST"];

const ATTRS = {
  기술:[{k:"dribbling",l:"드리블"},{k:"passing",l:"패스"},{k:"finishing",l:"결정력"},{k:"technique",l:"테크닉"},{k:"crossing",l:"크로스"},{k:"longShots",l:"중거리슛"},{k:"heading",l:"헤딩"},{k:"firstTouch",l:"볼트래핑"}],
  신체:[{k:"pace",l:"속도"},{k:"acceleration",l:"가속"},{k:"strength",l:"피지컬"},{k:"stamina",l:"체력"},{k:"jumping",l:"점프"},{k:"agility",l:"민첩성"},{k:"balance",l:"균형감"}],
  정신:[{k:"vision",l:"비전"},{k:"decisions",l:"판단력"},{k:"composure",l:"침착함"},{k:"leadership",l:"리더십"},{k:"workRate",l:"활동량"},{k:"teamwork",l:"팀워크"},{k:"aggression",l:"투지"}],
};

const ALL_ATTR_KEYS = Object.values(ATTRS).flat().map(a => a.k);

const RADAR = [
  {label:"기술", keys:["dribbling","passing","technique","firstTouch"]},
  {label:"신체", keys:["pace","acceleration","strength","stamina"]},
  {label:"정신", keys:["vision","decisions","composure","leadership"]},
  {label:"공격", keys:["finishing","longShots","crossing","heading"]},
  {label:"수비", keys:["strength","jumping","decisions","aggression"]},
  {label:"창의", keys:["vision","passing","technique","firstTouch"]},
];

const FORMATIONS = {
  "4-3-3":[{p:"GK",x:50,y:87},{p:"RB",x:82,y:70},{p:"CB",x:62,y:73},{p:"CB",x:38,y:73},{p:"LB",x:18,y:70},{p:"CM",x:72,y:50},{p:"CDM",x:50,y:55},{p:"CM",x:28,y:50},{p:"RW",x:80,y:27},{p:"ST",x:50,y:20},{p:"LW",x:20,y:27}],
  "4-4-2":[{p:"GK",x:50,y:87},{p:"RB",x:82,y:70},{p:"CB",x:62,y:73},{p:"CB",x:38,y:73},{p:"LB",x:18,y:70},{p:"RW",x:80,y:50},{p:"CM",x:60,y:52},{p:"CM",x:40,y:52},{p:"LW",x:20,y:50},{p:"ST",x:63,y:22},{p:"ST",x:37,y:22}],
  "4-2-3-1":[{p:"GK",x:50,y:87},{p:"RB",x:82,y:70},{p:"CB",x:62,y:73},{p:"CB",x:38,y:73},{p:"LB",x:18,y:70},{p:"CDM",x:63,y:57},{p:"CDM",x:37,y:57},{p:"RW",x:80,y:40},{p:"CAM",x:50,y:38},{p:"LW",x:20,y:40},{p:"ST",x:50,y:18}],
  "3-5-2":[{p:"GK",x:50,y:87},{p:"CB",x:70,y:72},{p:"CB",x:50,y:74},{p:"CB",x:30,y:72},{p:"RB",x:88,y:52},{p:"CM",x:68,y:50},{p:"CDM",x:50,y:55},{p:"CM",x:32,y:50},{p:"LB",x:12,y:52},{p:"ST",x:63,y:20},{p:"ST",x:37,y:20}],
  "3-4-3":[{p:"GK",x:50,y:87},{p:"CB",x:70,y:72},{p:"CB",x:50,y:74},{p:"CB",x:30,y:72},{p:"RB",x:85,y:52},{p:"CM",x:62,y:50},{p:"CM",x:38,y:50},{p:"LB",x:15,y:52},{p:"RW",x:78,y:24},{p:"ST",x:50,y:18},{p:"LW",x:22,y:24}],
};

function rng(a,b){return Math.floor(Math.random()*(b-a+1))+a;}

function mkAttrs(bias){
  const a = {};
  ALL_ATTR_KEYS.forEach(k => { a[k] = rng(54,70); });
  if(bias) Object.entries(bias).forEach(([k,v]) => { a[k]=v; });
  return a;
}

function ovr(attrs){
  const v = Object.values(attrs);
  return v.length ? Math.round(v.reduce((s,x)=>s+x,0)/v.length) : 0;
}

function radarVal(axis, attrs){
  return Math.round(axis.keys.reduce((s,k)=>s+(attrs[k]||0),0)/axis.keys.length);
}

function getColor(v){
  if(v>=85) return "#00e676";
  if(v>=75) return "#69f0ae";
  if(v>=65) return "#ffeb3b";
  if(v>=55) return "#ff9800";
  return "#ef5350";
}

const TODAY = new Date().toISOString().split("T")[0];

function mkHistory(attrs){
  const h = [];
  for(let i=3;i>=1;i--){
    const y=2024-i, s={};
    Object.keys(attrs).forEach(k => { s[k]=Math.max(1,Math.min(99,attrs[k]-rng(2,9)+(3-i)*rng(1,3))); });
    h.push({date:`${y}-07-01`,label:`${y}/${y+1}`,attrs:s});
  }
  h.push({date:TODAY,label:"현재",attrs:{...attrs}});
  return h;
}

function mkPlayer(id,name,pos,age,club,val,tid,bias){
  const attrs = mkAttrs(bias);
  return {id,name,pos,age,club,val,tid,photo:null,attrs,history:mkHistory(attrs)};
}

const INIT_TEAMS = [
  {id:"t1",name:"FC 서울스타",badge:"⭐",color:"#1e6ba8"},
  {id:"t2",name:"부산 유나이티드",badge:"🔥",color:"#c0392b"},
];

const INIT_PLAYERS = [
  mkPlayer(1,"손흥민","LW",32,"토트넘","€65M","t1",{pace:89,finishing:87,dribbling:86,vision:84}),
  mkPlayer(2,"이강인","CAM",23,"PSG","€45M","t1",{passing:85,technique:88,dribbling:84,vision:83}),
  mkPlayer(3,"김민재","CB",27,"바이에른","€70M","t2",{strength:90,jumping:88,decisions:85,heading:87}),
  mkPlayer(4,"황희찬","RW",28,"울버햄튼","€30M","t2",{pace:87,stamina:85,workRate:88,finishing:79}),
  mkPlayer(5,"조현우","GK",33,"울산","€8M","t1",{decisions:84,composure:83,jumping:79}),
  mkPlayer(6,"정우영","ST",28,"프라이부르크","€18M","t2",{finishing:80,strength:78,pace:82}),
];

// ---------- UI atoms ----------

const INPUT = {background:"#0d1b2a",border:"1px solid #1e3a5f",color:"#e0f0ff",borderRadius:4,padding:"5px 10px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,width:"100%",outline:"none"};

function Avatar({photo,name,size,color,ovrVal}){
  const c = color || getColor(ovrVal||60);
  const sz = size||48;
  return (
    <div style={{width:sz,height:sz,borderRadius:"50%",flexShrink:0,border:`2px solid ${c}`,overflow:"hidden",background:`${c}18`,display:"flex",alignItems:"center",justifyContent:"center"}}>
      {photo
        ? <img src={photo} alt={name} style={{width:"100%",height:"100%",objectFit:"cover"}} />
        : <span style={{fontSize:sz*0.34,fontWeight:900,color:c,fontFamily:"'Oswald',sans-serif"}}>{ovrVal||"?"}</span>
      }
    </div>
  );
}

function Bar({label,value,editing,onChange}){
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
      <span style={{width:74,fontSize:11,color:"#8899aa",fontFamily:"'Barlow Condensed',sans-serif",flexShrink:0}}>{label}</span>
      {editing
        ? <input type="number" min={1} max={99} value={value} onChange={e=>onChange(Math.max(1,Math.min(99,parseInt(e.target.value)||1)))} style={{...INPUT,width:48,padding:"2px 6px",fontWeight:700}} />
        : <>
            <div style={{flex:1,height:5,background:"#0d1b2a",borderRadius:3,overflow:"hidden"}}>
              <div style={{width:`${value}%`,height:"100%",background:getColor(value),borderRadius:3}} />
            </div>
            <span style={{width:24,textAlign:"right",fontSize:12,fontWeight:700,color:getColor(value),fontFamily:"'Barlow Condensed',sans-serif"}}>{value}</span>
          </>
      }
    </div>
  );
}

function Radar({attrs,prev}){
  const size=200, cx=100, cy=100, r=68;
  const ang = i => (Math.PI*2*i/6) - Math.PI/2;
  const pt = (i,v) => ({x:cx+r*(v/99)*Math.cos(ang(i)), y:cy+r*(v/99)*Math.sin(ang(i))});
  const path = vs => vs.map((v,i)=>{const p=pt(i,v); return `${i===0?"M":"L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`;}).join(" ")+"Z";
  const vals = RADAR.map(ax=>radarVal(ax,attrs));
  const pvals = prev ? RADAR.map(ax=>radarVal(ax,prev)) : null;
  return (
    <svg width={size} height={size} style={{overflow:"visible"}}>
      {[25,50,75,99].map(lvl => (
        <polygon key={lvl} fill="none" stroke="#1e3a5f" strokeWidth={0.7} opacity={0.5}
          points={RADAR.map((_,i)=>{const p=pt(i,lvl); return `${p.x},${p.y}`;}).join(" ")} />
      ))}
      {RADAR.map((_,i)=>{const p=pt(i,99); return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#1e3a5f" strokeWidth={0.7} opacity={0.4} />;  })}
      {pvals && <path d={path(pvals)} fill="rgba(255,152,0,0.1)" stroke="#ff9800" strokeWidth={1.2} strokeDasharray="4 3" />}
      <path d={path(vals)} fill="rgba(30,107,168,0.18)" stroke="#4499dd" strokeWidth={2} />
      {vals.map((v,i)=>{const p=pt(i,v); return <circle key={i} cx={p.x} cy={p.y} r={3.5} fill={getColor(v)} stroke="#030c14" strokeWidth={1} />;  })}
      {RADAR.map((ax,i)=>{const p=pt(i,99); const lx=cx+(p.x-cx)*1.24, ly=cy+(p.y-cy)*1.24;
        return <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#7799bb" fontFamily="'Barlow Condensed',sans-serif" fontWeight={700}>{ax.label}</text>;
      })}
    </svg>
  );
}

function GrowthLine({history}){
  if(!history||history.length<2) return <p style={{color:"#335577",fontSize:12}}>스냅샷 2개 이상 필요</p>;
  const W=360,H=100,pl=32,pr=10,pt2=14,pb=26;
  const iW=W-pl-pr, iH=H-pt2-pb;
  const ovrs = history.map(h=>ovr(h.attrs));
  const mn=Math.max(0,Math.min(...ovrs)-5), mx=Math.min(99,Math.max(...ovrs)+5);
  const xf = i => pl + i*(iW/(history.length-1));
  const yf = v => pt2 + iH - ((v-mn)/(mx-mn))*iH;
  const d = history.map((h,i)=>`${i===0?"M":"L"}${xf(i).toFixed(1)},${yf(ovr(h.attrs)).toFixed(1)}`).join(" ");
  const area = d+` L${xf(history.length-1).toFixed(1)},${(pt2+iH).toFixed(1)} L${pl},${(pt2+iH).toFixed(1)} Z`;
  return (
    <svg width={W} height={H} style={{width:"100%",maxWidth:W}}>
      {[0,0.5,1].map(t=>{const y=pt2+iH*t; return <line key={t} x1={pl} y1={y} x2={pl+iW} y2={y} stroke="#1e3a5f" strokeWidth={0.6} strokeDasharray="4 3" />;  })}
      <path d={area} fill="rgba(30,107,168,0.1)" />
      <path d={d} fill="none" stroke="#4499dd" strokeWidth={2} strokeLinejoin="round" />
      {history.map((h,i)=>{const v=ovr(h.attrs),x=xf(i),y=yf(v); return (
        <g key={i}>
          <circle cx={x} cy={y} r={4} fill={getColor(v)} stroke="#030c14" strokeWidth={1.5} />
          <text x={x} y={y-9} textAnchor="middle" fontSize={9} fill={getColor(v)} fontFamily="'Barlow Condensed',sans-serif" fontWeight={700}>{v}</text>
          <text x={x} y={pt2+iH+14} textAnchor="middle" fontSize={8} fill="#335577" fontFamily="'Barlow Condensed',sans-serif">{h.label}</text>
        </g>
      );  })}
    </svg>
  );
}

function Pitch({formation,lineup,players,onSlot,selSlot}){
  const slots = FORMATIONS[formation]||[];
  return (
    <div style={{position:"relative",width:"100%",maxWidth:360,aspectRatio:"0.63",background:"#0a2010",borderRadius:10,overflow:"hidden",border:"2px solid #1a4020",margin:"0 auto"}}>
      <svg style={{position:"absolute",inset:0,width:"100%",height:"100%"}} viewBox="0 0 100 158" preserveAspectRatio="none">
        {[0,1,2,3,4,5,6].map(i=><rect key={i} x={0} y={i*23} width={100} height={11.5} fill={i%2===0?"#0a2010":"#0c2412"} />)}
        <rect x={3} y={3} width={94} height={152} fill="none" stroke="#1e5a30" strokeWidth={0.8} />
        <line x1={3} y1={79} x2={97} y2={79} stroke="#1e5a30" strokeWidth={0.6} />
        <circle cx={50} cy={79} r={12} fill="none" stroke="#1e5a30" strokeWidth={0.6} />
        <rect x={22} y={3} width={56} height={20} fill="none" stroke="#1e5a30" strokeWidth={0.6} />
        <rect x={22} y={135} width={56} height={20} fill="none" stroke="#1e5a30" strokeWidth={0.6} />
      </svg>
      {slots.map((slot,i)=>{
        const pid=lineup[i], pl=players.find(x=>x.id===pid)||null;
        const v=pl?ovr(pl.attrs):null, isSel=selSlot===i;
        const c=v?getColor(v):"#2a4a6a";
        return (
          <div key={i} onClick={()=>onSlot(i)}
            style={{position:"absolute",left:`${slot.x}%`,top:`${slot.y}%`,transform:"translate(-50%,-50%)",display:"flex",flexDirection:"column",alignItems:"center",cursor:"pointer",zIndex:2}}>
            <div style={{width:40,height:40,borderRadius:"50%",border:`2.5px solid ${isSel?"#fff":c}`,boxShadow:isSel?`0 0 0 2px rgba(255,255,255,0.3),0 0 12px ${c}`:`0 0 6px ${c}55`,overflow:"hidden",background:pl?`${c}22`:"rgba(13,35,64,0.8)",display:"flex",alignItems:"center",justifyContent:"center"}}>
              {pl?.photo
                ? <img src={pl.photo} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={pl.name} />
                : <span style={{fontSize:10,fontWeight:900,color:pl?c:"#3a6a9a",fontFamily:"'Barlow Condensed',sans-serif"}}>{pl?String(v):slot.p}</span>
              }
            </div>
            <div style={{marginTop:2,background:"rgba(3,12,20,0.85)",borderRadius:3,padding:"1px 5px",fontSize:9,fontWeight:700,color:pl?"#e0f0ff":"#4477aa",fontFamily:"'Barlow Condensed',sans-serif",whiteSpace:"nowrap",maxWidth:56,overflow:"hidden",textOverflow:"ellipsis",textAlign:"center"}}>
              {pl?pl.name:slot.p}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- MAIN ----------

export default function App(){
  const [nav, setNav] = useState("선수");
 const [teams, setTeams] = useState(()=>{ try{ const s=localStorage.getItem("ezra-teams"); return s?JSON.parse(s):INIT_TEAMS; }catch(e){return INIT_TEAMS;} });
  const [players, setPlayers] = useState(()=>{ try{ const s=localStorage.getItem("ezra-players"); return s?JSON.parse(s):INIT_PLAYERS; }catch(e){return INIT_PLAYERS;} });
  const [sel, setSel] = useState(()=>{ try{ const s=localStorage.getItem("ezra-players"); return s?JSON.parse(s)[0]:INIT_PLAYERS[0]; }catch(e){return INIT_PLAYERS[0];} });
  const [dtab, setDtab] = useState("개요");
  const [aCat, setACat] = useState("기술");
  const [editing, setEditing] = useState(false);
  const [editD, setEditD] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newP, setNewP] = useState(null);
  const [fTeam, setFTeam] = useState("all");
  const [search, setSearch] = useState("");
  const [newTeam, setNewTeam] = useState({name:"",badge:"🏆",color:"#1e6ba8"});
  const [addTeam, setAddTeam] = useState(false);
  const [snapModal, setSnapModal] = useState(false);
  const [snapLabel, setSnapLabel] = useState("");
  const [formation, setFormation] = useState("4-3-3");
  const [lineup, setLineup] = useState(Array(11).fill(null));
  const [selSlot, setSelSlot] = useState(null);
  const [formFilter, setFormFilter] = useState("all");

  const photoRef = useRef();
  const editPhotoRef = useRef();

  // 데이터 저장/불러오기
  useEffect(() => {
    const sp = localStorage.getItem("ezra-players");
    const st = localStorage.getItem("ezra-teams");
    if(sp){ const p=JSON.parse(sp); setPlayers(p); setSel(p[0]||null); }
    if(st){ setTeams(JSON.parse(st)); }
  }, []);

  useEffect(() => {
    localStorage.setItem("ezra-players", JSON.stringify(players));
  }, [players]);

  useEffect(() => {
    localStorage.setItem("ezra-teams", JSON.stringify(teams));
  }, [teams]);

  const teamMap = useMemo(()=>Object.fromEntries(teams.map(t=>[t.id,t])),[teams]);
  const display = editing ? editD : sel;
  const ovrVal = display ? ovr(display.attrs) : 0;
  const prevSnap = sel?.history?.length>=2 ? sel.history[sel.history.length-2] : null;
  const selTeam = display?.tid ? teamMap[display.tid] : null;

  const filtered = useMemo(()=>players.filter(p=>{
    const tm = fTeam==="all" || p.tid===fTeam || (fTeam==="none"&&!p.tid);
    const sm = p.name.includes(search)||p.pos.includes(search)||p.club.includes(search);
    return tm&&sm;
  }),[players,fTeam,search]);

  const slots = FORMATIONS[formation]||[];
  const formPlayers = formFilter==="all" ? players : players.filter(p=>p.tid===formFilter||(formFilter==="none"&&!p.tid));

  function loadPhoto(file,target){
    if(!file) return;
    const fr = new FileReader();
    fr.onload = e => {
      if(target==="edit") setEditD(d=>({...d,photo:e.target.result}));
      else setNewP(p=>({...p,photo:e.target.result}));
    };
    fr.readAsDataURL(file);
  }

  function saveEdit(){ setPlayers(ps=>ps.map(p=>p.id===editD.id?editD:p)); setSel(editD); setEditing(false); }
  function startEdit(){ setEditD(JSON.parse(JSON.stringify(sel))); setEditing(true); }
  function cancelEdit(){ setEditing(false); setEditD(null); }
  function delPlayer(){ const r=players.filter(p=>p.id!==sel.id); setPlayers(r); setSel(r[0]||null); }

  function startAdd(){
    setNewP({id:Date.now(),name:"",pos:"ST",age:20,club:"",val:"€10M",tid:teams[0]?.id||"",photo:null,attrs:Object.fromEntries(ALL_ATTR_KEYS.map(k=>[k,65])),history:[]});
    setAdding(true);
  }
  function saveNew(){
    if(!newP.name.trim()) return;
    const p={...newP,history:[{date:TODAY,label:"등록",attrs:{...newP.attrs}}]};
    setPlayers(ps=>[...ps,p]); setSel(p); setAdding(false); setNewP(null);
  }
  function recordSnap(){
    if(!sel) return;
    const snap={date:TODAY,label:snapLabel||"스냅샷",attrs:{...sel.attrs}};
    const up={...sel,history:[...sel.history,snap]};
    setPlayers(ps=>ps.map(p=>p.id===sel.id?up:p)); setSel(up);
    setSnapModal(false); setSnapLabel("");
  }

  function saveTeamFn(){
    if(!newTeam.name.trim()) return;
    setTeams(ts=>[...ts,{id:"t"+Date.now(),...newTeam}]);
    setAddTeam(false); setNewTeam({name:"",badge:"🏆",color:"#1e6ba8"});
  }
  function delTeam(tid){ setTeams(ts=>ts.filter(t=>t.id!==tid)); setPlayers(ps=>ps.map(p=>p.tid===tid?{...p,tid:""}:p)); }
  function assignTeam(pid,tid){ setPlayers(ps=>ps.map(p=>p.id===pid?{...p,tid}:p)); if(sel?.id===pid) setSel(s=>({...s,tid})); }

  function handleSlot(i){ setSelSlot(prev=>prev===i?null:i); }
  function assignSlot(pid){
    if(selSlot===null) return;
    const nl=[...lineup];
    const old=nl.indexOf(pid); if(old!==-1) nl[old]=null;
    nl[selSlot]=pid; setLineup(nl); setSelSlot(null);
  }
  function clearLineup(){ setLineup(Array(11).fill(null)); setSelSlot(null); }

  const NAV=["선수","팀 관리","베스트 11"];
  const DTABS=["개요","능력치","성장 추적"];

  const cardStyle = {background:"#071525",border:"1px solid #0d2340",borderRadius:8,padding:"12px 15px"};

  return (
    <div style={{minHeight:"100vh",background:"#030c14",fontFamily:"'Barlow Condensed',sans-serif",color:"#e0f0ff",display:"flex",flexDirection:"column"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;700;900&family=Oswald:wght@400;700&display=swap');*{box-sizing:border-box}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#1e3a5f;border-radius:2px}select option{background:#0d1b2a}`}</style>

      {/* HEADER */}
      <div style={{background:"linear-gradient(90deg,#071525,#0a1e35)",borderBottom:"2px solid #1e3a5f",padding:"9px 18px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <div style={{background:"linear-gradient(135deg,#1e6ba8,#0d3a5f)",borderRadius:6,padding:"3px 12px",fontFamily:"'Oswald',sans-serif",fontWeight:700,fontSize:17,color:"#fff",letterSpacing:2}}>⚽</div>
        <div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,letterSpacing:2}}>EZRA FOOTBALL MANAGER</div>
          <div style={{fontSize:10,color:"#e0f0ff",fontWeight:700,letterSpacing:0.5}}>에스라 풋볼 매니저 · 선수 능력치 관리</div>
        </div>
        <div style={{display:"flex",gap:3,marginLeft:16}}>
          {NAV.map(n=>(
            <button key={n} onClick={()=>setNav(n)} style={{background:nav===n?"#1e6ba8":"transparent",border:nav===n?"1px solid #2a8ad4":"1px solid #1e3a5f",color:nav===n?"#fff":"#5577aa",borderRadius:5,padding:"5px 13px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer"}}>
              {n==="베스트 11"?"🏆 "+n:n}
            </button>
          ))}
        </div>
        <span style={{marginLeft:"auto",fontSize:10,color:"#335577"}}>선수 {players.length}명 · 팀 {teams.length}개</span>
      </div>

      {/* ===== PLAYER VIEW ===== */}
      {nav==="선수" && (
        <div style={{display:"flex",flex:1,height:"calc(100vh - 56px)",overflow:"hidden"}}>
          {/* sidebar */}
          <div style={{width:232,background:"#050f1a",borderRight:"1px solid #0d2340",display:"flex",flexDirection:"column",flexShrink:0}}>
            <div style={{padding:"9px 10px",borderBottom:"1px solid #0d2340",display:"flex",flexDirection:"column",gap:5}}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="검색…" style={{...INPUT,fontSize:11,padding:"5px 9px"}} />
              <select value={fTeam} onChange={e=>setFTeam(e.target.value)} style={{...INPUT,fontSize:11,padding:"4px 8px"}}>
                <option value="all">전체 팀</option>
                {teams.map(t=><option key={t.id} value={t.id}>{t.badge} {t.name}</option>)}
                <option value="none">팀 없음</option>
              </select>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"7px 9px"}}>
              {filtered.map(p=>{
                const v=ovr(p.attrs), isSel=sel?.id===p.id;
                const tc=p.tid?teamMap[p.tid]?.color:"#1e6ba8";
                return (
                  <div key={p.id} onClick={()=>{setSel(p);setEditing(false);setEditD(null);setDtab("개요");}}
                    style={{background:isSel?"#0d2340":"#071525",border:isSel?`1px solid ${tc}`:"1px solid #0d2340",borderLeft:isSel?`3px solid ${tc}`:"3px solid transparent",borderRadius:6,padding:"9px 11px",cursor:"pointer",display:"flex",alignItems:"center",gap:10,marginBottom:5,transition:"all 0.15s"}}>
                    <Avatar photo={p.photo} name={p.name} size={36} ovrVal={v} color={getColor(v)} />
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:13,color:"#e0f0ff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name}</div>
                      <div style={{fontSize:10,color:"#5577aa"}}>{p.club}</div>
                    </div>
                    <div style={{background:"#0d2340",borderRadius:3,padding:"2px 6px",fontSize:11,fontWeight:700,color:"#4499dd",fontFamily:"'Barlow Condensed',sans-serif",flexShrink:0}}>{p.pos}</div>
                  </div>
                );
              })}
              {filtered.length===0 && <p style={{color:"#335577",fontSize:12,textAlign:"center",marginTop:20}}>검색 결과 없음</p>}
            </div>
            <div style={{padding:"9px 10px",borderTop:"1px solid #0d2340"}}>
              <button onClick={startAdd} style={{width:"100%",background:"linear-gradient(135deg,#1e6ba8,#0d4a7a)",border:"none",color:"#fff",borderRadius:5,padding:"8px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer"}}>+ 선수 추가</button>
            </div>
          </div>

          {/* main */}
          <div style={{flex:1,overflowY:"auto",padding:"15px 20px"}}>

            {/* ADD FORM */}
            {adding && newP && (
              <div>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:18,fontWeight:700,marginBottom:14,color:"#4499dd",letterSpacing:2}}>새 선수 등록</div>
                <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:14}}>
                  <div style={{position:"relative",cursor:"pointer"}} onClick={()=>photoRef.current?.click()}>
                    <Avatar photo={newP.photo} name={newP.name||"?"} size={68} ovrVal={65} color="#4499dd" />
                    <div style={{position:"absolute",bottom:0,right:0,background:"#1e6ba8",borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,border:"1px solid #2a8ad4",cursor:"pointer"}}>📷</div>
                  </div>
                  <div style={{fontSize:11,color:"#4477aa"}}>클릭해서 사진 업로드<br/><span style={{fontSize:10,color:"#335577"}}>JPG / PNG</span></div>
                  <input ref={photoRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>loadPhoto(e.target.files[0],"new")} />
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:9,marginBottom:14}}>
                  {[{l:"이름",k:"name",t:"text"},{l:"나이",k:"age",t:"number"},{l:"구단",k:"club",t:"text"},{l:"몸값",k:"val",t:"text"}].map(({l,k,t})=>(
                    <div key={k}>
                      <div style={{fontSize:10,color:"#4477aa",marginBottom:3}}>{l}</div>
                      <input type={t} value={newP[k]} onChange={e=>setNewP(p=>({...p,[k]:e.target.value}))} style={INPUT} />
                    </div>
                  ))}
                  <div>
                    <div style={{fontSize:10,color:"#4477aa",marginBottom:3}}>포지션</div>
                    <select value={newP.pos} onChange={e=>setNewP(p=>({...p,pos:e.target.value}))} style={INPUT}>
                      {POSITIONS.map(pos=><option key={pos}>{pos}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{fontSize:10,color:"#4477aa",marginBottom:3}}>팀</div>
                    <select value={newP.tid} onChange={e=>setNewP(p=>({...p,tid:e.target.value}))} style={INPUT}>
                      <option value="">팀 없음</option>
                      {teams.map(t=><option key={t.id} value={t.id}>{t.badge} {t.name}</option>)}
                    </select>
                  </div>
                </div>
                {Object.entries(ATTRS).map(([cat,atrs])=>(
                  <div key={cat} style={{marginBottom:12}}>
                    <div style={{fontSize:10,color:"#4499dd",fontWeight:700,letterSpacing:2,marginBottom:5,borderBottom:"1px solid #0d2340",paddingBottom:3}}>{cat.toUpperCase()}</div>
                    {atrs.map(({k,l})=>(
                      <Bar key={k} label={l} value={newP.attrs[k]} editing={true} onChange={v=>setNewP(p=>({...p,attrs:{...p.attrs,[k]:v}}))} />
                    ))}
                  </div>
                ))}
                <div style={{display:"flex",gap:8,marginTop:10}}>
                  <button onClick={saveNew} style={{background:"#1e6ba8",border:"none",color:"#fff",borderRadius:5,padding:"8px 20px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer"}}>저장</button>
                  <button onClick={()=>{setAdding(false);setNewP(null);}} style={{background:"#1a2a3a",border:"1px solid #1e3a5f",color:"#8899aa",borderRadius:5,padding:"8px 14px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,cursor:"pointer"}}>취소</button>
                </div>
              </div>
            )}

            {/* PLAYER DETAIL */}
            {!adding && display && (
              <div>
                {/* header */}
                <div style={{...cardStyle,border:`1px solid ${selTeam?.color||"#1e3a5f"}`,marginBottom:12,display:"flex",alignItems:"center",gap:14}}>
                  <div style={{position:"relative",flexShrink:0}}>
                    <Avatar photo={display.photo} name={display.name} size={62} ovrVal={ovrVal} color={getColor(ovrVal)} />
                    {editing && (
                      <>
                        <div onClick={()=>editPhotoRef.current?.click()} style={{position:"absolute",bottom:0,right:0,background:"#1e6ba8",borderRadius:"50%",width:20,height:20,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,cursor:"pointer",border:"1px solid #2a8ad4"}}>📷</div>
                        <input ref={editPhotoRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>loadPhoto(e.target.files[0],"edit")} />
                      </>
                    )}
                    {!editing && (
                      <div style={{position:"absolute",bottom:-2,right:-2,background:"#0d2340",borderRadius:3,padding:"1px 5px",fontSize:10,fontWeight:900,color:getColor(ovrVal),fontFamily:"'Oswald',sans-serif",border:`1px solid ${getColor(ovrVal)}44`}}>{ovrVal}</div>
                    )}
                  </div>
                  <div style={{flex:1}}>
                    {editing
                      ? <input value={editD.name} onChange={e=>setEditD(d=>({...d,name:e.target.value}))} style={{...INPUT,fontSize:18,fontWeight:700,fontFamily:"'Oswald',sans-serif",marginBottom:5}} />
                      : <div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,fontWeight:700,letterSpacing:1,marginBottom:5}}>{display.name}</div>
                    }
                    <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                      <div style={{background:"#0d1b2a",borderRadius:4,padding:"3px 8px"}}>
                        <span style={{fontSize:9,color:"#335577"}}>포지션 </span>
                        {editing
                          ? <select value={editD.pos} onChange={e=>setEditD(d=>({...d,pos:e.target.value}))} style={{background:"transparent",border:"none",color:"#4499dd",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700}}>
                              {POSITIONS.map(o=><option key={o}>{o}</option>)}
                            </select>
                          : <span style={{fontSize:12,fontWeight:700,color:"#4499dd"}}>{display.pos}</span>
                        }
                      </div>
                      {["age","club","val"].map(k=>(
                        <div key={k} style={{background:"#0d1b2a",borderRadius:4,padding:"3px 8px"}}>
                          <span style={{fontSize:9,color:"#335577"}}>{k==="age"?"나이":k==="club"?"구단":"몸값"} </span>
                          {editing
                            ? <input type={k==="age"?"number":"text"} value={editD[k]} onChange={e=>setEditD(d=>({...d,[k]:e.target.value}))} style={{background:"transparent",border:"none",color:"#4499dd",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,width:70,outline:"none"}} />
                            : <span style={{fontSize:12,fontWeight:700,color:"#4499dd"}}>{display[k]}</span>
                          }
                        </div>
                      ))}
                      {selTeam && <div style={{background:selTeam.color+"22",borderRadius:4,padding:"3px 9px",border:`1px solid ${selTeam.color}55`}}><span style={{fontSize:12,fontWeight:700,color:selTeam.color}}>{selTeam.badge} {selTeam.name}</span></div>}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:5,flexShrink:0,flexDirection:"column"}}>
                    {editing ? (
                      <>
                        <button onClick={saveEdit} style={{background:"#1e6ba8",border:"none",color:"#fff",borderRadius:5,padding:"7px 13px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer"}}>저장</button>
                        <button onClick={cancelEdit} style={{background:"#1a2a3a",border:"1px solid #1e3a5f",color:"#8899aa",borderRadius:5,padding:"7px 10px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,cursor:"pointer"}}>취소</button>
                      </>
                    ) : (
                      <>
                        <button onClick={startEdit} style={{background:"#1e3a5f",border:"1px solid #2a5580",color:"#88bbdd",borderRadius:5,padding:"7px 12px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer"}}>✏ 편집</button>
                        <button onClick={delPlayer} style={{background:"#2a1010",border:"1px solid #5a1a1a",color:"#cc4444",borderRadius:5,padding:"7px 10px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,cursor:"pointer"}}>삭제</button>
                      </>
                    )}
                  </div>
                </div>

                {/* tabs */}
                <div style={{display:"flex",gap:3,marginBottom:12}}>
                  {DTABS.map(t=>(
                    <button key={t} onClick={()=>setDtab(t)} style={{background:dtab===t?"#1e6ba8":"#071525",border:dtab===t?"1px solid #2a8ad4":"1px solid #0d2340",color:dtab===t?"#fff":"#5577aa",borderRadius:5,padding:"5px 13px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer"}}>{t}</button>
                  ))}
                </div>

                {dtab==="개요" && (
                  <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                    <div style={{...cardStyle,display:"flex",flexDirection:"column",alignItems:"center",flex:"0 0 224px"}}>
                      <div style={{fontSize:10,color:"#4499dd",fontWeight:700,letterSpacing:2,marginBottom:6}}>레이더 차트</div>
                      <Radar attrs={display.attrs} prev={prevSnap?.attrs} />
                      {prevSnap && <div style={{fontSize:9,color:"#ff9800",marginTop:3}}>── 이전 스냅샷 비교</div>}
                    </div>
                    <div style={{flex:1,minWidth:160,display:"flex",flexDirection:"column",gap:8}}>
                      {Object.entries(ATTRS).map(([cat,atrs])=>{
                        const avg=Math.round(atrs.reduce((s,{k})=>s+(display.attrs[k]||0),0)/atrs.length);
                        const top=[...atrs].sort((a,b)=>(display.attrs[b.k]||0)-(display.attrs[a.k]||0)).slice(0,3);
                        return (
                          <div key={cat} style={cardStyle}>
                            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                              <div style={{fontSize:20,fontWeight:900,color:getColor(avg),fontFamily:"'Oswald',sans-serif",width:30}}>{avg}</div>
                              <div style={{flex:1}}>
                                <div style={{fontSize:11,fontWeight:700,color:"#8899aa",letterSpacing:1}}>{cat} 평균</div>
                                <div style={{fontSize:9,color:"#335577"}}>TOP: {top.map(a=>`${a.l} ${display.attrs[a.k]}`).join(" · ")}</div>
                              </div>
                            </div>
                            <div style={{height:4,background:"#0d1b2a",borderRadius:3,overflow:"hidden"}}>
                              <div style={{width:`${avg}%`,height:"100%",background:getColor(avg),borderRadius:3}} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {dtab==="능력치" && (
                  <div>
                    <div style={{display:"flex",gap:3,marginBottom:10}}>
                      {Object.keys(ATTRS).map(cat=>(
                        <button key={cat} onClick={()=>setACat(cat)} style={{background:aCat===cat?"#1e3a5f":"transparent",border:aCat===cat?"1px solid #2a5580":"1px solid #0d2340",color:aCat===cat?"#88bbdd":"#4477aa",borderRadius:5,padding:"4px 13px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer"}}>{cat}</button>
                      ))}
                    </div>
                    <div style={cardStyle}>
                      <div style={{fontSize:10,color:"#4499dd",fontWeight:700,letterSpacing:2,marginBottom:9}}>{aCat.toUpperCase()}</div>
                      {ATTRS[aCat].map(({k,l})=>(
                        <Bar key={k} label={l} value={editing?editD.attrs[k]:display.attrs[k]} editing={editing} onChange={v=>setEditD(d=>({...d,attrs:{...d.attrs,[k]:v}}))} />
                      ))}
                    </div>
                  </div>
                )}

                {dtab==="성장 추적" && (
                  <div>
                    <div style={{display:"flex",alignItems:"center",marginBottom:11}}>
                      <span style={{fontSize:11,color:"#4477aa",fontWeight:700,letterSpacing:1}}>OVR 성장 추이</span>
                      <button onClick={()=>setSnapModal(true)} style={{marginLeft:"auto",background:"#1e3a5f",border:"1px solid #2a5580",color:"#88bbdd",borderRadius:5,padding:"5px 13px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,fontWeight:700,cursor:"pointer"}}>📸 스냅샷 기록</button>
                    </div>
                    <div style={{...cardStyle,marginBottom:12}}>
                      <GrowthLine history={sel?.history||[]} />
                    </div>
                    <div style={cardStyle}>
                      <div style={{fontSize:10,color:"#4499dd",fontWeight:700,letterSpacing:2,marginBottom:9}}>스냅샷 이력</div>
                      {(sel?.history||[]).length===0 && <p style={{color:"#335577",fontSize:12}}>스냅샷이 없습니다</p>}
                      {[...(sel?.history||[])].reverse().map((h,i,arr)=>{
                        const v2=ovr(h.attrs), p2=arr[i+1], diff=p2?v2-ovr(p2.attrs):0;
                        return (
                          <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:"1px solid #0d2340"}}>
                            <span style={{fontSize:17,fontWeight:900,color:getColor(v2),fontFamily:"'Oswald',sans-serif",width:32}}>{v2}</span>
                            <div style={{flex:1}}>
                              <div style={{fontSize:12,fontWeight:700,color:"#e0f0ff"}}>{h.label}</div>
                              <div style={{fontSize:10,color:"#335577"}}>{h.date}</div>
                            </div>
                            {diff!==0 && <span style={{fontSize:12,fontWeight:700,color:diff>0?"#00e676":"#ef5350"}}>{diff>0?"+":""}{diff}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {!adding && !display && <p style={{color:"#335577",textAlign:"center",marginTop:80,fontSize:15}}>선수를 선택하세요</p>}
          </div>
        </div>
      )}

      {/* ===== TEAM VIEW ===== */}
      {nav==="팀 관리" && (
        <div style={{flex:1,overflowY:"auto",padding:"16px 24px"}}>
          <div style={{display:"flex",alignItems:"center",marginBottom:16}}>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:19,fontWeight:700,letterSpacing:2}}>팀 관리</span>
            <button onClick={()=>setAddTeam(true)} style={{marginLeft:"auto",background:"linear-gradient(135deg,#1e6ba8,#0d4a7a)",border:"none",color:"#fff",borderRadius:5,padding:"7px 16px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer"}}>+ 팀 추가</button>
          </div>
          {addTeam && (
            <div style={{...cardStyle,border:"1px solid #1e3a5f",marginBottom:16}}>
              <div style={{fontSize:11,color:"#4499dd",fontWeight:700,letterSpacing:1,marginBottom:9}}>새 팀 만들기</div>
              <div style={{display:"flex",gap:9,alignItems:"flex-end",flexWrap:"wrap"}}>
                <div style={{flex:2,minWidth:110}}><div style={{fontSize:10,color:"#4477aa",marginBottom:3}}>팀 이름</div><input value={newTeam.name} onChange={e=>setNewTeam(t=>({...t,name:e.target.value}))} style={INPUT} /></div>
                <div style={{flex:1,minWidth:70}}><div style={{fontSize:10,color:"#4477aa",marginBottom:3}}>배지</div><input value={newTeam.badge} onChange={e=>setNewTeam(t=>({...t,badge:e.target.value}))} style={INPUT} /></div>
                <div style={{flex:1,minWidth:70}}><div style={{fontSize:10,color:"#4477aa",marginBottom:3}}>컬러</div><input type="color" value={newTeam.color} onChange={e=>setNewTeam(t=>({...t,color:e.target.value}))} style={{...INPUT,padding:2,height:33}} /></div>
                <button onClick={saveTeamFn} style={{background:"#1e6ba8",border:"none",color:"#fff",borderRadius:5,padding:"8px 16px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer"}}>저장</button>
                <button onClick={()=>setAddTeam(false)} style={{background:"#1a2a3a",border:"1px solid #1e3a5f",color:"#8899aa",borderRadius:5,padding:"8px 11px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,cursor:"pointer"}}>취소</button>
              </div>
            </div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {teams.map(team=>{
              const roster=players.filter(p=>p.tid===team.id);
              const avgO=roster.length?Math.round(roster.reduce((s,p)=>s+ovr(p.attrs),0)/roster.length):0;
              return (
                <div key={team.id} style={{background:"#071525",border:`1px solid ${team.color}44`,borderLeft:`4px solid ${team.color}`,borderRadius:8,padding:"14px 18px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                    <span style={{fontSize:26}}>{team.badge}</span>
                    <div>
                      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:17,fontWeight:700}}>{team.name}</div>
                      <div style={{fontSize:11,color:"#335577"}}>선수 {roster.length}명{roster.length>0?` · 평균 OVR `:""}{roster.length>0&&<span style={{color:getColor(avgO),fontWeight:700}}>{avgO}</span>}</div>
                    </div>
                    <button onClick={()=>delTeam(team.id)} style={{marginLeft:"auto",background:"#2a1010",border:"1px solid #5a1a1a",color:"#cc4444",borderRadius:5,padding:"5px 11px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,cursor:"pointer"}}>팀 삭제</button>
                  </div>
                  {roster.length===0 && <p style={{color:"#335577",fontSize:12,marginBottom:10}}>소속 선수 없음</p>}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:7}}>
                    {roster.map(p=>{
                      const v=ovr(p.attrs);
                      return (
                        <div key={p.id} style={{display:"flex",alignItems:"center",gap:8,background:"#0a1a2e",borderRadius:5,padding:"7px 10px"}}>
                          <Avatar photo={p.photo} name={p.name} size={30} ovrVal={v} color={getColor(v)} />
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:12,fontWeight:700,color:"#e0f0ff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name}</div>
                            <div style={{fontSize:10,color:"#4477aa"}}>{p.pos} · {p.club}</div>
                          </div>
                          <button onClick={()=>assignTeam(p.id,"")} style={{background:"transparent",border:"none",color:"#335577",cursor:"pointer",fontSize:11}}>✕</button>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{marginTop:10}}>
                    <select onChange={e=>{if(e.target.value){assignTeam(parseInt(e.target.value),team.id);e.target.value="";}}} style={{...INPUT,maxWidth:210,fontSize:11,color:"#4477aa"}}>
                      <option value="">+ 선수 영입하기</option>
                      {players.filter(p=>p.tid!==team.id).map(p=><option key={p.id} value={p.id}>{p.name} ({p.pos}) OVR {ovr(p.attrs)}</option>)}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== BEST 11 VIEW ===== */}
      {nav==="베스트 11" && (
        <div style={{display:"flex",flex:1,height:"calc(100vh - 56px)",overflow:"hidden"}}>
          {/* pitch */}
          <div style={{flex:"0 0 420px",padding:"14px 14px 14px 18px",display:"flex",flexDirection:"column",gap:10,overflowY:"auto"}}>
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <span style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,letterSpacing:2}}>🏆 베스트 11</span>
              <select value={formation} onChange={e=>{setFormation(e.target.value);clearLineup();}} style={{...INPUT,width:"auto",fontSize:12,padding:"5px 10px",flex:1,minWidth:90}}>
                {Object.keys(FORMATIONS).map(f=><option key={f}>{f}</option>)}
              </select>
              <button onClick={clearLineup} style={{background:"transparent",border:"1px solid #1e3a5f",color:"#5577aa",borderRadius:5,padding:"5px 12px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,cursor:"pointer"}}>초기화</button>
            </div>
            {selSlot!==null && (
              <div style={{background:"#0d2a1a",border:"1px solid #1e5a30",borderRadius:6,padding:"7px 12px",fontSize:12,color:"#69f0ae",fontWeight:700}}>
                📌 슬롯 {selSlot+1} ({slots[selSlot]?.p}) — 오른쪽에서 선수를 클릭하세요
              </div>
            )}
            <Pitch formation={formation} lineup={lineup} players={players} onSlot={handleSlot} selSlot={selSlot} />
            {/* lineup table */}
            <div style={{...cardStyle}}>
              <div style={{fontSize:10,color:"#4499dd",fontWeight:700,letterSpacing:2,marginBottom:8}}>라인업</div>
              {slots.map((slot,i)=>{
                const pid=lineup[i], p=players.find(x=>x.id===pid)||null, v=p?ovr(p.attrs):null;
                return (
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0",borderBottom:"1px solid #0d2340"}}>
                    <span style={{width:30,fontSize:10,fontWeight:700,color:"#4477aa",fontFamily:"'Barlow Condensed',sans-serif"}}>{slot.p}</span>
                    {p ? (
                      <>
                        <Avatar photo={p.photo} name={p.name} size={22} ovrVal={v} color={getColor(v)} />
                        <span style={{flex:1,fontSize:12,fontWeight:700,color:"#e0f0ff"}}>{p.name}</span>
                        <span style={{fontSize:11,fontWeight:700,color:getColor(v)}}>{v}</span>
                        <button onClick={()=>{const nl=[...lineup];nl[i]=null;setLineup(nl);}} style={{background:"transparent",border:"none",color:"#335577",cursor:"pointer",fontSize:10}}>✕</button>
                      </>
                    ) : (
                      <span style={{flex:1,fontSize:11,color:"#335577"}}>미배치</span>
                    )}
                  </div>
                );
              })}
              {lineup.filter(Boolean).length===11 && (
                <div style={{marginTop:9,background:"#0d2a1a",borderRadius:5,padding:"6px 10px",fontSize:11,color:"#69f0ae",fontWeight:700,textAlign:"center"}}>
                  ✅ 완성! 평균 OVR: {Math.round(lineup.filter(Boolean).map(pid=>ovr(players.find(p=>p.id===pid)?.attrs||{})).reduce((a,b)=>a+b,0)/11)}
                </div>
              )}
            </div>
          </div>

          {/* picker */}
          <div style={{flex:1,background:"#050f1a",borderLeft:"1px solid #0d2340",display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{padding:"10px 12px",borderBottom:"1px solid #0d2340",flexShrink:0}}>
              <div style={{fontSize:11,color:"#4499dd",fontWeight:700,letterSpacing:1,marginBottom:7}}>선수 선택 {selSlot!==null?`— ${slots[selSlot]?.p} 슬롯`:""}</div>
              <select value={formFilter} onChange={e=>setFormFilter(e.target.value)} style={{...INPUT,fontSize:11,padding:"4px 8px"}}>
                <option value="all">전체</option>
                {teams.map(t=><option key={t.id} value={t.id}>{t.badge} {t.name}</option>)}
                <option value="none">팀 없음</option>
              </select>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"7px 10px"}}>
              {[...formPlayers].sort((a,b)=>ovr(b.attrs)-ovr(a.attrs)).map(p=>{
                const v=ovr(p.attrs), inL=lineup.includes(p.id);
                return (
                  <div key={p.id} onClick={()=>selSlot!==null?assignSlot(p.id):null}
                    style={{display:"flex",alignItems:"center",gap:9,background:inL?"#0d2a1a":"#071525",border:inL?"1px solid #1e5a30":"1px solid #0d2340",borderRadius:6,padding:"8px 10px",marginBottom:5,cursor:selSlot!==null?"pointer":"default",opacity:inL&&selSlot===null?0.6:1,transition:"all 0.15s"}}>
                    <Avatar photo={p.photo} name={p.name} size={36} ovrVal={v} color={getColor(v)} />
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:700,color:"#e0f0ff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name}</div>
                      <div style={{fontSize:10,color:"#5577aa"}}>{p.club}</div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:2}}>
                      <div style={{background:"#0d2340",borderRadius:3,padding:"1px 6px",fontSize:11,fontWeight:700,color:"#4499dd",fontFamily:"'Barlow Condensed',sans-serif"}}>{p.pos}</div>
                      <div style={{fontSize:14,fontWeight:900,color:getColor(v),fontFamily:"'Oswald',sans-serif"}}>{v}</div>
                    </div>
                    {inL && <span style={{fontSize:9,color:"#69f0ae",fontWeight:700,flexShrink:0}}>✓</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* SNAPSHOT MODAL */}
      {snapModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999}}>
          <div style={{background:"#0a1a2e",border:"1px solid #1e3a5f",borderRadius:10,padding:"20px 24px",width:280}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,marginBottom:11,color:"#4499dd"}}>📸 스냅샷 기록</div>
            <div style={{fontSize:11,color:"#4477aa",marginBottom:5}}>스냅샷 이름</div>
            <input value={snapLabel} onChange={e=>setSnapLabel(e.target.value)} placeholder="예: 2025 시즌 종료" style={{...INPUT,marginBottom:13}} />
            <div style={{display:"flex",gap:8}}>
              <button onClick={recordSnap} style={{background:"#1e6ba8",border:"none",color:"#fff",borderRadius:5,padding:"7px 17px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer"}}>기록</button>
              <button onClick={()=>setSnapModal(false)} style={{background:"#1a2a3a",border:"1px solid #1e3a5f",color:"#8899aa",borderRadius:5,padding:"7px 11px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,cursor:"pointer"}}>취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
