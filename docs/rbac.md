# RBAC

A regra de acesso mora no banco (`supabase/migrations/20261102170000_rbac.sql`).
A tela só esconde botões; quem decide é `public.tem_permissao(permissao, empresa)`.

## Papéis

| Papel | Escopo | MFA obrigatório | Quem concede |
| --- | --- | --- | --- |
| `super_admin` | global | sim | só por SQL (ver abaixo); o último não pode sair |
| `equipe_iron` | global, empresas atribuídas | sim | super-admin (`admin_conceder_papel`) |
| `parceiro` | empresas atribuídas | não | super-admin |
| `adm_cliente` | uma empresa | não | super-admin (`admin_vincular_empresa`) |
| `rw_cliente` | uma empresa | não | ADM-Cliente da empresa (convite ou troca de papel) ou super-admin |
| `ro_cliente` | uma empresa | não | ADM-Cliente da empresa (convite ou troca de papel) ou super-admin |
| `aluno_b2c` | próprio usuário | não | super-admin |

Papel com MFA obrigatório **não vale** sem sessão aal2: o banco ignora o papel,
e a aplicação manda a pessoa para `/configurar-mfa`.

## Regras de `tem_permissao`

1. Conta precisa estar `ativo` (suspender corta o acesso na hora).
2. Permissão de escopo `plataforma` (ex.: `conteudo.ver`) vale para quem tem o papel.
3. Permissão de escopo `empresa` (ex.: `assessment.ver`) exige a empresa:
   super-admin em todas; equipe/parceiro só nas atribuídas; ADM/RW/RO-Cliente só na própria.
4. Lê as tabelas a cada chamada; não confia em papéis gravados no token.

## Travas contra escalada (todas testadas em `supabase/tests/rbac_test.sql`)

- Nenhum logado escreve direto em `user_roles`, `memberships`, `organizations`,
  `staff_assignments` ou `audit_log`. Só pelas funções `admin_*` / `empresa_*`.
- Ninguém altera o próprio papel ou status.
- `super_admin` não é concedido pela tela.
- ADM-Cliente só concede **RW** ou **RO-Cliente**, só na própria empresa, até o limite
  de assentos; não altera o próprio papel nem o de outro ADM.
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

## Convites do ADM-Cliente (fase 3b)

Tela `/empresa` (só ADM-Cliente): pessoas com e-mail, convites pendentes,
convidar por e-mail e trocar RW⇄RO ou remover pessoas. Funções em `20261102200000_convites.sql`:
`empresa_convidar`, `empresa_cancelar_convite`, `empresa_listar_membros`
(ADM-Cliente) e `meus_convites`, `aceitar_convite`, `recusar_convite` (convidado).
Convite leva o papel escolhido (**RW** ou **RO-Cliente**); ADM só pelo super-admin. O convite aparece
no painel ou na tela de "aguardando aprovação" de quem tem o e-mail confirmado;
aceitar ativa a conta.

## Perfis do cliente (04/11/2026)

Migração `20261104100000_perfis_cliente.sql`. ADM-Cliente, RW-Cliente e RO-Cliente
substituem Master B2B e Membro B2B (produção não tinha vínculos; o SQL migra
qualquer linha antiga: Master vira ADM, Membro vira RW).

| Permissão | ADM-Cliente | RW-Cliente | RO-Cliente |
| --- | --- | --- | --- |
| `assessment.ver` (assessment, roadmap) | sim | sim | sim |
| `assessment.responder` / `assessment.editar` | sim | sim | não |
| `empresa.membros` (convidar, trocar RW⇄RO, remover) | sim | não | não |
| `assinatura.empresa` | sim | não | não |
| `conteudo.ver` | sim | sim | sim |
| `forum.escrever` | sim | sim | não |

O roadmap, quando existir, usa as mesmas `assessment.ver` e `assessment.editar`.

### Assessment da empresa

- Um rascunho por empresa e setor (`iniciar_self(setor, empresa)` retoma o mesmo).
- Editar: RLS exige `assessment.editar` na empresa. Concluir e conversar com o
  agente rodam no servidor, que informa quem pediu e o MFA da sessão; o banco
  reconfere com `usuario_tem_permissao` (mesma regra de `tem_permissao`).
- Cada pessoa tem a própria conversa com o agente (privada); as respostas são da empresa.
- Descartar o rascunho da empresa: só ADM-Cliente.
- `atualizado_por` guarda o último editor; cada troca de editor gera
  `assessment_editado` no `audit_log` (sem as respostas).
- Salvamento com versão (`atualizado_em`): se um colega salvou antes, a tela
  pede para recarregar em vez de sobrescrever.
