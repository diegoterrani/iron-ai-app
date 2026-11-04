-- Testes da transferência de Self pessoal para a empresa (backoffice).
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('90000000-0000-0000-0000-000000000001', 'admin@iron.io', '{"nome":"Admin"}', now()),
  ('90000000-0000-0000-0000-000000000002', 'ana@a.com',     '{"nome":"Ana"}', now()),
  ('90000000-0000-0000-0000-000000000003', 'rui@a.com',     '{"nome":"Rui RO"}', now()),
  ('90000000-0000-0000-0000-000000000004', 'rw@a.com',      '{"nome":"RW A"}', now());
update public.profiles set status = 'ativo' where id::text like '90000000-%';
insert into public.user_roles (user_id, role) values ('90000000-0000-0000-0000-000000000001', 'super_admin');
insert into public.organizations (id, nome, assentos) values
  ('9a000000-0000-0000-0000-000000000001', 'Empresa A', 5),
  ('9a000000-0000-0000-0000-000000000002', 'Empresa B', 5);
insert into public.memberships (org_id, user_id, role) values
  ('9a000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 'adm_cliente'),
  ('9a000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003', 'ro_cliente'),
  ('9a000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000004', 'rw_cliente');
-- Ana: um concluído e um rascunho pessoais; Rui (RO): um pessoal; um rascunho já da empresa A.
insert into public.assessments (id, user_id, setor, status, respostas, concluido_em) values
  ('9b000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 'food_service', 'concluido', '{"q3":"x"}', now()),
  ('9b000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000002', 'food_service', 'rascunho', '{}', null),
  ('9b000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000003', 'food_service', 'rascunho', '{}', null);
insert into public.assessments (id, user_id, org_id, setor) values
  ('9b000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000004', '9a000000-0000-0000-0000-000000000001', 'food_service');

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

-- ===== Só super-admin com MFA
select pg_temp.como('90000000-0000-0000-0000-000000000002');
do $$ begin
  perform pg_temp.falha($q$select public.admin_transferir_assessment_empresa('9b000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001', 'pedido do cliente')$q$,
    'ADM-Cliente transferiu');
end $$;
select pg_temp.como('90000000-0000-0000-0000-000000000001', 'aal1');
do $$ begin
  perform pg_temp.falha($q$select public.admin_transferir_assessment_empresa('9b000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001', 'pedido do cliente')$q$,
    'super-admin sem MFA transferiu');
end $$;

-- ===== Travas
select pg_temp.como('90000000-0000-0000-0000-000000000001', 'aal2');
do $$ begin
  perform pg_temp.falha($q$select public.admin_transferir_assessment_empresa('9b000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001', 'x')$q$,
    'transferiu sem motivo');
  perform pg_temp.falha($q$select public.admin_transferir_assessment_empresa('9b000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000002', 'pedido do cliente')$q$,
    'transferiu para empresa de que o dono não faz parte');
  perform pg_temp.falha($q$select public.admin_transferir_assessment_empresa('9b000000-0000-0000-0000-000000000003', '9a000000-0000-0000-0000-000000000001', 'pedido do cliente')$q$,
    'transferiu assessment de quem é só RO');
  perform pg_temp.falha($q$select public.admin_transferir_assessment_empresa('9b000000-0000-0000-0000-000000000002', '9a000000-0000-0000-0000-000000000001', 'pedido do cliente')$q$,
    'rascunho entrou com a empresa já tendo rascunho');
  perform pg_temp.falha($q$select public.admin_transferir_assessment_empresa('9b000000-0000-0000-0000-000000000004', '9a000000-0000-0000-0000-000000000002', 'pedido do cliente')$q$,
    'assessment da empresa mudou de empresa');
end $$;

-- ===== Concluído da Ana vai para a empresa A
select public.admin_transferir_assessment_empresa('9b000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001', 'cliente virou empresa');

-- RO da empresa passa a ler; o resultado não mudou; auditoria registrou.
select pg_temp.como('90000000-0000-0000-0000-000000000003');
do $$ begin
  if not exists (select 1 from public.assessments where id = '9b000000-0000-0000-0000-000000000001') then
    raise exception 'FALHA: RO da empresa não leu o assessment transferido';
  end if;
end $$;
reset role;
do $$ begin
  if (select org_id from public.assessments where id = '9b000000-0000-0000-0000-000000000001') <> '9a000000-0000-0000-0000-000000000001'
     or (select status from public.assessments where id = '9b000000-0000-0000-0000-000000000001') <> 'concluido'
     or (select respostas from public.assessments where id = '9b000000-0000-0000-0000-000000000001') <> '{"q3":"x"}' then
    raise exception 'FALHA: transferência alterou mais que a empresa';
  end if;
  if not exists (select 1 from public.audit_log where acao = 'assessment_transferido'
                 and ator = '90000000-0000-0000-0000-000000000001'
                 and dados ->> 'motivo' = 'cliente virou empresa') then
    raise exception 'FALHA: transferência sem auditoria';
  end if;
end $$;

-- ===== Rascunho entra quando a empresa não tem outro
delete from public.assessments where id = '9b000000-0000-0000-0000-000000000004';
set local role authenticated;
select pg_temp.como('90000000-0000-0000-0000-000000000001', 'aal2');
select public.admin_transferir_assessment_empresa('9b000000-0000-0000-0000-000000000002', '9a000000-0000-0000-0000-000000000001', 'cliente virou empresa');
-- O RW da empresa passa a editar o rascunho transferido.
select pg_temp.como('90000000-0000-0000-0000-000000000004');
do $$
declare n int;
begin
  update public.assessments set respostas = '{"q3":"y"}' where id = '9b000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALHA: RW não editou o rascunho transferido'; end if;
end $$;

rollback;
\echo 'OK: transferir_test.sql passou'
