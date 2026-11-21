-- Testes da escuta no Self: quem pode ligar (editar + direito), consentimento
-- com validade, cota de minutos, blocos só no modo contínuo, "a confirmar"
-- bloqueando a conclusão, origem das respostas, imutabilidade, RLS e retenção.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('93000000-0000-0000-0000-000000000001', 'ana@x.com',  '{"nome":"Ana"}', now()),
  ('93000000-0000-0000-0000-000000000002', 'beto@x.com', '{"nome":"Beto"}', now()),
  ('93000000-0000-0000-0000-000000000003', 'adm@a.com',  '{"nome":"ADM A"}', now()),
  ('93000000-0000-0000-0000-000000000004', 'rw@a.com',   '{"nome":"RW A"}', now()),
  ('93000000-0000-0000-0000-000000000005', 'ro@a.com',   '{"nome":"RO A"}', now()),
  ('93000000-0000-0000-0000-000000000006', 'adm@b.com',  '{"nome":"ADM B"}', now());
update public.profiles set status = 'ativo' where id::text like '93000000-%';
insert into public.organizations (id, nome, assentos) values
  ('9d000000-0000-0000-0000-000000000001', 'Empresa A', 5),
  ('9d000000-0000-0000-0000-000000000002', 'Empresa B', 5);
insert into public.memberships (org_id, user_id, role) values
  ('9d000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000003', 'adm_cliente'),
  ('9d000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000004', 'rw_cliente'),
  ('9d000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000005', 'ro_cliente'),
  ('9d000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000006', 'adm_cliente');
-- Ana tem o Self pessoal; Beto não tem direito; a empresa A tem o Self.
insert into public.direitos (user_id, org_id, produto) values
  ('93000000-0000-0000-0000-000000000001', null, 'self_assessment'),
  (null, '9d000000-0000-0000-0000-000000000001', 'self_assessment'),
  (null, '9d000000-0000-0000-0000-000000000002', 'self_assessment');
insert into public.assessments (id, user_id, org_id, setor) values
  ('9b000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', null, 'food_service'),
  ('9b000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000002', null, 'food_service'),
  ('9b000000-0000-0000-0000-000000000003', '93000000-0000-0000-0000-000000000003', '9d000000-0000-0000-0000-000000000001', 'food_service');

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
grant select on public.self_escuta, public.self_escuta_consentimentos, public.self_escuta_blocos,
  public.self_escuta_confirmar, public.self_respostas_origem, public.audit_log, public.assessments to service_role;

-- ===== O navegador não chama as funções do servidor nem escreve nas tabelas
set local role authenticated;
select pg_temp.como('93000000-0000-0000-0000-000000000001');
do $$
declare a constant text := '9b000000-0000-0000-0000-000000000001';
begin
  perform pg_temp.falha_com(format($q$select public.self_escuta_consentir(%L, auth.uid(), false, 'v1', 1)$q$, a),
    '%permission denied%', 'navegador consentiu');
  perform pg_temp.falha_com(format($q$select public.self_escuta_definir(%L, auth.uid(), false, 'fluido')$q$, a),
    '%permission denied%', 'navegador ligou a escuta');
  perform pg_temp.falha_com(format($q$select public.self_escuta_reservar_minutos(%L, auth.uid(), false, 10)$q$, a),
    '%permission denied%', 'navegador reservou minutos');
  perform pg_temp.falha_com(format($q$insert into public.self_escuta_blocos (assessment_id, user_id, seq, canal, texto) values (%L, auth.uid(), 1, 'sala', 'x')$q$, a),
    '%permission denied%', 'navegador gravou bloco');
  perform pg_temp.falha_com(format($q$insert into public.self_respostas_origem (assessment_id, pergunta_id, origem, valor) values (%L, 'p1', 'escuta', '1')$q$, a),
    '%permission denied%', 'navegador forjou origem');
end $$;

