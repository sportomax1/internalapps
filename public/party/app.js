// ─────────────────────────────────────────────────────────────────────────────
// Party Prompt — SPA app.js
// Replace SUPABASE_URL and SUPABASE_ANON_KEY with your project values.
// ─────────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG — fill these in after creating your Supabase project
// ═══════════════════════════════════════════════════════════════════════════════
const SUPABASE_URL      = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

// ═══════════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════════
const { createClient } = window.supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ═══════════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════════
let me        = null;   // Supabase auth user
let profile   = null;   // profiles row
let activeChannel = null; // current Realtime channel

function setGame(id)  { if (id) sessionStorage.setItem('gid', id); }
function getGame()    { return sessionStorage.getItem('gid'); }
function clearGame()  { sessionStorage.removeItem('gid'); }

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════════════════
const ROUTES = {
  '#auth':    renderAuth,
  '#profile': renderProfile,
  '#home':    renderHome,
  '#create':  renderCreate,
  '#join':    renderJoin,
  '#lobby':   renderLobby,
  '#answer':  renderAnswer,
  '#vote':    renderVote,
  '#results': renderResults,
  '#final':   renderFinal,
  '#stats':   renderStats,
  '#history': renderHistory,
  '#game':    renderGameDetail,
};

async function navigate(hash) {
  // Tear down any active Realtime subscription
  if (activeChannel) {
    await sb.removeChannel(activeChannel);
    activeChannel = null;
  }
  const fn = ROUTES[hash] || ROUTES['#home'];
  try { await fn(); }
  catch (e) {
    console.error('Route error:', e);
    render(`<div class="screen"><div class="empty-state">Something went wrong.<br><br>
      <button class="btn btn-primary" onclick="navigate('#home')">Go Home</button></div></div>`);
  }
}

function render(html) { document.getElementById('app').innerHTML = html; }

window.addEventListener('hashchange', () => navigate(location.hash));

