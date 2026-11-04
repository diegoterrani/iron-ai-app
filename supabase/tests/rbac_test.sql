-- Testes do RBAC: matriz, isolamento entre empresas, MFA de staff e escalada.
\set ON_ERROR_STOP on
begin;

-- Pessoas (o gatilho cria os perfis como pendente).
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000001', 's@iron.io',  '{"nome":"Super"}'),
  ('10000000-0000-0000-0000-000000000002', 'e@iron.io',  '{"nome":"Equipe"}'),
  ('10000000-0000-0000-0000-000000000003', 'p@parc.io',  '{"nome":"Parceiro"}'),
  ('10000000-0000-0000-0000-000000000004', 'm@a.com',    '{"nome":"Master A"}'),
  ('10000000-0000-0000-0000-000000000005', 'u@a.com',    '{"nome":"Membro A"}'),
  ('10000000-0000-0000-0000-000000000006', 'x@b.com',    '{"nome":"Master B"}'),
  ('10000000-0000-0000-0000-000000000007', 'c@gmail.com','{"nome":"Aluno"}'),
  ('10000000-0000-0000-0000-000000000008', 'n@a.com',    '{"nome":"Novo"}'),
  ('10000000-0000-0000-0000-000000000009', 'z@a.com',    '{"nome":"Extra"}');

-- Bootstrap do primeiro super-admin: só por SQL (é assim em produção).
update public.profiles set status = 'ativo' where id = '10000000-0000-0000-0000-000000000001';
insert into public.user_roles (user_id, role) values ('10000000-0000-0000-0000-000000000001', 'super_admin');

-- Funções auxiliares do teste: "entrar como" alguém, com ou sem MFA.
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

-- ===== Super-admin SEM MFA não administra nada
set local role authenticated;
select pg_temp.como('10000000-0000-0000-0000-000000000001', 'aal1');
do $$ begin
  if public.e_super_admin() then raise exception 'FALHA: super-admin sem MFA passou'; end if;
  perform pg_temp.falha($q$select public.admin_definir_status('10000000-0000-0000-0000-000000000002', 'ativo')$q$,
    'admin_* rodou sem MFA');
end $$;

-- ===== Super-admin COM MFA monta o cenário pelas funções do backoffice
select pg_temp.como('10000000-0000-0000-0000-000000000001', 'aal2');
do $$
declare a uuid; b uuid; i int;
begin
  if not public.e_super_admin() then raise exception 'FALHA: super-admin com MFA não reconhecido'; end if;
  for i in 2..7 loop
    perform public.admin_definir_status(('10000000-0000-0000-0000-00000000000' || i)::uuid, 'ativo');
  end loop;
  perform public.admin_conceder_papel('10000000-0000-0000-0000-000000000002', 'equipe_iron');
  perform public.admin_conceder_papel('10000000-0000-0000-0000-000000000003', 'parceiro');
  perform public.admin_conceder_papel('10000000-0000-0000-0000-000000000007', 'aluno_b2c');

  a := public.admin_criar_empresa('Empresa A', '12.345.678/0001-90', 3);
  b := public.admin_criar_empresa('Empresa B', null, 1);
  perform set_config('teste.org_a', a::text, true);
  perform set_config('teste.org_b', b::text, true);

  perform public.admin_vincular_empresa(a, '10000000-0000-0000-0000-000000000004', 'adm_cliente');
  perform public.admin_vincular_empresa(a, '10000000-0000-0000-0000-000000000005', 'ro_cliente');
  perform public.admin_vincular_empresa(b, '10000000-0000-0000-0000-000000000006', 'adm_cliente');
  perform public.admin_atribuir_staff('10000000-0000-0000-0000-000000000002', a);
  perform public.admin_atribuir_staff('10000000-0000-0000-0000-000000000003', a);

  -- Travas do próprio backoffice
  perform pg_temp.falha($q$select public.admin_conceder_papel('10000000-0000-0000-0000-000000000002', 'super_admin')$q$,
    'super-admin concedido pela tela');
  perform pg_temp.falha($q$select public.admin_conceder_papel('10000000-0000-0000-0000-000000000001', 'equipe_iron')$q$,
    'admin alterou os próprios papéis');
  perform pg_temp.falha($q$select public.admin_definir_status('10000000-0000-0000-0000-000000000001', 'suspenso')$q$,
    'admin alterou o próprio status');
  perform pg_temp.falha($q$select public.admin_conceder_papel('10000000-0000-0000-0000-000000000002', 'adm_cliente')$q$,
    'papel de empresa usado como global');
  perform pg_temp.falha(format($q$select public.admin_vincular_empresa(%L, '10000000-0000-0000-0000-000000000007', 'equipe_iron')$q$, a),
    'papel global usado como de empresa');
  perform pg_temp.falha(format($q$select public.admin_atribuir_staff('10000000-0000-0000-0000-000000000007', %L)$q$, a),
    'aluno atribuído como staff');
  perform pg_temp.falha(format($q$select public.admin_definir_assentos(%L, 1)$q$, a),
    'assentos abaixo do número de membros');

  if (select count(*) from public.audit_log) < 10 then raise exception 'FALHA: auditoria não registrou'; end if;
