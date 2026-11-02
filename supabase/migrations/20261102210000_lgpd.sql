-- Fase 3c: direitos do titular (LGPD, art. 18): acesso aos dados e eliminação.
--
-- - meus_dados(): o próprio usuário baixa tudo o que guardamos sobre ele.
-- - solicitar_exclusao(): o usuário pede a eliminação da conta.
-- - O super-admin conclui o pedido no backoffice. A conta só pode ser apagada
--   se houver pedido do próprio titular (o banco recusa sem pedido).
-- - O audit_log é mantido (obrigação legal e segurança, art. 16, I): guarda o
--   id, não é apagado em cascata.

create table public.solicitacoes_lgpd (
  id uuid primary key default gen_random_uuid(),
  -- Sem FK: o registro do pedido sobrevive à exclusão da conta (prestação de contas).
  user_id uuid not null,
  tipo text not null default 'exclusao' check (tipo in ('exclusao')),
  status text not null default 'pendente' check (status in ('pendente', 'concluida', 'cancelada')),
  criado_em timestamptz not null default now(),
  concluido_em timestamptz,
  concluido_por uuid
);

create unique index solicitacoes_lgpd_pendente_unica on public.solicitacoes_lgpd (user_id, tipo)
  where status = 'pendente';

alter table public.solicitacoes_lgpd enable row level security;
revoke all on public.solicitacoes_lgpd from anon, authenticated;
grant select on public.solicitacoes_lgpd to authenticated;

create policy "lgpd: titular ou admin le" on public.solicitacoes_lgpd
  for select to authenticated
  using (user_id = (select auth.uid()) or public.e_super_admin());

create trigger auditar_solicitacoes_lgpd after insert or update or delete on public.solicitacoes_lgpd
  for each row execute function public.auditar_mudanca();

-- Tudo o que guardamos sobre o titular, num JSON só (sem segredos de Auth).
create function public.meus_dados()
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
    ), '[]'::jsonb)
  )
  where auth.uid() is not null;
$$;

create function public.solicitar_exclusao()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'acesso negado' using errcode = 'insufficient_privilege';
  end if;
  insert into public.solicitacoes_lgpd (user_id) values (auth.uid())
  on conflict (user_id, tipo) where status = 'pendente' do nothing;
end;
$$;

create function public.cancelar_solicitacao_exclusao()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.solicitacoes_lgpd set status = 'cancelada', concluido_em = now(), concluido_por = auth.uid()
  where user_id = auth.uid() and status = 'pendente';
end;
$$;

-- Backoffice: lista de pedidos com nome e e-mail (enquanto a conta existir).
create function public.admin_listar_solicitacoes_lgpd()
returns table (id uuid, user_id uuid, nome text, email text, tipo text, status text, criado_em timestamptz, concluido_em timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_super_admin();
  return query
    select s.id, s.user_id, p.nome, u.email::text, s.tipo, s.status, s.criado_em, s.concluido_em
    from public.solicitacoes_lgpd s
    left join public.profiles p on p.id = s.user_id
    left join auth.users u on u.id = s.user_id
    order by (s.status = 'pendente') desc, s.criado_em desc
    limit 200;
end;
$$;

/*
  Passo 1 da exclusão: o banco autoriza e devolve o id da conta.
  Só com pedido pendente do próprio titular; nunca a própria conta do admin
  nem outro super-admin (esses saem por SQL, com revisão).
  O servidor então apaga a conta no Auth (chave secreta) e chama o passo 2.
*/
create function public.admin_autorizar_exclusao(p_solicitacao uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  alvo uuid;
begin
  perform public.exigir_super_admin();
  select s.user_id into alvo from public.solicitacoes_lgpd s
  where s.id = p_solicitacao and s.status = 'pendente' and s.tipo = 'exclusao';
  if alvo is null then
    raise exception 'pedido não encontrado ou já concluído' using errcode = 'no_data_found';
  end if;
  if alvo = auth.uid() then
    raise exception 'não é permitido excluir a própria conta pela tela' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.user_roles where user_id = alvo and role = 'super_admin') then
    raise exception 'conta de super-admin só é excluída por comando no banco' using errcode = 'insufficient_privilege';
  end if;
  return alvo;
end;
$$;

-- Passo 2: marca como concluído só se a conta de fato não existe mais.
create function public.admin_concluir_exclusao(p_solicitacao uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  alvo uuid;
begin
  perform public.exigir_super_admin();
  select s.user_id into alvo from public.solicitacoes_lgpd s
  where s.id = p_solicitacao and s.status = 'pendente';
  if alvo is null then
    raise exception 'pedido não encontrado ou já concluído' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from auth.users where id = alvo) then
    raise exception 'a conta ainda existe; a exclusão não foi feita' using errcode = 'check_violation';
  end if;
  update public.solicitacoes_lgpd
  set status = 'concluida', concluido_em = now(), concluido_por = auth.uid()
  where id = p_solicitacao;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'meus_dados()', 'solicitar_exclusao()', 'cancelar_solicitacao_exclusao()',
    'admin_listar_solicitacoes_lgpd()', 'admin_autorizar_exclusao(uuid)', 'admin_concluir_exclusao(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
