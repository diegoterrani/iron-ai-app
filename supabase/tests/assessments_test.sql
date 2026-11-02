-- Testes do Self assessment no banco: direitos, rascunho, resultado e RLS.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('70000000-0000-0000-0000-000000000001', 'admin@iron.io', '{"nome":"Admin"}', now()),
  ('70000000-0000-0000-0000-000000000002', 'ana@x.com', '{"nome":"Ana"}', now()),
  ('70000000-0000-0000-0000-000000000003', 'beto@x.com', '{"nome":"Beto"}', now()),
  ('70000000-0000-0000-0000-000000000004', 'carla@x.com', '{"nome":"Carla"}', now()),
  ('70000000-0000-0000-0000-000000000005', 'dani@x.com', '{"nome":"Dani"}', now());

update public.profiles set status = 'ativo'
where id in ('70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002',
             '70000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000004');
-- Dani fica pendente.
insert into public.user_roles (user_id, role) values ('70000000-0000-0000-0000-000000000001', 'super_admin');
insert into public.organizations (id, nome) values ('7a000000-0000-0000-0000-000000000001', 'Rede X');
insert into public.memberships (org_id, user_id, role) values
  ('7a000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000004', 'master_b2b');

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

set local role authenticated;

-- ===== Sem direito, ninguém inicia
select pg_temp.como('70000000-0000-0000-0000-000000000002');
do $$ begin
  perform pg_temp.falha($q$select public.iniciar_self('food_service')$q$, 'iniciou sem direito');
  perform pg_temp.falha($q$insert into public.assessments (user_id, setor) values (auth.uid(), 'food_service')$q$,
    'insert direto em assessments');
  perform pg_temp.falha($q$insert into public.direitos (user_id, produto) values (auth.uid(), 'self_assessment')$q$,
    'cliente se deu direito');
  perform pg_temp.falha($q$select public.admin_conceder_direito(auth.uid(), 'self_assessment')$q$,
    'cliente usou função de admin');
end $$;

-- ===== Admin sem MFA não libera; com MFA libera (idempotente)
select pg_temp.como('70000000-0000-0000-0000-000000000001', 'aal1');
do $$ begin
  perform pg_temp.falha($q$select public.admin_conceder_direito('70000000-0000-0000-0000-000000000002', 'self_assessment')$q$,
    'admin sem MFA liberou');
end $$;
select pg_temp.como('70000000-0000-0000-0000-000000000001', 'aal2');
select public.admin_conceder_direito('70000000-0000-0000-0000-000000000002', 'self_assessment');
select public.admin_conceder_direito('70000000-0000-0000-0000-000000000002', 'self_assessment');
select public.admin_conceder_direito('70000000-0000-0000-0000-000000000005', 'self_assessment');
do $$ begin
  if (select count(*) from public.direitos where user_id = '70000000-0000-0000-0000-000000000002') <> 1 then
    raise exception 'FALHA: direito duplicado';
  end if;
  perform pg_temp.falha($q$select public.admin_conceder_direito('70000000-0000-0000-0000-000000000002', 'curso_x')$q$,
    'produto inexistente aceito');
end $$;

-- ===== Ana inicia; segunda chamada retoma o mesmo rascunho
select pg_temp.como('70000000-0000-0000-0000-000000000002');
insert into ctx values ('id', public.iniciar_self('food_service'));
do $$ begin
  if public.iniciar_self('food_service')::text <> (select valor from ctx where chave = 'id') then
    raise exception 'FALHA: não retomou o rascunho';
  end if;
  perform pg_temp.falha($q$select public.iniciar_self('igaming')$q$, 'setor indisponível aceito');
  perform pg_temp.falha($q$select public.iniciar_self('food_service', '7a000000-0000-0000-0000-000000000001')$q$,
    'Ana respondeu por empresa de que não participa');
end $$;

