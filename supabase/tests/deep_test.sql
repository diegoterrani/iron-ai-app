-- Testes do Deep assessment no app: quem conduz, quem lê, histórico
-- preservado entre reuniões, respostas em lote e versionadas, relatórios,
-- tetos de turnos e retenção.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('91000000-0000-0000-0000-000000000001', 'admin@iron.io', '{"nome":"Admin"}', now()),
  ('91000000-0000-0000-0000-000000000002', 'eva@iron.io',   '{"nome":"Eva"}', now()),
  ('91000000-0000-0000-0000-000000000003', 'ivo@iron.io',   '{"nome":"Ivo"}', now()),
  ('91000000-0000-0000-0000-000000000004', 'adm@a.com',     '{"nome":"ADM A"}', now()),
  ('91000000-0000-0000-0000-000000000005', 'rw@a.com',      '{"nome":"RW A"}', now()),
  ('91000000-0000-0000-0000-000000000006', 'adm@b.com',     '{"nome":"ADM B"}', now());
update public.profiles set status = 'ativo' where id::text like '91000000-%';
insert into public.user_roles (user_id, role) values
  ('91000000-0000-0000-0000-000000000001', 'super_admin'),
  ('91000000-0000-0000-0000-000000000002', 'equipe_iron'),
  ('91000000-0000-0000-0000-000000000003', 'equipe_iron');
insert into public.organizations (id, nome, assentos) values
  ('9a000000-0000-0000-0000-000000000001', 'Empresa A', 5),
  ('9a000000-0000-0000-0000-000000000002', 'Empresa B', 5);
-- Eva atende a empresa A; Ivo não atende nenhuma.
insert into public.staff_assignments (user_id, org_id) values
  ('91000000-0000-0000-0000-000000000002', '9a000000-0000-0000-0000-000000000001');
insert into public.memberships (org_id, user_id, role) values
  ('9a000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000004', 'adm_cliente'),
  ('9a000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000005', 'rw_cliente'),
  ('9a000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000006', 'adm_cliente');
insert into public.assessments (id, user_id, org_id, setor) values
  ('9b000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000004', '9a000000-0000-0000-0000-000000000001', 'food_service'),
  ('9b000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000006', '9a000000-0000-0000-0000-000000000002', 'food_service');

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
create temp table ctx (chave text primary key, valor text);
grant all on ctx to authenticated, service_role;
-- No Supabase a service_role lê todas as tabelas; o stub não dá esse grant.
grant select on public.deep_assessments, public.deep_sessoes, public.deep_mensagens, public.deep_respostas,
  public.deep_evidencias, public.deep_pendencias, public.deep_relatorios to service_role;

-- ===== O navegador não escreve nem chama as funções do servidor
set local role authenticated;
select pg_temp.como('91000000-0000-0000-0000-000000000002', 'aal2');
do $$ begin
  perform pg_temp.falha($q$select public.deep_abrir('9a000000-0000-0000-0000-000000000001', 'food_service',
    'food_service@0.3', '{}', null, auth.uid(), true)$q$, 'navegador abriu Deep');
  perform pg_temp.falha($q$insert into public.deep_assessments (org_id, setor, pacote_versao)
    values ('9a000000-0000-0000-0000-000000000001', 'food_service', 'food_service@0.3')$q$, 'insert direto no Deep');
  perform pg_temp.falha($q$select public.deep_apagar_transcricoes_expiradas()$q$, 'navegador rodou retenção');
end $$;

