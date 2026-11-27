-- ═══════════════════════════════════════════════════════════════════════
--  wGlobe güvenlik sıkılaştırması (v3). Projeye uygulanmıştır; dosya kaynak kaydıdır.
--
--  1) Yetkiler en aza indirilir: Supabase'in varsayılan "her şey" yetkileri (TRUNCATE, TRIGGER, REFERENCES;
--     profiles için DELETE) geri alınır. profiles'ta yalnız uygulamanın yazdığı sütunlar güncellenebilir:
--     id, email, created_at istemciden asla değiştirilemez.
--  2) Kullanıcı başına satır sınırları: tek bir hesabın veritabanını şişirmesi engellenir.
--     favorites ≤ 1000, songs ≤ 1000 (aşılırsa hata, kod WG001); visits en yeni 2000 satır tutulur
--     (uygulama yalnız son 200'ü okur; eskiler kendiliğinden silinir).
-- ═══════════════════════════════════════════════════════════════════════

-- 1) YETKİLER
revoke all on public.profiles, public.favorites, public.visits, public.songs from anon, authenticated;
grant select on public.profiles to authenticated;
grant insert (id) on public.profiles to authenticated;
grant update (theme, unlocked, prefs, cotd, stats, listen_ms, updated_at) on public.profiles to authenticated;
grant select, insert, update, delete on public.favorites, public.visits, public.songs to authenticated;

-- 2) SATIR SINIRLARI
create or replace function public.wg_row_limit()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  lim  int  := tg_argv[0]::int;
  keyc text := tg_argv[1];
  n    int;
  dup  boolean;
begin
  -- Aynı kullanıcının eşzamanlı eklemeleri sırayla sayılır
  perform pg_advisory_xact_lock(hashtextextended(tg_table_name || new.user_id::text, 0));
  -- upsert ile var olan satırın güncellenmesi sınırı tüketmez
  execute format('select exists(select 1 from public.%I where user_id = $1 and %I = $2)', tg_table_name, keyc)
    into dup using new.user_id, (to_jsonb(new) ->> keyc);
  if dup then return new; end if;
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name) into n using new.user_id;
  if n >= lim then
    raise exception 'wGlobe: % sınırı (%) doldu', tg_table_name, lim using errcode = 'WG001';
  end if;
  return new;
end; $$;
revoke all on function public.wg_row_limit() from public, anon, authenticated;

create trigger favorites_row_limit before insert on public.favorites
  for each row execute function public.wg_row_limit('1000', 'station_uuid');
create trigger songs_row_limit before insert on public.songs
  for each row execute function public.wg_row_limit('1000', 'id');

create or replace function public.wg_trim_visits()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.visits v
   using (select distinct user_id from ins) u
   where v.user_id = u.user_id
     and (v.user_id, v.id) not in (
       select x.user_id, x.id from public.visits x
        where x.user_id = u.user_id
        order by x.visited_at desc, x.id desc
        limit 2000);
  return null;
end; $$;
revoke all on function public.wg_trim_visits() from public, anon, authenticated;

create trigger visits_trim after insert on public.visits
  referencing new table as ins
  for each statement execute function public.wg_trim_visits();
