import { expect, test, type Page } from "@playwright/test";

/**
 * Fase 1 sem Supabase real: telas sob CSP estrita, proteção de rotas e
 * anti open redirect. O login de ponta a ponta entra quando o projeto
 * Supabase de teste existir.
 */

function collectCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (/Content Security Policy|Refused to/i.test(msg.text())) violations.push(msg.text());
  });
  page.on("pageerror", (err) => violations.push(err.message));
  return violations;
}

for (const [path, heading] of [
  ["/entrar", "Entrar"],
  ["/cadastro", "Criar conta"],
  ["/recuperar-senha", "Recuperar senha"],
  ["/verifique-email", "Verifique seu e-mail"],
] as const) {
  test(`${path} renderiza sem violação de CSP`, async ({ page }) => {
    const violations = collectCspViolations(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await page.waitForLoadState("networkidle");
    expect(violations).toEqual([]);
  });
}

test("entrar mostra Google, Microsoft e formulário com rótulos", async ({ page }) => {
  await page.goto("/entrar");
  await expect(page.getByRole("button", { name: "Continuar com Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuar com Microsoft" })).toBeVisible();
  await expect(page.getByLabel("E-mail")).toHaveAttribute("autocomplete", "email");
  await expect(page.getByLabel("Senha")).toHaveAttribute("type", "password");
});

for (const path of ["/painel", "/redefinir-senha", "/aguardando-aprovacao", "/admin", "/verificar-mfa", "/conta/seguranca", "/configurar-mfa"]) {
  test(`${path} sem login redireciona para entrar`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const location = new URL(res.headers()["location"], "http://x");
    expect(location.pathname).toBe("/entrar");
    expect(location.searchParams.get("next")).toBe(path);
    expect(res.headers()["content-security-policy"]).toContain("'nonce-");
  });
}

test("parâmetro next externo é descartado no formulário", async ({ page }) => {
  await page.goto("/entrar?next=//evil.com");
  await expect(page.locator('input[name="next"]').first()).toHaveValue("/painel");
});

test("callback sem código volta para entrar com erro", async ({ request }) => {
  const res = await request.get("/auth/callback?next=https://evil.com", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(new URL(res.headers()["location"]).pathname).toBe("/entrar");
});

test("confirmar com tipo inválido volta para entrar", async ({ request }) => {
  const res = await request.get("/auth/confirmar?token_hash=abc&type=magiclink", { maxRedirects: 0 });
  expect(new URL(res.headers()["location"]).searchParams.get("erro")).toBe("link");
});

test("404 também sai com nonce na CSP", async ({ request }) => {
  const res = await request.get("/auth/nao-existe");
  expect(res.status()).toBe(404);
  expect(res.headers()["content-security-policy"]).toContain("'nonce-");
});

for (const path of ["/admin", "/admin/usuarios", "/admin/empresas", "/admin/auditoria", "/admin/usuarios/qualquer", "/empresa"]) {
  test(`${path} exige login`, async ({ page }) => {
    await page.goto(path);
    const url = new URL(page.url());
    expect(url.pathname).toBe("/entrar");
    expect(url.searchParams.get("next")).toBe(path);
  });
}

test("página inicial leva para entrar e criar conta", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("main").getByRole("link", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/cadastro$/);
  await page.goto("/");
  await page.locator(".home-ctas").getByRole("link", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entrar");
});
