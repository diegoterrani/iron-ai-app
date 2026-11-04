-- Testes das funções de leitura do backoffice (fase 3).
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, last_sign_in_at) values
  ('20000000-0000-0000-0000-000000000001', 'admin@iron.io', '{"nome":"Admin"}', '{"providers":["email"]}', now()),
  ('20000000-0000-0000-0000-000000000002', 'ana@empresa.com', '{"nome":"Ana Souza"}', '{"providers":["google","email"]}', null),
  ('20000000-0000-0000-0000-000000000003', 'bruno_100%@x.com', '{"nome":"Bruno"}', '{"providers":["azure"]}', null),
  ('20000000-0000-0000-0000-000000000004', 'carla@x.com', '{"nome":"Carla"}', null, null);

update public.profiles set status = 'ativo' where id = '20000000-0000-0000-0000-000000000001';
insert into public.user_roles (user_id, role) values ('20000000-0000-0000-0000-000000000001', 'super_admin');
insert into auth.mfa_factors (user_id, status) values ('20000000-0000-0000-0000-000000000001', 'verified');
insert into auth.mfa_factors (user_id, status) values ('20000000-0000-0000-0000-000000000002', 'unverified');

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

-- ===== Ninguém além de super-admin com MFA lê e-mails
select pg_temp.como('20000000-0000-0000-0000-000000000001', 'aal1');
do $$ begin
  perform pg_temp.falha('select * from public.admin_listar_usuarios()', 'listou sem MFA');
  perform pg_temp.falha($q$select public.admin_buscar_usuario_por_email('ana@empresa.com')$q$, 'buscou e-mail sem MFA');
end $$;

select pg_temp.como('20000000-0000-0000-0000-000000000002', 'aal2');
do $$ begin
  perform pg_temp.falha('select * from public.admin_listar_usuarios()', 'usuário comum listou');
  perform pg_temp.falha($q$select * from public.admin_obter_usuario('20000000-0000-0000-0000-000000000001')$q$,
    'usuário comum leu ficha');
  perform pg_temp.falha('select * from public.admin_contadores()', 'usuário comum leu contadores');
end $$;

reset role;
set local role anon;
do $$ begin
  perform pg_temp.falha('select * from public.admin_listar_usuarios()', 'anônimo executou');
end $$;
reset role;
set local role authenticated;

-- ===== Super-admin com MFA
select pg_temp.como('20000000-0000-0000-0000-000000000001', 'aal2');
do $$
declare
  n int;
  r record;
begin
  -- filtro por status
  select count(*) into n from public.admin_listar_usuarios('pendente');
  if n <> 3 then raise exception 'FALHA: esperava 3 pendentes, veio %', n; end if;

  -- total vem em toda linha, mesmo paginado
  select total into n from public.admin_listar_usuarios(null, null, 1, 0) limit 1;
  if n <> 4 then raise exception 'FALHA: total paginado %', n; end if;
  select count(*) into n from public.admin_listar_usuarios(null, null, 1, 0);
  if n <> 1 then raise exception 'FALHA: limite ignorado'; end if;

  -- busca por nome e por e-mail, sem diferenciar maiúsculas
  select count(*) into n from public.admin_listar_usuarios(null, 'SOUZA');
  if n <> 1 then raise exception 'FALHA: busca por nome'; end if;
  select count(*) into n from public.admin_listar_usuarios(null, 'x.com');
  if n <> 2 then raise exception 'FALHA: busca por e-mail'; end if;

  -- curingas do LIKE são literais: "%" só acha quem tem % no e-mail
  select count(*) into n from public.admin_listar_usuarios(null, '%');
  if n <> 1 then raise exception 'FALHA: %% virou curinga (%)', n; end if;
  select count(*) into n from public.admin_listar_usuarios(null, '_');
  if n <> 1 then raise exception 'FALHA: _ virou curinga (%)', n; end if;

  -- papéis aparecem na lista
  select papeis into r from public.admin_listar_usuarios('ativo');
  if not ('super_admin' = any (r.papeis)) then raise exception 'FALHA: papel ausente na lista'; end if;

  -- ficha: provedores e MFA (fator não verificado não conta)
  select * into r from public.admin_obter_usuario('20000000-0000-0000-0000-000000000002');
  if r.email <> 'ana@empresa.com' or not ('google' = any (r.provedores)) or r.mfa_ativo then
    raise exception 'FALHA: ficha da Ana %', r;
  end if;
  select * into r from public.admin_obter_usuario('20000000-0000-0000-0000-000000000001');
  if not r.mfa_ativo then raise exception 'FALHA: MFA verificado não apareceu'; end if;
  select * into r from public.admin_obter_usuario('20000000-0000-0000-0000-000000000004');
  if r.provedores <> '{}' then raise exception 'FALHA: provedores nulos'; end if;

  -- busca exata por e-mail, ignorando maiúsculas e espaços
  if public.admin_buscar_usuario_por_email('  ANA@empresa.com ') is distinct from '20000000-0000-0000-0000-000000000002' then
    raise exception 'FALHA: busca por e-mail exato';
  end if;
  if public.admin_buscar_usuario_por_email('ana@') is not null then
    raise exception 'FALHA: busca por e-mail aceitou parcial';
  end if;

  -- contadores
  select * into r from public.admin_contadores();
  if r.pendentes <> 3 or r.ativos <> 1 then raise exception 'FALHA: contadores %', r; end if;
end $$;

-- ===== Desvincular de empresa: só admin, auditado
do $$
declare a uuid;
begin
  perform public.admin_definir_status('20000000-0000-0000-0000-000000000002', 'ativo');
  a := public.admin_criar_empresa('Empresa T', null, 2);
  perform set_config('teste.org_t', a::text, true);
  perform public.admin_vincular_empresa(a, '20000000-0000-0000-0000-000000000002', 'adm_cliente');
  perform public.admin_desvincular_empresa(a, '20000000-0000-0000-0000-000000000002');
  if exists (select 1 from public.memberships where org_id = a) then
    raise exception 'FALHA: vínculo não removido';
  end if;
  if not exists (select 1 from public.audit_log where tabela = 'memberships' and acao = 'delete'
                 and ator = '20000000-0000-0000-0000-000000000001') then
    raise exception 'FALHA: desvínculo não auditado';
  end if;
  perform pg_temp.falha(format($q$select public.admin_desvincular_empresa(%L, '20000000-0000-0000-0000-000000000002')$q$, a),
    'desvincular inexistente não avisou');
  perform public.admin_vincular_empresa(a, '20000000-0000-0000-0000-000000000002', 'adm_cliente');
end $$;

-- Master não usa a função de admin para tirar ninguém
select pg_temp.como('20000000-0000-0000-0000-000000000002');
do $$ begin
  perform pg_temp.falha(format($q$select public.admin_desvincular_empresa(%L, '20000000-0000-0000-0000-000000000002')$q$,
    current_setting('teste.org_t')), 'master usou função de admin');
end $$;

-- ===== Teto de 100 por página (anti-raspagem)
reset role;
insert into auth.users (email, raw_user_meta_data)
select 'massa' || i || '@x.com', '{"nome":"Massa"}' from generate_series(1, 120) as i;
set local role authenticated;
select pg_temp.como('20000000-0000-0000-0000-000000000001', 'aal2');
do $$
declare n int;
begin
  select count(*) into n from public.admin_listar_usuarios(null, null, 100000, 0);
  if n <> 100 then raise exception 'FALHA: limite sem teto (%)', n; end if;
end $$;

rollback;
\echo 'OK: backoffice_test.sql passou'
