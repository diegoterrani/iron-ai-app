-- Testes da escuta no Deep: consentimento obrigatório, modos, blocos
-- transcritos (sem duplicar), respostas a confirmar, origem decidida pelo
-- servidor, teto de turnos, registros imutáveis, RLS e retenção.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('92000000-0000-0000-0000-000000000001', 'admin@iron.io', '{"nome":"Admin"}', now()),
  ('92000000-0000-0000-0000-000000000002', 'eva@iron.io',   '{"nome":"Eva"}', now()),
  ('92000000-0000-0000-0000-000000000003', 'ivo@iron.io',   '{"nome":"Ivo"}', now()),
  ('92000000-0000-0000-0000-000000000004', 'adm@a.com',     '{"nome":"ADM A"}', now()),
  ('92000000-0000-0000-0000-000000000006', 'adm@b.com',     '{"nome":"ADM B"}', now());
update public.profiles set status = 'ativo' where id::text like '92000000-%';
insert into public.user_roles (user_id, role) values
  ('92000000-0000-0000-0000-000000000001', 'super_admin'),
  ('92000000-0000-0000-0000-000000000002', 'equipe_iron'),
  ('92000000-0000-0000-0000-000000000003', 'equipe_iron');
insert into public.organizations (id, nome, assentos) values
  ('9c000000-0000-0000-0000-000000000001', 'Empresa A', 5),
  ('9c000000-0000-0000-0000-000000000002', 'Empresa B', 5);
-- Eva atende a empresa A; Ivo não atende nenhuma.
insert into public.staff_assignments (user_id, org_id) values
  ('92000000-0000-0000-0000-000000000002', '9c000000-0000-0000-0000-000000000001');
insert into public.memberships (org_id, user_id, role) values
  ('9c000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000004', 'adm_cliente'),
  ('9c000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000006', 'adm_cliente');

create function pg_temp.como(p_user text, p_aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user, true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'aal', p_aal)::text, true);
$$;
-- Falha esperada, qualquer motivo.
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
-- Falha esperada com o motivo certo (evita passar por erro de digitação).
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
create temp table ctx (chave text primary key, valor text);
grant all on ctx to authenticated, service_role;
-- No Supabase a service_role lê todas as tabelas; o stub não dá esse grant.
grant select on public.deep_assessments, public.deep_sessoes, public.deep_mensagens, public.deep_respostas,
  public.deep_escuta_consentimentos, public.deep_escuta_blocos, public.deep_escuta_confirmar, public.audit_log to service_role;

-- ===== Preparo: um Deep e três reuniões (A: fluxo completo; B: teto e limite; C: sem escuta)
set local role service_role;
do $$
declare
  eva constant text := '92000000-0000-0000-0000-000000000002';
  d uuid;
begin
  d := public.deep_abrir('9c000000-0000-0000-0000-000000000001', 'food_service', 'food_service@0.3', '{}', null, eva::uuid, true);
  insert into ctx values ('deep', d::text),
    ('s1', public.deep_abrir_sessao(d, 'A', 'Cozinha', '[{"nome":"Rita"}]', eva::uuid, true)::text),
    ('s2', public.deep_abrir_sessao(d, 'B', 'Salão', '[{"nome":"Caio"}]', eva::uuid, true)::text),
    ('s3', public.deep_abrir_sessao(d, 'C', 'Pessoas', '[{"nome":"Lia"}]', eva::uuid, true)::text);
  if (select count(*) from public.deep_sessoes where deep_id = d and escuta_modo = 'desligada'
        and escuta_consentida_em is null and pergunta_marcada is null) <> 3 then
    raise exception 'FALHA: reunião nova não começa com a escuta desligada';
  end if;
end $$;

-- ===== O navegador não chama as funções do servidor nem escreve nas tabelas
reset role;
set local role authenticated;
select pg_temp.como('92000000-0000-0000-0000-000000000002', 'aal2');
do $$
declare s text := (select valor from ctx where chave = 's1');
begin
  perform pg_temp.falha(format($q$select public.deep_escuta_consentir(%L, auth.uid(), true, 'v1', '[{"nome":"Rita"}]')$q$, s), 'navegador consentiu');
  perform pg_temp.falha(format($q$select public.deep_escuta_definir(%L, auth.uid(), true, 'fluido', null)$q$, s), 'navegador ligou a escuta');
  perform pg_temp.falha(format($q$select public.deep_escuta_gravar_blocos(%L, auth.uid(), true, '[{"seq":1,"canal":"sala","texto":"x"}]')$q$, s), 'navegador gravou bloco');
  perform pg_temp.falha(format($q$select public.deep_escuta_pendentes(%L, auth.uid(), true)$q$, s), 'navegador leu pendentes');
  perform pg_temp.falha(format($q$select public.deep_escuta_marcar_processados(%L, auth.uid(), true, array[1], 1)$q$, s), 'navegador marcou processados');
  perform pg_temp.falha(format($q$select public.deep_escuta_propor(%L, auth.uid(), true, '[]')$q$, s), 'navegador propôs resposta');
  perform pg_temp.falha(format($q$select public.deep_registrar_respostas_origem(%L, auth.uid(), true, '[]', 'escuta')$q$, s), 'navegador gravou com origem');
  perform pg_temp.falha($q$select public.deep_escuta_resolver(gen_random_uuid(), 'confirmar', auth.uid(), true)$q$, 'navegador resolveu item');
  perform pg_temp.falha(format($q$insert into public.deep_escuta_blocos (deep_id, sessao_id, seq, canal, texto)
    values ((select deep_id from public.deep_sessoes where id = %L), %L, 1, 'sala', 'x')$q$, s, s), 'insert direto em bloco');
  perform pg_temp.falha(format($q$insert into public.deep_escuta_consentimentos (deep_id, sessao_id, texto_versao, participantes)
    values ((select deep_id from public.deep_sessoes where id = %L), %L, 'v1', '[]')$q$, s, s), 'insert direto em consentimento');
  perform pg_temp.falha(format($q$update public.deep_sessoes set escuta_modo = 'fluido' where id = %L$q$, s), 'update direto ligou a escuta');