// ═══════════════════════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════════════════════
function toast(msg, type = '') {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast${type ? ' ' + type : ''}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function timeLeft(votingStartedAt) {
  if (!votingStartedAt) return null;
  const ms = 24 * 60 * 60 * 1000 - (Date.now() - new Date(votingStartedAt).getTime());
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m remaining`;
  return `${m}m remaining`;
}

function phaseLabel(phase, round) {
  const labels = { lobby: 'Lobby', answering: `Round ${round} — Answering`,
    voting: `Round ${round} — Voting`, results: `Round ${round} — Results`, complete: 'Finished' };
  return labels[phase] || phase;
}

async function getToken() {
  const { data: { session } } = await sb.auth.getSession();
  return session?.access_token ?? '';
}

async function callAPI(path, body) {
  const token = await getToken();
  const res = await fetch(path, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body:    JSON.stringify(body),
  });
  return res.json();
}

async function checkProfanity(text) {
  try {
    const r = await fetch('/api/party/filter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const d = await r.json();
    return d.blocked === true;
  } catch { return false; }
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════════
async function renderAuth() {
  render(`
    <div class="full-center">
      <div class="auth-card">
        <div class="auth-logo">Party Prompt</div>
        <div class="auth-tagline">The async party game for everyone 🎉</div>
        <div class="card">
          <div class="tab-bar" style="margin-bottom:20px">
            <button class="tab-btn active" onclick="showAuthTab('signin',this)">Sign In</button>
            <button class="tab-btn" onclick="showAuthTab('signup',this)">Sign Up</button>
          </div>
          <form id="signin-form" onsubmit="handleSignIn(event)">
            <div class="field"><label>Email</label>
              <input id="si-email" type="email" placeholder="you@example.com" required autocomplete="email"></div>
            <div class="field mt-12"><label>Password</label>
              <input id="si-pass" type="password" placeholder="Password" required autocomplete="current-password"></div>
            <div id="auth-err" class="error-box mt-12 hidden"></div>
            <button class="btn btn-primary mt-16" type="submit" id="si-btn">Sign In</button>
          </form>
          <form id="signup-form" class="hidden" onsubmit="handleSignUp(event)">
            <div class="field"><label>Email</label>
              <input id="su-email" type="email" placeholder="you@example.com" required autocomplete="email"></div>
            <div class="field mt-12"><label>Password</label>
              <input id="su-pass" type="password" placeholder="Min 6 characters" required autocomplete="new-password"></div>
            <div id="su-err" class="error-box mt-12 hidden"></div>
            <button class="btn btn-primary mt-16" type="submit" id="su-btn">Create Account</button>
          </form>
        </div>
      </div>
    </div>`);
}

window.showAuthTab = function(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('signin-form').classList.toggle('hidden', tab !== 'signin');
  document.getElementById('signup-form').classList.toggle('hidden', tab !== 'signup');
};

window.handleSignIn = async function(e) {
  e.preventDefault();
  const btn = document.getElementById('si-btn');
  const err = document.getElementById('auth-err');
  btn.disabled = true; btn.textContent = 'Signing in…';
  err.classList.add('hidden');
  const { error } = await sb.auth.signInWithPassword({
    email:    document.getElementById('si-email').value.trim(),
    password: document.getElementById('si-pass').value,
  });
  if (error) {
    err.textContent = error.message;
    err.classList.remove('hidden');
    btn.disabled = false; btn.textContent = 'Sign In';
  }
  // onAuthStateChange handles redirect
};

window.handleSignUp = async function(e) {
  e.preventDefault();
  const btn = document.getElementById('su-btn');
  const err = document.getElementById('su-err');
  btn.disabled = true; btn.textContent = 'Creating account…';
  err.classList.add('hidden');
  const { error } = await sb.auth.signUp({
    email:    document.getElementById('su-email').value.trim(),
    password: document.getElementById('su-pass').value,
  });
  if (error) {
    err.textContent = error.message;
    err.classList.remove('hidden');
    btn.disabled = false; btn.textContent = 'Create Account';
  } else {
    toast('Account created! Check your email to confirm, then sign in.', 'success');
    btn.disabled = false; btn.textContent = 'Create Account';
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE SETUP
// ═══════════════════════════════════════════════════════════════════════════════
async function renderProfile() {
  render(`
    <div class="full-center">
      <div class="auth-card">
        <div class="auth-logo">Party Prompt</div>
        <div class="auth-tagline">Choose your display name</div>
        <div class="card">
          <form onsubmit="handleSaveProfile(event)">
            <div class="field"><label>Nickname</label>
              <input id="nickname" type="text" placeholder="e.g. FunnyMike" maxlength="24" required autocomplete="off"></div>
            <div id="prof-err" class="error-box mt-12 hidden"></div>
            <button class="btn btn-primary mt-16" type="submit" id="prof-btn">Let's Play!</button>
          </form>
        </div>
      </div>
    </div>`);
}

window.handleSaveProfile = async function(e) {
  e.preventDefault();
  const btn = document.getElementById('prof-btn');
  const err = document.getElementById('prof-err');
  const nickname = document.getElementById('nickname').value.trim();
  btn.disabled = true; btn.textContent = 'Saving…';
  err.classList.add('hidden');

  const blocked = await checkProfanity(nickname);
  if (blocked) {
    err.textContent = 'Keep it family-friendly 🙂 Try another name.';
    err.classList.remove('hidden');
    btn.disabled = false; btn.textContent = "Let's Play!";
    return;
  }

  const { error } = await sb.from('profiles').insert({ id: me.id, nickname });
  if (error) {
    err.textContent = error.code === '23505' ? 'That nickname is taken.' : error.message;
    err.classList.remove('hidden');
    btn.disabled = false; btn.textContent = "Let's Play!";
    return;
  }
  profile = { id: me.id, nickname };
  location.hash = '#home';
};

// ═══════════════════════════════════════════════════════════════════════════════
// HOME DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
async function renderHome() {
  if (!me || !profile) return location.hash = '#auth';

  render(`<div class="screen">
    <div class="app-header">
      <h2>Party Prompt</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="text-muted text-sm">${esc(profile.nickname)}</span>
        <button class="btn btn-ghost btn-sm" onclick="handleSignOut()">Sign Out</button>
      </div>
    </div>
    <div class="btn-group mt-8">
      <button class="btn btn-primary" onclick="location.hash='#create'">+ New Game</button>
      <button class="btn btn-ghost" onclick="location.hash='#join'">Join with Code</button>
    </div>
    <div id="games-list"><div class="spinner"></div></div>
    <div class="divider mt-16"></div>
    <button class="btn btn-ghost" onclick="location.hash='#stats'">My Stats</button>
    <button class="btn btn-ghost mt-8" onclick="location.hash='#history'">Game History</button>
  </div>`);

  await loadHomeGames();

  // Realtime: watch my game_players rows for phase changes
  activeChannel = sb.channel('home-games')
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'games',
    }, () => loadHomeGames())
    .subscribe();
}

async function loadHomeGames() {
  const container = document.getElementById('games-list');
  if (!container) return;

  // Get all games the user is in (active player)
  const { data: myPlayers } = await sb
    .from('game_players')
    .select('game_id, score')
    .eq('user_id', me.id)
    .eq('status', 'active');

  if (!myPlayers?.length) {
    container.innerHTML = `<div class="empty-state mt-16">No active games.<br>Start or join one above!</div>`;
    return;
  }

  const gameIds = myPlayers.map(p => p.game_id);

  const { data: games } = await sb
    .from('games')
    .select('*')
    .in('id', gameIds)
    .order('created_at', { ascending: false });

  const { data: allPlayers } = await sb
    .from('game_players')
    .select('game_id, user_id, nickname_snapshot, status')
    .in('game_id', gameIds)
    .eq('status', 'active');

  // Determine user turn status for each game
  const yourTurn = [], waiting = [], voting = [], results = [], completed = [];

  for (const g of games ?? []) {
    const gamePlayers = (allPlayers ?? []).filter(p => p.game_id === g.id);
    const ctx = { game: g, players: gamePlayers };

    if (g.status === 'completed' || g.status === 'ended' || g.current_phase === 'complete') {
      completed.push(ctx); continue;
    }
    if (g.status === 'lobby') { waiting.push(ctx); continue; }

    if (g.current_phase === 'answering') {
      const myStatus = await getMyAnswerStatus(g);
      myStatus ? waiting.push(ctx) : yourTurn.push(ctx);
    } else if (g.current_phase === 'voting') {
      const myStatus = await getMyVoteStatus(g);
      myStatus ? waiting.push(ctx) : voting.push(ctx);
    } else if (g.current_phase === 'results') {
      results.push(ctx);
    } else {
      waiting.push(ctx);
    }
  }

  let html = '';
  if (yourTurn.length) {
    html += `<div class="section-label">Your Turn</div>`;
    yourTurn.forEach(c => { html += gameCard(c.game, c.players, 'your-turn'); });
  }
  if (voting.length) {
    html += `<div class="section-label">Vote Now</div>`;
    voting.forEach(c => { html += gameCard(c.game, c.players, 'vote'); });
  }
  if (results.length) {
    html += `<div class="section-label">New Results</div>`;
    results.forEach(c => { html += gameCard(c.game, c.players, 'results'); });
  }
  if (waiting.length) {
    html += `<div class="section-label">Waiting</div>`;
    waiting.forEach(c => { html += gameCard(c.game, c.players, 'waiting'); });
  }
  if (completed.length) {
    html += `<div class="section-label">Completed</div>`;
    completed.forEach(c => { html += gameCard(c.game, c.players, 'done'); });
  }

  if (!html) html = `<div class="empty-state mt-16">No active games. Start or join one above!</div>`;
  container.innerHTML = html;
}

async function getMyAnswerStatus(game) {
  // Returns true if I have answered ALL my assigned prompts for this round
  const { data: myAssignments } = await sb
    .from('player_round_prompts')
    .select('round_prompt_id')
    .eq('user_id', me.id)
    .eq('game_id', game.id);

  if (!myAssignments?.length) return true;

  // Check which round_prompts belong to current round
  const rpIds = myAssignments.map(a => a.round_prompt_id);
  const { data: rps } = await sb
    .from('round_prompts')
    .select('id')
    .in('id', rpIds)
    .eq('round_number', game.current_round);

  if (!rps?.length) return true;
  const currentRpIds = rps.map(r => r.id);

  const { data: answers } = await sb
    .from('answers')
    .select('round_prompt_id')
    .in('round_prompt_id', currentRpIds)
    .eq('user_id', me.id);

  return (answers?.length ?? 0) >= currentRpIds.length;
}

async function getMyVoteStatus(game) {
  // Returns true if I have completed voting for this round
  const { data: rps } = await sb
    .from('round_prompts')
    .select('id')
    .eq('game_id', game.id)
    .eq('round_number', game.current_round);

  const rpIds = (rps ?? []).map(r => r.id);
  if (!rpIds.length) return true;

  if (game.current_round < 3) {
    const { data: votes } = await sb
      .from('votes')
      .select('id')
      .in('round_prompt_id', rpIds)
      .eq('voter_user_id', me.id)
      .eq('vote_type', 'standard');
    // Check if voted on all voteable prompts (simplified: has any vote = partially done)
    return (votes?.length ?? 0) >= rpIds.length;
  } else {
    const { data: collVote } = await sb.from('votes').select('id')
      .in('round_prompt_id', rpIds).eq('voter_user_id', me.id).eq('vote_type', 'finale_collection');
    const { data: wordVote } = await sb.from('votes').select('id')
      .in('round_prompt_id', rpIds).eq('voter_user_id', me.id).eq('vote_type', 'finale_word');
    return (collVote?.length ?? 0) > 0 && (wordVote?.length ?? 0) > 0;
  }
}

function gameCard(game, players, type) {
  const statusMap = {
    'your-turn': '<span class="badge badge-green">Your Turn</span>',
    'vote':      '<span class="badge badge-yellow">Vote Now</span>',
    'results':   '<span class="badge badge-purple">Results</span>',
    'waiting':   '<span class="badge badge-muted">Waiting</span>',
    'done':      '<span class="badge badge-muted">Done</span>',
  };
  const action = type === 'done' ? 'View results →' : 'Open →';
  return `<div class="game-card" onclick="openGame('${esc(game.id)}')">
    <div class="game-card-header">
      <span class="game-card-code">${esc(game.room_code)}</span>
      ${statusMap[type] ?? ''}
    </div>
    <div class="game-card-meta">${esc(phaseLabel(game.current_phase, game.current_round))} · ${players.length} players</div>
    <div class="game-card-action">${action}</div>
  </div>`;
}

window.openGame = async function(gameId) {
  setGame(gameId);
  const { data: game } = await sb.from('games').select('*').eq('id', gameId).single();
  if (!game) return toast('Game not found.', 'error');

  if (game.status === 'lobby') location.hash = '#lobby';
  else if (game.current_phase === 'answering') location.hash = '#answer';
  else if (game.current_phase === 'voting')    location.hash = '#vote';
  else if (game.current_phase === 'results')   location.hash = '#results';
  else if (game.current_phase === 'complete' || game.status === 'completed') location.hash = '#final';
  else location.hash = '#lobby';
};

window.handleSignOut = async function() {
  clearGame();
  await sb.auth.signOut();
};

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE GAME
// ═══════════════════════════════════════════════════════════════════════════════
async function renderCreate() {
  if (!me || !profile) return location.hash = '#auth';
  const code = generateRoomCode();
  render(`
    <div class="screen">
      <div class="app-header">
        <button class="btn btn-ghost btn-sm" onclick="location.hash='#home'">← Back</button>
        <h2>New Game</h2><div></div>
      </div>
      <div class="card mt-16">
        <p class="text-muted text-sm" style="margin-bottom:12px">Your room code:</p>
        <div class="room-code-display">${esc(code)}</div>
        <div class="room-code-hint">Share this with friends to join</div>
      </div>
      <div class="info-box mt-12">3–8 players. You'll start the game once everyone joins.</div>
      <button class="btn btn-primary mt-16" onclick="handleCreateGame('${esc(code)}')">Create Game</button>
    </div>`);
}

window.handleCreateGame = async function(code) {
  const btn = event.target;
  btn.disabled = true; btn.textContent = 'Creating…';

  const { data: game, error: gErr } = await sb
    .from('games')
    .insert({ room_code: code, host_user_id: me.id })
    .select()
    .single();

  if (gErr) { toast(gErr.message, 'error'); btn.disabled = false; btn.textContent = 'Create Game'; return; }

  const { error: pErr } = await sb.from('game_players').insert({
    game_id: game.id, user_id: me.id,
    nickname_snapshot: profile.nickname, role: 'host',
  });

  if (pErr) { toast(pErr.message, 'error'); btn.disabled = false; btn.textContent = 'Create Game'; return; }

  setGame(game.id);
  location.hash = '#lobby';
};

// ═══════════════════════════════════════════════════════════════════════════════
// JOIN GAME
// ═══════════════════════════════════════════════════════════════════════════════
async function renderJoin() {
  if (!me || !profile) return location.hash = '#auth';
  render(`
    <div class="screen">
      <div class="app-header">
        <button class="btn btn-ghost btn-sm" onclick="location.hash='#home'">← Back</button>
        <h2>Join Game</h2><div></div>
      </div>
      <div class="card mt-16">
        <div class="field">
          <label>Room Code</label>
          <input id="room-code" type="text" placeholder="A7K9Q2" maxlength="6"
            style="text-transform:uppercase;letter-spacing:4px;font-family:monospace;font-size:1.3rem;text-align:center"
            oninput="this.value=this.value.toUpperCase()" autocomplete="off">
        </div>
        <div id="join-err" class="error-box mt-12 hidden"></div>
        <button class="btn btn-primary mt-16" onclick="handleJoinGame()">Join Game</button>
      </div>
    </div>`);
  document.getElementById('room-code').focus();
}

window.handleJoinGame = async function() {
  const code = document.getElementById('room-code').value.trim().toUpperCase();
  const err  = document.getElementById('join-err');
  const btn  = document.querySelector('.btn-primary');
  err.classList.add('hidden');

  if (code.length !== 6) { err.textContent = 'Enter a 6-character room code.'; err.classList.remove('hidden'); return; }

  btn.disabled = true; btn.textContent = 'Joining…';

  const { data: game } = await sb.from('games').select('id, status').eq('room_code', code).single();
  if (!game) { err.textContent = 'No game found with that code.'; err.classList.remove('hidden'); btn.disabled = false; btn.textContent = 'Join Game'; return; }
  if (game.status !== 'lobby') { err.textContent = 'This game has already started.'; err.classList.remove('hidden'); btn.disabled = false; btn.textContent = 'Join Game'; return; }

  // Check player count
  const { data: players } = await sb.from('game_players').select('id').eq('game_id', game.id).eq('status', 'active');
  if ((players?.length ?? 0) >= 8) { err.textContent = 'This game is full (max 8 players).'; err.classList.remove('hidden'); btn.disabled = false; btn.textContent = 'Join Game'; return; }

  // Check not already in
  const { data: existing } = await sb.from('game_players').select('id').eq('game_id', game.id).eq('user_id', me.id).single();
  if (existing) { setGame(game.id); location.hash = '#lobby'; return; }

  const { error } = await sb.from('game_players').insert({
    game_id: game.id, user_id: me.id,
    nickname_snapshot: profile.nickname, role: 'player',
  });

  if (error) { err.textContent = error.message; err.classList.remove('hidden'); btn.disabled = false; btn.textContent = 'Join Game'; return; }

  setGame(game.id);
  location.hash = '#lobby';
};

// ═══════════════════════════════════════════════════════════════════════════════
// LOBBY
// ═══════════════════════════════════════════════════════════════════════════════
async function renderLobby() {
  if (!me || !profile) return location.hash = '#auth';
  const gameId = getGame();
  if (!gameId) return location.hash = '#home';

  const { data: game } = await sb.from('games').select('*').eq('id', gameId).single();
  if (!game) return location.hash = '#home';

  // If game started, redirect to appropriate view
  if (game.status === 'active') return openGame(gameId);
  if (game.status === 'completed') return location.hash = '#final';

  await drawLobby(game);

  activeChannel = sb.channel(`lobby-${gameId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'game_players',
      filter: `game_id=eq.${gameId}`,
    }, () => drawLobby())
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'games',
      filter: `id=eq.${gameId}`,
    }, async (payload) => {
      if (payload.new.status === 'active') return openGame(gameId);
    })
    .subscribe();
}

