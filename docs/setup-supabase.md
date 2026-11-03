# Configuração do Supabase e dos logins (fase 1)

Passo a passo para o Terrani. **Segredos nunca passam pelo Claude nem entram
no repositório**: são colados direto no painel do Supabase ou da Vercel.

## 1. Projeto

| Item | Valor |
| --- | --- |
| Organização | iron@iron-security.com's Org (Pro) |
| Nome | `iron-ai-app` |
| Região | South America (São Paulo), `sa-east-1` |
| Senha do banco | gerada pelo painel, guardada só com o Terrani |

Validação: o projeto aparece como "Healthy" no painel.

## 2. Migrações

```bash
npx supabase link --project-ref <ref-do-projeto>
npx supabase db push
```

Validação: tabela `public.profiles` existe com RLS ligado.

## 3. Auth → Settings

| Configuração | Valor |
| --- | --- |
| Site URL | `https://app.iron-ai.io` |
| Redirect URLs | `https://app.iron-ai.io/**`, URLs de preview da Vercel, `http://localhost:3000/**` |
| Confirm email | ligado |
| Minimum password length | 12 |
| Leaked password protection | ligado |
| Secure email change | ligado |
| MFA (TOTP) | ligado |
| Manual linking | desligado (união só por e-mail verificado) |

## 4. Templates de e-mail (Auth → Email Templates)

- Confirm signup: `{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=email`
- Reset password: `{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=recovery&next=/redefinir-senha`
- Invite user: `{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=invite`

SMTP (Auth → SMTP Settings): Resend, remetente do domínio iron-ai.io.

## 5. Provedores

**Google** (Google Cloud Console → APIs & Services → Credentials → OAuth client ID, tipo Web):
- Authorized redirect URI: `https://<ref>.supabase.co/auth/v1/callback`
- Tela de consentimento externa, escopos `email`, `profile`, `openid`.
- Client ID e Secret em Supabase → Auth → Providers → Google.

**Microsoft Entra ID** (Entra admin center → App registrations → New):
- Supported account types: contas de qualquer diretório organizacional (multi-tenant, sem contas pessoais).
- Redirect URI (Web): `https://<ref>.supabase.co/auth/v1/callback`
- Certificates & secrets → novo client secret.
- Token configuration → optional claims `email` e `xms_edov` no ID token.
- Supabase → Auth → Providers → Azure: Client ID, Secret, Tenant URL `https://login.microsoftonline.com/organizations`.

## 6. Variáveis de ambiente (Vercel → iron-ai-app → Settings → Environment Variables)

| Variável | Onde pegar | Ambientes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | todos |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → API Keys → publishable | todos |
| `NEXT_PUBLIC_SITE_URL` | `https://app.iron-ai.io` | produção (preview usa a URL do preview) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare → Turnstile → widget para `app.iron-ai.io` | todos |
| `TURNSTILE_SECRET_KEY` | mesmo widget (secreta) | todos, marcada como Sensitive |
| `TURNSTILE_EXPECTED_HOSTNAME` | `app.iron-ai.io` | produção |

A chave secreta do Supabase (service role) **não** entra nesta fase.
