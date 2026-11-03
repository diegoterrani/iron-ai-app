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

- **Cache Components / PPR desligados.** A casca estática pré-renderizada no
  build sai sem nonce e a CSP bloqueia os scripts. Área logada é por usuário,
  então o ganho seria pequeno.
- **Sem `style` inline em JSX.** A CSP não libera atributos `style`; use classes.
  Pelo mesmo motivo, SVG estático usa `<img>` e não `next/image`.
- **Fontes locais** (`next/font/local`), sem Google Fonts: `font-src 'self'` e
  nenhum dado do visitante enviado a terceiros.
- **Novas origens externas** (Supabase, Turnstile, Stripe) entram em `buildCsp`
  explicitamente, na fase em que forem usadas, nunca por curinga.

## Dependências e auditoria

`npm audit --omit=dev --audit-level=high` roda no CI. Em 02/11/2026 há um alerta
moderado de `minimatch` só na cadeia de desenvolvimento do ESLint (não vai para
produção); o Dependabot acompanha a correção.