-- ===== Servidor: quem pode abrir
reset role;
set local role service_role;
do $$
declare v uuid; w uuid;
begin
  -- Sem MFA, Equipe IRON não passa.
  perform pg_temp.falha($q$select public.deep_abrir('9a000000-0000-0000-0000-000000000001', 'food_service',
    'food_service@0.3', '{}', null, '91000000-0000-0000-0000-000000000002', false)$q$, 'abriu sem MFA');
  -- Equipe IRON fora da empresa não passa.
  perform pg_temp.falha($q$select public.deep_abrir('9a000000-0000-0000-0000-000000000001', 'food_service',
    'food_service@0.3', '{}', null, '91000000-0000-0000-0000-000000000003', true)$q$, 'staff não alocado abriu');
  -- Cliente não conduz, nem o ADM.
  perform pg_temp.falha($q$select public.deep_abrir('9a000000-0000-0000-0000-000000000001', 'food_service',
    'food_service@0.3', '{}', null, '91000000-0000-0000-0000-000000000004', true)$q$, 'ADM-Cliente abriu');
  -- Self de outra empresa não entra.
  perform pg_temp.falha($q$select public.deep_abrir('9a000000-0000-0000-0000-000000000001', 'food_service',
    'food_service@0.3', '{}', '9b000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000002', true)$q$,
    'aceitou Self de outra empresa');
  perform pg_temp.falha($q$select public.deep_abrir('9a000000-0000-0000-0000-000000000001', 'food_service',
    'food service 0.3', '{}', null, '91000000-0000-0000-0000-000000000002', true)$q$, 'versão de pacote inválida');

  v := public.deep_abrir('9a000000-0000-0000-0000-000000000001', 'food_service', 'food_service@0.3',
    '{"empresas":3}', '9b000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000002', true);
  w := public.deep_abrir('9a000000-0000-0000-0000-000000000001', 'food_service', 'food_service@0.3',
    '{}', null, '91000000-0000-0000-0000-000000000001', true);
  if v <> w then raise exception 'FALHA: abrir de novo não retomou o Deep em andamento'; end if;
  insert into ctx values ('deep', v::text);
end $$;

-- ===== Reunião 1 (área A): participantes, turnos e falas
do $$
declare
  d uuid := (select valor::uuid from ctx where chave = 'deep');
  s uuid; s2 uuid; h jsonb; o integer;
begin
  perform pg_temp.falha(format($q$select public.deep_abrir_sessao(%L, 'A', 'Cozinha',
    '[{"nome":"Rita","cpf":"123"}]', '91000000-0000-0000-0000-000000000002', true)$q$, d), 'aceitou CPF de participante');
  perform pg_temp.falha(format($q$select public.deep_abrir_sessao(%L, 'D', 'X', '[]',
    '91000000-0000-0000-0000-000000000002', true)$q$, d), 'aceitou área inexistente');
  perform pg_temp.falha(format($q$select public.deep_abrir_sessao(%L, 'A', 'Cozinha', '[]',
    '91000000-0000-0000-0000-000000000003', true)$q$, d), 'staff não alocado abriu reunião');

  s := public.deep_abrir_sessao(d, 'A', 'Cozinha de produção',
    '[{"nome":"Rita","cargo":"Chef executiva"},{"nome":"Caio"}]', '91000000-0000-0000-0000-000000000002', true);
  s2 := public.deep_abrir_sessao(d, 'A', 'outra', '[]', '91000000-0000-0000-0000-000000000002', true);
  if s <> s2 then raise exception 'FALHA: reabrir não retomou a reunião aberta da área'; end if;
  insert into ctx values ('s1', s::text);

  h := public.deep_reservar_turno(s, '91000000-0000-0000-0000-000000000002', true);
  if h <> '[]'::jsonb then raise exception 'FALHA: reunião nova não começou vazia'; end if;
  o := public.deep_gravar_mensagens(s, '91000000-0000-0000-0000-000000000002', true,
    '[{"papel":"analista","conteudo":"Começar"},{"papel":"agente","conteudo":[{"type":"text","text":"Quantas cozinhas?"}]}]',
    100, 20, 0, 50);
  if o <> 2 then raise exception 'FALHA: ordem das falas %', o; end if;
  h := public.deep_reservar_turno(s, '91000000-0000-0000-0000-000000000002', true);
  o := public.deep_gravar_mensagens(s, '91000000-0000-0000-0000-000000000002', true,
    '[{"papel":"analista","conteudo":"Uma central e 7 satélites; perda de 6%; compras pelo Excel"}]', 10, 5, 100, 0);
  h := public.deep_reservar_turno(s, '91000000-0000-0000-0000-000000000002', true);
  if jsonb_array_length(h) <> 3 or h -> 2 ->> 'papel' <> 'analista' then
    raise exception 'FALHA: histórico da reunião não voltou em ordem';
  end if;

  perform pg_temp.falha(format($q$select public.deep_gravar_mensagens(%L, '91000000-0000-0000-0000-000000000002', true,
    '[{"papel":"sistema","conteudo":"x"}]', 0, 0, 0, 0)$q$, s), 'aceitou papel inválido');
  perform pg_temp.falha(format($q$select public.deep_gravar_mensagens(%L, '91000000-0000-0000-0000-000000000002', true,
    '[{"papel":"agente","conteudo":"x","ordem":1}]', 0, 0, 0, 0)$q$, s), 'aceitou campo extra na fala');
  perform pg_temp.falha(format($q$select public.deep_gravar_mensagens(%L, '91000000-0000-0000-0000-000000000002', true,
    '[{"papel":"agente","conteudo":"x"}]', -1, 0, 0, 0)$q$, s), 'descontou tokens');
