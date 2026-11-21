-- Escuta da reunião no Deep (decisão do Terrani, 20/11/2026): o analista pode
-- ligar, de forma opcional, a escuta da reunião. A fala é transcrita fora do
-- banco (Worker da Cloudflare) e chega aqui em blocos; o agente do Deep separa
-- o que responde ao roteiro da conversa paralela. Esta migração é só o banco.
--
-- Princípios (somam-se aos de 20261120120000_deep_assessment.sql):
-- 1. Escuta é opcional e começa desligada. Ligar exige o consentimento dos
--    participantes registrado (e auditado) para aquela reunião, no banco: a
--    tela só esconde o botão.
-- 2. Escrever continua sendo só do servidor (service_role). Todas as funções
--    recebem o analista e o nível de MFA e conferem deep.conduzir de novo.
-- 3. A origem de cada resposta (digitação ou escuta) é decidida pelo servidor,
--    nunca pelo modelo: o modelo não consegue forjar a origem.
-- 4. Resposta com baixa certeza não entra no Deep: fica numa lista "a
--    confirmar" e só vira resposta quando o analista confirma. A reunião não
--    encerra com itens a confirmar.
-- 5. Os blocos transcritos são transcrição: seguem a retenção de 12 meses.
--    Consentimentos e a lista "a confirmar" (sem o trecho) ficam como prova.
-- 6. O servidor mascara CPF, CNPJ, cartão e dados bancários antes de gravar o
--    bloco (mesma máscara do agente); o banco não vê o dado original.
-- 7. Teto de turnos maior para reunião com escuta (300 em vez de 120): cada
--    envio de blocos ao agente é um turno.

-- ----------------------------------------------------------- reunião e origem