end $$;

-- ===== Consentimento: sem ele, a escuta não liga nem grava
reset role;
set local role service_role;
do $$
declare
  s uuid := (select valor::uuid from ctx where chave = 's1');
  d uuid := (select valor::uuid from ctx where chave = 'deep');
  eva constant text := '92000000-0000-0000-0000-000000000002';
  ivo constant text := '92000000-0000-0000-0000-000000000003';
  adm constant text := '92000000-0000-0000-0000-000000000004';
  c uuid;
begin
  perform pg_temp.falha_com(format($q$select public.deep_escuta_definir(%L, %L, true, 'fluido', null)$q$, s, eva),
    '%consentimento%', 'ligou a escuta sem consentimento');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_gravar_blocos(%L, %L, true,
    '[{"seq":1,"canal":"sala","texto":"oi"}]')$q$, s, eva), '%desligada%', 'gravou bloco com a escuta desligada');

  -- Quem pode consentir: só quem conduz, com MFA, na empresa certa.
  perform pg_temp.falha_com(format($q$select public.deep_escuta_consentir(%L, %L, false, 'v1', '[{"nome":"Rita"}]')$q$, s, eva),
    '%acesso negado%', 'consentiu sem MFA');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_consentir(%L, %L, true, 'v1', '[{"nome":"Rita"}]')$q$, s, ivo),
    '%acesso negado%', 'staff não alocado consentiu');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_consentir(%L, %L, true, 'v1', '[{"nome":"Rita"}]')$q$, s, adm),
    '%acesso negado%', 'ADM-Cliente consentiu');
  -- Dados do consentimento.
  perform pg_temp.falha_com(format($q$select public.deep_escuta_consentir(%L, %L, true, 'versão 1', '[{"nome":"Rita"}]')$q$, s, eva),
    '%versão do texto%', 'aceitou versão de texto inválida');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_consentir(%L, %L, true, 'v1', '[]')$q$, s, eva),
    '%participantes%', 'aceitou consentimento sem participantes');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_consentir(%L, %L, true, 'v1', '[{"nome":"Rita","cpf":"123"}]')$q$, s, eva),
    '%participantes%', 'aceitou CPF de participante');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_consentir(%L, %L, true, 'v1', %L)$q$, s, eva,
    (select jsonb_agg(jsonb_build_object('nome', 'P' || g))::text from generate_series(1, 31) g)),
    '%participantes%', 'aceitou mais de 30 participantes');

  c := public.deep_escuta_consentir(s, eva::uuid, true, 'escuta@1',
    '[{"nome":"Rita","cargo":"Chef executiva"},{"nome":"Caio"}]');
  if c is null
     or (select count(*) from public.deep_escuta_consentimentos where sessao_id = s) <> 1
     or (select jsonb_array_length(participantes) from public.deep_sessoes where id = s) <> 2
     or (select escuta_consentida_em from public.deep_sessoes where id = s) is null
     or (select escuta_modo from public.deep_sessoes where id = s) <> 'desligada' then
    raise exception 'FALHA: consentimento não registrou a lista e deixou a escuta ligada sozinha';
  end if;
  if (select count(*) from public.audit_log where acao = 'deep.escuta_consentir' and ator = eva::uuid
        and alvo = c::text and dados::text not like '%Rita%') <> 1 then
    raise exception 'FALHA: auditoria do consentimento (ou copiou nomes)';
  end if;

  -- A reunião C nunca teve consentimento: continua sem poder ligar.
  perform pg_temp.falha_com(format($q$select public.deep_escuta_definir(%L, %L, true, 'ambos', null)$q$,
    (select valor from ctx where chave = 's3'), eva), '%consentimento%', 'ligou a escuta na reunião sem consentimento');
  insert into ctx values ('consentimento', c::text);
end $$;

-- ===== Modos e pergunta marcada
do $$
declare
  s uuid := (select valor::uuid from ctx where chave = 's1');
  eva constant text := '92000000-0000-0000-0000-000000000002';
  r jsonb;
