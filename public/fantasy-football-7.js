async function loadProjections(){
 let y=2026,want=$('#projPos').value,st=$('#projStatus');st.textContent=`Loading ${y} ESPN projected stats…`;$('#projResults').innerHTML='';
 const filter={players:{filterSlotIds:{value:[0,2,4,6]},limit:1000,sortPercOwned:{sortPriority:1,sortAsc:false},filterStatsForTopScoringPeriodIds:{value:18,additionalValue:["002026","102026"]},filterRanksForScoringPeriodIds:{value:[1]}}};
 try{let data=await fetchJson(`${API}/seasons/${y}/segments/0/leaguedefaults/3?scoringPeriodId=0&view=kona_player_info`,filter),raw=data.players||[];
 let out=[];for(let e of raw){let p=e.player||e.playerPoolEntry?.player||e,pos=POS[num(p.defaultPositionId)];if(!pos||(want!=='ALL'&&pos!==want))continue;let arr=[...(p.stats||[]),...(e.playerPoolEntry?.stats||[])],pr=arr.find(x=>num(x.seasonId)===2026&&(num(x.statSourceId)===1||num(x.statTypeId)===1)&&num(x.statSplitTypeId)===0)||arr.find(x=>num(x.seasonId)===2026&&(num(x.statSourceId)===1||num(x.statTypeId)===1));if(!pr)continue;let x=pr.stats||{},r={id:String(p.id||e.id),name:p.fullName||p.displayName||'Unknown',pos,team:TEAM[num(pr.proTeamId||p.proTeamId)]||'—',passYds:num(x['3']),passTD:num(x['4']),ints:num(x['20']),rushYds:num(x['24']),rushTD:num(x['25']),rec:num(x['41']??x['53']),recYds:num(x['42']),recTD:num(x['43']),fum:num(x['72'])};r.yds=whole(r.passYds+r.rushYds+r.recYds);r.td=whole(r.passTD+r.rushTD+r.recTD);r.rec=whole(r.rec);r.fp=whole(fantasy({...r,lostFum:r.fum}));out.push(r)}
 out.sort((a,b)=>b.fp-a.fp);$('#projResults').innerHTML=out.length?`<div class="projGrid">${out.map(p=>`<article class="projCard"><div class="projHead"><img src="https://a.espncdn.com/i/headshots/nfl/players/full/${p.id}.png" onerror="this.style.visibility='hidden'"><div><b>${p.name}</b><small style="display:block;color:var(--muted)">${p.pos} · ${p.team} · ESPN projection · rounded</small></div></div><div class="projStats"><div><b>${Math.round(p.fp)}</b><small>PROJ FP</small></div><div><b>${fmt(p.yds)}</b><small>PROJ YDS</small></div><div><b>${fmt(p.td)}</b><small>PROJ TD</small></div><div><b>${fmt(p.rec)}</b><small>PROJ REC</small></div></div></article>`).join('')}</div>`:`<div class="empty"><b>No ESPN projection records returned</b>ESPN did not return statSourceId=1 records for this season/filter.</div>`;
 st.textContent=out.length?`${out.length} players with ESPN projected stat records (statSourceId = 1).`:`No projected records found for ${y}.`;
 }catch(e){st.textContent='Projection request failed: '+e.message}
}

function openDataLab(){ $('#dataLabModal').classList.add('open'); }
function apiTestUrl(){
 const p=$('#apiPreset').value,arg=($('#apiArg').value||'').trim(),year=($('#apiYear').value||'2026').trim();
 if(p==='players')return 'https://api.sleeper.app/v1/players/nfl?active=true';
 if(p==='stats')return `https://api.sleeper.com/stats/nfl/${year}?season_type=regular`;
 if(p==='proj')return `https://api.sleeper.com/projections/nfl/${year}?season_type=regular`;
 if(p==='weekproj')return `https://api.sleeper.com/projections/nfl/${year}/${arg||1}?season_type=regular`;
 if(p==='depth')return `https://api.sleeper.com/players/nfl/${(arg||'PHI').toUpperCase()}/depth_chart`;
 if(p==='trending')return 'https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=25';
}
async function runApiTest(){
 const url=apiTestUrl();$('#apiTestStatus').textContent='Loading '+url;$('#apiOutput').textContent='Loading…';
 try{
  const r=await fetch(url,{headers:{accept:'application/json'}}),t=await r.text();
  if(!r.ok)throw Error(`${r.status} ${r.statusText}\n${t.slice(0,1000)}`);
  let parsed;try{parsed=JSON.parse(t)}catch{parsed=t}
  let preview=JSON.stringify(parsed,null,2);
  $('#apiOutput').textContent=preview.length>18000?preview.slice(0,18000)+'\n\n… truncated …':preview;
  const count=Array.isArray(parsed)?parsed.length:(parsed&&typeof parsed==='object'?Object.keys(parsed).length:'');
  $('#apiTestStatus').textContent=`Success${count!==''?' • '+count+' top-level records':''} • ${url}`;
 }catch(e){$('#apiTestStatus').textContent='Request failed';$('#apiOutput').textContent=String(e)}
}
document.addEventListener('click',e=>{
 if(e.target.classList.contains('copyApi')){
  const code=e.target.closest('.apiLine')?.querySelector('code')?.textContent||'';
  navigator.clipboard?.writeText(code);e.target.textContent='Copied';setTimeout(()=>e.target.textContent='Copy',900);
 }
});
$('#dataLabBtn').onclick=openDataLab;
$('#closeDataLab').onclick=()=>$('#dataLabModal').classList.remove('open');
$('#dataLabModal').onclick=e=>{if(e.target.id==='dataLabModal')$('#dataLabModal').classList.remove('open')};
$('#runApiTest').onclick=runApiTest;

$('#exploreBtn').onclick=openLab;$('#closeExplore').onclick=()=>$('#exploreModal').classList.remove('open');$('#exploreModal').onclick=e=>{if(e.target.id==='exploreModal')$('#exploreModal').classList.remove('open')};$('#runDepth').onclick=()=>loadDepth(true);$('#runProj').onclick=loadProjections;$('#depthSearch').oninput=()=>depthData&&renderDepthMatrix(depthData);document.querySelectorAll('[data-depth-mode]').forEach(b=>b.onclick=()=>{depthMode=b.dataset.depthMode;localStorage.setItem('fantasyLensDepthMode',depthMode);depthData&&renderDepthMatrix(depthData)});
