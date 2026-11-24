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
| Quem não é analista abrir as telas `/deep` | Layout devolve 404 para quem não tem papel super-admin ou Equipe IRON; as leituras passam pelo RLS (`deep.conduzir` na empresa) e as ações pelas funções `deep_*`, que conferem permissão e MFA de novo | `auth.spec.ts` (sem login) e `deep_test.sql` |
| Analista se passar pelo app nas mensagens ao agente | A Server Action tira o prefixo `[Aviso do app]` do texto digitado; avisos (abertura e pedido de encerramento) são montados só no servidor | `deep-tela.test.ts` |
| Reabrir a tela gastar turno | A abertura automática da reunião só chama o agente quando a reunião não tem falas | revisão de código |
| Falas da reunião no log | O log do turno leva ids, tamanho do texto, contagem de dados mascarados, itens gravados e tokens; nunca o texto | revisão de código |
| Correção manual gravar valor fora do roteiro | `corrigirResposta` converte e valida com `validarValor` (mesmas regras do agente) antes de chamar `deep_registrar_respostas`; a versão anterior fica no histórico | `deep-tela.test.ts` |
| Transcrição renderizada como HTML | Falas e resumo exibidos como texto puro pelo React (sem `dangerouslySetInnerHTML`) | revisão de código |

## Escuta da reunião no Deep (20/11/2026, banco)

O analista pode ligar, de forma opcional, a escuta da reunião: o áudio é transcrito fora do banco (Worker da Cloudflare) e chega em blocos, e o agente do Deep separa o que responde ao roteiro da conversa paralela. Migração `20261120200000_deep_escuta.sql`; esta parte é só o banco (agente, tela e relatório vêm em PRs seguintes).

O navegador do analista recebe os blocos do Worker e os entrega ao servidor por Server Action, que grava pelas funções `deep_escuta_*`. O Worker não tem credencial do banco.

| Risco | Controle | Teste |
| --- | --- | --- |
| Escutar sem os participantes saberem | A escuta começa desligada e o banco só a liga depois de `deep_escuta_consentir` (lista de participantes e versão do texto lido, auditado). Uma constraint impede reunião com escuta ligada sem consentimento. Cada reunião precisa do seu consentimento | `deep_escuta_test.sql` |
| Navegador ligar a escuta, gravar blocos ou respostas | Mesmas regras do Deep: tabelas só com `select`, funções `deep_escuta_*` só para `service_role`, com analista e MFA conferidos no banco | `deep_escuta_test.sql` |
| Modelo ou navegador forjar a origem da resposta ou a pergunta marcada | A origem (`digitacao` ou `escuta`) é parâmetro do servidor, não campo da resposta (campo extra é recusado). A pergunta marcada de cada bloco vem da reunião, não do navegador | `deep_escuta_test.sql` |
| Resposta ouvida com pouca certeza virar dado do relatório | Vai para `deep_escuta_confirmar` e só vira resposta quando o analista confirma (`deep_escuta_resolver`, mesma transação, confiança alta). A reunião não encerra com itens a confirmar | `deep_escuta_test.sql` |
| Perder o que foi captado ao corrigir | Resposta captada corrigida pela digitação fica como `substituida` com origem `escuta` | `deep_escuta_test.sql` |
| Reescrever ou apagar a transcrição ou o consentimento | Blocos, consentimentos e itens a confirmar só aceitam inserção (gatilhos valem para o dono das tabelas); o bloco só muda para "processado" | `deep_escuta_test.sql` |
| Reenvio depois de queda duplicar fala | Bloco repetido (mesmo `seq` na reunião) é ignorado | `deep_escuta_test.sql` |
| Custo do LLM e disco sem teto na escuta | 300 turnos por reunião com escuta (120 sem), 5000 blocos por reunião, 20 blocos por chamada, texto de bloco até 4000 caracteres | `deep_escuta_test.sql` |
| Guardar transcrição além do combinado | `deep_apagar_transcricoes_expiradas` também apaga os blocos e o trecho dos itens a confirmar (12 meses após o fim do contrato); consentimentos e itens ficam | `deep_escuta_test.sql` |
| Dado sensível (CPF, cartão, conta) gravado no bloco | O servidor aplica `mascararDadosSensiveis` antes de gravar o bloco, como na digitação. O banco não consegue reconhecer o dado, então este controle é de código e é coberto por teste (`tests/unit/deep-escuta.test.ts`). Marcadores `[Escuta]` e `[Aviso do app]` ditos em voz alta também são neutralizados | PR 2 (feito) |
| Equipe IRON de outra empresa ou cliente ler a transcrição | RLS `deep.conduzir` na empresa do Deep; ADM-Cliente não lê blocos nem itens a confirmar | `deep_escuta_test.sql` |
| Exclusão da conta do analista travar nos registros imutáveis | `registrado_por` e `fechada_por` viram nulo e os gatilhos aceitam só essa mudança | `deep_escuta_test.sql` |