begin
  perform pg_temp.falha_com(format($q$select public.deep_escuta_definir(%L, %L, true, 'tudo', null)$q$, s, eva),
    '%modo de escuta inválido%', 'aceitou modo inexistente');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_definir(%L, %L, true, 'fluido', 'a.perdas')$q$, s, eva),
    '%pergunta marcada%', 'marcou pergunta no modo fluido');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_definir(%L, %L, true, 'desligada', 'a.perdas')$q$, s, eva),
    '%pergunta marcada%', 'marcou pergunta com a escuta desligada');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_definir(%L, %L, true, 'pergunta', 'A Perdas!')$q$, s, eva),
    '%pergunta marcada%', 'aceitou id de pergunta inválido');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_definir(%L, %L, false, 'fluido', null)$q$, s, eva),
    '%acesso negado%', 'trocou o modo sem MFA');

  r := public.deep_escuta_definir(s, eva::uuid, true, 'fluido', null);
  if r ->> 'modo' <> 'fluido' or (r -> 'pergunta_marcada') <> 'null'::jsonb then
    raise exception 'FALHA: modo fluido %', r;
  end if;
  r := public.deep_escuta_definir(s, eva::uuid, true, 'pergunta', 'a.cozinhas');
  if r ->> 'pergunta_marcada' <> 'a.cozinhas' then raise exception 'FALHA: não marcou a pergunta %', r; end if;
  -- Trocar só a pergunta não gera auditoria nova; trocar o modo gera.
  r := public.deep_escuta_definir(s, eva::uuid, true, 'pergunta', 'a.perdas');
  if (select count(*) from public.audit_log where acao = 'deep.escuta_modo' and alvo = s::text) <> 2 then
    raise exception 'FALHA: auditoria da troca de modo';
  end if;
  -- Voltar ao modo fluido limpa a pergunta marcada.
  r := public.deep_escuta_definir(s, eva::uuid, true, 'ambos', 'a.itens');
  r := public.deep_escuta_definir(s, eva::uuid, true, 'fluido', null);
  if (select pergunta_marcada from public.deep_sessoes where id = s) is not null then
    raise exception 'FALHA: o modo fluido manteve a pergunta marcada';
  end if;
  -- Desligar e ligar de novo não exige novo consentimento da mesma reunião.
  r := public.deep_escuta_definir(s, eva::uuid, true, 'desligada', null);
  r := public.deep_escuta_definir(s, eva::uuid, true, 'pergunta', 'a.perdas');
end $$;

-- ===== Blocos transcritos: validação, pergunta marcada vinda da reunião e reenvio sem duplicar
do $$
declare
  s uuid := (select valor::uuid from ctx where chave = 's1');
  eva constant text := '92000000-0000-0000-0000-000000000002';
  ivo constant text := '92000000-0000-0000-0000-000000000003';
  r jsonb;
begin
  perform pg_temp.falha_com(format($q$select public.deep_escuta_gravar_blocos(%L, %L, true, '[]')$q$, s, eva),
    '%lote de blocos%', 'aceitou lote vazio');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_gravar_blocos(%L, %L, true, %L)$q$, s, eva,
    (select jsonb_agg(jsonb_build_object('seq', 100 + g, 'canal', 'sala', 'texto', 'x'))::text from generate_series(1, 21) g)),
    '%lote de blocos%', 'aceitou mais de 20 blocos');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_gravar_blocos(%L, %L, true,
    '[{"seq":9,"canal":"palco","texto":"x"}]')$q$, s, eva), '%violates check constraint%', 'aceitou canal inexistente');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_gravar_blocos(%L, %L, true,
    '[{"seq":9,"canal":"sala","texto":"x","pergunta_marcada":"a.perdas"}]')$q$, s, eva),
    '%bloco inválido%', 'o navegador conseguiu mandar a pergunta marcada');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_gravar_blocos(%L, %L, true,
    '[{"seq":"9","canal":"sala","texto":"x"}]')$q$, s, eva), '%bloco inválido%', 'aceitou seq como texto');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_gravar_blocos(%L, %L, true,
    '[{"seq":9,"canal":"sala","texto":"   "}]')$q$, s, eva), '%violates check constraint%', 'aceitou bloco em branco');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_gravar_blocos(%L, %L, true,
    '[{"seq":0,"canal":"sala","texto":"x"}]')$q$, s, eva), '%violates check constraint%', 'aceitou seq zero');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_gravar_blocos(%L, %L, true, %L)$q$, s, eva,
    jsonb_build_array(jsonb_build_object('seq', 9, 'canal', 'sala', 'texto', repeat('a', 4001)))::text),
    '%violates check constraint%', 'aceitou bloco acima de 4000 caracteres');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_gravar_blocos(%L, %L, true,
    '[{"seq":9,"canal":"sala","texto":"x","inicio_ms":500,"fim_ms":100}]')$q$, s, eva),
    '%violates check constraint%', 'aceitou fim antes do início');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_gravar_blocos(%L, %L, true,
    '[{"seq":9,"canal":"sala","texto":"x"}]')$q$, s, ivo), '%acesso negado%', 'staff não alocado gravou bloco');

  -- Modo "pergunta" (a.perdas marcada): a pergunta vem da reunião.
  r := public.deep_escuta_gravar_blocos(s, eva::uuid, true,
    '[{"seq":1,"canal":"sala","texto":"  Temos uma cozinha central  ","inicio_ms":0,"fim_ms":4000},
      {"seq":2,"canal":"sala","texto":"A perda é de uns 6%"},
      {"seq":3,"canal":"remoto","texto":"Fechou, e o jogo ontem?"}]');
  if (r ->> 'gravados')::int <> 3 or (r ->> 'repetidos')::int <> 0 then raise exception 'FALHA: gravou % ', r; end if;
  if (select count(*) from public.deep_escuta_blocos where sessao_id = s and seq <= 3 and pergunta_marcada = 'a.perdas') <> 3
     or (select texto from public.deep_escuta_blocos where sessao_id = s and seq = 1) <> 'Temos uma cozinha central' then
    raise exception 'FALHA: pergunta marcada ou texto do bloco';
  end if;

  -- Reenvio depois de uma queda: não duplica nem reescreve.
  r := public.deep_escuta_gravar_blocos(s, eva::uuid, true,
    '[{"seq":2,"canal":"sala","texto":"OUTRO TEXTO"},{"seq":3,"canal":"remoto","texto":"outro"},{"seq":4,"canal":"sala","texto":"Compras pelo Excel"}]');
  if (r ->> 'gravados')::int <> 1 or (r ->> 'repetidos')::int <> 2
     or (select texto from public.deep_escuta_blocos where sessao_id = s and seq = 2) <> 'A perda é de uns 6%' then
    raise exception 'FALHA: reenvio duplicou ou reescreveu bloco %', r;
  end if;

  -- Modo "ambos": a marcada vale; modo fluido: nenhuma.
  perform public.deep_escuta_definir(s, eva::uuid, true, 'ambos', 'a.itens');
  perform public.deep_escuta_gravar_blocos(s, eva::uuid, true, '[{"seq":5,"canal":"sala","texto":"Cento e vinte itens no cardápio"}]');
  perform public.deep_escuta_definir(s, eva::uuid, true, 'fluido', null);
  perform public.deep_escuta_gravar_blocos(s, eva::uuid, true, '[{"seq":6,"canal":"remoto","texto":"Sobre fornecedores, são quatro"}]');
  if (select pergunta_marcada from public.deep_escuta_blocos where sessao_id = s and seq = 5) is distinct from 'a.itens'
     or (select pergunta_marcada from public.deep_escuta_blocos where sessao_id = s and seq = 6) is not null then
    raise exception 'FALHA: pergunta marcada nos modos ambos e fluido';
  end if;