-- ===== Quem pode: editar o rascunho e ter direito ao Self
reset role;
set local role service_role;
do $$
declare
  ana constant uuid := '93000000-0000-0000-0000-000000000001';
  beto constant uuid := '93000000-0000-0000-0000-000000000002';
  a1 constant uuid := '9b000000-0000-0000-0000-000000000001';
  a2 constant uuid := '9b000000-0000-0000-0000-000000000002';
  a3 constant uuid := '9b000000-0000-0000-0000-000000000003';
begin
  perform pg_temp.falha_com(format('select public.self_escuta_consentir(%L, %L, false, %L, 2)', a1, beto, 'v1'),
    '%sem acesso%', 'outra pessoa usou a escuta do assessment pessoal da Ana');
  perform pg_temp.falha_com(format('select public.self_escuta_consentir(%L, %L, false, %L, 1)', a2, beto, 'v1'),
    '%sem acesso%', 'Beto usou a escuta sem direito ao Self');
  perform pg_temp.falha_com(format('select public.self_escuta_consentir(%L, %L, false, %L, 1)', a3, '93000000-0000-0000-0000-000000000005', 'v1'),
    '%sem acesso%', 'leitura (ro_cliente) usou a escuta');
  perform pg_temp.falha_com(format('select public.self_escuta_consentir(%L, %L, false, %L, 1)', a3, '93000000-0000-0000-0000-000000000006', 'v1'),
    '%sem acesso%', 'ADM de outra empresa usou a escuta');
  perform pg_temp.falha_com(format('select public.self_escuta_consentir(%L, %L, false, %L, 1)', a1, ana, 'V1 com espaço'),
    '%texto_versao%', 'versão do texto inválida aceita');
  perform pg_temp.falha_com(format('select public.self_escuta_consentir(%L, %L, false, %L, 0)', a1, ana, 'v1'),
    '%pessoas%', 'consentimento sem ninguém presente');

  -- Começa desligada; ligar sem consentimento é recusado.
  if public.self_escuta_estado(a1, ana, false) ->> 'modo' <> 'desligada' then
    raise exception 'FALHA: escuta nova não começa desligada';
  end if;
  perform pg_temp.falha_com(format('select public.self_escuta_definir(%L, %L, false, %L)', a1, ana, 'fluido'),
    '%sem consentimento%', 'ligou sem consentimento');
  perform pg_temp.falha_com(format('select public.self_escuta_reservar_minutos(%L, %L, false, 5)', a1, ana),
    '%desligada%', 'reservou minutos com a escuta desligada');

  perform public.self_escuta_consentir(a1, ana, false, 'self-escuta@1', 3);
  perform pg_temp.falha_com(format('select public.self_escuta_definir(%L, %L, false, %L)', a1, ana, 'gravar_tudo'),
    '%modo de escuta inválido%', 'modo inválido');
  perform public.self_escuta_definir(a1, ana, false, 'pergunta');
  if (select count(*) from public.audit_log where tabela = 'self_escuta' and alvo = a1::text) <> 2 then
    raise exception 'FALHA: consentimento e troca de modo não foram auditados';
  end if;

  -- Pergunta a pergunta: ditado na conversa, nada de blocos.
  perform pg_temp.falha_com(format($q$select public.self_escuta_gravar_blocos(%L, %L, false, '[{"seq":1,"canal":"sala","texto":"oi"}]')$q$, a1, ana),
    '%contínua desligada%', 'gravou bloco no modo pergunta a pergunta');

  -- Cota de minutos.
  if public.self_escuta_reservar_minutos(a1, ana, false, 30) <> 210 then raise exception 'FALHA: minutos restantes'; end if;
  perform pg_temp.falha_com(format('select public.self_escuta_reservar_minutos(%L, %L, false, 31)', a1, ana),
    '%reserva de minutos inválida%', 'reserva acima de 30 minutos');
  for i in 1..7 loop perform public.self_escuta_reservar_minutos(a1, ana, false, 30); end loop;
  perform pg_temp.falha_com(format('select public.self_escuta_reservar_minutos(%L, %L, false, 1)', a1, ana),
    '%limite de minutos%', 'passou do teto de minutos');
