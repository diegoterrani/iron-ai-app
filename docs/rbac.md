# RBAC

A regra de acesso mora no banco (`supabase/migrations/20261102170000_rbac.sql`).
A tela só esconde botões; quem decide é `public.tem_permissao(permissao, empresa)`.

## Papéis

| Papel | Escopo | MFA obrigatório | Quem concede |
| --- | --- | --- | --- |
| `super_admin` | global | sim | só por SQL (ver abaixo); o último não pode sair |
| `equipe_iron` | global, empresas atribuídas | sim | super-admin (`admin_conceder_papel`) |
| `parceiro` | empresas atribuídas | não | super-admin |
| `master_b2b` | uma empresa | não | super-admin (`admin_vincular_empresa`) |
| `membro_b2b` | uma empresa | não | master da empresa (`empresa_adicionar_membro`) ou super-admin |
| `aluno_b2c` | próprio usuário | não | super-admin |

Papel com MFA obrigatório **não vale** sem sessão aal2: o banco ignora o papel,
e a aplicação manda a pessoa para `/configurar-mfa`.

## Regras de `tem_permissao`

1. Conta precisa estar `ativo` (suspender corta o acesso na hora).
2. Permissão de escopo `plataforma` (ex.: `conteudo.ver`) vale para quem tem o papel.
3. Permissão de escopo `empresa` (ex.: `assessment.ver`) exige a empresa:
   super-admin em todas; equipe/parceiro só nas atribuídas; master/membro só na própria.
4. Lê as tabelas a cada chamada; não confia em papéis gravados no token.

## Travas contra escalada (todas testadas em `supabase/tests/rbac_test.sql`)

- Nenhum logado escreve direto em `user_roles`, `memberships`, `organizations`,
  `staff_assignments` ou `audit_log`. Só pelas funções `admin_*` / `empresa_*`.
- Ninguém altera o próprio papel ou status.
- `super_admin` não é concedido pela tela.
- Master só adiciona **Membro**, só na própria empresa, até o limite de assentos.
- Papel global não entra em empresa e vice-versa.
- `audit_log` só aceita inserção (nem o dono altera ou apaga).

## Criar o primeiro super-admin

Depois que o Terrani se cadastrar e confirmar o e-mail, no SQL Editor do Supabase:

```sql
-- Alvo: projeto iron-ai-app (us-east-1). Troque o e-mail.
update public.profiles set status = 'ativo'
where id = (select id from auth.users where email = 'SEU_EMAIL');

insert into public.user_roles (user_id, role)
select id, 'super_admin' from auth.users where email = 'SEU_EMAIL';
```

Validação: `select * from public.audit_log order by id desc limit 2;` mostra a
concessão. No próximo acesso, o app pede para ativar o app autenticador.

## Backoffice (fase 3)

Telas em `/admin` (só super-admin com MFA): visão geral, usuários (filtro por
status e busca), ficha do usuário (aprovar, suspender, reativar, papéis,
empresas, empresas atendidas, histórico), empresas (criar, assentos, vincular
por e-mail, remover) e auditoria.

Funções de leitura adicionadas em `20261102190000_backoffice.sql`:
`admin_listar_usuarios`, `admin_obter_usuario`, `admin_buscar_usuario_por_email`,
`admin_contadores` e a operação `admin_desvincular_empresa`. Todas chamam
`exigir_super_admin()` antes de qualquer coisa.

## Convites do Master (fase 3b)

Tela `/empresa` (só Master B2B): pessoas com e-mail, convites pendentes,
convidar por e-mail e remover Membros. Funções em `20261102200000_convites.sql`:
`empresa_convidar`, `empresa_cancelar_convite`, `empresa_listar_membros`
(Master) e `meus_convites`, `aceitar_convite`, `recusar_convite` (convidado).
Convite sempre gera **Membro**; Master só pelo super-admin. O convite aparece
no painel ou na tela de "aguardando aprovação" de quem tem o e-mail confirmado;
aceitar ativa a conta.
