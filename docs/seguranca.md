# Segurança

## Cabeçalhos (fase 0)

| Cabeçalho | Valor | Onde |
| --- | --- | --- |
| Content-Security-Policy | nonce por requisição + `strict-dynamic`, sem `unsafe-inline` | `src/proxy.ts`, `src/lib/security/csp.ts` |
| Strict-Transport-Security | 2 anos, subdomínios, preload | `next.config.ts` |
| X-Frame-Options / frame-ancestors | `DENY` / `'none'` (anti-clickjacking) | ambos |
| X-Content-Type-Options | `nosniff` | `next.config.ts` |
| Referrer-Policy | `strict-origin-when-cross-origin` | `next.config.ts` |
| Permissions-Policy | câmera, microfone, localização etc. desligados | `next.config.ts` |
| COOP / CORP | `same-origin` | `next.config.ts` |
| X-Robots-Tag | `noindex, nofollow` | `next.config.ts` |
| X-Powered-By | removido | `next.config.ts` |

Provado por `tests/e2e/seguranca.spec.ts`, inclusive "nenhuma violação de CSP no
console".

## Decisões

- **Funções na região iad1 (Washington)** (`vercel.json`): ficam ao lado do Supabase
  us-east-1, onde o Terrani decidiu manter o banco (02/11/2026). Cada página faz
  várias consultas; com funções em São Paulo, cada uma pagaria ~120 ms de ida e volta.
  Dados pessoais ficam nos EUA: a Política de Privacidade precisa citar a
  transferência internacional (LGPD, art. 33).

- **Cache Components / PPR desligados.** A casca estática pré-renderizada no
  build sai sem nonce e a CSP bloqueia os scripts. Área logada é por usuário,
  então o ganho seria pequeno.
- **Sem `style` inline em JSX.** A CSP não libera atributos `style`; use classes.
  Pelo mesmo motivo, SVG estático usa `<img>` e não `next/image`.
- **Fontes locais** (`next/font/local`), sem Google Fonts: `font-src 'self'` e
  nenhum dado do visitante enviado a terceiros.
- **Novas origens externas** (Supabase, Turnstile, Stripe) entram em `buildCsp`
  explicitamente, na fase em que forem usadas, nunca por curinga.

## Autenticação (fase 1)

| Risco | Controle | Teste |
| --- | --- | --- |
| Enumeração de contas | Mesma mensagem para e-mail inexistente e senha errada; cadastro e recuperação sempre respondem igual | revisão de `actions.ts` |
| Robôs / força bruta | Turnstile validado no servidor (hostname conferido, falha fechado) + rate limit do Cloudflare (fase 8) | `tests/unit/turnstile.test.ts` |
| Open redirect | `safeNextPath` só aceita caminho interno | `tests/unit/redirect.test.ts`, e2e |
| Sessão forjada | Proxy usa `getClaims()` (verifica assinatura); páginas usam `getUser()` | e2e de redirecionamento |
| Auto-aprovação | Usuário não tem privilégio na coluna `status`; RLS só deixa ler o próprio perfil | `supabase/tests/perfis_test.sql` |
| Rota nova esquecida aberta | Lista de rotas públicas (permissão); o resto exige login | `tests/unit/rotas.test.ts` |
| Vazamento em log | E-mail mascarado, nunca senha/token; erro com código de rastreio | `src/lib/log.ts` |
| Senha vazada/roubada | MFA por app autenticador (TOTP); quem tem fator ativo só entra com código (aal2), inclusive via Google/Microsoft | e2e de rotas, `codigoValido` |
| Página estática sem nonce | `connection()` no layout raiz: toda página é dinâmica | e2e "404 também sai com nonce" |

Pendente de verificação no preview: o widget do Turnstile sob a CSP (o
sandbox de desenvolvimento não alcança challenges.cloudflare.com).

### Dependências adicionadas na fase 1

