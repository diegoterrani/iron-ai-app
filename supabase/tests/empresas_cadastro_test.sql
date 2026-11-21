-- Testes do cadastro de empresas: quem vê (quem cadastrou e equipe IRON com
-- MFA), busca, vínculo só em rascunho pessoal editável, sincronização na
-- conclusão (sem bloquear), importação e exclusão de conta.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('94000000-0000-0000-0000-000000000001', 'ana@x.com',   '{"nome":"Ana"}', now()),
  ('94000000-0000-0000-0000-000000000002', 'beto@x.com',  '{"nome":"Beto"}', now()),
  ('94000000-0000-0000-0000-000000000003', 'iron@x.com',  '{"nome":"Equipe"}', now()),
  ('94000000-0000-0000-0000-000000000004', 'adm@a.com',   '{"nome":"ADM A"}', now());
update public.profiles set status = 'ativo' where id::text like '94000000-%';
insert into public.user_roles (user_id, role) values ('94000000-0000-0000-0000-000000000003', 'equipe_iron');
insert into public.organizations (id, nome, assentos) values ('9e000000-0000-0000-0000-000000000001', 'Empresa A', 5);
insert into public.memberships (org_id, user_id, role) values
  ('9e000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000004', 'adm_cliente');
insert into public.direitos (user_id, org_id, produto) values
  ('94000000-0000-0000-0000-000000000001', null, 'self_assessment'),
  ('94000000-0000-0000-0000-000000000002', null, 'self_assessment'),
  (null, '9e000000-0000-0000-0000-000000000001', 'self_assessment');

-- Assessments que já existiam antes do cadastro (a importação roda na migração,
-- então aqui ela é repetida com o mesmo código para conferir o efeito).
insert into public.assessments (id, user_id, org_id, setor, empresa) values
  ('9c000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000001', null, 'food_service',
   '{"nome":"Cantina São João","cnpj":"11222333000181","cidade":"Curitiba","uf":"PR"}'),
  ('9c000000-0000-0000-0000-000000000002', '94000000-0000-0000-0000-000000000002', null, 'food_service',
   '{"nome":"Buffet do Beto","cidade":"Recife","uf":"PE","contato_email":"beto@buffet.com"}'),
  ('9c000000-0000-0000-0000-000000000003', '94000000-0000-0000-0000-000000000004', '9e000000-0000-0000-0000-000000000001', 'food_service',
   '{"nome":"Empresa A"}');
update public.assessments set status = 'concluido', concluido_em = now() where id = '9c000000-0000-0000-0000-000000000001';