Blocos ainda não processados quando a reunião é encerrada ficam guardados, marcados como não processados, e seguem a mesma retenção. O encerramento não depende do agente estar disponível.

## Escuta no Self assessment (21/11/2026, banco)

O cliente pode ligar, de forma opcional, o áudio na conversa do Self. Pergunta a pergunta: a pessoa responde falando e o texto transcrito vira a mensagem dela na conversa. Fluido ou ambos: escuta contínua de uma reunião da equipe, em blocos, de onde o agente tira as respostas. O agente só escuta (não fala). Migração `20261121100000_self_escuta.sql`; esta parte é só o banco (agente e tela vêm nos PRs seguintes).

| Risco | Controle | Teste |
| --- | --- | --- |
| Escutar sem as pessoas saberem | Começa desligada. Ligar exige `self_escuta_consentir` (versão do texto lido e quantas pessoas estavam presentes, auditado). O consentimento vale 8 horas; vencido, o banco trata a escuta como desligada até um novo consentimento | `self_escuta_test.sql` |
| Navegador ligar a escuta, gravar blocos ou forjar origem | Tabelas só com `select`; funções `self_escuta_*` só para `service_role`, recebendo a pessoa e o MFA | `self_escuta_test.sql` |
| Usar a escuta sem poder editar ou sem ter comprado o Self | Toda função confere `pode_editar_assessment` e o direito ao Self da pessoa (pessoal ou da empresa de que participa). Revogar o direito para a escuta na hora | `self_escuta_test.sql` |
| Colega da empresa ler a transcrição de outra pessoa | A escuta é de quem a ligou (assessment + pessoa), como a conversa. A origem das respostas é parte do assessment e segue o RLS dele | `self_escuta_test.sql` |
| Custo de transcrição e disco sem teto | O servidor reserva minutos antes de emitir o token de transcrição: até 30 por vez e 240 por pessoa e assessment. Até 3000 blocos, 20 por chamada, 4000 caracteres por bloco | `self_escuta_test.sql` |
| Resposta ouvida com pouca certeza virar dado do resultado | Vai para `self_escuta_confirmar`; só a pessoa que ligou a escuta confirma. O Self não conclui com item pendente (gatilho em `assessments`, vale até para escrita direta) | `self_escuta_test.sql` |
| Origem da resposta forjada pelo modelo | O servidor registra a origem (`escuta` ou `escuta_confirmada`) com o valor gravado; o relatório compara com o valor atual para saber se foi editado depois | `self_escuta_test.sql` |
| Reescrever transcrição ou consentimento | Texto do bloco e consentimento são imutáveis; o bloco só muda para processado | `self_escuta_test.sql` |
| Guardar transcrição além do combinado | `self_escuta_apagar_expiradas` apaga blocos com mais de 90 dias e o trecho dos itens a confirmar (mesma retenção da conversa); consentimentos e itens ficam | `self_escuta_test.sql` |
| Dado sensível dito em voz alta | O servidor mascara CPF, CNPJ, cartão, banco e Pix antes de gravar o bloco e antes de a fala ditada entrar na conversa; marcadores do app ditos em voz alta são removidos (controle de código) | `tests/unit/self-escuta.test.ts` |
| Modelo gravar algo que ninguém disse, ou obedecer instrução falada | Cada campo gravado precisa de um trecho que exista na transcrição do lote; um trecho falso recusa a chamada inteira. O valor passa pela mesma validação do formulário. A transcrição vai como dado, num agente separado da conversa, sem histórico | `tests/unit/self-escuta.test.ts` |
| Escuta sobrescrever o que alguém salvou ao mesmo tempo | O rascunho só é gravado se a versão não mudou durante o turno; senão nada é marcado e o lote volta | `tests/unit/self-escuta.test.ts` |

