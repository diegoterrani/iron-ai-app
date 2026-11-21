-- Cadastro de empresas do Self (decisão do Terrani, 21/11/2026): no começo
-- do assessment a pessoa escolhe uma empresa já cadastrada (com busca) ou
-- cadastra uma nova.
--
-- Até aqui os dados da empresa viviam só dentro de cada assessment
-- (assessments.empresa). Agora:
-- 1. empresas_cadastro guarda a empresa uma vez; o assessment guarda o
--    vínculo (empresa_id) e continua com a sua cópia (assessments.empresa),
--    para o resultado antigo não mudar quando o cadastro mudar.
-- 2. Quem vê: quem cadastrou e a equipe IRON (papéis globais super_admin e
--    equipe_iron, sempre com MFA). Um cliente que usa o Self sozinho vê só as
--    empresas dele. O cadastro tem dados de contato de pessoas.
-- 3. O navegador só lê (RLS) e busca. Vincular é por função que confere se a
--    pessoa pode editar o rascunho e ver a empresa. Só assessment pessoal: no
--    assessment de uma organização, a empresa é a própria organização.
-- 4. Ao concluir, o cadastro recebe os dados do assessment (ou é criado, se a
--    empresa era nova). Isso nunca impede a conclusão: dado que não cabe no
--    cadastro (CNPJ incompleto, por exemplo) fica de fora.
-- 5. Excluir a conta de quem cadastrou apaga as empresas dela (LGPD); os
--    assessments perdem só o vínculo e mantêm a cópia.

-- ------------------------------------------------------------------ busca

-- Texto para busca: minúsculo e sem acento (sem depender da extensão unaccent).
create function public.texto_busca(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select translate(lower(coalesce(p, '')),
    'áàâãäéèêëíìîïóòôõöúùûüçñ',
    'aaaaaeeeeiiiiooooouuuucn');
$$;

-- ----------------------------------------------------------------- tabela

create table public.empresas_cadastro (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 1 and 200),
  cnpj text check (cnpj ~ '^[0-9]{14}$'),
  cidade text check (char_length(cidade) <= 100),
  uf text check (uf ~ '^[A-Z]{2}$'),
  contato_nome text check (char_length(contato_nome) <= 120),
  contato_cargo text check (char_length(contato_cargo) <= 120),
  contato_email text check (char_length(contato_email) <= 254),
  contato_telefone text check (contato_telefone ~ '^[0-9]{8,13}$'),
  criado_por uuid references public.profiles (id) on delete cascade,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  busca text generated always as (
    public.texto_busca(nome || ' ' || coalesce(cidade, '') || ' ' || coalesce(uf, '') || ' ' || coalesce(cnpj, ''))
  ) stored
);
create index empresas_cadastro_criado_por_idx on public.empresas_cadastro (criado_por, atualizado_em desc);
create index empresas_cadastro_recentes_idx on public.empresas_cadastro (atualizado_em desc);
create trigger empresas_cadastro_tocar before update on public.empresas_cadastro
  for each row execute function public.tocar_atualizado_em();

alter table public.assessments
  add column empresa_id uuid references public.empresas_cadastro (id) on delete set null;
create index assessments_empresa_idx on public.assessments (empresa_id) where empresa_id is not null;

-- ------------------------------------------------------------------ acesso

/* A pessoa logada é da equipe IRON (super_admin ou equipe_iron, conta ativa, sessão com MFA)? */
create function public.e_equipe_iron()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.sessao_aal2() and exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id and p.status = 'ativo'
    where ur.user_id = auth.uid() and ur.role in ('super_admin', 'equipe_iron')
  );
$$;

alter table public.empresas_cadastro enable row level security;
revoke all on public.empresas_cadastro from anon, authenticated;
grant select on public.empresas_cadastro to authenticated;

create policy "empresas: quem cadastrou ou equipe IRON le" on public.empresas_cadastro
  for select to authenticated
  using (criado_por = (select auth.uid()) or (select public.e_equipe_iron()));

-- ------------------------------------------------------------------ busca

