-- Revisão de UX da área logada (21/11/2026).
--
-- 1. Direito da empresa vale também para a Equipe IRON atribuída a ela
--    (staff_assignments). Antes só membros (memberships) usavam o direito da
--    empresa, então o consultor que já tinha assessment.editar na empresa não
--    conseguia abrir o Self dela e precisava fazer um pessoal e transferir.
--    A permissão de responder/editar continua sendo conferida à parte
--    (iniciar_self, pode_editar_assessment), com o MFA exigido pelos papéis
--    de staff. Parceiro atribuído não ganha nada: não tem assessment.editar.
-- 2. aceitar_termos: aceite dos Termos no primeiro acesso de quem entrou pelo
--    Google (ou por convite), que não passou pelo checkbox do cadastro.
-- 3. deep_empresas_que_conduzo: as empresas em que a pessoa pode conduzir o
--    Deep, numa chamada só (a tela fazia uma chamada por empresa).

-- ---------------------------------------------------------------- 1. direito

create or replace function public.tem_direito(p_produto text, p_org uuid default null)
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
            and (exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = p.id)
                 or exists (select 1 from public.staff_assignments sa where sa.org_id = p_org and sa.user_id = p.id)))
      )
  );
$$;

-- Mesma regra para a escuta (servidor informa usuário e MFA).
create or replace function public.self_escuta_pode(p_assessment uuid, p_user uuid, p_aal2 boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.pode_editar_assessment(p_assessment, p_user, p_aal2)
    and exists (
      select 1
      from public.assessments a
      join public.profiles p on p.id = p_user and p.status = 'ativo'
      join public.direitos d on d.produto = 'self_assessment'
        and d.revogado_em is null
        and (d.valido_ate is null or d.valido_ate > now())
      where a.id = p_assessment
        and (
          d.user_id = p_user
          or (a.org_id is not null and d.org_id = a.org_id
              and (exists (select 1 from public.memberships m where m.org_id = a.org_id and m.user_id = p_user)
                   or exists (select 1 from public.staff_assignments sa where sa.org_id = a.org_id and sa.user_id = p_user)))
        )
    );
$$;

-- ------------------------------------------------------------ 2. aceite

/*
  Registra o aceite dos Termos e da Política pela própria pessoa.
  Só grava versão no formato de data (AAAA-MM-DD) e só no próprio perfil.
  A coluna não é editável pelo navegador (grant só em nome e marketing).
*/
create function public.aceitar_termos(p_versao text, p_marketing boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sessão ausente' using errcode = 'insufficient_privilege';
  end if;
  if p_versao is null or p_versao !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'versão inválida' using errcode = 'check_violation';
  end if;
  update public.profiles
     set aceite_termos_versao = p_versao,
         aceite_termos_em = now(),
         aceite_marketing = coalesce(p_marketing, false)
   where id = auth.uid();
end;
$$;

revoke execute on function public.aceitar_termos(text, boolean) from public, anon;
grant execute on function public.aceitar_termos(text, boolean) to authenticated;

-- ------------------------------------------------------------ 3. Deep

-- Invoker: o RLS de organizations e a regra de tem_permissao valem como na tela.
create function public.deep_empresas_que_conduzo()
returns table (id uuid, nome text)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.id, o.nome
  from public.organizations o
  where public.tem_permissao('deep.conduzir', o.id)
  order by o.nome;
$$;

revoke execute on function public.deep_empresas_que_conduzo() from public, anon;
grant execute on function public.deep_empresas_que_conduzo() to authenticated;