create function pg_temp.como(p_user text, p_aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user, true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'aal', p_aal)::text, true);
$$;
create function pg_temp.falha_com(p_sql text, p_padrao text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm like p_padrao then
      return;
    end if;
    raise exception 'FALHA: % (erro inesperado: %)', p_msg, sqlerrm;
  end;
  raise exception 'FALHA: %', p_msg;
end;
$$;

-- ===== Conclusão cria o cadastro da empresa nova (a da Ana foi concluída acima)
do $$ begin
  if (select count(*) from public.empresas_cadastro where criado_por = '94000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'FALHA: conclusão não criou o cadastro da empresa da Ana';
  end if;
  if (select empresa_id from public.assessments where id = '9c000000-0000-0000-0000-000000000001') is null then
    raise exception 'FALHA: assessment concluído sem vínculo';
  end if;
  -- Assessment de organização não entra no cadastro.
  if exists (select 1 from public.empresas_cadastro where nome = 'Empresa A') then
    raise exception 'FALHA: assessment de organização foi para o cadastro';
  end if;
end $$;

-- ===== Importação: mesma lógica da migração para o rascunho do Beto
do $$
declare v uuid;
begin
  v := public.empresa_do_assessment_no_cadastro(null, (select empresa from public.assessments where id = '9c000000-0000-0000-0000-000000000002'),
                                                '94000000-0000-0000-0000-000000000002');
  update public.assessments set empresa_id = v where id = '9c000000-0000-0000-0000-000000000002';
  if (select contato_email from public.empresas_cadastro where id = v) <> 'beto@buffet.com' then
    raise exception 'FALHA: importação perdeu o contato';
  end if;
end $$;

-- Ids guardados antes de trocar de usuário (o RLS esconde o assessment de outra pessoa).
select set_config('teste.cantina', (select empresa_id::text from public.assessments where id = '9c000000-0000-0000-0000-000000000001'), false);

-- ===== O navegador só lê: nada de inserir, alterar ou apagar direto
set local role authenticated;
select pg_temp.como('94000000-0000-0000-0000-000000000001');
do $$ begin
  perform pg_temp.falha_com($q$insert into public.empresas_cadastro (nome, criado_por) values ('X', auth.uid())$q$,
    '%permission denied%', 'navegador inseriu no cadastro');
  perform pg_temp.falha_com($q$update public.empresas_cadastro set nome = 'Y'$q$, '%permission denied%', 'navegador alterou o cadastro');
  perform pg_temp.falha_com($q$delete from public.empresas_cadastro$q$, '%permission denied%', 'navegador apagou do cadastro');
  perform pg_temp.falha_com($q$update public.assessments set empresa_id = null where id = '9c000000-0000-0000-0000-000000000002'$q$,
    '%permission denied%', 'navegador trocou o vínculo direto');
end $$;

-- ===== Quem vê: cada um as suas; a equipe IRON (com MFA) todas
do $$ begin
  if (select count(*) from public.empresas_cadastro) <> 1 then raise exception 'FALHA: Ana viu empresa de outra pessoa'; end if;
  if (select count(*) from public.buscar_empresas_cadastro('buffet')) <> 0 then raise exception 'FALHA: Ana achou a empresa do Beto'; end if;
end $$;
select pg_temp.como('94000000-0000-0000-0000-000000000003', 'aal1');
do $$ begin
  if exists (select 1 from public.empresas_cadastro) then raise exception 'FALHA: equipe sem MFA viu o cadastro'; end if;
end $$;
select pg_temp.como('94000000-0000-0000-0000-000000000003', 'aal2');
do $$ begin
  if (select count(*) from public.empresas_cadastro) <> 2 then raise exception 'FALHA: equipe com MFA não viu todas'; end if;
  -- Busca sem acento e sem caixa, por cidade, UF e CNPJ com pontuação.
  if (select nome from public.buscar_empresas_cadastro('cantina sao joao')) <> 'Cantina São João' then raise exception 'FALHA: busca sem acento'; end if;
  if (select count(*) from public.buscar_empresas_cadastro('RECIFE')) <> 1 then raise exception 'FALHA: busca por cidade'; end if;
  if (select count(*) from public.buscar_empresas_cadastro('11.222.333/0001-81')) <> 1 then raise exception 'FALHA: busca por CNPJ'; end if;
  if (select count(*) from public.buscar_empresas_cadastro('')) <> 2 then raise exception 'FALHA: sem termo não lista as recentes'; end if;
  -- Curinga do LIKE digitado é texto, não curinga.
  if (select count(*) from public.buscar_empresas_cadastro('%')) <> 0 then raise exception 'FALHA: %% virou curinga'; end if;
  if (select count(*) from public.buscar_empresas_cadastro('_')) <> 0 then raise exception 'FALHA: _ virou curinga'; end if;
end $$;

-- ===== Vínculo
select pg_temp.como('94000000-0000-0000-0000-000000000002');
do $$
declare
  cantina uuid := current_setting('teste.cantina')::uuid;
  buffet uuid;
  r jsonb;
begin
  if cantina is null then raise exception 'FALHA: preparo do teste sem a empresa da Ana'; end if;
  -- Beto não vincula a empresa da Ana (não vê).
  perform pg_temp.falha_com(format('select public.vincular_empresa_assessment(%L, %L)', '9c000000-0000-0000-0000-000000000002', cantina),
    '%empresa não encontrada%', 'vinculou empresa que não vê');
  -- Nem mexe no assessment de outra pessoa.
  perform pg_temp.falha_com(format('select public.vincular_empresa_assessment(%L, null)', '9c000000-0000-0000-0000-000000000003'),
    '%sem acesso%', 'vinculou no assessment de outra pessoa');
  select id into buffet from public.empresas_cadastro;
  -- Desvincular limpa os dados (cadastrar nova); vincular copia de novo.
  r := public.vincular_empresa_assessment('9c000000-0000-0000-0000-000000000002', null);
  if r -> 'empresa' <> '{}'::jsonb then raise exception 'FALHA: desvincular não limpou'; end if;
  r := public.vincular_empresa_assessment('9c000000-0000-0000-0000-000000000002', buffet);
  if r -> 'empresa' ->> 'nome' <> 'Buffet do Beto' or r ->> 'versao' is null then raise exception 'FALHA: vincular devolveu %', r; end if;
  if (select empresa ->> 'contato_email' from public.assessments where id = '9c000000-0000-0000-0000-000000000002') <> 'beto@buffet.com' then
    raise exception 'FALHA: vincular não copiou os dados';
  end if;
end $$;

-- Assessment concluído não muda; assessment de organização usa os dados dela.
select pg_temp.como('94000000-0000-0000-0000-000000000001');
do $$ begin
  perform pg_temp.falha_com(format('select public.vincular_empresa_assessment(%L, null)', '9c000000-0000-0000-0000-000000000001'),
    '%sem acesso%', 'mudou assessment concluído');
end $$;
select pg_temp.como('94000000-0000-0000-0000-000000000004');
do $$ begin
  perform pg_temp.falha_com(format('select public.vincular_empresa_assessment(%L, null)', '9c000000-0000-0000-0000-000000000003'),
    '%usa os dados dela%', 'vinculou cadastro em assessment de organização');
end $$;

-- ===== Conclusão atualiza o cadastro, sem apagar o que o assessment não tem e sem bloquear
reset role;
update public.assessments
set empresa = '{"nome":"Buffet do Beto Ltda","cnpj":"123","contato_cargo":"Sócio"}'
where id = '9c000000-0000-0000-0000-000000000002';
update public.assessments set status = 'concluido', concluido_em = now() where id = '9c000000-0000-0000-0000-000000000002';
do $$
declare e public.empresas_cadastro;
begin
  select * into e from public.empresas_cadastro where criado_por = '94000000-0000-0000-0000-000000000002';
  if e.nome <> 'Buffet do Beto Ltda' or e.contato_cargo <> 'Sócio' then raise exception 'FALHA: conclusão não atualizou o cadastro'; end if;
  if e.contato_email <> 'beto@buffet.com' or e.cidade <> 'Recife' then raise exception 'FALHA: conclusão apagou dado que o assessment não tinha'; end if;
  if e.cnpj is not null then raise exception 'FALHA: CNPJ incompleto entrou no cadastro'; end if;
  if (select count(*) from public.empresas_cadastro where criado_por = '94000000-0000-0000-0000-000000000002') <> 1 then
    raise exception 'FALHA: conclusão duplicou a empresa';
  end if;
end $$;

-- ===== Exclusão de conta apaga as empresas da pessoa; o assessment fica com a cópia
do $$ begin
  delete from auth.users where id = '94000000-0000-0000-0000-000000000003';
  if not exists (select 1 from public.empresas_cadastro) then raise exception 'FALHA: excluir conta da equipe apagou empresas de outros'; end if;
end $$;

rollback;
\echo 'OK: empresas_cadastro_test.sql passou'