end $$;

-- ===== Várias respostas numa fala só; repetir não duplica; corrigir versiona
do $$
declare
  d uuid := (select valor::uuid from ctx where chave = 'deep');
  s uuid := (select valor::uuid from ctx where chave = 's1');
  r jsonb;
begin
  r := public.deep_registrar_respostas(s, '91000000-0000-0000-0000-000000000002', true, '[
    {"pergunta_id":"a.cozinhas","valor":{"central":1,"satelites":7},"confianca":"alta","participante":"Rita","trecho":"Uma central e 7 satélites","mensagem_ordem":3},
    {"pergunta_id":"a.perda_pct","valor":6,"confianca":"media","participante":"Rita"},
    {"pergunta_id":"a.compras_sistema","valor":"planilha","confianca":"alta"}
  ]');
  if r <> '{"gravadas":3,"inalteradas":0}'::jsonb then raise exception 'FALHA: lote 1 %', r; end if;

  r := public.deep_registrar_respostas(s, '91000000-0000-0000-0000-000000000002', true, '[
    {"pergunta_id":"a.perda_pct","valor":6,"confianca":"media"},
    {"pergunta_id":"a.compras_sistema","valor":"planilha","confianca":"alta"}
  ]');
  if r <> '{"gravadas":0,"inalteradas":2}'::jsonb then raise exception 'FALHA: repetir gravou de novo %', r; end if;

  r := public.deep_registrar_respostas(s, '91000000-0000-0000-0000-000000000002', true, '[
    {"pergunta_id":"a.perda_pct","valor":8,"confianca":"alta","participante":"Caio"},
    {"pergunta_id":"a.buffet","nao_se_aplica":true,"valor":"ignorado","confianca":"alta"}
  ]');
  if r <> '{"gravadas":2,"inalteradas":0}'::jsonb then raise exception 'FALHA: correção %', r; end if;

  if (select count(*) from public.deep_respostas where deep_id = d and pergunta_id = 'a.perda_pct') <> 2
     or (select valor from public.deep_respostas where deep_id = d and pergunta_id = 'a.perda_pct' and status = 'vigente') <> '8'
     or not exists (select 1 from public.deep_respostas n join public.deep_respostas a on a.id = n.substitui_id
                    where n.pergunta_id = 'a.perda_pct' and a.status = 'substituida' and a.valor = '6') then
    raise exception 'FALHA: versão anterior não ficou guardada';
  end if;
  if (select valor from public.deep_respostas where pergunta_id = 'a.buffet') is not null then
    raise exception 'FALHA: não se aplica guardou valor';
  end if;

  perform pg_temp.falha(format($q$select public.deep_registrar_respostas(%L, '91000000-0000-0000-0000-000000000002', true,
    '[{"pergunta_id":"a.x","valor":1,"confianca":"alta"},{"pergunta_id":"a.x","valor":2,"confianca":"alta"}]')$q$, s),
    'aceitou pergunta repetida no lote');
  perform pg_temp.falha(format($q$select public.deep_registrar_respostas(%L, '91000000-0000-0000-0000-000000000002', true,
    '[{"pergunta_id":"a.x","valor":1,"confianca":"certeza"}]')$q$, s), 'aceitou confiança inválida');
  perform pg_temp.falha(format($q$select public.deep_registrar_respostas(%L, '91000000-0000-0000-0000-000000000002', true,
    '[{"pergunta_id":"a.x","confianca":"alta"}]')$q$, s), 'aceitou resposta sem valor');
  perform pg_temp.falha(format($q$select public.deep_registrar_respostas(%L, '91000000-0000-0000-0000-000000000002', true,
    '[{"pergunta_id":"A x; drop","valor":1,"confianca":"alta"}]')$q$, s), 'aceitou id de pergunta inválido');
  perform pg_temp.falha(format($q$select public.deep_registrar_respostas(%L, '91000000-0000-0000-0000-000000000003', true,
    '[{"pergunta_id":"a.x","valor":1,"confianca":"alta"}]')$q$, s), 'staff não alocado registrou resposta');
  perform pg_temp.falha(format($q$select public.deep_registrar_respostas(%L, '91000000-0000-0000-0000-000000000002', true,
    '[]')$q$, s), 'aceitou lote vazio');

  r := public.deep_registrar_evidencias(s, '91000000-0000-0000-0000-000000000002', true,
    '[{"criterio_id":"prontidao.ficha_tecnica","tipo":"documento","fonte":"F05","descricao":"Fichas técnicas de 40 pratos","cumprido":true}]');
  if r ->> 'gravadas' <> '1' then raise exception 'FALHA: evidência %', r; end if;
  perform pg_temp.falha(format($q$select public.deep_registrar_evidencias(%L, '91000000-0000-0000-0000-000000000002', true,
    '[{"criterio_id":"x","tipo":"documento","fonte":"Fx","descricao":"d"}]')$q$, s), 'aceitou fonte fora de F01-F99');

  insert into ctx values ('p1', public.deep_registrar_pendencia(s, '91000000-0000-0000-0000-000000000002', true,
    'F03', 'Enviar DRE de 2025 por empresa', 'Financeiro', current_date + 7)::text);
