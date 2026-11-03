-- Fase 7b.2: conversa do Self assessment com o agente (LLM).
--
-- Princípios:
-- 1. A conversa é do titular: só ele lê (nem a empresa nem o admin), porque
--    pode ter detalhes da operação que ele não marcou como resposta.
-- 2. Escrever é só do servidor (service_role), depois de autorizar com a
--    sessão do usuário. O navegador nunca grava a conversa: assim ninguém
--    forja falas do agente para manipular o histórico que vai ao LLM.
-- 3. Custo tem teto no banco: cada mensagem do usuário reserva um turno antes
--    de chamar o LLM, e passou de 60 turnos o banco recusa. O servidor não
--    consegue gastar além disso nem com bug.
-- 4. Retenção de 90 dias a partir do início (decisão de 03/11/2026). O
--    resultado e as respostas estruturadas ficam; só a transcrição expira.
-- 5. As respostas estruturadas continuam em assessments.respostas; a
--    conversa nunca entra no cálculo.

create table public.assessment_conversas (
  assessment_id uuid primary key references public.assessments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  mensagens jsonb not null default '[]'::jsonb,
  turnos_usuario integer not null default 0 check (turnos_usuario >= 0),
  tokens_entrada bigint not null default 0 check (tokens_entrada >= 0),
  tokens_saida bigint not null default 0 check (tokens_saida >= 0),
  tokens_cache_leitura bigint not null default 0 check (tokens_cache_leitura >= 0),
  tokens_cache_escrita bigint not null default 0 check (tokens_cache_escrita >= 0),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '90 days',
  constraint assessment_conversas_lista check (jsonb_typeof(mensagens) = 'array'),
  -- 60 turnos com respostas curtas cabem com folga em 1 MB.
  constraint assessment_conversas_tamanho check (octet_length(mensagens::text) <= 1048576)
);

create index assessment_conversas_expira_idx on public.assessment_conversas (expira_em);

create trigger assessment_conversas_tocar_atualizado before update on public.assessment_conversas
  for each row execute function public.tocar_atualizado_em();

-- Teto de turnos do usuário por assessment (decisão de 03/11/2026).
create function public.conversa_max_turnos()
returns integer
language sql
immutable
set search_path = ''
as $$ select 60 $$;