end $$;

-- ===== Matriz e isolamento entre empresas
do $$
declare
  a uuid := current_setting('teste.org_a')::uuid;
  b uuid := current_setting('teste.org_b')::uuid;
  caso record;
  obtido boolean;
begin
  for caso in
    select * from (values
      -- usuário, aal, permissão, empresa, esperado
      ('2', 'aal2', 'conteudo.publicar', null, true),
      ('2', 'aal1', 'conteudo.publicar', null, false),   -- equipe sem MFA
      ('2', 'aal2', 'assessment.editar', 'a', true),     -- atribuída
      ('2', 'aal2', 'assessment.editar', 'b', false),    -- não atribuída
      ('2', 'aal2', 'assessment.editar', null, false),   -- escopo empresa sem empresa
      ('2', 'aal2', 'admin.backoffice', null, false),
      ('3', 'aal1', 'projeto.tarefas', 'a', true),       -- parceiro não exige MFA
      ('3', 'aal1', 'assessment.editar', 'a', false),
      ('3', 'aal1', 'projeto.tarefas', 'b', false),
      ('4', 'aal1', 'empresa.membros', 'a', true),
      ('4', 'aal1', 'empresa.membros', 'b', false),      -- master A na empresa B
      ('4', 'aal1', 'assessment.ver', 'b', false),
      ('4', 'aal1', 'conteudo.ver', null, true),
      ('5', 'aal1', 'assessment.ver', 'a', true),
      ('5', 'aal1', 'assessment.editar', 'a', false),
      ('5', 'aal1', 'empresa.membros', 'a', false),
      ('6', 'aal1', 'assessment.ver', 'a', false),       -- master B na empresa A
      ('7', 'aal1', 'conteudo.ver', null, true),
      ('7', 'aal1', 'assinatura.propria', null, true),
      ('7', 'aal1', 'assessment.ver', 'a', false),
      ('7', 'aal1', 'forum.moderar', null, false),
      ('8', 'aal1', 'conteudo.ver', null, false),        -- pendente sem papel
      ('1', 'aal2', 'assessment.editar', 'b', true)      -- super-admin em qualquer empresa
    ) as t (u, aal, perm, org, esperado)
  loop
    perform pg_temp.como('10000000-0000-0000-0000-00000000000' || caso.u, caso.aal);
    obtido := public.tem_permissao(caso.perm,
      case caso.org when 'a' then a when 'b' then b end);
    if obtido is distinct from caso.esperado then
      raise exception 'FALHA matriz: usuário % (%) em % / empresa % deu %, esperado %',
        caso.u, caso.aal, caso.perm, coalesce(caso.org, '-'), obtido, caso.esperado;
    end if;
  end loop;
end $$;

-- ===== Leitura pelas políticas RLS
do $$
declare n int;
begin
  -- Master A vê só a empresa A e os 2 vínculos dela
  perform pg_temp.como('10000000-0000-0000-0000-000000000004');
  select count(*) into n from public.organizations;
  if n <> 1 then raise exception 'FALHA: master A viu % empresas', n; end if;
  select count(*) into n from public.memberships;
  if n <> 2 then raise exception 'FALHA: master A viu % vínculos', n; end if;
  select count(*) into n from public.audit_log;
  if n <> 0 then raise exception 'FALHA: master leu auditoria'; end if;
  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'FALHA: master leu % perfis', n; end if;

  -- Membro A vê a empresa, mas só o próprio vínculo
  perform pg_temp.como('10000000-0000-0000-0000-000000000005');
  select count(*) into n from public.memberships;
  if n <> 1 then raise exception 'FALHA: membro viu % vínculos', n; end if;

  -- Master B não vê nada da empresa A
  perform pg_temp.como('10000000-0000-0000-0000-000000000006');
  select count(*) into n from public.organizations where nome = 'Empresa A';
  if n <> 0 then raise exception 'FALHA: master B viu a empresa A'; end if;

  -- Super-admin com MFA vê tudo
  perform pg_temp.como('10000000-0000-0000-0000-000000000001', 'aal2');
  select count(*) into n from public.profiles;
  if n < 9 then raise exception 'FALHA: admin viu só % perfis', n; end if;
  select count(*) into n from public.audit_log;
  if n = 0 then raise exception 'FALHA: admin não leu auditoria'; end if;
