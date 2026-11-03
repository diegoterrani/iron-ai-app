-- Fase 3b: Master convida colegas por e-mail.
--
-- Fluxo:
-- 1. Master chama empresa_convidar(empresa, e-mail): o banco confere a
--    permissão, os assentos e o limite diário e grava um convite pendente.
-- 2. O servidor manda o e-mail de convite (Supabase Auth). Se a pessoa já
--    tem conta, nenhum e-mail novo é criado e a resposta ao Master é a mesma
--    (não revela quem tem conta).
-- 3. A pessoa entra (link do convite ou login normal) e vê o convite.
--    Só ela aceita: aceitar_convite confere que o e-mail CONFIRMADO da conta
--    é o do convite. Aceitar cria o vínculo de Membro e ativa a conta.

create table public.convites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  -- Convite sempre gera Membro; Master só é definido pelo super-admin.
  role text not null default 'membro_b2b' check (role = 'membro_b2b'),
  criado_por uuid references public.profiles (id) on delete set null,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '7 days',
  aceito_em timestamptz,
  aceito_por uuid references public.profiles (id) on delete set null,
  cancelado_em timestamptz
);

-- Um convite pendente por e-mail e empresa.
create unique index convites_pendente_unico on public.convites (org_id, email)
  where aceito_em is null and cancelado_em is null;
create index convites_email_idx on public.convites (email) where aceito_em is null and cancelado_em is null;

alter table public.convites enable row level security;
revoke all on public.convites from anon, authenticated;
grant select on public.convites to authenticated;

-- Quem gere a empresa (Master ou super-admin) vê os convites dela.
-- O convidado vê os próprios pela função meus_convites (que mostra o nome da empresa).
create policy "convites: gestor da empresa le" on public.convites
  for select to authenticated
  using (public.tem_permissao('empresa.membros', org_id));

create trigger auditar_convites after insert or update or delete on public.convites
  for each row execute function public.auditar_mudanca();

-- Convites que ainda valem (não aceitos, não cancelados, não vencidos).
create function public.convite_vigente(c public.convites)
returns boolean
language sql
stable
set search_path = ''
as $$
  select c.aceito_em is null and c.cancelado_em is null and c.expira_em > now();
$$;

-- E-mail confirmado da sessão atual (nulo se ainda não confirmou).
create function public.meu_email_confirmado()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email::text)
  from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;
$$;

-- ------------------------------------------------------------ lado do Master