end $$;

-- ===== Pendentes e processados
do $$
declare
  s uuid := (select valor::uuid from ctx where chave = 's1');
  eva constant text := '92000000-0000-0000-0000-000000000002';
  ivo constant text := '92000000-0000-0000-0000-000000000003';
  p jsonb;
  o integer;
  n integer;
begin
  perform pg_temp.falha_com(format($q$select public.deep_escuta_pendentes(%L, %L, true)$q$, s, ivo),
    '%acesso negado%', 'staff não alocado leu pendentes');
  p := public.deep_escuta_pendentes(s, eva::uuid, true);
  if jsonb_array_length(p) <> 6 or p -> 0 ->> 'seq' <> '1' or p -> 5 ->> 'seq' <> '6'
     or p -> 1 ->> 'pergunta_marcada' <> 'a.perdas' or p -> 4 ->> 'canal' <> 'sala' then
    raise exception 'FALHA: pendentes fora de ordem ou incompletos %', p;
  end if;

  -- O turno do agente grava as falas e só então os blocos são marcados.
  perform public.deep_reservar_turno(s, eva::uuid, true);
  o := public.deep_gravar_mensagens(s, eva::uuid, true,
    '[{"papel":"analista","conteudo":"[escuta] blocos 1 a 3"},{"papel":"agente","conteudo":"ok"}]', 10, 5, 0, 0);
  perform pg_temp.falha_com(format($q$select public.deep_escuta_marcar_processados(%L, %L, true, array[1,2,3], 99)$q$, s, eva),
    '%não existe%', 'marcou com fala inexistente');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_marcar_processados(%L, %L, true, array[]::integer[], %s)$q$, s, eva, o),
    '%inválidos%', 'marcou lista vazia');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_marcar_processados(%L, %L, false, array[1], %s)$q$, s, eva, o),
    '%acesso negado%', 'marcou sem MFA');
  n := public.deep_escuta_marcar_processados(s, eva::uuid, true, array[1, 2, 3], o);
  if n <> 3 or jsonb_array_length(public.deep_escuta_pendentes(s, eva::uuid, true)) <> 3
     or (select count(*) from public.deep_escuta_blocos where sessao_id = s and mensagem_ordem = o and processado_em is not null) <> 3 then
    raise exception 'FALHA: marcar processados (%)', n;
  end if;
  if public.deep_escuta_marcar_processados(s, eva::uuid, true, array[1], o) <> 0 then
    raise exception 'FALHA: marcou de novo um bloco já processado';
  end if;
end $$;

