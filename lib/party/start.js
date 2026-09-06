// api/party/start.js — Host starts the game; assigns prompts to all players for all rounds.
// POST { game_id } with Authorization: Bearer <supabase_jwt>
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL       = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { game_id } = req.body ?? {};
  const authHeader   = req.headers['authorization'] ?? '';
  const userToken    = authHeader.replace(/^Bearer\s+/i, '');

  if (!game_id || !userToken) {
    return res.status(400).json({ ok: false, error: 'Missing game_id or authorization' });
  }

  // Admin client — bypasses RLS for all writes
  const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Verify caller identity via their JWT
  const { data: { user }, error: authErr } = await sbAdmin.auth.getUser(userToken);
  if (authErr || !user) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  // Load the game
  const { data: game } = await sbAdmin.from('games').select('*').eq('id', game_id).single();
  if (!game) return res.status(404).json({ ok: false, error: 'Game not found' });

  // Only host may start
  if (game.host_user_id !== user.id) {
    return res.status(403).json({ ok: false, error: 'Only the host can start the game' });
  }
  if (game.status !== 'lobby') {
    return res.status(400).json({ ok: false, error: 'Game is not in the lobby' });
  }

  // Active players
  const { data: players } = await sbAdmin
    .from('game_players')
    .select('user_id')
    .eq('game_id', game_id)
    .eq('status', 'active');

  const N = players?.length ?? 0;
  if (N < 3) return res.status(400).json({ ok: false, error: 'Need at least 3 players to start' });
  if (N > 8) return res.status(400).json({ ok: false, error: 'Maximum 8 players allowed' });

  // Fetch prompts
  const { data: regularPrompts } = await sbAdmin
    .from('prompts')
    .select('id')
    .in('prompt_type', ['open_ended', 'fill_blank'])
    .eq('active', true)
    .eq('family_safe', true);

  const { data: finalePrompts } = await sbAdmin
    .from('prompts')
    .select('id')
    .eq('prompt_type', 'finale')
    .eq('active', true)
    .eq('family_safe', true);

  if ((regularPrompts?.length ?? 0) < N * 2) {
    return res.status(500).json({ ok: false, error: 'Not enough regular prompts' });
  }
  if ((finalePrompts?.length ?? 0) < N) {
    return res.status(500).json({ ok: false, error: 'Not enough finale prompts' });
  }

  // Shuffle and slice prompts for each round
  const shuffledRegular = shuffle(regularPrompts);
  const shuffledFinale  = shuffle(finalePrompts);

  const r1Prompts = shuffledRegular.slice(0, N);
  const r2Prompts = shuffledRegular.slice(N, N * 2);
  const r3Prompts = shuffledFinale.slice(0, N);

  // Shuffle players independently for R1/R2/R3 to vary matchups
  const r1Players = shuffle(players);
  const r2Players = shuffle(players);
  const r3Players = shuffle(players);

  // ── Build round_prompts rows ────────────────────────────────────────────────
  const rpRows = [];
  for (let i = 0; i < N; i++) {
    rpRows.push({ game_id, round_number: 1, prompt_id: r1Prompts[i].id, assigned_group: i });
  }
  for (let i = 0; i < N; i++) {
    rpRows.push({ game_id, round_number: 2, prompt_id: r2Prompts[i].id, assigned_group: i });
  }
  for (let i = 0; i < N; i++) {
    rpRows.push({ game_id, round_number: 3, prompt_id: r3Prompts[i].id, assigned_group: i });
  }

  const { data: insertedRPs, error: rpErr } = await sbAdmin
    .from('round_prompts')
    .insert(rpRows)
    .select('id, round_number, assigned_group');

  if (rpErr) {
    console.error('round_prompts insert error:', rpErr);
    return res.status(500).json({ ok: false, error: 'Failed to assign prompts' });
  }

  // Partition by round
  const r1RPs = insertedRPs.filter(rp => rp.round_number === 1).sort((a, b) => a.assigned_group - b.assigned_group);
  const r2RPs = insertedRPs.filter(rp => rp.round_number === 2).sort((a, b) => a.assigned_group - b.assigned_group);
  const r3RPs = insertedRPs.filter(rp => rp.round_number === 3).sort((a, b) => a.assigned_group - b.assigned_group);

  // ── Build player_round_prompts rows ────────────────────────────────────────
  // R1/R2: prompt[i] → player[i] and player[(i+1) % N]  (round-robin pairing)
  // R3:    prompt[i] → player[i] only
  const prpRows = [];

  for (let i = 0; i < N; i++) {
    const p1 = r1Players[i];
    const p2 = r1Players[(i + 1) % N];
    prpRows.push({ round_prompt_id: r1RPs[i].id, user_id: p1.user_id, game_id });
    prpRows.push({ round_prompt_id: r1RPs[i].id, user_id: p2.user_id, game_id });
  }

  for (let i = 0; i < N; i++) {
    const p1 = r2Players[i];
    const p2 = r2Players[(i + 1) % N];
    prpRows.push({ round_prompt_id: r2RPs[i].id, user_id: p1.user_id, game_id });
    prpRows.push({ round_prompt_id: r2RPs[i].id, user_id: p2.user_id, game_id });
  }

  for (let i = 0; i < N; i++) {
    prpRows.push({ round_prompt_id: r3RPs[i].id, user_id: r3Players[i].user_id, game_id });
  }

  const { error: prpErr } = await sbAdmin.from('player_round_prompts').insert(prpRows);
  if (prpErr) {
    console.error('player_round_prompts insert error:', prpErr);
    return res.status(500).json({ ok: false, error: 'Failed to assign players to prompts' });
  }

  // ── Advance game to active / answering ─────────────────────────────────────
  const { error: updateErr } = await sbAdmin
    .from('games')
    .update({ status: 'active', current_round: 1, current_phase: 'answering' })
    .eq('id', game_id);

  if (updateErr) {
    console.error('games update error:', updateErr);
    return res.status(500).json({ ok: false, error: 'Failed to start game' });
  }

  // Audit log
  await sbAdmin.from('game_events').insert({
    game_id,
    actor_user_id: user.id,
    event_type:    'start',
    event_details: { player_count: N },
  });

  return res.status(200).json({ ok: true });
}