### Tela e Worker (PR C, 21/11/2026)

| Risco | Controle | Teste |
| --- | --- | --- |
| Token de transcrição usado além dos minutos reservados | Cada token (10 min) só é emitido depois de reservar os minutos no banco. O Worker encerra a escuta quando o token vence (com 30 s de folga) e só renova com outro token da mesma reunião e pessoa, enviado pelo próprio WebSocket | `escuta/tests`, `tests/unit/escuta-token.test.ts` |
| App e Worker divergirem no formato do token | O teste do app confere o token emitido com o código do próprio Worker | `tests/unit/escuta-token.test.ts` |
| Navegador forjar dados de sessão no Durable Object | O Worker grava sessão, pessoa e validade em cabeçalhos próprios (substituindo qualquer valor enviado) depois de conferir o token; só o Worker alcança o objeto | revisão |
| Identificar a voz das pessoas (biometria) | Não há impressão de voz: a separação de falantes do Nova-3 numera as vozes só dentro da conexão, e "Sou eu" associa um número ao consultor só naquela conexão. Nada da voz é guardado | `escuta/tests/segmentador.test.ts`, `tests/unit/escuta-papeis.test.ts` |
| Fala do consultor virar resposta | Os blocos chegam ao servidor com o papel de cada linha (Consultor ou Cliente). O agente trata a fala do consultor como pergunta; resumo do consultor só vale com confirmação do cliente na fala seguinte | prompt + `tests/unit/self-escuta.test.ts` |
| Microfone liberado em outras páginas | Permissions-Policy libera microfone e captura de aba só em `/assessment/*`; nas demais segue bloqueado | revisão |
| WebSocket para destino arbitrário | CSP `connect-src` lista só o Worker da escuta (sem curinga) | `tests/unit/csp.test.ts` |
| Resposta por voz sem o áudio ligado | O servidor confere no banco o modo e o consentimento antes de aceitar a mensagem "voz" na conversa | revisão |

### Entrevista guiada (21/11/2026)

O áudio do Self virou um fluxo único: tela dividida (perguntas | captação), "Pergunta respondida", resposta consolidada revisada pelo consultor e "Enviar e seguir". Substitui os modos pergunta a pergunta, reunião livre e os dois.

Em 24/11/2026, a pedido do Terrani, a revisão antes do envio saiu: "Pergunta respondida" consolida e já envia à conversa, o assistente registra, confirma o que entendeu e faz a próxima pergunta. A resposta enviada fica à vista no painel e a correção é feita pela conversa (gera nova versão da resposta). A revisão manual só aparece quando o envio falha.

Também em 24/11/2026: a captação do Self deixou de separar consultor e cliente. A tela não pede mais "Sou eu" nem "videochamada"; junta tudo o que foi dito depois da pergunta, e o consolidador tira a resposta pelo conteúdo, venha de quem vier. Leitura da pergunta e das opções não conta como resposta; valor dito em tom de pergunta só vale se alguém confirmar. No Self, a separação de falantes do Nova-3 continua chegando do Worker, mas a tela não usa.

| Risco | Controle | Teste |
| --- | --- | --- |
| Guardar transcrição sem necessidade | A fala captada fica só no navegador. O servidor recebe a fala de uma pergunta para consolidar e não grava; só o texto que o consultor envia entra na conversa (com a retenção dela). A escuta não grava mais blocos | revisão |
| Resposta inventada ou fala do consultor virar resposta | O consolidador só escreve o que o cliente disse ou confirmou; a saída passa por ferramenta obrigatória e limites no código; nada entra no Self sem o clique do consultor em "Pergunta respondida"; o assistente da conversa valida o registro, pede confirmação quando o valor é ambíguo e a resposta enviada fica visível para correção | `tests/unit/self-escuta.test.ts` |
| Dado sensível na consolidação | Máscara na entrada (fala e pergunta) e de novo na saída do modelo; marcadores do app neutralizados; desde 24/11/2026 o consolidador não recebe quem falou (só os trechos, na ordem) | `tests/unit/self-escuta.test.ts` (mutação) |
| Consolidar sem o áudio ligado | O servidor confere no banco o modo e o consentimento antes de chamar o modelo | revisão |

### Modo reunião (24/11/2026)