/*
  conversa_reservar_turno: antes de chamar o LLM, o servidor reserva um turno.
  Confere dono, rascunho e conta ativa; cria a conversa na primeira vez; apaga
  e recomeça se a anterior expirou; recusa acima do teto. Devolve o histórico.
*/
create function public.conversa_reservar_turno(p_assessment uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mensagens jsonb;
  v_turnos integer;
begin
  perform 1 from public.assessments a
  join public.profiles p on p.id = a.user_id and p.status = 'ativo'
  where a.id = p_assessment and a.user_id = p_user and a.status = 'rascunho'
  for update of a;
  if not found then
    raise exception 'assessment não está em rascunho' using errcode = 'check_violation';
  end if;

  delete from public.assessment_conversas where assessment_id = p_assessment and expira_em <= now();
  insert into public.assessment_conversas (assessment_id, user_id) values (p_assessment, p_user)
  on conflict (assessment_id) do nothing;

  select c.mensagens, c.turnos_usuario into v_mensagens, v_turnos
  from public.assessment_conversas c where c.assessment_id = p_assessment for update;
  if v_turnos >= public.conversa_max_turnos() then
    raise exception 'limite de mensagens da conversa atingido' using errcode = 'check_violation';
  end if;

  update public.assessment_conversas set turnos_usuario = turnos_usuario + 1 where assessment_id = p_assessment;
  return v_mensagens;
end;
$$;

/*
  conversa_gravar: grava o histórico depois da resposta do LLM e soma o uso.
  O histórico só cresce (nunca reescreve o que já foi dito) e o uso só soma.
*/
create function public.conversa_gravar(
  p_assessment uuid,
  p_user uuid,
  p_mensagens jsonb,
  p_tokens_entrada bigint,
  p_tokens_saida bigint,
  p_tokens_cache_leitura bigint,
  p_tokens_cache_escrita bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(p_mensagens) is distinct from 'array'
     or least(p_tokens_entrada, p_tokens_saida, p_tokens_cache_leitura, p_tokens_cache_escrita) < 0 then
    raise exception 'dados da conversa inválidos' using errcode = 'check_violation';
  end if;
  update public.assessment_conversas c
  set mensagens = p_mensagens,
      tokens_entrada = c.tokens_entrada + p_tokens_entrada,
      tokens_saida = c.tokens_saida + p_tokens_saida,
      tokens_cache_leitura = c.tokens_cache_leitura + p_tokens_cache_leitura,
      tokens_cache_escrita = c.tokens_cache_escrita + p_tokens_cache_escrita
  where c.assessment_id = p_assessment and c.user_id = p_user
    and jsonb_array_length(p_mensagens) >= jsonb_array_length(c.mensagens)
    -- O começo do histórico novo precisa ser igual ao gravado.
    and coalesce((
          select jsonb_agg(e.valor order by e.i)
          from jsonb_array_elements(p_mensagens) with ordinality as e(valor, i)
          where e.i <= jsonb_array_length(c.mensagens)
        ), '[]'::jsonb) = c.mensagens
    and exists (select 1 from public.assessments a where a.id = p_assessment and a.status = 'rascunho');
  if not found then
    raise exception 'conversa não encontrada, encerrada ou histórico reescrito' using errcode = 'check_violation';
  end if;
end;
$$;

-- Limpeza das conversas expiradas. Com pg_cron ligado no Supabase, roda todo
-- dia (ver docs/seguranca.md); sem ele, a reserva de turno já apaga a vencida.
create function public.conversas_apagar_expiradas()
returns integer
language sql
security definer
set search_path = ''
as $$
  with apagadas as (
    delete from public.assessment_conversas where expira_em <= now() returning 1
  )
  select count(*)::integer from apagadas;
$$;

-- --------------------------------------------------------------- privilégios

revoke execute on function public.conversa_max_turnos() from public, anon;
grant execute on function public.conversa_max_turnos() to authenticated;
revoke execute on function public.conversa_reservar_turno(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.conversa_gravar(uuid, uuid, jsonb, bigint, bigint, bigint, bigint) from public, anon, authenticated;
revoke execute on function public.conversas_apagar_expiradas() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.conversa_reservar_turno(uuid, uuid) to service_role;
    grant execute on function public.conversa_gravar(uuid, uuid, jsonb, bigint, bigint, bigint, bigint) to service_role;
    grant execute on function public.conversas_apagar_expiradas() to service_role;
  end if;
end $$;

-- -------------------------------------------------------------------- RLS

alter table public.assessment_conversas enable row level security;
revoke all on public.assessment_conversas from anon, authenticated;
grant select on public.assessment_conversas to authenticated;

create policy "conversa: só o titular le" on public.assessment_conversas
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Exportação LGPD passa a levar a conversa de cada assessment do titular.
create or replace function public.meus_dados()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'gerado_em', now(),
    'conta', (
      select jsonb_build_object(
        'id', u.id, 'email', u.email, 'criada_em', u.created_at,
        'email_confirmado_em', u.email_confirmed_at, 'ultimo_acesso', u.last_sign_in_at,
        'provedores', coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb)
      )
      from auth.users u where u.id = auth.uid()
    ),
    'perfil', (
      select jsonb_build_object(
        'nome', p.nome, 'status', p.status,
        'aceite_termos_versao', p.aceite_termos_versao, 'aceite_termos_em', p.aceite_termos_em,
        'aceite_marketing', p.aceite_marketing, 'criado_em', p.created_at, 'atualizado_em', p.updated_at
      )
      from public.profiles p where p.id = auth.uid()
    ),
    'papeis', coalesce((
      select jsonb_agg(jsonb_build_object('papel', ur.role, 'desde', ur.concedido_em))
      from public.user_roles ur where ur.user_id = auth.uid()
    ), '[]'::jsonb),
    'empresas', coalesce((
      select jsonb_agg(jsonb_build_object('empresa', o.nome, 'papel', m.role, 'desde', m.created_at))
      from public.memberships m join public.organizations o on o.id = m.org_id
      where m.user_id = auth.uid()
    ), '[]'::jsonb),
    'convites_recebidos', coalesce((
      select jsonb_agg(jsonb_build_object('empresa', o.nome, 'criado_em', c.criado_em,
                                          'aceito_em', c.aceito_em, 'cancelado_em', c.cancelado_em))
      from public.convites c join public.organizations o on o.id = c.org_id
      where c.email = public.meu_email_confirmado()
    ), '[]'::jsonb),
    'solicitacoes_lgpd', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', s.tipo, 'status', s.status,
                                          'criado_em', s.criado_em, 'concluido_em', s.concluido_em))
      from public.solicitacoes_lgpd s where s.user_id = auth.uid()
    ), '[]'::jsonb),
    'acessos_a_produtos', coalesce((
      select jsonb_agg(jsonb_build_object('produto', d.produto, 'origem', d.origem,
                                          'concedido_em', d.concedido_em, 'revogado_em', d.revogado_em))
      from public.direitos d where d.user_id = auth.uid()
    ), '[]'::jsonb),
    'assessments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tipo', a.tipo, 'setor', a.setor, 'status', a.status, 'empresa', a.empresa, 'criado_em', a.criado_em,
        'concluido_em', a.concluido_em, 'respostas', a.respostas,
        'conversa', (
          select jsonb_build_object('mensagens', c.mensagens, 'criada_em', c.criado_em, 'expira_em', c.expira_em)
          from public.assessment_conversas c where c.assessment_id = a.id and c.user_id = auth.uid()
        ),
        'resultados', coalesce((
          select jsonb_agg(jsonb_build_object('calculado_em', r.criado_em, 'motor', r.motor_versao,
                                              'resultado', r.resultado) order by r.criado_em)
          from public.assessment_resultados r where r.assessment_id = a.id
        ), '[]'::jsonb)
      ) order by a.criado_em)
      from public.assessments a where a.user_id = auth.uid()
    ), '[]'::jsonb)
  )
  where auth.uid() is not null;
$$;
