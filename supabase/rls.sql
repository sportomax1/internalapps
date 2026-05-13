-- ─────────────────────────────────────────────────────────────────────────────
-- Party Prompt Game — Row Level Security Policies
-- Run AFTER schema.sql in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable RLS on all tables
alter table profiles              enable row level security;
alter table games                 enable row level security;
alter table game_players          enable row level security;
alter table prompts               enable row level security;
alter table round_prompts         enable row level security;
alter table player_round_prompts  enable row level security;
alter table answers               enable row level security;
alter table votes                 enable row level security;
alter table game_events           enable row level security;

-- ─── Helper: is the current user an active participant in a game? ─────────────
-- Used across multiple policies.
create or replace function is_game_participant(gid uuid)
returns boolean
language sql security definer
as $$
  select exists (
    select 1 from game_players
    where game_id = gid
      and user_id = auth.uid()
      and status  = 'active'
  );
$$;

-- ─── profiles ────────────────────────────────────────────────────────────────
-- Read own profile or profiles of players in shared games.
create policy "profiles: read own or shared game" on profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1 from game_players gp1
      join   game_players gp2 on gp1.game_id = gp2.game_id
      where  gp1.user_id = auth.uid()
        and  gp2.user_id = profiles.id
        and  gp1.status  = 'active'
    )
  );

create policy "profiles: insert own" on profiles
  for insert with check (id = auth.uid());

create policy "profiles: update own" on profiles
  for update using (id = auth.uid());

-- ─── games ───────────────────────────────────────────────────────────────────
-- Participants can read their own games.
create policy "games: read as participant" on games
  for select using (is_game_participant(id));

-- Any authenticated user can insert a game (they become host).
create policy "games: insert authenticated" on games
  for insert with check (
    auth.uid() is not null
    and host_user_id = auth.uid()
  );

-- Only host can update via client; server-side advance uses service role (bypasses RLS).
create policy "games: update as host" on games
  for update using (host_user_id = auth.uid());

-- ─── game_players ─────────────────────────────────────────────────────────────
create policy "game_players: read as participant" on game_players
  for select using (is_game_participant(game_id));

-- Players can join (insert themselves) — game must be in lobby; enforced app-side.
create policy "game_players: insert self" on game_players
  for insert with check (user_id = auth.uid());

-- Players can update their own row (e.g., leave).
create policy "game_players: update self" on game_players
  for update using (user_id = auth.uid());

-- ─── prompts ─────────────────────────────────────────────────────────────────
-- Any authenticated user can read active, family-safe prompts.
create policy "prompts: read authenticated" on prompts
  for select using (
    auth.uid() is not null
    and active      = true
    and family_safe = true
  );

-- ─── round_prompts ────────────────────────────────────────────────────────────
create policy "round_prompts: read as participant" on round_prompts
  for select using (is_game_participant(game_id));

-- ─── player_round_prompts ────────────────────────────────────────────────────
create policy "player_round_prompts: read as participant" on player_round_prompts
  for select using (is_game_participant(game_id));

-- ─── answers ─────────────────────────────────────────────────────────────────
-- Players can always read their own answers.
-- Other participants can read answers only once voting/results phase starts.
create policy "answers: read" on answers
  for select using (
    user_id = auth.uid()
    or (
      is_game_participant(game_id)
      and exists (
        select 1 from games
        where id            = answers.game_id
          and current_phase in ('voting','results','complete')
      )
    )
  );

create policy "answers: insert own" on answers
  for insert with check (user_id = auth.uid());

create policy "answers: update own" on answers
  for update using (user_id = auth.uid());

-- ─── votes ───────────────────────────────────────────────────────────────────
-- Participants can read votes for their games.
create policy "votes: read as participant" on votes
  for select using (is_game_participant(game_id));

create policy "votes: insert own" on votes
  for insert with check (voter_user_id = auth.uid());

-- Allow upsert (change vote before voting closes).
create policy "votes: update own" on votes
  for update using (voter_user_id = auth.uid());

-- ─── game_events ─────────────────────────────────────────────────────────────
create policy "game_events: read as participant" on game_events
  for select using (is_game_participant(game_id));

create policy "game_events: insert" on game_events
  for insert with check (actor_user_id = auth.uid());
