-- Escuta no Self assessment (decisão do Terrani, 20/11/2026): o cliente pode
-- ligar, de forma opcional, o áudio na conversa do Self. Dois usos:
-- - pergunta a pergunta: a pessoa responde falando em vez de digitar; o texto
--   transcrito vira a mensagem dela na conversa (nada fica nestas tabelas além
--   do consentimento e da cota de minutos);
-- - fluido (e "ambos"): escuta contínua de uma reunião da equipe; a fala chega
--   em blocos e o agente tira dela as respostas do Self.
-- O agente só escuta e escreve na tela (não fala). Esta migração é só o banco.
--
-- Princípios:
-- 1. Começa desligada. Ligar exige consentimento registrado (texto lido e
--    quantas pessoas estavam presentes) e o consentimento vale por 8 horas: uma
--    reunião. Depois disso a escuta para até alguém consentir de novo.
-- 2. Escrever é só do servidor (service_role). Cada função recebe quem pediu e
--    o nível de MFA e confere de novo: pode editar o rascunho e tem direito ao
--    Self. O navegador só lê o que é dele (RLS).
-- 3. Tudo é de quem ligou a escuta (assessment + pessoa): no assessment da
--    empresa, a transcrição de uma pessoa não aparece para os colegas, como a
--    conversa (20261103100000_assessment_conversas.sql).
-- 4. Custo tem teto no banco: o servidor reserva minutos de áudio antes de
--    emitir o token de transcrição (240 por pessoa e assessment) e o banco
--    recusa blocos acima de 3000.
-- 5. A origem da resposta (escuta) é registrada pelo servidor, nunca pelo
--    modelo, junto do valor gravado: se alguém editar depois, o relatório vê
--    que o valor atual já não é o ouvido.
-- 6. Resposta com pouca certeza não entra no rascunho: fica "a confirmar" e o
--    Self não conclui enquanto houver item pendente.
-- 7. Transcrição segue a retenção da conversa (90 dias). Consentimentos e a
--    lista "a confirmar" (sem o trecho) ficam como prova.
-- 8. O servidor mascara CPF, CNPJ, cartão e dados bancários antes de gravar o
--    bloco; o banco não vê o dado original.

-- --------------------------------------------------------------- tabelas

-- Estado da escuta de uma pessoa num assessment.
create table public.self_escuta (
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  modo text not null default 'desligada' check (modo in ('desligada', 'pergunta', 'fluido', 'ambos')),
  consentida_em timestamptz,
  minutos_reservados integer not null default 0 check (minutos_reservados >= 0),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (assessment_id, user_id),
  constraint self_escuta_coerente check (modo = 'desligada' or consentida_em is not null)
);
create index self_escuta_user_idx on public.self_escuta (user_id);
create trigger self_escuta_tocar_atualizado before update on public.self_escuta
  for each row execute function public.tocar_atualizado_em();

-- Consentimento: qual texto foi lido e quantas pessoas estavam presentes.
-- Sem nomes: no Self quem responde é a própria empresa.
create table public.self_escuta_consentimentos (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  texto_versao text not null check (texto_versao ~ '^[a-z0-9][a-z0-9_.@-]{0,39}$'),
  pessoas integer not null check (pessoas between 1 and 30),
  criado_em timestamptz not null default now()
);
create index self_escuta_consentimentos_assessment_idx on public.self_escuta_consentimentos (assessment_id);
create index self_escuta_consentimentos_user_idx on public.self_escuta_consentimentos (user_id);

-- Blocos transcritos (modo fluido e ambos). "sala" é o microfone; "remoto" é o
-- áudio da aba (quem está na videochamada).
create table public.self_escuta_blocos (
  id bigint generated always as identity primary key,
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seq integer not null check (seq > 0),
  canal text not null check (canal in ('sala', 'remoto')),
  texto text not null check (char_length(texto) between 1 and 4000),
  inicio_ms bigint check (inicio_ms >= 0),
  fim_ms bigint check (fim_ms >= 0),
  processado_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (assessment_id, user_id, seq),
  constraint self_escuta_blocos_tempo check (inicio_ms is null or fim_ms is null or fim_ms >= inicio_ms)
);
create index self_escuta_blocos_user_idx on public.self_escuta_blocos (user_id);
create index self_escuta_blocos_pendentes_idx on public.self_escuta_blocos (assessment_id, user_id, seq)
  where processado_em is null;
