    -- ─────────────────────────────────────────────────────────────────────────────
    -- Party Prompt Game — Supabase Schema
    -- Run this first in the Supabase SQL editor.
    -- ─────────────────────────────────────────────────────────────────────────────

    -- Extensions
    create extension if not exists "pgcrypto";

    -- ─── profiles ────────────────────────────────────────────────────────────────
    -- Public user profile; id matches the Supabase auth.users id.
    create table if not exists profiles (
    id          uuid        primary key references auth.users(id) on delete cascade,
    nickname    text        not null unique,
    created_at  timestamptz not null default now()
    );

    -- ─── games ───────────────────────────────────────────────────────────────────
    create table if not exists games (
    id                uuid        primary key default gen_random_uuid(),
    room_code         text        not null unique,
    host_user_id      uuid        not null references profiles(id),
    status            text        not null default 'lobby'
                                    check (status in ('lobby','active','completed','ended')),
    current_round     int         not null default 1,
    current_phase     text        not null default 'lobby'
                                    check (current_phase in ('lobby','answering','voting','results','complete')),
    voting_started_at timestamptz,
    created_at        timestamptz not null default now(),
    completed_at      timestamptz
    );

    -- ─── game_players ─────────────────────────────────────────────────────────────
    create table if not exists game_players (
    id                uuid        primary key default gen_random_uuid(),
    game_id           uuid        not null references games(id) on delete cascade,
    user_id           uuid        not null references profiles(id),
    nickname_snapshot text        not null,
    role              text        not null default 'player' check (role in ('host','player')),
    status            text        not null default 'active' check (status in ('active','removed','left')),
    score             int         not null default 0,
    joined_at         timestamptz not null default now(),
    unique(game_id, user_id)
    );

    -- ─── prompts ─────────────────────────────────────────────────────────────────
    create table if not exists prompts (
    id          uuid    primary key default gen_random_uuid(),
    prompt_text text    not null,
    prompt_type text    not null check (prompt_type in ('open_ended','fill_blank','finale')),
    family_safe boolean not null default true,
    active      boolean not null default true
    );

    -- ─── round_prompts ────────────────────────────────────────────────────────────
    -- Tracks which prompts were assigned to which game/round, and the matchup group.
    create table if not exists round_prompts (
    id             uuid primary key default gen_random_uuid(),
    game_id        uuid not null references games(id) on delete cascade,
    round_number   int  not null check (round_number in (1,2,3)),
    prompt_id      uuid not null references prompts(id),
    assigned_group int  not null  -- matchup/pairing group index
    );

    -- ─── player_round_prompts ────────────────────────────────────────────────────
    -- Junction: which players are assigned to answer each round_prompt.
    -- For R1/R2 each prompt has 2 players. For R3 each prompt has 1 player.
    create table if not exists player_round_prompts (
    id              uuid primary key default gen_random_uuid(),
    round_prompt_id uuid not null references round_prompts(id) on delete cascade,
    user_id         uuid not null references profiles(id),
    game_id         uuid not null references games(id) on delete cascade,
    unique(round_prompt_id, user_id)
    );

    -- ─── answers ─────────────────────────────────────────────────────────────────
    create table if not exists answers (
    id              uuid        primary key default gen_random_uuid(),
    game_id         uuid        not null references games(id) on delete cascade,
    round_prompt_id uuid        not null references round_prompts(id) on delete cascade,
    user_id         uuid        not null references profiles(id),
    answer_text     text,       -- R1/R2 text answer (max 80 chars enforced client-side)
    word_1          text,       -- R3 finale words
    word_2          text,
    word_3          text,
    submitted_at    timestamptz not null default now(),
    unique(round_prompt_id, user_id)
    );

    -- ─── votes ───────────────────────────────────────────────────────────────────
    create table if not exists votes (
    id              uuid        primary key default gen_random_uuid(),
    game_id         uuid        not null references games(id) on delete cascade,
    round_prompt_id uuid        not null references round_prompts(id) on delete cascade,
    voter_user_id   uuid        not null references profiles(id),
    answer_id       uuid        not null references answers(id),
    vote_type       text        not null check (vote_type in ('standard','finale_collection','finale_word')),
    selected_word   text,       -- for finale_word votes: the specific word chosen
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    -- One vote per (prompt, voter, type) — allows changing by upsert
    unique(round_prompt_id, voter_user_id, vote_type)
    );

    -- ─── game_events ─────────────────────────────────────────────────────────────
    -- Audit log for host actions.
    create table if not exists game_events (
    id            uuid        primary key default gen_random_uuid(),
    game_id       uuid        not null references games(id) on delete cascade,
    actor_user_id uuid        not null references profiles(id),
    event_type    text        not null,
    event_details jsonb,
    created_at    timestamptz not null default now()
    );

    -- ─── Indexes ─────────────────────────────────────────────────────────────────
    create index if not exists idx_games_room_code          on games(room_code);
    create index if not exists idx_game_players_game        on game_players(game_id);
    create index if not exists idx_game_players_user        on game_players(user_id);
    create index if not exists idx_round_prompts_game       on round_prompts(game_id);
    create index if not exists idx_prp_round_prompt         on player_round_prompts(round_prompt_id);
    create index if not exists idx_prp_user_game            on player_round_prompts(user_id, game_id);
    create index if not exists idx_answers_game             on answers(game_id);
    create index if not exists idx_answers_round_prompt     on answers(round_prompt_id);
    create index if not exists idx_votes_game               on votes(game_id);
    create index if not exists idx_votes_round_prompt       on votes(round_prompt_id);
    create index if not exists idx_game_events_game         on game_events(game_id);
