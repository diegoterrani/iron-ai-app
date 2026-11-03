-- Fase 2: RBAC. Papéis e permissões como DADO; regra aplicada no banco.
--
-- Princípios:
-- 1. Acesso = papel ativo + conta ativa (+ MFA para staff). Compra (entitlements)
--    entra na fase 4 e é checada à parte.
-- 2. Nenhuma tabela de papéis aceita escrita direta de usuários: só pelas
--    funções admin_* (security definer, auditadas).
-- 3. Super-admin só é concedido por SQL (nunca pela tela) e o último não sai.
-- 4. Toda mudança relevante cai no audit_log, que só aceita inserção.

-- ---------------------------------------------------------------- catálogo

create table public.roles (
  codigo text primary key,
  nome text not null,
  escopo text not null check (escopo in ('global', 'empresa')),
  exige_mfa boolean not null default false
);

create table public.permissions (
  codigo text primary key,
  descricao text not null,
  -- 'plataforma': vale em toda a plataforma; 'empresa': exige uma empresa.
  escopo text not null check (escopo in ('plataforma', 'empresa'))
);

create table public.role_permissions (
  role text not null references public.roles (codigo) on delete cascade,
  permissao text not null references public.permissions (codigo) on delete cascade,
  primary key (role, permissao)
);

insert into public.roles (codigo, nome, escopo, exige_mfa) values
  ('super_admin', 'Super-admin', 'global', true),
  ('equipe_iron', 'Equipe IRON', 'global', true),
  ('parceiro', 'Parceiro implantador', 'global', false),
  ('master_b2b', 'Master B2B', 'empresa', false),
  ('membro_b2b', 'Membro B2B', 'empresa', false),
  ('aluno_b2c', 'Aluno B2C', 'global', false);

insert into public.permissions (codigo, descricao, escopo) values
  ('conteudo.ver', 'Ver cursos, treinamentos e blog comprados', 'plataforma'),
  ('conteudo.publicar', 'Publicar e editar cursos e blog', 'plataforma'),
  ('forum.escrever', 'Escrever no fórum', 'plataforma'),
  ('forum.moderar', 'Julgar recurso de moderação', 'plataforma'),
  ('assessment.responder', 'Responder Self assessment', 'empresa'),
  ('assessment.ver', 'Ver Deep dive, roadmap e projetos', 'empresa'),
  ('assessment.editar', 'Editar Deep dive e roadmap', 'empresa'),
  ('projeto.tarefas', 'Atualizar tarefas do projeto', 'empresa'),
  ('empresa.membros', 'Convidar e remover membros da empresa', 'empresa'),
  ('assinatura.empresa', 'Gerir assinatura da empresa', 'empresa'),
  ('assinatura.propria', 'Gerir a própria assinatura', 'plataforma'),
  ('admin.backoffice', 'Acessar backoffice, aprovar cadastros, atribuir papéis, auditoria', 'plataforma');

-- Matriz do plano (seção RBAC).
insert into public.role_permissions (role, permissao)
select r, p from (values
  ('super_admin', 'conteudo.ver'), ('super_admin', 'conteudo.publicar'), ('super_admin', 'forum.escrever'),
  ('super_admin', 'forum.moderar'), ('super_admin', 'assessment.responder'), ('super_admin', 'assessment.ver'),
  ('super_admin', 'assessment.editar'), ('super_admin', 'projeto.tarefas'), ('super_admin', 'empresa.membros'),
  ('super_admin', 'assinatura.empresa'), ('super_admin', 'admin.backoffice'),
  ('equipe_iron', 'conteudo.ver'), ('equipe_iron', 'conteudo.publicar'), ('equipe_iron', 'forum.escrever'),
  ('equipe_iron', 'forum.moderar'), ('equipe_iron', 'assessment.responder'), ('equipe_iron', 'assessment.ver'),
  ('equipe_iron', 'assessment.editar'), ('equipe_iron', 'projeto.tarefas'),
  ('parceiro', 'conteudo.ver'), ('parceiro', 'forum.escrever'), ('parceiro', 'assessment.ver'),
  ('parceiro', 'projeto.tarefas'),
  ('master_b2b', 'conteudo.ver'), ('master_b2b', 'forum.escrever'), ('master_b2b', 'assessment.responder'),
  ('master_b2b', 'assessment.ver'), ('master_b2b', 'empresa.membros'), ('master_b2b', 'assinatura.empresa'),
  ('membro_b2b', 'conteudo.ver'), ('membro_b2b', 'forum.escrever'), ('membro_b2b', 'assessment.responder'),
  ('membro_b2b', 'assessment.ver'),
  ('aluno_b2c', 'conteudo.ver'), ('aluno_b2c', 'forum.escrever'), ('aluno_b2c', 'assinatura.propria')
) as m (r, p);

