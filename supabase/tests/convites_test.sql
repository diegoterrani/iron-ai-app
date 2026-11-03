-- Testes dos convites do Master (fase 3b).
\set ON_ERROR_STOP on
begin;

-- 1 super-admin, 2 master A, 3 master B, 4 membro A, 5 convidado com conta,
-- 6 e-mail não confirmado, 7 conta suspensa.
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('30000000-0000-0000-0000-000000000001', 'admin@iron.io', '{"nome":"Admin"}', now()),
  ('30000000-0000-0000-0000-000000000002', 'master@a.com', '{"nome":"Master A"}', now()),
  ('30000000-0000-0000-0000-000000000003', 'master@b.com', '{"nome":"Master B"}', now()),
  ('30000000-0000-0000-0000-000000000004', 'membro@a.com', '{"nome":"Membro A"}', now()),
  ('30000000-0000-0000-0000-000000000005', 'Ana@Gmail.com', '{"nome":"Ana"}', now()),
  ('30000000-0000-0000-0000-000000000006', 'bia@gmail.com', '{"nome":"Bia"}', null),
  ('30000000-0000-0000-0000-000000000007', 'caio@gmail.com', '{"nome":"Caio"}', now());

update public.profiles set status = 'ativo'
where id in ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002',
             '30000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000004');
update public.profiles set status = 'suspenso' where id = '30000000-0000-0000-0000-000000000007';
insert into public.user_roles (user_id, role) values ('30000000-0000-0000-0000-000000000001', 'super_admin');

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

-- Cenário: empresa A com 3 assentos (Master + Membro já usam 2), empresa B.
select pg_temp.como('30000000-0000-0000-0000-000000000001', 'aal2');
do $$
declare a uuid; b uuid;
begin
  a := public.admin_criar_empresa('Empresa A', null, 3);
  b := public.admin_criar_empresa('Empresa B', null, 5);
  perform set_config('teste.a', a::text, true);
  perform set_config('teste.b', b::text, true);
  perform public.admin_vincular_empresa(a, '30000000-0000-0000-0000-000000000002', 'master_b2b');
  perform public.admin_vincular_empresa(a, '30000000-0000-0000-0000-000000000004', 'membro_b2b');
  perform public.admin_vincular_empresa(b, '30000000-0000-0000-0000-000000000003', 'master_b2b');
end $$;

-- ===== Master A convida
select pg_temp.como('30000000-0000-0000-0000-000000000002');
do $$
declare a uuid := current_setting('teste.a')::uuid; b uuid := current_setting('teste.b')::uuid; n int;
begin
  -- e-mail normalizado (maiúsculas e espaços)
  perform public.empresa_convidar(a, '  ANA@gmail.com ');
  select count(*) into n from public.convites where org_id = a and email = 'ana@gmail.com';
  if n <> 1 then raise exception 'FALHA: convite não gravado normalizado'; end if;

  -- 3 de 3 assentos (2 membros + 1 convite pendente): o próximo não cabe
  perform pg_temp.falha(format($q$select public.empresa_convidar(%L, 'novo@x.com')$q$, a),
    'convite além dos assentos');
  -- duplicado, já membro, e-mail inválido
  perform pg_temp.falha(format($q$select public.empresa_convidar(%L, 'ana@gmail.com')$q$, a), 'convite duplicado');
  perform pg_temp.falha(format($q$select public.empresa_convidar(%L, 'membro@a.com')$q$, a), 'convidou quem já é membro');
  perform pg_temp.falha(format($q$select public.empresa_convidar(%L, 'sem-arroba')$q$, a), 'e-mail inválido aceito');

  -- outra empresa: negado
  perform pg_temp.falha(format($q$select public.empresa_convidar(%L, 'z@x.com')$q$, b), 'master A convidou na empresa B');

  -- lista de membros com e-mail só da própria empresa
  select count(*) into n from public.empresa_listar_membros(a);
  if n <> 2 then raise exception 'FALHA: listar membros deu %', n; end if;
  perform pg_temp.falha(format('select * from public.empresa_listar_membros(%L)', b), 'master A listou empresa B');

  -- RLS: vê os convites da A, não os da B
  select count(*) into n from public.convites;
  if n <> 1 then raise exception 'FALHA: master leu convites que não são seus (%)', n; end if;

  -- escrita direta bloqueada
  perform pg_temp.falha(format($q$insert into public.convites (org_id, email) values (%L, 'x@y.com')$q$, a),
    'insert direto em convites');
  perform pg_temp.falha($q$update public.convites set expira_em = now() + interval '1 year'$q$, 'update direto em convites');
end $$;

-- Membro comum não convida
select pg_temp.como('30000000-0000-0000-0000-000000000004');
do $$ begin
  perform pg_temp.falha(format($q$select public.empresa_convidar(%L, 'w@x.com')$q$, current_setting('teste.a')),
    'membro convidou');
end $$;

