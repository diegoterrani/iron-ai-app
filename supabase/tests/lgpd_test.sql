-- Testes dos direitos do titular (LGPD): exportar e excluir.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, email_confirmed_at) values
  ('40000000-0000-0000-0000-000000000001', 'admin@iron.io', '{"nome":"Admin"}', '{"providers":["email"]}', now()),
  ('40000000-0000-0000-0000-000000000002', 'ana@x.com', '{"nome":"Ana"}', '{"providers":["google"]}', now()),
  ('40000000-0000-0000-0000-000000000003', 'beto@x.com', '{"nome":"Beto"}', null, now()),
  ('40000000-0000-0000-0000-000000000004', 'admin2@iron.io', '{"nome":"Admin 2"}', null, now());

update public.profiles set status = 'ativo'
where id in ('40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004');
insert into public.user_roles (user_id, role) values
  ('40000000-0000-0000-0000-000000000001', 'super_admin'),
  ('40000000-0000-0000-0000-000000000004', 'super_admin');

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

-- ===== Exportação: só os próprios dados, conta pendente também pode
select pg_temp.como('40000000-0000-0000-0000-000000000002');
do $$
declare d jsonb;
begin
  d := public.meus_dados();
  if d -> 'conta' ->> 'email' <> 'ana@x.com' or d -> 'perfil' ->> 'nome' <> 'Ana' then
    raise exception 'FALHA: exportação errada %', d;
  end if;
  if d -> 'perfil' ->> 'status' <> 'pendente' then raise exception 'FALHA: status na exportação'; end if;
  if (d -> 'conta' -> 'provedores') <> '["google"]'::jsonb then raise exception 'FALHA: provedores'; end if;
  if d::text like '%beto@x.com%' or d::text like '%admin@iron.io%' then
    raise exception 'FALHA: exportação vazou dados de outra pessoa';
  end if;
end $$;

reset role;
set local role anon;
do $$ begin
  perform pg_temp.falha('select public.meus_dados()', 'anônimo exportou');
end $$;
reset role;
set local role authenticated;

-- ===== Pedido de exclusão: idempotente, cancelável, só o próprio
select pg_temp.como('40000000-0000-0000-0000-000000000002');
select public.solicitar_exclusao();
select public.solicitar_exclusao();
do $$
declare n int;
begin
  select count(*) into n from public.solicitacoes_lgpd where status = 'pendente';
  if n <> 1 then raise exception 'FALHA: pedido duplicado (%)', n; end if;
  perform pg_temp.falha($q$insert into public.solicitacoes_lgpd (user_id) values ('40000000-0000-0000-0000-000000000003')$q$,
    'insert direto em nome de outro');
end $$;

select pg_temp.como('40000000-0000-0000-0000-000000000003');
do $$ begin
  if exists (select 1 from public.solicitacoes_lgpd) then raise exception 'FALHA: Beto viu pedido da Ana'; end if;
end $$;
select public.solicitar_exclusao();
select public.cancelar_solicitacao_exclusao();
do $$ begin
  if exists (select 1 from public.solicitacoes_lgpd where status = 'pendente') then
    raise exception 'FALHA: cancelamento não valeu';
  end if;
end $$;

-- ===== Backoffice
-- Sem MFA não lista nem autoriza
select pg_temp.como('40000000-0000-0000-0000-000000000001', 'aal1');
do $$ begin
  perform pg_temp.falha('select * from public.admin_listar_solicitacoes_lgpd()', 'listou sem MFA');
end $$;

select pg_temp.como('40000000-0000-0000-0000-000000000001', 'aal2');
do $$
declare
  pedido_ana uuid;
  alvo uuid;
  n int;
begin
  select id into pedido_ana from public.admin_listar_solicitacoes_lgpd() where email = 'ana@x.com' and status = 'pendente';
  if pedido_ana is null then raise exception 'FALHA: pedido da Ana não listado'; end if;
  perform set_config('teste.pedido', pedido_ana::text, true);

  -- Sem pedido do titular não há o que autorizar
  perform pg_temp.falha($q$select public.admin_autorizar_exclusao(gen_random_uuid())$q$, 'autorizou sem pedido');
  -- Pedido cancelado do Beto não vale
  select count(*) into n from public.admin_listar_solicitacoes_lgpd() where email = 'beto@x.com' and status = 'cancelada';
  if n <> 1 then raise exception 'FALHA: pedido cancelado não listado'; end if;
  perform pg_temp.falha(format('select public.admin_autorizar_exclusao(%L)',
    (select id from public.admin_listar_solicitacoes_lgpd() where email = 'beto@x.com')), 'autorizou pedido cancelado');

  alvo := public.admin_autorizar_exclusao(pedido_ana);
  if alvo <> '40000000-0000-0000-0000-000000000002' then raise exception 'FALHA: alvo errado'; end if;

  -- Concluir antes de apagar a conta é recusado
  perform pg_temp.falha(format('select public.admin_concluir_exclusao(%L)', pedido_ana), 'concluiu sem apagar a conta');
end $$;

-- Usuário comum não autoriza exclusão de ninguém, nem com o id do pedido
select pg_temp.como('40000000-0000-0000-0000-000000000003');
do $$ begin
  perform pg_temp.falha(format('select public.admin_autorizar_exclusao(%L)', current_setting('teste.pedido')),
    'usuário comum autorizou exclusão');
end $$;

-- Super-admin não é excluído pela tela (nem a própria conta)
reset role;
insert into public.solicitacoes_lgpd (user_id) values
  ('40000000-0000-0000-0000-000000000004'), ('40000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.como('40000000-0000-0000-0000-000000000001', 'aal2');
do $$
declare s record;
begin
  for s in select id from public.admin_listar_solicitacoes_lgpd()
           where email in ('admin2@iron.io', 'admin@iron.io') and status = 'pendente' loop
    perform pg_temp.falha(format('select public.admin_autorizar_exclusao(%L)', s.id), 'autorizou excluir super-admin');
  end loop;
end $$;

-- Servidor apaga a conta no Auth (simulado) e conclui
reset role;
delete from auth.users where id = '40000000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.como('40000000-0000-0000-0000-000000000001', 'aal2');
select public.admin_concluir_exclusao(current_setting('teste.pedido')::uuid);

reset role;
do $$ begin
  if exists (select 1 from public.profiles where id = '40000000-0000-0000-0000-000000000002') then
    raise exception 'FALHA: perfil sobrou após exclusão';
  end if;
  if (select status from public.solicitacoes_lgpd where id = current_setting('teste.pedido')::uuid) <> 'concluida' then
    raise exception 'FALHA: pedido não concluído';
  end if;
  if not exists (select 1 from public.audit_log where tabela = 'solicitacoes_lgpd' and acao = 'update') then
    raise exception 'FALHA: conclusão não auditada';
  end if;
end $$;

rollback;
\echo 'OK: lgpd_test.sql passou'
