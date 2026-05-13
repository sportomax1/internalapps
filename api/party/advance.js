// api/party/advance.js — Check game phase completion and advance if ready.
// POST { game_id, force?: boolean } with Authorization: Bearer <supabase_jwt>
//
// Phase transitions:
//   lobby      → (handled by start.js)
//   answering  → voting       (when all players answered their prompts, or host forces)
//   voting     → results      (when all players voted OR 24 h passed, or host forces)
//   results    → answering    (next round — host forces only)
//   results    → complete     (after round 3 — host forces only)
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOTING_TIMEOUT   = 24 * 60 * 60 * 1000; // 24 hours in ms

// ── Scoring constants ────────────────────────────────────────────────────────
const PTS = {
  r1_vote: 100, r1_win: 250,
  r2_vote: 200, r2_win: 500,
  r3_collection_vote: 600, r3_collection_win: 800,
  r3_word_vote: 200,        r3_word_win: 300,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { game_id, force = false } = req.body ?? {};
  const userToken = (req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '');

  if (!game_id || !userToken) {
    return res.status(400).json({ ok: false, error: 'Missing game_id or authorization' });
  }

  const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: { user }, error: authErr } = await sbAdmin.auth.getUser(userToken);
  if (authErr || !user) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  const { data: game } = await sbAdmin.from('games').select('*').eq('id', game_id).single();
  if (!game) return res.status(404).json({ ok: false, error: 'Game not found' });

  // Verify caller is an active participant
  const { data: myRow } = await sbAdmin
    .from('game_players').select('role').eq('game_id', game_id)
    .eq('user_id', user.id).eq('status', 'active').single();
  if (!myRow) return res.status(403).json({ ok: false, error: 'Not a participant' });

  const isHost = myRow.role === 'host';

  // Force-advance requires host
  if (force && !isHost) {
    return res.status(403).json({ ok: false, error: 'Only the host can force advance' });
  }

  if (game.status === 'completed' || game.status === 'ended') {
    return res.status(200).json({ ok: true, advanced: false, phase: game.current_phase });
  }

  const { current_phase, current_round } = game;

  // Active players
  const { data: players } = await sbAdmin
    .from('game_players').select('user_id, score')
    .eq('game_id', game_id).eq('status', 'active');
  const N = players.length;

  // ── answering → voting ────────────────────────────────────────────────────
  if (current_phase === 'answering') {
    // Find all prompt assignments for this round
    const { data: rps } = await sbAdmin
      .from('round_prompts').select('id')
      .eq('game_id', game_id).eq('round_number', current_round);
    const rpIds = (rps ?? []).map(r => r.id);

    const { data: assignments } = await sbAdmin
      .from('player_round_prompts').select('user_id, round_prompt_id')
      .in('round_prompt_id', rpIds);

    const { data: answers } = await sbAdmin
      .from('answers').select('user_id, round_prompt_id')
      .in('round_prompt_id', rpIds);

    const allAnswered = (assignments ?? []).every(a =>
      (answers ?? []).some(ans =>
        ans.round_prompt_id === a.round_prompt_id && ans.user_id === a.user_id
      )
    );

    if (!allAnswered && !force) {
      return res.status(200).json({ ok: true, advanced: false, reason: 'Waiting for answers' });
    }

    await sbAdmin.from('games').update({
      current_phase:     'voting',
      voting_started_at: new Date().toISOString(),
    }).eq('id', game_id);

    if (force) {
      await sbAdmin.from('game_events').insert({
        game_id, actor_user_id: user.id, event_type: 'force_advance',
        event_details: { from: 'answering', to: 'voting', round: current_round },
      });
    }
    return res.status(200).json({ ok: true, advanced: true, phase: 'voting' });
  }

  // ── voting → results ──────────────────────────────────────────────────────
  if (current_phase === 'voting') {
    const votingAge = game.voting_started_at
      ? Date.now() - new Date(game.voting_started_at).getTime()
      : 0;
    const expired = votingAge >= VOTING_TIMEOUT;

    let votingComplete = false;

    if (current_round < 3) {
      // Standard rounds: every active player should have voted on every voteable prompt
      const { data: rps } = await sbAdmin
        .from('round_prompts').select('id')
        .eq('game_id', game_id).eq('round_number', current_round);
      const rpIds = (rps ?? []).map(r => r.id);

      // Only consider prompts that have ≥2 answers (otherwise no choice to vote on)
      const { data: answers } = await sbAdmin
        .from('answers').select('round_prompt_id')
        .in('round_prompt_id', rpIds);
      const promptAnswerCount = {};
      for (const a of answers ?? []) {
        promptAnswerCount[a.round_prompt_id] = (promptAnswerCount[a.round_prompt_id] ?? 0) + 1;
      }
      const voteablePromptIds = rpIds.filter(id => (promptAnswerCount[id] ?? 0) >= 2);

      if (voteablePromptIds.length > 0) {
        const { data: votes } = await sbAdmin
          .from('votes').select('voter_user_id, round_prompt_id')
          .in('round_prompt_id', voteablePromptIds).eq('vote_type', 'standard');

        // For each voteable prompt, count distinct voters
        const votersPerPrompt = {};
        for (const v of votes ?? []) {
          if (!votersPerPrompt[v.round_prompt_id]) votersPerPrompt[v.round_prompt_id] = new Set();
          votersPerPrompt[v.round_prompt_id].add(v.voter_user_id);
        }
        votingComplete = voteablePromptIds.every(id => (votersPerPrompt[id]?.size ?? 0) >= N);
      } else {
        votingComplete = true; // no prompts to vote on
      }
    } else {
      // Finale round: each player casts 1 collection vote + 1 word vote
      const { data: rps } = await sbAdmin
        .from('round_prompts').select('id')
        .eq('game_id', game_id).eq('round_number', 3);
      const rpIds = (rps ?? []).map(r => r.id);

      const { data: collVotes } = await sbAdmin
        .from('votes').select('voter_user_id')
        .in('round_prompt_id', rpIds).eq('vote_type', 'finale_collection');
      const { data: wordVotes } = await sbAdmin
        .from('votes').select('voter_user_id')
        .in('round_prompt_id', rpIds).eq('vote_type', 'finale_word');

      const collVoters = new Set((collVotes ?? []).map(v => v.voter_user_id));
      const wordVoters = new Set((wordVotes ?? []).map(v => v.voter_user_id));
      votingComplete = collVoters.size >= N && wordVoters.size >= N;
    }

    if (!votingComplete && !expired && !force) {
      return res.status(200).json({ ok: true, advanced: false, reason: 'Waiting for votes' });
    }

    // ── Calculate and apply scores ──────────────────────────────────────────
    const scoreDeltas = {}; // user_id → points to add
    players.forEach(p => { scoreDeltas[p.user_id] = 0; });

    if (current_round < 3) {
      await calcStandardScores(sbAdmin, game_id, current_round, scoreDeltas, PTS);
    } else {
      await calcFinaleScores(sbAdmin, game_id, scoreDeltas, PTS);
    }

    // Update each player's score
    for (const [uid, delta] of Object.entries(scoreDeltas)) {
      if (delta > 0) {
        const existing = players.find(p => p.user_id === uid)?.score ?? 0;
        await sbAdmin.from('game_players')
          .update({ score: existing + delta })
          .eq('game_id', game_id).eq('user_id', uid);
      }
    }

    await sbAdmin.from('games').update({ current_phase: 'results' }).eq('id', game_id);

    if (force || expired) {
      await sbAdmin.from('game_events').insert({
        game_id, actor_user_id: user.id, event_type: force ? 'force_advance' : 'auto_advance',
        event_details: { from: 'voting', to: 'results', round: current_round, expired },
      });
    }
    return res.status(200).json({ ok: true, advanced: true, phase: 'results' });
  }

  // ── results → next phase (host-only) ──────────────────────────────────────
  if (current_phase === 'results') {
    if (!isHost && !force) {
      return res.status(403).json({ ok: false, error: 'Only the host can advance from results' });
    }

    if (current_round === 3) {
      // Game over
      await sbAdmin.from('games').update({
        current_phase: 'complete',
        status:        'completed',
        completed_at:  new Date().toISOString(),
      }).eq('id', game_id);

      await sbAdmin.from('game_events').insert({
        game_id, actor_user_id: user.id, event_type: 'complete',
        event_details: { final_round: 3 },
      });
      return res.status(200).json({ ok: true, advanced: true, phase: 'complete' });
    }

    // Advance to next round
    const nextRound = current_round + 1;
    await sbAdmin.from('games').update({
      current_round: nextRound,
      current_phase: 'answering',
      voting_started_at: null,
    }).eq('id', game_id);

    await sbAdmin.from('game_events').insert({
      game_id, actor_user_id: user.id, event_type: 'advance_round',
      event_details: { from_round: current_round, to_round: nextRound },
    });
    return res.status(200).json({ ok: true, advanced: true, phase: 'answering', round: nextRound });
  }

  return res.status(200).json({ ok: true, advanced: false, reason: 'No action needed' });
}