-- ------------------------------------------------------- pessoas e empresas

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 2 and 200),
  cnpj text unique check (cnpj ~ '^[0-9]{14}$'),
  assentos integer not null default 1 check (assentos between 1 and 10000),
  created_at timestamptz not null default now()
);

-- Papéis globais (super_admin, equipe_iron, parceiro, aluno_b2c).
create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null references public.roles (codigo),
  concedido_por uuid references public.profiles (id) on delete set null,
  concedido_em timestamptz not null default now(),
  primary key (user_id, role)
);

-- Papel dentro de uma empresa (master_b2b, membro_b2b). Um por empresa.
create table public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null references public.roles (codigo),
  adicionado_por uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

-- Empresas que cada consultor ou parceiro atende.
create table public.staff_assignments (
  user_id uuid not null references public.profiles (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  atribuido_por uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);
create index staff_assignments_org_idx on public.staff_assignments (org_id);

-- Escopo coerente: papel global só em user_roles, de empresa só em memberships.
create function public.validar_escopo_papel()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  esperado text := case tg_table_name when 'user_roles' then 'global' else 'empresa' end;
begin
  if not exists (select 1 from public.roles r where r.codigo = new.role and r.escopo = esperado) then
    raise exception 'papel % não pode ser usado em %', new.role, tg_table_name using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger user_roles_escopo before insert or update on public.user_roles
  for each row execute function public.validar_escopo_papel();
create trigger memberships_escopo before insert or update on public.memberships
  for each row execute function public.validar_escopo_papel();

-- Assentos: a empresa não passa do contratado.
create function public.validar_assentos()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  usados integer;
  limite integer;
begin
  select o.assentos into limite from public.organizations o where o.id = new.org_id for update;
  select count(*) into usados from public.memberships m where m.org_id = new.org_id;
  if usados >= limite then
    raise exception 'empresa sem assentos disponíveis (% de %)', usados, limite using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger memberships_assentos before insert on public.memberships
  for each row execute function public.validar_assentos();

-- Último super-admin não pode ser removido.
create function public.proteger_ultimo_super_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'super_admin'
     and (select count(*) from public.user_roles where role = 'super_admin') <= 1 then
    raise exception 'não é possível remover o último super-admin' using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

create trigger user_roles_ultimo_super_admin before delete on public.user_roles
  for each row execute function public.proteger_ultimo_super_admin();

-- ---------------------------------------------------------------- auditoria

create table public.audit_log (
  id bigint generated always as identity primary key,
  ator uuid,
  acao text not null,
  tabela text not null,
  alvo text,
  dados jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);
create index audit_log_criado_idx on public.audit_log (criado_em desc);
create index audit_log_ator_idx on public.audit_log (ator);

-- Imutável: nem o dono altera ou apaga linhas (só por drop do gatilho, em migração revisada).
create function public.audit_log_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log é somente inserção' using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_log_sem_update before update or delete on public.audit_log
  for each row execute function public.audit_log_imutavel();
create trigger audit_log_sem_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_imutavel();

-- Gatilho genérico: grava quem, o quê e o antes/depois (sem dados sensíveis).
create function public.auditar_mudanca()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  antes jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  depois jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  linha jsonb := coalesce(depois, antes);
begin
  -- profiles: só interessa mudança de status.
  -- (IFs aninhados: o PL/pgSQL não garante curto-circuito e old/new de
  -- outras tabelas não têm a coluna status.)
  if tg_table_name = 'profiles' and tg_op = 'UPDATE' then
    if (antes ->> 'status') is not distinct from (depois ->> 'status') then
      return null;
    end if;
  end if;
  insert into public.audit_log (ator, acao, tabela, alvo, dados)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(linha ->> 'id', linha ->> 'user_id'),
    jsonb_build_object('antes', antes, 'depois', depois)
  );
  return null;
end;
$$;

create trigger auditar_user_roles after insert or update or delete on public.user_roles
  for each row execute function public.auditar_mudanca();
create trigger auditar_memberships after insert or update or delete on public.memberships
  for each row execute function public.auditar_mudanca();
create trigger auditar_staff after insert or update or delete on public.staff_assignments
  for each row execute function public.auditar_mudanca();
create trigger auditar_organizations after insert or update or delete on public.organizations
  for each row execute function public.auditar_mudanca();