end $$;

-- ===== Registros não mudam por fora das funções (nem pelo dono das tabelas)
reset role;
do $$ begin
  perform pg_temp.falha($q$update public.deep_mensagens set conteudo = '"forjado"'$q$, 'editou fala');
  perform pg_temp.falha($q$delete from public.deep_mensagens$q$, 'apagou fala');
  perform pg_temp.falha($q$update public.deep_respostas set valor = '99' where status = 'vigente'$q$, 'editou resposta');
  perform pg_temp.falha($q$update public.deep_respostas set status = 'vigente' where status = 'substituida'$q$,
    'revigorou resposta substituída');
  perform pg_temp.falha($q$update public.deep_respostas set trecho = null where trecho is not null$q$,
    'apagou trecho fora da retenção');
  perform pg_temp.falha($q$delete from public.deep_respostas$q$, 'apagou resposta');
  perform pg_temp.falha($q$delete from public.deep_evidencias$q$, 'apagou evidência');
end $$;

-- ===== Teto de turnos da reunião e do Deep
update public.deep_sessoes set turnos = public.deep_max_turnos_sessao() where id = (select valor::uuid from ctx where chave = 's1');
set local role service_role;
do $$ begin
  perform pg_temp.falha(format($q$select public.deep_reservar_turno(%L, '91000000-0000-0000-0000-000000000002', true)$q$,
    (select valor from ctx where chave = 's1')), 'passou do teto da reunião');
