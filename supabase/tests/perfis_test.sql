-- Testes de RLS e privilégios da tabela profiles.
-- Cada bloco falha com RAISE EXCEPTION se a regra não valer.
\set ON_ERROR_STOP on
begin;

-- Dois usuários: A (cadastro por senha, com aceite) e B (OAuth, sem aceite).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@teste.io',
   '{"nome":"Ana Teste","aceite_termos_versao":"2026-11-02","aceite_marketing":true}'),
  ('00000000-0000-0000-0000-00000000000b', 'bruno@teste.io', '{"full_name":"Bruno OAuth"}'),
  ('00000000-0000-0000-0000-00000000000c', 'c@teste.io', '{"nome":" "}');

do $$
declare p record;
begin
  select * into p from public.profiles where id = '00000000-0000-0000-0000-00000000000a';
  if p.status <> 'pendente' then raise exception 'novo perfil deveria nascer pendente'; end if;
  if p.aceite_termos_versao <> '2026-11-02' or p.aceite_termos_em is null then raise exception 'aceite nao gravado'; end if;
  if not p.aceite_marketing then raise exception 'marketing nao gravado'; end if;

  select * into p from public.profiles where id = '00000000-0000-0000-0000-00000000000b';
  if p.nome <> 'Bruno OAuth' then raise exception 'nome do OAuth nao usado: %', p.nome; end if;
  if p.aceite_termos_versao is not null then raise exception 'OAuth nao deveria ter aceite'; end if;

  select * into p from public.profiles where id = '00000000-0000-0000-0000-00000000000c';
  if p.nome <> 'Usuário' then raise exception 'nome em branco deveria virar Usuário: %', p.nome; end if;
end $$;

-- Como usuário A autenticado.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);

do $$
declare n int;
begin
  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'A deveria ver so o proprio perfil, viu %', n; end if;

  update public.profiles set nome = 'Ana Editada' where id = '00000000-0000-0000-0000-00000000000a';
  update public.profiles set nome = 'Invasor' where id = '00000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'A conseguiu editar perfil de B'; end if;
end $$;

-- A tenta se aprovar sozinho: o privilégio de coluna deve barrar.
do $$
begin
  begin
    update public.profiles set status = 'ativo' where id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'FALHA: usuario mudou o proprio status';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.profiles (id, nome) values (gen_random_uuid(), 'Fake');
    raise exception 'FALHA: usuario inseriu perfil';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.profiles where id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'FALHA: usuario apagou perfil';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.criar_perfil_novo_usuario();
    raise exception 'FALHA: usuario executou funcao do gatilho';
  exception when insufficient_privilege or feature_not_supported then null;
  end;
end $$;

-- Visitante anônimo não lê nada.
reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.profiles;
    raise exception 'FALHA: anon leu profiles';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$
declare p record;
begin
  select * into p from public.profiles where id = '00000000-0000-0000-0000-00000000000a';
  if p.nome <> 'Ana Editada' then raise exception 'edicao do proprio nome falhou'; end if;
  if p.status <> 'pendente' then raise exception 'status mudou indevidamente'; end if;
end $$;

rollback;
\echo 'OK: perfis_test.sql passou'
