-- Deep assessment no app (decisão do Terrani, 20/11/2026): o analista da
-- IRON conduz reuniões com a empresa, lê as perguntas do agente para os
-- participantes e digita as respostas. Esta migração é só o banco.
--
-- Princípios:
-- 1. Quem conduz: permissão nova deep.conduzir (escopo empresa), dada ao
--    super-admin e à Equipe IRON. Os dois papéis exigem MFA, e a Equipe IRON
--    só alcança as empresas em que está alocada (staff_assignments). Não há
--    tabela própria de equipe do Deep: a alocação é a mesma do resto do app.
-- 2. Quem lê o resultado: só os relatórios PUBLICADOS, e só o ADM-Cliente
--    (permissão deep.relatorio_ver). Os participantes não usam a tela.
-- 3. Escrever é só do servidor (service_role), depois de autorizar com a
--    sessão do analista. As funções recebem o analista e o nível de MFA da
--    sessão e conferem a permissão de novo no banco.
-- 4. Histórico preservado entre reuniões: cada reunião é uma sessão; as falas
--    só são inseridas (nunca editadas); as respostas e as evidências são
--    versionadas (a nova substitui a anterior, que fica guardada); relatório
--    gerado não muda, só pode ser publicado uma vez.
-- 5. Custo tem teto no banco: 120 turnos por reunião e 3000 por Deep.
-- 6. Retenção (decisão de 20/11/2026): a transcrição fica até 12 meses depois
--    do fim do contrato. Respostas, evidências, pendências, resumos das
--    reuniões e relatórios ficam; o trecho literal citado em cada resposta
--    sai junto com a transcrição.
-- 7. Participantes são registrados só por nome e cargo (sem CPF, e-mail ou
--    telefone): é o mínimo para atribuir quem respondeu.

-- ---------------------------------------------------------- permissões

insert into public.permissions (codigo, descricao, escopo) values
  ('deep.conduzir', 'Conduzir o Deep assessment da empresa (modo analista)', 'empresa'),
  ('deep.relatorio_ver', 'Ver relatórios publicados do Deep assessment', 'empresa');

insert into public.role_permissions (role, permissao) values
  ('super_admin', 'deep.conduzir'), ('super_admin', 'deep.relatorio_ver'),
  ('equipe_iron', 'deep.conduzir'), ('equipe_iron', 'deep.relatorio_ver'),
  ('adm_cliente', 'deep.relatorio_ver');

-- --------------------------------------------------------------- tabelas

create table public.deep_assessments (
  id uuid primary key default gen_random_uuid(),
  -- Empresa não some com o Deep dentro: apagar exige decisão explícita.
  org_id uuid not null references public.organizations (id) on delete restrict,
  setor text not null check (setor in ('food_service')),
  -- Versão do roteiro (pacote do setor) usada nas perguntas, ex.: food_service@0.3.
  pacote_versao text not null check (pacote_versao ~ '^[a-z_]{2,40}@[0-9]{1,3}\.[0-9]{1,3}$'),
  status text not null default 'em_andamento' check (status in ('em_andamento', 'concluido', 'cancelado')),
  -- Escopo combinado na semana 0 (empresas, unidades piloto, fontes de dados).
  escopo jsonb not null default '{}'::jsonb,
  self_assessment_id uuid references public.assessments (id) on delete set null,
  criado_por uuid references public.profiles (id) on delete set null,
  contrato_fim date,
  motivo_cancelamento text check (char_length(motivo_cancelamento) <= 1000),
  turnos integer not null default 0 check (turnos >= 0),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  concluido_em timestamptz,
  constraint deep_assessments_escopo check (jsonb_typeof(escopo) = 'object' and octet_length(escopo::text) <= 65536)
);
-- Um Deep em andamento por empresa e setor: "abrir" retoma o que existe.
create unique index deep_assessments_andamento_unico on public.deep_assessments (org_id, setor)
  where status = 'em_andamento';
create index deep_assessments_org_idx on public.deep_assessments (org_id);

create trigger deep_assessments_tocar_atualizado before update on public.deep_assessments
  for each row execute function public.tocar_atualizado_em();

-- Uma reunião. A = cozinha e supply, B = salão e eventos, C = pessoas e
-- financeiro; transversal = prontidão, toque humano e contrato de medição.
create table public.deep_sessoes (
  id uuid primary key default gen_random_uuid(),
  deep_id uuid not null references public.deep_assessments (id) on delete cascade,
  numero integer not null check (numero > 0),
  area text not null check (area in ('A', 'B', 'C', 'transversal')),
  titulo text not null check (char_length(titulo) between 2 and 200),
  participantes jsonb not null default '[]'::jsonb,
  analista_id uuid references public.profiles (id) on delete set null,
  status text not null default 'aberta' check (status in ('aberta', 'encerrada')),
  -- Resumo escrito ao encerrar; vai como contexto das reuniões seguintes.
  resumo text check (char_length(resumo) <= 20000),
  turnos integer not null default 0 check (turnos >= 0),
  tokens_entrada bigint not null default 0 check (tokens_entrada >= 0),
  tokens_saida bigint not null default 0 check (tokens_saida >= 0),
  tokens_cache_leitura bigint not null default 0 check (tokens_cache_leitura >= 0),
  tokens_cache_escrita bigint not null default 0 check (tokens_cache_escrita >= 0),
  iniciada_em timestamptz not null default now(),
  encerrada_em timestamptz,
  unique (deep_id, numero),
  constraint deep_sessoes_participantes check (
    jsonb_typeof(participantes) = 'array' and octet_length(participantes::text) <= 16384)
);
-- Uma reunião aberta por área: reabrir a tela retoma a mesma reunião.
create unique index deep_sessoes_aberta_unica on public.deep_sessoes (deep_id, area) where status = 'aberta';