async function drawLobby(gameOverride) {
  const gameId = getGame();
  const { data: game } = gameOverride
    ? { data: gameOverride }
    : await sb.from('games').select('*').eq('id', gameId).single();

  const { data: players } = await sb
    .from('game_players').select('user_id, nickname_snapshot, role, status')
    .eq('game_id', gameId).eq('status', 'active');

  const isHost  = game.host_user_id === me.id;
  const N       = players?.length ?? 0;
  const canStart = N >= 3;

  let playerRows = (players ?? []).map(p => `
    <div class="player-row">
      <div>
        <span class="player-name">${esc(p.nickname_snapshot)}</span>
        ${p.user_id === me.id ? ' <span class="text-muted text-sm">(you)</span>' : ''}
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        ${p.role === 'host' ? '<span class="player-host-tag">HOST</span>' : ''}
        ${isHost && p.user_id !== me.id
          ? `<button class="btn btn-danger btn-sm" onclick="removePlayer('${esc(p.user_id)}')">Remove</button>`
          : ''}
      </div>
    </div>`).join('');

  const hostControls = isHost ? `
    <div class="mt-16">
      ${!canStart ? `<div class="info-box mt-8">Need at least 3 players to start (${N}/3).</div>` : ''}
      <button class="btn btn-green mt-12" ${canStart ? '' : 'disabled'} onclick="handleStartGame()">
        Start Game (${N} players)
      </button>
    </div>` : `<div class="info-box mt-16">Waiting for host to start the game…</div>`;

  const html = `
    <div class="screen">
      <div class="app-header">
        <button class="btn btn-ghost btn-sm" onclick="location.hash='#home'">← Home</button>
        <h2>Lobby</h2><div></div>
      </div>
      <div class="card">
        <div class="text-muted text-sm" style="margin-bottom:8px">Room Code</div>
        <div class="room-code-display" onclick="copyCode('${esc(game.room_code)}')">${esc(game.room_code)}</div>
        <div class="room-code-hint">Tap to copy · Share with friends</div>
      </div>
      <div class="section-label mt-16">Players (${N}/8)</div>
      <div class="player-list">${playerRows}</div>
      ${hostControls}
    </div>`;

  const existing = document.getElementById('app');
  // Only re-render if we're still on the lobby view (avoid overwriting other views)
  if (location.hash === '#lobby') render(html);
}