| Pacote | Por quê |
| --- | --- |
| `@supabase/ssr`, `@supabase/supabase-js` | Cliente oficial; sessão em cookie HttpOnly (não em localStorage, alvo de XSS) |
| `zod` | Validação de toda entrada antes de tocar o Supabase (OWASP A03) |

## Backoffice (fase 3)

| Risco | Controle | Teste |
| --- | --- | --- |
| Não-admin abrir /admin | Layout pergunta ao banco (`tem_permissao('admin.backoffice')`, exige aal2); quem não pode recebe 404 | e2e de redirecionamento |
| Ação forjada (chamar a server action direto) | Cada action valida com zod e chama uma função `admin_*`, que confere super-admin + MFA por dentro | `supabase/tests/rbac_test.sql`, `backoffice_test.sql` |
| Vazamento de e-mails | E-mail só sai por funções `security definer` restritas a super-admin com MFA; página com teto de 100 linhas | `backoffice_test.sql` |
| Injeção na busca | Parâmetro passado como argumento (sem SQL montado); curingas do LIKE escapados | `backoffice_test.sql` (busca por `%` e `_`) |
| Detalhe do schema na tela | `mensagemErroBanco` só mostra mensagens das nossas funções; o resto vira genérico com código de rastreio | `tests/unit/admin.test.ts` |
| Admin se promover ou se suspender | Recusado no banco; a tela nem mostra os botões na própria ficha | `rbac_test.sql` |
| Ação sem rastro | Gatilhos gravam toda mudança no `audit_log` (só inserção); tela de auditoria lê com RLS | `rbac_test.sql`, `backoffice_test.sql` |

Nenhuma dependência nova na fase 3.

### Convites do ADM-Cliente (fase 3b)

| Risco | Controle | Teste |
| --- | --- | --- |
| Master convidar em outra empresa | `empresa_convidar` exige `tem_permissao('empresa.membros', empresa)` | `convites_test.sql` |
| Passar do número de assentos | Membros + convites pendentes contam; `for update` na empresa evita corrida | `convites_test.sql` |
| Aceitar convite alheio | `aceitar_convite` compara com o e-mail **confirmado** da conta (tabela `auth.users`, não o token) | `convites_test.sql` |
| Conta suspensa se reativar por convite | Aceite recusado para conta suspensa | `convites_test.sql` |
| Descobrir quem tem conta | Mesma resposta ao Master com ou sem conta; quem já tem conta não recebe e-mail novo e aceita dentro do app | revisão de `empresa/actions.ts` |
| Disparo de e-mail em massa | 50 convites por empresa a cada 24 h; convite vale 7 dias | `convites_test.sql` |
| Chave secreta exposta ou mal usada | Só em `src/lib/supabase/admin.ts` (`server-only`), só para `inviteUserByEmail`, só depois do banco autorizar | revisão |

Todos os testes de convite foram validados por mutação (remover cada trava faz o teste falhar).

### Perfis do cliente e assessment da empresa (04/11/2026)

| Risco | Controle | Teste |
| --- | --- | --- |
| ADM-Cliente criar outro ADM (escalada) | `empresa_convidar`, `empresa_adicionar_membro` e `empresa_alterar_papel` só aceitam RW/RO; `convites.role` com `check`; ADM só por `admin_vincular_empresa` | `perfis_cliente_test.sql` |
| ADM alterar o próprio papel ou o de outro ADM | Recusado no banco (`p_user = auth.uid()` e filtro `role in (rw, ro)`) | `perfis_cliente_test.sql` |
| RO-Cliente escrever | RO não tem `assessment.editar`/`responder`; RLS do update, `iniciar_self`, `concluir_self` e `conversa_reservar_turno` exigem a permissão | `perfis_cliente_test.sql` |
| Servidor (chave secreta) agir por quem não pode | `concluir_self` e `conversa_reservar_turno` reconferem `usuario_tem_permissao(pessoa, 'assessment.editar', empresa, mfa)`; MFA vem da sessão | `perfis_cliente_test.sql` |
| Colega sobrescrever respostas | Salvamento só grava se `atualizado_em` for a versão que a tela viu; senão pede para recarregar | revisão de `assessment/actions.ts` |
| Ex-funcionário continuar lendo | Leitura do assessment da empresa só por `assessment.ver` na empresa (autoria não dá acesso) | `perfis_cliente_test.sql` |
| Conversa de uma pessoa vista por colegas | Conversa por pessoa (`assessment_id, user_id`); RLS só o titular | `perfis_cliente_test.sql` |
| Exportação LGPD levar dado da empresa | `meus_dados` exporta só assessments pessoais e a conversa da própria pessoa | `perfis_cliente_test.sql` |
| Apagar empresa e o assessment virar pessoal | FK `on delete restrict` | `perfis_cliente_test.sql` |

