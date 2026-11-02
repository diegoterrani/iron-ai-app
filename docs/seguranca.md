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

## Dependências e auditoria

`npm audit --omit=dev --audit-level=high` roda no CI. Em 02/11/2026 há um alerta
moderado de `minimatch` só na cadeia de desenvolvimento do ESLint (não vai para
produção); o Dependabot acompanha a correção.