create trigger auditar_profiles_status after update on public.profiles
  for each row execute function public.auditar_mudanca();

-- --------------------------------------------------------- decisão de acesso

-- Sessão com MFA (aal2)? Vem do JWT assinado pelo Supabase Auth.
create function public.sessao_aal2()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

/*
  tem_permissao(permissao, empresa): a regra central, usada nas políticas RLS.
  - conta precisa estar ativa;
  - papel que exige MFA (super_admin, equipe_iron) só vale com sessão aal2;
  - permissão de escopo 'empresa' exige empresa: super_admin vale em todas,
    equipe_iron/parceiro só nas atribuídas, master/membro só na própria.
  Consulta as tabelas a cada chamada (não confia em claims do token), então
  suspender alguém ou tirar um papel vale na hora.
*/
create function public.tem_permissao(p_permissao text, p_org uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with eu as (
    select p.id
    from public.profiles p
    where p.id = auth.uid() and p.status = 'ativo'
  ),
  perm as (
    select escopo from public.permissions where codigo = p_permissao
  )
  select exists (
    -- papéis globais
    select 1
    from eu
    join public.user_roles ur on ur.user_id = eu.id
    join public.roles r on r.codigo = ur.role
    join public.role_permissions rp on rp.role = ur.role and rp.permissao = p_permissao
    cross join perm
    where (not r.exige_mfa or public.sessao_aal2())
      and (
        perm.escopo = 'plataforma'
        or ur.role = 'super_admin'
        or (p_org is not null and exists (
              select 1 from public.staff_assignments sa
              where sa.user_id = eu.id and sa.org_id = p_org))
      )
  ) or exists (
    -- papel dentro da empresa
    select 1
    from eu
    join public.memberships m on m.user_id = eu.id
    join public.role_permissions rp on rp.role = m.role and rp.permissao = p_permissao
    where (p_org is null and (select escopo from perm) = 'plataforma')
       or m.org_id = p_org
  );
$$;

create function public.e_super_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.tem_permissao('admin.backoffice');
$$;

revoke execute on function public.tem_permissao(text, uuid) from public, anon;
grant execute on function public.tem_permissao(text, uuid) to authenticated;
revoke execute on function public.e_super_admin() from public, anon;
grant execute on function public.e_super_admin() to authenticated;
revoke execute on function public.auditar_mudanca() from public, anon, authenticated;

-- -------------------------------------------------------------------- RLS

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.organizations enable row level security;
alter table public.user_roles enable row level security;
alter table public.memberships enable row level security;
alter table public.staff_assignments enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.roles, public.permissions, public.role_permissions, public.organizations,
  public.user_roles, public.memberships, public.staff_assignments, public.audit_log
  from anon, authenticated;

-- Catálogo: leitura para logados (não é segredo; a tela usa para esconder botões).
grant select on public.roles, public.permissions, public.role_permissions to authenticated;
create policy "catalogo: logado le" on public.roles for select to authenticated using (true);
create policy "catalogo: logado le" on public.permissions for select to authenticated using (true);
create policy "catalogo: logado le" on public.role_permissions for select to authenticated using (true);

-- Demais: só leitura, e só o que diz respeito ao usuário. Escrita só via admin_*.
grant select on public.organizations, public.user_roles, public.memberships,
  public.staff_assignments, public.audit_log to authenticated;

create policy "empresa: membro, staff atribuido ou admin le" on public.organizations
  for select to authenticated
  using (
    public.e_super_admin()
    or exists (select 1 from public.memberships m where m.org_id = id and m.user_id = (select auth.uid()))
    or exists (select 1 from public.staff_assignments s where s.org_id = id and s.user_id = (select auth.uid()))
  );

create policy "papeis: proprio ou admin le" on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or public.e_super_admin());

create policy "vinculos: proprio, gestor da empresa ou admin le" on public.memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.tem_permissao('empresa.membros', org_id)
    or public.e_super_admin()
  );

create policy "atribuicoes: proprio ou admin le" on public.staff_assignments
  for select to authenticated
  using (user_id = (select auth.uid()) or public.e_super_admin());

create policy "auditoria: so admin le" on public.audit_log
  for select to authenticated
  using (public.e_super_admin());

-- Super-admin vê todos os perfis (backoffice).
create policy "perfil: admin le todos" on public.profiles
  for select to authenticated
  using (public.e_super_admin());

-- ----------------------------------------------------- operações do backoffice
-- Todas: exigem super-admin com MFA, recusam agir sobre si mesmo quando isso
-- seria escalada, e são auditadas pelos gatilhos acima.

