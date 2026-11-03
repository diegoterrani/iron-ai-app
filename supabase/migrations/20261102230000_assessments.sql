-- Fase 7a.2: Self assessment no app (direitos, assessments, resultados).
--
-- Princípios:
-- 1. Quem pode usar o Self é DADO (tabela direitos). Hoje o super-admin libera
--    no backoffice; na fase 4 o Stripe grava a mesma tabela.
-- 2. O navegador só edita as respostas de um rascunho próprio. Setor, status e
--    resultado nunca são escritos pelo cliente.
-- 3. O resultado é calculado no servidor pelo motor determinístico e gravado
--    por concluir_self(), que só o servidor (service_role) executa. É imutável:
--    recalcular cria outra linha.
-- 4. Auditoria registra liberação de acesso, início e conclusão, sem copiar
--    as respostas (dado estratégico do cliente) para o audit_log.

-- ---------------------------------------------------------------- direitos

create table public.direitos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  org_id uuid references public.organizations (id) on delete cascade,
  produto text not null check (produto in ('self_assessment')),
  origem text not null default 'manual' check (origem in ('manual', 'stripe')),
  concedido_por uuid references public.profiles (id) on delete set null,
  concedido_em timestamptz not null default now(),
  valido_ate timestamptz,
  revogado_em timestamptz,
  -- Direito é de uma pessoa (B2C) ou de uma empresa (B2B), nunca dos dois.
  constraint direitos_titular check ((user_id is null) <> (org_id is null))
);

create unique index direitos_usuario_ativo on public.direitos (user_id, produto) where revogado_em is null and user_id is not null;
create unique index direitos_empresa_ativo on public.direitos (org_id, produto) where revogado_em is null and org_id is not null;

-- Auditoria com alvo = titular (pessoa ou empresa), para aparecer no
-- histórico da ficha. O registro genérico usaria o id do direito.
create function public.auditar_direito()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  antes jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  depois jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  linha jsonb := coalesce(depois, antes);
begin
  insert into public.audit_log (ator, acao, tabela, alvo, dados)
  values (
    auth.uid(),
    lower(tg_op),
    'direitos',
    coalesce(linha ->> 'user_id', linha ->> 'org_id'),
    jsonb_build_object('antes', antes, 'depois', depois)
  );
  return null;
end;
$$;

create trigger auditar_direitos after insert or update or delete on public.direitos
  for each row execute function public.auditar_direito();

/*
  tem_direito(produto, empresa): o usuário atual (conta ativa) pode usar o produto?
  Vale o direito pessoal ou, com empresa informada, o direito da empresa
  de que ele participa. Consulta a cada chamada: revogar vale na hora.
*/
create function public.tem_direito(p_produto text, p_org uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.direitos d on d.produto = p_produto
      and d.revogado_em is null
      and (d.valido_ate is null or d.valido_ate > now())
    where p.id = auth.uid()
      and p.status = 'ativo'
      and (
        d.user_id = p.id
        or (p_org is not null and d.org_id = p_org
            and exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = p.id))
      )
  );
$$;

-- -------------------------------------------------------------- assessments

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  org_id uuid references public.organizations (id) on delete set null,
  tipo text not null default 'self' check (tipo in ('self')),
  setor text not null check (setor in ('food_service')),
  status text not null default 'rascunho' check (status in ('rascunho', 'concluido')),
  respostas jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  concluido_em timestamptz,
  -- Respostas são um objeto pequeno (16 perguntas); 64 KB barra abuso.
  constraint assessments_respostas_objeto check (jsonb_typeof(respostas) = 'object'),
  constraint assessments_respostas_tamanho check (octet_length(respostas::text) <= 65536)
);

create index assessments_user_idx on public.assessments (user_id, criado_em desc);
create index assessments_org_idx on public.assessments (org_id) where org_id is not null;
-- Um rascunho por pessoa e setor: "Iniciar" retoma o que já existe.
create unique index assessments_rascunho_unico on public.assessments (user_id, tipo, setor) where status = 'rascunho';

create function public.tocar_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

create trigger assessments_tocar_atualizado before update on public.assessments
  for each row execute function public.tocar_atualizado_em();

create table public.assessment_resultados (
  id bigint generated always as identity primary key,
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  motor_versao text not null,
  modelo_versao text not null,
  pacote_versao text not null,
  hash_respostas text not null check (hash_respostas ~ '^[0-9a-f]{16}$'),
  resultado jsonb not null check (jsonb_typeof(resultado) = 'object'),
  criado_em timestamptz not null default now()
);

create index assessment_resultados_assessment_idx on public.assessment_resultados (assessment_id, criado_em desc);

-- Resultado não se altera. Apagar só acontece em cascata (exclusão LGPD da conta).
create function public.resultado_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'resultado de assessment não pode ser alterado' using errcode = 'insufficient_privilege';
end;
$$;

create trigger assessment_resultados_sem_update before update on public.assessment_resultados
  for each row execute function public.resultado_imutavel();

-- Auditoria enxuta: quem, qual assessment, status. Nunca as respostas.
create function public.auditar_assessment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return null;
  end if;
  insert into public.audit_log (ator, acao, tabela, alvo, dados)
  values (
    auth.uid(),
    case when tg_op = 'INSERT' then 'assessment_iniciado' else 'assessment_' || new.status end,
    'assessments',
    new.user_id::text,
    jsonb_build_object('assessment', new.id, 'setor', new.setor, 'org', new.org_id, 'status', new.status)
  );
  return null;
end;
$$;

