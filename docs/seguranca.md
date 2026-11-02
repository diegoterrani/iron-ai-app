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

- **Funções na região gru1 (São Paulo)** (`vercel.json`): ficam ao lado do Supabase
  sa-east-1 (menos latência) e o processamento de dados pessoais fica no Brasil.

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

### Convites do Master (fase 3b)

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

## Dependências e auditoria

`npm audit --omit=dev --audit-level=high` roda no CI. Em 02/11/2026 há um alerta
moderado de `minimatch` só na cadeia de desenvolvimento do ESLint (não vai para
produção); o Dependabot acompanha a correção.