create index self_escuta_blocos_criado_idx on public.self_escuta_blocos (criado_em);

-- Respostas ouvidas com pouca certeza: esperam a pessoa confirmar.
create table public.self_escuta_confirmar (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  pergunta_id text not null check (pergunta_id ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  valor jsonb not null check (octet_length(valor::text) <= 16384),
  motivo text not null check (char_length(motivo) between 1 and 300),
  -- Trecho literal ouvido; sai junto com a transcrição (retenção).
  trecho text check (char_length(trecho) <= 500),
  status text not null default 'pendente' check (status in ('pendente', 'confirmada', 'descartada')),
  fechada_em timestamptz,
  criado_em timestamptz not null default now(),
  constraint self_escuta_confirmar_fechamento check ((status = 'pendente') = (fechada_em is null))
);
-- Uma proposta pendente por pergunta e assessment: a mais nova substitui.
create unique index self_escuta_confirmar_pendente_unica on public.self_escuta_confirmar (assessment_id, pergunta_id)
  where status = 'pendente';
create index self_escuta_confirmar_user_idx on public.self_escuta_confirmar (user_id);
create index self_escuta_confirmar_criado_idx on public.self_escuta_confirmar (criado_em) where trecho is not null;

-- Origem das respostas gravadas pela escuta (a ausência quer dizer digitada).
create table public.self_respostas_origem (
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  pergunta_id text not null check (pergunta_id ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  origem text not null check (origem in ('escuta', 'escuta_confirmada')),
  -- Valor gravado naquele momento: se for diferente do atual, foi editado depois.
  valor jsonb not null check (octet_length(valor::text) <= 16384),
  user_id uuid references public.profiles (id) on delete set null,
  registrado_em timestamptz not null default now(),
  primary key (assessment_id, pergunta_id)
);
create index self_respostas_origem_user_idx on public.self_respostas_origem (user_id);

-- ------------------------------------------------------- registros imutáveis

-- Consentimento: só inserção. Pode perder o vínculo com a conta excluída e
-- some junto com o assessment (cascata).
create function public.self_escuta_consentimento_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is null and (to_jsonb(new) - 'user_id') = (to_jsonb(old) - 'user_id') then
    return new;
  end if;
  raise exception 'consentimento da escuta é somente inserção' using errcode = 'insufficient_privilege';
end;
$$;
create trigger self_escuta_consentimentos_sem_mudanca before update on public.self_escuta_consentimentos
  for each row execute function public.self_escuta_consentimento_imutavel();

-- Bloco: o texto não muda; a única mudança é ser marcado como processado.
create function public.self_escuta_bloco_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.processado_em is null and new.processado_em is not null
     and (to_jsonb(new) - 'processado_em') = (to_jsonb(old) - 'processado_em') then
    return new;
  end if;
  raise exception 'bloco da escuta não pode ser alterado' using errcode = 'insufficient_privilege';
end;
$$;
create trigger self_escuta_blocos_sem_mudanca before update on public.self_escuta_blocos
  for each row execute function public.self_escuta_bloco_imutavel();

-- Item a confirmar: só fecha uma vez; o trecho só pode ser apagado (retenção).
create function public.self_escuta_confirmar_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'status' - 'fechada_em' - 'trecho') = (to_jsonb(old) - 'status' - 'fechada_em' - 'trecho')
     and (new.trecho is not distinct from old.trecho or new.trecho is null)
     and (
       (new.status = old.status and new.fechada_em is not distinct from old.fechada_em)
       or (old.status = 'pendente' and new.status in ('confirmada', 'descartada'))
     ) then
    return new;
  end if;
  raise exception 'item a confirmar não pode ser alterado assim' using errcode = 'insufficient_privilege';
end;
$$;
create trigger self_escuta_confirmar_sem_mudanca before update on public.self_escuta_confirmar
  for each row execute function public.self_escuta_confirmar_imutavel();

-- O Self não conclui com resposta ouvida esperando confirmação.
create function public.self_escuta_bloquear_conclusao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'rascunho' and new.status = 'concluido'
     and exists (select 1 from public.self_escuta_confirmar c where c.assessment_id = new.id and c.status = 'pendente') then
    raise exception 'há respostas ouvidas a confirmar' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger assessments_escuta_pendente before update of status on public.assessments
  for each row execute function public.self_escuta_bloquear_conclusao();

-- ------------------------------------------------------------------ apoio

create function public.self_escuta_max_minutos()
returns integer language sql immutable set search_path = '' as $$ select 240 $$;
create function public.self_escuta_max_blocos()
returns integer language sql immutable set search_path = '' as $$ select 3000 $$;
create function public.self_escuta_validade_consentimento()
returns interval language sql immutable set search_path = '' as $$ select interval '8 hours' $$;

/*
  A pessoa pode usar a escuta neste assessment? Pode editar o rascunho (mesma
  regra do navegador, com o MFA informado pelo servidor) e tem direito ao Self
  (pessoal ou da empresa de que participa), como tem_direito, mas para p_user.
*/
create function public.self_escuta_pode(p_assessment uuid, p_user uuid, p_aal2 boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.pode_editar_assessment(p_assessment, p_user, p_aal2)
    and exists (
      select 1
      from public.assessments a
      join public.profiles p on p.id = p_user and p.status = 'ativo'
      join public.direitos d on d.produto = 'self_assessment'
        and d.revogado_em is null
        and (d.valido_ate is null or d.valido_ate > now())
      where a.id = p_assessment
        and (
          d.user_id = p_user
          or (a.org_id is not null and d.org_id = a.org_id
              and exists (select 1 from public.memberships m where m.org_id = a.org_id and m.user_id = p_user))
        )
    );
$$;

-- Confere o acesso e devolve o estado da escuta travado (ou erro).
create function public.self_escuta_travar(p_assessment uuid, p_user uuid, p_aal2 boolean)
returns public.self_escuta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.self_escuta;
begin
  if p_assessment is null or p_user is null or not public.self_escuta_pode(p_assessment, p_user, coalesce(p_aal2, false)) then
    raise exception 'sem acesso à escuta deste assessment' using errcode = 'insufficient_privilege';
  end if;
  insert into public.self_escuta (assessment_id, user_id) values (p_assessment, p_user)
  on conflict (assessment_id, user_id) do nothing;
  select * into v from public.self_escuta e where e.assessment_id = p_assessment and e.user_id = p_user for update;
  return v;
end;
$$;

-- Escuta ligada e consentimento dentro da validade.
create function public.self_escuta_ativa(v public.self_escuta)
returns boolean
language sql
stable
set search_path = ''
as $$
  select v.modo <> 'desligada' and v.consentida_em is not null
    and v.consentida_em > now() - public.self_escuta_validade_consentimento();
$$;

create function public.self_escuta_auditar(p_user uuid, p_acao text, p_assessment uuid, p_dados jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (ator, acao, tabela, alvo, dados)
  values (p_user, p_acao, 'self_escuta', p_assessment::text, p_dados);
$$;

-- --------------------------------------------------- operações do servidor

/*
  self_escuta_consentir: registra que o texto foi lido e aceito pelas pessoas
  presentes. Não liga nada sozinho: o modo é escolhido em self_escuta_definir.
*/
create function public.self_escuta_consentir(
  p_assessment uuid, p_user uuid, p_aal2 boolean, p_texto_versao text, p_pessoas integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.self_escuta_travar(p_assessment, p_user, p_aal2);
  insert into public.self_escuta_consentimentos (assessment_id, user_id, texto_versao, pessoas)
  values (p_assessment, p_user, p_texto_versao, p_pessoas);
  update public.self_escuta set consentida_em = now() where assessment_id = p_assessment and user_id = p_user;
  perform public.self_escuta_auditar(p_user, 'self.escuta.consentimento', p_assessment,
    jsonb_build_object('texto_versao', p_texto_versao, 'pessoas', p_pessoas));
end;
$$;

-- Liga, troca ou desliga. Desligar sempre pode; ligar exige consentimento vigente.
create function public.self_escuta_definir(p_assessment uuid, p_user uuid, p_aal2 boolean, p_modo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.self_escuta;
begin
  if p_modo is null or p_modo not in ('desligada', 'pergunta', 'fluido', 'ambos') then
    raise exception 'modo de escuta inválido' using errcode = 'check_violation';
  end if;
  v := public.self_escuta_travar(p_assessment, p_user, p_aal2);
  if p_modo <> 'desligada' and (v.consentida_em is null
       or v.consentida_em <= now() - public.self_escuta_validade_consentimento()) then
    raise exception 'escuta sem consentimento vigente' using errcode = 'check_violation';
  end if;
  if v.modo = p_modo then
    return;
  end if;
  update public.self_escuta set modo = p_modo where assessment_id = p_assessment and user_id = p_user;
  perform public.self_escuta_auditar(p_user, 'self.escuta.modo', p_assessment,
    jsonb_build_object('de', v.modo, 'para', p_modo));
end;
$$;

/*
  Reserva minutos de áudio antes de o servidor emitir um token de transcrição.
  Devolve quantos minutos ainda restam depois desta reserva.
*/
create function public.self_escuta_reservar_minutos(p_assessment uuid, p_user uuid, p_aal2 boolean, p_minutos integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.self_escuta;
begin
  if p_minutos is null or p_minutos not between 1 and 30 then
    raise exception 'reserva de minutos inválida' using errcode = 'check_violation';
  end if;
  v := public.self_escuta_travar(p_assessment, p_user, p_aal2);
  if not public.self_escuta_ativa(v) then
    raise exception 'escuta desligada ou sem consentimento vigente' using errcode = 'check_violation';
  end if;
  if v.minutos_reservados + p_minutos > public.self_escuta_max_minutos() then
    raise exception 'limite de minutos de áudio atingido' using errcode = 'check_violation';
  end if;
  update public.self_escuta set minutos_reservados = minutos_reservados + p_minutos
  where assessment_id = p_assessment and user_id = p_user;
  return public.self_escuta_max_minutos() - v.minutos_reservados - p_minutos;
end;
$$;

/*
  Grava até 20 blocos por chamada (modo fluido ou ambos). Reenviar o mesmo
  seq é seguro: o repetido é ignorado. Só as chaves conhecidas são aceitas.
*/
create function public.self_escuta_gravar_blocos(p_assessment uuid, p_user uuid, p_aal2 boolean, p_blocos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.self_escuta;
  b jsonb;
  v_total integer;
  v_gravados integer := 0;
  v_n integer;
begin
  if jsonb_typeof(p_blocos) is distinct from 'array' or jsonb_array_length(p_blocos) not between 1 and 20 then
    raise exception 'mande de 1 a 20 blocos' using errcode = 'check_violation';
  end if;
  v := public.self_escuta_travar(p_assessment, p_user, p_aal2);
  if not public.self_escuta_ativa(v) or v.modo not in ('fluido', 'ambos') then
    raise exception 'escuta contínua desligada ou sem consentimento vigente' using errcode = 'check_violation';
  end if;
  select count(*) into v_total from public.self_escuta_blocos where assessment_id = p_assessment and user_id = p_user;
  if v_total + jsonb_array_length(p_blocos) > public.self_escuta_max_blocos() then
    raise exception 'limite de blocos da escuta atingido' using errcode = 'check_violation';
  end if;
  for b in select * from jsonb_array_elements(p_blocos) loop
    if jsonb_typeof(b) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(b) k where k not in ('seq', 'canal', 'texto', 'inicio_ms', 'fim_ms')) then
      raise exception 'bloco com formato inválido' using errcode = 'check_violation';
    end if;
    insert into public.self_escuta_blocos (assessment_id, user_id, seq, canal, texto, inicio_ms, fim_ms)
    values (p_assessment, p_user, (b ->> 'seq')::integer, b ->> 'canal', b ->> 'texto',
            (b ->> 'inicio_ms')::bigint, (b ->> 'fim_ms')::bigint)
    on conflict (assessment_id, user_id, seq) do nothing;
    get diagnostics v_n = row_count;
    v_gravados := v_gravados + v_n;
  end loop;
  return jsonb_build_object('gravados', v_gravados, 'repetidos', jsonb_array_length(p_blocos) - v_gravados);
end;
$$;

-- Blocos ainda não processados pelo agente, em ordem (até 40).
create function public.self_escuta_pendentes(p_assessment uuid, p_user uuid, p_aal2 boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.self_escuta_travar(p_assessment, p_user, p_aal2);
  return coalesce((
    select jsonb_agg(jsonb_build_object('seq', x.seq, 'canal', x.canal, 'texto', x.texto,
                                        'inicio_ms', x.inicio_ms, 'fim_ms', x.fim_ms) order by x.seq)
    from (
      select b.seq, b.canal, b.texto, b.inicio_ms, b.fim_ms from public.self_escuta_blocos b
      where b.assessment_id = p_assessment and b.user_id = p_user and b.processado_em is null
      order by b.seq limit 40
    ) x
  ), '[]'::jsonb);
end;
$$;

create function public.self_escuta_marcar_processados(p_assessment uuid, p_user uuid, p_aal2 boolean, p_seqs integer[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_seqs is null or cardinality(p_seqs) not between 1 and 40 then
    raise exception 'mande de 1 a 40 blocos' using errcode = 'check_violation';
  end if;
  perform public.self_escuta_travar(p_assessment, p_user, p_aal2);
  update public.self_escuta_blocos set processado_em = now()
  where assessment_id = p_assessment and user_id = p_user and seq = any (p_seqs) and processado_em is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

/*
  Registra que estas respostas foram gravadas pela escuta (o servidor grava o
  rascunho com a sessão da pessoa e chama esta função logo depois).
*/
create function public.self_escuta_registrar_origem(
  p_assessment uuid, p_user uuid, p_aal2 boolean, p_itens jsonb, p_origem text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  i jsonb;
begin
  if p_origem is null or p_origem not in ('escuta', 'escuta_confirmada') then
    raise exception 'origem inválida' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) not between 1 and 50 then
    raise exception 'mande de 1 a 50 itens' using errcode = 'check_violation';
  end if;
  perform public.self_escuta_travar(p_assessment, p_user, p_aal2);
  for i in select * from jsonb_array_elements(p_itens) loop
    if jsonb_typeof(i) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(i) k where k not in ('pergunta_id', 'valor'))
       or not (i ? 'valor') then
      raise exception 'item com formato inválido' using errcode = 'check_violation';
    end if;
    insert into public.self_respostas_origem (assessment_id, pergunta_id, origem, valor, user_id)
    values (p_assessment, i ->> 'pergunta_id', p_origem, i -> 'valor', p_user)
    on conflict (assessment_id, pergunta_id) do update
      set origem = excluded.origem, valor = excluded.valor, user_id = excluded.user_id, registrado_em = now();
  end loop;
  return jsonb_array_length(p_itens);
end;
$$;

-- Guarda respostas ouvidas com pouca certeza (a mais nova substitui a pendente).
create function public.self_escuta_propor(p_assessment uuid, p_user uuid, p_aal2 boolean, p_itens jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.self_escuta;
  i jsonb;
begin
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) not between 1 and 50 then
    raise exception 'mande de 1 a 50 itens' using errcode = 'check_violation';
  end if;
  v := public.self_escuta_travar(p_assessment, p_user, p_aal2);
  if not public.self_escuta_ativa(v) then
    raise exception 'escuta desligada ou sem consentimento vigente' using errcode = 'check_violation';
  end if;
  for i in select * from jsonb_array_elements(p_itens) loop
    if jsonb_typeof(i) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(i) k where k not in ('pergunta_id', 'valor', 'motivo', 'trecho'))
       or not (i ? 'valor') then
      raise exception 'item com formato inválido' using errcode = 'check_violation';
    end if;
    update public.self_escuta_confirmar set status = 'descartada', fechada_em = now()
    where assessment_id = p_assessment and pergunta_id = i ->> 'pergunta_id' and status = 'pendente';
    insert into public.self_escuta_confirmar (assessment_id, user_id, pergunta_id, valor, motivo, trecho)
    values (p_assessment, p_user, i ->> 'pergunta_id', i -> 'valor', i ->> 'motivo', i ->> 'trecho');
  end loop;
  if (select count(*) from public.self_escuta_confirmar where assessment_id = p_assessment and status = 'pendente') > 200 then
    raise exception 'itens a confirmar demais' using errcode = 'check_violation';
  end if;
  return jsonb_array_length(p_itens);
end;
$$;

/*
  Fecha um item a confirmar. Só quem ligou a escuta resolve (a lista é dela).
  Confirmar devolve pergunta e valor: o servidor grava no rascunho e registra
  a origem "escuta_confirmada".
*/
create function public.self_escuta_resolver(p_item uuid, p_decisao text, p_user uuid, p_aal2 boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.self_escuta_confirmar;
begin
  if p_decisao is null or p_decisao not in ('confirmar', 'descartar') then
    raise exception 'decisão inválida' using errcode = 'check_violation';
  end if;
  select * into c from public.self_escuta_confirmar where id = p_item for update;
  if not found or c.user_id is distinct from p_user then
    raise exception 'item não encontrado' using errcode = 'insufficient_privilege';
  end if;
  perform public.self_escuta_travar(c.assessment_id, p_user, p_aal2);
  if c.status <> 'pendente' then
    raise exception 'item já resolvido' using errcode = 'check_violation';
  end if;
  update public.self_escuta_confirmar
  set status = case when p_decisao = 'confirmar' then 'confirmada' else 'descartada' end, fechada_em = now()
  where id = p_item;
  return jsonb_build_object('assessment_id', c.assessment_id, 'pergunta_id', c.pergunta_id, 'valor', c.valor,
                            'decisao', p_decisao);
end;
$$;

-- Estado para a tela e o agente: modo, validade do consentimento, minutos e a lista a confirmar.
create function public.self_escuta_estado(p_assessment uuid, p_user uuid, p_aal2 boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.self_escuta;
begin
  v := public.self_escuta_travar(p_assessment, p_user, p_aal2);
  return jsonb_build_object(
    'modo', case when public.self_escuta_ativa(v) then v.modo else 'desligada' end,
    'consentimento_valido_ate', v.consentida_em + public.self_escuta_validade_consentimento(),
    'minutos_restantes', public.self_escuta_max_minutos() - v.minutos_reservados,
    'a_confirmar', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'pergunta_id', c.pergunta_id, 'valor', c.valor,
                                          'motivo', c.motivo, 'trecho', c.trecho) order by c.criado_em)
      from public.self_escuta_confirmar c
      where c.assessment_id = p_assessment and c.user_id = p_user and c.status = 'pendente'
    ), '[]'::jsonb)
  );
end;
$$;

-- Retenção: transcrição sai em 90 dias, como a conversa. Roda com pg_cron.
create function public.self_escuta_apagar_expiradas()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from public.self_escuta_blocos where criado_em <= now() - interval '90 days';
  get diagnostics v_n = row_count;
  update public.self_escuta_confirmar set trecho = null
  where trecho is not null and criado_em <= now() - interval '90 days';
  return v_n;
end;
$$;

-- --------------------------------------------------------------- privilégios

do $$
declare f text;
begin
  foreach f in array array[
    'self_escuta_max_minutos()', 'self_escuta_max_blocos()', 'self_escuta_validade_consentimento()',
    'self_escuta_pode(uuid, uuid, boolean)', 'self_escuta_travar(uuid, uuid, boolean)',
    'self_escuta_ativa(public.self_escuta)', 'self_escuta_auditar(uuid, text, uuid, jsonb)',
    'self_escuta_consentir(uuid, uuid, boolean, text, integer)', 'self_escuta_definir(uuid, uuid, boolean, text)',
    'self_escuta_reservar_minutos(uuid, uuid, boolean, integer)', 'self_escuta_gravar_blocos(uuid, uuid, boolean, jsonb)',
    'self_escuta_pendentes(uuid, uuid, boolean)', 'self_escuta_marcar_processados(uuid, uuid, boolean, integer[])',
    'self_escuta_registrar_origem(uuid, uuid, boolean, jsonb, text)', 'self_escuta_propor(uuid, uuid, boolean, jsonb)',
    'self_escuta_resolver(uuid, text, uuid, boolean)', 'self_escuta_estado(uuid, uuid, boolean)',
    'self_escuta_apagar_expiradas()', 'self_escuta_consentimento_imutavel()', 'self_escuta_bloco_imutavel()',
    'self_escuta_confirmar_imutavel()', 'self_escuta_bloquear_conclusao()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

do $$
declare f text;
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    foreach f in array array[
      'self_escuta_consentir(uuid, uuid, boolean, text, integer)', 'self_escuta_definir(uuid, uuid, boolean, text)',
      'self_escuta_reservar_minutos(uuid, uuid, boolean, integer)', 'self_escuta_gravar_blocos(uuid, uuid, boolean, jsonb)',
      'self_escuta_pendentes(uuid, uuid, boolean)', 'self_escuta_marcar_processados(uuid, uuid, boolean, integer[])',
      'self_escuta_registrar_origem(uuid, uuid, boolean, jsonb, text)', 'self_escuta_propor(uuid, uuid, boolean, jsonb)',
      'self_escuta_resolver(uuid, text, uuid, boolean)', 'self_escuta_estado(uuid, uuid, boolean)',
      'self_escuta_apagar_expiradas()'
    ] loop
      execute format('grant execute on function public.%s to service_role', f);
    end loop;
  end if;
end $$;

-- -------------------------------------------------------------------- RLS

alter table public.self_escuta enable row level security;
alter table public.self_escuta_consentimentos enable row level security;
alter table public.self_escuta_blocos enable row level security;
alter table public.self_escuta_confirmar enable row level security;
alter table public.self_respostas_origem enable row level security;

revoke all on public.self_escuta, public.self_escuta_consentimentos, public.self_escuta_blocos,
  public.self_escuta_confirmar, public.self_respostas_origem from anon, authenticated;
grant select on public.self_escuta, public.self_escuta_consentimentos, public.self_escuta_blocos,
  public.self_escuta_confirmar, public.self_respostas_origem to authenticated;

-- A escuta é de quem a ligou.
create policy "escuta: só a pessoa le" on public.self_escuta
  for select to authenticated using (user_id = (select auth.uid()));
create policy "escuta: só a pessoa le" on public.self_escuta_consentimentos
  for select to authenticated using (user_id = (select auth.uid()));
create policy "escuta: só a pessoa le" on public.self_escuta_blocos
  for select to authenticated using (user_id = (select auth.uid()));
create policy "escuta: só a pessoa le" on public.self_escuta_confirmar
  for select to authenticated using (user_id = (select auth.uid()));
-- A origem é parte da resposta: lê quem lê o assessment (RLS de assessments).
create policy "origem: quem le o assessment" on public.self_respostas_origem
  for select to authenticated
  using (exists (select 1 from public.assessments a where a.id = assessment_id));