create function public.exigir_super_admin()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not public.e_super_admin() then
    raise exception 'acesso negado' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create function public.admin_definir_status(p_user uuid, p_status public.status_conta)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  if p_user = auth.uid() then
    raise exception 'não é permitido alterar o próprio status' using errcode = 'insufficient_privilege';
  end if;
  update public.profiles set status = p_status where id = p_user;
  if not found then raise exception 'usuário não encontrado' using errcode = 'no_data_found'; end if;
end;
$$;

create function public.admin_conceder_papel(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  if p_role = 'super_admin' then
    raise exception 'super-admin só é concedido por comando no banco' using errcode = 'insufficient_privilege';
  end if;
  if p_user = auth.uid() then
    raise exception 'não é permitido alterar os próprios papéis' using errcode = 'insufficient_privilege';
  end if;
  insert into public.user_roles (user_id, role, concedido_por)
  values (p_user, p_role, auth.uid())
  on conflict do nothing;
end;
$$;

create function public.admin_revogar_papel(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  if p_role = 'super_admin' or p_user = auth.uid() then
    raise exception 'operação não permitida pela tela' using errcode = 'insufficient_privilege';
  end if;
  delete from public.user_roles where user_id = p_user and role = p_role;
end;
$$;

create function public.admin_criar_empresa(p_nome text, p_cnpj text, p_assentos integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  novo uuid;
begin
  perform public.exigir_super_admin();
  insert into public.organizations (nome, cnpj, assentos)
  values (trim(p_nome), nullif(regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g'), ''), p_assentos)
  returning id into novo;
  return novo;
end;
$$;

create function public.admin_definir_assentos(p_org uuid, p_assentos integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  if p_assentos < (select count(*) from public.memberships where org_id = p_org) then
    raise exception 'há mais membros do que o novo limite de assentos' using errcode = 'check_violation';
  end if;
  update public.organizations set assentos = p_assentos where id = p_org;
end;
$$;

create function public.admin_vincular_empresa(p_org uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  insert into public.memberships (org_id, user_id, role, adicionado_por)
  values (p_org, p_user, p_role, auth.uid())
  on conflict (org_id, user_id) do update set role = excluded.role;
end;
$$;

create function public.admin_atribuir_staff(p_user uuid, p_org uuid, p_atribuir boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  if p_atribuir then
    if not exists (select 1 from public.user_roles where user_id = p_user and role in ('equipe_iron', 'parceiro')) then
      raise exception 'só Equipe IRON ou Parceiro podem ser atribuídos a empresas' using errcode = 'check_violation';
    end if;
    insert into public.staff_assignments (user_id, org_id, atribuido_por)
    values (p_user, p_org, auth.uid())
    on conflict do nothing;
  else
    delete from public.staff_assignments where user_id = p_user and org_id = p_org;
  end if;
end;
$$;

-- Master B2B adiciona/remove Membros da PRÓPRIA empresa (nunca outro Master).
-- O convite por e-mail (criar a conta) é feito pelo servidor na fase 3.
create function public.empresa_adicionar_membro(p_org uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.tem_permissao('empresa.membros', p_org) then
    raise exception 'acesso negado' using errcode = 'insufficient_privilege';
  end if;
  insert into public.memberships (org_id, user_id, role, adicionado_por)
  values (p_org, p_user, 'membro_b2b', auth.uid());
  -- Convite aceito entra ativo (decisão do plano).
  update public.profiles set status = 'ativo' where id = p_user and status = 'pendente';
end;
$$;

create function public.empresa_remover_membro(p_org uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.tem_permissao('empresa.membros', p_org) then
    raise exception 'acesso negado' using errcode = 'insufficient_privilege';
  end if;
  delete from public.memberships
  where org_id = p_org and user_id = p_user and role = 'membro_b2b';
end;
$$;

-- Execução: só logados (cada função ainda checa o papel por dentro).
do $$
declare f text;
begin
  foreach f in array array[
    'admin_definir_status(uuid, public.status_conta)', 'admin_conceder_papel(uuid, text)',
    'admin_revogar_papel(uuid, text)', 'admin_criar_empresa(text, text, integer)',
    'admin_definir_assentos(uuid, integer)', 'admin_vincular_empresa(uuid, uuid, text)',
    'admin_atribuir_staff(uuid, uuid, boolean)', 'empresa_adicionar_membro(uuid, uuid)',
    'empresa_remover_membro(uuid, uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

revoke execute on function public.exigir_super_admin() from public, anon, authenticated;