Nenhuma dependência nova.

### LGPD (fase 3c)

| Direito / risco | Controle | Teste |
| --- | --- | --- |
| Acesso aos dados (art. 18, II) | `/meus-dados/exportar` devolve JSON de `meus_dados()`, que só lê `auth.uid()`; `no-store` | `lgpd_test.sql` (não vaza dados de terceiros) |
| Eliminação (art. 18, VI) | Titular pede em `/meus-dados`; super-admin conclui em `/admin/lgpd` (prazo de 15 dias sinalizado) | `lgpd_test.sql` |
| Admin apagar conta sem pedido | `admin_autorizar_exclusao` exige pedido pendente do titular; super-admin e a própria conta são recusados | `lgpd_test.sql` (validado por mutação) |
| Pedido marcado como feito sem apagar | `admin_concluir_exclusao` confere que a conta não existe mais no Auth | `lgpd_test.sql` |
| Rastro | Pedido sem FK sobrevive à exclusão; `audit_log` mantido (art. 16, I) | `lgpd_test.sql` |

Vale para conta pendente ou suspensa também (`/meus-dados` exige só login).

## Self assessment (fase 7a)

O motor é determinístico (sem LLM), roda no servidor e tem a mesma saída do motor de referência em Python (`referencia/assessment/`, 200 casos-ouro).

| Risco | Controle | Teste |
| --- | --- | --- |
| Usar sem ter comprado | `iniciar_self` exige `tem_direito` (conta ativa + direito ativo, consultado a cada chamada) | `assessments_test.sql` |
| Cliente forjar resultado ou status | Cliente só tem `update (respostas)` em rascunho próprio; resultado só via `concluir_self`, executável apenas por `service_role` | `assessments_test.sql` |
| Resultado de respostas trocadas no meio | `concluir_self` exige que as respostas gravadas sejam idênticas às calculadas (validado por mutação) | `assessments_test.sql` |
| Alterar resultado depois | Trigger bloqueia update em `assessment_resultados`; recalcular gera outra linha | `assessments_test.sql` |
| Respostas (dado estratégico) no log | Auditoria própria grava só id, setor, empresa e status | `assessments_test.sql` |
| Ver assessment de outra pessoa | RLS: dono, quem tem `assessment.ver` na empresa ou super-admin com MFA | `assessments_test.sql` |
| Abuso de tamanho | `respostas` precisa ser objeto JSON de até 64 KB | `assessments_test.sql` |
| Liberação manual sem rastro | `admin_conceder_direito`/`admin_revogar_direito` exigem super-admin com MFA e entram no histórico da ficha | `assessments_test.sql`, `admin.test.ts` |
| Exclusão LGPD | Assessments e resultados apagam em cascata com a conta | `assessments_test.sql` |
| Chave secreta usada para ler/gravar tabelas | `src/lib/supabase/servidor.ts` expõe só `gravarConclusaoSelf`; o cliente nunca sai do arquivo. A action conclui só depois de ler com a sessão do dono e conferir `tem_direito` | `assessment-questionario.test.ts` |
| Rascunho com campo forjado (setor, status, resultado) | `normalizarRascunho` aceita só as opções do pacote, descarta chaves desconhecidas e grava o setor do assessment | `assessment-questionario.test.ts` |
| Tela e servidor com áreas diferentes na pergunta 6 | Mesma função (`ordenarAreasQ6`) no motor e na tela, comparada nos 200 casos-ouro | `assessment-questionario.test.ts` |
| Respostas no log da Vercel | Actions registram só evento, código de rastreio e versão do motor | revisão de código |

