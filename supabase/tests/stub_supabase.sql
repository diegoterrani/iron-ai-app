-- Simula o mínimo do Supabase num Postgres local, só para testes:
-- papéis anon/authenticated, schema auth com users e auth.uid().
-- NÃO é migração; nunca roda no projeto real.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  -- Dono das migrações SEM superuser e SEM bypassrls, como no Supabase
  -- hospedado: assim o teste pega política RLS que só passaria como superuser.
  if not exists (select 1 from pg_roles where rolname = 'migrador') then
    create role migrador nologin nosuperuser nobypassrls;
  end if;
end $$;
grant anon, authenticated to migrador;
grant create, usage on schema public to migrador;

create schema if not exists auth authorization migrador;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb
);

alter table auth.users owner to migrador;

create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- Claims do JWT (o teste define aal = aal1/aal2 para simular MFA).
create or replace function auth.jwt() returns jsonb
language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