end $$;
reset role;
update public.deep_sessoes set turnos = 3 where id = (select valor::uuid from ctx where chave = 's1');
update public.deep_assessments set turnos = public.deep_max_turnos_deep();
set local role service_role;
do $$ begin
  perform pg_temp.falha(format($q$select public.deep_reservar_turno(%L, '91000000-0000-0000-0000-000000000002', true)$q$,
    (select valor from ctx where chave = 's1')), 'passou do teto do Deep');
end $$;
reset role;
update public.deep_assessments set turnos = 3;

-- ===== Encerrar a reunião; a próxima reunião só vê o resumo
set local role service_role;
do $$
declare
  d uuid := (select valor::uuid from ctx where chave = 'deep');
  s uuid := (select valor::uuid from ctx where chave = 's1');
  e jsonb; s2 uuid;
begin
  perform pg_temp.falha(format($q$select public.deep_encerrar_sessao(%L, '  ', '91000000-0000-0000-0000-000000000002', true)$q$, s),
    'encerrou sem resumo');
  perform public.deep_encerrar_sessao(s, 'Cozinha central + 7 satélites; perda 8%; compras em planilha.',
    '91000000-0000-0000-0000-000000000002', true);
  perform pg_temp.falha(format($q$select public.deep_gravar_mensagens(%L, '91000000-0000-0000-0000-000000000002', true,
    '[{"papel":"agente","conteudo":"x"}]', 0, 0, 0, 0)$q$, s), 'gravou em reunião encerrada');
  perform pg_temp.falha(format($q$select public.deep_registrar_respostas(%L, '91000000-0000-0000-0000-000000000002', true,
    '[{"pergunta_id":"a.x","valor":1,"confianca":"alta"}]')$q$, s), 'respondeu em reunião encerrada');

  s2 := public.deep_abrir_sessao(d, 'A', 'Cozinha, parte 2', '[]', '91000000-0000-0000-0000-000000000002', true);
  if s2 = s then raise exception 'FALHA: reaproveitou reunião encerrada'; end if;
  if public.deep_reservar_turno(s2, '91000000-0000-0000-0000-000000000002', true) <> '[]'::jsonb then
    raise exception 'FALHA: falas de outra reunião vazaram';
  end if;
  insert into ctx values ('s2', s2::text);

  e := public.deep_estado(d, '91000000-0000-0000-0000-000000000002', true);
  if jsonb_array_length(e -> 'sessoes') <> 2 or e -> 'sessoes' -> 0 ->> 'resumo' not like 'Cozinha central%'
     or jsonb_array_length(e -> 'respostas') <> 4 or jsonb_array_length(e -> 'evidencias') <> 1
     or jsonb_array_length(e -> 'pendencias_abertas') <> 1 then
    raise exception 'FALHA: estado do Deep incompleto: %', e;
  end if;
  perform pg_temp.falha(format($q$select public.deep_estado(%L, '91000000-0000-0000-0000-000000000004', true)$q$, d),
    'ADM-Cliente leu o estado do Deep');

  perform public.deep_fechar_pendencia((select valor::uuid from ctx where chave = 'p1'), 'recebida', 'DRE recebido',
    '91000000-0000-0000-0000-000000000002', true);
  perform pg_temp.falha(format($q$select public.deep_fechar_pendencia(%L, 'cancelada', null, '91000000-0000-0000-0000-000000000002', true)$q$,
    (select valor from ctx where chave = 'p1')), 'fechou pendência duas vezes');
end $$;

-- ===== Relatórios: parcial por área, final só com reuniões encerradas
do $$
declare
  d uuid := (select valor::uuid from ctx where chave = 'deep');
  r1 uuid; r2 uuid; rf uuid;