create trigger auditar_assessments after insert or update on public.assessments
  for each row execute function public.auditar_assessment();

-- ----------------------------------------------------------------- operações

-- Inicia (ou retoma) o Self do usuário atual. Exige conta ativa e direito;
-- em nome de empresa, exige também a permissão de responder nela.
create function public.iniciar_self(p_setor text, p_org uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_setor is distinct from 'food_service' then
    raise exception 'setor ainda não disponível' using errcode = 'check_violation';
  end if;
  if not public.tem_direito('self_assessment', p_org) then
    raise exception 'acesso ao Self assessment não liberado' using errcode = 'insufficient_privilege';
  end if;
  if p_org is not null and not public.tem_permissao('assessment.responder', p_org) then
    raise exception 'sem permissão para responder por esta empresa' using errcode = 'insufficient_privilege';
  end if;

  select a.id into v_id from public.assessments a
  where a.user_id = auth.uid() and a.tipo = 'self' and a.setor = p_setor and a.status = 'rascunho';
  if v_id is not null then
    return v_id;
  end if;

  insert into public.assessments (user_id, org_id, setor)
  values (auth.uid(), p_org, p_setor)
  returning id into v_id;
  return v_id;
end;
$$;

/*
  concluir_self: grava o resultado calculado pelo motor e fecha o rascunho.
  Só o servidor (service_role) executa, depois de ler as respostas com a
  sessão do usuário (RLS) e rodar o motor. O hash prova quais respostas
  geraram o número: se o rascunho mudou no meio, recusa.
*/
create function public.concluir_self(
  p_assessment uuid,
  p_user uuid,
  p_hash text,
  p_respostas jsonb,
  p_motor text,
  p_modelo text,
  p_pacote text,
  p_resultado jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform 1 from public.assessments a
  where a.id = p_assessment and a.user_id = p_user and a.status = 'rascunho'
    and a.respostas = p_respostas
  for update;
  if not found then
    raise exception 'assessment não está em rascunho ou as respostas mudaram' using errcode = 'check_violation';
  end if;

  insert into public.assessment_resultados
    (assessment_id, motor_versao, modelo_versao, pacote_versao, hash_respostas, resultado)
  values (p_assessment, p_motor, p_modelo, p_pacote, p_hash, p_resultado)
  returning id into v_id;

  update public.assessments set status = 'concluido', concluido_em = now() where id = p_assessment;
  return v_id;
end;
$$;

-- Backoffice: liberar e revogar o Self para uma pessoa.
create function public.admin_conceder_direito(p_user uuid, p_produto text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'usuário não encontrado' using errcode = 'no_data_found';
  end if;
  insert into public.direitos (user_id, produto, origem, concedido_por)
  values (p_user, p_produto, 'manual', auth.uid())
  on conflict (user_id, produto) where revogado_em is null and user_id is not null do nothing;
end;
$$;

create function public.admin_revogar_direito(p_user uuid, p_produto text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  update public.direitos set revogado_em = now()
  where user_id = p_user and produto = p_produto and revogado_em is null;
end;
$$;

-- --------------------------------------------------------------- privilégios

revoke execute on function public.tem_direito(text, uuid) from public, anon;
grant execute on function public.tem_direito(text, uuid) to authenticated;
revoke execute on function public.iniciar_self(text, uuid) from public, anon;
grant execute on function public.iniciar_self(text, uuid) to authenticated;
revoke execute on function public.concluir_self(uuid, uuid, text, jsonb, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.admin_conceder_direito(uuid, text) from public, anon;
grant execute on function public.admin_conceder_direito(uuid, text) to authenticated;
revoke execute on function public.admin_revogar_direito(uuid, text) from public, anon;
grant execute on function public.admin_revogar_direito(uuid, text) to authenticated;
revoke execute on function public.resultado_imutavel() from public, anon, authenticated;
revoke execute on function public.tocar_atualizado_em() from public, anon, authenticated;
revoke execute on function public.auditar_assessment() from public, anon, authenticated;
revoke execute on function public.auditar_direito() from public, anon, authenticated;

do $$ begin
  -- No Supabase o servidor usa service_role; nos testes locais o papel existe pelo stub.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.concluir_self(uuid, uuid, text, jsonb, text, text, text, jsonb) to service_role;
  end if;
end $$;

-- -------------------------------------------------------------------- RLS

alter table public.direitos enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_resultados enable row level security;

revoke all on public.direitos, public.assessments, public.assessment_resultados from anon, authenticated;
grant select on public.direitos, public.assessments, public.assessment_resultados to authenticated;
-- O cliente só escreve as respostas; o resto vem das funções acima.
grant update (respostas) on public.assessments to authenticated;

create policy "direitos: proprio, da empresa ou admin le" on public.direitos
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (org_id is not null and exists (
          select 1 from public.memberships m where m.org_id = direitos.org_id and m.user_id = (select auth.uid())))
    or public.e_super_admin()
  );

create policy "assessment: dono, empresa ou admin le" on public.assessments
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (org_id is not null and public.tem_permissao('assessment.ver', org_id))
    or public.e_super_admin()
  );

-- Dono com conta ativa edita as respostas enquanto é rascunho.
create policy "assessment: dono edita rascunho" on public.assessments
  for update to authenticated
  using (
    user_id = (select auth.uid()) and status = 'rascunho'
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'ativo')
  )
  with check (user_id = (select auth.uid()) and status = 'rascunho');

create policy "resultado: quem ve o assessment le" on public.assessment_resultados
  for select to authenticated
  using (exists (select 1 from public.assessments a where a.id = assessment_id));
