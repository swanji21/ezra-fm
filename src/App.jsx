import { useState, useMemo, useRef, useEffect } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, googleProvider, db } from "./firebase";

const POSITIONS = ["GK","CB","LB","RB","CDM","CM","CAM","LW","RW","ST"];

const ATTRS = {
  기술:[{k:"dribbling",l:"드리블"},{k:"passing",l:"패스"},{k:"finishing",l:"결정력"},{k:"technique",l:"테크닉"},{k:"crossing",l:"크로스"},{k:"longShots",l:"중거리슛"},{k:"heading",l:"헤딩"},{k:"firstTouch",l:"볼트래핑"}],
  신체:[{k:"pace",l:"속도"},{k:"acceleration",l:"가속"},{k:"strength",l:"피지컬"},{k:"stamina",l:"체력"},{k:"jumping",l:"점프"},{k:"agility",l:"민첩성"},{k:"balance",l:"균형감"}],
  정신:[{k:"vision",l:"비전"},{k:"decisions",l:"판단력"},{k:"composure",l:"침착함"},{k:"leadership",l:"리더십"},{k:"workRate",l:"활동량"},{k:"teamwork",l:"팀워크"},{k:"aggression",l:"투지"}],
};

// ── 사용자 편집 가능한 능력치 스키마 (그룹 + 능력치) ──
// 위 ATTRS를 기본 스키마의 씨앗으로 사용한다. 각 능력치의 key는 불변(이름 바꿔도 유지) → 선수 데이터 안전.
const DEFAULT_GROUP_META = [["기술","g_tech"],["신체","g_phys"],["정신","g_ment"]];
const DEFAULT_GROUPS = DEFAULT_GROUP_META.map(([name,id]) => ({ id, name }));
const DEFAULT_ABILITIES = DEFAULT_GROUP_META.flatMap(([name,id]) =>
  ATTRS[name].map(a => ({ key:a.k, label:a.l, group:id, unit:"", direction:"high", min:0, max:100 }))
);
const DEFAULT_SCHEMA = { groups: DEFAULT_GROUPS, abilities: DEFAULT_ABILITIES };
const ALL_ATTR_KEYS = DEFAULT_ABILITIES.map(a => a.key);

// 능력치 추가/편집 시 고를 수 있는 단위 프리셋 ("" = 0~100 점수형)
const UNIT_PRESETS = ["", "회", "초", "분", "kg", "m", "cm", "점", "%", "골", "개"];

// 값(raw) → 0~100 정규화 점수. 방향(높을수록/낮을수록 좋음)과 기준범위(min~max)를 반영. 값 없으면 null.
function abScore(ab, raw){
  if(raw===null || raw===undefined || raw==="") return null;
  const n = Number(raw); if(Number.isNaN(n)) return null;
  const min = Number(ab?.min ?? 0), max = Number(ab?.max ?? 100), dir = ab?.direction || "high";
  if(max === min) return 50;
  let s = (n - min) / (max - min) * 100;
  if(dir === "low") s = 100 - s;
  return Math.max(0, Math.min(100, Math.round(s)));
}
// 종합 점수(OVR) = 값이 있는 모든 능력치의 정규화 점수 평균
function ovrFrom(attrs, abilities){
  if(!abilities || !abilities.length) return 0;
  const ss = abilities.map(ab => abScore(ab, attrs?.[ab.key])).filter(s => s!=null);
  return ss.length ? Math.round(ss.reduce((a,b)=>a+b,0)/ss.length) : 0;
}
// 그룹 평균 정규화 점수 (레이더/개요용)
function groupScore(groupId, attrs, abilities){
  const abs = abilities.filter(a => a.group === groupId);
  const ss = abs.map(ab => abScore(ab, attrs?.[ab.key])).filter(s => s!=null);
  return ss.length ? Math.round(ss.reduce((a,b)=>a+b,0)/ss.length) : 0;
}
// 표시용 값 문자열: "12회", "8.5초", "65"
function fmtVal(ab, raw){
  if(raw===null || raw===undefined || raw==="") return "-";
  return ab?.unit ? `${raw}${ab.unit}` : `${raw}`;
}
// 저장/불러온 스키마를 최신 형태로 보정(누락 필드 기본값 채움). 손상 시 기본 스키마로 폴백.
function normalizeSchema(s){
  if(!s || !Array.isArray(s.groups) || !Array.isArray(s.abilities) || !s.groups.length || !s.abilities.length) return DEFAULT_SCHEMA;
  const groups = s.groups.map(g => ({ id:String(g.id), name:String(g.name ?? "그룹") }));
  const gids = new Set(groups.map(g=>g.id));
  const seen = new Set();
  const abilities = s.abilities.filter(a=>a && a.key!=null && !seen.has(String(a.key)) && seen.add(String(a.key))).map(a => ({
    key: String(a.key),
    label: String(a.label ?? a.key),
    group: gids.has(a.group) ? a.group : groups[0].id,
    unit: typeof a.unit === "string" ? a.unit : "",
    direction: a.direction === "low" ? "low" : "high",
    min: Number.isFinite(Number(a.min)) ? Number(a.min) : 0,
    max: Number.isFinite(Number(a.max)) ? Number(a.max) : 100,
  }));
  return { groups, abilities };
}

// 레이더 6축(고정) — 기본 능력치 key로 정의. 능력치를 삭제/변경해도 살아있는 key만 평균내어 깨지지 않는다.
const RADAR = [
  {label:"기술", keys:["dribbling","passing","technique","firstTouch"]},
  {label:"신체", keys:["pace","acceleration","strength","stamina"]},
  {label:"정신", keys:["vision","decisions","composure","leadership"]},
  {label:"공격", keys:["finishing","longShots","crossing","heading"]},
  {label:"수비", keys:["strength","jumping","decisions","aggression"]},
  {label:"창의", keys:["vision","passing","technique","firstTouch"]},
];
// 축 값 = 축에 속한 (현재 스키마에 존재하는) 능력치들의 정규화 점수 평균. 단위·방향 반영, 없는 key는 건너뜀.
function radarAxisScore(axis, attrs, abilities){
  const map = {}; (abilities||[]).forEach(a => { map[a.key] = a; });
  const ss = axis.keys.map(k => { const ab = map[k]; return ab ? abScore(ab, attrs?.[k]) : null; }).filter(s => s!=null);
  return ss.length ? Math.round(ss.reduce((a,b)=>a+b,0)/ss.length) : 0;
}

const FORMATIONS = {
  // ── 11 vs 11 ──
  "11v11 · 4-3-3":[{p:"GK",x:50,y:87},{p:"RB",x:82,y:70},{p:"CB",x:62,y:73},{p:"CB",x:38,y:73},{p:"LB",x:18,y:70},{p:"CM",x:72,y:50},{p:"CDM",x:50,y:55},{p:"CM",x:28,y:50},{p:"RW",x:80,y:27},{p:"ST",x:50,y:20},{p:"LW",x:20,y:27}],
  "11v11 · 4-4-2":[{p:"GK",x:50,y:87},{p:"RB",x:82,y:70},{p:"CB",x:62,y:73},{p:"CB",x:38,y:73},{p:"LB",x:18,y:70},{p:"RW",x:80,y:50},{p:"CM",x:60,y:52},{p:"CM",x:40,y:52},{p:"LW",x:20,y:50},{p:"ST",x:63,y:22},{p:"ST",x:37,y:22}],
  "11v11 · 4-2-3-1":[{p:"GK",x:50,y:87},{p:"RB",x:82,y:70},{p:"CB",x:62,y:73},{p:"CB",x:38,y:73},{p:"LB",x:18,y:70},{p:"CDM",x:63,y:57},{p:"CDM",x:37,y:57},{p:"RW",x:80,y:40},{p:"CAM",x:50,y:38},{p:"LW",x:20,y:40},{p:"ST",x:50,y:18}],
  "11v11 · 3-5-2":[{p:"GK",x:50,y:87},{p:"CB",x:70,y:72},{p:"CB",x:50,y:74},{p:"CB",x:30,y:72},{p:"RB",x:88,y:52},{p:"CM",x:68,y:50},{p:"CDM",x:50,y:55},{p:"CM",x:32,y:50},{p:"LB",x:12,y:52},{p:"ST",x:63,y:20},{p:"ST",x:37,y:20}],
  "11v11 · 3-4-3":[{p:"GK",x:50,y:87},{p:"CB",x:70,y:72},{p:"CB",x:50,y:74},{p:"CB",x:30,y:72},{p:"RB",x:85,y:52},{p:"CM",x:62,y:50},{p:"CM",x:38,y:50},{p:"LB",x:15,y:52},{p:"RW",x:78,y:24},{p:"ST",x:50,y:18},{p:"LW",x:22,y:24}],
  // ── 8 vs 8 (총 8명 = GK + 7명) ──
  "8v8 · 3-3-1":[{p:"GK",x:50,y:87},{p:"CB",x:70,y:72},{p:"CB",x:50,y:75},{p:"CB",x:30,y:72},{p:"CM",x:70,y:50},{p:"CM",x:50,y:52},{p:"CM",x:30,y:50},{p:"ST",x:50,y:22}],
  "8v8 · 2-3-2":[{p:"GK",x:50,y:87},{p:"CB",x:62,y:72},{p:"CB",x:38,y:72},{p:"RM",x:78,y:52},{p:"CM",x:50,y:54},{p:"LM",x:22,y:52},{p:"ST",x:62,y:22},{p:"ST",x:38,y:22}],
  "8v8 · 3-2-2":[{p:"GK",x:50,y:87},{p:"CB",x:72,y:72},{p:"CB",x:50,y:74},{p:"CB",x:28,y:72},{p:"CM",x:62,y:50},{p:"CM",x:38,y:50},{p:"RW",x:70,y:24},{p:"LW",x:30,y:24}],
  "8v8 · 2-4-1":[{p:"GK",x:50,y:87},{p:"CB",x:62,y:72},{p:"CB",x:38,y:72},{p:"RM",x:80,y:50},{p:"CM",x:60,y:52},{p:"CM",x:40,y:52},{p:"LM",x:20,y:50},{p:"ST",x:50,y:22}],
  "8v8 · 3-1-3":[{p:"GK",x:50,y:87},{p:"CB",x:72,y:72},{p:"CB",x:50,y:74},{p:"CB",x:28,y:72},{p:"CDM",x:50,y:52},{p:"RW",x:76,y:24},{p:"ST",x:50,y:20},{p:"LW",x:24,y:24}],
};

// 포메이션별 장단점 메모
const FORMATION_NOTES = {
  "11v11 · 4-3-3": {강점:"측면 공격력 강함, 압박 수비 용이, 넓은 공격 폭",약점:"측면 수비 부담, 미드필더 체력 소모 큼",추천:"공격적 팀, 압박 수비 선호 팀"},
  "11v11 · 4-4-2": {강점:"수비 안정성, 균형잡힌 라인업, 클래식한 조직력",약점:"미드필더 수적 열세, 창의성 부족",추천:"수비 안정 우선 팀, 카운터 공격 팀"},
  "11v11 · 4-2-3-1": {강점:"중원 장악력, 수비 안정성, 유연한 공격 전환",약점:"단독 스트라이커 부담, 측면 공격력 제한",추천:"중원 조직력 우수 팀, 밸런스형 팀"},
  "11v11 · 3-5-2": {강점:"미드필드 수적 우세, 윙백 활용 넓은 공격",약점:"윙백 체력 부담, 3백 수비 조율 어려움",추천:"윙백 활용도 높은 팀, 중원 지배 원할 때"},
  "11v11 · 3-4-3": {강점:"강력한 공격력, 높은 라인 유지, 압박 강도 높음",약점:"수비 뒷공간 노출, 3백 실수 시 위험",추천:"공격 지향 팀, 볼 소유율 높은 팀"},
  "8v8 · 3-3-1": {강점:"수비 안정, 중원 균형, 유소년 표준 포메이션",약점:"공격 옵션 제한, 골 결정력 낮을 수 있음",추천:"기본기 훈련용, 밸런스 학습"},
  "8v8 · 2-3-2": {강점:"공격력 강화, 2톱으로 다양한 조합 가능",약점:"수비 부담 큼, 뒷공간 노출 위험",추천:"공격적 팀, 골 결정력 좋은 팀"},
  "8v8 · 3-2-2": {강점:"측면 활용도 높음, 수비 안정",약점:"중원 수적 열세, 세컨볼 획득 어려움",추천:"측면 빠른 선수 보유 팀"},
  "8v8 · 2-4-1": {강점:"미드필드 지배, 볼 점유 유리",약점:"단독 공격 부담, 수비 뒷공간 위험",추천:"패스 능력 좋은 팀, 볼 소유 지향"},
  "8v8 · 3-1-3": {강점:"공격 라인 두터움, 압박 강도 높음",약점:"미드필드 얇음, 역습 취약",추천:"강한 압박 축구 지향 팀"},
};

// 포메이션 라인 연결용 포지션 그룹 (골키퍼는 제외 / 수비 / 미드필더 / 공격수)
const POSITION_GROUPS = [
  {key:"def", positions:["CB","LB","RB"], color:"#4499dd"},
  {key:"mid", positions:["CDM","CM","CAM","LM","RM"], color:"#ffd54f"},
  {key:"att", positions:["LW","RW","ST"], color:"#ff7043"},
];

