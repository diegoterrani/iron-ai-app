-- Fase 7a.5: cadastro da empresa no Self assessment.
-- Quem responde informa a empresa avaliada e o contato principal antes das
-- perguntas. Fica no próprio assessment (não cria organização: a empresa do
-- B2B continua sendo criada pelo super-admin no backoffice).
-- O cliente edita só enquanto é rascunho, pela mesma política das respostas.

alter table public.assessments
  add column empresa jsonb not null default '{}'::jsonb,
  add constraint assessments_empresa_objeto check (jsonb_typeof(empresa) = 'object'),
  add constraint assessments_empresa_tamanho check (octet_length(empresa::text) <= 4096);

grant update (empresa) on public.assessments to authenticated;

-- Exportação LGPD passa a levar o cadastro da empresa junto.
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