-- ===== Blocos e consentimento não se editam nem se apagam (nem pelo dono das tabelas)
reset role;
do $$
begin
  perform pg_temp.falha_com($q$update public.deep_escuta_blocos set texto = 'adulterado' where seq = 1$q$,
    '%só mudam ao serem processados%', 'editou texto do bloco');
  perform pg_temp.falha_com($q$update public.deep_escuta_blocos set processado_em = null, mensagem_ordem = null where seq = 1$q$,
    '%só mudam ao serem processados%', 'desfez o processamento');
  perform pg_temp.falha_com($q$update public.deep_escuta_blocos set mensagem_ordem = 1 where seq = 1$q$,
    '%só mudam ao serem processados%', 'trocou a fala de um bloco já processado');
  perform pg_temp.falha_com($q$delete from public.deep_escuta_blocos where seq = 1$q$,
    '%só mudam ao serem processados%', 'apagou bloco fora da retenção');
  perform pg_temp.falha_com($q$update public.deep_escuta_consentimentos set texto_versao = 'v9'$q$,
    '%somente inserção%', 'editou consentimento');
  perform pg_temp.falha_com($q$delete from public.deep_escuta_consentimentos$q$,
    '%somente inserção%', 'apagou consentimento');
  perform pg_temp.falha_com($q$update public.deep_sessoes set escuta_modo = 'fluido', escuta_consentida_em = null
    where id = (select valor::uuid from ctx where chave = 's3')$q$,
    '%deep_sessoes_escuta_coerente%', 'a reunião ficou com escuta ligada sem consentimento');
  perform pg_temp.falha_com($q$update public.deep_sessoes set pergunta_marcada = 'a.x' where escuta_modo = 'desligada'$q$,
    '%deep_sessoes_escuta_coerente%', 'pergunta marcada com escuta desligada');
end $$;
set local role service_role;

-- ===== Respostas a confirmar: propor, substituir, bloquear o encerramento, confirmar e descartar
do $$
declare
  d uuid := (select valor::uuid from ctx where chave = 'deep');
  s uuid := (select valor::uuid from ctx where chave = 's1');
  eva constant text := '92000000-0000-0000-0000-000000000002';
  ivo constant text := '92000000-0000-0000-0000-000000000003';
  adm constant text := '92000000-0000-0000-0000-000000000004';
  n integer;
  i_perdas uuid;
  i_coz uuid;
  e jsonb;