end $$;

-- ===== Blocos (modo contínuo), pendentes e processados
do $$
declare
  ana constant uuid := '93000000-0000-0000-0000-000000000001';
  a1 constant uuid := '9b000000-0000-0000-0000-000000000001';
  r jsonb;
begin
  perform public.self_escuta_definir(a1, ana, false, 'fluido');
  r := public.self_escuta_gravar_blocos(a1, ana, false,
    '[{"seq":1,"canal":"sala","texto":"temos sete restaurantes","inicio_ms":0,"fim_ms":2000},{"seq":2,"canal":"remoto","texto":"e um buffet"}]');
  if r <> '{"gravados":2,"repetidos":0}'::jsonb then raise exception 'FALHA: gravar blocos: %', r; end if;
  r := public.self_escuta_gravar_blocos(a1, ana, false, '[{"seq":2,"canal":"remoto","texto":"repetido"},{"seq":3,"canal":"sala","texto":"ok"}]');
  if r <> '{"gravados":1,"repetidos":1}'::jsonb then raise exception 'FALHA: bloco repetido: %', r; end if;
  if (select texto from public.self_escuta_blocos where assessment_id = a1 and seq = 2) <> 'e um buffet' then
    raise exception 'FALHA: bloco repetido sobrescreveu o original';
  end if;
  perform pg_temp.falha_com(format($q$select public.self_escuta_gravar_blocos(%L, %L, false, '[{"seq":4,"canal":"sala","texto":"x","falante":"Ana"}]')$q$, a1, ana),
    '%formato inválido%', 'bloco com chave extra');
  perform pg_temp.falha_com(format($q$select public.self_escuta_gravar_blocos(%L, %L, false, '[{"seq":4,"canal":"telefone","texto":"x"}]')$q$, a1, ana),
    '%canal%', 'canal inválido');
  perform pg_temp.falha_com(format($q$select public.self_escuta_gravar_blocos(%L, %L, false, %L)$q$, a1, ana,
    (select jsonb_agg(jsonb_build_object('seq', 100 + g, 'canal', 'sala', 'texto', 'x')) from generate_series(1, 21) g)),
    '%de 1 a 20 blocos%', 'mais de 20 blocos numa chamada');

  r := public.self_escuta_pendentes(a1, ana, false);
  if jsonb_array_length(r) <> 3 or (r -> 0 ->> 'seq')::int <> 1 then raise exception 'FALHA: pendentes: %', r; end if;
  if public.self_escuta_marcar_processados(a1, ana, false, array[1, 2]) <> 2 then raise exception 'FALHA: marcar'; end if;
  if public.self_escuta_marcar_processados(a1, ana, false, array[1, 2]) <> 0 then raise exception 'FALHA: marcou de novo'; end if;
  if jsonb_array_length(public.self_escuta_pendentes(a1, ana, false)) <> 1 then raise exception 'FALHA: pendentes depois de marcar'; end if;
end $$;

-- Teto de blocos (o banco recusa acima de 3000).
reset role;
do $$
begin
  insert into public.self_escuta_blocos (assessment_id, user_id, seq, canal, texto)
  select '9b000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', 1000 + g, 'sala', 'x'
  from generate_series(1, 2997) g;
end $$;
set local role service_role;
do $$ begin
  perform pg_temp.falha_com($q$select public.self_escuta_gravar_blocos('9b000000-0000-0000-0000-000000000001',
    '93000000-0000-0000-0000-000000000001', false, '[{"seq":9000,"canal":"sala","texto":"x"}]')$q$,
    '%limite de blocos%', 'passou do teto de blocos');
end $$;

