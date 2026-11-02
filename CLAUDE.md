# Convenções do projeto

- Idioma: português (código pode ter nomes em inglês; textos de UI, docs e commits em português).
- Leia `AGENTS.md`: Next.js 16 tem APIs diferentes; consulte `node_modules/next/dist/docs/`.
- Segurança primeiro: nada de `style` inline, `dangerouslySetInnerHTML` ou `unsafe-*` na CSP.
  Toda regra de acesso é aplicada no banco (RLS), a tela só esconde.
- Antes de abrir PR: `npm run check && npm run build && npm run test:e2e`.
- Produção só depois do OK do Terrani; toda mudança passa por PR com preview.
- Plano e fases: `docs/plano.md`. Decisões de segurança: `docs/seguranca.md`.
