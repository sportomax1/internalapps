
const API='https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const POS={1:'QB',2:'RB',3:'WR',4:'TE'}, TEAM={0:'FA',1:'ATL',2:'BUF',3:'CHI',4:'CIN',5:'CLE',6:'DAL',7:'DEN',8:'DET',9:'GB',10:'TEN',11:'IND',12:'KC',13:'LV',14:'LAR',15:'MIA',16:'MIN',17:'NE',18:'NO',19:'NYG',20:'NYJ',21:'PHI',22:'ARI',23:'PIT',24:'LAC',25:'SF',26:'SEA',27:'TB',28:'WSH',29:'CAR',30:'JAX',33:'BAL',34:'HOU'};
let players=[],calls=0,compareIds=new Set(),healthMap=new Map(),apiLog=[],seasonData={},depthData=null,draftedIds=new Set(JSON.parse(localStorage.getItem('fantasyLensDrafted')||'[]')),currentView=localStorage.getItem('fantasyLensView')||'draft',matrixMetric=localStorage.getItem('fantasyLensMatrixMetric')||'fantasy',matrixRange='5',depthMode=localStorage.getItem('fantasyLensDepthMode')||'grouped',state={pos:'ALL',team:'ALL',sort:'fantasy',dir:-1};
const CACHE_DB='FantasyLensCache',CACHE_VER=1,CACHE_STORE='data';
function openCache(){return new Promise((resolve,reject)=>{const r=indexedDB.open(CACHE_DB,CACHE_VER);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(CACHE_STORE))r.result.createObjectStore(CACHE_STORE)};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function cachePut(key,value){try{const db=await openCache();await new Promise((res,rej)=>{const tx=db.transaction(CACHE_STORE,'readwrite');tx.objectStore(CACHE_STORE).put({value,ts:Date.now()},key);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});db.close()}catch(e){console.warn('cache put failed',e)}}
async function cacheGet(key){try{const db=await openCache(),v=await new Promise((res,rej)=>{const r=db.transaction(CACHE_STORE).objectStore(CACHE_STORE).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});db.close();return v||null}catch(e){return null}}
function finalizePlayers(list){for(const pos of ['QB','RB','WR','TE']){const asc=list.filter(p=>p.pos===pos).sort((a,b)=>a.fantasy-b.fantasy);asc.forEach((p,i)=>p.pct=Math.max(1,Math.round((i+1)/Math.max(1,asc.length)*100)));[...asc].sort((a,b)=>b.fantasy-a.fantasy).forEach((p,i)=>p.posRank=i+1)}const tg={};list.forEach(p=>(tg[p.team]??=[]).push(p));Object.values(tg).forEach(g=>g.sort((a,b)=>b.fantasy-a.fantasy).forEach((p,i)=>p.teamRank=i+1));const tpg={};list.forEach(p=>(tpg[p.team+'|'+p.pos]??=[]).push(p));Object.values(tpg).forEach(g=>g.sort((a,b)=>b.fantasy-a.fantasy).forEach((p,i)=>p.teamPosRank=i+1));return list}
async function fetchSeason(y){
 const projected=y===2026,filter={players:{filterSlotIds:{value:[0,2,4,6]},limit:1000,sortPercOwned:{sortPriority:1,sortAsc:false},filterStatsForTopScoringPeriodIds:{value:18,additionalValue:projected?[`10${y}`,`00${y}`]:[`00${y}`]},filterStatsForSourceIds:{value:[projected?1:0]},filterStatsForSplitTypeIds:{value:[0]}}};
 const url=`${API}/seasons/${y}/segments/0/leaguedefaults/3?scoringPeriodId=0&view=kona_player_info`,data=await fetchJson(url,filter),entries=data.players||[];
 let list=entries.map(e=>parse(e,y,projected)).filter(Boolean).filter(p=>p.passYds||p.rushYds||p.recYds||p.passTD||p.rushTD||p.recTD||p.rushAtt||p.rec);
 if(!list.length)throw Error(`No ${projected?'projection':'actual'} records for ${y}`);
 const statKeys=['passYds','rushYds','recYds','passTD','rushTD','recTD','ints','rec','rushAtt','lostFum','totalYds','totalTD','turnovers'];
 list.forEach(p=>{statKeys.forEach(k=>p[k]=whole(p[k]));p.fantasy=whole(p.fantasy);p.season=y});
 seasonData[y]=finalizePlayers(list);return seasonData[y]
}
async function showSeason(y,preferCache=true){
 let hit=preferCache?await cacheGet('season:'+y):null;
 if(hit?.value){seasonData[y]=hit.value;players=y===2026?seasonData[y]:players;if(y===2026){players.forEach(p=>p.fantasy=whole(fantasy(p)));finalizePlayers(players);if(depthData)applySleeperMeta(depthData,players);renderTeamMenu();$('#search').disabled=false;$('#tablewrap').style.display='block';$('#empty').style.display='none';render()}$('#stamp').textContent=`2026 DRAFT • ${y===2026?'projections':'history'} restored from cache`;return true}return false
}

function scoring(){return{rec:num($('#sRec')?.value??.5),passTD:num($('#sPassTD')?.value??4),passYds:Math.max(1,num($('#sPassYds')?.value??25)),int:num($('#sInt')?.value??-2),td:num($('#sTD')?.value??6),yds:Math.max(1,num($('#sYds')?.value??10)),fum:num($('#sFum')?.value??-2)}}
function fantasy(p){let s=scoring();return p.passYds/s.passYds+p.passTD*s.passTD+p.ints*s.int+(p.rushYds+p.recYds)/s.yds+(p.rushTD+p.recTD)*s.td+p.rec*s.rec+p.lostFum*s.fum}
function percentileStyle(p){let hue=Math.round(Math.max(0,Math.min(100,p))*1.15);return `background:hsl(${hue} 78% 46%);color:${p>55?'#071006':'#fff'}`}
function recalc(){players.forEach(p=>p.fantasy=fantasy(p));for(const pos of ['QB','RB','WR','TE']){let g=players.filter(p=>p.pos===pos).sort((a,b)=>a.fantasy-b.fantasy);g.forEach((p,i)=>p.pct=Math.max(1,Math.round((i+1)/g.length*100)));[...g].sort((a,b)=>b.fantasy-a.fantasy).forEach((p,i)=>p.posRank=i+1)}render()}const $=s=>document.querySelector(s),num=x=>Number(x||0),fmt=x=>Math.round(num(x)).toLocaleString(),whole=x=>Math.round(num(x));
for(let y=new Date().getFullYear();y>=2018;y--)$('#year').insertAdjacentHTML('beforeend',`<option ${y===new Date().getFullYear()?'selected':''}>${y}</option>`);
['ALL','QB','RB','WR','TE'].forEach(p=>$('#positions').insertAdjacentHTML('beforeend',`<button class="btn ${p==='ALL'?'on':''}" data-p="${p}">${p}</button>`));
function prog(t,n){$('#progress').style.display='block';$('#phase').textContent=t;$('#pct').textContent=n+'%';$('#bar').style.width=n+'%'}
async function fetchJson(url,filter){calls++;let started=new Date().toISOString(),r,text;try{r=await fetch(url,{headers:{'x-fantasy-filter':JSON.stringify(filter),'accept':'application/json'}});text=await r.text();apiLog.unshift({time:started,url,filter,status:r.status,ok:r.ok,preview:text.slice(0,1800)});apiLog=apiLog.slice(0,30);renderApiLog();if(!r.ok)throw Error(`${r.status} ${r.statusText}\n${text.slice(0,700)}`);try{return JSON.parse(text)}catch{throw Error('ESPN returned non-JSON data')}}catch(e){if(!r){apiLog.unshift({time:started,url,filter,status:'FETCH ERROR',ok:false,preview:String(e)});apiLog=apiLog.slice(0,30);renderApiLog()}throw e}}
function seasonStat(p,year,projected=false){
 const arr=[...(p.stats||[]),...(p.playerPoolEntry?.stats||[])];
 const source=projected?1:0;
 let exact=arr.find(s=>num(s.seasonId)===num(year)&&num(s.statSourceId)===source&&num(s.statSplitTypeId)===0);
 if(exact)return exact;
 return arr.find(s=>num(s.seasonId)===num(year)&&num(s.statSourceId)===source)||null;
}
