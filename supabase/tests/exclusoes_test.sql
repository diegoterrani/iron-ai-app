-- Testes de excluir empresa e excluir usuário (migração 20261124100000).
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('b1000000-0000-0000-0000-000000000001', 'admin@iron.io', '{"nome":"Admin"}', now()),
  ('b1000000-0000-0000-0000-000000000002', 'ana@cliente.com', '{"nome":"Ana"}', now()),
  ('b1000000-0000-0000-0000-000000000003', 'beto@cliente.com', '{"nome":"Beto"}', now()),
  ('b1000000-0000-0000-0000-000000000004', 'admin2@iron.io', '{"nome":"Admin 2"}', now());
update public.profiles set status = 'ativo' where id::text like 'b1000000-%';
insert into public.user_roles (user_id, role) values
  ('b1000000-0000-0000-0000-000000000001', 'super_admin'),
  ('b1000000-0000-0000-0000-000000000004', 'super_admin');

-- Empresa com tudo: pessoas, acesso, convite, Self da empresa com resultado e
-- escuta, Deep com sessão, falas, resposta, evidência, relatório e escuta.
insert into public.organizations (id, nome, cnpj, assentos) values
  ('b2000000-0000-0000-0000-000000000001', 'Restaurante Árvore LTDA', '11222333000181', 5),
  ('b2000000-0000-0000-0000-000000000002', 'Outra Empresa', null, 5);
