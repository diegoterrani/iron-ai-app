# IRON AI · Área do cliente

Aplicação da área logada da IRON AI em **app.iron-ai.io**: cursos, treinamentos,
blog, fórum, comunidade e assessments Self e Deep dive, com backoffice do
super-admin e RBAC.

O site institucional (iron-ai.io) fica em outro repositório, `iron-ai-site`.

## Stack

| Peça | Uso |
| --- | --- |
| Next.js 16 (App Router, TypeScript) | Aplicação, renderizada no servidor |
| Vercel | Hospedagem (projeto `iron-ai-app`) |
| Supabase (us-east-1) | Auth, Postgres com RLS, Storage (a partir da fase 1) |
| Cloudflare | DNS com proxy, WAF, rate limit |

## Rodar localmente

```bash
nvm use            # Node 22
npm ci
npm run dev        # http://localhost:3000
```

## Verificações

```bash
npm run check      # lint + tipos + testes unitários
npm run build
npm run test:e2e   # sobe o build e testa cabeçalhos/CSP
```

O CI (`.github/workflows/ci.yml`) roda tudo isso em cada pull request.

## Segurança

Ver [docs/seguranca.md](docs/seguranca.md). Segredos só em variáveis de ambiente
da Vercel; nunca no código nem em `.env` versionado.

## Plano

Plano completo (arquitetura, RBAC, backoffice, fases): ver [docs/plano.md](docs/plano.md).