window.copyCode = function(code) {
  navigator.clipboard?.writeText(code).then(() => toast('Room code copied!', 'success'));
};

window.handleStartGame = async function() {
  const btn = event.target;
  btn.disabled = true; btn.textContent = 'Starting…';
  const r = await callAPI('/api/party/start', { game_id: getGame() });
  if (!r.ok) { toast(r.error || 'Failed to start.', 'error'); btn.disabled = false; btn.textContent = 'Start Game'; }
  // Realtime will trigger redirect
};

window.removePlayer = async function(userId) {
  if (!confirm('Remove this player?')) return;
  const gameId = getGame();
  await sb.from('game_players').update({ status: 'removed' }).eq('game_id', gameId).eq('user_id', userId);
  await sb.from('game_events').insert({
    game_id: gameId, actor_user_id: me.id,
    event_type: 'remove_player', event_details: { removed_user_id: userId },
  });
};

// ═══════════════════════════════════════════════════════════════════════════════
// ANSWER PHASE
// ═══════════════════════════════════════════════════════════════════════════════
async function renderAnswer() {
  if (!me || !profile) return location.hash = '#auth';
  const gameId = getGame();
  if (!gameId) return location.hash = '#home';

  const { data: game } = await sb.from('games').select('*').eq('id', gameId).single();
  if (!game || game.current_phase !== 'answering') return openGame(gameId);

  const isFinale = game.current_round === 3;

  // Get my assigned prompts for this round
  const { data: myAssignments } = await sb
    .from('player_round_prompts')
    .select('round_prompt_id')
    .eq('user_id', me.id)
    .eq('game_id', gameId);

  if (!myAssignments?.length) {
    render(`<div class="screen"><div class="app-header"><button class="btn btn-ghost btn-sm" onclick="location.hash='#home'">← Home</button><h2>Waiting</h2><div></div></div>
      <div class="info-box mt-16">You have no prompts assigned for this round.</div></div>`);
    return;
  }

  const rpIds = myAssignments.map(a => a.round_prompt_id);

  // Filter to current round
  const { data: roundPrompts } = await sb
    .from('round_prompts')
    .select('id, prompt_id')
    .in('id', rpIds)
    .eq('round_number', game.current_round);

  if (!roundPrompts?.length) {
    render(`<div class="screen"><div class="info-box mt-16">Waiting for round to begin…</div></div>`);
    return;
  }

  const promptIds = roundPrompts.map(rp => rp.prompt_id);
  const { data: prompts } = await sb.from('prompts').select('id, prompt_text').in('id', promptIds);

  // Existing answers
  const { data: existingAnswers } = await sb
    .from('answers').select('round_prompt_id, answer_text, word_1, word_2, word_3')
    .in('round_prompt_id', roundPrompts.map(rp => rp.id))
    .eq('user_id', me.id);

  const answerMap = {};
  (existingAnswers ?? []).forEach(a => { answerMap[a.round_prompt_id] = a; });

  const promptLookup = {};
  (prompts ?? []).forEach(p => { promptLookup[p.id] = p; });

  // Count active players
  const { data: allPlayers } = await sb.from('game_players').select('user_id').eq('game_id', gameId).eq('status', 'active');
  const N = allPlayers?.length ?? 0;

  // Count answers submitted by all players for this round
  const { data: allAnswers } = await sb.from('answers').select('user_id').in('round_prompt_id', roundPrompts.map(r => r.id));
  const { data: allAssignments } = await sb.from('player_round_prompts').select('user_id').in('round_prompt_id', roundPrompts.map(r => r.id));
  const totalExpected = allAssignments?.length ?? 0;
  const totalAnswered = allAnswers?.length ?? 0;

  let promptsHtml = '';
  for (const rp of roundPrompts) {
    const prompt = promptLookup[rp.prompt_id];
    const existing = answerMap[rp.id];

    if (isFinale) {
      promptsHtml += finalePromptCard(rp.id, prompt?.prompt_text ?? '', existing);
    } else {
      promptsHtml += standardPromptCard(rp.id, prompt?.prompt_text ?? '', existing);
    }
  }

  render(`
    <div class="screen">
      <div class="app-header">
        <button class="btn btn-ghost btn-sm" onclick="location.hash='#home'">← Home</button>
        <h2>${isFinale ? 'Finale Round' : `Round ${game.current_round}`}</h2>
        <div></div>
      </div>
      <div class="round-indicator">
        <span>Round</span>
        <span class="current">${game.current_round} / 3</span>
        <span style="flex:1"></span>
        <span class="text-muted text-sm">${totalAnswered}/${totalExpected} answers in</span>
      </div>
      ${isFinale ? `<div class="info-box">Submit your best 3 words (one word each). They'll be voted on individually and as a set!</div><div style="height:12px"></div>` : ''}
      ${promptsHtml}
    </div>`);

  // Subscribe to answers count updates
  activeChannel = sb.channel(`answer-${gameId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'answers',
      filter: `game_id=eq.${gameId}`,
    }, () => { renderAnswer(); })
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'games',
      filter: `id=eq.${gameId}`,
    }, (payload) => {
      if (payload.new.current_phase === 'voting') location.hash = '#vote';
    })
    .subscribe();
}

function standardPromptCard(rpId, promptText, existing) {
  const submitted = !!existing;
  return `
    <div class="prompt-card" id="pc-${rpId}">
      <div class="prompt-text">${esc(promptText)}</div>
      ${submitted ? `
        <div class="answer-submitted">✓ ${esc(existing.answer_text)}</div>
        <button class="btn btn-ghost btn-sm mt-8" onclick="editAnswer('${rpId}')">Edit</button>
      ` : `
        <textarea id="ans-${rpId}" maxlength="80" placeholder="Your answer…"
          oninput="updateCharCount('${rpId}')"></textarea>
        <div class="char-counter" id="cc-${rpId}">0 / 80</div>
        <button class="btn btn-primary mt-8" onclick="submitAnswer('${rpId}', false)">Submit</button>
      `}
    </div>`;
}

function finalePromptCard(rpId, promptText, existing) {
  const submitted = !!existing;
  return `
    <div class="prompt-card" id="pc-${rpId}">
      <div class="prompt-text">${esc(promptText)}</div>
      ${submitted ? `
        <div class="answer-submitted">✓ ${esc(existing.word_1)} · ${esc(existing.word_2)} · ${esc(existing.word_3)}</div>
        <button class="btn btn-ghost btn-sm mt-8" onclick="editAnswer('${rpId}')">Edit</button>
      ` : `
        <div style="display:flex;flex-direction:column;gap:8px">
          <input id="w1-${rpId}" type="text" maxlength="20" placeholder="Word 1" autocomplete="off">
          <input id="w2-${rpId}" type="text" maxlength="20" placeholder="Word 2" autocomplete="off">
          <input id="w3-${rpId}" type="text" maxlength="20" placeholder="Word 3" autocomplete="off">
        </div>
        <button class="btn btn-primary mt-12" onclick="submitAnswer('${rpId}', true)">Submit 3 Words</button>
      `}
    </div>`;
}

