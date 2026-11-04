-- Testes dos perfis do cliente (ADM, RW e RO-Cliente) e do assessment da empresa.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('80000000-0000-0000-0000-000000000001', 'admin@iron.io', '{"nome":"Admin"}', now()),
  ('80000000-0000-0000-0000-000000000002', 'adm@a.com',     '{"nome":"ADM A"}', now()),
  ('80000000-0000-0000-0000-000000000003', 'rw@a.com',      '{"nome":"RW A"}', now()),
  ('80000000-0000-0000-0000-000000000004', 'ro@a.com',      '{"nome":"RO A"}', now()),
  ('80000000-0000-0000-0000-000000000005', 'adm@b.com',     '{"nome":"ADM B"}', now()),
  ('80000000-0000-0000-0000-000000000006', 'novo@a.com',    '{"nome":"Novo"}', now()),
  ('80000000-0000-0000-0000-000000000007', 'rw2@a.com',     '{"nome":"RW2 A"}', now());
update public.profiles set status = 'ativo' where id::text like '80000000-%' and id <> '80000000-0000-0000-0000-000000000006';
insert into public.user_roles (user_id, role) values ('80000000-0000-0000-0000-000000000001', 'super_admin');

create function pg_temp.como(p_user text, p_aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user, true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'aal', p_aal)::text, true);
$$;
create function pg_temp.falha(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'FALHA: %', p_msg;
end;
$$;
create temp table ctx (chave text primary key, valor text);
grant all on ctx to authenticated, service_role;

-- ===== Cenário pelo backoffice (super-admin com MFA)
set local role authenticated;
select pg_temp.como('80000000-0000-0000-0000-000000000001', 'aal2');
do $$
declare a uuid; b uuid;
begin
  a := public.admin_criar_empresa('Empresa A', null, 6);
  b := public.admin_criar_empresa('Empresa B', null, 2);
  insert into ctx values ('a', a), ('b', b);
  perform public.admin_vincular_empresa(a, '80000000-0000-0000-0000-000000000002', 'adm_cliente');
  perform public.admin_vincular_empresa(a, '80000000-0000-0000-0000-000000000003', 'rw_cliente');
  perform public.admin_vincular_empresa(a, '80000000-0000-0000-0000-000000000004', 'ro_cliente');
  perform public.admin_vincular_empresa(a, '80000000-0000-0000-0000-000000000007', 'rw_cliente');
  perform public.admin_vincular_empresa(b, '80000000-0000-0000-0000-000000000005', 'adm_cliente');
  perform public.admin_conceder_direito_empresa(a, 'self_assessment');
  perform public.admin_conceder_direito_empresa(a, 'self_assessment'); -- repetir não duplica
  if (select count(*) from public.direitos where org_id = a and revogado_em is null) <> 1 then
    raise exception 'FALHA: direito da empresa duplicado';
  end if;
end $$;

-- ===== Os papéis antigos não existem mais
do $$ begin
  if exists (select 1 from public.roles where codigo in ('master_b2b', 'membro_b2b')) then
    raise exception 'FALHA: papel antigo continua no catálogo';
  end if;
end $$;

-- ===== Matriz
do $$
declare
  a uuid := (select valor from ctx where chave = 'a');
  b uuid := (select valor from ctx where chave = 'b');
  caso record;
  obtido boolean;
begin
  for caso in
    select * from (values
      ('2', 'empresa.membros', 'a', true),
      ('2', 'assessment.editar', 'a', true),
      ('2', 'assinatura.empresa', 'a', true),
      ('2', 'empresa.membros', 'b', false),
      ('3', 'assessment.responder', 'a', true),
      ('3', 'assessment.editar', 'a', true),
      ('3', 'assessment.ver', 'a', true),
      ('3', 'empresa.membros', 'a', false),
      ('3', 'assinatura.empresa', 'a', false),
      ('4', 'assessment.ver', 'a', true),
      ('4', 'assessment.editar', 'a', false),
      ('4', 'assessment.responder', 'a', false),
      ('4', 'empresa.membros', 'a', false),
      ('4', 'forum.escrever', null, false),
      ('4', 'conteudo.ver', null, true),
      ('5', 'assessment.ver', 'a', false)
    ) as t (u, perm, org, esperado)
  loop
    perform pg_temp.como('80000000-0000-0000-0000-00000000000' || caso.u);
    obtido := public.tem_permissao(caso.perm, case caso.org when 'a' then a when 'b' then b end);
    if obtido is distinct from caso.esperado then
      raise exception 'FALHA matriz: usuário % em % / empresa % deu %, esperado %',
        caso.u, caso.perm, coalesce(caso.org, '-'), obtido, caso.esperado;
    end if;
  end loop;
end $$;

-- ===== ADM-Cliente gere as pessoas: só RW/RO, só na própria empresa, nunca ADM nem a si
do $$
declare
  a uuid := (select valor from ctx where chave = 'a');
  b uuid := (select valor from ctx where chave = 'b');
begin
  perform pg_temp.como('80000000-0000-0000-0000-000000000002');
  perform public.empresa_convidar(a, 'novo@a.com', 'ro_cliente');
  if (select role from public.convites where email = 'novo@a.com') <> 'ro_cliente' then
    raise exception 'FALHA: convite não guardou o papel';
  end if;
  perform pg_temp.falha(format($q$select public.empresa_convidar(%L, 'x@a.com', 'adm_cliente')$q$, a), 'convidou ADM');
  perform pg_temp.falha(format($q$select public.empresa_convidar(%L, 'x@a.com', 'super_admin')$q$, a), 'convidou super-admin');
  perform pg_temp.falha(format($q$select public.empresa_convidar(%L, 'x@b.com', 'rw_cliente')$q$, b), 'ADM A convidou na B');

  perform public.empresa_alterar_papel(a, '80000000-0000-0000-0000-000000000004', 'rw_cliente');
  perform public.empresa_alterar_papel(a, '80000000-0000-0000-0000-000000000004', 'ro_cliente');
  perform pg_temp.falha(format($q$select public.empresa_alterar_papel(%L, '80000000-0000-0000-0000-000000000003', 'adm_cliente')$q$, a),
    'ADM promoveu alguém a ADM');
  perform pg_temp.falha(format($q$select public.empresa_alterar_papel(%L, '80000000-0000-0000-0000-000000000002', 'rw_cliente')$q$, a),
    'ADM alterou o próprio papel');
  perform pg_temp.falha(format($q$select public.empresa_alterar_papel(%L, '80000000-0000-0000-0000-000000000005', 'ro_cliente')$q$, b),
    'ADM A alterou papel na empresa B');
  perform pg_temp.falha(format($q$update public.memberships set role = 'adm_cliente' where org_id = %L$q$, a),
    'update direto em memberships');

  -- RW e RO não gerem pessoas
  perform pg_temp.como('80000000-0000-0000-0000-000000000003');
  perform pg_temp.falha(format($q$select public.empresa_alterar_papel(%L, '80000000-0000-0000-0000-000000000004', 'rw_cliente')$q$, a),
    'RW alterou papel');
  perform pg_temp.falha(format($q$select public.empresa_convidar(%L, 'y@a.com', 'rw_cliente')$q$, a), 'RW convidou');
  perform pg_temp.como('80000000-0000-0000-0000-000000000004');
  perform pg_temp.falha(format($q$select public.empresa_convidar(%L, 'y@a.com', 'ro_cliente')$q$, a), 'RO convidou');
end $$;

-- Convidado aceita e entra com o papel do convite (RO).
reset role;
insert into ctx select 'convite', id from public.convites where email = 'novo@a.com';
set local role authenticated;
select pg_temp.como('80000000-0000-0000-0000-000000000006');
select public.aceitar_convite((select valor from ctx where chave = 'convite')::uuid);
do $$ begin
  if (select role from public.memberships where user_id = '80000000-0000-0000-0000-000000000006') <> 'ro_cliente' then
    raise exception 'FALHA: convidado não entrou como RO';
  end if;
end $$;

-- ===== Assessment da empresa: um rascunho só, editado por ADM e RW
do $$
declare
  a uuid := (select valor from ctx where chave = 'a');
  v1 uuid;
  v2 uuid;
begin
  perform pg_temp.como('80000000-0000-0000-0000-000000000003');
  v1 := public.iniciar_self('food_service', a);
  perform pg_temp.como('80000000-0000-0000-0000-000000000002');
  v2 := public.iniciar_self('food_service', a);
  if v1 <> v2 then raise exception 'FALHA: ADM abriu outro rascunho da empresa'; end if;
  insert into ctx values ('id', v1);

  perform pg_temp.como('80000000-0000-0000-0000-000000000004');
  perform pg_temp.falha(format($q$select public.iniciar_self('food_service', %L)$q$, a), 'RO iniciou assessment');
  perform pg_temp.como('80000000-0000-0000-0000-000000000005');
  perform pg_temp.falha(format($q$select public.iniciar_self('food_service', %L)$q$, a), 'ADM B iniciou na empresa A');
end $$;

do $$
declare
  v uuid := (select valor from ctx where chave = 'id');
  n int;
begin
  -- RW (quem iniciou) edita; a troca de editor (RW -> ADM) vai para a auditoria
  perform pg_temp.como('80000000-0000-0000-0000-000000000003');
  update public.assessments set respostas = '{"setor":"food_service","q3":"101 a 500"}' where id = v;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALHA: RW não editou'; end if;

  perform pg_temp.como('80000000-0000-0000-0000-000000000002');
  update public.assessments set empresa = '{"nome":"Empresa A"}' where id = v;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALHA: ADM não editou'; end if;

  -- RO lê, mas não edita; empresa B nem lê
  perform pg_temp.como('80000000-0000-0000-0000-000000000004');
  select count(*) into n from public.assessments where id = v;
  if n <> 1 then raise exception 'FALHA: RO não leu o assessment da empresa'; end if;
  update public.assessments set respostas = '{}' where id = v;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: RO editou'; end if;
  perform pg_temp.falha(format($q$select public.descartar_rascunho(%L)$q$, v), 'RO descartou');

  perform pg_temp.como('80000000-0000-0000-0000-000000000005');
  select count(*) into n from public.assessments where id = v;
  if n <> 0 then raise exception 'FALHA: ADM B leu o assessment da empresa A'; end if;
  update public.assessments set respostas = '{}' where id = v;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: ADM B editou'; end if;

  -- RW não descarta o rascunho da empresa (só o ADM)
  perform pg_temp.como('80000000-0000-0000-0000-000000000003');
  perform pg_temp.falha(format($q$select public.descartar_rascunho(%L)$q$, v), 'RW descartou o rascunho da empresa');
end $$;

reset role;
do $$
declare v uuid := (select valor from ctx where chave = 'id');
begin
  if (select atualizado_por from public.assessments where id = v) <> '80000000-0000-0000-0000-000000000002' then
    raise exception 'FALHA: atualizado_por não registrou o último editor';
  end if;
  if (select count(*) from public.audit_log where acao = 'assessment_editado' and dados ->> 'assessment' = v::text) <> 1 then
    raise exception 'FALHA: auditoria não registrou a troca de editor';
  end if;
end $$;

-- ===== Servidor: conversa por pessoa e conclusão conferem a permissão de quem pediu
set local role service_role;
do $$
declare
  v uuid := (select valor from ctx where chave = 'id');
begin
  perform public.conversa_reservar_turno(v, '80000000-0000-0000-0000-000000000003');
  perform public.conversa_reservar_turno(v, '80000000-0000-0000-0000-000000000002');
  perform pg_temp.falha(format($q$select public.conversa_reservar_turno(%L, '80000000-0000-0000-0000-000000000004')$q$, v),
    'RO conversou');
  perform pg_temp.falha(format($q$select public.conversa_reservar_turno(%L, '80000000-0000-0000-0000-000000000005')$q$, v),
    'ADM B conversou');
  -- super-admin sem MFA informado pelo servidor não edita
  perform pg_temp.falha(format($q$select public.conversa_reservar_turno(%L, '80000000-0000-0000-0000-000000000001')$q$, v),
    'super-admin sem MFA conversou');
  perform public.conversa_reservar_turno(v, '80000000-0000-0000-0000-000000000001', true);

  perform pg_temp.falha(format($q$select public.concluir_self(%L, '80000000-0000-0000-0000-000000000004', '0123456789abcdef',
    '{"setor":"food_service","q3":"101 a 500"}', '0', '0', '0', '{}')$q$, v), 'RO concluiu');
end $$;
reset role;
do $$ begin
  if (select count(*) from public.assessment_conversas where assessment_id = (select valor from ctx where chave = 'id')::uuid) <> 3 then
    raise exception 'FALHA: conversa não é por pessoa';
  end if;
end $$;

-- Cada um lê só a própria conversa.
set local role authenticated;
select pg_temp.como('80000000-0000-0000-0000-000000000003');
do $$ begin
  if (select count(*) from public.assessment_conversas) <> 1 then
    raise exception 'FALHA: RW leu conversa de outra pessoa';
  end if;
end $$;

-- LGPD: assessment da empresa não sai como dado pessoal; a conversa da pessoa sai.
do $$
declare d jsonb := public.meus_dados();
begin
  if jsonb_array_length(d -> 'assessments') <> 0 then
    raise exception 'FALHA: exportação levou o assessment da empresa';
  end if;
  if jsonb_array_length(d -> 'conversas_em_assessments_da_empresa') <> 1 then
    raise exception 'FALHA: exportação não levou a conversa da pessoa';
  end if;
end $$;

-- Rebaixado a RO, o RW perde a edição na hora.
select pg_temp.como('80000000-0000-0000-0000-000000000002');
select public.empresa_alterar_papel((select valor from ctx where chave = 'a')::uuid, '80000000-0000-0000-0000-000000000003', 'ro_cliente');
select pg_temp.como('80000000-0000-0000-0000-000000000003');
do $$
declare n int;
begin
  update public.assessments set respostas = '{}' where id = (select valor from ctx where chave = 'id')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: rebaixado a RO continuou editando'; end if;
end $$;

-- Removido da empresa, quem iniciou o rascunho deixa de ler.
select pg_temp.como('80000000-0000-0000-0000-000000000002');
select public.empresa_remover_membro((select valor from ctx where chave = 'a')::uuid, '80000000-0000-0000-0000-000000000003');
select pg_temp.como('80000000-0000-0000-0000-000000000003');
do $$ begin
  if exists (select 1 from public.assessments where id = (select valor from ctx where chave = 'id')::uuid) then
    raise exception 'FALHA: ex-membro continuou lendo o assessment da empresa';
  end if;
end $$;

-- Outro RW conclui pelo servidor (com as respostas que estão gravadas).
reset role;
set local role service_role;
do $$
declare v uuid := (select valor from ctx where chave = 'id');
begin
  perform public.concluir_self(v, '80000000-0000-0000-0000-000000000007', '0123456789abcdef',
    '{"setor":"food_service","q3":"101 a 500"}', '0.3.0', '0.4.0', 'food_service', '{"score":{"valor":0.4}}');
end $$;
reset role;
do $$ begin
  if (select status from public.assessments where id = (select valor from ctx where chave = 'id')::uuid) <> 'concluido' then
    raise exception 'FALHA: RW não concluiu';
  end if;
end $$;

-- ADM descarta um rascunho novo da empresa; apagar a empresa com assessment é recusado.
set local role authenticated;
select pg_temp.como('80000000-0000-0000-0000-000000000002');
do $$
declare
  a uuid := (select valor from ctx where chave = 'a');
  v uuid;
begin
  v := public.iniciar_self('food_service', a);
  if v = (select valor from ctx where chave = 'id')::uuid then raise exception 'FALHA: retomou um concluído'; end if;
  perform public.descartar_rascunho(v);
end $$;
reset role;
do $$ begin
  perform pg_temp.falha(format('delete from public.organizations where id = %L', (select valor from ctx where chave = 'a')),
    'apagou a empresa com assessment');
end $$;

rollback;
\echo 'OK: perfis_cliente_test.sql passou'