begin
  r1 := public.deep_gerar_relatorio(d, 'parcial', 'A', '{"area":"A","linha_base":{}}', 'deep@0.1',
    '91000000-0000-0000-0000-000000000002', true);
  r2 := public.deep_gerar_relatorio(d, 'parcial', 'A', '{"area":"A","linha_base":{"perda":8}}', 'deep@0.1',
    '91000000-0000-0000-0000-000000000002', true);
  if (select versao from public.deep_relatorios where id = r2) <> 2 then raise exception 'FALHA: versão do relatório'; end if;
  perform pg_temp.falha(format($q$select public.deep_gerar_relatorio(%L, 'parcial', null, '{}', 'deep@0.1',
    '91000000-0000-0000-0000-000000000002', true)$q$, d), 'parcial sem área');
  perform pg_temp.falha(format($q$select public.deep_gerar_relatorio(%L, 'final', null, '{}', 'deep@0.1',
    '91000000-0000-0000-0000-000000000002', true)$q$, d), 'final com reunião aberta');
  perform public.deep_publicar_relatorio(r2, '91000000-0000-0000-0000-000000000002', true);
  perform pg_temp.falha(format($q$select public.deep_publicar_relatorio(%L, '91000000-0000-0000-0000-000000000002', true)$q$, r2),
    'publicou duas vezes');
  perform pg_temp.falha(format($q$select public.deep_concluir(%L, '91000000-0000-0000-0000-000000000002', true)$q$, d),
    'concluiu sem relatório final');
  insert into ctx values ('r1', r1::text), ('r2', r2::text);
end $$;

reset role;
do $$ begin
  perform pg_temp.falha($q$update public.deep_relatorios set conteudo = '{"forjado":true}'$q$, 'editou relatório');
  perform pg_temp.falha($q$update public.deep_relatorios set publicado_em = null where publicado_em is not null$q$, 'despublicou');
  perform pg_temp.falha($q$delete from public.deep_relatorios$q$, 'apagou relatório');
end $$;

-- ===== Quem lê pela API (RLS)
set local role authenticated;
select pg_temp.como('91000000-0000-0000-0000-000000000002', 'aal2');
do $$ begin
  if (select count(*) from public.deep_assessments) <> 1 or (select count(*) from public.deep_mensagens) <> 3
     or (select count(*) from public.deep_respostas) <> 5 or (select count(*) from public.deep_relatorios) <> 2 then
    raise exception 'FALHA: analista alocada não vê o Deep';
  end if;
end $$;
select pg_temp.como('91000000-0000-0000-0000-000000000002', 'aal1');
do $$ begin
  if exists (select 1 from public.deep_assessments) or exists (select 1 from public.deep_mensagens) then
    raise exception 'FALHA: analista sem MFA viu o Deep';
  end if;
end $$;
select pg_temp.como('91000000-0000-0000-0000-000000000003', 'aal2');
do $$ begin
  if exists (select 1 from public.deep_assessments) or exists (select 1 from public.deep_relatorios) then
    raise exception 'FALHA: staff não alocado viu o Deep';
  end if;
end $$;
select pg_temp.como('91000000-0000-0000-0000-000000000004');
do $$ begin
  if exists (select 1 from public.deep_assessments) or exists (select 1 from public.deep_sessoes)
     or exists (select 1 from public.deep_mensagens) or exists (select 1 from public.deep_respostas)
     or exists (select 1 from public.deep_pendencias) then
    raise exception 'FALHA: ADM-Cliente viu a condução do Deep';
  end if;
  if (select count(*) from public.deep_relatorios) <> 1
     or (select versao from public.deep_relatorios) <> 2 then
    raise exception 'FALHA: ADM-Cliente não vê só o relatório publicado';
  end if;
  perform pg_temp.falha($q$update public.deep_relatorios set conteudo = '{}'$q$, 'ADM-Cliente editou relatório');
end $$;
select pg_temp.como('91000000-0000-0000-0000-000000000005');
do $$ begin
  if exists (select 1 from public.deep_relatorios) then raise exception 'FALHA: RW-Cliente viu relatório'; end if;
end $$;
select pg_temp.como('91000000-0000-0000-0000-000000000006');
do $$ begin
  if exists (select 1 from public.deep_relatorios) then raise exception 'FALHA: ADM de outra empresa viu relatório'; end if;
  if public.deep_org((select valor::uuid from ctx where chave = 'deep')) is not null then
    raise exception 'FALHA: deep_org revelou a empresa de outro cliente';
  end if;
