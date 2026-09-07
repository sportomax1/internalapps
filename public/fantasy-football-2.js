function inferGames(p,year){
 const weekly=(p.stats||[]).filter(s=>num(s.seasonId)===num(year)&&num(s.statSourceId)===0&&num(s.statSplitTypeId)===1&&num(s.scoringPeriodId)>0&&num(s.scoringPeriodId)<=18);
 let played=0;
 for(const s of weekly){
   const x=s.stats||{};
   // Any logged offensive event = played. Include pass attempts/completions, rush attempts,
   // targets/receptions, yards, TDs, INTs and fumbles so zero-yard appearances still count.
   const ids=['0','1','3','4','20','23','24','25','40','41','42','43','53','68','69','70','71','72','73'];
   if(ids.some(k=>Math.abs(num(x[k]))>0)) played++;
 }
 return played;
}
function parse(entry,year,projected=false){
 const p=entry.player||entry.playerPoolEntry?.player||entry, pos=POS[num(p.defaultPositionId)];if(!pos)return null;
 const st=seasonStat(p,year,projected);if(!st||!st.stats)return null;const x=st.stats;
 let age=num(p.age);if(!age&&p.dateOfBirth){let bd=new Date(p.dateOfBirth), now=new Date();age=now.getFullYear()-bd.getFullYear()-((now.getMonth()<bd.getMonth()||(now.getMonth()===bd.getMonth()&&now.getDate()<bd.getDate()))?1:0)}
 const row={id:String(p.id||entry.id),name:p.fullName||p.displayName||'Unknown',age:age||0,pos,team:TEAM[num(st.proTeamId||p.proTeamId)]||'—',teamId:num(st.proTeamId||p.proTeamId),
  gp:inferGames(p,year),passYds:num(x['3']??x['22']),passTD:num(x['4']),ints:num(x['20']),rushAtt:num(x['23']),rushYds:num(x['24']??x['40']),rushTD:num(x['25']),
  rec:num(x['41']??x['53']),recYds:num(x['42']),recTD:num(x['43']),lostFum:num(x['72']),projected,healthPct:null,healthLabel:'Loading…'};
 row.totalTD=row.passTD+row.rushTD+row.recTD;
 row.totalYds=row.passYds+row.rushYds+row.recYds;
 row.turnovers=row.ints+row.lostFum;
 // ESPN standard/non-PPR offense: 1/25 pass yds, 4/pass TD, -2 INT, 1/10 rush+rec yds, 6 rush+rec TD, -2 fumble lost.
 row.fantasy=row.passYds/25+row.passTD*4-row.ints*2+row.rushYds/10+row.rushTD*6+row.recYds/10+row.recTD*6+row.rec*.5-row.lostFum*2;
 row.head=`https://a.espncdn.com/i/headshots/nfl/players/full/${row.id}.png`;row.logo=row.team!=='—'&&row.team!=='FA'?`https://a.espncdn.com/i/teamlogos/nfl/500/${row.team.toLowerCase()}.png`:'';
 return row
}