window.updateCharCount = function(rpId) {
  const ta = document.getElementById(`ans-${rpId}`);
  const cc = document.getElementById(`cc-${rpId}`);
  if (!ta || !cc) return;
  const len = ta.value.length;
  cc.textContent = `${len} / 80`;
  cc.className = `char-counter${len > 72 ? ' warn' : ''}${len >= 80 ? ' over' : ''}`;
};

window.editAnswer = function(rpId) {
  // Re-render to show input (simplest approach)
  renderAnswer();
};

window.submitAnswer = async function(rpId, isFinale) {
  const btn = event.target;
  btn.disabled = true; btn.textContent = 'Submitting…';

  let answerData = {};

  if (isFinale) {
    const w1 = document.getElementById(`w1-${rpId}`)?.value.trim();
    const w2 = document.getElementById(`w2-${rpId}`)?.value.trim();
    const w3 = document.getElementById(`w3-${rpId}`)?.value.trim();
    if (!w1 || !w2 || !w3) {
      toast('Enter all three words.', 'error');
      btn.disabled = false; btn.textContent = 'Submit 3 Words'; return;
    }
    const allText = `${w1} ${w2} ${w3}`;
    const blocked = await checkProfanity(allText);
    if (blocked) { toast('Keep it family-friendly 🙂 Try another answer.', 'error'); btn.disabled = false; btn.textContent = 'Submit 3 Words'; return; }
    answerData = { word_1: w1, word_2: w2, word_3: w3 };
  } else {
    const text = document.getElementById(`ans-${rpId}`)?.value.trim();
    if (!text) { toast('Enter an answer.', 'error'); btn.disabled = false; btn.textContent = 'Submit'; return; }
    if (text.length > 80) { toast('Answer too long (max 80 characters).', 'error'); btn.disabled = false; btn.textContent = 'Submit'; return; }
    const blocked = await checkProfanity(text);
    if (blocked) { toast('Keep it family-friendly 🙂 Try another answer.', 'error'); btn.disabled = false; btn.textContent = 'Submit'; return; }
    answerData = { answer_text: text };
  }

  const { error } = await sb.from('answers').upsert({
    game_id: getGame(),
    round_prompt_id: rpId,
    user_id: me.id,
    ...answerData,
    submitted_at: new Date().toISOString(),
  }, { onConflict: 'round_prompt_id,user_id' });

  if (error) { toast(error.message, 'error'); btn.disabled = false; btn.textContent = isFinale ? 'Submit 3 Words' : 'Submit'; return; }

  toast('Answer submitted!', 'success');

  // Check if game should advance
  await callAPI('/api/party/advance', { game_id: getGame() });

  renderAnswer();
};

