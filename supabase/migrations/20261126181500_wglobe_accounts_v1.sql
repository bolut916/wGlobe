-- ═══════════════════════════════════════════════════════════════════════
--  wGlobe hesapları ve bulut senkronu (v1)
--  Supabase projesi: wglobe (dorodjkpevnklhaqaoyt, eu-central-1).
--  Bu migrasyon projeye uygulanmıştır; dosya kaynak kaydıdır.
--
--  İstemci: prototype/index.html → Cloud modülü (yerel durum + bulut aynası,
--  üç yönlü birleştirme, çevrimdışı bekleyen farklar).
-- ═══════════════════════════════════════════════════════════════════════

-- 1) PROFİL + İLERLEME (auth.users ile 1:1)
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  theme       text   not null default 'classic' check (char_length(theme) between 1 and 64),
  unlocked    text[] not null default array['classic']::text[] check (cardinality(unlocked) <= 400),
  prefs       jsonb  not null default '{}'::jsonb check (jsonb_typeof(prefs) = 'object' and pg_column_size(prefs) < 4096),
  cotd        jsonb  not null default '{}'::jsonb check (jsonb_typeof(cotd) = 'object' and pg_column_size(cotd) < 4096),
  stats       jsonb  not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object' and pg_column_size(stats) < 4096),
  listen_ms   bigint not null default 0 check (listen_ms >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.profiles is 'wGlobe profili ve ilerlemesi; kayıtta handle_new_user ile oluşur.';

-- 2) FAVORİLER (istasyon başına bir satır; data = uygulamadaki nesnenin tamamı)
create table public.favorites (
  user_id      uuid not null references auth.users (id) on delete cascade,
  station_uuid text not null check (char_length(station_uuid) between 1 and 160),
  data         jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 2048),
  created_at   timestamptz not null default now(),
  primary key (user_id, station_uuid)
);
create index favorites_user_created_idx on public.favorites (user_id, created_at desc);

-- 3) ZİYARETLER / DAMGALAR (yalnız eklenir; id istemcide üretilir)
create table public.visits (
  user_id     uuid not null references auth.users (id) on delete cascade,
  id          text not null check (char_length(id) between 1 and 80),
  visited_at  timestamptz not null,
  data        jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 2048),
  primary key (user_id, id)
);
create index visits_user_visited_idx on public.visits (user_id, visited_at desc);

-- 4) YENİ KULLANICI → PROFİL
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end; $$;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- 5) İLERLEME BİRLEŞTİRME
-- unlocked: birleşim (hiçbir küre kaybolmaz). listen_ms ve stats: istemci yalnızca ARTIŞ gönderir,
-- sunucu toplar (iki cihaz aynı anda dinlese de süreler ezilmez). theme/prefs/cotd: gönderildiyse son yazan.
create or replace function public.sync_progress(
  p_unlocked     text[] default null,
  p_theme        text   default null,
  p_prefs        jsonb  default null,
  p_cotd         jsonb  default null,
  p_listen_delta bigint default 0,
  p_stats_delta  jsonb  default null
) returns public.profiles
language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r   public.profiles;
begin
  if uid is null then raise exception 'Kimlik doğrulaması gerekli' using errcode = '42501'; end if;
  if coalesce(p_listen_delta, 0) < 0 or coalesce(p_listen_delta, 0) > 7 * 86400000 then
    raise exception 'Geçersiz dinleme süresi' using errcode = '22023';
  end if;
  if p_stats_delta is not null and jsonb_typeof(p_stats_delta) <> 'object' then
    raise exception 'Geçersiz istatistik' using errcode = '22023';
  end if;

  insert into public.profiles (id) values (uid) on conflict (id) do nothing;

  update public.profiles p set
    unlocked   = (select coalesce(array_agg(distinct u order by u), array['classic']::text[])
                    from unnest(p.unlocked || coalesce(p_unlocked, '{}'::text[])) as u
                   where u is not null and char_length(u) between 1 and 64),
    theme      = coalesce(nullif(p_theme, ''), p.theme),
    prefs      = coalesce(p_prefs, p.prefs),
    cotd       = coalesce(p_cotd, p.cotd),
    listen_ms  = p.listen_ms + coalesce(p_listen_delta, 0),
    stats      = (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
                    select k, sum(n)::bigint as v from (
                      select key as k, (value #>> '{}')::numeric as n from jsonb_each(p.stats)
                       where jsonb_typeof(value) = 'number'
                      union all
                      select key, least((value #>> '{}')::numeric, 100000) from jsonb_each(coalesce(p_stats_delta, '{}'::jsonb))
                       where jsonb_typeof(value) = 'number' and (value #>> '{}')::numeric > 0 and char_length(key) <= 40
                    ) s group by k) t),
    updated_at = now()
  where p.id = uid
  returning * into r;
  return r;
end; $$;

-- 6) HESABI SİL (Apple zorunluluğu): yalnız kendi hesabı; cascade ile tüm satırlar gider.
-- Bilinçli olarak authenticated rolüne açık SECURITY DEFINER (Supabase danışmanı uyarır; fonksiyon
-- yalnız auth.uid() satırını siler).
create or replace function public.delete_user()
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Kimlik doğrulaması gerekli' using errcode = '42501'; end if;
  delete from auth.users where id = uid;
end; $$;

-- 7) ROW LEVEL SECURITY
alter table public.profiles  enable row level security;
alter table public.favorites enable row level security;
alter table public.visits    enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert_own on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy favorites_select_own on public.favorites for select to authenticated using ((select auth.uid()) = user_id);
create policy favorites_insert_own on public.favorites for insert to authenticated with check ((select auth.uid()) = user_id);
create policy favorites_update_own on public.favorites for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy favorites_delete_own on public.favorites for delete to authenticated using ((select auth.uid()) = user_id);

create policy visits_select_own on public.visits for select to authenticated using ((select auth.uid()) = user_id);
create policy visits_insert_own on public.visits for insert to authenticated with check ((select auth.uid()) = user_id);
create policy visits_update_own on public.visits for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy visits_delete_own on public.visits for delete to authenticated using ((select auth.uid()) = user_id);

-- 8) YETKİLER: anon hiçbir şeye erişemez
revoke all on public.profiles, public.favorites, public.visits from anon;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.favorites, public.visits to authenticated;

revoke all on function public.sync_progress(text[], text, jsonb, jsonb, bigint, jsonb) from public, anon;
grant execute on function public.sync_progress(text[], text, jsonb, jsonb, bigint, jsonb) to authenticated;
revoke all on function public.delete_user() from public, anon;
grant execute on function public.delete_user() to authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.handle_user_email_change() from public, anon, authenticated;