begin
  perform pg_temp.falha_com(format($q$select public.deep_escuta_propor(%L, %L, true, '[]')$q$, s, eva),
    '%lote a confirmar%', 'aceitou lote vazio a confirmar');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_propor(%L, %L, true, '[{"pergunta_id":"a.cozinhas","valor":3}]')$q$, s, eva),
    '%item a confirmar inválido%', 'aceitou item sem motivo');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_propor(%L, %L, true,
    '[{"pergunta_id":"a.cozinhas","valor":3,"motivo":"x","origem":"digitacao"}]')$q$, s, eva),
    '%item a confirmar inválido%', 'o modelo conseguiu mandar a origem');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_propor(%L, %L, true,
    '[{"pergunta_id":"a.cozinhas","valor":3,"motivo":"x"},{"pergunta_id":"a.cozinhas","valor":4,"motivo":"y"}]')$q$, s, eva),
    '%repetida%', 'aceitou pergunta repetida no lote');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_propor(%L, %L, true,
    '[{"pergunta_id":"a.cozinhas","motivo":"sem valor"}]')$q$, s, eva),
    '%violates check constraint%', 'aceitou item sem valor e sem "não se aplica"');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_propor(%L, %L, true,
    '[{"pergunta_id":"a.cozinhas","valor":3,"motivo":"   "}]')$q$, s, eva),
    '%violates check constraint%', 'aceitou motivo em branco');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_propor(%L, %L, true,
    '[{"pergunta_id":"a.cozinhas","valor":3,"motivo":"x"}]')$q$, s, ivo), '%acesso negado%', 'staff não alocado propôs');

  n := public.deep_escuta_propor(s, eva::uuid, true,
    '[{"pergunta_id":"a.cozinhas","valor":3,"motivo":"ruído no áudio","participante":"Rita","trecho":"acho que três cozinhas"},
      {"pergunta_id":"a.perdas","valor":6,"motivo":"número dito de passagem","trecho":"uns 6%","mensagem_ordem":2}]');
  if n <> 2 then raise exception 'FALHA: guardou % itens', n; end if;
  -- Nova proposta para a mesma pergunta substitui a pendente.
  n := public.deep_escuta_propor(s, eva::uuid, true,
    '[{"pergunta_id":"a.cozinhas","valor":1,"motivo":"corrigido na fala seguinte"}]');
  if (select count(*) from public.deep_escuta_confirmar where deep_id = d and status = 'pendente') <> 2
     or (select count(*) from public.deep_escuta_confirmar where deep_id = d and status = 'descartada' and fechada_por is null) <> 1
     or (select valor from public.deep_escuta_confirmar where deep_id = d and pergunta_id = 'a.cozinhas' and status = 'pendente') <> '1'::jsonb then
    raise exception 'FALHA: proposta nova não substituiu a pendente';
  end if;
  select id into i_perdas from public.deep_escuta_confirmar where deep_id = d and pergunta_id = 'a.perdas' and status = 'pendente';
  select id into i_coz from public.deep_escuta_confirmar where deep_id = d and pergunta_id = 'a.cozinhas' and status = 'pendente';
  insert into ctx values ('i_perdas', i_perdas::text), ('i_coz', i_coz::text);

  -- O agente vê o que está a confirmar e o modo de escuta.
  e := public.deep_estado(d, eva::uuid, true);
  if jsonb_array_length(e -> 'a_confirmar') <> 2
     or (select (x ->> 'escuta_modo') from jsonb_array_elements(e -> 'sessoes') x where x ->> 'id' = s::text) <> 'fluido' then
    raise exception 'FALHA: estado sem a_confirmar ou sem o modo de escuta %', e;
  end if;
  -- A reunião não encerra com itens a confirmar.
  perform pg_temp.falha_com(format($q$select public.deep_encerrar_sessao(%L, 'Resumo.', %L, true)$q$, s, eva),
    '%a confirmar%', 'encerrou a reunião com itens a confirmar');

  perform pg_temp.falha_com(format($q$select public.deep_escuta_resolver(%L, 'talvez', %L, true)$q$, i_perdas, eva),
    '%decisão inválida%', 'aceitou decisão inexistente');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_resolver(%L, 'confirmar', %L, true)$q$, i_perdas, ivo),
    '%acesso negado%', 'staff não alocado confirmou');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_resolver(%L, 'confirmar', %L, false)$q$, i_perdas, eva),
    '%acesso negado%', 'confirmou sem MFA');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_resolver(%L, 'confirmar', %L, true)$q$, i_perdas, adm),
    '%acesso negado%', 'ADM-Cliente confirmou');
  perform pg_temp.falha_com($q$select public.deep_escuta_resolver(gen_random_uuid(), 'confirmar', '92000000-0000-0000-0000-000000000002', true)$q$,
    '%acesso negado%', 'resolveu item inexistente');

  -- Confirmar grava a resposta com origem "escuta" e fecha o item.
  perform public.deep_escuta_resolver(i_perdas, 'confirmar', eva::uuid, true);
  if (select count(*) from public.deep_respostas where deep_id = d and pergunta_id = 'a.perdas' and status = 'vigente'
        and valor = '6'::jsonb and origem = 'escuta' and confianca = 'alta' and trecho = 'uns 6%'
        and mensagem_ordem = 2 and registrado_por = eva::uuid) <> 1
     or (select count(*) from public.deep_escuta_confirmar where id = i_perdas and status = 'confirmada'
           and fechada_por = eva::uuid and fechada_em is not null) <> 1 then
    raise exception 'FALHA: confirmar não gravou a resposta com origem escuta';
  end if;
  perform pg_temp.falha_com(format($q$select public.deep_escuta_resolver(%L, 'descartar', %L, true)$q$, i_perdas, eva),
    '%já foi resolvido%', 'resolveu o mesmo item duas vezes');

  -- Descartar não grava resposta.
  perform public.deep_escuta_resolver(i_coz, 'descartar', eva::uuid, true);
  if exists (select 1 from public.deep_respostas where deep_id = d and pergunta_id = 'a.cozinhas')
     or (select status from public.deep_escuta_confirmar where id = i_coz) <> 'descartada' then
    raise exception 'FALHA: descartar gravou resposta ou não fechou o item';
  end if;
end $$;

-- ===== A origem da resposta é decidida pelo servidor
do $$
declare
  d uuid := (select valor::uuid from ctx where chave = 'deep');
  s uuid := (select valor::uuid from ctx where chave = 's1');
  eva constant text := '92000000-0000-0000-0000-000000000002';
begin
  -- Caminho de sempre (digitação e correção manual): origem "digitacao".
  perform public.deep_registrar_respostas(s, eva::uuid, true, '[{"pergunta_id":"a.itens","valor":120,"confianca":"alta"}]');
  if (select origem from public.deep_respostas where deep_id = d and pergunta_id = 'a.itens' and status = 'vigente') <> 'digitacao' then
    raise exception 'FALHA: resposta digitada ficou com outra origem';
  end if;
  -- A origem não é um campo da resposta: o modelo não consegue forjá-la.
  perform pg_temp.falha_com(format($q$select public.deep_registrar_respostas(%L, %L, true,
    '[{"pergunta_id":"a.x","valor":1,"confianca":"alta","origem":"digitacao"}]')$q$, s, eva),
    '%resposta inválida%', 'o modelo mandou a origem na resposta');
  perform pg_temp.falha_com(format($q$select public.deep_registrar_respostas_origem(%L, %L, true,
    '[{"pergunta_id":"a.x","valor":1,"confianca":"alta"}]', 'telepatia')$q$, s, eva),
    '%origem da resposta inválida%', 'aceitou origem inexistente');

  perform public.deep_registrar_respostas_origem(s, eva::uuid, true,
    '[{"pergunta_id":"a.fornecedores","valor":4,"confianca":"media","trecho":"são quatro"}]', 'escuta');
  if (select origem from public.deep_respostas where deep_id = d and pergunta_id = 'a.fornecedores' and status = 'vigente') <> 'escuta' then
    raise exception 'FALHA: resposta captada não ficou com origem escuta';
  end if;
  -- Corrigir pela digitação substitui, e a captada fica no histórico.
  perform public.deep_registrar_respostas(s, eva::uuid, true, '[{"pergunta_id":"a.fornecedores","valor":5,"confianca":"alta"}]');
  if (select count(*) from public.deep_respostas where deep_id = d and pergunta_id = 'a.fornecedores' and status = 'substituida' and origem = 'escuta') <> 1
     or (select count(*) from public.deep_respostas where deep_id = d and pergunta_id = 'a.fornecedores' and status = 'vigente' and origem = 'digitacao') <> 1 then
    raise exception 'FALHA: correção da resposta captada não preservou o histórico';
  end if;
  if (select count(*) from public.audit_log where acao = 'deep.respostas' and dados ->> 'origem' = 'escuta') < 2 then
    raise exception 'FALHA: auditoria não guarda a origem';
  end if;