alter table public.deep_sessoes
  add column escuta_modo text not null default 'desligada'
    check (escuta_modo in ('desligada', 'fluido', 'pergunta', 'ambos')),
  add column pergunta_marcada text check (pergunta_marcada ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  add column escuta_consentida_em timestamptz,
  add constraint deep_sessoes_escuta_coerente check (
    (escuta_modo = 'desligada' or escuta_consentida_em is not null)
    and (pergunta_marcada is null or escuta_modo in ('pergunta', 'ambos')));

-- Respostas existentes foram todas digitadas.
alter table public.deep_respostas
  add column origem text not null default 'digitacao' check (origem in ('digitacao', 'escuta'));

-- --------------------------------------------------------------- tabelas

-- Consentimento da reunião: quem estava presente e qual texto foi lido.
-- Só inserção; cada novo participante no meio da reunião gera outro registro.
create table public.deep_escuta_consentimentos (
  id uuid primary key default gen_random_uuid(),
  deep_id uuid not null references public.deep_assessments (id) on delete cascade,
  sessao_id uuid not null references public.deep_sessoes (id) on delete cascade,
  texto_versao text not null check (texto_versao ~ '^[a-z0-9][a-z0-9_.@-]{0,39}$'),
  participantes jsonb not null,
  registrado_por uuid references public.profiles (id) on delete set null,
  criado_em timestamptz not null default now(),
  constraint deep_escuta_consentimentos_participantes check (
    jsonb_typeof(participantes) = 'array' and octet_length(participantes::text) <= 16384)
);
create index deep_escuta_consentimentos_sessao_idx on public.deep_escuta_consentimentos (sessao_id);

-- Blocos transcritos, na ordem em que chegaram. "sala" é o microfone do
-- analista; "remoto" é o áudio da aba (quem participa por videochamada).
-- Só inserção; a única mudança é ser marcado como processado pelo agente.
create table public.deep_escuta_blocos (
  id bigint generated always as identity primary key,
  deep_id uuid not null references public.deep_assessments (id) on delete cascade,
  sessao_id uuid not null references public.deep_sessoes (id) on delete cascade,
  seq integer not null check (seq > 0),
  canal text not null check (canal in ('sala', 'remoto')),
  texto text not null check (char_length(texto) between 1 and 4000),
  inicio_ms bigint check (inicio_ms >= 0),
  fim_ms bigint check (fim_ms >= 0),
  -- Pergunta que o analista tinha marcado quando o bloco chegou (modos
  -- "pergunta a pergunta" e "ambos"); vem da reunião, não do navegador.
  pergunta_marcada text check (pergunta_marcada ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  -- Fala do analista (deep_mensagens.ordem) do turno que levou o bloco ao agente.
  mensagem_ordem integer check (mensagem_ordem > 0),
  processado_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (sessao_id, seq),
  constraint deep_escuta_blocos_tempo check (inicio_ms is null or fim_ms is null or fim_ms >= inicio_ms),
  constraint deep_escuta_blocos_processo check ((processado_em is null) = (mensagem_ordem is null))
);
create index deep_escuta_blocos_deep_idx on public.deep_escuta_blocos (deep_id);
create index deep_escuta_blocos_pendentes_idx on public.deep_escuta_blocos (sessao_id, seq) where processado_em is null;

-- Respostas que o agente ouviu com baixa certeza: esperam o analista.
create table public.deep_escuta_confirmar (
  id uuid primary key default gen_random_uuid(),
  deep_id uuid not null references public.deep_assessments (id) on delete cascade,
  sessao_id uuid not null references public.deep_sessoes (id) on delete cascade,
  pergunta_id text not null check (pergunta_id ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  area text not null check (area in ('A', 'B', 'C', 'transversal')),
  valor jsonb,
  nao_se_aplica boolean not null default false,
  participante text check (char_length(participante) <= 200),
  motivo text not null check (char_length(motivo) between 1 and 300),
  -- Trecho literal ouvido; sai junto com a transcrição (retenção).
  trecho text check (char_length(trecho) <= 500),
  mensagem_ordem integer check (mensagem_ordem > 0),
  status text not null default 'pendente' check (status in ('pendente', 'confirmada', 'descartada')),
  fechada_em timestamptz,
  fechada_por uuid references public.profiles (id) on delete set null,
  criado_em timestamptz not null default now(),
  constraint deep_escuta_confirmar_valor check (
    (nao_se_aplica and valor is null)
    or (not nao_se_aplica and valor is not null and octet_length(valor::text) <= 16384)),
  constraint deep_escuta_confirmar_fechamento check ((status = 'pendente') = (fechada_em is null))
);
-- Uma proposta pendente por pergunta: a mais nova substitui a anterior.
create unique index deep_escuta_confirmar_pendente_unica on public.deep_escuta_confirmar (deep_id, pergunta_id)
  where status = 'pendente';
create index deep_escuta_confirmar_sessao_idx on public.deep_escuta_confirmar (sessao_id);

-- ------------------------------------------------ registros imutáveis

-- Consentimento: só inserção. A única mudança permitida é o vínculo com quem
-- registrou virar nulo quando a conta dessa pessoa é excluída.
create function public.deep_escuta_consentimento_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.registrado_por is null
     and (to_jsonb(new) - 'registrado_por') = (to_jsonb(old) - 'registrado_por') then
    return new;
  end if;
  raise exception 'consentimento da escuta é somente inserção' using errcode = 'insufficient_privilege';
end;
$$;

create trigger deep_escuta_consentimentos_sem_mudanca before update or delete on public.deep_escuta_consentimentos
  for each row execute function public.deep_escuta_consentimento_imutavel();

-- Blocos: só inserção. Mudar só vale para marcar como processado; apagar só
-- na retenção.
create function public.deep_escuta_blocos_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and public.deep_em_retencao() then
    return old;
  end if;
  if tg_op = 'UPDATE'
     and old.processado_em is null and new.processado_em is not null
     and (to_jsonb(new) - 'processado_em' - 'mensagem_ordem') = (to_jsonb(old) - 'processado_em' - 'mensagem_ordem') then
    return new;
  end if;
  raise exception 'blocos da escuta só mudam ao serem processados' using errcode = 'insufficient_privilege';
end;
$$;

create trigger deep_escuta_blocos_sem_mudanca before update or delete on public.deep_escuta_blocos
  for each row execute function public.deep_escuta_blocos_imutavel();

-- A confirmar: nada se apaga. Muda de pendente para confirmada/descartada
-- (uma vez), o trecho some na retenção e o vínculo com quem fechou vira nulo
-- se a conta for excluída.
create function public.deep_escuta_confirmar_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  fixos_antes jsonb;
  fixos_depois jsonb;
  fechando boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'itens a confirmar são somente inserção' using errcode = 'insufficient_privilege';
  end if;
  fixos_antes := to_jsonb(old) - 'status' - 'fechada_em' - 'fechada_por' - 'trecho';
  fixos_depois := to_jsonb(new) - 'status' - 'fechada_em' - 'fechada_por' - 'trecho';
  fechando := old.status = 'pendente' and new.status in ('confirmada', 'descartada');
  if fixos_antes = fixos_depois
     and (new.trecho is not distinct from old.trecho or (public.deep_em_retencao() and new.trecho is null))
     and (new.status = old.status or fechando)
     and (new.fechada_em is not distinct from old.fechada_em or fechando)
     and (new.fechada_por is not distinct from old.fechada_por or fechando or new.fechada_por is null) then
    return new;
  end if;
  raise exception 'item a confirmar só muda de pendente para confirmada ou descartada' using errcode = 'insufficient_privilege';
end;
$$;

create trigger deep_escuta_confirmar_sem_mudanca before update or delete on public.deep_escuta_confirmar
  for each row execute function public.deep_escuta_confirmar_imutavel();

-- ------------------------------------------------------------------ apoio

-- Teto de turnos de uma reunião com escuta (custo do LLM).
create function public.deep_max_turnos_sessao_escuta()
returns integer language sql immutable set search_path = '' as $$ select 300 $$;

-- Participantes: de 1 a 30, só nome e cargo (mesma regra de deep_abrir_sessao).
create function public.deep_participantes_validos(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  x jsonb;
begin
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) not between 1 and 30 then
    return false;
  end if;
  for x in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(x) <> 'object'
       or exists (select 1 from jsonb_object_keys(x) k where k not in ('nome', 'cargo'))
       or jsonb_typeof(x -> 'nome') is distinct from 'string'
       or char_length(trim(x ->> 'nome')) not between 1 and 120
       or (x ? 'cargo' and (jsonb_typeof(x -> 'cargo') <> 'string' or char_length(x ->> 'cargo') > 120)) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- --------------------------------------------------- operações do servidor

/*
  deep_escuta_consentir: registra que os participantes foram avisados e
  concordaram com a escuta desta reunião. A lista informada passa a ser a
  lista de participantes da reunião (inclusive quando alguém entra depois).
*/
create function public.deep_escuta_consentir(
  p_sessao uuid,
  p_user uuid,
  p_aal2 boolean,
  p_texto_versao text,
  p_participantes jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.deep_sessoes;
  v_id uuid;
begin
  if p_texto_versao is null or p_texto_versao !~ '^[a-z0-9][a-z0-9_.@-]{0,39}$' then
    raise exception 'versão do texto de consentimento inválida' using errcode = 'check_violation';
  end if;
  if not public.deep_participantes_validos(p_participantes) then
    raise exception 'informe de 1 a 30 participantes, só com nome e cargo' using errcode = 'check_violation';
  end if;
  s := public.deep_sessao_aberta(p_sessao, p_user, p_aal2);

  insert into public.deep_escuta_consentimentos (deep_id, sessao_id, texto_versao, participantes, registrado_por)
  values (s.deep_id, p_sessao, p_texto_versao, p_participantes, p_user)
  returning id into v_id;
  update public.deep_sessoes set participantes = p_participantes, escuta_consentida_em = now() where id = p_sessao;

  perform public.deep_auditar(p_user, 'deep.escuta_consentir', 'deep_escuta_consentimentos', v_id::text,
    jsonb_build_object('deep_id', s.deep_id, 'sessao_id', p_sessao, 'texto_versao', p_texto_versao,
                       'participantes', jsonb_array_length(p_participantes)));
  return v_id;
end;
$$;

/*
  deep_escuta_definir: liga, troca o modo ou desliga a escuta da reunião e
  marca a pergunta atual.
    desligada : sem escuta.
    fluido    : o agente decide a que pergunta cada fala responde.
    pergunta  : a fala vale para a pergunta que o analista marcou.
    ambos     : a pergunta marcada tem prioridade; o agente ainda pode
                preencher outras que ouvir.
  Só liga com o consentimento da reunião registrado. A pergunta marcada só
  existe nos modos "pergunta" e "ambos".
*/
create function public.deep_escuta_definir(p_sessao uuid, p_user uuid, p_aal2 boolean, p_modo text, p_pergunta text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.deep_sessoes;
  v_pergunta text := nullif(trim(coalesce(p_pergunta, '')), '');
begin
  if p_modo is null or p_modo not in ('desligada', 'fluido', 'pergunta', 'ambos') then
    raise exception 'modo de escuta inválido' using errcode = 'check_violation';
  end if;
  if v_pergunta is not null and (p_modo not in ('pergunta', 'ambos') or v_pergunta !~ '^[a-z0-9][a-z0-9_.-]{0,79}$') then
    raise exception 'pergunta marcada inválida para este modo' using errcode = 'check_violation';
  end if;
  s := public.deep_sessao_aberta(p_sessao, p_user, p_aal2);
  if p_modo <> 'desligada' and s.escuta_consentida_em is null then
    raise exception 'registre o consentimento dos participantes antes de ligar a escuta' using errcode = 'check_violation';
  end if;

  update public.deep_sessoes set escuta_modo = p_modo, pergunta_marcada = v_pergunta where id = p_sessao;
  -- Só a mudança de modo é auditada; marcar a pergunta é parte do fluxo normal.
  if s.escuta_modo <> p_modo then
    perform public.deep_auditar(p_user, 'deep.escuta_modo', 'deep_sessoes', p_sessao::text,
      jsonb_build_object('deep_id', s.deep_id, 'antes', s.escuta_modo, 'depois', p_modo));
  end if;
  return jsonb_build_object('modo', p_modo, 'pergunta_marcada', v_pergunta);
end;
$$;

/*
  deep_escuta_gravar_blocos: guarda os blocos transcritos (até 20 por chamada,
  até 5000 por reunião). Bloco repetido (mesmo seq) é ignorado, então
  reenviar depois de uma queda de conexão não duplica. Cada item:
  {seq, canal, texto, inicio_ms?, fim_ms?}. A pergunta marcada vem da reunião.
  Devolve {gravados, repetidos}.
*/
create function public.deep_escuta_gravar_blocos(p_sessao uuid, p_user uuid, p_aal2 boolean, p_blocos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.deep_sessoes;
  b jsonb;
  v_gravados integer := 0;
  v_repetidos integer := 0;
  v_linhas integer;
  v_total integer;
begin
  if jsonb_typeof(p_blocos) is distinct from 'array' or jsonb_array_length(p_blocos) not between 1 and 20 then
    raise exception 'lote de blocos inválido (1 a 20)' using errcode = 'check_violation';
  end if;
  s := public.deep_sessao_aberta(p_sessao, p_user, p_aal2);
  if s.escuta_modo = 'desligada' then
    raise exception 'a escuta está desligada nesta reunião' using errcode = 'check_violation';
  end if;
  select count(*) into v_total from public.deep_escuta_blocos x where x.sessao_id = p_sessao;
  if v_total + jsonb_array_length(p_blocos) > 5000 then
    raise exception 'limite de blocos da escuta da reunião atingido' using errcode = 'check_violation';
  end if;

  for b in select * from jsonb_array_elements(p_blocos) loop
    if jsonb_typeof(b) <> 'object'
       or exists (select 1 from jsonb_object_keys(b) k where k not in ('seq', 'canal', 'texto', 'inicio_ms', 'fim_ms'))
       or jsonb_typeof(b -> 'seq') is distinct from 'number'
       or jsonb_typeof(b -> 'texto') is distinct from 'string' then
      raise exception 'bloco inválido' using errcode = 'check_violation';
    end if;
    insert into public.deep_escuta_blocos (deep_id, sessao_id, seq, canal, texto, inicio_ms, fim_ms, pergunta_marcada)
    values (s.deep_id, p_sessao, (b ->> 'seq')::integer, b ->> 'canal', trim(b ->> 'texto'),
            (b ->> 'inicio_ms')::bigint, (b ->> 'fim_ms')::bigint,
            case when s.escuta_modo in ('pergunta', 'ambos') then s.pergunta_marcada end)
    on conflict (sessao_id, seq) do nothing;
    get diagnostics v_linhas = row_count;
    v_gravados := v_gravados + v_linhas;
    v_repetidos := v_repetidos + (1 - v_linhas);
  end loop;
  return jsonb_build_object('gravados', v_gravados, 'repetidos', v_repetidos);
end;
$$;

/*
  deep_escuta_pendentes: blocos ainda não processados pelo agente, em ordem
  (até 40). Se um turno falhar, os blocos continuam aqui para a próxima vez.
*/
create function public.deep_escuta_pendentes(p_sessao uuid, p_user uuid, p_aal2 boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.deep_sessao_aberta(p_sessao, p_user, p_aal2);
  return coalesce((
    select jsonb_agg(jsonb_build_object('seq', x.seq, 'canal', x.canal, 'texto', x.texto,
                                        'pergunta_marcada', x.pergunta_marcada,
                                        'inicio_ms', x.inicio_ms, 'fim_ms', x.fim_ms)
                     order by x.seq)
    from (
      select * from public.deep_escuta_blocos b
      where b.sessao_id = p_sessao and b.processado_em is null
      order by b.seq
      limit 40
    ) x
  ), '[]'::jsonb);
end;
$$;

/*
  deep_escuta_marcar_processados: depois que o turno do agente foi gravado,
  marca os blocos que ele recebeu. p_mensagem_ordem é a fala do analista (em
  deep_mensagens) que levou esses blocos ao agente. Devolve quantos marcou.
*/
create function public.deep_escuta_marcar_processados(
  p_sessao uuid,
  p_user uuid,
  p_aal2 boolean,
  p_seqs integer[],
  p_mensagem_ordem integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marcados integer;
begin
  if p_seqs is null or cardinality(p_seqs) not between 1 and 40 or p_mensagem_ordem is null or p_mensagem_ordem < 1 then
    raise exception 'blocos a marcar inválidos' using errcode = 'check_violation';
  end if;
  perform public.deep_sessao_aberta(p_sessao, p_user, p_aal2);
  if not exists (select 1 from public.deep_mensagens m where m.sessao_id = p_sessao and m.ordem = p_mensagem_ordem) then
    raise exception 'a fala do turno não existe nesta reunião' using errcode = 'check_violation';
  end if;
  update public.deep_escuta_blocos
  set processado_em = now(), mensagem_ordem = p_mensagem_ordem
  where sessao_id = p_sessao and seq = any (p_seqs) and processado_em is null;
  get diagnostics v_marcados = row_count;
  return v_marcados;
end;
$$;

/*
  deep_registrar_respostas_origem: o corpo de deep_registrar_respostas, com a
  origem da resposta decidida pelo servidor ('digitacao' ou 'escuta').
  Resposta igual à vigente é ignorada; diferente substitui a vigente (que
  fica guardada). Cada item: {pergunta_id, valor, nao_se_aplica?, area?,
  participante?, confianca, trecho?, mensagem_ordem?}.
  Devolve {gravadas, inalteradas}.
*/
create function public.deep_registrar_respostas_origem(
  p_sessao uuid,
  p_user uuid,
  p_aal2 boolean,
  p_respostas jsonb,
  p_origem text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.deep_sessoes;
  r jsonb;
  v_antiga public.deep_respostas;
  v_nsa boolean;
  v_valor jsonb;
  v_gravadas integer := 0;
  v_inalteradas integer := 0;
  v_ids text[] := '{}';
begin
  if p_origem is null or p_origem not in ('digitacao', 'escuta') then
    raise exception 'origem da resposta inválida' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_respostas) is distinct from 'array' or jsonb_array_length(p_respostas) not between 1 and 50 then
    raise exception 'lote de respostas inválido (1 a 50)' using errcode = 'check_violation';
  end if;
  s := public.deep_sessao_aberta(p_sessao, p_user, p_aal2);

  for r in select * from jsonb_array_elements(p_respostas) loop
    if jsonb_typeof(r) <> 'object'
       or exists (select 1 from jsonb_object_keys(r) k where k not in
                  ('pergunta_id', 'valor', 'nao_se_aplica', 'area', 'participante', 'confianca', 'trecho', 'mensagem_ordem'))
       or jsonb_typeof(r -> 'pergunta_id') is distinct from 'string' then
      raise exception 'resposta inválida' using errcode = 'check_violation';
    end if;
    if (r ->> 'pergunta_id') = any (v_ids) then
      raise exception 'pergunta % repetida no lote', r ->> 'pergunta_id' using errcode = 'check_violation';
    end if;
    v_ids := v_ids || (r ->> 'pergunta_id');
    v_nsa := coalesce((r ->> 'nao_se_aplica')::boolean, false);
    v_valor := case when v_nsa then null else nullif(r -> 'valor', 'null'::jsonb) end;

    select * into v_antiga from public.deep_respostas x
    where x.deep_id = s.deep_id and x.pergunta_id = r ->> 'pergunta_id' and x.status = 'vigente'
    for update;
    if found and v_antiga.nao_se_aplica = v_nsa and v_antiga.valor is not distinct from v_valor then
      v_inalteradas := v_inalteradas + 1;
      continue;
    end if;
    if found then
      update public.deep_respostas set status = 'substituida' where id = v_antiga.id;
    end if;

    insert into public.deep_respostas (deep_id, pergunta_id, area, valor, nao_se_aplica, participante,
      confianca, sessao_id, mensagem_ordem, trecho, registrado_por, substitui_id, origem)
    values (s.deep_id, r ->> 'pergunta_id', coalesce(r ->> 'area', s.area), v_valor, v_nsa,
      nullif(trim(r ->> 'participante'), ''), r ->> 'confianca', p_sessao,
      (r ->> 'mensagem_ordem')::integer, nullif(trim(r ->> 'trecho'), ''), p_user,
      case when v_antiga.id is not null then v_antiga.id end, p_origem);
    v_gravadas := v_gravadas + 1;
    v_antiga := null;
  end loop;

  -- Auditoria sem copiar o conteúdo das respostas.
  perform public.deep_auditar(p_user, 'deep.respostas', 'deep_respostas', p_sessao::text,
    jsonb_build_object('deep_id', s.deep_id, 'gravadas', v_gravadas, 'inalteradas', v_inalteradas,
                       'origem', p_origem, 'perguntas', to_jsonb(v_ids)));
  return jsonb_build_object('gravadas', v_gravadas, 'inalteradas', v_inalteradas);
end;
$$;

-- A função de sempre (digitação e correção manual) passa a usar o corpo
-- acima, com a origem fixa em 'digitacao'. A assinatura não muda.
create or replace function public.deep_registrar_respostas(p_sessao uuid, p_user uuid, p_aal2 boolean, p_respostas jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select public.deep_registrar_respostas_origem(p_sessao, p_user, p_aal2, p_respostas, 'digitacao') $$;

/*
  deep_escuta_propor: o agente ouviu a resposta, mas sem certeza: guarda para
  o analista confirmar (até 50 por chamada). Nova proposta para a mesma
  pergunta descarta a pendente anterior. Cada item: {pergunta_id, valor,
  nao_se_aplica?, area?, participante?, motivo, trecho?, mensagem_ordem?}.
  Devolve a quantidade guardada.
*/
create function public.deep_escuta_propor(p_sessao uuid, p_user uuid, p_aal2 boolean, p_itens jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.deep_sessoes;
  i jsonb;
  v_nsa boolean;
  v_valor jsonb;
  v_ids text[] := '{}';
begin
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) not between 1 and 50 then
    raise exception 'lote a confirmar inválido (1 a 50)' using errcode = 'check_violation';
  end if;
  s := public.deep_sessao_aberta(p_sessao, p_user, p_aal2);

  for i in select * from jsonb_array_elements(p_itens) loop
    if jsonb_typeof(i) <> 'object'
       or exists (select 1 from jsonb_object_keys(i) k where k not in
                  ('pergunta_id', 'valor', 'nao_se_aplica', 'area', 'participante', 'motivo', 'trecho', 'mensagem_ordem'))
       or jsonb_typeof(i -> 'pergunta_id') is distinct from 'string'
       or jsonb_typeof(i -> 'motivo') is distinct from 'string' then
      raise exception 'item a confirmar inválido' using errcode = 'check_violation';
    end if;
    if (i ->> 'pergunta_id') = any (v_ids) then
      raise exception 'pergunta % repetida no lote', i ->> 'pergunta_id' using errcode = 'check_violation';
    end if;
    v_ids := v_ids || (i ->> 'pergunta_id');
    v_nsa := coalesce((i ->> 'nao_se_aplica')::boolean, false);
    v_valor := case when v_nsa then null else nullif(i -> 'valor', 'null'::jsonb) end;

    update public.deep_escuta_confirmar c set status = 'descartada', fechada_em = now()
    where c.deep_id = s.deep_id and c.pergunta_id = i ->> 'pergunta_id' and c.status = 'pendente';

    insert into public.deep_escuta_confirmar (deep_id, sessao_id, pergunta_id, area, valor, nao_se_aplica,
      participante, motivo, trecho, mensagem_ordem)
    values (s.deep_id, p_sessao, i ->> 'pergunta_id', coalesce(i ->> 'area', s.area), v_valor, v_nsa,
      nullif(trim(i ->> 'participante'), ''), trim(i ->> 'motivo'), nullif(trim(i ->> 'trecho'), ''),
      (i ->> 'mensagem_ordem')::integer);
  end loop;

  perform public.deep_auditar(p_user, 'deep.escuta_propor', 'deep_escuta_confirmar', p_sessao::text,
    jsonb_build_object('deep_id', s.deep_id, 'itens', cardinality(v_ids), 'perguntas', to_jsonb(v_ids)));
  return cardinality(v_ids);
end;
$$;

/*
  deep_escuta_resolver: o analista confirma ou descarta um item a confirmar.
  Confirmar grava a resposta (origem 'escuta', confiança alta porque uma
  pessoa validou) e fecha o item, na mesma transação. Corrigir o valor é pela
  correção manual que já existe.
*/
create function public.deep_escuta_resolver(p_item uuid, p_decisao text, p_user uuid, p_aal2 boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.deep_escuta_confirmar;
begin
  if p_decisao is null or p_decisao not in ('confirmar', 'descartar') then
    raise exception 'decisão inválida' using errcode = 'check_violation';
  end if;
  select * into c from public.deep_escuta_confirmar where id = p_item;
  if not found then
    raise exception 'acesso negado' using errcode = 'insufficient_privilege';
  end if;
  perform public.deep_autorizar(c.deep_id, p_user, p_aal2);
  select * into c from public.deep_escuta_confirmar where id = p_item for update;
  if c.status <> 'pendente' then
    raise exception 'o item já foi resolvido' using errcode = 'check_violation';
  end if;

  if p_decisao = 'confirmar' then
    perform public.deep_registrar_respostas_origem(c.sessao_id, p_user, p_aal2,
      jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'pergunta_id', c.pergunta_id, 'valor', c.valor, 'nao_se_aplica', c.nao_se_aplica, 'area', c.area,
        'participante', c.participante, 'confianca', 'alta', 'trecho', c.trecho,
        'mensagem_ordem', c.mensagem_ordem))),
      'escuta');
  end if;
  update public.deep_escuta_confirmar
  set status = case p_decisao when 'confirmar' then 'confirmada' else 'descartada' end,
      fechada_em = now(), fechada_por = p_user
  where id = p_item;
  perform public.deep_auditar(p_user, 'deep.escuta_resolver', 'deep_escuta_confirmar', p_item::text,
    jsonb_build_object('deep_id', c.deep_id, 'pergunta_id', c.pergunta_id, 'decisao', p_decisao));
end;
$$;

-- ------------------------------------------- funções existentes, estendidas

-- Teto de turnos: reunião com escuta registrada tem teto maior.
create or replace function public.deep_reservar_turno(p_sessao uuid, p_user uuid, p_aal2 boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.deep_sessoes;
  d public.deep_assessments;
  v_teto integer;
begin
  s := public.deep_sessao_aberta(p_sessao, p_user, p_aal2);
  select * into d from public.deep_assessments where id = s.deep_id;
  v_teto := case when s.escuta_consentida_em is not null
                 then public.deep_max_turnos_sessao_escuta() else public.deep_max_turnos_sessao() end;
  if s.turnos >= v_teto then
    raise exception 'limite de turnos da reunião atingido; encerre e abra outra' using errcode = 'check_violation';
  end if;
  if d.turnos >= public.deep_max_turnos_deep() then
    raise exception 'limite de turnos do Deep atingido' using errcode = 'check_violation';
  end if;
  update public.deep_sessoes set turnos = turnos + 1 where id = p_sessao;
  update public.deep_assessments set turnos = turnos + 1 where id = s.deep_id;
  return coalesce((
    select jsonb_agg(jsonb_build_object('papel', m.papel, 'conteudo', m.conteudo) order by m.ordem)
    from public.deep_mensagens m where m.sessao_id = p_sessao
  ), '[]'::jsonb);
end;
$$;

-- Não encerra a reunião com respostas da escuta ainda a confirmar.
create or replace function public.deep_encerrar_sessao(p_sessao uuid, p_resumo text, p_user uuid, p_aal2 boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.deep_sessoes;
begin
  if char_length(trim(coalesce(p_resumo, ''))) not between 1 and 20000 then
    raise exception 'resumo da reunião obrigatório (até 20000 caracteres)' using errcode = 'check_violation';
  end if;
  s := public.deep_sessao_aberta(p_sessao, p_user, p_aal2);
  if exists (select 1 from public.deep_escuta_confirmar c where c.sessao_id = p_sessao and c.status = 'pendente') then
    raise exception 'há respostas da escuta a confirmar; confirme ou descarte antes de encerrar'
      using errcode = 'check_violation';
  end if;
  update public.deep_sessoes set status = 'encerrada', resumo = trim(p_resumo), encerrada_em = now()
  where id = p_sessao;
  perform public.deep_auditar(p_user, 'deep.sessao_encerrar', 'deep_sessoes', p_sessao::text,
    jsonb_build_object('deep_id', s.deep_id, 'turnos', s.turnos));
end;
$$;

-- Estado para o agente: agora com a origem das respostas, o modo de escuta
-- de cada reunião e o que está a confirmar.
create or replace function public.deep_estado(p_deep uuid, p_user uuid, p_aal2 boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deep_assessments;
begin
  d := public.deep_autorizar(p_deep, p_user, p_aal2, false);
  return jsonb_build_object(
    'deep', jsonb_build_object('id', d.id, 'org_id', d.org_id, 'setor', d.setor, 'pacote_versao', d.pacote_versao,
                               'status', d.status, 'escopo', d.escopo, 'turnos', d.turnos,
                               'self_assessment_id', d.self_assessment_id, 'contrato_fim', d.contrato_fim),
    'sessoes', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'numero', s.numero, 'area', s.area, 'titulo', s.titulo,
                                          'status', s.status, 'participantes', s.participantes, 'resumo', s.resumo,
                                          'iniciada_em', s.iniciada_em, 'encerrada_em', s.encerrada_em,
                                          'escuta_modo', s.escuta_modo, 'pergunta_marcada', s.pergunta_marcada)
                       order by s.numero)
      from public.deep_sessoes s where s.deep_id = p_deep
    ), '[]'::jsonb),
    'respostas', coalesce((
      select jsonb_agg(jsonb_build_object('pergunta_id', r.pergunta_id, 'area', r.area, 'valor', r.valor,
                                          'nao_se_aplica', r.nao_se_aplica, 'confianca', r.confianca,
                                          'participante', r.participante, 'origem', r.origem)
                       order by r.pergunta_id)
      from public.deep_respostas r where r.deep_id = p_deep and r.status = 'vigente'
    ), '[]'::jsonb),
    'evidencias', coalesce((
      select jsonb_agg(jsonb_build_object('criterio_id', e.criterio_id, 'area', e.area, 'tipo', e.tipo,
                                          'fonte', e.fonte, 'descricao', e.descricao, 'cumprido', e.cumprido)
                       order by e.criterio_id)
      from public.deep_evidencias e where e.deep_id = p_deep and e.status = 'vigente'
    ), '[]'::jsonb),
    'pendencias_abertas', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'fonte', p.fonte, 'descricao', p.descricao,
                                          'responsavel', p.responsavel, 'prazo', p.prazo)
                       order by p.criado_em)
      from public.deep_pendencias p where p.deep_id = p_deep and p.status = 'aberta'
    ), '[]'::jsonb),
    'a_confirmar', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'sessao_id', c.sessao_id, 'pergunta_id', c.pergunta_id,
                                          'area', c.area, 'valor', c.valor, 'nao_se_aplica', c.nao_se_aplica,
                                          'participante', c.participante, 'motivo', c.motivo)
                       order by c.criado_em)
      from public.deep_escuta_confirmar c where c.deep_id = p_deep and c.status = 'pendente'
    ), '[]'::jsonb)
  );
