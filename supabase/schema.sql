  -- Fretboard Live : comptes, profils et phrasés synchronisés.
  -- À coller dans Supabase → SQL Editor → Run. Le script peut être relancé sans risque.
  --
  -- Chaque utilisateur ne voit et ne modifie que ses propres lignes : ce sont ces règles (Row Level Security),
  -- et non la clé publique du site, qui protègent les données.

  -- ---------- Profils ----------
  create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    display_name text check (char_length(display_name) <= 60),
    settings jsonb not null default '{}'::jsonb, -- préférences synchronisées (guitare, notation, aides…)
    settings_updated bigint not null default 0, -- horodatage (ms) de la dernière modification des préférences
    created_at timestamptz not null default now()
  );

  -- ---------- Phrasés ----------
  -- Une ligne par phrasé ; data contient le phrasé entier (notes, réglages, séances, statistiques).
  -- updated : horodatage (ms) de la dernière modification sur l'appareil — la version la plus récente l'emporte.
  -- deleted : le phrasé a été supprimé (la ligne reste, pour que la suppression atteigne les autres appareils).
  create table if not exists public.phrases (
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    id text not null check (char_length(id) <= 64),
    data jsonb check (data is null or pg_column_size(data) < 1000000),
    updated bigint not null,
    deleted boolean not null default false,
    primary key (user_id, id)
  );

  alter table public.profiles enable row level security;
  alter table public.phrases enable row level security;

  grant select, insert, update, delete on public.profiles to authenticated;
  grant select, insert, update, delete on public.phrases to authenticated;

  drop policy if exists "profil : lecture" on public.profiles;
  drop policy if exists "profil : création" on public.profiles;
  drop policy if exists "profil : modification" on public.profiles;
  drop policy if exists "profil : suppression" on public.profiles;
  create policy "profil : lecture" on public.profiles for select to authenticated using ((select auth.uid()) = id);
  create policy "profil : création" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
  create policy "profil : modification" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
  create policy "profil : suppression" on public.profiles for delete to authenticated using ((select auth.uid()) = id);

  drop policy if exists "phrasés : lecture" on public.phrases;
  drop policy if exists "phrasés : création" on public.phrases;
  drop policy if exists "phrasés : modification" on public.phrases;
  drop policy if exists "phrasés : suppression" on public.phrases;
  create policy "phrasés : lecture" on public.phrases for select to authenticated using ((select auth.uid()) = user_id);
  create policy "phrasés : création" on public.phrases for insert to authenticated with check ((select auth.uid()) = user_id);
  create policy "phrasés : modification" on public.phrases for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  create policy "phrasés : suppression" on public.phrases for delete to authenticated using ((select auth.uid()) = user_id);