Terceira aba ao lado de Conversa e Formulário, a pedido do Terrani: a tela mostra a lista de todas as perguntas, a captação corre sem interrupção e, ao encerrar, o servidor lê a reunião inteira de uma vez e responde o que a conversa permite. Usa o modo `fluido` e as funções `self_escuta_*` que já estavam no banco (sem migração nova). O relatório sai pelo formulário de sempre (revisão, cadastro e conclusão), então o motor não muda.

| Risco | Controle | Teste |
| --- | --- | --- |
| Perder a reunião ao recarregar a página | Os trechos são gravados no servidor a cada 15 s (ou 1200 caracteres), já mascarados, em `self_escuta_blocos`, coberto pelo texto de consentimento (90 dias). Reenvio do mesmo `seq` é ignorado | `self_escuta_test.sql` |
| Modelo inventar resposta a partir da reunião inteira | Cada campo gravado precisa de trecho literal da transcrição; trecho falso recusa a chamada. Dúvida vai para "a confirmar", e o Self não conclui com item pendente. A pergunta lida em voz alta pelo consultor não conta como resposta | `tests/unit/self-escuta.test.ts` |
| Reunião longa estourar custo ou tempo | Teto de 600 mil caracteres por compilação (o final excedente fica de fora e a tela avisa), uma chamada por compilação sem nova tentativa, 240 s de limite e `maxDuration` de 300 s na página. Minutos de transcrição seguem o teto de 240 por pessoa e assessment | `tests/unit/self-escuta.test.ts` |
| Compilar com a escuta desligada ou o consentimento vencido | O servidor confere no banco o modo `fluido` antes de chamar o modelo | `tests/unit/self-escuta.test.ts` |
| Compilação sobrescrever o que alguém salvou | Grava só se a versão do rascunho não mudou; em conflito nada é gravado e a tela pede para compilar de novo | `tests/unit/self-escuta.test.ts` |
| Texto da reunião em log | Logs só com contagens (blocos, campos, tokens) e código de rastreio | revisão |
| CNPJ, telefone ou nomes na compilação | Os blocos são mascarados antes de gravar; o prompt não pede cadastro e o CNPJ continua digitado no formulário | `tests/unit/self-escuta.test.ts` |

A escuta ainda não entra na exportação LGPD (`meus_dados`). Fica como pendência: consentimentos e itens a confirmar da própria pessoa.

## Cadastro de empresas do Self (21/11/2026)

No começo do assessment pessoal, a pessoa escolhe uma empresa já cadastrada (com busca) ou cadastra uma nova. Migração `20261121120000_empresas_cadastro.sql`.

| Risco | Controle | Teste |
| --- | --- | --- |
| Ver empresas e contatos de outros clientes | RLS: quem cadastrou e a equipe IRON (super_admin ou equipe_iron, conta ativa e sessão com MFA). Cliente vê só as próprias | `empresas_cadastro_test.sql` |
| Equipe acessar o cadastro sem MFA | `e_equipe_iron()` exige sessão aal2 | `empresas_cadastro_test.sql` (mutação) |
| Navegador gravar no cadastro ou trocar o vínculo direto | Tabela só com `select`; `empresa_id` fora das colunas editáveis do assessment; vínculo só por `vincular_empresa_assessment`, que confere se a pessoa pode editar o rascunho e ver a empresa | `empresas_cadastro_test.sql` |
| Busca com curinga ou injeção | Função SQL com parâmetro (sem montar filtro em texto); `%`, `_` e `\` digitados são escapados; termo até 100 caracteres; no máximo 10 resultados | `empresas_cadastro_test.sql` (mutação) |
| Resultado antigo mudar quando o cadastro mudar | O assessment guarda a própria cópia dos dados; o cadastro só recebe os dados na conclusão | `empresas_cadastro_test.sql` |
| Cadastro bloquear a conclusão | A sincronização na conclusão descarta dado fora do formato (CNPJ incompleto, por exemplo) e nunca lança erro | `empresas_cadastro_test.sql` |
| Contato de cliente ficar depois da exclusão da conta | Excluir a conta de quem cadastrou apaga as empresas dela; o assessment perde só o vínculo | `empresas_cadastro_test.sql` |

## Dependências e auditoria

`npm audit --omit=dev --audit-level=high` roda no CI. Em 02/11/2026 há um alerta
moderado de `minimatch` só na cadeia de desenvolvimento do ESLint (não vai para
produção); o Dependabot acompanha a correção.
