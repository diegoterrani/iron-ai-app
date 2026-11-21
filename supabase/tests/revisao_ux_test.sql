-- Testes da revisão de UX (21/11/2026): direito da empresa para a Equipe IRON
-- atribuída, aceite dos Termos e empresas do Deep numa chamada.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('9e000000-0000-0000-0000-000000000001', 'staff@iron.io',  '{"nome":"Consultora"}', now()),
  ('9e000000-0000-0000-0000-000000000002', 'parc@x.io',      '{"nome":"Parceiro"}', now()),
  ('9e000000-0000-0000-0000-000000000003', 'ana@a.com',      '{"nome":"Ana ADM"}', now()),
  ('9e000000-0000-0000-0000-000000000004', 'google@g.com',   '{"nome":"Via Google"}', now());
update public.profiles set status = 'ativo' where id::text like '9e000000-%';
insert into public.user_roles (user_id, role) values
  ('9e000000-0000-0000-0000-000000000001', 'equipe_iron'),
  ('9e000000-0000-0000-0000-000000000002', 'parceiro');
insert into public.organizations (id, nome, assentos) values
  ('9f000000-0000-0000-0000-000000000001', 'Empresa A', 5),
  ('9f000000-0000-0000-0000-000000000002', 'Empresa B', 5);
insert into public.memberships (org_id, user_id, role) values
  ('9f000000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000003', 'adm_cliente');
insert into public.staff_assignments (user_id, org_id) values
  ('9e000000-0000-0000-0000-000000000001', '9f000000-0000-0000-0000-000000000001'),
  ('9e000000-0000-0000-0000-000000000002', '9f000000-0000-0000-0000-000000000001');
-- Só a empresa A tem o Self liberado; a B não.
insert into public.direitos (org_id, produto) values ('9f000000-0000-0000-0000-000000000001', 'self_assessment');

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

-- ===== 1. Equipe IRON atribuída usa o direito da empresa
select pg_temp.como('9e000000-0000-0000-0000-000000000001', 'aal2');
do $$ begin
  if not public.tem_direito('self_assessment', '9f000000-0000-0000-0000-000000000001') then
    raise exception 'FALHA: staff atribuído sem direito na empresa A';
  end if;
  if public.tem_direito('self_assessment', '9f000000-0000-0000-0000-000000000002') then
    raise exception 'FALHA: staff com direito na empresa B (não atribuído, sem direito)';
  end if;
  if public.tem_direito('self_assessment') then
    raise exception 'FALHA: staff com direito pessoal que não tem';
  end if;
end $$;

-- Abre o Self da empresa A e o ADM-Cliente retoma o MESMO rascunho.
create temp table rascunho (id uuid) on commit drop;
grant all on rascunho to authenticated;
insert into rascunho select public.iniciar_self('food_service', '9f000000-0000-0000-0000-000000000001');
select pg_temp.como('9e000000-0000-0000-0000-000000000003');
do $$ begin
  if public.iniciar_self('food_service', '9f000000-0000-0000-0000-000000000001') <> (select id from rascunho) then
    raise exception 'FALHA: ADM-Cliente abriu outro rascunho';
  end if;
end $$;

-- Sem MFA, o papel de staff não vale: não abre.
select pg_temp.como('9e000000-0000-0000-0000-000000000001', 'aal1');
do $$ begin
  perform pg_temp.falha($q$select public.iniciar_self('food_service', '9f000000-0000-0000-0000-000000000001')$q$,
    'staff sem MFA abriu o Self da empresa');
end $$;

-- Parceiro atribuído tem o direito, mas não tem assessment.editar: não abre.
select pg_temp.como('9e000000-0000-0000-0000-000000000002', 'aal2');
do $$ begin
  perform pg_temp.falha($q$select public.iniciar_self('food_service', '9f000000-0000-0000-0000-000000000001')$q$,
    'parceiro abriu o Self da empresa');
end $$;

-- Escuta: mesma regra (servidor informa usuário e MFA).
reset role;
do $$ begin
  if not public.self_escuta_pode((select id from rascunho), '9e000000-0000-0000-0000-000000000001', true) then
    raise exception 'FALHA: staff atribuído sem escuta';
  end if;
  if public.self_escuta_pode((select id from rascunho), '9e000000-0000-0000-0000-000000000001', false) then
    raise exception 'FALHA: staff sem MFA com escuta';
  end if;
  if public.self_escuta_pode((select id from rascunho), '9e000000-0000-0000-0000-000000000002', true) then
    raise exception 'FALHA: parceiro com escuta';
  end if;
end $$;
set local role authenticated;

-- ===== 2. Aceite dos Termos
select pg_temp.como('9e000000-0000-0000-0000-000000000004');
do $$ begin
  perform pg_temp.falha($q$select public.aceitar_termos('qualquer', false)$q$, 'aceitou versão fora do formato');
  perform pg_temp.falha($q$select public.aceitar_termos(null, false)$q$, 'aceitou versão nula');
  perform pg_temp.falha($q$update public.profiles set aceite_termos_versao = '2026-11-02' where id = auth.uid()$q$,
    'editou o aceite direto na tabela');
end $$;
select public.aceitar_termos('2026-11-02', true);
do $$ declare v record; begin
  select aceite_termos_versao, aceite_termos_em, aceite_marketing into v from public.profiles where id = auth.uid();
  if v.aceite_termos_versao is distinct from '2026-11-02' or v.aceite_termos_em is null or not v.aceite_marketing then
    raise exception 'FALHA: aceite não gravado: %', v;
  end if;
end $$;
-- Só o próprio perfil muda.
do $$ begin
  if exists (select 1 from public.profiles where id = '9e000000-0000-0000-0000-000000000003' and aceite_termos_versao is not null) then
    raise exception 'FALHA: aceite gravado em outro perfil';
  end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.profiles where id = '9e000000-0000-0000-0000-000000000003' and aceite_termos_versao is not null) then
    raise exception 'FALHA: aceite gravado em outro perfil';
  end if;
end $$;
set local role anon;
do $$ begin
  perform pg_temp.falha($q$select public.aceitar_termos('2026-11-02', false)$q$, 'anon chamou aceitar_termos');
end $$;
set local role authenticated;

-- ===== 3. Empresas do Deep numa chamada
select pg_temp.como('9e000000-0000-0000-0000-000000000001', 'aal2');
do $$ declare n int; begin
  select count(*) into n from public.deep_empresas_que_conduzo();
  if n <> 1 or not exists (select 1 from public.deep_empresas_que_conduzo() where id = '9f000000-0000-0000-0000-000000000001') then
    raise exception 'FALHA: staff deveria conduzir só a empresa A (veio %)', n;
  end if;
end $$;
select pg_temp.como('9e000000-0000-0000-0000-000000000001', 'aal1');
do $$ begin
  if exists (select 1 from public.deep_empresas_que_conduzo()) then
    raise exception 'FALHA: staff sem MFA conduz Deep';
  end if;
end $$;
select pg_temp.como('9e000000-0000-0000-0000-000000000003');
do $$ begin
  if exists (select 1 from public.deep_empresas_que_conduzo()) then
    raise exception 'FALHA: ADM-Cliente conduz Deep';
  end if;
end $$;

rollback;
\echo 'OK: revisao_ux_test.sql passou'
