-- Perfis do cliente (pedido do Terrani, 03/11/2026): ADM-Cliente, RW-Cliente
-- e RO-Cliente substituem Master B2B e Membro B2B. O assessment da empresa
-- passa a ser UM só, editado por ADM e RW (decisão de 04/11/2026).
--
-- Matriz (escopo empresa; regra aplicada no banco por tem_permissao):
--   adm_cliente: gere as pessoas da própria empresa (convida já escolhendo
--                RW ou RO, troca RW <-> RO, remove), responde, edita e vê os
--                assessments da empresa. Promover alguém a ADM continua só
--                com o super-admin (evita ADM criando ADM sem controle).
--   rw_cliente:  responde, edita e vê o assessment e o roadmap da empresa.
--   ro_cliente:  só vê (nenhuma permissão de escrita, nem no fórum).
--
-- Assessment da empresa:
--   - um rascunho por empresa e setor; quem tem assessment.responder inicia
--     ou retoma o MESMO rascunho;
--   - editar (respostas e cadastro) exige assessment.editar na empresa;
--   - concluir é do servidor, que confere a mesma permissão para a pessoa;
--   - cada pessoa tem a sua conversa com o agente (a transcrição continua
--     privada de quem conversou); as respostas são da empresa;
--   - descartar o rascunho da empresa é só do ADM;
--   - atualizado_por guarda quem editou por último e a auditoria registra
--     cada troca de editor (sem copiar as respostas).
-- Assessment pessoal (sem empresa) continua igual: só o dono edita.
--
-- Produção tinha 0 empresas, 0 vínculos e 0 convites em 03/11/2026; mesmo
-- assim os updates abaixo migram qualquer linha antiga.

-- ------------------------------------------------------------------ papéis

insert into public.roles (codigo, nome, escopo, exige_mfa) values
  ('adm_cliente', 'ADM-Cliente', 'empresa', false),
  ('rw_cliente', 'RW-Cliente', 'empresa', false),
  ('ro_cliente', 'RO-Cliente', 'empresa', false);

insert into public.role_permissions (role, permissao)
select r, p from (values
  ('adm_cliente', 'conteudo.ver'), ('adm_cliente', 'forum.escrever'), ('adm_cliente', 'assessment.responder'),
  ('adm_cliente', 'assessment.ver'), ('adm_cliente', 'assessment.editar'), ('adm_cliente', 'empresa.membros'),
  ('adm_cliente', 'assinatura.empresa'),
  ('rw_cliente', 'conteudo.ver'), ('rw_cliente', 'forum.escrever'), ('rw_cliente', 'assessment.responder'),
  ('rw_cliente', 'assessment.ver'), ('rw_cliente', 'assessment.editar'),
  ('ro_cliente', 'conteudo.ver'), ('ro_cliente', 'assessment.ver')
) as m (r, p);

update public.memberships set role = 'adm_cliente' where role = 'master_b2b';
update public.memberships set role = 'rw_cliente' where role = 'membro_b2b';

-- Convite agora leva o papel (RW ou RO). ADM nunca vem por convite.
alter table public.convites drop constraint convites_role_check;
update public.convites set role = 'rw_cliente' where role <> 'rw_cliente';
alter table public.convites
  alter column role set default 'rw_cliente',
  add constraint convites_role_check check (role in ('rw_cliente', 'ro_cliente'));

-- role_permissions sai em cascata; memberships já não referencia os antigos.
delete from public.roles where codigo in ('master_b2b', 'membro_b2b');

-- ---------------------------------------------------- decisão de acesso