// ── Score helpers ─────────────────────────────────────────────────────────────

async function calcStandardScores(sbAdmin, game_id, round, deltas, PTS) {
  const perVote  = round === 1 ? PTS.r1_vote : PTS.r2_vote;
  const winBonus = round === 1 ? PTS.r1_win  : PTS.r2_win;

  const { data: rps } = await sbAdmin
    .from('round_prompts').select('id')
    .eq('game_id', game_id).eq('round_number', round);

  for (const rp of rps ?? []) {
    const { data: answers } = await sbAdmin
      .from('answers').select('id, user_id')
      .eq('round_prompt_id', rp.id);
    const { data: votes } = await sbAdmin
      .from('votes').select('answer_id')
      .eq('round_prompt_id', rp.id).eq('vote_type', 'standard');

    if (!answers?.length) continue;

    // Count votes per answer
    const voteCounts = {};
    for (const a of answers) voteCounts[a.id] = 0;
    for (const v of votes ?? []) {
      if (voteCounts[v.answer_id] !== undefined) voteCounts[v.answer_id]++;
    }

    // Award per-vote points
    for (const a of answers) {
      const pts = (voteCounts[a.id] ?? 0) * perVote;
      deltas[a.user_id] = (deltas[a.user_id] ?? 0) + pts;
    }

    // Award winner bonus (ties: all tied winners get full bonus)
    const maxVotes = Math.max(...Object.values(voteCounts));
    if (maxVotes > 0) {
      const winners = answers.filter(a => (voteCounts[a.id] ?? 0) === maxVotes);
      for (const w of winners) {
        deltas[w.user_id] = (deltas[w.user_id] ?? 0) + winBonus;
      }
    }
  }
}

