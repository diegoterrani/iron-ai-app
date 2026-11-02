-- Fase 3: leituras e operações que faltavam para o backoffice.
--
-- O e-mail mora em auth.users, que o cliente não lê. Em vez de abrir auth
-- para o app ou usar a chave secreta, expomos funções security definer que:
--   1. só respondem para super-admin com MFA (exigir_super_admin);
--   2. devolvem só as colunas necessárias (nada de hash, token ou metadado bruto);
--   3. limitam o tamanho da página (anti-raspagem).

-- Lista de usuários com filtro por status e busca por nome ou e-mail.
create function public.admin_listar_usuarios(
  p_status public.status_conta default null,
  p_busca text default null,
  p_limite integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  nome text,
  email text,
  status public.status_conta,
  criado_em timestamptz,
  ultimo_acesso timestamptz,
  papeis text[],
  total bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Busca literal: escapa os curingas do LIKE (%, _ e a própria barra).
  padrao text := case
    when nullif(trim(coalesce(p_busca, '')), '') is null then null
    else '%' || replace(replace(replace(left(trim(p_busca), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;
begin
  perform public.exigir_super_admin();
  return query
    select
      p.id,
      p.nome,
      u.email::text,
      p.status,
      p.created_at,
      u.last_sign_in_at,
      coalesce(
        (select array_agg(ur.role order by ur.role) from public.user_roles ur where ur.user_id = p.id),
        '{}'::text[]
      ) || coalesce(
        (select array_agg(m.role order by m.role) from public.memberships m where m.user_id = p.id),
        '{}'::text[]
      ),
      count(*) over ()
    from public.profiles p
    join auth.users u on u.id = p.id
    where (p_status is null or p.status = p_status)
      and (padrao is null or p.nome ilike padrao or u.email ilike padrao)
    order by p.created_at desc, p.id
    limit greatest(1, least(coalesce(p_limite, 50), 100))
    offset greatest(0, coalesce(p_offset, 0));
end;
$$;

-- Ficha de um usuário: e-mail, provedores de login e se tem MFA ativo.
create function public.admin_obter_usuario(p_user uuid)
returns table (
  id uuid,
  nome text,
  email text,
  status public.status_conta,
  criado_em timestamptz,
  ultimo_acesso timestamptz,
  provedores text[],
  mfa_ativo boolean,
  aceite_termos_versao text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  return query
    select
      p.id,
      p.nome,
      u.email::text,
      p.status,
      p.created_at,
      u.last_sign_in_at,
      coalesce(
        array(select jsonb_array_elements_text(u.raw_app_meta_data -> 'providers')),
        '{}'::text[]
      ),
      exists (
        select 1 from auth.mfa_factors f
        where f.user_id = p.id and f.status::text = 'verified'
      ),
      p.aceite_termos_versao
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = p_user;
end;
$$;

-- Acha a conta pelo e-mail exato (para vincular a uma empresa).
create function public.admin_buscar_usuario_por_email(p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  achado uuid;
begin
  perform public.exigir_super_admin();
  select u.id into achado
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(u.email) = lower(trim(p_email))
  limit 1;
  return achado;
end;
$$;

-- Tira alguém de uma empresa (Master ou Membro). Auditado pelo gatilho.
create function public.admin_desvincular_empresa(p_org uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  delete from public.memberships where org_id = p_org and user_id = p_user;
  if not found then
    raise exception 'vínculo não encontrado' using errcode = 'no_data_found';
  end if;
end;
$$;

-- Números da tela inicial do backoffice.
create function public.admin_contadores()
returns table (pendentes bigint, ativos bigint, suspensos bigint, empresas bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  return query
    select
      (select count(*) from public.profiles where status = 'pendente'),
      (select count(*) from public.profiles where status = 'ativo'),
      (select count(*) from public.profiles where status = 'suspenso'),
      (select count(*) from public.organizations);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'admin_listar_usuarios(public.status_conta, text, integer, integer)',
    'admin_obter_usuario(uuid)',
    'admin_buscar_usuario_por_email(text)',
    'admin_desvincular_empresa(uuid, uuid)',
    'admin_contadores()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