-- Anônimo não executa
reset role;
set local role anon;
do $$ begin
  perform pg_temp.falha('select * from public.meus_convites()', 'anônimo leu convites');
end $$;
reset role;
set local role authenticated;

-- ===== Lado do convidado
-- Outra pessoa não aceita convite alheio, nem sabendo o id
select pg_temp.como('30000000-0000-0000-0000-000000000003');
do $$
declare id_convite uuid;
begin
  reset role;
  select id into id_convite from public.convites where email = 'ana@gmail.com';
  perform set_config('teste.convite', id_convite::text, true);
  set local role authenticated;
  perform pg_temp.falha(format('select public.aceitar_convite(%L)', id_convite), 'aceitou convite de outro e-mail');
  if exists (select 1 from public.meus_convites()) then raise exception 'FALHA: viu convite alheio'; end if;
end $$;

-- E-mail não confirmado não vê nem aceita (convite para bia@gmail.com criado como admin)
select pg_temp.como('30000000-0000-0000-0000-000000000001', 'aal2');
select public.admin_definir_assentos(current_setting('teste.a')::uuid, 6);
select public.empresa_convidar(current_setting('teste.a')::uuid, 'bia@gmail.com');
select public.empresa_convidar(current_setting('teste.a')::uuid, 'caio@gmail.com');
select pg_temp.como('30000000-0000-0000-0000-000000000006');
do $$ begin
  if exists (select 1 from public.meus_convites()) then raise exception 'FALHA: e-mail não confirmado viu convite'; end if;
end $$;

-- Conta suspensa não usa convite para se reativar
select pg_temp.como('30000000-0000-0000-0000-000000000007');
do $$
declare id_convite uuid;
begin
  select id into id_convite from public.meus_convites();
  if id_convite is null then raise exception 'FALHA: suspenso não viu o convite'; end if;
  perform pg_temp.falha(format('select public.aceitar_convite(%L)', id_convite), 'suspenso aceitou convite');
end $$;

-- Ana (conta pendente) vê e aceita: vira Membro e fica ativa
select pg_temp.como('30000000-0000-0000-0000-000000000005');
do $$
declare r record;
begin
  select * into r from public.meus_convites();
  if r.empresa <> 'Empresa A' then raise exception 'FALHA: meus_convites %', r; end if;
  perform public.aceitar_convite(r.id);
  perform pg_temp.falha(format('select public.aceitar_convite(%L)', r.id), 'convite aceito duas vezes');
  if not public.tem_permissao('assessment.ver', current_setting('teste.a')::uuid) then
    raise exception 'FALHA: aceitar não deu acesso de membro';
  end if;
end $$;

-- ===== Cancelar e recusar
select pg_temp.como('30000000-0000-0000-0000-000000000003');
do $$
declare id_bia uuid;
begin
  reset role;
  select id into id_bia from public.convites where email = 'bia@gmail.com';
  set local role authenticated;
  -- Master B não cancela convite da empresa A
  perform pg_temp.falha(format('select public.empresa_cancelar_convite(%L)', id_bia), 'master B cancelou convite da A');
  perform pg_temp.como('30000000-0000-0000-0000-000000000002');
  perform public.empresa_cancelar_convite(id_bia);
end $$;

-- ===== Convite vencido não vale e não bloqueia um novo
reset role;
update public.convites set expira_em = now() - interval '1 minute' where email = 'caio@gmail.com';
update public.profiles set status = 'pendente' where id = '30000000-0000-0000-0000-000000000007';
set local role authenticated;
select pg_temp.como('30000000-0000-0000-0000-000000000007');
do $$ begin
  if exists (select 1 from public.meus_convites()) then raise exception 'FALHA: convite vencido apareceu'; end if;
end $$;
select pg_temp.como('30000000-0000-0000-0000-000000000002');
select public.empresa_convidar(current_setting('teste.a')::uuid, 'caio@gmail.com');
select pg_temp.como('30000000-0000-0000-0000-000000000007');
do $$
declare id_convite uuid;
begin
  select id into id_convite from public.meus_convites();
  perform public.recusar_convite(id_convite);
  if exists (select 1 from public.meus_convites()) then raise exception 'FALHA: recusa não valeu'; end if;
end $$;

-- ===== Limite diário
reset role;
do $$
declare n int;
begin
  if not exists (select 1 from public.audit_log where tabela = 'convites' and acao = 'insert') then
    raise exception 'FALHA: convite não auditado';
  end if;
  insert into public.convites (org_id, email, criado_por, cancelado_em)
  select current_setting('teste.b')::uuid, 'massa' || i || '@x.com', '30000000-0000-0000-0000-000000000003', now()
  from generate_series(1, 50) as i;
end $$;
set local role authenticated;
select pg_temp.como('30000000-0000-0000-0000-000000000003');
do $$ begin
  perform pg_temp.falha(format($q$select public.empresa_convidar(%L, 'mais@x.com')$q$, current_setting('teste.b')),
    'passou do limite diário');
end $$;

rollback;
\echo 'OK: convites_test.sql passou'