end;
$$;

-- Retenção: agora também apaga os blocos transcritos e o trecho literal dos
-- itens a confirmar. Mesmo prazo de 12 meses depois do fim do contrato.
create or replace function public.deep_apagar_transcricoes_expiradas()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_apagadas integer;
  v_blocos integer;
begin
  perform set_config('iron.deep_retencao', 'on', true);
  with vencidos as (
    select d.id from public.deep_assessments d
    where coalesce(d.contrato_fim, d.concluido_em::date) + interval '12 months' <= current_date
  ), apagadas as (
    delete from public.deep_mensagens m using vencidos v where m.deep_id = v.id returning 1
  )
  select count(*)::integer into v_apagadas from apagadas;

  with vencidos as (
    select d.id from public.deep_assessments d
    where coalesce(d.contrato_fim, d.concluido_em::date) + interval '12 months' <= current_date
  ), apagados as (
    delete from public.deep_escuta_blocos b using vencidos v where b.deep_id = v.id returning 1
  )
  select count(*)::integer into v_blocos from apagados;

  update public.deep_respostas r set trecho = null
  from public.deep_assessments d
  where d.id = r.deep_id and r.trecho is not null
    and coalesce(d.contrato_fim, d.concluido_em::date) + interval '12 months' <= current_date;

  update public.deep_escuta_confirmar c set trecho = null
  from public.deep_assessments d
  where d.id = c.deep_id and c.trecho is not null
    and coalesce(d.contrato_fim, d.concluido_em::date) + interval '12 months' <= current_date;

  perform set_config('iron.deep_retencao', '', true);
  if v_apagadas > 0 or v_blocos > 0 then
    perform public.deep_auditar(null, 'deep.retencao', 'deep_mensagens', null,
      jsonb_build_object('falas_apagadas', v_apagadas, 'blocos_apagados', v_blocos));
  end if;
  return v_apagadas;
