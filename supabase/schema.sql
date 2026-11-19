-- ═══════════════════════════════════════════════════════════════════════
--  wGlobe — Supabase şeması
--  Çalıştırma: Supabase Dashboard → SQL Editor → bu dosyanın tamamı.
--  Dosya idempotent yazılmıştır; tekrar çalıştırmak güvenlidir.
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ───────────────────────────────────────────────────────────────────────
--  1. PROFILES
--  auth.users ile 1:1. id doğrudan auth.users.id'dir.
-- ───────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  email           text,
  selected_theme  text not null default 'classic',
  unlocked_themes text[] not null default array['classic']::text[],
  created_at      timestamptz not null default now(),
  constraint profiles_selected_theme_check
    check (selected_theme in ('classic', 'parchment', 'night_lights', 'swiss_minimal')),
  constraint profiles_unlocked_themes_check
    check (unlocked_themes <@ array['classic', 'parchment', 'night_lights', 'swiss_minimal']::text[])
);

comment on table  public.profiles is 'Kullanıcı profili; kayıtta handle_new_user tetikleyicisiyle oluşturulur.';
comment on column public.profiles.unlocked_themes is 'Koleksiyon ekranında açılmış küre temaları.';

-- ───────────────────────────────────────────────────────────────────────
--  2. FAVORITE_STATIONS
-- ───────────────────────────────────────────────────────────────────────
create table if not exists public.favorite_stations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  station_uuid  text not null,
  station_name  text not null,
  stream_url    text not null,
  city_name     text not null,
  country_code  char(2) not null,
  created_at    timestamptz not null default now(),
  constraint favorite_stations_unique_per_user unique (user_id, station_uuid),
  constraint favorite_stations_https_only check (stream_url like 'https://%'),
  constraint favorite_stations_country_code_upper check (country_code = upper(country_code))
);

create index if not exists favorite_stations_user_created_idx
  on public.favorite_stations (user_id, created_at desc);

-- ───────────────────────────────────────────────────────────────────────
--  3. VISITED_CITIES  (Seyahat Pasaportu damgaları)
-- ───────────────────────────────────────────────────────────────────────
create table if not exists public.visited_cities (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  city_id     text not null,
  city_name   text not null,
  visited_at  timestamptz not null default now()
);

create index if not exists visited_cities_user_visited_idx
  on public.visited_cities (user_id, visited_at desc);

create index if not exists visited_cities_user_city_idx
  on public.visited_cities (user_id, city_id);

-- ───────────────────────────────────────────────────────────────────────
--  4. YENİ KULLANICI TETİKLEYİCİSİ
--  security definer + boş search_path: fonksiyon RLS'i aşarak yalnızca
--  kendi profil satırını yazar; şema ele geçirme saldırılarına kapalıdır.
-- ───────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- E-posta değişikliği profile yansısın
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- ───────────────────────────────────────────────────────────────────────
--  5. HESABI SİL  (Profil → "Hesabı Sil")
--  İstemci yalnızca kendi hesabını silebilir. auth.users silinince
--  on delete cascade ile tüm satırlar temizlenir.
-- ───────────────────────────────────────────────────────────────────────
create or replace function public.delete_user()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Kimlik doğrulaması gerekli' using errcode = '42501';
  end if;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_user() from public, anon;
grant execute on function public.delete_user() to authenticated;

-- ───────────────────────────────────────────────────────────────────────
--  6. ROW LEVEL SECURITY
--  (select auth.uid()) sarmalaması auth.uid() ile aynı anlamdadır;
--  Postgres'in değeri satır başına değil sorgu başına bir kez
--  hesaplamasını sağlar (Supabase performans önerisi).
-- ───────────────────────────────────────────────────────────────────────
alter table public.profiles          enable row level security;
alter table public.favorite_stations enable row level security;
alter table public.visited_cities    enable row level security;

alter table public.profiles          force row level security;
alter table public.favorite_stations force row level security;
alter table public.visited_cities    force row level security;

-- profiles (sahiplik sütunu: id)
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own" on public.profiles
  for delete to authenticated
  using ((select auth.uid()) = id);

-- favorite_stations
drop policy if exists "favorite_stations_select_own" on public.favorite_stations;
create policy "favorite_stations_select_own" on public.favorite_stations
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "favorite_stations_insert_own" on public.favorite_stations;
create policy "favorite_stations_insert_own" on public.favorite_stations
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "favorite_stations_update_own" on public.favorite_stations;
create policy "favorite_stations_update_own" on public.favorite_stations
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "favorite_stations_delete_own" on public.favorite_stations;
create policy "favorite_stations_delete_own" on public.favorite_stations
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- visited_cities
drop policy if exists "visited_cities_select_own" on public.visited_cities;
create policy "visited_cities_select_own" on public.visited_cities
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "visited_cities_insert_own" on public.visited_cities;
create policy "visited_cities_insert_own" on public.visited_cities
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "visited_cities_update_own" on public.visited_cities;
create policy "visited_cities_update_own" on public.visited_cities
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "visited_cities_delete_own" on public.visited_cities;
create policy "visited_cities_delete_own" on public.visited_cities
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ───────────────────────────────────────────────────────────────────────
--  7. YETKİLER
--  anon rolü hiçbir tabloya erişemez; misafir verisi cihazda tutulur.
-- ───────────────────────────────────────────────────────────────────────
revoke all on public.profiles          from anon;
revoke all on public.favorite_stations from anon;
revoke all on public.visited_cities    from anon;

grant select, insert, update, delete on public.profiles          to authenticated;
grant select, insert, update, delete on public.favorite_stations to authenticated;
grant select, insert, update, delete on public.visited_cities    to authenticated;