function ageFromDOB(v){if(!v)return 0;const bd=new Date(v);if(Number.isNaN(bd.getTime()))return 0;const now=new Date();let a=now.getFullYear()-bd.getFullYear();if(now.getMonth()<bd.getMonth()||(now.getMonth()===bd.getMonth()&&now.getDate()<bd.getDate()))a--;return a}
function applySleeperMeta(map,list=players){if(!map)return;const byEspn=new Map(),byName=new Map();for(const [sid,p] of Object.entries(map)){if(p.espn_id)byEspn.set(String(p.espn_id),{...p,sid});if(p.full_name)byName.set(String(p.full_name).toLowerCase(),{...p,sid})}for(const row of list){const m=byEspn.get(String(row.id))||byName.get(String(row.name).toLowerCase());if(!m)continue;row.active=m.active!==false;row.depthOrder=m.depth_chart_order==null?null:num(m.depth_chart_order);row.depthPosition=m.depth_chart_position||m.position||row.pos;row.sleeperId=m.sid;const calc=ageFromDOB(m.birth_date||m.birthDate);if(calc)row.age=calc;else if(m.age)row.age=whole(m.age)}render()}
function seasonRow(id,y){return (seasonData[y]||[]).find(p=>String(p.id)===String(id))||null}
function primaryYards(p){if(!p)return 0;if(p.pos==='QB')return p.passYds;return p.rushYds+p.recYds}
function threeYear(p,metric='fantasy'){const vals=[2023,2024,2025].map(y=>seasonRow(p.id,y)).filter(Boolean).map(r=>metric==='yards'?primaryYards(r):num(r[metric]));return vals.length?whole(vals.reduce((a,b)=>a+b,0)/vals.length):0}
function trend3(p){const a=seasonRow(p.id,2024),b=seasonRow(p.id,2025);if(!a||!b)return null;return whole(b.fantasy-a.fantasy)}
function isVisiblePlayer(p,ignorePos=false){let q=$('#search').value.toLowerCase(),tf=state.team,mp=num($('#minPct').value),hideInactive=$('#hideInactive')?.checked,hideDrafted=$('#hideDrafted')?.checked,draftedOnly=$('#draftedOnly')?.checked;return (ignorePos||state.pos==='ALL'||p.pos===state.pos)&&(tf==='ALL'||p.team===tf)&&p.pct>=mp&&(!hideInactive||p.active!==false)&&(!hideDrafted||!draftedIds.has(p.id))&&(!draftedOnly||draftedIds.has(p.id))&&(!q||`${p.name} ${p.team} ${p.pos}`.toLowerCase().includes(q))}
async function enrichAges(year){
 // Fantasy player-pool payload does not reliably include age. ESPN Core athlete profiles do.
 // Do this after the fast stats render so age lookups never block the main table.
 const queue=players.filter(p=>!p.age);
 let i=0, workers=Math.min(16,queue.length);
 async function worker(){
   while(i<queue.length){
     const p=queue[i++];
     try{
       const u=`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${year}/athletes/${p.id}?lang=en&region=us`;
       calls++; const r=await fetch(u); if(!r.ok) continue; const a=await r.json();
       if(a.age) p.age=num(a.age);
       else if(a.dateOfBirth){let bd=new Date(a.dateOfBirth),d=new Date();p.age=d.getFullYear()-bd.getFullYear()-((d.getMonth()<bd.getMonth()||(d.getMonth()===bd.getMonth()&&d.getDate()<bd.getDate()))?1:0)}
     }catch{}
   }
 }
 await Promise.all(Array.from({length:workers},worker)); render();
}
function healthLabel(pct){if(pct==null)return '—';if(pct>=90)return 'Excellent';if(pct>=80)return 'Good';if(pct>=65)return 'Fair';return 'Risk'}
async function enrichHealth(baseYear=2026){
 const years=[2021,2022,2023,2024,2025], ids=new Set(players.map(p=>p.id));
 const detail=new Map(players.map(p=>[p.id,[]]));
 await Promise.all(years.map(async y=>{
  const filter={players:{filterSlotIds:{value:[0,2,4,6]},limit:1000,sortPercOwned:{sortPriority:1,sortAsc:false},filterStatsForTopScoringPeriodIds:{value:18,additionalValue:[`00${y}`]},filterStatsForSourceIds:{value:[0]}}};
  try{const data=await fetchJson(`${API}/seasons/${y}/segments/0/leaguedefaults/3?scoringPeriodId=0&view=kona_playercard`,filter);for(const e of data.players||[]){const p=e.player||e.playerPoolEntry?.player||e,id=String(p.id||e.id);if(!ids.has(id))continue;const gp=inferGames(p,y),sched=17;detail.get(id)?.push({year:y,gp:whole(gp),sched,pct:Math.min(100,whole(gp/sched*100))})}}catch(e){console.warn('Health history failed for',y,e)}}));
 players.forEach(p=>{const vals=(detail.get(p.id)||[]).sort((a,b)=>a.year-b.year);p.healthYears=vals;const gp=vals.reduce((a,b)=>a+b.gp,0),sched=vals.reduce((a,b)=>a+b.sched,0);p.healthPct=sched?whole(gp/sched*100):null;p.healthLabel=healthLabel(p.healthPct)});render();
}
