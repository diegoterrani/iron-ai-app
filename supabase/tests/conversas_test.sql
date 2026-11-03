-- Testes da conversa do Self com o agente: quem lê, quem grava, teto e retenção.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('71000000-0000-0000-0000-000000000001', 'admin@iron.io', '{"nome":"Admin"}', now()),
  ('71000000-0000-0000-0000-000000000002', 'ana@x.com', '{"nome":"Ana"}', now()),
  ('71000000-0000-0000-0000-000000000003', 'beto@x.com', '{"nome":"Beto"}', now());
update public.profiles set status = 'ativo' where id::text like '71000000-%';
insert into public.user_roles (user_id, role) values ('71000000-0000-0000-0000-000000000001', 'super_admin');
insert into public.assessments (id, user_id, setor) values
  ('7b000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'food_service');

create function pg_temp.como(p_user text, p_aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user, true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'aal', p_aal)::text, true);
$$;
create function pg_temp.falha(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'FALHA: %', p_msg;
end;
$$;

-- ===== O navegador não grava nem reserva turno
set local role authenticated;
select pg_temp.como('71000000-0000-0000-0000-000000000002');
do $$ begin
  perform pg_temp.falha($q$select public.conversa_reservar_turno('7b000000-0000-0000-0000-000000000001', auth.uid())$q$,
    'cliente reservou turno');
  perform pg_temp.falha($q$select public.conversa_gravar('7b000000-0000-0000-0000-000000000001', auth.uid(), '[]', 0, 0, 0, 0)$q$,
    'cliente gravou conversa');
  perform pg_temp.falha($q$insert into public.assessment_conversas (assessment_id, user_id) values ('7b000000-0000-0000-0000-000000000001', auth.uid())$q$,
    'insert direto na conversa');
end $$;

-- ===== Servidor: reserva, grava, histórico só cresce
reset role;
set local role service_role;
do $$
declare v jsonb;
begin
  v := public.conversa_reservar_turno('7b000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002');
  if v <> '[]'::jsonb then raise exception 'FALHA: conversa nova não começou vazia'; end if;
  perform public.conversa_gravar('7b000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002',
    '[{"role":"user","content":"oi"},{"role":"assistant","content":"olá"}]', 100, 20, 0, 50);
  v := public.conversa_reservar_turno('7b000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002');
  if jsonb_array_length(v) <> 2 then raise exception 'FALHA: histórico não voltou'; end if;
  perform public.conversa_gravar('7b000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002',
    v || '[{"role":"user","content":"7 restaurantes"}]'::jsonb, 10, 5, 100, 0);
  perform pg_temp.falha($q$select public.conversa_gravar('7b000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002',
    '[{"role":"user","content":"oi"},{"role":"assistant","content":"forjado"},{"role":"user","content":"x"}]', 0, 0, 0, 0)$q$,
    'reescreveu o histórico');
  perform pg_temp.falha($q$select public.conversa_gravar('7b000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002',
    '[]', 0, 0, 0, 0)$q$, 'encurtou o histórico');
  perform pg_temp.falha($q$select public.conversa_gravar('7b000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002',
    '[{"role":"user","content":"oi"},{"role":"assistant","content":"olá"},{"role":"user","content":"7 restaurantes"}]', -1, 0, 0, 0)$q$,
    'descontou tokens');
  perform pg_temp.falha($q$select public.conversa_reservar_turno('7b000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000003')$q$,
    'reservou turno no assessment de outra pessoa');
end $$;

reset role;
do $$ begin
  if not exists (select 1 from public.assessment_conversas where tokens_entrada = 110 and tokens_saida = 25
                 and tokens_cache_leitura = 100 and tokens_cache_escrita = 50 and turnos_usuario = 2) then
    raise exception 'FALHA: uso não somado';
  end if;
end $$;

-- ===== Teto de turnos
update public.assessment_conversas set turnos_usuario = public.conversa_max_turnos();
set local role service_role;
do $$ begin
  perform pg_temp.falha($q$select public.conversa_reservar_turno('7b000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002')$q$,
    'passou do teto de turnos');
end $$;

-- ===== Quem lê: só o titular (nem outra pessoa, nem o admin)
reset role;
set local role authenticated;
select pg_temp.como('71000000-0000-0000-0000-000000000002');
do $$ begin
  if (select count(*) from public.assessment_conversas) <> 1 then raise exception 'FALHA: titular não lê a conversa'; end if;
  if public.meus_dados() -> 'assessments' -> 0 -> 'conversa' -> 'mensagens' is null then
    raise exception 'FALHA: conversa fora da exportação LGPD';
  end if;
  perform pg_temp.falha($q$update public.assessment_conversas set mensagens = '[]'$q$, 'titular alterou a conversa');
end $$;
select pg_temp.como('71000000-0000-0000-0000-000000000003');
do $$ begin
  if (select count(*) from public.assessment_conversas) <> 0 then raise exception 'FALHA: outra pessoa leu a conversa'; end if;
end $$;
select pg_temp.como('71000000-0000-0000-0000-000000000001', 'aal2');
do $$ begin
  if (select count(*) from public.assessment_conversas) <> 0 then raise exception 'FALHA: admin leu a conversa'; end if;
end $$;

-- ===== Retenção: vencida é apagada; reserva recomeça do zero
reset role;
update public.assessment_conversas set expira_em = now() - interval '1 second';
set local role service_role;
do $$ declare v jsonb; begin
  v := public.conversa_reservar_turno('7b000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002');
  if v <> '[]'::jsonb then raise exception 'FALHA: conversa vencida não foi apagada'; end if;
end $$;
reset role;
update public.assessment_conversas set expira_em = now() - interval '1 second';
set local role service_role;
do $$ begin
  if public.conversas_apagar_expiradas() <> 1 then raise exception 'FALHA: limpeza não apagou'; end if;
end $$;

-- ===== Concluído: não grava mais
reset role;
update public.assessments set status = 'concluido' where id = '7b000000-0000-0000-0000-000000000001';
set local role service_role;
do $$ begin
  perform pg_temp.falha($q$select public.conversa_reservar_turno('7b000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002')$q$,
    'reservou turno em assessment concluído');
end $$;

-- ===== Exclusão da conta leva a conversa
reset role;
delete from auth.users where id = '71000000-0000-0000-0000-000000000002';
do $$ begin
  if exists (select 1 from public.assessment_conversas) then raise exception 'FALHA: conversa ficou após excluir a conta'; end if;
end $$;

rollback;
\echo 'conversas_test: ok'