create function public.empresa_convidar(p_org uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  alvo text := lower(trim(coalesce(p_email, '')));
  limite integer;
  usados integer;
  hoje integer;
begin
  if not public.tem_permissao('empresa.membros', p_org) then
    raise exception 'acesso negado' using errcode = 'insufficient_privilege';
  end if;
  if alvo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(alvo) > 254 then
    raise exception 'e-mail inválido' using errcode = 'check_violation';
  end if;

  -- Freio contra abuso (envio de e-mail em massa pela conta da empresa).
  select count(*) into hoje from public.convites
  where org_id = p_org and criado_em > now() - interval '1 day';
  if hoje >= 50 then
    raise exception 'limite de 50 convites por dia atingido' using errcode = 'check_violation';
  end if;

  -- Já é da empresa? (mensagem só para quem gere a empresa)
  if exists (
    select 1 from public.memberships m join auth.users u on u.id = m.user_id
    where m.org_id = p_org and lower(u.email::text) = alvo
  ) then
    raise exception 'essa pessoa já faz parte da empresa' using errcode = 'check_violation';
  end if;

  -- Convite vencido não bloqueia um novo.
  update public.convites set cancelado_em = now()
  where org_id = p_org and email = alvo and aceito_em is null and cancelado_em is null and expira_em <= now();

  if exists (
    select 1 from public.convites c
    where c.org_id = p_org and c.email = alvo and public.convite_vigente(c)
  ) then
    raise exception 'já existe um convite pendente para esse e-mail' using errcode = 'check_violation';
  end if;

  -- Assentos: membros + convites pendentes não passam do contratado.
  select o.assentos into limite from public.organizations o where o.id = p_org for update;
  select (select count(*) from public.memberships where org_id = p_org)
       + (select count(*) from public.convites c where c.org_id = p_org and public.convite_vigente(c))
    into usados;
  if usados >= limite then
    raise exception 'empresa sem assentos disponíveis (% de %)', usados, limite using errcode = 'check_violation';
  end if;

  insert into public.convites (org_id, email, criado_por) values (p_org, alvo, auth.uid());
end;
$$;

create function public.empresa_cancelar_convite(p_convite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid;
begin
  select c.org_id into org from public.convites c
  where c.id = p_convite and c.aceito_em is null and c.cancelado_em is null;
  if org is null or not public.tem_permissao('empresa.membros', org) then
    -- Mesma resposta para "não existe" e "não é seu" (não revela convites alheios).
    raise exception 'convite não encontrado' using errcode = 'no_data_found';
  end if;
  update public.convites set cancelado_em = now() where id = p_convite;
end;
$$;

-- Pessoas da empresa com nome e e-mail (o Master não lê perfis alheios pelo RLS).
create function public.empresa_listar_membros(p_org uuid)
returns table (user_id uuid, nome text, email text, role text, status public.status_conta, desde timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.tem_permissao('empresa.membros', p_org) then
    raise exception 'acesso negado' using errcode = 'insufficient_privilege';
  end if;
  return query
    select m.user_id, p.nome, u.email::text, m.role, p.status, m.created_at
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    join auth.users u on u.id = m.user_id
    where m.org_id = p_org
    order by m.role, p.nome;
end;
$$;

-- ---------------------------------------------------------- lado do convidado

-- Convites para o e-mail confirmado da sessão. Vale para conta pendente também.
create function public.meus_convites()
returns table (id uuid, empresa text, expira_em timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, o.nome, c.expira_em
  from public.convites c
  join public.organizations o on o.id = c.org_id
  where c.email = public.meu_email_confirmado()
    and public.convite_vigente(c)
  order by c.criado_em;
$$;

create function public.aceitar_convite(p_convite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.convites;
  meu_status public.status_conta;
begin
  select * into c from public.convites
  where id = p_convite and email = public.meu_email_confirmado()
  for update;
  if c.id is null or not public.convite_vigente(c) then
    raise exception 'convite não encontrado ou vencido' using errcode = 'no_data_found';
  end if;

  select status into meu_status from public.profiles where id = auth.uid();
  if meu_status = 'suspenso' then
    raise exception 'conta suspensa' using errcode = 'insufficient_privilege';
  end if;

  -- O gatilho validar_assentos ainda confere o limite aqui.
  insert into public.memberships (org_id, user_id, role, adicionado_por)
  values (c.org_id, auth.uid(), c.role, c.criado_por)
  on conflict (org_id, user_id) do nothing;

  update public.convites set aceito_em = now(), aceito_por = auth.uid() where id = c.id;
  -- Convite aceito entra ativo (decisão do plano).
  update public.profiles set status = 'ativo' where id = auth.uid() and status = 'pendente';
end;
$$;

create function public.recusar_convite(p_convite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.convites set cancelado_em = now()
  where id = p_convite and email = public.meu_email_confirmado()
    and aceito_em is null and cancelado_em is null;
  if not found then
    raise exception 'convite não encontrado' using errcode = 'no_data_found';
  end if;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'empresa_convidar(uuid, text)', 'empresa_cancelar_convite(uuid)', 'empresa_listar_membros(uuid)',
    'meus_convites()', 'aceitar_convite(uuid)', 'recusar_convite(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

revoke execute on function public.meu_email_confirmado() from public, anon, authenticated;
revoke execute on function public.convite_vigente(public.convites) from public, anon, authenticated;