-- Ana salva respostas, mas não mexe em status, setor ou dono.
update public.assessments set respostas = '{"setor":"food_service","q3":"101 a 500"}'
where id = (select valor::uuid from ctx where chave = 'id');
do $$
declare v_id text := (select valor from ctx where chave = 'id');
begin
  if (select respostas ->> 'q3' from public.assessments where id = v_id::uuid) <> '101 a 500' then
    raise exception 'FALHA: respostas não salvas';
  end if;
  perform pg_temp.falha(format($q$update public.assessments set status = 'concluido' where id = %L$q$, v_id), 'cliente concluiu');
  perform pg_temp.falha(format($q$update public.assessments set setor = 'fintech' where id = %L$q$, v_id), 'cliente trocou setor');
  perform pg_temp.falha(format($q$update public.assessments set user_id = '70000000-0000-0000-0000-000000000003' where id = %L$q$, v_id),
    'cliente trocou dono');
  perform pg_temp.falha(format($q$update public.assessments set respostas = '[1,2]' where id = %L$q$, v_id), 'respostas não objeto');
  perform pg_temp.falha(format($q$update public.assessments set respostas = jsonb_build_object('q7', repeat('x', 70000)) where id = %L$q$, v_id),
    'respostas acima de 64 KB');
  perform pg_temp.falha(format($q$insert into public.assessment_resultados (assessment_id, motor_versao, modelo_versao, pacote_versao, hash_respostas, resultado) values (%L, '0', '0', '0', '0123456789abcdef', '{}')$q$, v_id),
    'cliente gravou resultado');
  perform pg_temp.falha(format($q$select public.concluir_self(%L, auth.uid(), '0123456789abcdef', '{}', '0', '0', '0', '{}')$q$, v_id),
    'cliente chamou concluir_self');
end $$;

-- ===== Beto não vê nem edita o assessment da Ana
select pg_temp.como('70000000-0000-0000-0000-000000000003');
do $$
declare n int;
begin
  if exists (select 1 from public.assessments) then raise exception 'FALHA: Beto viu assessment da Ana'; end if;
  if exists (select 1 from public.direitos) then raise exception 'FALHA: Beto viu direito da Ana'; end if;
  update public.assessments set respostas = '{}' where id = (select valor::uuid from ctx where chave = 'id');
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: Beto editou assessment da Ana'; end if;
end $$;

-- ===== Dani (pendente) tem direito mas não inicia
select pg_temp.como('70000000-0000-0000-0000-000000000005');
do $$ begin
  perform pg_temp.falha($q$select public.iniciar_self('food_service')$q$, 'conta pendente iniciou');
end $$;

-- ===== Admin vê com MFA, não vê sem
select pg_temp.como('70000000-0000-0000-0000-000000000001', 'aal1');
do $$ begin
  if exists (select 1 from public.assessments) then raise exception 'FALHA: admin sem MFA viu assessment'; end if;
end $$;
select pg_temp.como('70000000-0000-0000-0000-000000000001', 'aal2');
do $$ begin
  if not exists (select 1 from public.assessments) then raise exception 'FALHA: admin com MFA não viu'; end if;
end $$;

-- ===== Servidor conclui: recusa se as respostas mudaram; grava se iguais
reset role;
set local role service_role;
do $$
declare v_id uuid := (select valor::uuid from ctx where chave = 'id');
begin
  perform pg_temp.falha(format($q$select public.concluir_self(%L, '70000000-0000-0000-0000-000000000002', '0123456789abcdef', '{"outra":"coisa"}', '0.2.1', '0.4.0', 'food_service 0.1.1', '{"score":{"valor":0.35}}')$q$, v_id),
    'concluiu com respostas diferentes');
  perform pg_temp.falha(format($q$select public.concluir_self(%L, '70000000-0000-0000-0000-000000000003', '0123456789abcdef', '{"setor":"food_service","q3":"101 a 500"}', '0.2.1', '0.4.0', 'food_service 0.1.1', '{}')$q$, v_id),
    'concluiu em nome de outro dono');
  perform public.concluir_self(v_id, '70000000-0000-0000-0000-000000000002', '0123456789abcdef',
    '{"setor":"food_service","q3":"101 a 500"}', '0.2.1', '0.4.0', 'food_service 0.1.1', '{"score":{"valor":0.35}}');
  perform pg_temp.falha(format($q$select public.concluir_self(%L, '70000000-0000-0000-0000-000000000002', '0123456789abcdef', '{"setor":"food_service","q3":"101 a 500"}', '0.2.1', '0.4.0', 'food_service 0.1.1', '{}')$q$, v_id),
    'concluiu duas vezes');
  perform pg_temp.falha('update public.assessment_resultados set resultado = ''{}''', 'resultado alterado');
end $$;
reset role;
set local role authenticated;