async function calcFinaleScores(sbAdmin, game_id, deltas, PTS) {
  const { data: rps } = await sbAdmin
    .from('round_prompts').select('id')
    .eq('game_id', game_id).eq('round_number', 3);
  const rpIds = (rps ?? []).map(r => r.id);

  const { data: answers } = await sbAdmin
    .from('answers').select('id, user_id, word_1, word_2, word_3')
    .in('round_prompt_id', rpIds);

  const { data: collVotes } = await sbAdmin
    .from('votes').select('answer_id, voter_user_id')
    .in('round_prompt_id', rpIds).eq('vote_type', 'finale_collection');

  const { data: wordVotes } = await sbAdmin
    .from('votes').select('answer_id, selected_word, voter_user_id')
    .in('round_prompt_id', rpIds).eq('vote_type', 'finale_word');

  if (!answers?.length) return;

  // Collection vote scores
  const collCount = {};
  for (const a of answers) collCount[a.id] = 0;
  for (const v of collVotes ?? []) {
    if (collCount[v.answer_id] !== undefined) collCount[v.answer_id]++;
  }

  for (const a of answers) {
    deltas[a.user_id] = (deltas[a.user_id] ?? 0) + (collCount[a.id] ?? 0) * PTS.r3_collection_vote;
  }

  // Collection winner bonus
  const maxColl = Math.max(...Object.values(collCount));
  if (maxColl > 0) {
    answers.filter(a => collCount[a.id] === maxColl)
      .forEach(a => { deltas[a.user_id] = (deltas[a.user_id] ?? 0) + PTS.r3_collection_win; });
  }

  // Word vote scores — track per (answer_id + word) pair
  const wordCount = {}; // key: `${answer_id}:${word}`
  const wordOwner = {}; // key → user_id
  for (const a of answers) {
    for (const w of [a.word_1, a.word_2, a.word_3]) {
      if (w) {
        const key = `${a.id}:${w.toLowerCase()}`;
        wordCount[key] = 0;
        wordOwner[key] = a.user_id;
      }
    }
  }
  for (const v of wordVotes ?? []) {
    if (!v.selected_word) continue;
    const key = `${v.answer_id}:${v.selected_word.toLowerCase()}`;
    if (wordCount[key] !== undefined) wordCount[key]++;
  }

  for (const [key, count] of Object.entries(wordCount)) {
    const uid = wordOwner[key];
    deltas[uid] = (deltas[uid] ?? 0) + count * PTS.r3_word_vote;
  }

  // Word winner bonus
  const maxWord = Math.max(...Object.values(wordCount), 0);
  if (maxWord > 0) {
    const winnerKeys = Object.keys(wordCount).filter(k => wordCount[k] === maxWord);
    const winnerUsers = [...new Set(winnerKeys.map(k => wordOwner[k]))];
    for (const uid of winnerUsers) {
      deltas[uid] = (deltas[uid] ?? 0) + PTS.r3_word_win;
    }
  }
}