-- ===== Registros imutáveis
reset role;
do $$ begin
  perform pg_temp.falha_com($q$update public.self_escuta_blocos set texto = 'forjado'
    where assessment_id = '9b000000-0000-0000-0000-000000000001' and seq = 1$q$,
    '%não pode ser alterado%', 'texto do bloco alterado');
  perform pg_temp.falha_com($q$update public.self_escuta_blocos set processado_em = null
    where assessment_id = '9b000000-0000-0000-0000-000000000001' and seq = 1$q$,
    '%não pode ser alterado%', 'bloco voltou a pendente');
  perform pg_temp.falha_com($q$update public.self_escuta_consentimentos set pessoas = 1
    where assessment_id = '9b000000-0000-0000-0000-000000000001'$q$,
    '%somente inserção%', 'consentimento alterado');
end $$;
-- Apagar os blocos do teto para seguir.
delete from public.self_escuta_blocos where seq > 999;

-- ===== Validade do consentimento: 8 horas
update public.self_escuta set consentida_em = now() - interval '9 hours'
where assessment_id = '9b000000-0000-0000-0000-000000000001';
set local role service_role;
do $$
declare
  ana constant uuid := '93000000-0000-0000-0000-000000000001';
  a1 constant uuid := '9b000000-0000-0000-0000-000000000001';
begin
  if public.self_escuta_estado(a1, ana, false) ->> 'modo' <> 'desligada' then
    raise exception 'FALHA: escuta seguiu ativa com consentimento vencido';
  end if;
  perform pg_temp.falha_com(format($q$select public.self_escuta_gravar_blocos(%L, %L, false, '[{"seq":50,"canal":"sala","texto":"x"}]')$q$, a1, ana),
    '%sem consentimento vigente%', 'gravou bloco com consentimento vencido');
  perform pg_temp.falha_com(format('select public.self_escuta_definir(%L, %L, false, %L)', a1, ana, 'ambos'),
    '%sem consentimento%', 'religou com consentimento vencido');
  -- Desligar sempre pode.
  perform public.self_escuta_definir(a1, ana, false, 'desligada');
  -- Novo consentimento religa.
  perform public.self_escuta_consentir(a1, ana, false, 'self-escuta@1', 2);
  perform public.self_escuta_definir(a1, ana, false, 'ambos');
  if public.self_escuta_estado(a1, ana, false) ->> 'modo' <> 'ambos' then raise exception 'FALHA: religar'; end if;
end $$;

-- ===== A confirmar, origem e conclusão
do $$
declare
  ana constant uuid := '93000000-0000-0000-0000-000000000001';
  beto constant uuid := '93000000-0000-0000-0000-000000000002';
  a1 constant uuid := '9b000000-0000-0000-0000-000000000001';
  item uuid;
  r jsonb;