end $$;

-- ===== Fechar o Deep: final publicado e conclusão
reset role;
set local role service_role;
do $$
declare
  d uuid := (select valor::uuid from ctx where chave = 'deep');
  rf uuid;
begin
  perform public.deep_encerrar_sessao((select valor::uuid from ctx where chave = 's2'), 'Sem novidades.',
    '91000000-0000-0000-0000-000000000002', true);
  rf := public.deep_gerar_relatorio(d, 'final', null, '{"lacuna":{}}', 'deep@0.1', '91000000-0000-0000-0000-000000000002', true);
  perform public.deep_publicar_relatorio(rf, '91000000-0000-0000-0000-000000000001', true);
  perform public.deep_concluir(d, '91000000-0000-0000-0000-000000000002', true);
  perform pg_temp.falha(format($q$select public.deep_abrir_sessao(%L, 'B', 'Salão', '[]', '91000000-0000-0000-0000-000000000002', true)$q$, d),
    'abriu reunião em Deep concluído');
  -- Concluído, um novo Deep da empresa pode ser aberto.
  if public.deep_abrir('9a000000-0000-0000-0000-000000000001', 'food_service', 'food_service@0.3', '{}', null,
       '91000000-0000-0000-0000-000000000002', true) = d then
    raise exception 'FALHA: reabriu Deep concluído';
  end if;
end $$;

-- ===== Retenção: 12 meses depois do contrato, falas e trechos saem
do $$
declare
  d uuid := (select valor::uuid from ctx where chave = 'deep');
  n integer;
begin
  perform public.deep_definir_contrato_fim(d, current_date - 400, '91000000-0000-0000-0000-000000000002', true);
  n := public.deep_apagar_transcricoes_expiradas();
  if n <> 3 then raise exception 'FALHA: retenção apagou % falas', n; end if;
end $$;
reset role;
do $$
declare d uuid := (select valor::uuid from ctx where chave = 'deep');
begin
  if exists (select 1 from public.deep_mensagens where deep_id = d)
     or exists (select 1 from public.deep_respostas where deep_id = d and trecho is not null) then
    raise exception 'FALHA: transcrição ficou depois da retenção';
  end if;
  if (select count(*) from public.deep_respostas where deep_id = d) <> 5
     or (select count(*) from public.deep_relatorios where deep_id = d) <> 3
     or not exists (select 1 from public.deep_sessoes where deep_id = d and resumo like 'Cozinha central%') then
    raise exception 'FALHA: retenção levou respostas, relatórios ou resumos';
  end if;
  -- A chave de retenção não fica ligada depois da função.
  if public.deep_em_retencao() then raise exception 'FALHA: retenção deixou a porta aberta'; end if;
  -- Auditoria registrou quem fez o quê, sem copiar respostas.
  if (select count(*) from public.audit_log where acao like 'deep.%'
        and ator = '91000000-0000-0000-0000-000000000002') < 10
     or exists (select 1 from public.audit_log where acao = 'deep.respostas' and dados::text like '%planilha%') then
    raise exception 'FALHA: auditoria do Deep';
  end if;
end $$;

-- ===== Excluir a conta do analista não esbarra nos registros imutáveis
delete from auth.users where id = '91000000-0000-0000-0000-000000000002';
do $$ begin
  if exists (select 1 from public.deep_respostas where registrado_por is not null)
     or exists (select 1 from public.deep_relatorios where gerado_por is not null)
     or (select count(*) from public.deep_respostas) <> 5 then
    raise exception 'FALHA: exclusão da conta do analista';
  end if;
  perform pg_temp.falha($q$update public.deep_relatorios set publicado_em = publicado_em + interval '1 day' where publicado_em is not null$q$,
    'mudou data de publicação');
end $$;

rollback;
\echo 'OK: deep_test.sql passou'