/*
  Busca no cadastro, com o RLS de quem chama (security invoker): cada um só
  encontra o que pode ver. Sem termo, as 10 mais recentes. Ignora acento e
  caixa; CNPJ pode vir com ou sem pontuação.
*/
create function public.buscar_empresas_cadastro(p_termo text)
returns table (id uuid, nome text, cnpj text, cidade text, uf text, contato_nome text, atualizado_em timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  with t as (
    select
      replace(replace(replace(public.texto_busca(left(btrim(coalesce(p_termo, '')), 100)), '\', '\\'), '%', '\%'), '_', '\_') as termo,
      regexp_replace(coalesce(p_termo, ''), '[^0-9]', '', 'g') as digitos
  )
  select e.id, e.nome, e.cnpj, e.cidade, e.uf, e.contato_nome, e.atualizado_em
  from public.empresas_cadastro e, t
  where t.termo = ''
     or e.busca like '%' || t.termo || '%'
     or (char_length(t.digitos) >= 4 and e.cnpj like '%' || t.digitos || '%')
  order by e.atualizado_em desc
  limit 10;
$$;

/* Cópia da empresa para o assessment: só os campos preenchidos. */
create function public.empresa_para_assessment(e public.empresas_cadastro)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'nome', e.nome, 'cnpj', e.cnpj, 'cidade', e.cidade, 'uf', e.uf,
    'contato_nome', e.contato_nome, 'contato_cargo', e.contato_cargo,
    'contato_email', e.contato_email, 'contato_telefone', e.contato_telefone));
$$;

/*
  Vincula uma empresa cadastrada ao rascunho pessoal e copia os dados dela.
  Com p_empresa nulo, desfaz o vínculo e limpa os dados (cadastrar nova).
  Devolve a empresa copiada e a versão nova do rascunho.
*/
create function public.vincular_empresa_assessment(p_assessment uuid, p_empresa uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  a public.assessments;
  e public.empresas_cadastro;
  v_empresa jsonb := '{}'::jsonb;
begin
  if v_user is null or not public.pode_editar_assessment(p_assessment, v_user, public.sessao_aal2()) then
    raise exception 'sem acesso a este assessment' using errcode = 'insufficient_privilege';
  end if;
  select * into a from public.assessments where id = p_assessment for update;
  if a.org_id is not null then
    raise exception 'o assessment de uma empresa usa os dados dela' using errcode = 'check_violation';
  end if;
  if p_empresa is not null then
    select * into e from public.empresas_cadastro where id = p_empresa;
    if not found or not (e.criado_por = v_user or public.e_equipe_iron()) then
      raise exception 'empresa não encontrada' using errcode = 'insufficient_privilege';
    end if;
    v_empresa := public.empresa_para_assessment(e);
  end if;
  update public.assessments set empresa_id = p_empresa, empresa = v_empresa where id = p_assessment
  returning * into a;
  return jsonb_build_object('empresa', v_empresa, 'versao', a.atualizado_em);
end;
$$;

-- ----------------------------------------------------- conclusão e importação

/*
  Grava no cadastro a empresa de um assessment pessoal: atualiza a vinculada
  (campos vazios no assessment não apagam o cadastro) ou cria uma nova e
  devolve o id. Dado fora do formato do cadastro fica de fora.
*/
create function public.empresa_do_assessment_no_cadastro(p_empresa_id uuid, p_dados jsonb, p_dono uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text := left(btrim(coalesce(p_dados ->> 'nome', '')), 200);
  v_cnpj text := case when p_dados ->> 'cnpj' ~ '^[0-9]{14}$' then p_dados ->> 'cnpj' end;
  v_cidade text := nullif(left(btrim(coalesce(p_dados ->> 'cidade', '')), 100), '');
  v_uf text := case when p_dados ->> 'uf' ~ '^[A-Z]{2}$' then p_dados ->> 'uf' end;
  v_cnome text := nullif(left(btrim(coalesce(p_dados ->> 'contato_nome', '')), 120), '');
  v_ccargo text := nullif(left(btrim(coalesce(p_dados ->> 'contato_cargo', '')), 120), '');
  v_cemail text := nullif(left(btrim(coalesce(p_dados ->> 'contato_email', '')), 254), '');
  v_ctel text := case when p_dados ->> 'contato_telefone' ~ '^[0-9]{8,13}$' then p_dados ->> 'contato_telefone' end;
  v_id uuid := p_empresa_id;
begin
  if v_nome = '' then
    return p_empresa_id;
  end if;
  if v_id is not null then
    update public.empresas_cadastro set
      nome = v_nome,
      cnpj = coalesce(v_cnpj, cnpj),
      cidade = coalesce(v_cidade, cidade),
      uf = coalesce(v_uf, uf),
      contato_nome = coalesce(v_cnome, contato_nome),
      contato_cargo = coalesce(v_ccargo, contato_cargo),
      contato_email = coalesce(v_cemail, contato_email),
      contato_telefone = coalesce(v_ctel, contato_telefone)
    where id = v_id;
    if found then
      return v_id;
    end if;
  end if;
  insert into public.empresas_cadastro (nome, cnpj, cidade, uf, contato_nome, contato_cargo, contato_email, contato_telefone, criado_por)
  values (v_nome, v_cnpj, v_cidade, v_uf, v_cnome, v_ccargo, v_cemail, v_ctel, p_dono)
  returning id into v_id;
  return v_id;
end;
$$;

/* Ao concluir um assessment pessoal, o cadastro recebe os dados da empresa. Nunca bloqueia a conclusão. */
create function public.empresa_sincronizar_na_conclusao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'rascunho' and new.status = 'concluido' and new.org_id is null then
    begin
      new.empresa_id := public.empresa_do_assessment_no_cadastro(new.empresa_id, coalesce(new.empresa, '{}'::jsonb), new.user_id);
    exception when others then
      raise warning 'cadastro da empresa não atualizado na conclusão: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;
create trigger assessments_empresa_na_conclusao before update of status on public.assessments
  for each row execute function public.empresa_sincronizar_na_conclusao();

-- Importação: empresas dos assessments pessoais que já existem. A mesma
-- empresa da mesma pessoa (mesmo CNPJ, ou mesmo nome sem CNPJ) vira um
-- cadastro só, com os dados do assessment mais recente.
do $$
declare
  a record;
  v_id uuid;
begin
  for a in
    select id, user_id, empresa from public.assessments
    where org_id is null and empresa_id is null and btrim(coalesce(empresa ->> 'nome', '')) <> ''
    order by atualizado_em
  loop
    select e.id into v_id from public.empresas_cadastro e
    where e.criado_por = a.user_id
      and ((a.empresa ->> 'cnpj' ~ '^[0-9]{14}$' and e.cnpj = a.empresa ->> 'cnpj')
           or (e.cnpj is null and public.texto_busca(btrim(e.nome)) = public.texto_busca(btrim(a.empresa ->> 'nome'))))
    limit 1;
    v_id := public.empresa_do_assessment_no_cadastro(v_id, a.empresa, a.user_id);
    update public.assessments set empresa_id = v_id where id = a.id;
  end loop;
end $$;

-- ------------------------------------------------------------- privilégios

revoke execute on function public.texto_busca(text) from public, anon;
grant execute on function public.texto_busca(text) to authenticated;
revoke execute on function public.e_equipe_iron() from public, anon;
grant execute on function public.e_equipe_iron() to authenticated;
revoke execute on function public.buscar_empresas_cadastro(text) from public, anon;
grant execute on function public.buscar_empresas_cadastro(text) to authenticated;
revoke execute on function public.vincular_empresa_assessment(uuid, uuid) from public, anon;
grant execute on function public.vincular_empresa_assessment(uuid, uuid) to authenticated;
revoke execute on function public.empresa_para_assessment(public.empresas_cadastro) from public, anon, authenticated;
revoke execute on function public.empresa_do_assessment_no_cadastro(uuid, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.empresa_sincronizar_na_conclusao() from public, anon, authenticated;