end $$;

-- ===== Teto de turnos: 300 com escuta, 120 sem; e limite de blocos por reunião
do $$
declare
  eva constant text := '92000000-0000-0000-0000-000000000002';
  s2 uuid := (select valor::uuid from ctx where chave = 's2');
begin
  perform public.deep_escuta_consentir(s2, eva::uuid, true, 'escuta@1', '[{"nome":"Caio"}]');
  perform public.deep_escuta_definir(s2, eva::uuid, true, 'fluido', null);
end $$;
reset role;
-- Os tetos são públicos só para a tela (authenticated); o servidor os usa por dentro das funções.
do $$ begin
  if public.deep_max_turnos_sessao_escuta() <> 300 or public.deep_max_turnos_sessao() <> 120 then
    raise exception 'FALHA: tetos de turnos';
  end if;
end $$;
update public.deep_sessoes set turnos = 120 where id in (select valor::uuid from ctx where chave in ('s2', 's3'));
-- 4995 blocos já gravados na reunião B (direto, como dono da tabela) para testar o limite de 5000.
insert into public.deep_escuta_blocos (deep_id, sessao_id, seq, canal, texto)
select s.deep_id, s.id, g, 'sala', 'x' from public.deep_sessoes s, generate_series(1, 4995) g
where s.id = (select valor::uuid from ctx where chave = 's2');
set local role service_role;
do $$
declare
  eva constant text := '92000000-0000-0000-0000-000000000002';
  s2 uuid := (select valor::uuid from ctx where chave = 's2');
  s3 uuid := (select valor::uuid from ctx where chave = 's3');
begin
  -- Reunião sem escuta continua com 120.
  perform pg_temp.falha_com(format($q$select public.deep_reservar_turno(%L, %L, true)$q$, s3, eva),
    '%limite de turnos da reunião%', 'reunião sem escuta passou de 120 turnos');
  -- Com escuta passa de 120, e para em 300.
  perform public.deep_reservar_turno(s2, eva::uuid, true);
  if (select turnos from public.deep_sessoes where id = s2) <> 121 then raise exception 'FALHA: turno da reunião com escuta'; end if;
end $$;
reset role;
update public.deep_sessoes set turnos = 300 where id = (select valor::uuid from ctx where chave = 's2');
set local role service_role;
do $$
declare
  eva constant text := '92000000-0000-0000-0000-000000000002';
  s2 uuid := (select valor::uuid from ctx where chave = 's2');
  lote5 text := (select jsonb_agg(jsonb_build_object('seq', 6000 + g, 'canal', 'sala', 'texto', 'y'))::text from generate_series(1, 5) g);
  lote6 text := (select jsonb_agg(jsonb_build_object('seq', 7000 + g, 'canal', 'sala', 'texto', 'y'))::text from generate_series(1, 6) g);
begin
  perform pg_temp.falha_com(format($q$select public.deep_reservar_turno(%L, %L, true)$q$, s2, eva),
    '%limite de turnos da reunião%', 'reunião com escuta passou de 300 turnos');
  perform pg_temp.falha_com(format($q$select public.deep_escuta_gravar_blocos(%L, %L, true, %L)$q$, s2, eva, lote6),
    '%limite de blocos%', 'passou de 5000 blocos');
  perform public.deep_escuta_gravar_blocos(s2, eva::uuid, true, lote5::jsonb);
  perform pg_temp.falha_com(format($q$select public.deep_escuta_gravar_blocos(%L, %L, true, '[{"seq":8000,"canal":"sala","texto":"z"}]')$q$, s2, eva),
    '%limite de blocos%', 'gravou o bloco 5001');
end $$;

-- ===== RLS: só quem conduz a empresa lê consentimentos, blocos e itens a confirmar
reset role;
set local role authenticated;
select pg_temp.como('92000000-0000-0000-0000-000000000002', 'aal2');
do $$ begin
  if (select count(*) from public.deep_escuta_consentimentos) <> 2
     or (select count(*) from public.deep_escuta_blocos) <> 5006
     or (select count(*) from public.deep_escuta_confirmar) <> 3 then
    raise exception 'FALHA: o analista da empresa não leu a escuta';
  end if;
end $$;
select pg_temp.como('92000000-0000-0000-0000-000000000003', 'aal2');
do $$ begin
  if exists (select 1 from public.deep_escuta_consentimentos) or exists (select 1 from public.deep_escuta_blocos)
     or exists (select 1 from public.deep_escuta_confirmar) then
    raise exception 'FALHA: Equipe IRON não alocada leu a escuta';
  end if;