-- ===== Ana lê o resultado e não edita mais; nova rodada exige direito
select pg_temp.como('70000000-0000-0000-0000-000000000002');
do $$
declare n int;
begin
  if (select resultado -> 'score' ->> 'valor' from public.assessment_resultados) <> '0.35' then
    raise exception 'FALHA: Ana não leu o resultado';
  end if;
  if (select status from public.assessments) <> 'concluido' then raise exception 'FALHA: status'; end if;
  update public.assessments set respostas = '{}';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHA: editou assessment concluído'; end if;
end $$;

select pg_temp.como('70000000-0000-0000-0000-000000000003');
do $$ begin
  if exists (select 1 from public.assessment_resultados) then raise exception 'FALHA: Beto viu resultado da Ana'; end if;
end $$;

-- ===== Exportação LGPD inclui os assessments do titular, e só os dele
do $$ begin
  if jsonb_array_length(public.meus_dados() -> 'assessments') <> 0 then
    raise exception 'FALHA: Beto exportou assessment de outra pessoa';
  end if;
end $$;
select pg_temp.como('70000000-0000-0000-0000-000000000002');
do $$
declare d jsonb := public.meus_dados();
begin
  if d #>> '{assessments,0,resultados,0,resultado,score,valor}' <> '0.35'
     or d #>> '{assessments,0,respostas,q3}' <> '101 a 500' then
    raise exception 'FALHA: exportação sem respostas ou resultado: %', d -> 'assessments';
  end if;
  if d #>> '{acessos_a_produtos,0,produto}' <> 'self_assessment' then
    raise exception 'FALHA: exportação sem acesso a produtos';
  end if;
end $$;

select pg_temp.como('70000000-0000-0000-0000-000000000001', 'aal2');
select public.admin_revogar_direito('70000000-0000-0000-0000-000000000002', 'self_assessment');
select pg_temp.como('70000000-0000-0000-0000-000000000002');
do $$ begin
  perform pg_temp.falha($q$select public.iniciar_self('food_service')$q$, 'iniciou com direito revogado');
end $$;

-- ===== Direito da empresa: a Master responde pela empresa
reset role;
insert into public.direitos (org_id, produto) values ('7a000000-0000-0000-0000-000000000001', 'self_assessment');
set local role authenticated;
select pg_temp.como('70000000-0000-0000-0000-000000000004');
do $$ begin
  perform pg_temp.falha($q$select public.iniciar_self('food_service')$q$, 'Carla usou direito da empresa sem informar a empresa');
  perform public.iniciar_self('food_service', '7a000000-0000-0000-0000-000000000001');
  if not exists (select 1 from public.assessments where org_id = '7a000000-0000-0000-0000-000000000001') then
    raise exception 'FALHA: Master não iniciou pela empresa';
  end if;
end $$;

-- ===== Auditoria registra início, conclusão e liberação, sem as respostas
reset role;
do $$ begin
  if (select count(*) from public.audit_log where acao = 'assessment_iniciado') < 2 then
    raise exception 'FALHA: início não auditado';
  end if;
  if not exists (select 1 from public.audit_log where acao = 'assessment_concluido') then
    raise exception 'FALHA: conclusão não auditada';
  end if;
  if not exists (select 1 from public.audit_log where tabela = 'direitos' and acao = 'insert'
                 and alvo = '70000000-0000-0000-0000-000000000002') then
    raise exception 'FALHA: liberação não auditada na ficha da pessoa';
  end if;
  if not exists (select 1 from public.audit_log where tabela = 'direitos' and acao = 'update'
                 and alvo = '70000000-0000-0000-0000-000000000002'
                 and dados -> 'depois' ->> 'revogado_em' is not null) then
    raise exception 'FALHA: revogação não auditada na ficha da pessoa';
  end if;
  if exists (select 1 from public.audit_log where dados::text like '%101 a 500%') then
    raise exception 'FALHA: respostas copiadas para a auditoria';
  end if;
end $$;

-- ===== Exclusão da conta leva assessments e resultados junto
delete from auth.users where id = '70000000-0000-0000-0000-000000000002';
do $$ begin
  if exists (select 1 from public.assessments where user_id = '70000000-0000-0000-0000-000000000002')
     or exists (select 1 from public.assessment_resultados) then
    raise exception 'FALHA: dados ficaram após excluir a conta';
  end if;
end $$;

rollback;
\echo 'assessments_test: ok'
