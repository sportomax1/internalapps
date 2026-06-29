-- Places is accessed only by the password-protected Vercel API.
-- Browser roles intentionally receive no table access.
create extension if not exists "pgcrypto";

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 1 and 120),
  display_name text not null default '' check (char_length(display_name) <= 500),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.places
  add column if not exists updated_at timestamptz not null default now();

update public.places set display_name = '' where display_name is null;
alter table public.places alter column display_name set default '';
alter table public.places alter column display_name set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'places_label_length'
  ) then
    alter table public.places
      add constraint places_label_length
      check (char_length(label) between 1 and 120);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'places_display_name_length'
  ) then
    alter table public.places
      add constraint places_display_name_length
      check (char_length(display_name) <= 500);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'places_lat_range'
  ) then
    alter table public.places
      add constraint places_lat_range check (lat between -90 and 90);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'places_lng_range'
  ) then
    alter table public.places
      add constraint places_lng_range check (lng between -180 and 180);
  end if;
end
$$;

create index if not exists places_created_at_idx
  on public.places (created_at desc);

create index if not exists places_tags_idx
  on public.places using gin (tags);

alter table public.places enable row level security;

drop policy if exists "Allow public delete places" on public.places;
drop policy if exists "Allow public insert places" on public.places;
drop policy if exists "Allow public read places" on public.places;
drop policy if exists "Allow public update places" on public.places;

revoke all on table public.places from anon, authenticated;

grant select, insert, update, delete on table public.places to service_role;