end $$;
select pg_temp.como('92000000-0000-0000-0000-000000000004', 'aal2');
do $$ begin
  if exists (select 1 from public.deep_escuta_consentimentos) or exists (select 1 from public.deep_escuta_blocos)
     or exists (select 1 from public.deep_escuta_confirmar) then
    raise exception 'FALHA: ADM-Cliente leu a transcrição da escuta';
  end if;
end $$;
select pg_temp.como('92000000-0000-0000-0000-000000000006', 'aal2');
do $$ begin
  if exists (select 1 from public.deep_escuta_consentimentos) or exists (select 1 from public.deep_escuta_blocos)
     or exists (select 1 from public.deep_escuta_confirmar) then
    raise exception 'FALHA: ADM de outra empresa leu a escuta';
  end if;
end $$;

-- ===== Itens a confirmar não se editam; encerrar a reunião agora é possível
reset role;
do $$
begin
  perform pg_temp.falha_com($q$update public.deep_escuta_confirmar set valor = '99'$q$,
    '%só muda de pendente para confirmada ou descartada%', 'editou o valor de um item a confirmar');
  perform pg_temp.falha_com($q$update public.deep_escuta_confirmar set status = 'pendente', fechada_em = null$q$,
    '%só muda de pendente para confirmada ou descartada%', 'reabriu item resolvido');
  perform pg_temp.falha_com($q$update public.deep_escuta_confirmar set trecho = null$q$,
    '%só muda de pendente para confirmada ou descartada%', 'apagou trecho fora da retenção');
  perform pg_temp.falha_com($q$delete from public.deep_escuta_confirmar$q$,
    '%somente inserção%', 'apagou item a confirmar');
end $$;
set local role service_role;
do $$
declare
  s uuid := (select valor::uuid from ctx where chave = 's1');
  eva constant text := '92000000-0000-0000-0000-000000000002';
begin
  perform public.deep_encerrar_sessao(s, 'Cozinha central, perdas de 6%.', eva::uuid, true);
  if (select status from public.deep_sessoes where id = s) <> 'encerrada'
     or jsonb_array_length(public.deep_estado((select valor::uuid from ctx where chave = 'deep'), eva::uuid, true) -> 'a_confirmar') <> 0 then
    raise exception 'FALHA: encerrar com tudo resolvido';
  end if;
  perform pg_temp.falha_com(format($q$select public.deep_escuta_gravar_blocos(%L, %L, true, '[{"seq":50,"canal":"sala","texto":"x"}]')$q$, s, eva),
    '%encerrada%', 'gravou bloco em reunião encerrada');
end $$;

-- ===== Retenção: blocos e trechos saem; consentimentos, itens e respostas ficam
do $$
declare
  d uuid := (select valor::uuid from ctx where chave = 'deep');
  eva constant text := '92000000-0000-0000-0000-000000000002';
  n integer;
begin
  perform public.deep_definir_contrato_fim(d, current_date - 400, eva::uuid, true);
  n := public.deep_apagar_transcricoes_expiradas();
  if n <> 2 then raise exception 'FALHA: retenção apagou % falas', n; end if;
end $$;
reset role;
do $$
declare d uuid := (select valor::uuid from ctx where chave = 'deep');
begin
  if exists (select 1 from public.deep_escuta_blocos where deep_id = d) then
    raise exception 'FALHA: blocos transcritos ficaram depois da retenção';
  end if;
  if exists (select 1 from public.deep_escuta_confirmar where deep_id = d and trecho is not null)
     or (select count(*) from public.deep_escuta_confirmar where deep_id = d) <> 3
     or (select count(*) from public.deep_escuta_consentimentos where deep_id = d) <> 2
     or (select count(*) from public.deep_respostas where deep_id = d) <> 4 then
    raise exception 'FALHA: retenção apagou o que devia ficar (itens, consentimentos, respostas)';
  end if;
  if (select (dados ->> 'blocos_apagados')::int from public.audit_log where acao = 'deep.retencao'
        order by id desc limit 1) <> 5006 then
    raise exception 'FALHA: auditoria da retenção não conta os blocos';
  end if;
  if public.deep_em_retencao() then raise exception 'FALHA: retenção deixou a porta aberta'; end if;
end $$;

-- ===== Excluir a conta do analista não esbarra nos registros imutáveis da escuta
delete from auth.users where id = '92000000-0000-0000-0000-000000000002';
do $$ begin
  if exists (select 1 from public.deep_escuta_consentimentos where registrado_por is not null)
     or exists (select 1 from public.deep_escuta_confirmar where fechada_por is not null)
     or (select count(*) from public.deep_escuta_consentimentos) <> 2
     or (select count(*) from public.deep_escuta_confirmar) <> 3 then
    raise exception 'FALHA: exclusão da conta do analista';
  end if;
  perform pg_temp.falha_com($q$update public.deep_escuta_consentimentos set texto_versao = 'v9'$q$,
    '%somente inserção%', 'editou consentimento depois da exclusão da conta');
end $$;

rollback;
\echo 'OK: deep_escuta_test.sql passou'