## Deep assessment no app (20/11/2026, banco)

O analista da IRON conduz reuniões com a empresa; os participantes não usam a tela. Migração `20261120120000_deep_assessment.sql`.

| Risco | Controle | Teste |
| --- | --- | --- |
| Cliente ou staff de outra empresa conduzir ou ler a condução | Permissão `deep.conduzir` (super-admin e Equipe IRON, ambos com MFA; Equipe IRON só nas empresas de `staff_assignments`), conferida no banco em cada função e em cada política de RLS | `deep_test.sql` |
| Navegador gravar falas, respostas ou relatórios | Tabelas só com `select` para `authenticated`; toda escrita por funções `deep_*` executáveis só por `service_role`, que recebem o analista e o nível de MFA e conferem a permissão de novo | `deep_test.sql` |
| Reescrever o que foi dito numa reunião | `deep_mensagens` só aceita inserção (gatilho bloqueia update e delete, inclusive do dono das tabelas) | `deep_test.sql` |
| Perder a resposta anterior ao corrigir | Respostas e evidências versionadas: a nova substitui a vigente, a antiga fica como `substituida`; o gatilho só permite essa troca | `deep_test.sql` |
| Alterar relatório depois de gerado | Relatório só pode ser publicado uma vez; nova versão gera outra linha | `deep_test.sql` |
| Cliente ver rascunho de relatório | ADM-Cliente (`deep.relatorio_ver`) lê só relatórios publicados da própria empresa; RW e RO não leem | `deep_test.sql` |
| Custo do LLM sem teto | 120 turnos por reunião e 3000 por Deep, reservados no banco antes de chamar o LLM | `deep_test.sql` |
| Dado pessoal de participante | Participante só com nome e cargo (outras chaves recusadas) | `deep_test.sql` |
| Respostas no log | Auditoria registra quem, quando e quais perguntas, sem os valores | `deep_test.sql` |
| Guardar transcrição além do combinado | `deep_apagar_transcricoes_expiradas` apaga falas e trechos literais 12 meses após o fim do contrato (ou da conclusão/cancelamento, sem contrato); respostas, resumos e relatórios ficam. Agendar no pg_cron diário junto com `conversas_apagar_expiradas` | `deep_test.sql` |
| Exclusão da conta do analista travar nos registros imutáveis | Vínculos de pessoa viram nulo (`on delete set null`) e os gatilhos aceitam só essa mudança | `deep_test.sql` |
| Modelo gravar resposta inventada ou fora do roteiro | `executarFerramentaDeep` valida o lote inteiro pelo roteiro (pergunta existe, tipo, faixa, opção, trecho obrigatório); um item inválido e nada é gravado, o erro volta ao modelo | `deep-agente.test.ts` |
| CPF, CNPJ, cartão ou conta digitados chegarem ao modelo ou à transcrição | `mascararDadosSensiveis` troca por marcador antes de montar a mensagem; a fala gravada já vai mascarada | `deep-agente.test.ts` |
| Modelo ler o banco ou outras reuniões | O agente recebe só o estado resumido e os resumos das reuniões encerradas; grava só pelas ferramentas, que chamam as funções `deep_*` com o analista da sessão | `deep-agente.test.ts` |
| Deep aberto com um roteiro e conduzido com outro | `turnoDaReuniao` recusa quando `pacote_versao` do Deep difere do roteiro carregado | `deep-agente.test.ts` |

## Dependências e auditoria

`npm audit --omit=dev --audit-level=high` roda no CI. Em 02/11/2026 há um alerta
moderado de `minimatch` só na cadeia de desenvolvimento do ESLint (não vai para
produção); o Dependabot acompanha a correção.
