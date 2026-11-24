-- Excluir empresa e excluir usuário pelo backoffice (pedido do Terrani, 24/11/2026).
--
-- 1. Self da empresa sobrevive à conta de quem o iniciou.
--    Antes, assessments.user_id era ON DELETE CASCADE: excluir a conta de
--    uma pessoa apagava junto o assessment da EMPRESA que ela iniciou (e o
--    resultado). Agora:
--    - assessment pessoal (org_id nulo) continua saindo com a conta (LGPD);
--    - assessment da empresa fica, com user_id nulo (autor excluído).
--
-- 2. Excluir empresa (admin_excluir_empresa): só super-admin com MFA,
--    digitando o nome da empresa e um motivo. Numa transação só, apaga o
--    Deep (com tudo o que ele tem), os assessments da empresa, vínculos,
--    atribuições, convites e acessos. As contas das pessoas continuam.
--    As tabelas do Deep são "somente inserção" por gatilho; a exclusão liga
--    uma chave local à transação (iron.purga), como a retenção já faz.
--    A auditoria (audit_log) é imutável e guarda o registro da exclusão.
--
-- 3. Excluir usuário (admin_autorizar_exclusao_usuario +
--    admin_registrar_exclusao_usuario): só super-admin com MFA, digitando o
--    e-mail da pessoa. Quem apaga a conta é o servidor (Auth Admin API), entre
--    as duas chamadas; a segunda só registra se a conta de fato sumiu.

-- -------------------------------------------- 1. Self da empresa fica

alter table public.assessments alter column user_id drop not null;
alter table public.assessments drop constraint assessments_user_id_fkey;
alter table public.assessments
  add constraint assessments_user_id_fkey foreign key (user_id)
  references public.profiles (id) on delete set null;
-- Só o assessment da empresa pode ficar sem autor.
alter table public.assessments
  add constraint assessments_autor_ou_empresa check (user_id is not null or org_id is not null);

/* Ao excluir a conta, os assessments PESSOAIS saem junto (antes do SET NULL). */
create function public.apagar_assessments_pessoais()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.assessments a where a.user_id = old.id and a.org_id is null;
  return old;
end;
$$;
revoke execute on function public.apagar_assessments_pessoais() from public, anon, authenticated;

create trigger profiles_apagar_assessments_pessoais before delete on public.profiles
  for each row execute function public.apagar_assessments_pessoais();

-- ------------------------------------------------ 2. chave de exclusão

-- Só admin_excluir_empresa liga esta chave (local à transação). O navegador
-- não roda SQL livre, e as tabelas do Deep não têm política de DELETE.
create function public.em_purga()
returns boolean
language sql
stable
set search_path = ''
as $$ select coalesce(current_setting('iron.purga', true), '') = 'on' $$;
revoke execute on function public.em_purga() from public, anon, authenticated;

-- Os gatilhos de "somente inserção" do Deep passam a aceitar DELETE na purga.
-- O resto de cada função é o mesmo das migrações 20261120120000 e 20261120200000.

create or replace function public.deep_mensagens_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and (public.deep_em_retencao() or public.em_purga()) then
    return old;
  end if;
  raise exception 'falas do Deep são somente inserção' using errcode = 'insufficient_privilege';
end;
$$;

create or replace function public.deep_versionado_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  antes jsonb;
  depois jsonb;
begin
  if tg_op = 'DELETE' then
    if public.em_purga() then
      return old;
    end if;
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

create or replace function public.deep_relatorios_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  fixo jsonb;
begin
  if tg_op = 'DELETE' and public.em_purga() then
    return old;
  end if;
  fixo := to_jsonb(old) - 'publicado_em' - 'publicado_por' - 'gerado_por';
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

create or replace function public.deep_escuta_consentimento_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and public.em_purga() then
    return old;
  end if;
  if tg_op = 'UPDATE' and new.registrado_por is null
     and (to_jsonb(new) - 'registrado_por') = (to_jsonb(old) - 'registrado_por') then
    return new;
  end if;
  raise exception 'consentimento da escuta é somente inserção' using errcode = 'insufficient_privilege';
end;
$$;

create or replace function public.deep_escuta_blocos_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and (public.deep_em_retencao() or public.em_purga()) then
    return old;
  end if;
  if tg_op = 'UPDATE'
     and old.processado_em is null and new.processado_em is not null
     and (to_jsonb(new) - 'processado_em' - 'mensagem_ordem') = (to_jsonb(old) - 'processado_em' - 'mensagem_ordem') then
    return new;
  end if;
  raise exception 'blocos da escuta só mudam ao serem processados' using errcode = 'insufficient_privilege';
end;
$$;

create or replace function public.deep_escuta_confirmar_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  fixos_antes jsonb;
  fixos_depois jsonb;
  fechando boolean;
begin
  if tg_op = 'DELETE' then
    if public.em_purga() then
      return old;
    end if;
    raise exception 'itens a confirmar são somente inserção' using errcode = 'insufficient_privilege';
  end if;
  fixos_antes := to_jsonb(old) - 'status' - 'fechada_em' - 'fechada_por' - 'trecho';
  fixos_depois := to_jsonb(new) - 'status' - 'fechada_em' - 'fechada_por' - 'trecho';
  fechando := old.status = 'pendente' and new.status in ('confirmada', 'descartada');
  if fixos_antes = fixos_depois
     and (new.trecho is not distinct from old.trecho or (public.deep_em_retencao() and new.trecho is null))
     and (new.status = old.status or fechando)
     and (new.fechada_em is not distinct from old.fechada_em or fechando)
     and (new.fechada_por is not distinct from old.fechada_por or fechando or new.fechada_por is null) then
    return new;
  end if;
  raise exception 'item a confirmar só muda de pendente para confirmada ou descartada' using errcode = 'insufficient_privilege';
