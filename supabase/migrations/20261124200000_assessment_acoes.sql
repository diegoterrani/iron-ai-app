-- Ações do Self na tela (pedido do Terrani, 24/11/2026): além de continuar e
-- descartar o rascunho, excluir um Self concluído e excluir um cadastro de
-- empresa do Self.
--
-- 1. excluir_assessment: apaga um Self (rascunho ou concluído) com tudo o que
--    é dele (resultados, conversas e escuta, em cascata).
--    - pessoal: só o dono (conta ativa);
--    - da empresa: só o ADM-Cliente da empresa;
--    - super-admin com MFA: qualquer um.
--    Um Deep que usava o Self como ponto de partida perde só o vínculo
--    (self_assessment_id vira nulo). Auditado como assessment_excluido.
--
-- 2. excluir_empresa_cadastro: apaga um cadastro de empresa do Self (quem
--    cadastrou ou super-admin com MFA). Os concluídos perdem só o vínculo e
--    mantêm a cópia dos dados (como já acontece quando a conta é excluída);
--    um rascunho ligado a ele perde também a cópia, para que concluir não
--    recrie o cadastro excluído.

create or replace function public.excluir_assessment(p_assessment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linha public.assessments%rowtype;
begin
  select * into v_linha from public.assessments a where a.id = p_assessment for update;
  -- Mesma resposta para "não existe" e "não é seu": não confirma que existe.
  if not found or not (
    public.e_super_admin()
    or (v_linha.org_id is null and v_linha.user_id = auth.uid()
        and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ativo'))
    or (v_linha.org_id is not null and public.tem_permissao('empresa.membros', v_linha.org_id))
  ) then
    raise exception 'assessment não encontrado' using errcode = 'no_data_found';
  end if;

  delete from public.assessments where id = v_linha.id;

  insert into public.audit_log (ator, acao, tabela, alvo, dados)
  values (auth.uid(), 'assessment_excluido', 'assessments', coalesce(v_linha.user_id::text, v_linha.org_id::text),
          jsonb_build_object('assessment', v_linha.id, 'setor', v_linha.setor, 'status', v_linha.status,
                             'org', v_linha.org_id));
end;
$$;

create or replace function public.excluir_empresa_cadastro(p_empresa uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linha public.empresas_cadastro%rowtype;
begin
  select * into v_linha from public.empresas_cadastro e where e.id = p_empresa for update;
  if not found or not (
    public.e_super_admin()
    or (v_linha.criado_por = auth.uid()
        and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ativo'))
  ) then
    raise exception 'empresa não encontrada' using errcode = 'no_data_found';
  end if;

  -- Rascunho pessoal ligado a este cadastro perde também a cópia da empresa:
  -- senão, ao concluir, empresa_sincronizar_na_conclusao recriaria o cadastro
  -- que a pessoa acabou de excluir. Concluídos guardam a cópia (histórico).
  update public.assessments set empresa = '{}'::jsonb
  where empresa_id = v_linha.id and status = 'rascunho' and org_id is null;

  delete from public.empresas_cadastro where id = v_linha.id;

  -- Sem contato nem CNPJ na auditoria: só o nome da empresa (dado de PJ).
  insert into public.audit_log (ator, acao, tabela, alvo, dados)
  values (auth.uid(), 'cadastro_empresa_excluido', 'empresas_cadastro', v_linha.id::text,
          jsonb_build_object('nome', v_linha.nome));
end;
$$;

revoke execute on function public.excluir_assessment(uuid) from public, anon;
grant execute on function public.excluir_assessment(uuid) to authenticated;
revoke execute on function public.excluir_empresa_cadastro(uuid) from public, anon;
grant execute on function public.excluir_empresa_cadastro(uuid) to authenticated;
