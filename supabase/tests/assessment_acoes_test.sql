-- Testes de excluir assessment e excluir cadastro de empresa do Self
-- (migração 20261124200000).
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('c1000000-0000-0000-0000-000000000001', 'admin@iron.io', '{"nome":"Admin"}', now()),
  ('c1000000-0000-0000-0000-000000000002', 'ana@x.com', '{"nome":"Ana"}', now()),
  ('c1000000-0000-0000-0000-000000000003', 'beto@x.com', '{"nome":"Beto"}', now()),
  ('c1000000-0000-0000-0000-000000000004', 'rw@x.com', '{"nome":"RW"}', now());
update public.profiles set status = 'ativo' where id::text like 'c1000000-%';
insert into public.user_roles (user_id, role) values ('c1000000-0000-0000-0000-000000000001', 'super_admin');
insert into public.organizations (id, nome, assentos) values ('c2000000-0000-0000-0000-000000000001', 'Empresa C', 5);
insert into public.memberships (org_id, user_id, role) values
  ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000003', 'adm_cliente'),
  ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', 'rw_cliente');
insert into public.empresas_cadastro (id, nome, criado_por) values
  ('c4000000-0000-0000-0000-000000000001', 'Cantina da Ana', 'c1000000-0000-0000-0000-000000000002'),
  ('c4000000-0000-0000-0000-000000000002', 'Buffet do Beto', 'c1000000-0000-0000-0000-000000000003');
insert into public.assessments (id, user_id, org_id, setor, status, concluido_em, empresa_id, empresa) values
  -- Ana: concluído e rascunho pessoais
  ('c3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', null, 'food_service', 'concluido', now(),
   'c4000000-0000-0000-0000-000000000001', '{"nome":"Cantina da Ana"}'),
  ('c3000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', null, 'food_service', 'rascunho', null, null, '{}'),
  -- da empresa, concluído (iniciado pelo RW)
  ('c3000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000004', 'c2000000-0000-0000-0000-000000000001', 'food_service', 'concluido', now(), null, '{}'),
  -- Beto: pessoal concluído
  ('c3000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000003', null, 'food_service', 'concluido', now(), null, '{}'),
  -- Beto: rascunho pessoal ligado ao cadastro dele
  ('c3000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000003', null, 'food_service', 'rascunho', null,
   'c4000000-0000-0000-0000-000000000002', '{"nome":"Buffet do Beto"}');
insert into public.assessment_resultados (assessment_id, motor_versao, modelo_versao, pacote_versao, hash_respostas, resultado) values
  ('c3000000-0000-0000-0000-000000000001', '0.7.0', '0.7.0', 'food_service 0.5.0', '0123456789abcdef', '{}'),
  ('c3000000-0000-0000-0000-000000000003', '0.7.0', '0.7.0', 'food_service 0.5.0', '0123456789abcdef', '{}');
insert into public.deep_assessments (id, org_id, setor, pacote_versao, self_assessment_id) values
  ('c5000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'food_service', 'food_service@0.3',
   'c3000000-0000-0000-0000-000000000003');

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

set local role authenticated;

-- ===== Beto (ADM da empresa) não exclui o Self pessoal da Ana; RW não exclui o da empresa
select pg_temp.como('c1000000-0000-0000-0000-000000000003');
do $$ begin
  perform pg_temp.falha($q$select public.excluir_assessment('c3000000-0000-0000-0000-000000000001')$q$,
    'excluiu Self pessoal de outra pessoa');
  perform pg_temp.falha($q$select public.excluir_empresa_cadastro('c4000000-0000-0000-0000-000000000001')$q$,
    'excluiu cadastro de outra pessoa');
end $$;
select pg_temp.como('c1000000-0000-0000-0000-000000000004');
do $$ begin
  perform pg_temp.falha($q$select public.excluir_assessment('c3000000-0000-0000-0000-000000000003')$q$,
    'RW-Cliente excluiu o Self da empresa');
end $$;

-- ===== Ana exclui o próprio concluído e o próprio rascunho; o resultado sai junto
select pg_temp.como('c1000000-0000-0000-0000-000000000002');
select public.excluir_assessment('c3000000-0000-0000-0000-000000000001');
select public.excluir_assessment('c3000000-0000-0000-0000-000000000002');
-- e o próprio cadastro de empresa
select public.excluir_empresa_cadastro('c4000000-0000-0000-0000-000000000001');

-- ===== ADM exclui o Self da empresa; o Deep perde só o vínculo
select pg_temp.como('c1000000-0000-0000-0000-000000000003');
select public.excluir_assessment('c3000000-0000-0000-0000-000000000003');

-- ===== Super-admin sem MFA não exclui; com MFA exclui qualquer um
select pg_temp.como('c1000000-0000-0000-0000-000000000001', 'aal1');
do $$ begin
  perform pg_temp.falha($q$select public.excluir_assessment('c3000000-0000-0000-0000-000000000004')$q$,
    'super-admin sem MFA excluiu');
end $$;
select pg_temp.como('c1000000-0000-0000-0000-000000000001', 'aal2');
select public.excluir_assessment('c3000000-0000-0000-0000-000000000004');
select public.excluir_empresa_cadastro('c4000000-0000-0000-0000-000000000002');

reset role;
do $$ begin
  -- O rascunho ligado ao cadastro excluído perde a cópia; concluir não recria o cadastro.
  if (select empresa from public.assessments where id = 'c3000000-0000-0000-0000-000000000005') <> '{}'::jsonb then
    raise exception 'FALHA: rascunho manteve a cópia da empresa excluída';
  end if;
  update public.assessments set status = 'concluido', concluido_em = now() where id = 'c3000000-0000-0000-0000-000000000005';
  if exists (select 1 from public.empresas_cadastro where nome = 'Buffet do Beto') then
    raise exception 'FALHA: concluir o rascunho recriou o cadastro excluído';
  end if;
  delete from public.assessments where id = 'c3000000-0000-0000-0000-000000000005';
  if exists (select 1 from public.assessments where id::text like 'c3000000-%') then
    raise exception 'FALHA: sobrou assessment';
  end if;
  if exists (select 1 from public.assessment_resultados where assessment_id::text like 'c3000000-%') then
    raise exception 'FALHA: resultado não saiu em cascata';
  end if;
  if exists (select 1 from public.empresas_cadastro where id::text like 'c4000000-%') then
    raise exception 'FALHA: sobrou cadastro';
  end if;
  if (select self_assessment_id from public.deep_assessments where id = 'c5000000-0000-0000-0000-000000000001') is not null then
    raise exception 'FALHA: Deep sumiu ou manteve o vínculo com o Self excluído';
  end if;
  if (select count(*) from public.audit_log where acao = 'assessment_excluido' and dados ->> 'assessment' like 'c3000000-%') <> 4 then
    raise exception 'FALHA: exclusão de assessment sem auditoria';
  end if;
  if (select count(*) from public.audit_log where acao = 'cadastro_empresa_excluido' and alvo like 'c4000000-%') <> 2 then
    raise exception 'FALHA: exclusão de cadastro sem auditoria';
  end if;
end $$;

rollback;
\echo 'assessment_acoes_test: ok'