end;
$$;

-- ------------------------------------------------ 2. excluir empresa

/* Confirmação digitada: ignora caixa, acento e espaços sobrando. */
create function public.confere_confirmacao(p_esperado text, p_digitado text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.texto_busca(regexp_replace(btrim(coalesce(p_esperado, '')), '\s+', ' ', 'g'))
       = public.texto_busca(regexp_replace(btrim(coalesce(p_digitado, '')), '\s+', ' ', 'g'))
     and btrim(coalesce(p_digitado, '')) <> '';
$$;

/*
  Exclui a empresa e tudo o que é dela. Devolve o que saiu (contagens).
  Recusa: quem não é super-admin com MFA, nome digitado diferente, motivo
  curto. Tudo ou nada: qualquer falha desfaz a transação inteira.
*/
create function public.admin_excluir_empresa(p_org uuid, p_confirmacao text, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations%rowtype;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_saida jsonb;
  n_deep integer;
  n_assessments integer;
  n_pessoas integer;
  n_staff integer;
  n_convites integer;
  n_acessos integer;
begin
  perform public.exigir_super_admin();
  if char_length(v_motivo) < 5 or char_length(v_motivo) > 300 then
    raise exception 'informe o motivo (de 5 a 300 caracteres)' using errcode = 'check_violation';
  end if;

  select * into v_org from public.organizations o where o.id = p_org for update;
  if not found then
    raise exception 'empresa não encontrada' using errcode = 'no_data_found';
  end if;
  if not public.confere_confirmacao(v_org.nome, p_confirmacao) then
    raise exception 'o nome digitado não confere com o da empresa' using errcode = 'check_violation';
  end if;

  select count(*) into n_pessoas from public.memberships where org_id = v_org.id;
  select count(*) into n_staff from public.staff_assignments where org_id = v_org.id;
  select count(*) into n_convites from public.convites where org_id = v_org.id;
  select count(*) into n_acessos from public.direitos where org_id = v_org.id;

  -- Deep (sessões, falas, respostas, evidências, relatórios e escuta em cascata).
  perform set_config('iron.purga', 'on', true);
  delete from public.deep_assessments where org_id = v_org.id;
  get diagnostics n_deep = row_count;
  -- Self da empresa (resultados, conversas e escuta em cascata).
  delete from public.assessments where org_id = v_org.id;
  get diagnostics n_assessments = row_count;
  perform set_config('iron.purga', '', true);

  -- Vínculos, atribuições, convites e acessos saem em cascata.
  delete from public.organizations where id = v_org.id;

  v_saida := jsonb_build_object(
    'deep', n_deep, 'assessments', n_assessments, 'pessoas', n_pessoas,
    'equipe', n_staff, 'convites', n_convites, 'acessos', n_acessos);

  insert into public.audit_log (ator, acao, tabela, alvo, dados)
  values (auth.uid(), 'empresa_excluida', 'organizations', v_org.id::text,
          jsonb_build_object('nome', v_org.nome, 'motivo', v_motivo) || v_saida);

  return v_saida;
end;
$$;

-- ------------------------------------------------ 3. excluir usuário

/*
  Passo 1: confere tudo e devolve o id da conta que o servidor vai apagar
  no Auth. Não apaga nada. Recusa a própria conta, super-admin e e-mail
  digitado diferente do da conta.
*/
create function public.admin_autorizar_exclusao_usuario(p_user uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  perform public.exigir_super_admin();
  if p_user = auth.uid() then
    raise exception 'não é permitido excluir a própria conta pela tela' using errcode = 'insufficient_privilege';
  end if;
  select u.email into v_email from auth.users u where u.id = p_user;
  if not found then
    raise exception 'usuário não encontrado' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from public.user_roles where user_id = p_user and role = 'super_admin') then
    raise exception 'conta de super-admin só é excluída por comando no banco' using errcode = 'insufficient_privilege';
  end if;
  if lower(btrim(coalesce(p_email, ''))) <> lower(coalesce(v_email, '')) then
    raise exception 'o e-mail digitado não confere com o da conta' using errcode = 'check_violation';
  end if;
  return p_user;
end;
$$;

/*
  Passo 2: registra a exclusão na auditoria, só se a conta de fato não
  existe mais. Não guarda nome nem e-mail (LGPD); só o id e o motivo.
*/
create function public.admin_registrar_exclusao_usuario(p_user uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := left(btrim(coalesce(p_motivo, '')), 300);
begin
  perform public.exigir_super_admin();
  if exists (select 1 from auth.users where id = p_user) then
    raise exception 'a conta ainda existe; a exclusão não foi feita' using errcode = 'check_violation';
  end if;
  insert into public.audit_log (ator, acao, tabela, alvo, dados)
  values (auth.uid(), 'usuario_excluido', 'profiles', p_user::text, jsonb_build_object('motivo', v_motivo));
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'admin_excluir_empresa(uuid, text, text)',
    'admin_autorizar_exclusao_usuario(uuid, text)',
    'admin_registrar_exclusao_usuario(uuid, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke execute on function public.confere_confirmacao(text, text) from public, anon, authenticated;