// 선수 목록 "포지션별 보기"용 그룹
const PLAYER_GROUPS = [
  {key:"GK", label:"GK", positions:["GK"]},
  {key:"DF", label:"DF", positions:["CB","LB","RB"]},
  {key:"MF", label:"MF", positions:["CDM","CM","CAM"]},
  {key:"FW", label:"FW", positions:["LW","RW","ST"]},
];

// 피치 위 드래그 좌표(x,y 0~100, y가 작을수록 공격 진영)로 전술 포지션을 자동 판정
function classifyPosition(x,y){
  if(y>=80) return "GK";
  if(y>=62){
    if(x<35) return "LB";
    if(x>65) return "RB";
    return "CB";
  }
  if(y>=34){
    if(x<35) return "LM";
    if(x>65) return "RM";
    if(y>=54) return "CDM";
    if(y<44) return "CAM";
    return "CM";
  }
  if(x<35) return "LW";
  if(x>65) return "RW";
  return "ST";
}

function rng(a,b){return Math.floor(Math.random()*(b-a+1))+a;}

function mkAttrs(bias){
  const a = {};
  ALL_ATTR_KEYS.forEach(k => { a[k] = rng(54,70); });
  if(bias) Object.entries(bias).forEach(([k,v]) => { a[k]=v; });
  return a;
}

function getColor(v){
  if(v>=85) return "#00e676";
  if(v>=75) return "#69f0ae";
  if(v>=65) return "#ffeb3b";
  if(v>=55) return "#ff9800";
  return "#ef5350";
}

// 피치 좌표계: x/y 0~100, 실제 필드 경계는 x 3~97, y 3~155 (Pitch의 필드 마킹과 일치)
// y가 작을수록 공격 진영(상단), y가 클수록 골키퍼/수비 진영(하단)
const PITCH_BOUNDS = {x0:3, x1:97, y0:3, y1:155};

// 18존: 세로 6구역 × 가로 3구역. row 0=최상단(공격)…row 5=최하단(골키퍼 인근)
function zoneNumber(row, col){
  const zoneStart = (5-row)*3 + 1;
  return zoneStart + col;
}