/*
  usuario_tem_permissao: a mesma regra de tem_permissao, para um usuário
  informado. Só as funções do servidor (service_role) usam, depois que a
  aplicação autorizou com a sessão da pessoa; o nível de MFA da sessão vem
  do servidor. Não é chamável pela API.
*/
create function public.usuario_tem_permissao(p_user uuid, p_permissao text, p_org uuid, p_aal2 boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with eu as (
    select p.id
    from public.profiles p
    where p.id = p_user and p.status = 'ativo'
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
    where (not r.exige_mfa or coalesce(p_aal2, false))
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

-- tem_permissao passa a delegar: uma regra só, para a sessão atual.
create or replace function public.tem_permissao(p_permissao text, p_org uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.usuario_tem_permissao(auth.uid(), p_permissao, p_org, public.sessao_aal2());
$$;

revoke execute on function public.usuario_tem_permissao(uuid, text, uuid, boolean) from public, anon, authenticated;

-- ------------------------------------------------- operações do ADM-Cliente

-- Convidar já escolhendo o papel (RW por padrão).
drop function public.empresa_convidar(uuid, text);
create function public.empresa_convidar(p_org uuid, p_email text, p_role text default 'rw_cliente')
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
  if p_role is null or p_role not in ('rw_cliente', 'ro_cliente') then
    raise exception 'o convite só pode ser para RW-Cliente ou RO-Cliente' using errcode = 'check_violation';
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

  insert into public.convites (org_id, email, role, criado_por) values (p_org, alvo, p_role, auth.uid());
end;
$$;

-- Adicionar quem já tem conta (uso interno e testes), com papel RW ou RO.
drop function public.empresa_adicionar_membro(uuid, uuid);
create function public.empresa_adicionar_membro(p_org uuid, p_user uuid, p_role text default 'rw_cliente')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.tem_permissao('empresa.membros', p_org) then
    raise exception 'acesso negado' using errcode = 'insufficient_privilege';
  end if;
  if p_role is null or p_role not in ('rw_cliente', 'ro_cliente') then
    raise exception 'o ADM-Cliente só concede RW-Cliente ou RO-Cliente' using errcode = 'insufficient_privilege';
  end if;
  insert into public.memberships (org_id, user_id, role, adicionado_por)
  values (p_org, p_user, p_role, auth.uid());
  update public.profiles set status = 'ativo' where id = p_user and status = 'pendente';
end;
$$;

-- Trocar RW <-> RO de alguém da própria empresa. Nunca mexe em ADM nem em si.
create function public.empresa_alterar_papel(p_org uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.tem_permissao('empresa.membros', p_org) then
    raise exception 'acesso negado' using errcode = 'insufficient_privilege';
  end if;
  if p_role is null or p_role not in ('rw_cliente', 'ro_cliente') then
    raise exception 'o ADM-Cliente só concede RW-Cliente ou RO-Cliente' using errcode = 'insufficient_privilege';
  end if;
  if p_user = auth.uid() then
    raise exception 'não é permitido alterar o próprio papel' using errcode = 'insufficient_privilege';
  end if;
  update public.memberships set role = p_role
  where org_id = p_org and user_id = p_user and role in ('rw_cliente', 'ro_cliente');
  if not found then
    raise exception 'pessoa não encontrada na empresa' using errcode = 'no_data_found';
  end if;
end;
$$;

create or replace function public.empresa_remover_membro(p_org uuid, p_user uuid)
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
  where org_id = p_org and user_id = p_user and role in ('rw_cliente', 'ro_cliente');
end;
$$;

-- Backoffice: liberar e revogar um produto para a EMPRESA (vale para todos
-- os vínculos dela; quem usa ainda precisa da permissão do papel).
create function public.admin_conceder_direito_empresa(p_org uuid, p_produto text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  if not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'empresa não encontrada' using errcode = 'no_data_found';
  end if;
  insert into public.direitos (org_id, produto, origem, concedido_por)
  values (p_org, p_produto, 'manual', auth.uid())
  on conflict (org_id, produto) where revogado_em is null and org_id is not null do nothing;
end;
$$;

create function public.admin_revogar_direito_empresa(p_org uuid, p_produto text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  update public.direitos set revogado_em = now()
  where org_id = p_org and produto = p_produto and revogado_em is null;
end;
$$;

-- ------------------------------------------------- assessment da empresa

-- Um rascunho por pessoa (pessoal) OU por empresa (da empresa).
drop index public.assessments_rascunho_unico;
create unique index assessments_rascunho_pessoal_unico on public.assessments (user_id, tipo, setor)
  where status = 'rascunho' and org_id is null;
create unique index assessments_rascunho_empresa_unico on public.assessments (org_id, tipo, setor)
  where status = 'rascunho' and org_id is not null;

-- Apagar a empresa não pode transformar o assessment dela em pessoal de quem
-- o iniciou (o "set null" antigo fazia isso): agora o banco recusa; o
-- super-admin remove os assessments antes (admin_remover_assessment).
alter table public.assessments drop constraint assessments_org_id_fkey;
alter table public.assessments add constraint assessments_org_id_fkey
  foreign key (org_id) references public.organizations (id) on delete restrict;

-- Quem editou por último (a coluna não é gravável pelo cliente: vem do gatilho).
alter table public.assessments
  add column atualizado_por uuid references public.profiles (id) on delete set null;

create function public.registrar_editor_assessment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  quem uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.atualizado_por := coalesce(quem, new.user_id);
    return new;
  end if;
  -- Só registra edição de conteúdo; troca de status é da conclusão.
  if new.respostas is distinct from old.respostas or new.empresa is distinct from old.empresa then
    new.atualizado_por := coalesce(quem, old.atualizado_por);
    -- Trilha de quem mexeu no assessment da empresa: um registro a cada troca
    -- de editor (o autosave da mesma pessoa não enche a auditoria).
    if new.org_id is not null and quem is not null and quem is distinct from old.atualizado_por then
      insert into public.audit_log (ator, acao, tabela, alvo, dados)
      values (quem, 'assessment_editado', 'assessments', new.org_id::text,
              jsonb_build_object('assessment', new.id, 'setor', new.setor, 'org', new.org_id));
    end if;
  end if;
  return new;
end;
$$;

create trigger assessments_registrar_editor before insert or update on public.assessments
  for each row execute function public.registrar_editor_assessment();

/*
  pode_editar_assessment: a pessoa pode alterar este rascunho?
  - pessoal: só o dono, com conta ativa;
  - da empresa: quem tem assessment.editar nela (ADM, RW, staff atribuído).
  O nível de MFA vem da sessão (RLS) ou do servidor (funções service_role).
*/
create function public.pode_editar_assessment(p_assessment uuid, p_user uuid, p_aal2 boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.assessments a
    where a.id = p_assessment
      and a.status = 'rascunho'
      and (
        (a.org_id is null and a.user_id = p_user
          and exists (select 1 from public.profiles p where p.id = p_user and p.status = 'ativo'))
        or (a.org_id is not null and public.usuario_tem_permissao(p_user, 'assessment.editar', a.org_id, p_aal2))
      )
  );
$$;

revoke execute on function public.pode_editar_assessment(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.registrar_editor_assessment() from public, anon, authenticated;

-- Iniciar: pessoal retoma o rascunho da pessoa; da empresa retoma o da empresa.
create or replace function public.iniciar_self(p_setor text, p_org uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_setor is distinct from 'food_service' then
    raise exception 'setor ainda não disponível' using errcode = 'check_violation';
  end if;
  if not public.tem_direito('self_assessment', p_org) then
    raise exception 'acesso ao Self assessment não liberado' using errcode = 'insufficient_privilege';
  end if;
  if p_org is not null and not (public.tem_permissao('assessment.responder', p_org)
                                and public.tem_permissao('assessment.editar', p_org)) then
    raise exception 'sem permissão para responder por esta empresa' using errcode = 'insufficient_privilege';
  end if;

  for i in 1..2 loop
    select a.id into v_id from public.assessments a
    where a.tipo = 'self' and a.setor = p_setor and a.status = 'rascunho'
      and (case when p_org is null then a.org_id is null and a.user_id = auth.uid() else a.org_id = p_org end);
    if v_id is not null then
      return v_id;
    end if;
    begin
      insert into public.assessments (user_id, org_id, setor)
      values (auth.uid(), p_org, p_setor)
      returning id into v_id;
      return v_id;
    exception when unique_violation then
      -- Outra pessoa da empresa abriu o rascunho ao mesmo tempo: retoma o dela.
      null;
    end;
  end loop;
  raise exception 'não foi possível abrir o rascunho agora' using errcode = 'check_violation';
end;
$$;

-- Leitura: pessoal só o dono; da empresa quem tem assessment.ver NELA. Quem
-- iniciou o rascunho e saiu da empresa deixa de ler (antes lia por ser o autor).
drop policy "assessment: dono, empresa ou admin le" on public.assessments;
create policy "assessment: dono, empresa ou admin le" on public.assessments
  for select to authenticated
  using (
    (org_id is null and user_id = (select auth.uid()))
    or (org_id is not null and public.tem_permissao('assessment.ver', org_id))
    or public.e_super_admin()
  );

-- Edição pelo navegador: pessoal só o dono; da empresa quem tem assessment.editar.
drop policy "assessment: dono edita rascunho" on public.assessments;
create policy "assessment: dono ou editor da empresa edita rascunho" on public.assessments
  for update to authenticated
  using (
    status = 'rascunho'
    and (
      (org_id is null and user_id = (select auth.uid())
        and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'ativo'))
      or (org_id is not null and public.tem_permissao('assessment.editar', org_id))
    )
  )
  with check (
    status = 'rascunho'
    and (
      (org_id is null and user_id = (select auth.uid()))
      or (org_id is not null and public.tem_permissao('assessment.editar', org_id))
    )
  );

-- Concluir: o servidor informa quem pediu e o MFA da sessão; o banco confere.
drop function public.concluir_self(uuid, uuid, text, jsonb, text, text, text, jsonb);
create function public.concluir_self(
  p_assessment uuid,
  p_user uuid,
  p_hash text,
  p_respostas jsonb,
  p_motor text,
  p_modelo text,
  p_pacote text,
  p_resultado jsonb,
  p_aal2 boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform 1 from public.assessments a
  where a.id = p_assessment and a.status = 'rascunho' and a.respostas = p_respostas
  for update;
  if not found or not public.pode_editar_assessment(p_assessment, p_user, p_aal2) then
    raise exception 'assessment não está em rascunho ou as respostas mudaram' using errcode = 'check_violation';
  end if;

  insert into public.assessment_resultados
    (assessment_id, motor_versao, modelo_versao, pacote_versao, hash_respostas, resultado)
  values (p_assessment, p_motor, p_modelo, p_pacote, p_hash, p_resultado)
  returning id into v_id;

  update public.assessments set status = 'concluido', concluido_em = now() where id = p_assessment;
  return v_id;
end;
$$;

revoke execute on function public.concluir_self(uuid, uuid, text, jsonb, text, text, text, jsonb, boolean) from public, anon, authenticated;

-- Descartar: pessoal só o dono; o rascunho da empresa só o ADM.
create or replace function public.descartar_rascunho(p_assessment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linha public.assessments%rowtype;
begin
  select * into v_linha from public.assessments a
  where a.id = p_assessment
    and (
      (a.org_id is null and a.user_id = auth.uid())
      or (a.org_id is not null and public.tem_permissao('empresa.membros', a.org_id))
    )
  for update;
  if not found then
    raise exception 'assessment não encontrado' using errcode = 'no_data_found';
  end if;
  if v_linha.status <> 'rascunho' then
    raise exception 'só rascunho pode ser descartado' using errcode = 'check_violation';
  end if;

  delete from public.assessments where id = v_linha.id;

  insert into public.audit_log (ator, acao, tabela, alvo, dados)
  values (auth.uid(), 'assessment_descartado', 'assessments', v_linha.user_id::text,
          jsonb_build_object('assessment', v_linha.id, 'setor', v_linha.setor, 'status', v_linha.status,
                             'org', v_linha.org_id));
end;
$$;

-- ------------------------------------------- conversa: uma por pessoa

-- No assessment da empresa várias pessoas conversam com o agente; cada uma
-- tem a própria transcrição (privada) e o próprio teto de turnos.
alter table public.assessment_conversas drop constraint assessment_conversas_pkey;
alter table public.assessment_conversas add primary key (assessment_id, user_id);
create index assessment_conversas_user_idx on public.assessment_conversas (user_id);

drop function public.conversa_reservar_turno(uuid, uuid);
create function public.conversa_reservar_turno(p_assessment uuid, p_user uuid, p_aal2 boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mensagens jsonb;
  v_turnos integer;
begin
  perform 1 from public.assessments a where a.id = p_assessment and a.status = 'rascunho' for update;
  if not found or not public.pode_editar_assessment(p_assessment, p_user, p_aal2) then
    raise exception 'assessment não está em rascunho' using errcode = 'check_violation';
  end if;

  delete from public.assessment_conversas
  where assessment_id = p_assessment and user_id = p_user and expira_em <= now();
  insert into public.assessment_conversas (assessment_id, user_id) values (p_assessment, p_user)
  on conflict (assessment_id, user_id) do nothing;

  select c.mensagens, c.turnos_usuario into v_mensagens, v_turnos
  from public.assessment_conversas c
  where c.assessment_id = p_assessment and c.user_id = p_user
  for update;
  if v_turnos >= public.conversa_max_turnos() then
    raise exception 'limite de mensagens da conversa atingido' using errcode = 'check_violation';
  end if;

  update public.assessment_conversas set turnos_usuario = turnos_usuario + 1
  where assessment_id = p_assessment and user_id = p_user;
  return v_mensagens;
end;
$$;

revoke execute on function public.conversa_reservar_turno(uuid, uuid, boolean) from public, anon, authenticated;

-- ------------------------------------------------------------ privilégios

do $$
declare f text;
begin
  foreach f in array array[
    'empresa_convidar(uuid, text, text)', 'empresa_adicionar_membro(uuid, uuid, text)',
    'empresa_alterar_papel(uuid, uuid, text)', 'admin_conceder_direito_empresa(uuid, text)',
    'admin_revogar_direito_empresa(uuid, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.concluir_self(uuid, uuid, text, jsonb, text, text, text, jsonb, boolean) to service_role;
    grant execute on function public.conversa_reservar_turno(uuid, uuid, boolean) to service_role;
  end if;
end $$;

-- ------------------------------------------------------------ LGPD

-- Exportação: assessments PESSOAIS completos; dos da empresa, só a conversa
-- da própria pessoa (o resto é dado da empresa, lido por quem ela autoriza).
create or replace function public.meus_dados()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'gerado_em', now(),
    'conta', (
      select jsonb_build_object(
        'id', u.id, 'email', u.email, 'criada_em', u.created_at,
        'email_confirmado_em', u.email_confirmed_at, 'ultimo_acesso', u.last_sign_in_at,
        'provedores', coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb)
      )
      from auth.users u where u.id = auth.uid()
    ),
    'perfil', (
      select jsonb_build_object(
        'nome', p.nome, 'status', p.status,
        'aceite_termos_versao', p.aceite_termos_versao, 'aceite_termos_em', p.aceite_termos_em,
        'aceite_marketing', p.aceite_marketing, 'criado_em', p.created_at, 'atualizado_em', p.updated_at
      )
      from public.profiles p where p.id = auth.uid()
    ),
    'papeis', coalesce((
      select jsonb_agg(jsonb_build_object('papel', ur.role, 'desde', ur.concedido_em))
      from public.user_roles ur where ur.user_id = auth.uid()
    ), '[]'::jsonb),
    'empresas', coalesce((
      select jsonb_agg(jsonb_build_object('empresa', o.nome, 'papel', m.role, 'desde', m.created_at))
      from public.memberships m join public.organizations o on o.id = m.org_id
      where m.user_id = auth.uid()
    ), '[]'::jsonb),
    'convites_recebidos', coalesce((
      select jsonb_agg(jsonb_build_object('empresa', o.nome, 'criado_em', c.criado_em,
                                          'aceito_em', c.aceito_em, 'cancelado_em', c.cancelado_em))
      from public.convites c join public.organizations o on o.id = c.org_id
      where c.email = public.meu_email_confirmado()
    ), '[]'::jsonb),
    'solicitacoes_lgpd', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', s.tipo, 'status', s.status,
                                          'criado_em', s.criado_em, 'concluido_em', s.concluido_em))
      from public.solicitacoes_lgpd s where s.user_id = auth.uid()
    ), '[]'::jsonb),
    'acessos_a_produtos', coalesce((
      select jsonb_agg(jsonb_build_object('produto', d.produto, 'origem', d.origem,
                                          'concedido_em', d.concedido_em, 'revogado_em', d.revogado_em))
      from public.direitos d where d.user_id = auth.uid()
    ), '[]'::jsonb),
    'assessments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tipo', a.tipo, 'setor', a.setor, 'status', a.status, 'empresa', a.empresa, 'criado_em', a.criado_em,
        'concluido_em', a.concluido_em, 'respostas', a.respostas,
        'conversa', (
          select jsonb_build_object('mensagens', c.mensagens, 'criada_em', c.criado_em, 'expira_em', c.expira_em)
          from public.assessment_conversas c where c.assessment_id = a.id and c.user_id = auth.uid()
        ),
        'resultados', coalesce((
          select jsonb_agg(jsonb_build_object('calculado_em', r.criado_em, 'motor', r.motor_versao,
                                              'resultado', r.resultado) order by r.criado_em)
          from public.assessment_resultados r where r.assessment_id = a.id
        ), '[]'::jsonb)
      ) order by a.criado_em)
      from public.assessments a where a.org_id is null and a.user_id = auth.uid()
    ), '[]'::jsonb),
    -- Assessment da empresa é dado da empresa, não do titular: entra só a
    -- conversa que a própria pessoa teve com o agente.
    'conversas_em_assessments_da_empresa', coalesce((
      select jsonb_agg(jsonb_build_object('empresa', o.nome, 'setor', a.setor, 'mensagens', c.mensagens,
                                          'criada_em', c.criado_em, 'expira_em', c.expira_em) order by c.criado_em)
      from public.assessment_conversas c
      join public.assessments a on a.id = c.assessment_id
      join public.organizations o on o.id = a.org_id
      where c.user_id = auth.uid() and a.org_id is not null
    ), '[]'::jsonb)
  )
  where auth.uid() is not null;
$$;