insert into public.memberships (org_id, user_id, role) values
  ('b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 'adm_cliente'),
  ('b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003', 'rw_cliente');
insert into public.direitos (org_id, produto, origem) values ('b2000000-0000-0000-0000-000000000001', 'self_assessment', 'manual');
insert into public.assessments (id, user_id, org_id, setor, status, concluido_em) values
  ('b3000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001', 'food_service', 'concluido', now()),
  -- Self pessoal do Beto e Self da OUTRA empresa iniciado por ele.
  ('b3000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000003', null, 'food_service', 'concluido', now()),
  ('b3000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000002', 'food_service', 'concluido', now());
insert into public.assessment_resultados (assessment_id, motor_versao, modelo_versao, pacote_versao, hash_respostas, resultado) values
  ('b3000000-0000-0000-0000-000000000001', '0.7.0', '0.7.0', 'food_service 0.5.0', '0123456789abcdef', '{}'),
  ('b3000000-0000-0000-0000-000000000003', '0.7.0', '0.7.0', 'food_service 0.5.0', '0123456789abcdef', '{}');
insert into public.self_escuta_blocos (assessment_id, user_id, seq, canal, texto)
values ('b3000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 1, 'sala', 'trecho ouvido');
insert into public.deep_assessments (id, org_id, setor, pacote_versao, self_assessment_id) values
  ('b4000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'food_service', 'food_service@0.3',
   'b3000000-0000-0000-0000-000000000001');
insert into public.deep_sessoes (id, deep_id, numero, area, titulo) values
  ('b5000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', 1, 'A', 'Cozinha');
insert into public.deep_mensagens (deep_id, sessao_id, ordem, papel, conteudo) values
  ('b4000000-0000-0000-0000-000000000001', 'b5000000-0000-0000-0000-000000000001', 1, 'analista', '"oi"');
insert into public.deep_respostas (deep_id, pergunta_id, area, valor, confianca, sessao_id) values
  ('b4000000-0000-0000-0000-000000000001', 'a1', 'A', '1', 'alta', 'b5000000-0000-0000-0000-000000000001');
insert into public.deep_evidencias (deep_id, criterio_id, area, tipo, descricao, sessao_id) values
  ('b4000000-0000-0000-0000-000000000001', 'c1', 'A', 'observacao', 'viu', 'b5000000-0000-0000-0000-000000000001');
insert into public.deep_relatorios (deep_id, tipo, area, versao, conteudo, motor_versao) values
  ('b4000000-0000-0000-0000-000000000001', 'parcial', 'A', 1, '{}', '0.1');
insert into public.deep_escuta_blocos (deep_id, sessao_id, seq, canal, texto) values
  ('b4000000-0000-0000-0000-000000000001', 'b5000000-0000-0000-0000-000000000001', 1, 'sala', 'fala');

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

-- ===== Sem a chave de purga, o Deep continua somente inserção (nem o dono apaga)
do $$ begin
  perform pg_temp.falha($q$delete from public.deep_mensagens where deep_id = 'b4000000-0000-0000-0000-000000000001'$q$,
    'fala do Deep apagada fora da purga');
  perform pg_temp.falha($q$delete from public.deep_respostas where deep_id = 'b4000000-0000-0000-0000-000000000001'$q$,
    'resposta do Deep apagada fora da purga');
  perform pg_temp.falha($q$delete from public.deep_relatorios where deep_id = 'b4000000-0000-0000-0000-000000000001'$q$,
    'relatório do Deep apagado fora da purga');
end $$;

set local role authenticated;

-- ===== Cliente (mesmo ADM) não exclui empresa nem usuário
select pg_temp.como('b1000000-0000-0000-0000-000000000002', 'aal2');
do $$ begin
  perform pg_temp.falha($q$select public.admin_excluir_empresa('b2000000-0000-0000-0000-000000000001', 'Restaurante Árvore LTDA', 'teste de exclusão')$q$,
    'ADM-Cliente excluiu a empresa');
  perform pg_temp.falha($q$select public.admin_autorizar_exclusao_usuario('b1000000-0000-0000-0000-000000000003', 'beto@cliente.com')$q$,
    'ADM-Cliente autorizou excluir usuário');
  perform pg_temp.falha($q$delete from public.organizations where id = 'b2000000-0000-0000-0000-000000000001'$q$,
    'cliente apagou empresa direto na tabela');
end $$;

-- ===== Super-admin sem MFA não exclui
select pg_temp.como('b1000000-0000-0000-0000-000000000001', 'aal1');
do $$ begin
  perform pg_temp.falha($q$select public.admin_excluir_empresa('b2000000-0000-0000-0000-000000000001', 'Restaurante Árvore LTDA', 'teste de exclusão')$q$,
    'super-admin sem MFA excluiu empresa');
end $$;

-- ===== Com MFA: exige nome certo e motivo
select pg_temp.como('b1000000-0000-0000-0000-000000000001', 'aal2');
do $$ begin
  perform pg_temp.falha($q$select public.admin_excluir_empresa('b2000000-0000-0000-0000-000000000001', 'Restaurante', 'teste de exclusão')$q$,
    'excluiu com nome incompleto');
  perform pg_temp.falha($q$select public.admin_excluir_empresa('b2000000-0000-0000-0000-000000000001', '', 'teste de exclusão')$q$,
    'excluiu sem nome');
  perform pg_temp.falha($q$select public.admin_excluir_empresa('b2000000-0000-0000-0000-000000000001', 'Restaurante Árvore LTDA', 'ab')$q$,
    'excluiu sem motivo');
  perform pg_temp.falha($q$select public.admin_excluir_empresa('b2000000-0000-0000-0000-0000000000ff', 'x', 'teste de exclusão')$q$,
    'excluiu empresa inexistente');
end $$;

-- Caixa, acento e espaços não importam.
do $$
declare r jsonb;
begin
  r := public.admin_excluir_empresa('b2000000-0000-0000-0000-000000000001', '  restaurante   arvore ltda ', 'cliente encerrou o projeto');
  if r <> '{"deep": 1, "assessments": 1, "pessoas": 2, "equipe": 0, "convites": 0, "acessos": 1}'::jsonb then
    raise exception 'FALHA: contagem inesperada %', r;
  end if;
end $$;

reset role;
do $$ begin
  if exists (select 1 from public.organizations where id = 'b2000000-0000-0000-0000-000000000001') then
    raise exception 'FALHA: empresa não saiu';
  end if;
  if exists (select 1 from public.deep_assessments where id = 'b4000000-0000-0000-0000-000000000001')
     or exists (select 1 from public.deep_mensagens where deep_id = 'b4000000-0000-0000-0000-000000000001')
     or exists (select 1 from public.deep_respostas where deep_id = 'b4000000-0000-0000-0000-000000000001')
     or exists (select 1 from public.deep_relatorios where deep_id = 'b4000000-0000-0000-0000-000000000001')
     or exists (select 1 from public.deep_escuta_blocos where deep_id = 'b4000000-0000-0000-0000-000000000001') then
    raise exception 'FALHA: sobrou dado do Deep';
  end if;
  if exists (select 1 from public.assessments where id = 'b3000000-0000-0000-0000-000000000001')
     or exists (select 1 from public.self_escuta_blocos where assessment_id = 'b3000000-0000-0000-0000-000000000001') then
    raise exception 'FALHA: sobrou Self da empresa';
  end if;
  if exists (select 1 from public.memberships where org_id = 'b2000000-0000-0000-0000-000000000001')
     or exists (select 1 from public.direitos where org_id = 'b2000000-0000-0000-0000-000000000001') then
    raise exception 'FALHA: sobrou vínculo ou acesso';
  end if;
  -- As pessoas continuam, e o resto não foi tocado.
  if (select count(*) from public.profiles where id::text like 'b1000000-%') <> 4 then
    raise exception 'FALHA: conta de pessoa saiu junto com a empresa';
  end if;
  if not exists (select 1 from public.assessments where id = 'b3000000-0000-0000-0000-000000000003') then
    raise exception 'FALHA: Self de outra empresa saiu';
  end if;
  if (select dados ->> 'motivo' from public.audit_log where acao = 'empresa_excluida'
      and alvo = 'b2000000-0000-0000-0000-000000000001') is distinct from 'cliente encerrou o projeto' then
    raise exception 'FALHA: exclusão da empresa sem auditoria';
  end if;
  -- A chave de purga não vaza da função.
  if public.em_purga() then
    raise exception 'FALHA: chave de purga continuou ligada';
  end if;
end $$;

-- ===== Excluir usuário: conferências do passo 1
set local role authenticated;
select pg_temp.como('b1000000-0000-0000-0000-000000000001', 'aal2');
do $$ begin
  perform pg_temp.falha($q$select public.admin_autorizar_exclusao_usuario('b1000000-0000-0000-0000-000000000001', 'admin@iron.io')$q$,
    'autorizou excluir a própria conta');
  perform pg_temp.falha($q$select public.admin_autorizar_exclusao_usuario('b1000000-0000-0000-0000-000000000004', 'admin2@iron.io')$q$,
    'autorizou excluir super-admin');
  perform pg_temp.falha($q$select public.admin_autorizar_exclusao_usuario('b1000000-0000-0000-0000-000000000003', 'ana@cliente.com')$q$,
    'autorizou com e-mail de outra pessoa');
  perform pg_temp.falha($q$select public.admin_registrar_exclusao_usuario('b1000000-0000-0000-0000-000000000003', 'saiu')$q$,
    'registrou exclusão de conta que ainda existe');
  if public.admin_autorizar_exclusao_usuario('b1000000-0000-0000-0000-000000000003', ' BETO@cliente.com ')
     <> 'b1000000-0000-0000-0000-000000000003' then
    raise exception 'FALHA: autorização devolveu outra conta';
  end if;
end $$;

-- Passo do servidor (Auth Admin API) simulado: apagar a conta no auth.
reset role;
delete from auth.users where id = 'b1000000-0000-0000-0000-000000000003';

set local role authenticated;
select pg_temp.como('b1000000-0000-0000-0000-000000000001', 'aal2');
select public.admin_registrar_exclusao_usuario('b1000000-0000-0000-0000-000000000003', 'pedido do cliente');

reset role;
do $$ begin
  -- Self pessoal sai com a conta; Self da empresa fica, sem autor, com o resultado.
  if exists (select 1 from public.assessments where id = 'b3000000-0000-0000-0000-000000000002') then
    raise exception 'FALHA: Self pessoal ficou depois de excluir a conta';
  end if;
  if (select user_id from public.assessments where id = 'b3000000-0000-0000-0000-000000000003') is not null then
    raise exception 'FALHA: Self da empresa sumiu ou manteve o autor excluído';
  end if;
  if not exists (select 1 from public.assessment_resultados where assessment_id = 'b3000000-0000-0000-0000-000000000003') then
    raise exception 'FALHA: resultado do Self da empresa saiu com a conta';
  end if;
  if not exists (select 1 from public.audit_log where acao = 'usuario_excluido' and alvo = 'b1000000-0000-0000-0000-000000000003') then
    raise exception 'FALHA: exclusão de usuário sem auditoria';
  end if;
  -- Assessment pessoal continua exigindo autor.
  begin
    insert into public.assessments (user_id, org_id, setor) values (null, null, 'food_service');
    raise exception 'FALHA: assessment sem autor e sem empresa';
  exception when check_violation then null;
  end;
end $$;

rollback;
\echo 'exclusoes_test: ok'
