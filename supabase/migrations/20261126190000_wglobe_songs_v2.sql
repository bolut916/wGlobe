-- Kaydedilen şarkılar (şu an çalan şarkıdan "kaydet"): kullanıcı başına kimlikli satırlar, eklenir/silinir.
-- Projeye uygulanmıştır; dosya kaynak kaydıdır.
create table public.songs (
  user_id   uuid not null references auth.users (id) on delete cascade,
  id        text not null check (char_length(id) between 1 and 80),
  saved_at  timestamptz not null default now(),
  data      jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 2048),
  primary key (user_id, id)
);
create index songs_user_saved_idx on public.songs (user_id, saved_at desc);

alter table public.songs enable row level security;
create policy songs_select_own on public.songs for select to authenticated using ((select auth.uid()) = user_id);
create policy songs_insert_own on public.songs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy songs_update_own on public.songs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy songs_delete_own on public.songs for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.songs from anon;
grant select, insert, update, delete on public.songs to authenticated;