begin
  perform public.self_escuta_propor(a1, ana, false,
    '[{"pergunta_id":"p.unidades","valor":7,"motivo":"áudio baixo","trecho":"sete restaurantes"}]');
  -- A mais nova substitui a pendente da mesma pergunta.
  perform public.self_escuta_propor(a1, ana, false,
    '[{"pergunta_id":"p.unidades","valor":8,"motivo":"corrigiu depois","trecho":"oito"}]');
  if (select count(*) from public.self_escuta_confirmar where assessment_id = a1 and status = 'pendente') <> 1 then
    raise exception 'FALHA: proposta nova não substituiu a pendente';
  end if;
  perform pg_temp.falha_com(format($q$select public.self_escuta_propor(%L, %L, false, '[{"pergunta_id":"p.x","valor":1,"motivo":"m","confianca":"alta"}]')$q$, a1, ana),
    '%formato inválido%', 'proposta com chave extra');
  perform pg_temp.falha_com(format($q$select public.self_escuta_propor(%L, %L, false, '[{"pergunta_id":"p.x","valor":1,"motivo":""}]')$q$, a1, ana),
    '%motivo%', 'proposta sem motivo');

  r := public.self_escuta_estado(a1, ana, false);
  if jsonb_array_length(r -> 'a_confirmar') <> 1 or (r -> 'a_confirmar' -> 0 -> 'valor')::int <> 8 then
    raise exception 'FALHA: estado a confirmar: %', r;
  end if;
  item := (r -> 'a_confirmar' -> 0 ->> 'id')::uuid;

  -- Não conclui com item pendente (mesmo direto no banco).
  reset role;
  perform pg_temp.falha_com(format('update public.assessments set status = %L, concluido_em = now() where id = %L', 'concluido', a1),
    '%a confirmar%', 'concluiu com resposta a confirmar');
  set local role service_role;

  perform pg_temp.falha_com(format('select public.self_escuta_resolver(%L, %L, %L, false)', item, 'confirmar', beto),
    '%não encontrado%', 'outra pessoa resolveu o item');
  perform pg_temp.falha_com(format('select public.self_escuta_resolver(%L, %L, %L, false)', item, 'aceitar', ana),
    '%decisão inválida%', 'decisão inválida');
  r := public.self_escuta_resolver(item, 'confirmar', ana, false);
  if r ->> 'pergunta_id' <> 'p.unidades' or (r -> 'valor')::int <> 8 then raise exception 'FALHA: resolver devolveu %', r; end if;
  perform pg_temp.falha_com(format('select public.self_escuta_resolver(%L, %L, %L, false)', item, 'descartar', ana),
    '%já resolvido%', 'resolveu duas vezes');

  -- Origem registrada pelo servidor.
  perform public.self_escuta_registrar_origem(a1, ana, false, '[{"pergunta_id":"p.unidades","valor":8}]', 'escuta_confirmada');
  perform public.self_escuta_registrar_origem(a1, ana, false, '[{"pergunta_id":"p.buffet","valor":true}]', 'escuta');
  perform public.self_escuta_registrar_origem(a1, ana, false, '[{"pergunta_id":"p.buffet","valor":false}]', 'escuta');
  if (select valor from public.self_respostas_origem where assessment_id = a1 and pergunta_id = 'p.buffet') <> 'false'::jsonb then
    raise exception 'FALHA: origem não atualizou o valor';
  end if;
  perform pg_temp.falha_com(format($q$select public.self_escuta_registrar_origem(%L, %L, false, '[{"pergunta_id":"p.x","valor":1}]', 'modelo')$q$, a1, ana),
    '%origem inválida%', 'origem inventada');
  perform pg_temp.falha_com(format($q$select public.self_escuta_registrar_origem(%L, %L, false, '[{"pergunta_id":"p.x","valor":1,"origem":"digitacao"}]', 'escuta')$q$, a1, ana),
    '%formato inválido%', 'item de origem com chave extra');
  perform pg_temp.falha_com(format($q$select public.self_escuta_registrar_origem(%L, %L, false, '[{"pergunta_id":"p.x","valor":1}]', 'escuta')$q$, a1, beto),
    '%sem acesso%', 'outra pessoa registrou origem');
end $$;

-- Sem pendente, conclui.
reset role;
update public.assessments set status = 'concluido', concluido_em = now() where id = '9b000000-0000-0000-0000-000000000001';
set local role service_role;
do $$ begin
  perform pg_temp.falha_com($q$select public.self_escuta_pendentes('9b000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', false)$q$,
    '%sem acesso%', 'escuta seguiu depois de concluído');
end $$;

-- ===== Empresa: cada pessoa tem a própria escuta; a origem é de quem lê o assessment
do $$
declare
  adm constant uuid := '93000000-0000-0000-0000-000000000003';
  rw constant uuid := '93000000-0000-0000-0000-000000000004';
  a3 constant uuid := '9b000000-0000-0000-0000-000000000003';
begin
  perform public.self_escuta_consentir(a3, adm, false, 'self-escuta@1', 4);
  perform public.self_escuta_definir(a3, adm, false, 'fluido');
  perform public.self_escuta_gravar_blocos(a3, adm, false, '[{"seq":1,"canal":"sala","texto":"reunião da empresa"}]');
  perform public.self_escuta_registrar_origem(a3, adm, false, '[{"pergunta_id":"p.unidades","valor":3}]', 'escuta');
  -- O colega editor não herda a escuta do ADM.
  if public.self_escuta_estado(a3, rw, false) ->> 'modo' <> 'desligada' then
    raise exception 'FALHA: escuta do ADM valeu para o colega';
  end if;
  if jsonb_array_length(public.self_escuta_pendentes(a3, rw, false)) <> 0 then
    raise exception 'FALHA: colega viu os blocos do ADM';
  end if;
