-- Remoção de assessments (pedido do Terrani, 03/11/2026).
--
-- Dois caminhos, ambos por função security definer (o cliente não ganha
-- política de DELETE na tabela):
-- 1. descartar_rascunho: o próprio dono apaga um rascunho seu. Concluído
--    não se descarta: o resultado é a prova do que foi calculado.
-- 2. admin_remover_assessment: só super-admin com MFA, com motivo
--    obrigatório. Remove rascunho ou concluído (resultados e conversa saem
--    em cascata).
-- Os dois gravam no audit_log quem, qual assessment, status e motivo.
-- Nunca as respostas.

create function public.descartar_rascunho(p_assessment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linha public.assessments%rowtype;
begin
  select * into v_linha from public.assessments a
  where a.id = p_assessment and a.user_id = auth.uid()
  for update;
  if not found then
    raise exception 'assessment não encontrado' using errcode = 'no_data_found';
  end if;
  if v_linha.status <> 'rascunho' then
    raise exception 'só rascunho pode ser descartado' using errcode = 'check_violation';
  end if;

  delete from public.assessments where id = v_linha.id;

  insert into public.audit_log (ator, acao, tabela, alvo, dados)
  values (auth.uid(), 'assessment_descartado', 'assessments', v_linha.user_id::text,
          jsonb_build_object('assessment', v_linha.id, 'setor', v_linha.setor, 'status', v_linha.status));
end;
$$;

create function public.admin_remover_assessment(p_assessment uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linha public.assessments%rowtype;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  perform public.exigir_super_admin();
  if char_length(v_motivo) < 5 or char_length(v_motivo) > 300 then
    raise exception 'informe o motivo (de 5 a 300 caracteres)' using errcode = 'check_violation';
  end if;

  select * into v_linha from public.assessments a where a.id = p_assessment for update;
  if not found then
    raise exception 'assessment não encontrado' using errcode = 'no_data_found';
  end if;

  delete from public.assessments where id = v_linha.id;

  insert into public.audit_log (ator, acao, tabela, alvo, dados)
  values (auth.uid(), 'assessment_removido', 'assessments', v_linha.user_id::text,
          jsonb_build_object('assessment', v_linha.id, 'setor', v_linha.setor,
                             'status', v_linha.status, 'motivo', v_motivo));
end;
$$;

revoke execute on function public.descartar_rascunho(uuid) from public, anon;
grant execute on function public.descartar_rascunho(uuid) to authenticated;
revoke execute on function public.admin_remover_assessment(uuid, text) from public, anon;
grant execute on function public.admin_remover_assessment(uuid, text) to authenticated;