end;
$$;

-- --------------------------------------------------------------- privilégios

do $$
declare
  f text;
  servidor text[] := array[
    'public.deep_escuta_consentir(uuid, uuid, boolean, text, jsonb)',
    'public.deep_escuta_definir(uuid, uuid, boolean, text, text)',
    'public.deep_escuta_gravar_blocos(uuid, uuid, boolean, jsonb)',
    'public.deep_escuta_pendentes(uuid, uuid, boolean)',
    'public.deep_escuta_marcar_processados(uuid, uuid, boolean, integer[], integer)',
    'public.deep_registrar_respostas_origem(uuid, uuid, boolean, jsonb, text)',
    'public.deep_escuta_propor(uuid, uuid, boolean, jsonb)',
    'public.deep_escuta_resolver(uuid, text, uuid, boolean)'
  ];
  internas text[] := array[
    'public.deep_participantes_validos(jsonb)',
    'public.deep_escuta_consentimento_imutavel()',
    'public.deep_escuta_blocos_imutavel()',
    'public.deep_escuta_confirmar_imutavel()'
  ];
begin
  foreach f in array servidor || internas loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    foreach f in array servidor loop
      execute format('grant execute on function %s to service_role', f);
    end loop;
  end if;
end $$;

-- O teto é público para a tela, como os outros.
revoke execute on function public.deep_max_turnos_sessao_escuta() from public, anon;
grant execute on function public.deep_max_turnos_sessao_escuta() to authenticated;

-- -------------------------------------------------------------------- RLS
-- Só leitura pela API; toda escrita passa pelas funções do servidor.

alter table public.deep_escuta_consentimentos enable row level security;
alter table public.deep_escuta_blocos enable row level security;
alter table public.deep_escuta_confirmar enable row level security;

revoke all on public.deep_escuta_consentimentos, public.deep_escuta_blocos, public.deep_escuta_confirmar
  from anon, authenticated;
grant select on public.deep_escuta_consentimentos, public.deep_escuta_blocos, public.deep_escuta_confirmar
  to authenticated;

create policy "deep: analista le" on public.deep_escuta_consentimentos
  for select to authenticated using (public.tem_permissao('deep.conduzir', public.deep_org(deep_id)));
create policy "deep: analista le" on public.deep_escuta_blocos
  for select to authenticated using (public.tem_permissao('deep.conduzir', public.deep_org(deep_id)));
create policy "deep: analista le" on public.deep_escuta_confirmar
  for select to authenticated using (public.tem_permissao('deep.conduzir', public.deep_org(deep_id)));
