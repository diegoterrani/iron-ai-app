-- Defesa em profundidade (achado da revisão do projeto real, 02/11/2026):
-- funções de gatilho e auxiliares não precisam ser chamáveis pela API.
-- Gatilhos continuam funcionando (EXECUTE só é checado ao criar o gatilho) e
-- sessao_aal2 só é chamada de dentro de tem_permissao (security definer).
do $$
declare f text;
begin
  foreach f in array array[
    'audit_log_imutavel()', 'proteger_ultimo_super_admin()', 'tocar_updated_at()',
    'validar_assentos()', 'validar_escopo_papel()', 'sessao_aal2()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