end $$;

reset role;
set local role authenticated;
select pg_temp.como('93000000-0000-0000-0000-000000000005');
do $$ begin
  if (select count(*) from public.self_respostas_origem where assessment_id = '9b000000-0000-0000-0000-000000000003') <> 1 then
    raise exception 'FALHA: quem lê o assessment não vê a origem';
  end if;
  if exists (select 1 from public.self_escuta_blocos) or exists (select 1 from public.self_escuta_consentimentos) then
    raise exception 'FALHA: colega leu a transcrição de outra pessoa';
  end if;
end $$;
select pg_temp.como('93000000-0000-0000-0000-000000000006');
do $$ begin
  if exists (select 1 from public.self_respostas_origem) then
    raise exception 'FALHA: outra empresa leu a origem';
  end if;
end $$;
select pg_temp.como('93000000-0000-0000-0000-000000000003');
do $$ begin
  if (select count(*) from public.self_escuta_blocos) <> 1 then
    raise exception 'FALHA: o ADM não lê a própria transcrição';
  end if;
end $$;

-- ===== Direito revogado: escuta para na hora
reset role;
update public.direitos set revogado_em = now() where org_id = '9d000000-0000-0000-0000-000000000001';
set local role service_role;
do $$ begin
  perform pg_temp.falha_com($q$select public.self_escuta_gravar_blocos('9b000000-0000-0000-0000-000000000003',
    '93000000-0000-0000-0000-000000000003', false, '[{"seq":2,"canal":"sala","texto":"x"}]')$q$,
    '%sem acesso%', 'escuta seguiu com direito revogado');
end $$;

-- ===== Retenção: blocos saem em 90 dias; o item a confirmar fica sem o trecho
reset role;
alter table public.self_escuta_blocos disable trigger self_escuta_blocos_sem_mudanca;
update public.self_escuta_blocos set criado_em = now() - interval '91 days';
alter table public.self_escuta_blocos enable trigger self_escuta_blocos_sem_mudanca;
alter table public.self_escuta_confirmar disable trigger self_escuta_confirmar_sem_mudanca;
update public.self_escuta_confirmar set criado_em = now() - interval '91 days';
alter table public.self_escuta_confirmar enable trigger self_escuta_confirmar_sem_mudanca;
set local role service_role;
do $$ begin
  if public.self_escuta_apagar_expiradas() < 1 then raise exception 'FALHA: retenção não apagou blocos'; end if;
  if exists (select 1 from public.self_escuta_blocos) then raise exception 'FALHA: sobrou bloco vencido'; end if;
  if exists (select 1 from public.self_escuta_confirmar where trecho is not null) then
    raise exception 'FALHA: trecho ficou depois da retenção';
  end if;
  if not exists (select 1 from public.self_escuta_confirmar) then
    raise exception 'FALHA: retenção apagou a prova do item a confirmar';
  end if;
end $$;

-- ===== Exclusão de conta e de assessment
reset role;
do $$ begin
  delete from auth.users where id = '93000000-0000-0000-0000-000000000001';
  if exists (select 1 from public.self_escuta_consentimentos where user_id = '93000000-0000-0000-0000-000000000001') then
    raise exception 'FALHA: consentimento ficou ligado à conta excluída';
  end if;
  delete from public.assessments where id = '9b000000-0000-0000-0000-000000000003';
  if exists (select 1 from public.self_escuta_consentimentos where assessment_id = '9b000000-0000-0000-0000-000000000003')
     or exists (select 1 from public.self_respostas_origem where assessment_id = '9b000000-0000-0000-0000-000000000003') then
    raise exception 'FALHA: escuta ficou depois de apagar o assessment';
  end if;
end $$;

rollback;
\echo 'OK: self_escuta_test.sql passou'
