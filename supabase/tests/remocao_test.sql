-- Testes da remoção de assessments: descarte pelo dono e remoção pelo super-admin.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('7c000000-0000-0000-0000-000000000001', 'admin@iron.io', '{"nome":"Admin"}', now()),
  ('7c000000-0000-0000-0000-000000000002', 'ana@x.com', '{"nome":"Ana"}', now()),
  ('7c000000-0000-0000-0000-000000000003', 'beto@x.com', '{"nome":"Beto"}', now());
update public.profiles set status = 'ativo' where id::text like '7c000000-%';
insert into public.user_roles (user_id, role) values ('7c000000-0000-0000-0000-000000000001', 'super_admin');

-- Dados montados direto (como dono das tabelas): rascunho e concluído da Ana, rascunho do Beto.
insert into public.assessments (id, user_id, setor, status, concluido_em) values
  ('7d000000-0000-0000-0000-000000000001', '7c000000-0000-0000-0000-000000000002', 'food_service', 'rascunho', null),
  ('7d000000-0000-0000-0000-000000000002', '7c000000-0000-0000-0000-000000000002', 'food_service', 'concluido', now()),
  ('7d000000-0000-0000-0000-000000000003', '7c000000-0000-0000-0000-000000000003', 'food_service', 'rascunho', null);
insert into public.assessment_resultados (assessment_id, motor_versao, modelo_versao, pacote_versao, hash_respostas, resultado)
values ('7d000000-0000-0000-0000-000000000002', '0.4.0', '0.4.0', 'food_service 0.2.0', '0123456789abcdef', '{}');
insert into public.assessment_conversas (assessment_id, user_id)
values ('7d000000-0000-0000-0000-000000000001', '7c000000-0000-0000-0000-000000000002');

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

-- ===== Cliente não apaga direto nem descarta o que não é seu ou já concluiu
select pg_temp.como('7c000000-0000-0000-0000-000000000002');
do $$ begin
  perform pg_temp.falha('delete from public.assessments', 'cliente apagou direto na tabela');
  perform pg_temp.falha($q$select public.descartar_rascunho('7d000000-0000-0000-0000-000000000003')$q$,
    'descartou rascunho de outro');
  perform pg_temp.falha($q$select public.descartar_rascunho('7d000000-0000-0000-0000-000000000002')$q$,
    'descartou concluído');
  perform pg_temp.falha($q$select public.admin_remover_assessment('7d000000-0000-0000-0000-000000000002', 'teste de mesa')$q$,
    'cliente usou remoção de admin');
end $$;

-- ===== Dono descarta o próprio rascunho; conversa sai junto; auditoria registra
select public.descartar_rascunho('7d000000-0000-0000-0000-000000000001');
do $$ begin
  if exists (select 1 from public.assessments where id = '7d000000-0000-0000-0000-000000000001') then
    raise exception 'FALHA: rascunho não foi descartado';
  end if;
end $$;

-- ===== Admin sem MFA não remove; com MFA exige motivo e remove concluído
select pg_temp.como('7c000000-0000-0000-0000-000000000001', 'aal1');
do $$ begin
  perform pg_temp.falha($q$select public.admin_remover_assessment('7d000000-0000-0000-0000-000000000002', 'teste de mesa')$q$,
    'admin sem MFA removeu');
end $$;
select pg_temp.como('7c000000-0000-0000-0000-000000000001', 'aal2');
do $$ begin
  perform pg_temp.falha($q$select public.admin_remover_assessment('7d000000-0000-0000-0000-000000000002', '  ab ')$q$,
    'removeu sem motivo');
  perform pg_temp.falha($q$select public.admin_remover_assessment('7d000000-0000-0000-0000-0000000000ff', 'teste de mesa')$q$,
    'removeu assessment inexistente');
end $$;
select public.admin_remover_assessment('7d000000-0000-0000-0000-000000000002', 'teste de mesa com cliente');
select public.admin_remover_assessment('7d000000-0000-0000-0000-000000000003', 'rascunho antigo');

reset role;
do $$ begin
  if exists (select 1 from public.assessments where id::text like '7d000000-%') then
    raise exception 'FALHA: sobrou assessment';
  end if;
  if exists (select 1 from public.assessment_resultados where assessment_id::text like '7d000000-%') then
    raise exception 'FALHA: resultado não saiu em cascata';
  end if;
  if exists (select 1 from public.assessment_conversas where assessment_id::text like '7d000000-%') then
    raise exception 'FALHA: conversa não saiu em cascata';
  end if;
  if (select count(*) from public.audit_log where acao = 'assessment_descartado' and ator = '7c000000-0000-0000-0000-000000000002') <> 1 then
    raise exception 'FALHA: descarte sem auditoria';
  end if;
  if (select dados ->> 'motivo' from public.audit_log
      where acao = 'assessment_removido' and dados ->> 'assessment' = '7d000000-0000-0000-0000-000000000002')
     is distinct from 'teste de mesa com cliente' then
    raise exception 'FALHA: remoção sem motivo na auditoria';
  end if;
end $$;

rollback;
\echo 'remocao_test: ok'