// ═══════════════════════════════════════════════════════════════════════════════
// VOTING PHASE
// ═══════════════════════════════════════════════════════════════════════════════
async function renderVote() {
  if (!me || !profile) return location.hash = '#auth';
  const gameId = getGame();
  if (!gameId) return location.hash = '#home';

  const { data: game } = await sb.from('games').select('*').eq('id', gameId).single();
  if (!game || game.current_phase !== 'voting') return openGame(gameId);

  const isFinale = game.current_round === 3;

  const { data: rps } = await sb
    .from('round_prompts')
    .select('id, prompt_id')
    .eq('game_id', gameId)
    .eq('round_number', game.current_round);

  const promptIds = (rps ?? []).map(rp => rp.prompt_id);
  const rpIds     = (rps ?? []).map(rp => rp.id);

  const { data: prompts } = await sb.from('prompts').select('id, prompt_text').in('id', promptIds);
  const promptLookup = {};
  (prompts ?? []).forEach(p => { promptLookup[p.id] = p; });

  const { data: answers } = await sb.from('answers').select('*').in('round_prompt_id', rpIds);
  const { data: myVotes } = await sb
    .from('votes').select('*').in('round_prompt_id', rpIds).eq('voter_user_id', me.id);

  const myVoteMap = {};
  (myVotes ?? []).forEach(v => {
    const key = v.vote_type === 'standard' ? v.round_prompt_id : v.vote_type;
    myVoteMap[key] = v;
  });

  const deadline = timeLeft(game.voting_started_at);
  let html = `
    <div class="screen">
      <div class="app-header">
        <button class="btn btn-ghost btn-sm" onclick="location.hash='#home'">← Home</button>
        <h2>${isFinale ? 'Finale Vote' : `Round ${game.current_round} Voting`}</h2>
        <div></div>
      </div>
      ${deadline ? `<div class="info-box" style="margin-bottom:12px">⏰ ${deadline}</div>` : ''}`;

  if (isFinale) {
    html += buildFinaleVoting(rps ?? [], prompts, answers ?? [], myVoteMap);
  } else {
    html += buildStandardVoting(rps ?? [], promptLookup, answers ?? [], myVoteMap);
  }

  html += `</div>`;
  render(html);

  activeChannel = sb.channel(`vote-${gameId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'votes',
      filter: `game_id=eq.${gameId}`,
    }, () => checkAdvance())
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'games',
      filter: `id=eq.${gameId}`,
    }, (payload) => {
      if (payload.new.current_phase === 'results') location.hash = '#results';
    })
    .subscribe();
}

function buildStandardVoting(rps, promptLookup, answers, myVoteMap) {
  let html = '';
  for (const rp of rps) {
    const prompt  = promptLookup[rp.prompt_id] ?? {};
    const opts    = answers.filter(a => a.round_prompt_id === rp.id);
    const myVote  = myVoteMap[rp.id];

    if (opts.length === 0) continue;

    if (opts.length === 1 && opts[0].user_id === me.id) {
      // Only my answer — auto-win, nothing to vote on
      html += `<div class="vote-section"><div class="prompt-text">${esc(prompt.prompt_text)}</div>
        <div class="info-box mt-8">Only your answer was submitted — you win this one by default!</div></div>`;
      continue;
    }

    html += `<div class="vote-section">
      <div class="prompt-text" style="margin-bottom:12px">${esc(prompt.prompt_text)}</div>
      <div class="vote-options">`;

    for (const a of opts) {
      const isMine    = a.user_id === me.id;
      const isVoted   = myVote?.answer_id === a.id;
      html += `<div class="vote-option ${isVoted ? 'selected' : ''} ${isMine ? 'own disabled' : ''}"
        onclick="${isMine ? '' : `castVote('${rp.id}','${a.id}','standard',null,this)`}">
        ${esc(a.answer_text)}
        ${isMine ? '<div class="vote-option-label">Your answer — can\'t vote for yourself</div>' : ''}
        ${isVoted ? '<div class="vote-option-label">✓ Your vote</div>' : ''}
      </div>`;
    }

    html += `</div></div><div class="divider"></div>`;
  }
  return html || `<div class="empty-state">No prompts to vote on.</div>`;
}

function buildFinaleVoting(rps, promptsArr, answers, myVoteMap) {
  const myAnswer = answers.find(a => a.user_id === me.id);
  const myCollVote = myVoteMap['finale_collection'];
  const myWordVote = myVoteMap['finale_word'];

  let html = `<div class="section-label">Best Collection of 3 Words</div>`;

  // Collection vote — vote for another player's full set
  for (const a of answers) {
    if (a.user_id === me.id) continue;
    const isMineRp = myAnswer && a.round_prompt_id === myAnswer.round_prompt_id;
    const isVoted  = myCollVote?.answer_id === a.id;
    html += `<div class="vote-option ${isVoted ? 'selected' : ''}" style="margin-top:8px"
      onclick="castVote('${a.round_prompt_id}','${a.id}','finale_collection',null,this)">
      <strong>${esc(a.word_1)}</strong> · <strong>${esc(a.word_2)}</strong> · <strong>${esc(a.word_3)}</strong>
      ${isVoted ? '<div class="vote-option-label">✓ Your vote</div>' : ''}
    </div>`;
  }

  html += `<div class="divider"></div><div class="section-label">Best Individual Word</div>
    <p class="text-muted text-sm" style="margin-bottom:10px">Pick the single funniest word from all answers.</p>
    <div class="word-grid">`;

  const allWords = [];
  for (const a of answers) {
    for (const w of [a.word_1, a.word_2, a.word_3]) {
      if (w) allWords.push({ word: w, answerId: a.id, rpId: a.round_prompt_id, isMine: a.user_id === me.id });
    }
  }

  for (const wObj of allWords) {
    const isVoted   = myWordVote?.answer_id === wObj.answerId && myWordVote?.selected_word?.toLowerCase() === wObj.word.toLowerCase();
    html += `<div class="word-chip ${isVoted ? 'selected' : ''} ${wObj.isMine ? 'disabled' : ''}"
      ${wObj.isMine ? '' : `onclick="castVote('${wObj.rpId}','${wObj.answerId}','finale_word','${esc(wObj.word)}',this)"`}>
      ${esc(wObj.word)}
    </div>`;
  }

  html += `</div>`;
  return html;
}

window.castVote = async function(rpId, answerId, voteType, selectedWord, el) {
  if (el?.classList.contains('disabled')) return;

  // Optimistic UI
  if (voteType === 'standard') {
    document.querySelectorAll('.vote-option').forEach(o => {
      if (o.closest('.vote-section') === el.closest('.vote-section')) o.classList.remove('selected');
    });
  } else if (voteType === 'finale_collection') {
    document.querySelectorAll('.vote-option').forEach(o => o.classList.remove('selected'));
  } else {
    document.querySelectorAll('.word-chip').forEach(c => c.classList.remove('selected'));
  }
  el?.classList.add('selected');

  const { error } = await sb.from('votes').upsert({
    game_id: getGame(),
    round_prompt_id: rpId,
    voter_user_id: me.id,
    answer_id: answerId,
    vote_type: voteType,
    selected_word: selectedWord ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'round_prompt_id,voter_user_id,vote_type' });

  if (error) { toast(error.message, 'error'); el?.classList.remove('selected'); return; }
  toast('Vote saved! You can change it until voting closes.', 'success');

  // Check if game should auto-advance
  await checkAdvance();
};

async function checkAdvance() {
  await callAPI('/api/party/advance', { game_id: getGame() });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUND RESULTS
// ═══════════════════════════════════════════════════════════════════════════════
async function renderResults() {
  if (!me || !profile) return location.hash = '#auth';
  const gameId = getGame();
  if (!gameId) return location.hash = '#home';

  const { data: game } = await sb.from('games').select('*').eq('id', gameId).single();
  if (!game) return location.hash = '#home';
  if (game.current_phase === 'complete') return location.hash = '#final';

  const isHost = game.host_user_id === me.id;

  const { data: rps } = await sb
    .from('round_prompts').select('id, prompt_id')
    .eq('game_id', gameId).eq('round_number', game.current_round);

  const rpIds     = (rps ?? []).map(r => r.id);
  const promptIds = (rps ?? []).map(r => r.prompt_id);

  const { data: prompts } = await sb.from('prompts').select('id, prompt_text').in('id', promptIds);
  const { data: answers } = await sb.from('answers').select('*, profiles(nickname)').in('round_prompt_id', rpIds);
  const { data: votes }   = await sb.from('votes').select('*').in('round_prompt_id', rpIds);
  const { data: players } = await sb.from('game_players').select('user_id, nickname_snapshot, score').eq('game_id', gameId).eq('status', 'active');

  const promptLookup = {};
  (prompts ?? []).forEach(p => { promptLookup[p.id] = p; });

  let promptsHtml = '';
  for (const rp of rps ?? []) {
    const prompt = promptLookup[rp.prompt_id];
    const opts   = (answers ?? []).filter(a => a.round_prompt_id === rp.id);
    const rpVotes = (votes ?? []).filter(v => v.round_prompt_id === rp.id);

    if (opts.length === 0) continue;

    const voteCounts = {};
    opts.forEach(a => { voteCounts[a.id] = 0; });
    rpVotes.forEach(v => { if (voteCounts[v.answer_id] !== undefined) voteCounts[v.answer_id]++; });

    const maxV = Math.max(...Object.values(voteCounts), 0);
    const sorted = [...opts].sort((a, b) => (voteCounts[b.id] ?? 0) - (voteCounts[a.id] ?? 0));

    promptsHtml += `<div class="card">
      <div class="prompt-text">${esc(prompt?.prompt_text)}</div>
      <div style="margin-top:12px">`;

    for (const a of sorted) {
      const vc  = voteCounts[a.id] ?? 0;
      const top = vc === maxV && maxV > 0;
      const nick = a.profiles?.nickname ?? (players ?? []).find(p => p.user_id === a.user_id)?.nickname_snapshot ?? '?';
      promptsHtml += `<div class="answer-result ${top ? 'top' : ''}">
        <div class="answer-result-text">
          <div>${esc(a.answer_text)}</div>
          <div class="text-muted text-sm mt-4">${esc(nick)} ${top ? '🏆' : ''}</div>
        </div>
        <div class="answer-result-votes">${vc} vote${vc !== 1 ? 's' : ''}</div>
      </div>`;
    }

    promptsHtml += `</div></div>`;
  }

  // Leaderboard
  const sorted = [...(players ?? [])].sort((a, b) => b.score - a.score);
  let leaderboard = '';
  sorted.forEach((p, i) => {
    const isWinner = i === 0 && p.score > 0;
    leaderboard += `<div class="result-row ${isWinner ? 'winner' : ''}">
      <div class="result-rank">${i + 1}</div>
      <div class="result-name">${esc(p.nickname_snapshot)}${p.user_id === me.id ? ' (you)' : ''}</div>
      <div class="result-score">${p.score.toLocaleString()}</div>
    </div>`;
  });

  const nextLabel = game.current_round === 3
    ? 'See Final Results'
    : `Start Round ${game.current_round + 1}`;

  render(`
    <div class="screen">
      <div class="app-header">
        <button class="btn btn-ghost btn-sm" onclick="location.hash='#home'">← Home</button>
        <h2>Round ${game.current_round} Results</h2>
        <div></div>
      </div>
      <div class="section-label">Scores</div>
      ${leaderboard}
      <div class="section-label mt-16">Answers</div>
      ${promptsHtml}
      ${isHost ? `
        <button class="btn btn-green mt-16" onclick="handleAdvanceResults()">
          ${nextLabel} →
        </button>` : `
        <div class="info-box mt-16">Waiting for host to continue…</div>`}
    </div>`);
}

window.handleAdvanceResults = async function() {
  const btn = event.target;
  btn.disabled = true; btn.textContent = 'Loading…';
  const r = await callAPI('/api/party/advance', { game_id: getGame(), force: true });
  if (!r.ok) { toast(r.error || 'Error.', 'error'); btn.disabled = false; return; }
  if (r.phase === 'complete') location.hash = '#final';
  else location.hash = '#answer';
};

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL RESULTS
// ═══════════════════════════════════════════════════════════════════════════════
async function renderFinal() {
  if (!me || !profile) return location.hash = '#auth';
  const gameId = getGame();
  if (!gameId) return location.hash = '#home';

  const { data: players } = await sb
    .from('game_players').select('user_id, nickname_snapshot, score')
    .eq('game_id', gameId).eq('status', 'active');

  const sorted = [...(players ?? [])].sort((a, b) => b.score - a.score);
  const winner = sorted[0];

  let leaderboard = '';
  sorted.forEach((p, i) => {
    leaderboard += `<div class="result-row ${i === 0 ? 'winner' : ''}">
      <div class="result-rank">${i === 0 ? '🏆' : i + 1}</div>
      <div class="result-name">${esc(p.nickname_snapshot)}${p.user_id === me.id ? ' (you)' : ''}</div>
      <div class="result-score">${p.score.toLocaleString()}</div>
    </div>`;
  });

  render(`
    <div class="screen">
      <div class="app-header">
        <button class="btn btn-ghost btn-sm" onclick="location.hash='#home'">← Home</button>
        <h2>Final Results</h2><div></div>
      </div>
      <div class="winner-banner">
        <div class="winner-crown">🏆</div>
        <div class="winner-name">${esc(winner?.nickname_snapshot ?? '?')} wins!</div>
        <div class="winner-score">${winner?.score?.toLocaleString() ?? 0} points</div>
      </div>
      <div class="section-label">Final Standings</div>
      ${leaderboard}
      <button class="btn btn-ghost mt-16" onclick="location.hash='#history'">View Game History</button>
    </div>`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAYER STATS
// ═══════════════════════════════════════════════════════════════════════════════
async function renderStats() {
  if (!me || !profile) return location.hash = '#auth';

  render(`<div class="screen">
    <div class="app-header">
      <button class="btn btn-ghost btn-sm" onclick="location.hash='#home'">← Home</button>
      <h2>My Stats</h2><div></div>
    </div>
    <div class="spinner"></div></div>`);

  // Games played
  const { data: myGames } = await sb.from('game_players').select('game_id, score, role')
    .eq('user_id', me.id).eq('status', 'active');
  const gameIds = (myGames ?? []).map(g => g.game_id);

  const { data: games } = await sb.from('games').select('id, status, current_phase')
    .in('id', gameIds);

  const completedGameIds = (games ?? [])
    .filter(g => g.status === 'completed' || g.current_phase === 'complete')
    .map(g => g.id);

  const gamesPlayed    = gameIds.length;
  const gamesCompleted = completedGameIds.length;
  const scores         = (myGames ?? []).filter(g => completedGameIds.includes(g.game_id)).map(g => g.score);
  const totalPoints    = scores.reduce((s, v) => s + v, 0);
  const avgScore       = scores.length ? Math.round(totalPoints / scores.length) : 0;
  const highScore      = scores.length ? Math.max(...scores) : 0;

  // Wins (finished first in a completed game)
  let wins = 0;
  for (const gid of completedGameIds) {
    const { data: allP } = await sb.from('game_players').select('user_id, score')
      .eq('game_id', gid).eq('status', 'active');
    const sorted = [...(allP ?? [])].sort((a, b) => b.score - a.score);
    if (sorted[0]?.user_id === me.id) wins++;
  }

  // Votes received
  const { data: myAnswers } = await sb.from('answers').select('id').eq('user_id', me.id);
  const answerIds = (myAnswers ?? []).map(a => a.id);
  const { data: votesReceived } = answerIds.length
    ? await sb.from('votes').select('id').in('answer_id', answerIds)
    : { data: [] };

  const totalAnswers = myAnswers?.length ?? 0;
  const totalVotesRx = votesReceived?.length ?? 0;
  const avgVotes     = totalAnswers ? (totalVotesRx / totalAnswers).toFixed(1) : '0';

  // Voting participation
  const { data: myVotes } = await sb.from('votes').select('id').eq('voter_user_id', me.id);

  const winRate = gamesCompleted ? `${Math.round((wins / gamesCompleted) * 100)}%` : '—';

  render(`
    <div class="screen">
      <div class="app-header">
        <button class="btn btn-ghost btn-sm" onclick="location.hash='#home'">← Home</button>
        <h2>My Stats</h2><div></div>
      </div>
      <div class="card mt-8">
        <div style="font-size:1.1rem;font-weight:700">${esc(profile.nickname)}</div>
      </div>
      <div class="stat-grid">
        <div class="stat-cell"><div class="stat-value">${gamesPlayed}</div><div class="stat-label">Games Played</div></div>
        <div class="stat-cell"><div class="stat-value">${gamesCompleted}</div><div class="stat-label">Completed</div></div>
        <div class="stat-cell"><div class="stat-value">${wins}</div><div class="stat-label">Wins</div></div>
        <div class="stat-cell"><div class="stat-value">${winRate}</div><div class="stat-label">Win Rate</div></div>
        <div class="stat-cell"><div class="stat-value">${totalPoints.toLocaleString()}</div><div class="stat-label">Total Points</div></div>
        <div class="stat-cell"><div class="stat-value">${avgScore.toLocaleString()}</div><div class="stat-label">Avg Score</div></div>
        <div class="stat-cell"><div class="stat-value">${highScore.toLocaleString()}</div><div class="stat-label">Best Score</div></div>
        <div class="stat-cell"><div class="stat-value">${totalVotesRx}</div><div class="stat-label">Votes Received</div></div>
        <div class="stat-cell"><div class="stat-value">${avgVotes}</div><div class="stat-label">Avg Votes/Answer</div></div>
        <div class="stat-cell"><div class="stat-value">${totalAnswers}</div><div class="stat-label">Answers Submitted</div></div>
        <div class="stat-cell"><div class="stat-value">${myVotes?.length ?? 0}</div><div class="stat-label">Votes Cast</div></div>
        <div class="stat-cell"><div class="stat-value">${gamesCompleted === 0 ? '—' : `${Math.round((wins/gamesCompleted)*100)}%`}</div><div class="stat-label">Win Rate</div></div>
      </div>
    </div>`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// GAME HISTORY
// ═══════════════════════════════════════════════════════════════════════════════
async function renderHistory() {
  if (!me || !profile) return location.hash = '#auth';

  const { data: myGames } = await sb.from('game_players').select('game_id, score')
    .eq('user_id', me.id).eq('status', 'active');
  const gameIds = (myGames ?? []).map(g => g.game_id);

  const { data: games } = await sb.from('games')
    .select('*').in('id', gameIds)
    .in('status', ['completed', 'ended'])
    .order('completed_at', { ascending: false });

  if (!games?.length) {
    render(`<div class="screen">
      <div class="app-header">
        <button class="btn btn-ghost btn-sm" onclick="location.hash='#home'">← Home</button>
        <h2>Game History</h2><div></div>
      </div>
      <div class="empty-state mt-24">No completed games yet.</div>
    </div>`); return;
  }

  const gameIds2 = games.map(g => g.id);
  const { data: allPlayers } = await sb.from('game_players').select('game_id, user_id, nickname_snapshot, score')
    .in('game_id', gameIds2).eq('status', 'active');

  let cards = '';
  for (const g of games) {
    const gPlayers = (allPlayers ?? []).filter(p => p.game_id === g.id).sort((a, b) => b.score - a.score);
    const winner   = gPlayers[0];
    const myScore  = (myGames ?? []).find(m => m.game_id === g.id)?.score ?? 0;
    const myPlace  = gPlayers.findIndex(p => p.user_id === me.id) + 1;

    cards += `<div class="game-card" onclick="viewGame('${esc(g.id)}')">
      <div class="game-card-header">
        <span class="game-card-code">${esc(g.room_code)}</span>
        <span class="text-muted text-sm">${timeAgo(g.completed_at)}</span>
      </div>
      <div class="game-card-meta">
        Winner: <strong>${esc(winner?.nickname_snapshot ?? '?')}</strong> · 
        You: #${myPlace} with ${myScore.toLocaleString()} pts · 
        ${gPlayers.length} players
      </div>
      <div class="game-card-action">View →</div>
    </div>`;
  }

  render(`<div class="screen">
    <div class="app-header">
      <button class="btn btn-ghost btn-sm" onclick="location.hash='#home'">← Home</button>
      <h2>Game History</h2><div></div>
    </div>
    ${cards}
  </div>`);
}

window.viewGame = function(gameId) {
  setGame(gameId);
  location.hash = '#game';
};

// ═══════════════════════════════════════════════════════════════════════════════
// GAME DETAIL
// ═══════════════════════════════════════════════════════════════════════════════
async function renderGameDetail() {
  if (!me || !profile) return location.hash = '#auth';
  const gameId = getGame();
  if (!gameId) return location.hash = '#history';

  render(`<div class="screen">
    <div class="app-header">
      <button class="btn btn-ghost btn-sm" onclick="location.hash='#history'">← History</button>
      <h2>Game Detail</h2><div></div>
    </div>
    <div class="spinner"></div></div>`);

  const { data: game } = await sb.from('games').select('*').eq('id', gameId).single();
  const { data: players } = await sb.from('game_players').select('*').eq('game_id', gameId).eq('status', 'active');

  // Verify user was a participant
  const wasParticipant = (players ?? []).some(p => p.user_id === me.id);
  if (!wasParticipant) { toast('You were not a participant in this game.', 'error'); location.hash = '#history'; return; }

  const sorted = [...(players ?? [])].sort((a, b) => b.score - a.score);
  const winner = sorted[0];

  let leaderboard = '';
  sorted.forEach((p, i) => {
    leaderboard += `<div class="result-row ${i === 0 ? 'winner' : ''}">
      <div class="result-rank">${i === 0 ? '🏆' : i + 1}</div>
      <div class="result-name">${esc(p.nickname_snapshot)}${p.user_id === me.id ? ' (you)' : ''}</div>
      <div class="result-score">${p.score.toLocaleString()}</div>
    </div>`;
  });

  // Per-round answer/vote breakdown
  let roundsHtml = '';
  for (let round = 1; round <= 3; round++) {
    const { data: rps } = await sb.from('round_prompts').select('id, prompt_id')
      .eq('game_id', gameId).eq('round_number', round);
    if (!rps?.length) continue;

    const rpIds = rps.map(r => r.id);
    const promptIds = rps.map(r => r.prompt_id);
    const { data: prompts } = await sb.from('prompts').select('id, prompt_text').in('id', promptIds);
    const { data: answers } = await sb.from('answers').select('*, profiles(nickname)').in('round_prompt_id', rpIds);
    const { data: votes }   = await sb.from('votes').select('*').in('round_prompt_id', rpIds);

    const promptLookup = {};
    (prompts ?? []).forEach(p => { promptLookup[p.id] = p; });

    roundsHtml += `<div class="section-label">${round === 3 ? 'Finale Round' : `Round ${round}`}</div>`;

    for (const rp of rps) {
      const prompt  = promptLookup[rp.prompt_id];
      const opts    = (answers ?? []).filter(a => a.round_prompt_id === rp.id);
      const rpVotes = (votes ?? []).filter(v => v.round_prompt_id === rp.id);

      const voteCounts = {};
      opts.forEach(a => { voteCounts[a.id] = 0; });
      rpVotes.forEach(v => { if (voteCounts[v.answer_id] !== undefined) voteCounts[v.answer_id]++; });
      const maxV = Math.max(...Object.values(voteCounts), 0);

      roundsHtml += `<div class="card">
        <div class="prompt-text">${esc(prompt?.prompt_text)}</div>
        <div style="margin-top:10px">`;

      for (const a of [...opts].sort((x, y) => (voteCounts[y.id] ?? 0) - (voteCounts[x.id] ?? 0))) {
        const vc  = voteCounts[a.id] ?? 0;
        const top = vc === maxV && maxV > 0;
        const nick = a.profiles?.nickname ?? (players ?? []).find(p => p.user_id === a.user_id)?.nickname_snapshot ?? '?';
        const display = round === 3
          ? `${esc(a.word_1)} · ${esc(a.word_2)} · ${esc(a.word_3)}`
          : esc(a.answer_text);
        roundsHtml += `<div class="answer-result ${top ? 'top' : ''}">
          <div class="answer-result-text">
            <div>${display}</div>
            <div class="text-muted text-sm mt-4">${esc(nick)} ${top ? '🏆' : ''}</div>
          </div>
          <div class="answer-result-votes">${vc} vote${vc !== 1 ? 's' : ''}</div>
        </div>`;
      }

      roundsHtml += `</div></div>`;
    }
  }

  render(`<div class="screen">
    <div class="app-header">
      <button class="btn btn-ghost btn-sm" onclick="location.hash='#history'">← History</button>
      <h2>${esc(game?.room_code ?? '')}</h2><div></div>
    </div>
    <div class="info-box">${timeAgo(game?.completed_at)} · ${players.length} players</div>
    <div class="winner-banner mt-12">
      <div class="winner-crown">🏆</div>
      <div class="winner-name">${esc(winner?.nickname_snapshot ?? '?')} won!</div>
      <div class="winner-score">${winner?.score?.toLocaleString() ?? 0} points</div>
    </div>
    <div class="section-label">Final Standings</div>
    ${leaderboard}
    ${roundsHtml}
  </div>`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// BOOTSTRAP — Auth listener + initial route
// ═══════════════════════════════════════════════════════════════════════════════
sb.auth.onAuthStateChange(async (event, session) => {
  me = session?.user ?? null;

  if (!me) {
    profile = null;
    if (location.hash !== '#auth') location.hash = '#auth';
    else await navigate('#auth');
    return;
  }

  // Load or verify profile
  const { data: p } = await sb.from('profiles').select('*').eq('id', me.id).single();
  profile = p ?? null;

  if (!profile) {
    location.hash = '#profile';
    await navigate('#profile');
  } else {
    const hash = location.hash || '#home';
    if (hash === '#auth' || hash === '#profile') {
      location.hash = '#home';
      await navigate('#home');
    } else {
      await navigate(hash);
    }
  }
});

// Initial load
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    await navigate('#auth');
  }
  // onAuthStateChange will handle the rest
})();
