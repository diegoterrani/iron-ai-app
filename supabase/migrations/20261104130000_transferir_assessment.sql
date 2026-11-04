-- Transferir um Self assessment PESSOAL para a empresa (pedido do Terrani,
-- 04/11/2026): o cliente se cadastra, responde o Self pessoal e depois vira
-- empresa no app; o assessment dele passa a ser o da empresa.
--
-- Regras:
-- 1. Só super-admin com MFA (backoffice), auditado com o motivo.
-- 2. Só assessment pessoal (org_id nulo); da empresa não muda de empresa.
-- 3. O dono precisa ser ADM-Cliente ou RW-Cliente da empresa de destino: o
--    dado é dele, então só vai para uma empresa em que ele responde e edita.
--    (RO não basta: seria expor o dado dele a quem ele não gere.)
-- 4. Rascunho só entra se a empresa ainda não tem rascunho do mesmo setor
--    (um rascunho por empresa); concluído entra sempre.
-- 5. Respostas, resultado e autor não mudam. A conversa com o agente continua
--    privada de quem conversou (RLS por pessoa).
-- 6. Depois de transferido, sai da exportação LGPD pessoal (vira dado da
--    empresa); a conversa da pessoa continua na exportação dela.

create function public.admin_transferir_assessment_empresa(p_assessment uuid, p_org uuid, p_motivo text)
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
  if v_linha.org_id is not null then
    raise exception 'este assessment já é de uma empresa' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = v_linha.user_id and m.role in ('adm_cliente', 'rw_cliente')
  ) then
    raise exception 'o dono do assessment precisa ser ADM-Cliente ou RW-Cliente da empresa' using errcode = 'check_violation';
  end if;
  if v_linha.status = 'rascunho' and exists (
    select 1 from public.assessments a
    where a.org_id = p_org and a.tipo = v_linha.tipo and a.setor = v_linha.setor and a.status = 'rascunho'
  ) then
    raise exception 'a empresa já tem um rascunho deste assessment; conclua ou descarte antes' using errcode = 'check_violation';
  end if;

  update public.assessments set org_id = p_org where id = v_linha.id;

  insert into public.audit_log (ator, acao, tabela, alvo, dados)
  values (auth.uid(), 'assessment_transferido', 'assessments', v_linha.user_id::text,
          jsonb_build_object('assessment', v_linha.id, 'setor', v_linha.setor, 'status', v_linha.status,
                             'org', p_org, 'motivo', v_motivo));
end;
$$;

revoke execute on function public.admin_transferir_assessment_empresa(uuid, uuid, text) from public, anon;
grant execute on function public.admin_transferir_assessment_empresa(uuid, uuid, text) to authenticated;