- Quem sai da empresa ou vira RO perde a edição (e, ao sair, a leitura) na hora.
- Apagar uma empresa com assessments é recusado (antes o assessment virava
  pessoal de quem o iniciou).
- O acesso ao Self da empresa é liberado na ficha da empresa no backoffice
  (`admin_conceder_direito_empresa`).

### Transferir Self pessoal para a empresa

`admin_transferir_assessment_empresa(assessment, empresa, motivo)` (migração
`20261104130000_transferir_assessment.sql`), na ficha do usuário no backoffice.
Só super-admin com MFA; só assessment pessoal; o dono precisa ser ADM ou
RW-Cliente da empresa; rascunho só entra se a empresa não tiver outro do mesmo
setor. Respostas, resultado e autor não mudam; a conversa continua só da pessoa.
Auditado como `assessment_transferido` com o motivo.

## Excluir empresa e excluir usuário (24/11/2026)

Migração `20261124100000_exclusoes.sql`. Só super-admin com MFA, no backoffice.

- **Excluir empresa** (ficha da empresa, seção "Excluir empresa"):
  `admin_excluir_empresa(empresa, nome digitado, motivo)`. O nome digitado precisa
  conferir com o da empresa (ignora caixa, acento e espaços). Numa transação só,
  apaga o Deep (reuniões, falas, respostas, evidências, relatórios e escuta), o
  Self da empresa (resultados, conversas e escuta), vínculos, atribuições,
  convites e acessos. As contas das pessoas continuam. As tabelas do Deep são
  "somente inserção" por gatilho; a exclusão liga a chave local `iron.purga`
  (como a retenção faz com `iron.deep_retencao`). Auditado como
  `empresa_excluida`, com nome, motivo e contagens.
- **Excluir usuário** (ficha do usuário, seção "Excluir conta"):
  `admin_autorizar_exclusao_usuario(usuário, e-mail digitado, motivo)` confere o
  e-mail, recusa a própria conta e super-admin e registra
  `usuario_exclusao_autorizada`; o servidor apaga a conta no Auth (chave
  secreta); `admin_registrar_exclusao_usuario(usuário)` só registra
  (`usuario_excluido`, sem nome nem e-mail) se a conta sumiu e houve
  autorização. Pode ser repetido sem duplicar, se falhar depois do Auth.
- **Self da empresa sobrevive à conta de quem o iniciou**: `assessments.user_id`
  passou a ser `ON DELETE SET NULL`; o Self pessoal sai junto com a conta
  (gatilho `profiles_apagar_assessments_pessoais`). Vale também para a exclusão
  por pedido LGPD.
- Tirar uma pessoa da empresa (sem apagar a conta) continua com o ADM-Cliente
  (`/empresa`) ou o super-admin (ficha da empresa).

## Área da empresa (24/11/2026)

`/empresas` e `/empresas/[id]`: cadastro, pessoas, Self, Deep e resumo da
empresa numa página. Cada leitura usa a sessão de quem abriu (RLS): ADM, RW e
RO-Cliente veem a própria empresa; Equipe IRON, as que atende; super-admin,
todas. A lista de pessoas aparece para o ADM-Cliente (com e-mail) e para o
super-admin. Empresa fora do alcance dá 404. As contagens do Deep vêm de
`empresa_resumo_deep(empresa)`: o ADM-Cliente vê só relatórios publicados (não
lê `deep_assessments`); quem conduz vê também as reuniões.

## Ações do Self na tela (24/11/2026)

- **Continuar**: abre o rascunho. **Parar** não é uma ação: tudo é salvo a cada
  resposta; o link de voltar diz "Parar e voltar (fica salvo)".
- **Cancelar assessment**: descarta o rascunho (`descartar_rascunho`, já existente).
- **Excluir** um Self (rascunho ou concluído), com resultado, conversas e escuta em
  cascata: `excluir_assessment(assessment)`. Pessoal: só o dono com conta ativa.
  Da empresa: só o ADM-Cliente. Super-admin com MFA: qualquer um. Um Deep que usava
  o Self perde só o vínculo. Auditado como `assessment_excluido`.
- **Excluir cadastro de empresa do Self**: `excluir_empresa_cadastro(empresa)`, só
  quem cadastrou (ou super-admin com MFA). Os assessments perdem só o vínculo e
  mantêm a cópia dos dados. Auditado como `cadastro_empresa_excluido` (só o nome).
- "Não existe" e "não é seu" dão a mesma resposta, para não confirmar ids.
- Testes: `supabase/tests/assessment_acoes_test.sql`.