const CHANNEL_LABELS = ["좌측 윙","좌측 하프스페이스","중앙","우측 하프스페이스","우측 윙"];
function channelIndex(x){
  const {x0,x1} = PITCH_BOUNDS;
  const cw = (x1-x0)/5;
  return Math.max(0, Math.min(4, Math.floor((x-x0)/cw)));
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

function mkPlayer(id,name,pos,age,club,tid,meta,bias){
  const attrs = mkAttrs(bias);
  return {id,name,pos,age,club,tid,number:meta.number,heightCm:meta.heightCm,weightKg:meta.weightKg,size:meta.size,photo:null,attrs,history:mkHistory(attrs)};
}

const INIT_TEAMS = [
  {id:"t1",name:"FC 서울스타",badge:"⭐",color:"#1e6ba8"},
  {id:"t2",name:"부산 유나이티드",badge:"🔥",color:"#c0392b"},
];

const INIT_PLAYERS = [
  mkPlayer(1,"손흥민","LW",32,"토트넘","t1",{number:7,heightCm:183,weightKg:77,size:"L"},{pace:89,finishing:87,dribbling:86,vision:84}),
  mkPlayer(2,"이강인","CAM",23,"PSG","t1",{number:19,heightCm:173,weightKg:65,size:"M"},{passing:85,technique:88,dribbling:84,vision:83}),
  mkPlayer(3,"김민재","CB",27,"바이에른","t2",{number:3,heightCm:190,weightKg:88,size:"XL"},{strength:90,jumping:88,decisions:85,heading:87}),
  mkPlayer(4,"황희찬","RW",28,"울버햄튼","t2",{number:11,heightCm:177,weightKg:72,size:"M"},{pace:87,stamina:85,workRate:88,finishing:79}),
  mkPlayer(5,"조현우","GK",33,"울산","t1",{number:1,heightCm:189,weightKg:84,size:"XL"},{decisions:84,composure:83,jumping:79}),
  mkPlayer(6,"정우영","ST",28,"프라이부르크","t2",{number:9,heightCm:187,weightKg:80,size:"L"},{finishing:80,strength:78,pace:82}),
];

// ---------- UI atoms ----------

const INPUT = {background:"#0d1b2a",border:"1px solid #1e3a5f",color:"#e0f0ff",borderRadius:4,padding:"5px 10px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,width:"100%",outline:"none"};

function GoogleIcon(){
  return (
    <svg width="16" height="16" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.8 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.2 26.7 36 24 36c-5.3 0-9.7-3.4-11.3-8.1l-6.5 5C9.4 39.6 16.1 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.8l6.3 5.3C41.4 36.5 44 30.9 44 24c0-1.2-.1-2.4-.4-3.5z"/>
    </svg>
  );
}

function Avatar({photo,name,size,color,ovrVal,mode,number,pos}){
  const c = color || getColor(ovrVal||60);
  const sz = size||48;
  const numberMode = mode==="number";
  const positionMode = mode==="position";
  return (
    <div style={{width:sz,height:sz,borderRadius:"50%",flexShrink:0,border:`2px solid ${c}`,overflow:"hidden",background:`${c}18`,display:"flex",alignItems:"center",justifyContent:"center"}}>
      {numberMode
        ? <span style={{fontSize:sz*0.44,fontWeight:900,color:c,fontFamily:"'Oswald',sans-serif"}}>{(number!==undefined&&number!==null&&number!=="")?number:"-"}</span>
        : positionMode
        ? <span style={{fontSize:sz*0.28,fontWeight:900,color:c,fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:0.5}}>{pos||"-"}</span>
        : (photo
          ? <img src={photo} alt={name} style={{width:"100%",height:"100%",objectFit:"cover"}} />
          : <span style={{fontSize:sz*0.34,fontWeight:900,color:c,fontFamily:"'Oswald',sans-serif"}}>{ovrVal||"?"}</span>
        )
      }
    </div>
  );
}

function Bar({ab, value, editing, onChange}){
  const score = abScore(ab, value);                 // 0~100 정규화 점수 (값 없으면 null)
  const col = score!=null ? getColor(score) : "#33507a";
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
      <span style={{width:92,fontSize:11,color:"#8899aa",fontFamily:"'Barlow Condensed',sans-serif",flexShrink:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={ab.label}>
        {ab.label}{ab.unit ? <span style={{color:"#4a6a8a"}}> ({ab.unit})</span> : null}
      </span>
      {editing
        ? <>
            <input type="number" step={ab.unit ? "any" : "1"} value={value===null||value===undefined?"":value} placeholder="-"
              onChange={e=>onChange(e.target.value==="" ? "" : Number(e.target.value))}
              style={{...INPUT,width:64,padding:"2px 6px",fontWeight:700}} />
            {ab.direction==="low" && <span style={{fontSize:8,color:"#ff9800",flexShrink:0}} title="낮을수록 좋은 지표">↓좋음</span>}
          </>
        : <>
            <div style={{flex:1,height:5,background:"#0d1b2a",borderRadius:3,overflow:"hidden"}}>
              <div style={{width:`${score??0}%`,height:"100%",background:col,borderRadius:3}} />
            </div>
            <span style={{minWidth:44,textAlign:"right",fontSize:12,fontWeight:700,color:col,fontFamily:"'Barlow Condensed',sans-serif"}}>{fmtVal(ab, value)}</span>
          </>
      }
    </div>
  );
}

function Radar({attrs, prev, abilities}){
  const size=200, cx=100, cy=100, r=68;
  const ang = i => (Math.PI*2*i/6) - Math.PI/2;
  const pt = (i,v) => ({x:cx+r*(v/99)*Math.cos(ang(i)), y:cy+r*(v/99)*Math.sin(ang(i))});
  const path = vs => vs.map((v,i)=>{const p=pt(i,v); return `${i===0?"M":"L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`;}).join(" ")+"Z";
  const vals = RADAR.map(ax=>radarAxisScore(ax,attrs,abilities));
  const pvals = prev ? RADAR.map(ax=>radarAxisScore(ax,prev,abilities)) : null;
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

// 단일 능력치의 스냅샷별 값 변화를 단위에 맞게 그리는 미니 라인차트 (방향 반영: 개선=초록)
function AbilityGrowthLine({ab, history}){
  const pts = history.map(h => ({ label:h.label, raw: h.attrs?.[ab.key] }));
  const nums = pts.map(p => (p.raw===""||p.raw==null||Number.isNaN(Number(p.raw))) ? null : Number(p.raw));
  const valid = nums.filter(v => v!=null);
  if(valid.length < 2) return null;
  const W=320,H=64,pl=8,pr=44,pt2=10,pb=8, iW=W-pl-pr, iH=H-pt2-pb;
  let mn=Math.min(...valid), mx=Math.max(...valid); if(mn===mx){mn-=1;mx+=1;}
  const xf = i => pl + i*(iW/(nums.length-1));
  const yf = v => pt2 + iH - ((v-mn)/(mx-mn))*iH;
  const seg = [];
  nums.forEach((v,i)=>{ if(v!=null) seg.push(`${seg.length?"L":"M"}${xf(i).toFixed(1)},${yf(v).toFixed(1)}`); });
  const first = valid[0], last = valid[valid.length-1];
  const improved = ab.direction==="low" ? last<first : last>first;
  const same = last===first;
  const trendCol = same ? "#8899aa" : improved ? "#00e676" : "#ef5350";
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:"1px solid #0d2340"}}>
      <div style={{width:82,flexShrink:0}}>
        <div style={{fontSize:12,fontWeight:700,color:"#e0f0ff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={ab.label}>{ab.label}</div>
        <div style={{fontSize:9,color:"#4a6a8a"}}>{ab.direction==="low"?"낮을수록↑":"높을수록↑"}</div>
      </div>
      <svg width={W} height={H} style={{flex:1,maxWidth:W}}>
        <path d={seg.join(" ")} fill="none" stroke="#4499dd" strokeWidth={2} strokeLinejoin="round" />
        {nums.map((v,i)=> v==null ? null : <circle key={i} cx={xf(i)} cy={yf(v)} r={3} fill="#4499dd" stroke="#030c14" strokeWidth={1} />)}
        <text x={xf(nums.length-1)+6} y={yf(last)+3} fontSize={11} fontWeight={700} fill={trendCol} fontFamily="'Barlow Condensed',sans-serif">{fmtVal(ab,last)}</text>
      </svg>
    </div>
  );
}

function GrowthLine({history, abilities}){
  if(!history||history.length<2) return <p style={{color:"#335577",fontSize:12}}>스냅샷 2개 이상 필요</p>;
  const W=360,H=100,pl=32,pr=10,pt2=14,pb=26;
  const iW=W-pl-pr, iH=H-pt2-pb;
  const ov = h => ovrFrom(h.attrs, abilities);
  const ovrs = history.map(ov);
  const mn=Math.max(0,Math.min(...ovrs)-5), mx=Math.min(99,Math.max(...ovrs)+5);
  const xf = i => pl + i*(iW/(history.length-1));
  const yf = v => pt2 + iH - ((v-mn)/(mx-mn||1))*iH;
  const d = history.map((h,i)=>`${i===0?"M":"L"}${xf(i).toFixed(1)},${yf(ov(h)).toFixed(1)}`).join(" ");
  const area = d+` L${xf(history.length-1).toFixed(1)},${(pt2+iH).toFixed(1)} L${pl},${(pt2+iH).toFixed(1)} Z`;
  return (
    <svg width={W} height={H} style={{width:"100%",maxWidth:W}}>
      {[0,0.5,1].map(t=>{const y=pt2+iH*t; return <line key={t} x1={pl} y1={y} x2={pl+iW} y2={y} stroke="#1e3a5f" strokeWidth={0.6} strokeDasharray="4 3" />;  })}
      <path d={area} fill="rgba(30,107,168,0.1)" />
      <path d={d} fill="none" stroke="#4499dd" strokeWidth={2} strokeLinejoin="round" />
      {history.map((h,i)=>{const v=ov(h),x=xf(i),y=yf(v); return (
        <g key={i}>
          <circle cx={x} cy={y} r={4} fill={getColor(v)} stroke="#030c14" strokeWidth={1.5} />
          <text x={x} y={y-9} textAnchor="middle" fontSize={9} fill={getColor(v)} fontFamily="'Barlow Condensed',sans-serif" fontWeight={700}>{v}</text>
          <text x={x} y={pt2+iH+14} textAnchor="middle" fontSize={8} fill="#335577" fontFamily="'Barlow Condensed',sans-serif">{h.label}</text>
        </g>
      );  })}
    </svg>
  );
}

function Pitch({formation,lineup,players,onSlot,selSlot,slotPositions,onDragEnd,slotPosOverrides,showZones,showChannels,cardMode,abilities}){
  const slots = FORMATIONS[formation]||[];
  const pitchRef = useRef();
  const dragging = useRef(null);
  const {x0,x1,y0,y1} = PITCH_BOUNDS;

  function getPos(e, el){
    const rect = el.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = Math.max(5, Math.min(95, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.max(5, Math.min(95, ((clientY - rect.top) / rect.height) * 100));
    return {x, y};
  }

  function onMouseDown(e, i){
    e.preventDefault();
    dragging.current = i;
    const move = ev => {
      if(dragging.current===null) return;
      if(ev.cancelable) ev.preventDefault();
      const pos = getPos(ev, pitchRef.current);
      onDragEnd(dragging.current, pos);
    };
    const up = () => {
      dragging.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', move, {passive:false});
    window.addEventListener('touchend', up);
  }

  // 그룹별(수비/미드필더/공격수, 골키퍼 제외) 라인업 좌표 — x 순서로 이어서 포메이션 라인을 그린다.
  // 드래그로 위치가 바뀌면 자동 판정된 현재 포지션(slotPosOverrides)을 기준으로 소속 그룹도 함께 갱신된다.
  const groupLines = POSITION_GROUPS.map(g=>{
    const pts = slots
      .map((slot,i)=>{
        if(!lineup[i]) return null;
        const curPos = (slotPosOverrides&&slotPosOverrides[i]) || slot.p;
        if(!g.positions.includes(curPos)) return null;
        const pos = (slotPositions&&slotPositions[i]) || slot;
        return {x:pos.x, y:pos.y};
      })
      .filter(Boolean)
      .sort((a,b)=>a.x-b.x);
    return {...g, pts};
  });

  return (
    <div ref={pitchRef} style={{position:"relative",width:"100%",maxWidth:360,aspectRatio:"0.63",flexShrink:0,background:"#0a2010",borderRadius:10,overflow:"hidden",border:"2px solid #1a4020",margin:"0 auto",userSelect:"none",touchAction:"none"}}>
      <svg style={{position:"absolute",inset:0,width:"100%",height:"100%"}} viewBox="0 0 100 158" preserveAspectRatio="none">
        {[0,1,2,3,4,5,6].map(i=><rect key={i} x={0} y={i*23} width={100} height={11.5} fill={i%2===0?"#0a2010":"#0c2412"} />)}
        <rect x={3} y={3} width={94} height={152} fill="none" stroke="#1e5a30" strokeWidth={0.8} />
        <line x1={3} y1={79} x2={97} y2={79} stroke="#1e5a30" strokeWidth={0.6} />
        <circle cx={50} cy={79} r={12} fill="none" stroke="#1e5a30" strokeWidth={0.6} />
        <rect x={22} y={3} width={56} height={20} fill="none" stroke="#1e5a30" strokeWidth={0.6} />
        <rect x={22} y={135} width={56} height={20} fill="none" stroke="#1e5a30" strokeWidth={0.6} />
      </svg>
      {showZones && (
        <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",zIndex:1}} viewBox="0 0 100 158" preserveAspectRatio="none">
          {Array.from({length:6}).map((_,row)=>{
            const rh=(y1-y0)/6, cw=(x1-x0)/3, y=y0+row*rh;
            return Array.from({length:3}).map((_,col)=>{
              const x=x0+col*cw;
              return (
                <g key={`${row}-${col}`}>
                  <rect x={x} y={y} width={cw} height={rh} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth={0.5} strokeDasharray="2 2" />
                  <text x={x+cw/2} y={y+rh/2} textAnchor="middle" dominantBaseline="middle" fontSize={7} fill="rgba(255,255,255,0.6)" fontFamily="'Oswald',sans-serif" fontWeight={700}>{zoneNumber(row,col)}</text>
                </g>
              );
            });
          })}
        </svg>
      )}
      {showChannels && (() => {
        const cw=(x1-x0)/5;
        const counts=[0,0,0,0,0];
        slots.forEach((slot,i)=>{
          if(!lineup[i]) return;
          const pos=(slotPositions&&slotPositions[i])||slot;
          counts[channelIndex(pos.x)]++;
        });
        return (
          <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",zIndex:1}} viewBox="0 0 100 158" preserveAspectRatio="none">
            {CHANNEL_LABELS.map((label,i)=>{
              const x=x0+i*cw, cx=x+cw/2, cy=y0+(y1-y0)/2;
              return (
                <g key={i}>
                  <rect x={x} y={y0} width={cw} height={y1-y0} fill={i%2===0?"rgba(70,140,220,0.07)":"rgba(70,140,220,0.02)"} stroke="rgba(255,255,255,0.22)" strokeWidth={0.5} />
                  <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={5} fill="#cfe8ff" fontFamily="'Barlow Condensed',sans-serif" fontWeight={700} opacity={0.75} transform={`rotate(-90 ${cx} ${cy})`}>{label}</text>
                  <text x={cx} y={y0+14} textAnchor="middle" fontSize={9} fill="#69f0ae" fontFamily="'Oswald',sans-serif" fontWeight={900}>{counts[i]}명</text>
                </g>
              );
            })}
          </svg>
        );
      })()}
      <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",zIndex:1,pointerEvents:"none"}} viewBox="0 0 100 100" preserveAspectRatio="none">
        {groupLines.map(g=> g.pts.length<2 ? null : (
          <polyline key={g.key} points={g.pts.map(p=>`${p.x},${p.y}`).join(" ")} fill="none" stroke={g.color} strokeWidth={0.8} opacity={0.6} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
      {slots.map((slot,i)=>{
        const pid=lineup[i], pl=players.find(x=>x.id===pid)||null;
        const v=pl?ovrFrom(pl.attrs, abilities):null, isSel=selSlot===i;
        const c=v?getColor(v):"#2a4a6a";
        const pos = (slotPositions&&slotPositions[i]) || slot;
        const curPos = (slotPosOverrides&&slotPosOverrides[i]) || slot.p;
        const numberMode = cardMode==="number";
        const positionMode = cardMode==="position";
        return (
          <div key={i}
            onMouseDown={e=>onMouseDown(e,i)}
            onTouchStart={e=>onMouseDown(e,i)}
            onClick={()=>onSlot(i)}
            style={{position:"absolute",left:`${pos.x}%`,top:`${pos.y}%`,transform:"translate(-50%,-50%)",display:"flex",flexDirection:"column",alignItems:"center",cursor:"grab",zIndex:2,touchAction:"none"}}>
            <div style={{width:40,height:40,borderRadius:"50%",border:`2.5px solid ${isSel?"#fff":c}`,boxShadow:isSel?`0 0 0 2px rgba(255,255,255,0.3),0 0 12px ${c}`:`0 0 6px ${c}55`,overflow:"hidden",background:pl?`${c}22`:"rgba(13,35,64,0.8)",display:"flex",alignItems:"center",justifyContent:"center"}}>
              {pl && numberMode
                ? <span style={{fontSize:14,fontWeight:900,color:c,fontFamily:"'Oswald',sans-serif"}}>{(pl.number!==undefined&&pl.number!==null&&pl.number!=="")?pl.number:"-"}</span>
                : pl && positionMode
                ? <span style={{fontSize:11,fontWeight:900,color:c,fontFamily:"'Barlow Condensed',sans-serif"}}>{curPos}</span>
                : (pl?.photo
                  ? <img src={pl.photo} style={{width:"100%",height:"100%",objectFit:"cover"}} alt={pl.name} />
                  : <span style={{fontSize:10,fontWeight:900,color:pl?c:"#3a6a9a",fontFamily:"'Barlow Condensed',sans-serif"}}>{pl?String(v):curPos}</span>
                )
              }
            </div>
            <div style={{marginTop:2,background:"rgba(3,12,20,0.85)",borderRadius:3,padding:"1px 5px",fontSize:9,fontWeight:700,color:pl?"#e0f0ff":"#4477aa",fontFamily:"'Barlow Condensed',sans-serif",whiteSpace:"nowrap",maxWidth:56,overflow:"hidden",textOverflow:"ellipsis",textAlign:"center"}}>
              {pl?pl.name:curPos}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- 프린트 / 공유 ----------

function escapeHtml(str){
  return String(str??"").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function printDocShell(title, bodyHtml){
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin:0; background:#fff; color:#111; font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif; }
  .sheet { max-width: 720px; margin: 0 auto; padding: 20px 24px 40px; }
  h1 { font-size: 21px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 18px 0 8px; color:#222; font-weight:700; }
  .meta { font-size: 12px; color:#555; margin-bottom: 4px; }
  table { width:100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align:left; }
  th { background:#f2f2f2; }
  .pitch-wrap { display:flex; justify-content:center; margin: 10px 0; }
  .print-toolbar { text-align:center; margin: 16px 0; }
  .print-toolbar button { font-size:14px; padding:8px 18px; cursor:pointer; }
  @media print { .print-toolbar { display:none; } }
</style>
</head><body>
<div class="print-toolbar"><button onclick="window.print()">🖨 인쇄하기</button></div>
<div class="sheet">${bodyHtml}</div>
</body></html>`;
}

function openPrintWindow(title, bodyHtml){
  // 모바일(폰/태블릿)에서 window.open 은 팝업 차단으로 막히므로,
  // 화면에 보이지 않는 iframe에 인쇄 문서를 넣고 그 iframe을 인쇄한다.
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, { position:"fixed", right:"0", bottom:"0", width:"0", height:"0", border:"0" });
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow && iframe.contentWindow.document;
  if(!doc){ console.error("[print] 인쇄용 iframe 문서를 열 수 없습니다."); alert("인쇄 준비에 실패했습니다."); iframe.remove(); return; }
  doc.open();
  doc.write(printDocShell(title, bodyHtml));
  doc.close();
  const cleanup = () => setTimeout(() => { try { iframe.remove(); } catch {} }, 1000);
  const go = () => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); }
    catch(e){ console.error("[print] 인쇄 실패:", e); alert("인쇄 중 오류가 발생했습니다."); }
    finally { cleanup(); }
  };
  // 사진 등 이미지 로딩이 끝난 뒤 인쇄 (안 끝나도 안전장치로 강제 실행)
  const imgs = Array.from(doc.images || []);
  if(imgs.length){
    let pending = imgs.length;
    const tick = () => { if(--pending <= 0) go(); };
    imgs.forEach(im => { if(im.complete) tick(); else { im.onload = tick; im.onerror = tick; } });
    setTimeout(go, 2000);
  } else {
    setTimeout(go, 200);
  }
}

function pitchSvgForPrint(formationName, lineup, players, slotPositions, slotPosOverrides, abilities){
  const slots = FORMATIONS[formationName] || [];
  const {x0,x1,y0,y1} = PITCH_BOUNDS;
  // 화면의 피치와 동일하게 잔디 줄무늬(초록)를 그린다
  const stripes = [0,1,2,3,4,5,6].map(i =>
    `<rect x="0" y="${i*23}" width="100" height="11.5" fill="${i%2===0?"#0a2010":"#0c2412"}" />`
  ).join("");
  const markers = slots.map((slot,i) => {
    const pid = lineup[i];
    const p = players.find(x=>x.id===pid) || null;
    const pos = (slotPositions && slotPositions[i]) || slot;
    const curPos = (slotPosOverrides && slotPosOverrides[i]) || slot.p;
    const label = p ? escapeHtml(p.name) : escapeHtml(curPos);
    const hasNum = p && p.number!==undefined && p.number!==null && p.number!=="";
    const num = hasNum ? escapeHtml(String(p.number)) : "";
    const svgX = pos.x;
    const svgY = pos.y * 1.58;
    // 배치된 선수는 OVR 색, 빈 슬롯은 회색 — 화면과 동일한 색 체계
    const c = p ? getColor(ovrFrom(p.attrs, abilities)) : "#5a7a9a";
    const inner = num || (p ? "" : "·");
    return `<circle cx="${svgX}" cy="${svgY}" r="4.6" fill="rgba(6,20,12,0.55)" stroke="${c}" stroke-width="1" />`
      + `<text x="${svgX}" y="${(svgY+1.5).toFixed(1)}" text-anchor="middle" font-size="4.2" font-weight="700" fill="${c}">${inner}</text>`
      + `<text x="${svgX}" y="${(svgY+8.2).toFixed(1)}" text-anchor="middle" font-size="3.6" font-weight="700" fill="#ffffff">${label}</text>`;
  }).join("");

  return `<svg viewBox="0 0 100 158" width="320" height="506" style="max-width:100%;height:auto;border-radius:8px;">`
    + `<rect x="0" y="0" width="100" height="158" fill="#0a2010" />`
    + stripes
    + `<rect x="${x0}" y="${y0}" width="${x1-x0}" height="${y1-y0}" fill="none" stroke="#2e6b42" stroke-width="0.7" />`
    + `<line x1="${x0}" y1="79" x2="${x1}" y2="79" stroke="#2e6b42" stroke-width="0.6" />`
    + `<circle cx="50" cy="79" r="12" fill="none" stroke="#2e6b42" stroke-width="0.6" />`
    + `<rect x="22" y="${y0}" width="56" height="20" fill="none" stroke="#2e6b42" stroke-width="0.6" />`
    + `<rect x="22" y="135" width="56" height="20" fill="none" stroke="#2e6b42" stroke-width="0.6" />`
    + markers
    + `</svg>`;
}

function radarSvgForPrint(attrs, abilities){
  const size=200, cx=100, cy=100, r=68, n=6;
  const ang = i => (Math.PI*2*i/n) - Math.PI/2;
  const pt = (i,v) => ({x:cx+r*(v/99)*Math.cos(ang(i)), y:cy+r*(v/99)*Math.sin(ang(i))});
  const path = vs => vs.map((v,i)=>{const p=pt(i,v); return `${i===0?"M":"L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`;}).join(" ")+"Z";
  const vals = RADAR.map(ax=>radarAxisScore(ax, attrs, abilities));
  const grid = [25,50,75,99].map(lvl =>
    `<polygon fill="none" stroke="#999" stroke-width="0.6" points="${RADAR.map((_,i)=>{const p=pt(i,lvl); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;}).join(" ")}" />`
  ).join("");
  const axes = RADAR.map((_,i)=>{const p=pt(i,99); return `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="#bbb" stroke-width="0.6" />`;}).join("");
  const labels = RADAR.map((ax,i)=>{const p=pt(i,99); const lx=cx+(p.x-cx)*1.24, ly=cy+(p.y-cy)*1.24; return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="9" fill="#333" font-weight="700">${escapeHtml(ax.label)}</text>`;}).join("");
  const dots = vals.map((v,i)=>{const p=pt(i,v); return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="#111" />`;}).join("");
  return `<svg width="${size}" height="${size}">${grid}${axes}<path d="${path(vals)}" fill="rgba(0,0,0,0.08)" stroke="#111" stroke-width="2" />${dots}${labels}</svg>`;
}

// 선수 프린트용 능력치 표(그룹별, 단위 포함)
function buildAbilityPrintTable(attrs, abilities, groups){
  const parts = (groups||[]).map(g => {
    const abs = (abilities||[]).filter(a => a.group === g.id);
    if(!abs.length) return "";
    const rows = abs.map(ab => {
      const raw = attrs?.[ab.key];
      const sc = abScore(ab, raw);
      return `<tr><td>${escapeHtml(ab.label)}${ab.unit?` <span style="color:#888">(${escapeHtml(ab.unit)})</span>`:""}</td>`
        + `<td style="text-align:right;font-weight:700">${escapeHtml(fmtVal(ab, raw))}</td>`
        + `<td style="text-align:right;color:#555">${sc!=null?sc:"-"}</td></tr>`;
    }).join("");
    return `<h2>${escapeHtml(g.name)}</h2><table><thead><tr><th>능력치</th><th style="text-align:right">값</th><th style="text-align:right">점수</th></tr></thead><tbody>${rows}</tbody></table>`;
  });
  return parts.join("");
}

function buildLineupTableRows(slots, lineup, players, slotPosOverrides, abilities){
  return slots.map((slot,i) => {
    const pid = lineup[i];
    const p = players.find(x=>x.id===pid) || null;
    const curPos = (slotPosOverrides && slotPosOverrides[i]) || slot.p;
    const v = p ? ovrFrom(p.attrs, abilities) : null;
    const num = p && p.number!==undefined && p.number!==null && p.number!=="" ? escapeHtml(String(p.number)) : "-";
    return `<tr><td>${escapeHtml(curPos)}</td><td>${p?escapeHtml(p.name):"-"}</td><td>${num}</td><td>${p?escapeHtml(p.club||"-"):"-"}</td><td>${v!=null?v:"-"}</td></tr>`;
  }).join("");
}

function buildBenchTableRows(bench, players, abilities){
  return (bench||[]).map(pid => {
    const p = players.find(x=>x.id===pid);
    if(!p) return "";
    const num = p.number!==undefined && p.number!==null && p.number!=="" ? escapeHtml(String(p.number)) : "-";
    return `<tr><td>${escapeHtml(p.pos)}</td><td>${escapeHtml(p.name)}</td><td>${num}</td><td>${escapeHtml(p.club||"-")}</td><td>${ovrFrom(p.attrs, abilities)}</td></tr>`;
  }).join("");
}

function buildLineupPrintBody({teamName,badge,formationName,matchInfo,slots,lineup,players,slotPositions,slotPosOverrides,bench,abilities}){
  const pitch = pitchSvgForPrint(formationName, lineup, players, slotPositions, slotPosOverrides, abilities);
  const rows = buildLineupTableRows(slots, lineup, players, slotPosOverrides, abilities);
  const benchRows = buildBenchTableRows(bench, players, abilities);
  const filled = lineup.filter(Boolean);
  const avg = filled.length ? Math.round(filled.map(pid=>ovrFrom(players.find(p=>p.id===pid)?.attrs||{}, abilities)).reduce((a,b)=>a+b,0)/filled.length) : null;
  return `<h1>${badge?escapeHtml(badge)+" ":""}${escapeHtml(teamName||"베스트 11")}</h1>`
    + `<h2 style="margin-top:0;">포메이션: ${escapeHtml(formationName)}${avg!=null?` · 평균 OVR ${avg}`:""}</h2>`
    + (matchInfo ? `<div class="meta">${escapeHtml(matchInfo)}</div>` : "")
    + `<div class="pitch-wrap">${pitch}</div>`
    + `<h2>선발 라인업</h2>`
    + `<table><thead><tr><th>포지션</th><th>이름</th><th>등번호</th><th>구단</th><th>OVR</th></tr></thead><tbody>${rows}</tbody></table>`
    + (bench && bench.length ? `<h2>벤치</h2><table><thead><tr><th>포지션</th><th>이름</th><th>등번호</th><th>구단</th><th>OVR</th></tr></thead><tbody>${benchRows}</tbody></table>` : "");
}

function buildPlayerPrintBody(p, team, abilities, groups){
  const v = ovrFrom(p.attrs, abilities);
  const radar = radarSvgForPrint(p.attrs, abilities, groups);
  const num = p.number!==undefined && p.number!==null && p.number!=="" ? escapeHtml(String(p.number)) : "-";
  const photo = p.photo
    ? `<img src="${p.photo}" style="width:96px;height:96px;border-radius:50%;object-fit:cover;border:2px solid #111;" />`
    : `<div style="width:96px;height:96px;border-radius:50%;border:2px solid #111;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:900;">${v}</div>`;
  return `<div style="display:flex;align-items:center;gap:20px;">`
    + photo
    + `<div>`
    + `<h1>${escapeHtml(p.name)}</h1>`
    + `<div class="meta">등번호 ${num} · ${escapeHtml(p.pos)}${team?` · ${escapeHtml(team.badge||"")} ${escapeHtml(team.name||"")}`:""}</div>`
    + `<div class="meta">나이 ${p.age??"-"} · 구단 ${escapeHtml(p.club||"-")} · OVR ${v}</div>`
    + `</div></div>`
    + (radar ? `<h2>능력치 레이더</h2><div class="pitch-wrap">${radar}</div>` : "")
    + buildAbilityPrintTable(p.attrs, abilities, groups);
}

function buildLineupShareText({teamName,formationName,matchInfo,slots,lineup,players,slotPosOverrides,bench}){
  const lines = [];
  lines.push(`⚽ ${teamName||"베스트 11"} - ${formationName}`);
  if(matchInfo) lines.push(matchInfo);
  lines.push("");
  lines.push("[선발 라인업]");
  slots.forEach((slot,i) => {
    const pid = lineup[i];
    const p = players.find(x=>x.id===pid);
    const curPos = (slotPosOverrides && slotPosOverrides[i]) || slot.p;
    const numTag = p && p.number!==undefined && p.number!==null && p.number!=="" ? ` (#${p.number})` : "";
    lines.push(`${curPos} - ${p ? `${p.name}${numTag}` : "미배치"}`);
  });
  if(bench && bench.length){
    lines.push("");
    lines.push("[벤치]");
    bench.forEach(pid => {
      const p = players.find(x=>x.id===pid);
      if(!p) return;
      const numTag = p.number!==undefined && p.number!==null && p.number!=="" ? ` (#${p.number})` : "";
      lines.push(`${p.pos} - ${p.name}${numTag}`);
    });
  }
  return lines.join("\n");
}

async function shareOrCopy(title, text){
  if(navigator.share){
    try { await navigator.share({title, text}); return; }
    catch(e){ if(e?.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    alert("클립보드에 복사되었습니다.");
  } catch {
    alert("공유하기가 지원되지 않는 환경입니다.\n\n"+text);
  }
}

function inferLineupTeam(lineup, players, teamMap, teamFilter){
  if(teamFilter && teamFilter!=="all" && teamFilter!=="none") return teamMap[teamFilter] || null;
  const counts = {};
  lineup.forEach(pid => {
    const p = players.find(x=>x.id===pid);
    if(p?.tid) counts[p.tid] = (counts[p.tid]||0)+1;
  });
  const top = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
  return top ? (teamMap[top[0]] || null) : null;
}

// ---------- MAIN ----------

export default function App(){
  const [nav, setNav] = useState("선수");
  const [teams, setTeams] = useState(INIT_TEAMS);
  const [players, setPlayers] = useState(INIT_PLAYERS);
  const [sel, setSel] = useState(INIT_PLAYERS[0]);
  const [dtab, setDtab] = useState("개요");
  const [aCat, setACat] = useState("g_tech"); // 능력치 탭에서 선택된 그룹 id
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
  const [formation, setFormation] = useState("11v11 · 4-3-3");
  const [lineup, setLineup] = useState(Array(11).fill(null));
  const [selSlot, setSelSlot] = useState(null);
  const [slotPositions, setSlotPositions] = useState({});
  const [slotPosOverrides, setSlotPosOverrides] = useState({});
  const [formFilter, setFormFilter] = useState("all");
  const [bench, setBench] = useState([]);
  const [showBench, setShowBench] = useState(true);
  const [showZones, setShowZones] = useState(false);
  const [showChannels, setShowChannels] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarViewMode, setSidebarViewMode] = useState("all"); // "all" | "position"
  const [cardMode, setCardMode] = useState("stats"); // "stats" | "number" | "position"
  const [schema, setSchema] = useState(DEFAULT_SCHEMA); // 사용자 편집 가능한 능력치 스키마
  const [attrMgrOpen, setAttrMgrOpen] = useState(false); // 능력치 관리 모달

  const [matches, setMatches] = useState([]);
  const [activeMatchId, setActiveMatchId] = useState(null);
  const [addingMatch, setAddingMatch] = useState(false);
  const [newMatch, setNewMatch] = useState({date:TODAY, opponent:"", homeAway:"home", competition:""});

  const photoRef = useRef();
  const editPhotoRef = useRef();

  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudError, setCloudError] = useState(null);
  const [retryTick, setRetryTick] = useState(0);

  function loadLocalData(){
    const sp = localStorage.getItem("ezra-players");
    const st = localStorage.getItem("ezra-teams");
    const sm = localStorage.getItem("ezra-matches");
    const ss = localStorage.getItem("ezra-schema");
    const p = sp ? JSON.parse(sp) : INIT_PLAYERS;
    const t = st ? JSON.parse(st) : INIT_TEAMS;
    const m = sm ? JSON.parse(sm) : [];
    setPlayers(p); setSel(p[0]||null); setTeams(t); setMatches(m);
    setSchema(ss ? normalizeSchema(JSON.parse(ss)) : DEFAULT_SCHEMA);
  }

  // 이 기기가 마지막으로 동기화한 클라우드 버전의 시각(uid별로 저장) — 기기 간 자동 동기화 기준점
  function getLocalSyncedAt(uid){
    return Number(localStorage.getItem(`ezra-syncedAt-${uid}`)) || 0;
  }
  function setLocalSyncedAt(uid, ts){
    localStorage.setItem(`ezra-syncedAt-${uid}`, String(ts));
  }

  // 로그인 상태 감지
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => { setUser(u); setAuthLoading(false); });
    return unsub;
  }, []);

  // 로그아웃 상태: 이 기기(localStorage)의 데이터를 불러옴
  useEffect(() => {
    if(!user){ setCloudReady(false); setCloudError(null); loadLocalData(); }
  }, [user]);

  // 로그인 상태: Firestore의 클라우드 데이터를 우선 확인.
  // 여러 기기를 오갈 때 매번 "어느 쪽을 쓸지" 묻지 않도록, updatedAt 타임스탬프를 기준으로
  // 더 최신 쪽을 자동으로 채택한다 (마지막에 저장한 기기의 데이터가 항상 이긴다).
  // 클라우드 접근에 실패하면(권한/네트워크 오류) "동기화됨"으로 위장하지 않고 에러를 표시한다.
  useEffect(() => {
    if(!user) return;
    let cancelled = false;
    setCloudReady(false);
    setCloudError(null);
    (async () => {
      try {
        const ref = doc(db, "users", user.uid);
        const snap = await getDoc(ref);
        if(cancelled) return;
        if(snap.exists()){
          const data = snap.data();
          const cloudUpdatedAt = data.updatedAt || 0;
          const localSyncedAt = getLocalSyncedAt(user.uid);
          if(cloudUpdatedAt >= localSyncedAt){
            // 클라우드가 이 기기가 마지막으로 알던 것과 같거나 더 최신 → 클라우드 데이터를 그대로 채택
            const cloudPlayers = data.players || [];
            const cloudTeams = data.teams || [];
            const cloudMatches = data.matches || [];
            setPlayers(cloudPlayers); setSel(cloudPlayers[0]||null); setTeams(cloudTeams); setMatches(cloudMatches);
            setSchema(data.attrSchema ? normalizeSchema(data.attrSchema) : DEFAULT_SCHEMA);
            setLocalSyncedAt(user.uid, cloudUpdatedAt);
            setCloudReady(true);
          } else {
            // 이 기기에 클라우드보다 최신인(아직 못 올라간) 데이터가 있음 → 밀어올림
            const ts = Date.now();
            await setDoc(ref, { players, teams, matches, attrSchema: schema, updatedAt: ts });
            setLocalSyncedAt(user.uid, ts);
            setCloudReady(true);
          }
        } else {
          const ts = Date.now();
          await setDoc(ref, { players, teams, matches, attrSchema: schema, updatedAt: ts });
          setLocalSyncedAt(user.uid, ts);
          setCloudReady(true);
        }
      } catch(e){
        console.error("클라우드 데이터 로드 실패", e);
        if(!cancelled) setCloudError(e.code || e.message || String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [user, retryTick]);

  // 로그아웃 상태: 이 기기에만 저장
  useEffect(() => {
    if(user) return;
    localStorage.setItem("ezra-players", JSON.stringify(players));
  }, [players, user]);

  useEffect(() => {
    if(user) return;
    localStorage.setItem("ezra-teams", JSON.stringify(teams));
  }, [teams, user]);

  useEffect(() => {
    if(user) return;
    localStorage.setItem("ezra-matches", JSON.stringify(matches));
  }, [matches, user]);

  useEffect(() => {
    if(user) return;
    localStorage.setItem("ezra-schema", JSON.stringify(schema));
  }, [schema, user]);

  // 로그인 상태: 변경될 때마다 자동으로 Firebase에 저장하고, 이 기기의 동기화 시각도 갱신
  useEffect(() => {
    if(!user || !cloudReady) return;
    const ts = Date.now();
    setDoc(doc(db, "users", user.uid), { players, teams, matches, attrSchema: schema, updatedAt: ts }, { merge: true })
      .then(() => setLocalSyncedAt(user.uid, ts))
      .catch(e => { console.error("클라우드 저장 실패", e); setCloudError(e.code || e.message || String(e)); });
  }, [players, teams, matches, schema, user, cloudReady]);

  async function handleLogin(){
    try { await signInWithPopup(auth, googleProvider); }
    catch(e){ console.error(e); alert("로그인 실패: " + e.message); }
  }
  function handleLogout(){ signOut(auth); }

  function retryCloudSync(){
    setCloudError(null);
    setRetryTick(t => t+1);
  }

  // ── 능력치 스키마 편집 (그룹/능력치 CRUD) ──
  // 선수 데이터(attrs)는 절대 건드리지 않는다. 능력치 key는 불변이라 이름 변경/삭제해도 값이 안전하게 유지된다.
  function updateSchema(mut){ setSchema(s => normalizeSchema(mut(structuredClone(s)))); }
  function addGroup(){ const id="g_"+Date.now(); updateSchema(s=>{ s.groups.push({id,name:"새 그룹"}); return s; }); setACat(id); }
  function renameGroup(id,name){ updateSchema(s=>{ const g=s.groups.find(x=>x.id===id); if(g) g.name=name; return s; }); }
  function deleteGroup(id){
    if(schema.groups.length<=1){ alert("그룹은 최소 1개 필요합니다."); return; }
    const rest = schema.groups.filter(g=>g.id!==id);
    updateSchema(s=>{
      s.groups = s.groups.filter(g=>g.id!==id);
      const fb = s.groups[0]?.id;
      s.abilities.forEach(a=>{ if(a.group===id) a.group=fb; }); // 소속 능력치는 삭제하지 않고 첫 그룹으로 이동
      return s;
    });
    if(aCat===id) setACat(rest[0]?.id || "");
  }
  function addAbility(groupId){ const key="a_"+Date.now()+"_"+Math.floor(Math.random()*1000); updateSchema(s=>{ s.abilities.push({key,label:"새 능력치",group:groupId,unit:"",direction:"high",min:0,max:100}); return s; }); }
  function updateAbility(key, patch){ updateSchema(s=>{ const a=s.abilities.find(x=>x.key===key); if(a) Object.assign(a, patch); return s; }); }
  function deleteAbility(key){ updateSchema(s=>{ s.abilities = s.abilities.filter(a=>a.key!==key); return s; }); } // attrs[key]는 보존

  const teamMap = useMemo(()=>Object.fromEntries(teams.map(t=>[t.id,t])),[teams]);
  // 능력치 스키마 파생값 + OVR(정규화 평균) 로컬 헬퍼 — 컴포넌트 내 모든 ovr() 호출이 이걸 사용
  const groups = schema.groups;
  const abilities = schema.abilities;
  const ovr = (attrs) => ovrFrom(attrs, abilities);
  const abilitiesByGroup = useMemo(() => {
    const m = {};
    groups.forEach(g => { m[g.id] = abilities.filter(a => a.group === g.id); });
    return m;
  }, [schema]);
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
  const activeMatch = activeMatchId ? matches.find(m=>m.id===activeMatchId)||null : null;
  const sortedMatches = useMemo(()=>[...matches].sort((a,b)=>a.date.localeCompare(b.date)),[matches]);

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
    const seedAttrs = Object.fromEntries(abilities.map(a => [a.key, a.unit ? "" : 65]));
    setNewP({id:Date.now(),name:"",pos:"ST",age:20,club:"",number:"",heightCm:"",weightKg:"",size:"",tid:teams[0]?.id||"",photo:null,attrs:seedAttrs,history:[]});
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
    setBench(bs=>bs.filter(x=>x!==pid));
  }
  function clearLineup(){ setLineup(Array(FORMATIONS[formation]?.length||11).fill(null)); setSelSlot(null); setSlotPositions({}); setSlotPosOverrides({}); }
  function handleDragEnd(i, pos){
    setSlotPositions(prev=>({...prev,[i]:pos}));
    setSlotPosOverrides(prev=>({...prev,[i]:classifyPosition(pos.x,pos.y)}));
  }
  function toggleBench(pid){
    setBench(bs => bs.includes(pid) ? bs.filter(x=>x!==pid) : [...bs, pid]);
    setLineup(ls => ls.includes(pid) ? ls.map(x=>x===pid?null:x) : ls);
  }

  function startAddMatch(){
    setNewMatch({date:TODAY, opponent:"", homeAway:"home", competition:""});
    setAddingMatch(true);
  }
  function saveNewMatch(){
    if(!newMatch.opponent.trim()) return;
    const defaultFormation = "11v11 · 4-3-3";
    const m = {
      id:"m"+Date.now(), date:newMatch.date||TODAY, opponent:newMatch.opponent.trim(),
      homeAway:newMatch.homeAway, competition:newMatch.competition.trim(),
      formation:defaultFormation, lineup:Array(FORMATIONS[defaultFormation].length).fill(null),
      slotPositions:{}, slotPosOverrides:{}, bench:[],
    };
    setMatches(ms=>[...ms,m]);
    setAddingMatch(false);
  }
  function delMatch(mid){
    setMatches(ms=>ms.filter(m=>m.id!==mid));
    if(activeMatchId===mid) setActiveMatchId(null);
  }
  function openMatch(m){
    const f = m.formation||"11v11 · 4-3-3";
    setFormation(f);
    setLineup(m.lineup&&m.lineup.length ? [...m.lineup] : Array(FORMATIONS[f].length).fill(null));
    setSlotPositions(m.slotPositions||{});
    setSlotPosOverrides(m.slotPosOverrides||{});
    setBench(m.bench||[]);
    setSelSlot(null);
    setActiveMatchId(m.id);
    setNav("베스트 11");
  }
  function saveMatchLineup(){
    if(!activeMatchId) return;
    setMatches(ms=>ms.map(m=>m.id===activeMatchId
      ? {...m, formation, lineup:[...lineup], slotPositions:{...slotPositions}, slotPosOverrides:{...slotPosOverrides}, bench:[...bench]}
      : m));
  }
  function exitMatchEdit(){ setActiveMatchId(null); }
  function matchAvgOvr(m){
    const filled = (m.lineup||[]).filter(Boolean);
    if(!filled.length) return null;
    return Math.round(filled.map(pid=>ovr(players.find(p=>p.id===pid)?.attrs||{})).reduce((a,b)=>a+b,0)/filled.length);
  }
  function formationShort(f){
    if(!f) return "-";
    const parts = f.split("·");
    return parts.length>1 ? parts[1].trim() : f;
  }

  function matchInfoText(m){
    return `${m.date} · vs ${m.opponent} (${m.homeAway==="home"?"홈":"원정"})${m.competition?` · ${m.competition}`:""}`;
  }

  function handlePrintLineup(){
    const team = inferLineupTeam(lineup, players, teamMap, formFilter);
    const body = buildLineupPrintBody({
      teamName: team?.name, badge: team?.badge, formationName: formation,
      matchInfo: activeMatch ? matchInfoText(activeMatch) : null,
      slots, lineup, players, slotPositions, slotPosOverrides, bench, abilities,
    });
    openPrintWindow(`${team?.name||"베스트 11"} - ${formation}`, body);
  }
  function handleShareLineup(){
    const team = inferLineupTeam(lineup, players, teamMap, formFilter);
    const text = buildLineupShareText({
      teamName: team?.name, formationName: formation,
      matchInfo: activeMatch ? matchInfoText(activeMatch) : null,
      slots, lineup, players, slotPosOverrides, bench,
    });
    shareOrCopy(`${team?.name||"베스트 11"} 라인업`, text);
  }
  function handlePrintMatch(m){
    const mslots = FORMATIONS[m.formation]||[];
    const team = inferLineupTeam(m.lineup||[], players, teamMap, "all");
    const body = buildLineupPrintBody({
      teamName: team?.name, badge: team?.badge, formationName: m.formation,
      matchInfo: matchInfoText(m),
      slots: mslots, lineup: m.lineup||[], players, slotPositions: m.slotPositions||{}, slotPosOverrides: m.slotPosOverrides||{}, bench: m.bench||[], abilities,
    });
    openPrintWindow(`vs ${m.opponent} - ${m.formation}`, body);
  }
  function handleShareMatch(m){
    const mslots = FORMATIONS[m.formation]||[];
    const team = inferLineupTeam(m.lineup||[], players, teamMap, "all");
    const text = buildLineupShareText({
      teamName: team?.name, formationName: m.formation, matchInfo: matchInfoText(m),
      slots: mslots, lineup: m.lineup||[], players, slotPosOverrides: m.slotPosOverrides||{}, bench: m.bench||[],
    });
    shareOrCopy(`vs ${m.opponent} 라인업`, text);
  }
  function handlePrintPlayer(){
    if(!display) return;
    const team = display.tid ? teamMap[display.tid] : null;
    openPrintWindow(`${display.name} 프로필`, buildPlayerPrintBody(display, team, abilities, groups));
  }

  const NAV=["선수","팀 관리","베스트 11","경기 일정"];
  const DTABS=["개요","능력치","성장 추적"];

  const cardStyle = {background:"#071525",border:"1px solid #0d2340",borderRadius:8,padding:"12px 15px"};

  function renderPlayerRow(p){
    const v=ovr(p.attrs), isSel=sel?.id===p.id;
    const tc=p.tid?teamMap[p.tid]?.color:"#1e6ba8";
    return (
      <div key={p.id} onClick={()=>{setSel(p);setEditing(false);setEditD(null);setDtab("개요");}}
        style={{background:isSel?"#0d2340":"#071525",border:isSel?`1px solid ${tc}`:"1px solid #0d2340",borderLeft:isSel?`3px solid ${tc}`:"3px solid transparent",borderRadius:6,padding:"9px 11px",cursor:"pointer",display:"flex",alignItems:"center",gap:10,marginBottom:5,transition:"all 0.15s"}}>
        <Avatar photo={p.photo} name={p.name} size={36} ovrVal={v} color={getColor(v)} mode={cardMode} number={p.number} pos={p.pos} />
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:13,color:"#e0f0ff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name}</div>
          <div style={{fontSize:10,color:"#5577aa"}}>{p.club}</div>
        </div>
        <div style={{background:"#0d2340",borderRadius:3,padding:"2px 6px",fontSize:11,fontWeight:700,color:"#4499dd",fontFamily:"'Barlow Condensed',sans-serif",flexShrink:0}}>{p.pos}</div>
      </div>
    );
  }

  return (
    <div className="app-shell" style={{background:"#030c14",fontFamily:"'Barlow Condensed',sans-serif",color:"#e0f0ff",display:"flex",flexDirection:"column"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;700;900&family=Oswald:wght@400;700&display=swap');
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-thumb{background:#1e3a5f;border-radius:2px}
        select option{background:#0d1b2a}
        .app-shell{height:100vh;height:100dvh;}
        .sidebar-toggle-btn{display:none;}
        @media (max-width:480px){
          .app-header{flex-wrap:wrap;row-gap:8px;padding:8px 12px !important;}
          .app-title-main{font-size:13px !important;}
          .nav-row{order:2;}
          .card-mode-toggle{order:3;}
          .auth-controls{margin-left:0 !important;order:4;width:100%;justify-content:flex-end;flex-wrap:wrap;row-gap:6px;}
          .player-count-label{order:5;width:100%;}

          .sidebar-toggle-btn{display:flex !important;}
          .player-layout{flex-direction:column !important;height:auto !important;overflow:visible !important;}
          .player-sidebar{width:100% !important;height:42vh !important;border-right:none !important;border-bottom:1px solid #0d2340;}
          .player-sidebar.collapsed{display:none !important;}
          .player-main{height:auto !important;overflow-y:visible !important;padding:12px 14px !important;}
          .player-header-card{flex-wrap:wrap !important;}
          .add-player-grid{grid-template-columns:1fr 1fr !important;}

          .team-view{padding:12px 14px !important;}

          .best11-layout{flex-direction:column !important;height:auto !important;overflow:visible !important;}
          .best11-pitch-col{flex:none !important;width:100% !important;overflow-y:visible !important;padding:12px !important;}
          .best11-picker-col{flex:none !important;width:100% !important;border-left:none !important;border-top:1px solid #0d2340;overflow:visible !important;}
          .best11-picker-col > div{overflow-y:visible !important;}

          button{min-height:40px;padding-top:8px !important;padding-bottom:8px !important;}
          input, select{min-height:38px;font-size:14px !important;}
        }
      `}</style>

      {/* HEADER */}
      <div className="app-header" style={{background:"linear-gradient(90deg,#071525,#0a1e35)",borderBottom:"2px solid #1e3a5f",padding:"9px 18px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>


        <div>
          <div className="app-title-main" style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,letterSpacing:2}}>EZRA FOOTBALL MANAGER</div>
          <div style={{fontSize:10,color:"#e0f0ff",fontWeight:700,letterSpacing:0.5}}>에스라 풋볼 매니저 · 선수 능력치 관리</div>
        </div>
        <div className="nav-row" style={{display:"flex",gap:3,marginLeft:16,flexWrap:"wrap"}}>
          {NAV.map(n=>(
            <button key={n} onClick={()=>{
              if(n==="베스트 11" && nav!=="베스트 11" && activeMatchId!==null){
                // 경기에 연결되지 않은 프리스타일 상태로 진입 (이전 경기 편집 잔여 데이터를 남기지 않음)
                setActiveMatchId(null);
                setFormation("11v11 · 4-3-3");
                setLineup(Array(FORMATIONS["11v11 · 4-3-3"].length).fill(null));
                setSlotPositions({}); setSlotPosOverrides({}); setBench([]); setSelSlot(null);
              }
              setNav(n);
            }} style={{background:nav===n?"#1e6ba8":"transparent",border:nav===n?"1px solid #2a8ad4":"1px solid #1e3a5f",color:nav===n?"#fff":"#5577aa",borderRadius:5,padding:"5px 13px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer"}}>
              {n==="베스트 11"?"🏆 "+n:n==="경기 일정"?"📅 "+n:n}
            </button>
          ))}
        </div>
        <div className="card-mode-toggle" style={{display:"flex",gap:2,background:"#0d1b2a",border:"1px solid #1e3a5f",borderRadius:5,padding:2}}>
          <button onClick={()=>setCardMode("stats")} style={{background:cardMode==="stats"?"#1e6ba8":"transparent",border:"none",color:cardMode==="stats"?"#fff":"#5577aa",borderRadius:4,padding:"4px 10px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,fontWeight:700,cursor:"pointer"}}>능력치</button>
          <button onClick={()=>setCardMode("number")} style={{background:cardMode==="number"?"#1e6ba8":"transparent",border:"none",color:cardMode==="number"?"#fff":"#5577aa",borderRadius:4,padding:"4px 10px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,fontWeight:700,cursor:"pointer"}}>등번호</button>
          <button onClick={()=>setCardMode("position")} style={{background:cardMode==="position"?"#1e6ba8":"transparent",border:"none",color:cardMode==="position"?"#fff":"#5577aa",borderRadius:4,padding:"4px 10px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,fontWeight:700,cursor:"pointer"}}>포지션</button>
        </div>
        <button onClick={()=>setAttrMgrOpen(true)} title="능력치 항목 관리" style={{background:"transparent",border:"1px solid #1e3a5f",color:"#5577aa",borderRadius:5,padding:"5px 10px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer"}}>⚙ 능력치</button>
        <span className="player-count-label" style={{marginLeft:"auto",fontSize:10,color:"#335577"}}>선수 {players.length}명 · 팀 {teams.length}개</span>

        {!authLoading && (user ? (
          <div className="auth-controls" style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              {user.photoURL
                ? <img src={user.photoURL} alt={user.displayName||"user"} referrerPolicy="no-referrer" style={{width:22,height:22,borderRadius:"50%"}} />
                : <div style={{width:22,height:22,borderRadius:"50%",background:"#1e3a5f"}} />
              }
              <span style={{fontSize:11,color:"#8899aa",maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.displayName||user.email}</span>
            </div>
            {cloudError ? (
              <>
                <button title={cloudError} onClick={()=>alert("동기화 실패 원인:\n"+cloudError)} style={{background:"transparent",border:"none",color:"#ef5350",fontSize:9,fontFamily:"'Barlow Condensed',sans-serif",cursor:"pointer",textDecoration:"underline"}}>⚠ 동기화 실패 (탭하여 원인 보기)</button>
                <button onClick={retryCloudSync} style={{background:"transparent",border:"1px solid #5a1a1a",color:"#cc4444",borderRadius:5,padding:"4px 9px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,cursor:"pointer"}}>재시도</button>
              </>
            ) : (
              <span style={{fontSize:9,color:cloudReady?"#69f0ae":"#ffb84d"}}>{cloudReady?"☁ 동기화됨":"⏳ 동기화 중…"}</span>
            )}
            <button onClick={handleLogout} style={{background:"transparent",border:"1px solid #1e3a5f",color:"#5577aa",borderRadius:5,padding:"5px 11px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,cursor:"pointer"}}>로그아웃</button>
          </div>
        ) : (
          <button className="auth-controls" onClick={handleLogin} style={{display:"flex",alignItems:"center",gap:6,background:"#fff",border:"1px solid #ccc",color:"#333",borderRadius:5,padding:"5px 12px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer"}}>
            <GoogleIcon /> Google로 로그인
          </button>
        ))}

      </div>

      {/* ===== PLAYER VIEW ===== */}
      {nav==="선수" && (
        <div className="player-layout" style={{display:"flex",flex:1,minHeight:0,overflow:"hidden"}}>
          <button className="sidebar-toggle-btn" onClick={()=>setSidebarOpen(v=>!v)} style={{alignItems:"center",justifyContent:"center",gap:6,background:"#0d2340",border:"none",borderBottom:"1px solid #1e3a5f",color:"#88bbdd",fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer",flexShrink:0}}>
            ☰ 선수 목록 {sidebarOpen?"숨기기":`보기 (${players.length})`}
          </button>
          {/* sidebar */}
          <div className={`player-sidebar${sidebarOpen?"":" collapsed"}`} style={{width:232,background:"#050f1a",borderRight:"1px solid #0d2340",display:"flex",flexDirection:"column",flexShrink:0}}>
            <div style={{padding:"9px 10px",borderBottom:"1px solid #0d2340",display:"flex",flexDirection:"column",gap:5}}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="검색…" style={{...INPUT,fontSize:11,padding:"5px 9px"}} />
              <select value={fTeam} onChange={e=>setFTeam(e.target.value)} style={{...INPUT,fontSize:11,padding:"4px 8px"}}>
                <option value="all">전체 팀</option>
                {teams.map(t=><option key={t.id} value={t.id}>{t.badge} {t.name}</option>)}
                <option value="none">팀 없음</option>
              </select>
              <div style={{display:"flex",gap:2,background:"#0d1b2a",border:"1px solid #1e3a5f",borderRadius:5,padding:2}}>
                <button onClick={()=>setSidebarViewMode("all")} style={{flex:1,background:sidebarViewMode==="all"?"#1e6ba8":"transparent",border:"none",color:sidebarViewMode==="all"?"#fff":"#5577aa",borderRadius:4,padding:"4px 6px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:10,fontWeight:700,cursor:"pointer"}}>전체 보기</button>
                <button onClick={()=>setSidebarViewMode("position")} style={{flex:1,background:sidebarViewMode==="position"?"#1e6ba8":"transparent",border:"none",color:sidebarViewMode==="position"?"#fff":"#5577aa",borderRadius:4,padding:"4px 6px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:10,fontWeight:700,cursor:"pointer"}}>포지션별 보기</button>
              </div>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"7px 9px"}}>
              {sidebarViewMode==="position" ? (
                <>
                  {PLAYER_GROUPS.map(g=>{
                    const groupPlayers = filtered.filter(p=>g.positions.includes(p.pos));
                    if(groupPlayers.length===0) return null;
                    return (
                      <div key={g.key} style={{marginBottom:12}}>
                        <div style={{fontSize:10,color:"#4499dd",fontWeight:700,letterSpacing:2,marginBottom:5,borderBottom:"1px solid #0d2340",paddingBottom:3}}>{g.label} ({groupPlayers.length})</div>
                        {groupPlayers.map(renderPlayerRow)}
                      </div>
                    );
                  })}
                  {filtered.length===0 && <p style={{color:"#335577",fontSize:12,textAlign:"center",marginTop:20}}>검색 결과 없음</p>}
                </>
              ) : (
                <>
                  {filtered.map(renderPlayerRow)}
                  {filtered.length===0 && <p style={{color:"#335577",fontSize:12,textAlign:"center",marginTop:20}}>검색 결과 없음</p>}
                </>
              )}
            </div>
            <div style={{padding:"9px 10px",borderTop:"1px solid #0d2340"}}>
              <button onClick={startAdd} style={{width:"100%",background:"linear-gradient(135deg,#1e6ba8,#0d4a7a)",border:"none",color:"#fff",borderRadius:5,padding:"8px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer"}}>+ 선수 추가</button>
            </div>
          </div>

          {/* main */}
          <div className="player-main" style={{flex:1,overflowY:"auto",padding:"15px 20px"}}>

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
                <div className="add-player-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:9,marginBottom:14}}>
                  {[{l:"이름",k:"name",t:"text"},{l:"등번호",k:"number",t:"number"},{l:"나이",k:"age",t:"number"},{l:"구단",k:"club",t:"text"},{l:"키(cm)",k:"heightCm",t:"number"},{l:"몸무게(kg)",k:"weightKg",t:"number"},{l:"사이즈",k:"size",t:"text"}].map(({l,k,t})=>(
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
                {groups.map(g=>(
                  <div key={g.id} style={{marginBottom:12}}>
                    <div style={{fontSize:10,color:"#4499dd",fontWeight:700,letterSpacing:2,marginBottom:5,borderBottom:"1px solid #0d2340",paddingBottom:3}}>{g.name}</div>
                    {(abilitiesByGroup[g.id]||[]).map(ab=>(
                      <Bar key={ab.key} ab={ab} value={newP.attrs[ab.key]} editing={true} onChange={v=>setNewP(p=>({...p,attrs:{...p.attrs,[ab.key]:v}}))} />
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
                <div className="player-header-card" style={{...cardStyle,border:`1px solid ${selTeam?.color||"#1e3a5f"}`,marginBottom:12,display:"flex",alignItems:"center",gap:14}}>
                  <div style={{position:"relative",flexShrink:0}}>
                    <Avatar photo={display.photo} name={display.name} size={62} ovrVal={ovrVal} color={getColor(ovrVal)} mode={cardMode} number={display.number} pos={display.pos} />
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
                      {[{k:"number",l:"등번호",unit:""},{k:"age",l:"나이",unit:""},{k:"club",l:"구단",unit:""},{k:"heightCm",l:"키",unit:"cm"},{k:"weightKg",l:"몸무게",unit:"kg"},{k:"size",l:"사이즈",unit:""}].map(({k,l,unit})=>(
                        <div key={k} style={{background:"#0d1b2a",borderRadius:4,padding:"3px 8px"}}>
                          <span style={{fontSize:9,color:"#335577"}}>{l} </span>
                          {editing
                            ? <input type={k==="club"||k==="size"?"text":"number"} value={editD[k]} onChange={e=>setEditD(d=>({...d,[k]:e.target.value}))} style={{background:"transparent",border:"none",color:"#4499dd",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,width:70,outline:"none"}} />
                            : <span style={{fontSize:12,fontWeight:700,color:"#4499dd"}}>{display[k]}{display[k]!==""&&display[k]!=null?unit:""}</span>
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
                        <button onClick={handlePrintPlayer} style={{background:"transparent",border:"1px solid #1e3a5f",color:"#88bbdd",borderRadius:5,padding:"7px 12px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer"}}>🖨 프린트</button>
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
                      <Radar attrs={display.attrs} prev={prevSnap?.attrs} abilities={abilities} groups={groups} />
                      {prevSnap && <div style={{fontSize:9,color:"#ff9800",marginTop:3}}>── 이전 스냅샷 비교</div>}
                    </div>
                    <div style={{flex:1,minWidth:160,display:"flex",flexDirection:"column",gap:8}}>
                      {groups.map(g=>{
                        const atrs=abilitiesByGroup[g.id]||[];
                        if(!atrs.length) return null;
                        const avg=groupScore(g.id, display.attrs, abilities);
                        const top=[...atrs].map(ab=>({ab,sc:abScore(ab,display.attrs[ab.key])})).filter(x=>x.sc!=null).sort((a,b)=>b.sc-a.sc).slice(0,3);
                        return (
                          <div key={g.id} style={cardStyle}>
                            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                              <div style={{fontSize:20,fontWeight:900,color:getColor(avg),fontFamily:"'Oswald',sans-serif",width:30}}>{avg}</div>
                              <div style={{flex:1}}>
                                <div style={{fontSize:11,fontWeight:700,color:"#8899aa",letterSpacing:1}}>{g.name} 평균</div>
                                <div style={{fontSize:9,color:"#335577"}}>TOP: {top.map(({ab})=>`${ab.label} ${fmtVal(ab,display.attrs[ab.key])}`).join(" · ")||"-"}</div>
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

                {dtab==="능력치" && (()=>{
                  const curGroup = groups.find(g=>g.id===aCat) || groups[0];
                  const curAbs = curGroup ? (abilitiesByGroup[curGroup.id]||[]) : [];
                  return (
                  <div>
                    <div style={{display:"flex",gap:3,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
                      {groups.map(g=>(
                        <button key={g.id} onClick={()=>setACat(g.id)} style={{background:curGroup?.id===g.id?"#1e3a5f":"transparent",border:curGroup?.id===g.id?"1px solid #2a5580":"1px solid #0d2340",color:curGroup?.id===g.id?"#88bbdd":"#4477aa",borderRadius:5,padding:"4px 13px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer"}}>{g.name}</button>
                      ))}
                      <button onClick={()=>setAttrMgrOpen(true)} title="능력치 항목 관리" style={{marginLeft:"auto",background:"transparent",border:"1px solid #0d2340",color:"#5577aa",borderRadius:5,padding:"4px 10px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer"}}>⚙ 능력치 관리</button>
                    </div>
                    <div style={cardStyle}>
                      <div style={{fontSize:10,color:"#4499dd",fontWeight:700,letterSpacing:2,marginBottom:9}}>{curGroup?.name||""}</div>
                      {curAbs.length===0 && <div style={{fontSize:12,color:"#335577"}}>이 그룹에 능력치가 없습니다. ⚙ 능력치 관리에서 추가하세요.</div>}
                      {curAbs.map(ab=>(
                        <Bar key={ab.key} ab={ab} value={editing?editD.attrs[ab.key]:display.attrs[ab.key]} editing={editing} onChange={v=>setEditD(d=>({...d,attrs:{...d.attrs,[ab.key]:v}}))} />
                      ))}
                    </div>
                  </div>
                  );
                })()}

                {dtab==="성장 추적" && (
                  <div>
                    <div style={{display:"flex",alignItems:"center",marginBottom:11}}>
                      <span style={{fontSize:11,color:"#4477aa",fontWeight:700,letterSpacing:1}}>OVR 성장 추이</span>
                      <button onClick={()=>setSnapModal(true)} style={{marginLeft:"auto",background:"#1e3a5f",border:"1px solid #2a5580",color:"#88bbdd",borderRadius:5,padding:"5px 13px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,fontWeight:700,cursor:"pointer"}}>📸 스냅샷 기록</button>
                    </div>
                    <div style={{...cardStyle,marginBottom:12}}>
                      <GrowthLine history={sel?.history||[]} abilities={abilities} />
                    </div>
                    <div style={{...cardStyle,marginBottom:12}}>
                      <div style={{fontSize:10,color:"#4499dd",fontWeight:700,letterSpacing:2,marginBottom:9}}>능력치별 변화 (단위 기준)</div>
                      {(sel?.history||[]).length<2 && <p style={{color:"#335577",fontSize:12}}>스냅샷 2개 이상이면 능력치별 추이가 표시됩니다</p>}
                      {(sel?.history||[]).length>=2 && (() => {
                        const rows = abilities.map(ab => <AbilityGrowthLine key={ab.key} ab={ab} history={sel.history} />).filter(Boolean);
                        return rows.length ? rows : <p style={{color:"#335577",fontSize:12}}>변화를 표시할 데이터가 없습니다</p>;
                      })()}
                    </div>
                    <div style={cardStyle}>
                      <div style={{fontSize:10,color:"#4499dd",fontWeight:700,letterSpacing:2,marginBottom:9}}>스냅샷 이력 (OVR)</div>
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
        <div className="team-view" style={{flex:1,overflowY:"auto",padding:"16px 24px"}}>
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
                          <Avatar photo={p.photo} name={p.name} size={30} ovrVal={v} color={getColor(v)} mode={cardMode} number={p.number} pos={p.pos} />
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
        <div className="best11-layout" style={{display:"flex",flex:1,minHeight:0,overflow:"hidden"}}>
          {/* pitch */}
          <div className="best11-pitch-col" style={{flex:"0 0 420px",padding:"14px 14px 14px 18px",display:"flex",flexDirection:"column",gap:10,overflowY:"auto"}}>
            {activeMatch && (
              <div style={{background:"#0d2a1a",border:"1px solid #1e5a30",borderRadius:8,padding:"9px 13px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:120}}>
                  <div style={{fontSize:9,color:"#69f0ae",fontWeight:700,letterSpacing:1}}>📌 경기 라인업 편집 중</div>
                  <div style={{fontSize:12,fontWeight:700,color:"#e0f0ff"}}>{activeMatch.date} · vs {activeMatch.opponent} ({activeMatch.homeAway==="home"?"홈":"원정"})</div>
                </div>
                <button onClick={saveMatchLineup} style={{background:"#1e6ba8",border:"none",color:"#fff",borderRadius:5,padding:"6px 13px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer"}}>💾 라인업 저장</button>
                <button onClick={exitMatchEdit} style={{background:"transparent",border:"1px solid #1e3a5f",color:"#5577aa",borderRadius:5,padding:"6px 11px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,cursor:"pointer"}}>닫기</button>
              </div>
            )}
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <span style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700,letterSpacing:2}}>🏆 베스트 11</span>
              <select value={formation} onChange={e=>{const f=e.target.value;setFormation(f);setLineup(Array(FORMATIONS[f].length).fill(null));setSelSlot(null);setSlotPositions({});setSlotPosOverrides({});}} style={{...INPUT,width:"auto",fontSize:12,padding:"5px 10px",flex:1,minWidth:90}}>
                {Object.keys(FORMATIONS).map(f=><option key={f}>{f}</option>)}
              </select>
              <button onClick={clearLineup} style={{background:"transparent",border:"1px solid #1e3a5f",color:"#5577aa",borderRadius:5,padding:"5px 12px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,cursor:"pointer"}}>초기화</button>
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              <button onClick={()=>setShowBench(v=>!v)} style={{background:showBench?"#1e6ba8":"transparent",border:showBench?"1px solid #2a8ad4":"1px solid #1e3a5f",color:showBench?"#fff":"#5577aa",borderRadius:5,padding:"5px 12px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,fontWeight:700,cursor:"pointer"}}>🪑 벤치 {showBench?"끄기":"켜기"}</button>
              <button onClick={()=>setShowZones(v=>!v)} style={{background:showZones?"#1e6ba8":"transparent",border:showZones?"1px solid #2a8ad4":"1px solid #1e3a5f",color:showZones?"#fff":"#5577aa",borderRadius:5,padding:"5px 12px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,fontWeight:700,cursor:"pointer"}}>🔢 18존 {showZones?"끄기":"켜기"}</button>
              <button onClick={()=>setShowChannels(v=>!v)} style={{background:showChannels?"#1e6ba8":"transparent",border:showChannels?"1px solid #2a8ad4":"1px solid #1e3a5f",color:showChannels?"#fff":"#5577aa",borderRadius:5,padding:"5px 12px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,fontWeight:700,cursor:"pointer"}}>📐 5채널 {showChannels?"끄기":"켜기"}</button>
              <button onClick={handlePrintLineup} style={{background:"transparent",border:"1px solid #1e3a5f",color:"#88bbdd",borderRadius:5,padding:"5px 12px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,fontWeight:700,cursor:"pointer"}}>🖨 프린트</button>
              <button onClick={handleShareLineup} style={{background:"transparent",border:"1px solid #1e3a5f",color:"#88bbdd",borderRadius:5,padding:"5px 12px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,fontWeight:700,cursor:"pointer"}}>📤 공유</button>
            </div>
            {/* Formation notes */}
            {FORMATION_NOTES[formation] && (
              <div style={{background:"#071525",border:"1px solid #0d2340",borderRadius:8,padding:"10px 13px"}}>
                <div style={{fontSize:10,color:"#4499dd",fontWeight:700,letterSpacing:2,marginBottom:7}}>📋 포메이션 메모</div>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                    <span style={{fontSize:10,fontWeight:700,color:"#69f0ae",width:32,flexShrink:0}}>강점</span>
                    <span style={{fontSize:11,color:"#e0f0ff",flex:1}}>{FORMATION_NOTES[formation].강점}</span>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                    <span style={{fontSize:10,fontWeight:700,color:"#ef5350",width:32,flexShrink:0}}>약점</span>
                    <span style={{fontSize:11,color:"#e0f0ff",flex:1}}>{FORMATION_NOTES[formation].약점}</span>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                    <span style={{fontSize:10,fontWeight:700,color:"#ffb84d",width:32,flexShrink:0}}>추천</span>
                    <span style={{fontSize:11,color:"#8899aa",flex:1}}>{FORMATION_NOTES[formation].추천}</span>
                  </div>
                </div>
              </div>
            )}
            {selSlot!==null && (
              <div style={{background:"#0d2a1a",border:"1px solid #1e5a30",borderRadius:6,padding:"7px 12px",fontSize:12,color:"#69f0ae",fontWeight:700}}>
                📌 슬롯 {selSlot+1} ({slots[selSlot]?.p}) — 오른쪽에서 선수를 클릭하세요
              </div>
            )}
            <Pitch formation={formation} lineup={lineup} players={players} onSlot={handleSlot} selSlot={selSlot} slotPositions={slotPositions} onDragEnd={handleDragEnd} slotPosOverrides={slotPosOverrides} showZones={showZones} showChannels={showChannels} cardMode={cardMode} abilities={abilities} />
            {/* lineup table */}
            <div style={{...cardStyle}}>
              <div style={{fontSize:10,color:"#4499dd",fontWeight:700,letterSpacing:2,marginBottom:8}}>라인업</div>
              {slots.map((slot,i)=>{
                const pid=lineup[i], p=players.find(x=>x.id===pid)||null, v=p?ovr(p.attrs):null;
                const curPos = slotPosOverrides[i] || slot.p;
                return (
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid #0d2340"}}>
                    {/* Position input */}
                    <input value={curPos}
                      onChange={e=>setSlotPosOverrides(prev=>({...prev,[i]:e.target.value.toUpperCase().slice(0,4)}))}
                      style={{background:"#0d2340",border:"1px solid #1e3a5f",color:"#4499dd",
                        borderRadius:4,padding:"2px 4px",fontFamily:"'Barlow Condensed',sans-serif",
                        fontSize:11,fontWeight:700,width:48,flexShrink:0,textAlign:"center",outline:"none"}}/>
                    {p ? (
                      <>
                        <Avatar photo={p.photo} name={p.name} size={22} ovrVal={v} color={getColor(v)} mode={cardMode} number={p.number} pos={p.pos} />
                        <span style={{flex:1,fontSize:12,fontWeight:700,color:"#e0f0ff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name}</span>
                        <span style={{fontSize:11,fontWeight:700,color:getColor(v),flexShrink:0}}>{v}</span>
                        <button onClick={()=>{const nl=[...lineup];nl[i]=null;setLineup(nl);}} style={{background:"transparent",border:"none",color:"#335577",cursor:"pointer",fontSize:10,flexShrink:0}}>✕</button>
                      </>
                    ) : (
                      <span style={{flex:1,fontSize:11,color:"#335577"}}>미배치</span>
                    )}
                  </div>
                );
              })}
              {lineup.filter(Boolean).length===slots.length && (
                <div style={{marginTop:9,background:"#0d2a1a",borderRadius:5,padding:"6px 10px",fontSize:11,color:"#69f0ae",fontWeight:700,textAlign:"center"}}>
                  ✅ 완성! 평균 OVR: {Math.round(lineup.filter(Boolean).map(pid=>ovr(players.find(p=>p.id===pid)?.attrs||{})).reduce((a,b)=>a+b,0)/slots.length)}
                </div>
              )}
            </div>
            {/* bench */}
            {showBench && (
              <div style={{...cardStyle}}>
                <div style={{fontSize:10,color:"#ffb84d",fontWeight:700,letterSpacing:2,marginBottom:8}}>🪑 벤치 ({bench.length}명)</div>
                {bench.length===0 && <p style={{color:"#335577",fontSize:12}}>오른쪽 선수 목록에서 "벤치+" 버튼으로 후보를 추가하세요</p>}
                {bench.map(pid=>{
                  const p=players.find(x=>x.id===pid);
                  if(!p) return null;
                  const v=ovr(p.attrs);
                  return (
                    <div key={pid} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid #0d2340"}}>
                      <Avatar photo={p.photo} name={p.name} size={22} ovrVal={v} color={getColor(v)} mode={cardMode} number={p.number} pos={p.pos} />
                      <span style={{flex:1,fontSize:12,fontWeight:700,color:"#e0f0ff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name}</span>
                      <span style={{background:"#0d2340",borderRadius:3,padding:"1px 6px",fontSize:10,fontWeight:700,color:"#4499dd",fontFamily:"'Barlow Condensed',sans-serif"}}>{p.pos}</span>
                      <span style={{fontSize:11,fontWeight:700,color:getColor(v),flexShrink:0}}>{v}</span>
                      <button onClick={()=>toggleBench(pid)} style={{background:"transparent",border:"none",color:"#335577",cursor:"pointer",fontSize:10,flexShrink:0}}>✕</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* picker */}
          <div className="best11-picker-col" style={{flex:1,background:"#050f1a",borderLeft:"1px solid #0d2340",display:"flex",flexDirection:"column",overflow:"hidden"}}>
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
                const v=ovr(p.attrs), inL=lineup.includes(p.id), inBench=bench.includes(p.id);
                return (
                  <div key={p.id} onClick={()=>selSlot!==null?assignSlot(p.id):null}
                    style={{display:"flex",alignItems:"center",gap:9,background:inL?"#0d2a1a":inBench?"#241a0a":"#071525",border:inL?"1px solid #1e5a30":inBench?"1px solid #5a3a1a":"1px solid #0d2340",borderRadius:6,padding:"8px 10px",marginBottom:5,cursor:selSlot!==null?"pointer":"default",opacity:inL&&selSlot===null?0.6:1,transition:"all 0.15s"}}>
                    <Avatar photo={p.photo} name={p.name} size={36} ovrVal={v} color={getColor(v)} mode={cardMode} number={p.number} pos={p.pos} />
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:700,color:"#e0f0ff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name}</div>
                      <div style={{fontSize:10,color:"#5577aa"}}>{p.club}</div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:2}}>
                      <div style={{background:"#0d2340",borderRadius:3,padding:"1px 6px",fontSize:11,fontWeight:700,color:"#4499dd",fontFamily:"'Barlow Condensed',sans-serif"}}>{p.pos}</div>
                      <div style={{fontSize:14,fontWeight:900,color:getColor(v),fontFamily:"'Oswald',sans-serif"}}>{v}</div>
                    </div>
                    {inL && <span style={{fontSize:9,color:"#69f0ae",fontWeight:700,flexShrink:0}}>✓</span>}
                    <button onClick={e=>{e.stopPropagation(); toggleBench(p.id);}} style={{background:"transparent",border:`1px solid ${inBench?"#5a3a1a":"#1e3a5f"}`,color:inBench?"#ffb84d":"#5577aa",borderRadius:4,padding:"3px 7px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:10,fontWeight:700,cursor:"pointer",flexShrink:0}}>{inBench?"벤치 제외":"벤치+"}</button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===== MATCH SCHEDULE VIEW ===== */}
      {nav==="경기 일정" && (
        <div className="team-view" style={{flex:1,overflowY:"auto",padding:"16px 24px"}}>
          <div style={{display:"flex",alignItems:"center",marginBottom:16}}>
            <span style={{fontFamily:"'Oswald',sans-serif",fontSize:19,fontWeight:700,letterSpacing:2}}>📅 경기 일정</span>
            <button onClick={startAddMatch} style={{marginLeft:"auto",background:"linear-gradient(135deg,#1e6ba8,#0d4a7a)",border:"none",color:"#fff",borderRadius:5,padding:"7px 16px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer"}}>+ 경기 추가</button>
          </div>
          {addingMatch && (
            <div style={{...cardStyle,border:"1px solid #1e3a5f",marginBottom:16}}>
              <div style={{fontSize:11,color:"#4499dd",fontWeight:700,letterSpacing:1,marginBottom:9}}>새 경기 등록</div>
              <div style={{display:"flex",gap:9,alignItems:"flex-end",flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:130}}>
                  <div style={{fontSize:10,color:"#4477aa",marginBottom:3}}>날짜</div>
                  <input type="date" value={newMatch.date} onChange={e=>setNewMatch(m=>({...m,date:e.target.value}))} style={INPUT} />
                </div>
                <div style={{flex:2,minWidth:150}}>
                  <div style={{fontSize:10,color:"#4477aa",marginBottom:3}}>상대팀</div>
                  <input value={newMatch.opponent} onChange={e=>setNewMatch(m=>({...m,opponent:e.target.value}))} placeholder="예: 안양 유나이티드" style={INPUT} />
                </div>
                <div style={{flex:1,minWidth:100}}>
                  <div style={{fontSize:10,color:"#4477aa",marginBottom:3}}>홈/원정</div>
                  <select value={newMatch.homeAway} onChange={e=>setNewMatch(m=>({...m,homeAway:e.target.value}))} style={INPUT}>
                    <option value="home">홈</option>
                    <option value="away">원정</option>
                  </select>
                </div>
                <div style={{flex:2,minWidth:150}}>
                  <div style={{fontSize:10,color:"#4477aa",marginBottom:3}}>리그/대회 (선택)</div>
                  <input value={newMatch.competition} onChange={e=>setNewMatch(m=>({...m,competition:e.target.value}))} placeholder="예: 사회인리그 3부" style={INPUT} />
                </div>
                <button onClick={saveNewMatch} style={{background:"#1e6ba8",border:"none",color:"#fff",borderRadius:5,padding:"8px 16px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer"}}>저장</button>
                <button onClick={()=>setAddingMatch(false)} style={{background:"#1a2a3a",border:"1px solid #1e3a5f",color:"#8899aa",borderRadius:5,padding:"8px 11px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,cursor:"pointer"}}>취소</button>
              </div>
            </div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {sortedMatches.map(m=>{
              const avgO = matchAvgOvr(m);
              return (
                <div key={m.id} onClick={()=>openMatch(m)}
                  style={{background:"#071525",border:activeMatchId===m.id?"1px solid #2a8ad4":"1px solid #0d2340",borderLeft:`4px solid ${m.homeAway==="home"?"#1e6ba8":"#c0392b"}`,borderRadius:8,padding:"12px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:14}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                      <span style={{fontFamily:"'Oswald',sans-serif",fontSize:15,fontWeight:700}}>vs {m.opponent}</span>
                      <span style={{fontSize:10,fontWeight:700,color:m.homeAway==="home"?"#4499dd":"#ef7a68",background:m.homeAway==="home"?"#0d2340":"#2a1010",borderRadius:3,padding:"2px 7px"}}>{m.homeAway==="home"?"홈":"원정"}</span>
                    </div>
                    <div style={{fontSize:11,color:"#5577aa"}}>{m.date}{m.competition?` · ${m.competition}`:""}</div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:2,flexShrink:0}}>
                    <span style={{fontSize:11,fontWeight:700,color:"#88bbdd"}}>{formationShort(m.formation)}</span>
                    <span style={{fontSize:14,fontWeight:900,color:avgO!=null?getColor(avgO):"#335577",fontFamily:"'Oswald',sans-serif"}}>{avgO!=null?`OVR ${avgO}`:"미배치"}</span>
                  </div>
                  <button onClick={e=>{e.stopPropagation(); handlePrintMatch(m);}} style={{background:"transparent",border:"1px solid #1e3a5f",color:"#88bbdd",borderRadius:5,padding:"5px 9px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,cursor:"pointer",flexShrink:0}}>🖨</button>
                  <button onClick={e=>{e.stopPropagation(); handleShareMatch(m);}} style={{background:"transparent",border:"1px solid #1e3a5f",color:"#88bbdd",borderRadius:5,padding:"5px 9px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,cursor:"pointer",flexShrink:0}}>📤</button>
                  <button onClick={e=>{e.stopPropagation(); delMatch(m.id);}} style={{background:"#2a1010",border:"1px solid #5a1a1a",color:"#cc4444",borderRadius:5,padding:"5px 9px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,cursor:"pointer",flexShrink:0}}>삭제</button>
                </div>
              );
            })}
            {sortedMatches.length===0 && <p style={{color:"#335577",fontSize:12,textAlign:"center",marginTop:20}}>등록된 경기가 없습니다. "+ 경기 추가"로 새 경기를 등록하세요.</p>}
          </div>
        </div>
      )}

      {/* 능력치 관리 모달 */}
      {attrMgrOpen && (
        <div onClick={()=>setAttrMgrOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <datalist id="unit-presets">{UNIT_PRESETS.filter(Boolean).map(u=><option key={u} value={u} />)}</datalist>
          <div onClick={e=>e.stopPropagation()} style={{background:"#0a1a2e",border:"1px solid #1e3a5f",borderRadius:12,width:680,maxWidth:"96vw",maxHeight:"90vh",display:"flex",flexDirection:"column"}}>
            <div style={{display:"flex",alignItems:"center",padding:"14px 18px",borderBottom:"1px solid #1e3a5f"}}>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,fontWeight:700,color:"#4499dd"}}>⚙ 능력치 관리</div>
              <button onClick={()=>setAttrMgrOpen(false)} style={{marginLeft:"auto",background:"transparent",border:"none",color:"#5577aa",fontSize:18,cursor:"pointer"}}>✕</button>
            </div>
            <div style={{padding:"14px 18px",overflowY:"auto"}}>
              <div style={{fontSize:11,color:"#5a7a9a",marginBottom:12,lineHeight:1.6,background:"#071525",border:"1px solid #0d2340",borderRadius:6,padding:"8px 11px"}}>
                이름을 바꾸거나 항목을 삭제해도 <b style={{color:"#88bbdd"}}>기존 선수 데이터는 안전하게 유지</b>됩니다. 단위가 있는 항목은 "기준 최소~최대"와 방향으로 0~100 점수(OVR·색상)를 계산합니다. 단위를 비우면 0~100 점수형입니다.
              </div>
              {groups.map(g=>(
                <div key={g.id} style={{border:"1px solid #0d2340",borderRadius:8,marginBottom:12,overflow:"hidden"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,background:"#0d1b2a",padding:"8px 10px",flexWrap:"wrap"}}>
                    <span style={{fontSize:9,color:"#4a6a8a"}}>그룹</span>
                    <input value={g.name} onChange={e=>renameGroup(g.id,e.target.value)} style={{...INPUT,fontWeight:700,width:150}} />
                    <span style={{fontSize:10,color:"#4a6a8a"}}>{(abilitiesByGroup[g.id]||[]).length}개</span>
                    <button onClick={()=>addAbility(g.id)} style={{marginLeft:"auto",background:"#0d3a24",border:"1px solid #1e5a30",color:"#69f0ae",borderRadius:5,padding:"4px 10px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,fontWeight:700,cursor:"pointer"}}>+ 능력치</button>
                    <button onClick={()=>{ if(window.confirm(`'${g.name}' 그룹을 삭제할까요?\n소속 능력치는 삭제되지 않고 첫 그룹으로 이동합니다.`)) deleteGroup(g.id); }} style={{background:"#2a1010",border:"1px solid #5a1a1a",color:"#cc4444",borderRadius:5,padding:"4px 8px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,cursor:"pointer"}}>그룹 삭제</button>
                  </div>
                  <div style={{padding:"4px 10px 8px"}}>
                    {(abilitiesByGroup[g.id]||[]).map(ab=>(
                      <div key={ab.key} style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",padding:"7px 0",borderBottom:"1px solid #0d2340"}}>
                        <input value={ab.label} onChange={e=>updateAbility(ab.key,{label:e.target.value})} placeholder="이름" style={{...INPUT,width:104}} />
                        <input list="unit-presets" value={ab.unit} onChange={e=>updateAbility(ab.key,{unit:e.target.value})} placeholder="점수" title="단위 (비우면 0~100 점수)" style={{...INPUT,width:60}} />
                        <select value={ab.direction} onChange={e=>updateAbility(ab.key,{direction:e.target.value})} title="좋은 방향" style={{...INPUT,width:98}}>
                          <option value="high">↑ 높을수록</option>
                          <option value="low">↓ 낮을수록</option>
                        </select>
                        <span style={{fontSize:9,color:"#4a6a8a"}}>기준</span>
                        <input type="number" value={ab.min} onChange={e=>updateAbility(ab.key,{min:e.target.value===""?0:Number(e.target.value)})} title="기준 최소" style={{...INPUT,width:52,padding:"5px 4px"}} />
                        <span style={{fontSize:10,color:"#4a6a8a"}}>~</span>
                        <input type="number" value={ab.max} onChange={e=>updateAbility(ab.key,{max:e.target.value===""?100:Number(e.target.value)})} title="기준 최대" style={{...INPUT,width:52,padding:"5px 4px"}} />
                        <select value={ab.group} onChange={e=>updateAbility(ab.key,{group:e.target.value})} title="그룹" style={{...INPUT,width:84}}>
                          {groups.map(gg=><option key={gg.id} value={gg.id}>{gg.name}</option>)}
                        </select>
                        <button onClick={()=>{ if(window.confirm(`'${ab.label}' 능력치를 삭제할까요?\n선수에 입력된 값은 보존됩니다.`)) deleteAbility(ab.key); }} style={{marginLeft:"auto",background:"transparent",border:"1px solid #5a1a1a",color:"#cc4444",borderRadius:5,padding:"4px 8px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,cursor:"pointer"}}>삭제</button>
                      </div>
                    ))}
                    {(abilitiesByGroup[g.id]||[]).length===0 && <div style={{fontSize:11,color:"#335577",padding:"7px 0"}}>능력치 없음 — "+ 능력치"로 추가하세요.</div>}
                  </div>
                </div>
              ))}
              <button onClick={addGroup} style={{background:"#1e3a5f",border:"1px solid #2a5580",color:"#88bbdd",borderRadius:6,padding:"7px 14px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ 그룹 추가</button>
            </div>
            <div style={{padding:"12px 18px",borderTop:"1px solid #1e3a5f",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
              <button onClick={()=>{ if(window.confirm("모든 그룹/능력치를 기본값으로 되돌릴까요?\n선수에 입력된 값 자체는 유지됩니다.")){ setSchema(DEFAULT_SCHEMA); setACat(DEFAULT_SCHEMA.groups[0].id); } }} style={{background:"transparent",border:"1px solid #1e3a5f",color:"#5577aa",borderRadius:5,padding:"7px 12px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:12,cursor:"pointer"}}>기본값 복원</button>
              <button onClick={()=>setAttrMgrOpen(false)} style={{background:"#1e6ba8",border:"none",color:"#fff",borderRadius:5,padding:"8px 22px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer"}}>완료</button>
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