end $$;

-- ===== Escalada: escrita direta nas tabelas é proibida a qualquer logado
do $$ begin
  perform pg_temp.como('10000000-0000-0000-0000-000000000004');
  perform pg_temp.falha($q$insert into public.user_roles (user_id, role) values ('10000000-0000-0000-0000-000000000004', 'super_admin')$q$,
    'insert direto em user_roles');
  perform pg_temp.falha($q$update public.memberships set role = 'adm_cliente' where user_id = '10000000-0000-0000-0000-000000000005'$q$,
    'update direto em memberships');
  perform pg_temp.falha($q$update public.organizations set assentos = 9999$q$, 'master aumentou assentos');
  perform pg_temp.falha($q$insert into public.audit_log (acao, tabela) values ('x', 'y')$q$, 'insert direto na auditoria');
  perform pg_temp.falha($q$select public.admin_conceder_papel('10000000-0000-0000-0000-000000000004', 'equipe_iron')$q$,
    'master chamou admin_*');
  perform pg_temp.falha($q$update public.profiles set status = 'ativo' where id = '10000000-0000-0000-0000-000000000004'$q$,
    'mudou status pelo update');
end $$;

-- ===== Master gerencia membros: só na própria empresa, só Membro, até os assentos
do $$
declare
  a uuid := current_setting('teste.org_a')::uuid;
  b uuid := current_setting('teste.org_b')::uuid;
begin
  perform pg_temp.como('10000000-0000-0000-0000-000000000004');
  perform public.empresa_adicionar_membro(a, '10000000-0000-0000-0000-000000000008');
  -- (o status do convidado é conferido no fim, como dono: o master não lê perfis alheios)
  -- empresa A tem 3 assentos e agora 3 membros
  perform pg_temp.falha(format($q$select public.empresa_adicionar_membro(%L, '10000000-0000-0000-0000-000000000009')$q$, a),
    'passou do limite de assentos');
  perform pg_temp.falha(format($q$select public.empresa_adicionar_membro(%L, '10000000-0000-0000-0000-000000000009')$q$, b),
    'master A adicionou na empresa B');
  -- master não remove outro master (nem a si mesmo) pela função de membros
  perform public.empresa_remover_membro(a, '10000000-0000-0000-0000-000000000004');
  if not exists (select 1 from public.memberships where org_id = a and user_id = '10000000-0000-0000-0000-000000000004') then
    raise exception 'FALHA: master removeu um master';
  end if;
  perform public.empresa_remover_membro(a, '10000000-0000-0000-0000-000000000008');

  -- Membro comum não gerencia
  perform pg_temp.como('10000000-0000-0000-0000-000000000005');
  perform pg_temp.falha(format($q$select public.empresa_adicionar_membro(%L, '10000000-0000-0000-0000-000000000009')$q$, a),
    'membro adicionou colega');
end $$;

-- ===== Suspensão vale na hora
do $$ begin
  perform pg_temp.como('10000000-0000-0000-0000-000000000001', 'aal2');
  perform public.admin_definir_status('10000000-0000-0000-0000-000000000004', 'suspenso');
  perform pg_temp.como('10000000-0000-0000-0000-000000000004');
  if public.tem_permissao('assessment.ver', current_setting('teste.org_a')::uuid) then
    raise exception 'FALHA: suspenso manteve acesso';
  end if;
end $$;

-- ===== Auditoria é imutável e último super-admin não sai
reset role;
do $$ begin
  if (select status from public.profiles where id = '10000000-0000-0000-0000-000000000008') is distinct from 'ativo' then
    raise exception 'FALHA: convidado do master não ficou ativo';
  end if;
  if not exists (select 1 from public.audit_log where tabela = 'memberships' and acao = 'delete'
                 and ator = '10000000-0000-0000-0000-000000000004') then
    raise exception 'FALHA: remoção pelo master não foi auditada com o ator';
  end if;
  perform pg_temp.falha('update public.audit_log set acao = ''x''', 'auditoria alterada pelo dono');
  perform pg_temp.falha('delete from public.audit_log', 'auditoria apagada pelo dono');
  perform pg_temp.falha($q$delete from public.user_roles where role = 'super_admin'$q$, 'último super-admin removido');
end $$;

rollback;
\echo 'OK: rbac_test.sql passou'
