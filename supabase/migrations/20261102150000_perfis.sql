-- Fase 1: perfil de cada usuário, criado no cadastro com status "pendente".
-- Regra de ouro: o usuário lê o próprio perfil e só edita nome e marketing.
-- Status e papéis só mudam pelo backoffice (fase 2/3), nunca pelo próprio usuário.

create type public.status_conta as enum ('pendente', 'ativo', 'suspenso');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null check (char_length(nome) between 2 and 100),
  status public.status_conta not null default 'pendente',
  -- LGPD: versão e data do aceite. Nulo = entrou por Google/Microsoft e
  -- ainda não aceitou na tela de boas-vindas (gate na próxima etapa).
  aceite_termos_versao text,
  aceite_termos_em timestamptz,
  aceite_marketing boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Perfil do usuário; status controlado só pelo super-admin.';

-- RLS ligado (sem FORCE): o dono da tabela, usado só pelas funções
-- security definer revisadas, passa; anon/authenticated ficam sob as políticas.
-- FORCE quebraria o gatilho de cadastro (provado em supabase/tests).
alter table public.profiles enable row level security;

-- Privilégios mínimos: anon não vê nada; authenticated lê e edita 2 colunas.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (nome, aceite_marketing) on public.profiles to authenticated;

create policy "perfil: dono le o proprio"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "perfil: dono edita o proprio"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- updated_at automático.
create function public.tocar_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.tocar_updated_at();

-- Cria o perfil quando o Supabase Auth cria o usuário (senha ou OAuth).
-- security definer: roda como dono da tabela, por isso search_path vazio
-- e nomes totalmente qualificados (evita sequestro de search_path).
create function public.criar_perfil_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  nome_bruto text := coalesce(meta ->> 'nome', meta ->> 'full_name', meta ->> 'name', split_part(new.email, '@', 1));
  versao text := meta ->> 'aceite_termos_versao';
begin
  insert into public.profiles (id, nome, aceite_termos_versao, aceite_termos_em, aceite_marketing)
  values (
    new.id,
    case when char_length(trim(coalesce(nome_bruto, ''))) < 2 then 'Usuário' else left(trim(nome_bruto), 100) end,
    versao,
    case when versao is not null then now() end,
    coalesce((meta ->> 'aceite_marketing')::boolean, false)
  );
  return new;
end;
$$;

revoke execute on function public.criar_perfil_novo_usuario() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.criar_perfil_novo_usuario();