-- Falas da reunião (formato de mensagens do LLM). Só inserção.
create table public.deep_mensagens (
  id bigint generated always as identity primary key,
  deep_id uuid not null references public.deep_assessments (id) on delete cascade,
  sessao_id uuid not null references public.deep_sessoes (id) on delete cascade,
  ordem integer not null check (ordem > 0),
  papel text not null check (papel in ('analista', 'agente')),
  conteudo jsonb not null,
  criado_em timestamptz not null default now(),
  unique (sessao_id, ordem),
  constraint deep_mensagens_conteudo check (
    jsonb_typeof(conteudo) in ('string', 'array') and octet_length(conteudo::text) <= 262144)
);
create index deep_mensagens_deep_idx on public.deep_mensagens (deep_id);

-- Resposta estruturada de uma pergunta do roteiro. Versionada: corrigir é
-- inserir outra que substitui a vigente.
create table public.deep_respostas (
  id uuid primary key default gen_random_uuid(),
  deep_id uuid not null references public.deep_assessments (id) on delete cascade,
  pergunta_id text not null check (pergunta_id ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  area text not null check (area in ('A', 'B', 'C', 'transversal')),
  valor jsonb,
  nao_se_aplica boolean not null default false,
  participante text check (char_length(participante) <= 200),
  confianca text not null check (confianca in ('alta', 'media', 'baixa')),
  sessao_id uuid not null references public.deep_sessoes (id) on delete cascade,
  mensagem_ordem integer check (mensagem_ordem > 0),
  -- Trecho literal do que foi dito; sai junto com a transcrição (retenção).
  trecho text check (char_length(trecho) <= 500),
  registrado_por uuid references public.profiles (id) on delete set null,
  substitui_id uuid references public.deep_respostas (id),
  status text not null default 'vigente' check (status in ('vigente', 'substituida')),
  criado_em timestamptz not null default now(),
  constraint deep_respostas_valor check (
    (nao_se_aplica and valor is null)
    or (not nao_se_aplica and valor is not null and octet_length(valor::text) <= 16384))
);
create unique index deep_respostas_vigente_unica on public.deep_respostas (deep_id, pergunta_id)
  where status = 'vigente';
create index deep_respostas_sessao_idx on public.deep_respostas (sessao_id);

-- Evidência da régua de prontidão: um veredito vigente por critério.
create table public.deep_evidencias (
  id uuid primary key default gen_random_uuid(),
  deep_id uuid not null references public.deep_assessments (id) on delete cascade,
  criterio_id text not null check (criterio_id ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  area text not null check (area in ('A', 'B', 'C', 'transversal')),
  tipo text not null check (tipo in ('documento', 'dado', 'observacao', 'declaracao')),
  -- Fonte de dados do pedido (F01 a F20), quando houver.
  fonte text check (fonte ~ '^F[0-9]{2}$'),
  descricao text not null check (char_length(descricao) between 1 and 2000),
  cumprido boolean,
  sessao_id uuid not null references public.deep_sessoes (id) on delete cascade,
  registrado_por uuid references public.profiles (id) on delete set null,
  substitui_id uuid references public.deep_evidencias (id),
  status text not null default 'vigente' check (status in ('vigente', 'substituida')),
  criado_em timestamptz not null default now()
);
create unique index deep_evidencias_vigente_unica on public.deep_evidencias (deep_id, criterio_id)
  where status = 'vigente';

-- O que a empresa ficou de mandar (dados, documentos) ou de confirmar.
create table public.deep_pendencias (
  id uuid primary key default gen_random_uuid(),
  deep_id uuid not null references public.deep_assessments (id) on delete cascade,
  sessao_id uuid not null references public.deep_sessoes (id) on delete cascade,
  fonte text check (fonte ~ '^F[0-9]{2}$'),
  descricao text not null check (char_length(descricao) between 1 and 1000),
  responsavel text check (char_length(responsavel) <= 200),
  prazo date,
  status text not null default 'aberta' check (status in ('aberta', 'recebida', 'cancelada')),
  nota_fechamento text check (char_length(nota_fechamento) <= 1000),
  criado_por uuid references public.profiles (id) on delete set null,
  criado_em timestamptz not null default now(),
  fechada_por uuid references public.profiles (id) on delete set null,
  fechada_em timestamptz,
  constraint deep_pendencias_fechamento check ((status = 'aberta') = (fechada_em is null))
);
create index deep_pendencias_deep_idx on public.deep_pendencias (deep_id, status);

-- Relatório parcial (por área) ou final. O conteúdo vem do motor
-- determinístico do servidor; o banco só guarda e versiona.
create table public.deep_relatorios (
  id uuid primary key default gen_random_uuid(),
  deep_id uuid not null references public.deep_assessments (id) on delete cascade,
  tipo text not null check (tipo in ('parcial', 'final')),
  area text check (area in ('A', 'B', 'C')),
  versao integer not null check (versao > 0),
  conteudo jsonb not null,
  motor_versao text not null check (char_length(motor_versao) between 1 and 40),
  gerado_por uuid references public.profiles (id) on delete set null,
  gerado_em timestamptz not null default now(),
  publicado_por uuid references public.profiles (id) on delete set null,
  publicado_em timestamptz,
  constraint deep_relatorios_area check ((tipo = 'parcial') = (area is not null)),
  constraint deep_relatorios_conteudo check (
    jsonb_typeof(conteudo) = 'object' and octet_length(conteudo::text) <= 1048576)
);
create unique index deep_relatorios_versao_unica on public.deep_relatorios (deep_id, tipo, coalesce(area, ''), versao);

-- ------------------------------------------------ registros imutáveis

-- Retenção: só deep_apagar_transcricoes_expiradas liga esta chave (local à
-- transação) para apagar falas e limpar trechos.
create function public.deep_em_retencao()
returns boolean
language sql
stable
set search_path = ''
as $$ select coalesce(current_setting('iron.deep_retencao', true), '') = 'on' $$;

create function public.deep_mensagens_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and public.deep_em_retencao() then
    return old;
  end if;
  raise exception 'falas do Deep são somente inserção' using errcode = 'insufficient_privilege';
end;
$$;

create trigger deep_mensagens_sem_mudanca before update or delete on public.deep_mensagens
  for each row execute function public.deep_mensagens_imutavel();

-- Respostas e evidências: a única mudança é vigente -> substituida (e, na
-- retenção, apagar o trecho literal). Nada se apaga. Quando a conta de quem
-- registrou é excluída, o vínculo vira nulo (on delete set null) e isso passa.
create function public.deep_versionado_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  antes jsonb;
  depois jsonb;
begin
  if tg_op = 'DELETE' then
    raise exception '% é somente inserção', tg_table_name using errcode = 'insufficient_privilege';
  end if;
  antes := to_jsonb(old) - 'status' - 'trecho';
  depois := to_jsonb(new) - 'status' - 'trecho';
  if new.registrado_por is null then
    antes := antes - 'registrado_por';
    depois := depois - 'registrado_por';
  end if;
  if antes = depois
     and (new.status = old.status or (old.status = 'vigente' and new.status = 'substituida'))
     and ((to_jsonb(new) -> 'trecho') is not distinct from (to_jsonb(old) -> 'trecho')
          or (public.deep_em_retencao() and (to_jsonb(new) ->> 'trecho') is null)) then
    return new;
  end if;
  raise exception '% só muda de vigente para substituida', tg_table_name using errcode = 'insufficient_privilege';
end;
$$;

create trigger deep_respostas_versionado before update or delete on public.deep_respostas
  for each row execute function public.deep_versionado_imutavel();
create trigger deep_evidencias_versionado before update or delete on public.deep_evidencias
  for each row execute function public.deep_versionado_imutavel();

-- Relatório: só publicar, uma vez (ou anular quem gerou/publicou, quando a
-- conta dessa pessoa é excluída).
create function public.deep_relatorios_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  fixo jsonb := to_jsonb(old) - 'publicado_em' - 'publicado_por' - 'gerado_por';
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'publicado_em' - 'publicado_por' - 'gerado_por') = fixo
     and (new.gerado_por is not distinct from old.gerado_por or new.gerado_por is null)
     and (
       -- publicar
       (old.publicado_em is null and new.publicado_em is not null and new.publicado_por is not null
        and new.gerado_por is not distinct from old.gerado_por)
       -- conta excluída
       or (new.publicado_em is not distinct from old.publicado_em
           and (new.publicado_por is not distinct from old.publicado_por or new.publicado_por is null))
     ) then
    return new;
  end if;
  raise exception 'relatório gerado não muda; só pode ser publicado uma vez' using errcode = 'insufficient_privilege';
end;
$$;

create trigger deep_relatorios_sem_mudanca before update or delete on public.deep_relatorios
  for each row execute function public.deep_relatorios_imutavel();

-- ------------------------------------------------------------ apoio

-- Teto de turnos (custo do LLM).
create function public.deep_max_turnos_sessao()
returns integer language sql immutable set search_path = '' as $$ select 120 $$;
create function public.deep_max_turnos_deep()
returns integer language sql immutable set search_path = '' as $$ select 3000 $$;

-- Empresa de um Deep (usada nas políticas de RLS sem recursão). Só responde
-- para quem conduz ou lê relatórios daquela empresa.
create function public.deep_org(p_deep uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.org_id from public.deep_assessments d
  where d.id = p_deep
    and (public.tem_permissao('deep.conduzir', d.org_id) or public.tem_permissao('deep.relatorio_ver', d.org_id))
$$;

create function public.deep_auditar(p_user uuid, p_acao text, p_tabela text, p_alvo text, p_dados jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (ator, acao, tabela, alvo, dados)
  values (p_user, p_acao, p_tabela, p_alvo, coalesce(p_dados, '{}'::jsonb));
$$;

/*
  deep_autorizar: confere deep.conduzir para o analista na empresa do Deep e
  trava a linha do Deep. Com p_andamento, exige o Deep em andamento.
*/
create function public.deep_autorizar(p_deep uuid, p_user uuid, p_aal2 boolean, p_andamento boolean default true)
returns public.deep_assessments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.deep_assessments;
begin
  select * into v from public.deep_assessments d where d.id = p_deep for update;
  if not found or not public.usuario_tem_permissao(p_user, 'deep.conduzir', v.org_id, p_aal2) then
    raise exception 'acesso negado' using errcode = 'insufficient_privilege';
  end if;
  if p_andamento and v.status <> 'em_andamento' then
    raise exception 'o Deep não está em andamento' using errcode = 'check_violation';
  end if;
  return v;
end;
$$;

-- Reunião aberta do Deep, autorizada para o analista. Devolve a sessão travada.
create function public.deep_sessao_aberta(p_sessao uuid, p_user uuid, p_aal2 boolean)
returns public.deep_sessoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.deep_sessoes;
begin
  select * into s from public.deep_sessoes where id = p_sessao;
  if not found then
    raise exception 'acesso negado' using errcode = 'insufficient_privilege';
  end if;
  perform public.deep_autorizar(s.deep_id, p_user, p_aal2);
  select * into s from public.deep_sessoes where id = p_sessao for update;
  if s.status <> 'aberta' then
    raise exception 'a reunião já foi encerrada' using errcode = 'check_violation';
  end if;
  return s;
end;
$$;

-- --------------------------------------------------- operações do servidor

/*
  deep_abrir: abre o Deep da empresa ou devolve o que já está em andamento.
  O Self de origem precisa ser da mesma empresa.
*/
create function public.deep_abrir(
  p_org uuid,
  p_setor text,
  p_pacote_versao text,
  p_escopo jsonb,
  p_self_assessment uuid,
  p_user uuid,
  p_aal2 boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.usuario_tem_permissao(p_user, 'deep.conduzir', p_org, p_aal2) then
    raise exception 'acesso negado' using errcode = 'insufficient_privilege';
  end if;
  -- Serializa aberturas da mesma empresa.
  perform 1 from public.organizations o where o.id = p_org for update;

  select d.id into v_id from public.deep_assessments d
  where d.org_id = p_org and d.setor = p_setor and d.status = 'em_andamento';
  if found then
    return v_id;
  end if;

  if p_self_assessment is not null and not exists (
    select 1 from public.assessments a where a.id = p_self_assessment and a.org_id = p_org
  ) then
    raise exception 'o Self informado não é dessa empresa' using errcode = 'check_violation';
  end if;

  insert into public.deep_assessments (org_id, setor, pacote_versao, escopo, self_assessment_id, criado_por)
  values (p_org, p_setor, p_pacote_versao, coalesce(p_escopo, '{}'::jsonb), p_self_assessment, p_user)
  returning id into v_id;

  perform public.deep_auditar(p_user, 'deep.abrir', 'deep_assessments', v_id::text,
    jsonb_build_object('org_id', p_org, 'setor', p_setor, 'pacote_versao', p_pacote_versao));
  return v_id;
end;
$$;

/*
  deep_abrir_sessao: começa uma reunião (ou retoma a aberta da mesma área).
  Participantes: lista de {nome, cargo}; nada além disso.
*/
create function public.deep_abrir_sessao(
  p_deep uuid,
  p_area text,
  p_titulo text,
  p_participantes jsonb,
  p_user uuid,
  p_aal2 boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_numero integer;
  p jsonb;
  v_participantes jsonb := coalesce(p_participantes, '[]'::jsonb);
begin
  perform public.deep_autorizar(p_deep, p_user, p_aal2);

  select s.id into v_id from public.deep_sessoes s
  where s.deep_id = p_deep and s.area = p_area and s.status = 'aberta';
  if found then
    return v_id;
  end if;

  if jsonb_typeof(v_participantes) <> 'array' or jsonb_array_length(v_participantes) > 30 then
    raise exception 'participantes inválidos' using errcode = 'check_violation';
  end if;
  for p in select * from jsonb_array_elements(v_participantes) loop
    if jsonb_typeof(p) <> 'object'
       or exists (select 1 from jsonb_object_keys(p) k where k not in ('nome', 'cargo'))
       or jsonb_typeof(p -> 'nome') is distinct from 'string'
       or char_length(trim(p ->> 'nome')) not between 1 and 120
       or (p ? 'cargo' and (jsonb_typeof(p -> 'cargo') <> 'string' or char_length(p ->> 'cargo') > 120)) then
      raise exception 'participante deve ter só nome e cargo' using errcode = 'check_violation';
    end if;
  end loop;

  select coalesce(max(s.numero), 0) + 1 into v_numero from public.deep_sessoes s where s.deep_id = p_deep;
  insert into public.deep_sessoes (deep_id, numero, area, titulo, participantes, analista_id)
  values (p_deep, v_numero, p_area, trim(coalesce(p_titulo, '')), v_participantes, p_user)
  returning id into v_id;

  perform public.deep_auditar(p_user, 'deep.sessao_abrir', 'deep_sessoes', v_id::text,
    jsonb_build_object('deep_id', p_deep, 'area', p_area, 'numero', v_numero,
                       'participantes', jsonb_array_length(v_participantes)));
  return v_id;
end;
$$;

/*
  deep_reservar_turno: antes de chamar o LLM, reserva um turno da reunião e
  do Deep (tetos no banco) e devolve as falas da reunião, em ordem.
*/
create function public.deep_reservar_turno(p_sessao uuid, p_user uuid, p_aal2 boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.deep_sessoes;
  d public.deep_assessments;
begin
  s := public.deep_sessao_aberta(p_sessao, p_user, p_aal2);
  select * into d from public.deep_assessments where id = s.deep_id;
  if s.turnos >= public.deep_max_turnos_sessao() then
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

/*
  deep_gravar_mensagens: acrescenta as falas novas do turno ao fim da reunião
  e soma o uso. Nunca reescreve o que já foi gravado.
*/
create function public.deep_gravar_mensagens(
  p_sessao uuid,
  p_user uuid,
  p_aal2 boolean,
  p_mensagens jsonb,
  p_tokens_entrada bigint,
  p_tokens_saida bigint,
  p_tokens_cache_leitura bigint,
  p_tokens_cache_escrita bigint
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.deep_sessoes;
  v_ordem integer;
  m jsonb;
begin
  if jsonb_typeof(p_mensagens) is distinct from 'array'
     or jsonb_array_length(p_mensagens) not between 1 and 40
     or least(p_tokens_entrada, p_tokens_saida, p_tokens_cache_leitura, p_tokens_cache_escrita) < 0
     or num_nulls(p_tokens_entrada, p_tokens_saida, p_tokens_cache_leitura, p_tokens_cache_escrita) > 0 then
    raise exception 'dados da reunião inválidos' using errcode = 'check_violation';
  end if;
  s := public.deep_sessao_aberta(p_sessao, p_user, p_aal2);

  select coalesce(max(x.ordem), 0) into v_ordem from public.deep_mensagens x where x.sessao_id = p_sessao;
  for m in select * from jsonb_array_elements(p_mensagens) loop
    if jsonb_typeof(m) <> 'object'
       or exists (select 1 from jsonb_object_keys(m) k where k not in ('papel', 'conteudo')) then
      raise exception 'fala inválida' using errcode = 'check_violation';
    end if;
    v_ordem := v_ordem + 1;
    insert into public.deep_mensagens (deep_id, sessao_id, ordem, papel, conteudo)
    values (s.deep_id, p_sessao, v_ordem, m ->> 'papel', m -> 'conteudo');
  end loop;

  update public.deep_sessoes
  set tokens_entrada = tokens_entrada + p_tokens_entrada,
      tokens_saida = tokens_saida + p_tokens_saida,
      tokens_cache_leitura = tokens_cache_leitura + p_tokens_cache_leitura,
      tokens_cache_escrita = tokens_cache_escrita + p_tokens_cache_escrita
  where id = p_sessao;
  return v_ordem;
end;
$$;

/*
  deep_registrar_respostas: grava em lote as respostas que o agente extraiu
  da fala do analista (várias perguntas numa fala só). Resposta igual à
  vigente é ignorada; diferente substitui a vigente (que fica guardada).
  Cada item: {pergunta_id, valor, nao_se_aplica?, area?, participante?,
  confianca, trecho?, mensagem_ordem?}. Devolve {gravadas, inalteradas}.
*/
create function public.deep_registrar_respostas(p_sessao uuid, p_user uuid, p_aal2 boolean, p_respostas jsonb)
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
      confianca, sessao_id, mensagem_ordem, trecho, registrado_por, substitui_id)
    values (s.deep_id, r ->> 'pergunta_id', coalesce(r ->> 'area', s.area), v_valor, v_nsa,
      nullif(trim(r ->> 'participante'), ''), r ->> 'confianca', p_sessao,
      (r ->> 'mensagem_ordem')::integer, nullif(trim(r ->> 'trecho'), ''), p_user,
      case when v_antiga.id is not null then v_antiga.id end);
    v_gravadas := v_gravadas + 1;
    v_antiga := null;
  end loop;

  -- Auditoria sem copiar o conteúdo das respostas.
  perform public.deep_auditar(p_user, 'deep.respostas', 'deep_respostas', p_sessao::text,
    jsonb_build_object('deep_id', s.deep_id, 'gravadas', v_gravadas, 'inalteradas', v_inalteradas,
                       'perguntas', to_jsonb(v_ids)));
  return jsonb_build_object('gravadas', v_gravadas, 'inalteradas', v_inalteradas);
end;
$$;

/*
  deep_registrar_evidencias: mesmo modelo das respostas, para a régua de
  prontidão. Cada item: {criterio_id, tipo, descricao, fonte?, cumprido?, area?}.
*/
create function public.deep_registrar_evidencias(p_sessao uuid, p_user uuid, p_aal2 boolean, p_evidencias jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.deep_sessoes;
  e jsonb;
  v_antiga public.deep_evidencias;
  v_cumprido boolean;
  v_gravadas integer := 0;
  v_inalteradas integer := 0;
  v_ids text[] := '{}';
begin
  if jsonb_typeof(p_evidencias) is distinct from 'array' or jsonb_array_length(p_evidencias) not between 1 and 50 then
    raise exception 'lote de evidências inválido (1 a 50)' using errcode = 'check_violation';
  end if;
  s := public.deep_sessao_aberta(p_sessao, p_user, p_aal2);

  for e in select * from jsonb_array_elements(p_evidencias) loop
    if jsonb_typeof(e) <> 'object'
       or exists (select 1 from jsonb_object_keys(e) k where k not in
                  ('criterio_id', 'tipo', 'descricao', 'fonte', 'cumprido', 'area'))
       or jsonb_typeof(e -> 'criterio_id') is distinct from 'string' then
      raise exception 'evidência inválida' using errcode = 'check_violation';
    end if;
    if (e ->> 'criterio_id') = any (v_ids) then
      raise exception 'critério % repetido no lote', e ->> 'criterio_id' using errcode = 'check_violation';
    end if;
    v_ids := v_ids || (e ->> 'criterio_id');
    v_cumprido := (e ->> 'cumprido')::boolean;

    select * into v_antiga from public.deep_evidencias x
    where x.deep_id = s.deep_id and x.criterio_id = e ->> 'criterio_id' and x.status = 'vigente'
    for update;
    if found and v_antiga.tipo = e ->> 'tipo' and v_antiga.descricao = e ->> 'descricao'
       and v_antiga.fonte is not distinct from e ->> 'fonte' and v_antiga.cumprido is not distinct from v_cumprido then
      v_inalteradas := v_inalteradas + 1;
      continue;
    end if;
    if found then
      update public.deep_evidencias set status = 'substituida' where id = v_antiga.id;
    end if;

    insert into public.deep_evidencias (deep_id, criterio_id, area, tipo, fonte, descricao, cumprido,
      sessao_id, registrado_por, substitui_id)
    values (s.deep_id, e ->> 'criterio_id', coalesce(e ->> 'area', s.area), e ->> 'tipo', e ->> 'fonte',
      e ->> 'descricao', v_cumprido, p_sessao, p_user, case when v_antiga.id is not null then v_antiga.id end);
    v_gravadas := v_gravadas + 1;
    v_antiga := null;
  end loop;

  perform public.deep_auditar(p_user, 'deep.evidencias', 'deep_evidencias', p_sessao::text,
    jsonb_build_object('deep_id', s.deep_id, 'gravadas', v_gravadas, 'inalteradas', v_inalteradas,
                       'criterios', to_jsonb(v_ids)));
  return jsonb_build_object('gravadas', v_gravadas, 'inalteradas', v_inalteradas);
end;
$$;

-- Pendência combinada na reunião (ex.: "mandar o DRE de 2025", fonte F03).
create function public.deep_registrar_pendencia(
  p_sessao uuid,
  p_user uuid,
  p_aal2 boolean,
  p_fonte text,
  p_descricao text,
  p_responsavel text,
  p_prazo date
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
  s := public.deep_sessao_aberta(p_sessao, p_user, p_aal2);
  insert into public.deep_pendencias (deep_id, sessao_id, fonte, descricao, responsavel, prazo, criado_por)
  values (s.deep_id, p_sessao, nullif(p_fonte, ''), trim(coalesce(p_descricao, '')),
          nullif(trim(p_responsavel), ''), p_prazo, p_user)
  returning id into v_id;
  perform public.deep_auditar(p_user, 'deep.pendencia_abrir', 'deep_pendencias', v_id::text,
    jsonb_build_object('deep_id', s.deep_id, 'fonte', p_fonte));
  return v_id;
end;
$$;

-- Fecha uma pendência (recebida ou cancelada). Fechada não reabre.
create function public.deep_fechar_pendencia(p_pendencia uuid, p_status text, p_nota text, p_user uuid, p_aal2 boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deep uuid;
begin
  if p_status is null or p_status not in ('recebida', 'cancelada') then
    raise exception 'status de fechamento inválido' using errcode = 'check_violation';
  end if;
  select deep_id into v_deep from public.deep_pendencias where id = p_pendencia;
  if not found then
    raise exception 'acesso negado' using errcode = 'insufficient_privilege';
  end if;
  perform public.deep_autorizar(v_deep, p_user, p_aal2);
  update public.deep_pendencias
  set status = p_status, nota_fechamento = nullif(trim(p_nota), ''), fechada_por = p_user, fechada_em = now()
  where id = p_pendencia and status = 'aberta';
  if not found then
    raise exception 'a pendência já foi fechada' using errcode = 'check_violation';
  end if;
  perform public.deep_auditar(p_user, 'deep.pendencia_fechar', 'deep_pendencias', p_pendencia::text,
    jsonb_build_object('deep_id', v_deep, 'status', p_status));
end;
$$;

-- Encerra a reunião com o resumo que vai de contexto para as próximas.
create function public.deep_encerrar_sessao(p_sessao uuid, p_resumo text, p_user uuid, p_aal2 boolean)
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
  update public.deep_sessoes set status = 'encerrada', resumo = trim(p_resumo), encerrada_em = now()
  where id = p_sessao;
  perform public.deep_auditar(p_user, 'deep.sessao_encerrar', 'deep_sessoes', p_sessao::text,
    jsonb_build_object('deep_id', s.deep_id, 'turnos', s.turnos));
end;
$$;

/*
  deep_estado: tudo o que o agente precisa no começo de cada turno, sem a
  transcrição de outras reuniões (só os resumos delas).
*/
create function public.deep_estado(p_deep uuid, p_user uuid, p_aal2 boolean)
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
                                          'iniciada_em', s.iniciada_em, 'encerrada_em', s.encerrada_em)
                       order by s.numero)
      from public.deep_sessoes s where s.deep_id = p_deep
    ), '[]'::jsonb),
    'respostas', coalesce((
      select jsonb_agg(jsonb_build_object('pergunta_id', r.pergunta_id, 'area', r.area, 'valor', r.valor,
                                          'nao_se_aplica', r.nao_se_aplica, 'confianca', r.confianca,
                                          'participante', r.participante)
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
    ), '[]'::jsonb)
  );
end;
$$;

/*
  deep_gerar_relatorio: guarda uma nova versão do relatório (parcial da área
  ou final) calculada pelo motor do servidor. O final exige todas as
  reuniões encerradas.
*/
create function public.deep_gerar_relatorio(
  p_deep uuid,
  p_tipo text,
  p_area text,
  p_conteudo jsonb,
  p_motor_versao text,
  p_user uuid,
  p_aal2 boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_versao integer;
begin
  perform public.deep_autorizar(p_deep, p_user, p_aal2);
  if p_tipo = 'final' and exists (
    select 1 from public.deep_sessoes s where s.deep_id = p_deep and s.status = 'aberta'
  ) then
    raise exception 'encerre todas as reuniões antes do relatório final' using errcode = 'check_violation';
  end if;
  select coalesce(max(r.versao), 0) + 1 into v_versao from public.deep_relatorios r
  where r.deep_id = p_deep and r.tipo = p_tipo and r.area is not distinct from p_area;
  insert into public.deep_relatorios (deep_id, tipo, area, versao, conteudo, motor_versao, gerado_por)
  values (p_deep, p_tipo, p_area, v_versao, p_conteudo, p_motor_versao, p_user)
  returning id into v_id;
  perform public.deep_auditar(p_user, 'deep.relatorio_gerar', 'deep_relatorios', v_id::text,
    jsonb_build_object('deep_id', p_deep, 'tipo', p_tipo, 'area', p_area, 'versao', v_versao,
                       'motor_versao', p_motor_versao));
  return v_id;
end;
$$;

-- Publica para o ADM-Cliente. Uma vez publicado, não volta.
create function public.deep_publicar_relatorio(p_relatorio uuid, p_user uuid, p_aal2 boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deep uuid;
begin
  select deep_id into v_deep from public.deep_relatorios where id = p_relatorio;
  if not found then
    raise exception 'acesso negado' using errcode = 'insufficient_privilege';
  end if;
  perform public.deep_autorizar(v_deep, p_user, p_aal2, false);
  update public.deep_relatorios set publicado_em = now(), publicado_por = p_user
  where id = p_relatorio and publicado_em is null;
  if not found then
    raise exception 'relatório já publicado' using errcode = 'check_violation';
  end if;
  perform public.deep_auditar(p_user, 'deep.relatorio_publicar', 'deep_relatorios', p_relatorio::text,
    jsonb_build_object('deep_id', v_deep));
end;
$$;

-- Conclui o Deep: exige relatório final publicado e nenhuma reunião aberta.
create function public.deep_concluir(p_deep uuid, p_user uuid, p_aal2 boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.deep_autorizar(p_deep, p_user, p_aal2);
  if exists (select 1 from public.deep_sessoes s where s.deep_id = p_deep and s.status = 'aberta') then
    raise exception 'há reunião aberta' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.deep_relatorios r where r.deep_id = p_deep and r.tipo = 'final' and r.publicado_em is not null
  ) then
    raise exception 'publique o relatório final antes de concluir' using errcode = 'check_violation';
  end if;
  update public.deep_assessments set status = 'concluido', concluido_em = now() where id = p_deep;
  perform public.deep_auditar(p_user, 'deep.concluir', 'deep_assessments', p_deep::text, '{}'::jsonb);
end;
$$;

-- Cancela o Deep (contrato desfeito). Reuniões abertas são encerradas.
create function public.deep_cancelar(p_deep uuid, p_motivo text, p_user uuid, p_aal2 boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(trim(coalesce(p_motivo, ''))) not between 3 and 1000 then
    raise exception 'motivo do cancelamento obrigatório' using errcode = 'check_violation';
  end if;
  perform public.deep_autorizar(p_deep, p_user, p_aal2);
  update public.deep_sessoes set status = 'encerrada', encerrada_em = now(),
    resumo = coalesce(resumo, 'Reunião encerrada pelo cancelamento do Deep.')
  where deep_id = p_deep and status = 'aberta';
  update public.deep_assessments
  set status = 'cancelado', concluido_em = now(), motivo_cancelamento = trim(p_motivo)
  where id = p_deep;
  perform public.deep_auditar(p_user, 'deep.cancelar', 'deep_assessments', p_deep::text,
    jsonb_build_object('motivo', trim(p_motivo)));
end;
$$;

-- Data de fim do contrato: marca o início da contagem dos 12 meses.
create function public.deep_definir_contrato_fim(p_deep uuid, p_data date, p_user uuid, p_aal2 boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deep_assessments;
begin
  if p_data is null then
    raise exception 'data obrigatória' using errcode = 'check_violation';
  end if;
  d := public.deep_autorizar(p_deep, p_user, p_aal2, false);
  update public.deep_assessments set contrato_fim = p_data where id = p_deep;
  perform public.deep_auditar(p_user, 'deep.contrato_fim', 'deep_assessments', p_deep::text,
    jsonb_build_object('antes', d.contrato_fim, 'depois', p_data));
end;
$$;

/*
  Retenção: apaga as falas e os trechos literais 12 meses depois do fim do
  contrato. Sem data de contrato, conta a partir da conclusão ou do
  cancelamento; Deep em andamento sem contrato não expira. Com pg_cron no
  Supabase roda todo dia (ver docs/seguranca.md).
*/
create function public.deep_apagar_transcricoes_expiradas()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_apagadas integer;
begin
  perform set_config('iron.deep_retencao', 'on', true);
  with vencidos as (
    select d.id from public.deep_assessments d
    where coalesce(d.contrato_fim, d.concluido_em::date) + interval '12 months' <= current_date
  ), apagadas as (
    delete from public.deep_mensagens m using vencidos v where m.deep_id = v.id returning 1
  )
  select count(*)::integer into v_apagadas from apagadas;

  update public.deep_respostas r set trecho = null
  from public.deep_assessments d
  where d.id = r.deep_id and r.trecho is not null
    and coalesce(d.contrato_fim, d.concluido_em::date) + interval '12 months' <= current_date;

  perform set_config('iron.deep_retencao', '', true);
  if v_apagadas > 0 then
    perform public.deep_auditar(null, 'deep.retencao', 'deep_mensagens', null,
      jsonb_build_object('falas_apagadas', v_apagadas));
  end if;
  return v_apagadas;
end;
$$;

-- --------------------------------------------------------------- privilégios

do $$
declare
  f text;
  servidor text[] := array[
    'public.deep_abrir(uuid, text, text, jsonb, uuid, uuid, boolean)',
    'public.deep_abrir_sessao(uuid, text, text, jsonb, uuid, boolean)',
    'public.deep_reservar_turno(uuid, uuid, boolean)',
    'public.deep_gravar_mensagens(uuid, uuid, boolean, jsonb, bigint, bigint, bigint, bigint)',
    'public.deep_registrar_respostas(uuid, uuid, boolean, jsonb)',
    'public.deep_registrar_evidencias(uuid, uuid, boolean, jsonb)',
    'public.deep_registrar_pendencia(uuid, uuid, boolean, text, text, text, date)',
    'public.deep_fechar_pendencia(uuid, text, text, uuid, boolean)',
    'public.deep_encerrar_sessao(uuid, text, uuid, boolean)',
    'public.deep_estado(uuid, uuid, boolean)',
    'public.deep_gerar_relatorio(uuid, text, text, jsonb, text, uuid, boolean)',
    'public.deep_publicar_relatorio(uuid, uuid, boolean)',
    'public.deep_concluir(uuid, uuid, boolean)',
    'public.deep_cancelar(uuid, text, uuid, boolean)',
    'public.deep_definir_contrato_fim(uuid, date, uuid, boolean)',
    'public.deep_apagar_transcricoes_expiradas()'
  ];
  internas text[] := array[
    'public.deep_autorizar(uuid, uuid, boolean, boolean)',
    'public.deep_sessao_aberta(uuid, uuid, boolean)',
    'public.deep_auditar(uuid, text, text, text, jsonb)',
    'public.deep_em_retencao()',
    'public.deep_mensagens_imutavel()',
    'public.deep_versionado_imutavel()',
    'public.deep_relatorios_imutavel()'
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

-- deep_org é usada pelas políticas (e só responde a quem já enxerga o Deep);
-- os tetos são públicos para a tela.
revoke execute on function public.deep_org(uuid) from public, anon;
grant execute on function public.deep_org(uuid) to authenticated;
revoke execute on function public.deep_max_turnos_sessao(), public.deep_max_turnos_deep() from public, anon;
grant execute on function public.deep_max_turnos_sessao(), public.deep_max_turnos_deep() to authenticated;

-- -------------------------------------------------------------------- RLS
-- Só leitura pela API; toda escrita passa pelas funções do servidor.

alter table public.deep_assessments enable row level security;
alter table public.deep_sessoes enable row level security;
alter table public.deep_mensagens enable row level security;
alter table public.deep_respostas enable row level security;
alter table public.deep_evidencias enable row level security;
alter table public.deep_pendencias enable row level security;
alter table public.deep_relatorios enable row level security;

revoke all on public.deep_assessments, public.deep_sessoes, public.deep_mensagens, public.deep_respostas,
  public.deep_evidencias, public.deep_pendencias, public.deep_relatorios from anon, authenticated;
grant select on public.deep_assessments, public.deep_sessoes, public.deep_mensagens, public.deep_respostas,
  public.deep_evidencias, public.deep_pendencias, public.deep_relatorios to authenticated;

create policy "deep: analista le" on public.deep_assessments
  for select to authenticated using (public.tem_permissao('deep.conduzir', org_id));
create policy "deep: analista le" on public.deep_sessoes
  for select to authenticated using (public.tem_permissao('deep.conduzir', public.deep_org(deep_id)));
create policy "deep: analista le" on public.deep_mensagens
  for select to authenticated using (public.tem_permissao('deep.conduzir', public.deep_org(deep_id)));
create policy "deep: analista le" on public.deep_respostas
  for select to authenticated using (public.tem_permissao('deep.conduzir', public.deep_org(deep_id)));
create policy "deep: analista le" on public.deep_evidencias
  for select to authenticated using (public.tem_permissao('deep.conduzir', public.deep_org(deep_id)));
create policy "deep: analista le" on public.deep_pendencias
  for select to authenticated using (public.tem_permissao('deep.conduzir', public.deep_org(deep_id)));
create policy "deep: analista ou ADM do cliente le publicado" on public.deep_relatorios
  for select to authenticated using (
    public.tem_permissao('deep.conduzir', public.deep_org(deep_id))
    or (publicado_em is not null and public.tem_permissao('deep.relatorio_ver', public.deep_org(deep_id)))
  );
