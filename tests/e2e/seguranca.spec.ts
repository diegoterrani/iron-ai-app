import { expect, test } from "@playwright/test";

/**
 * Fase 0: prova que os cabeçalhos de segurança e a CSP com nonce estão
 * ativos e que a página funciona sob a CSP (nenhuma violação no console).
 */

const FIXED_HEADERS: Record<string, RegExp> = {
  "strict-transport-security": /max-age=63072000/,
  "x-frame-options": /^DENY$/,
  "x-content-type-options": /^nosniff$/,
  "referrer-policy": /^strict-origin-when-cross-origin$/,
  "cross-origin-opener-policy": /^same-origin$/,
  "x-robots-tag": /noindex/,
};

test("página inicial envia cabeçalhos de segurança e CSP com nonce", async ({ request }) => {
  const res = await request.get("/");
  expect(res.status()).toBe(200);
  const headers = res.headers();

  for (const [name, pattern] of Object.entries(FIXED_HEADERS)) {
    expect(headers[name], name).toMatch(pattern);
  }
  expect(headers["x-powered-by"]).toBeUndefined();

  const csp = headers["content-security-policy"];
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain("unsafe-inline");
});

test("cada requisição recebe um nonce diferente", async ({ request }) => {
  const nonceOf = async () =>
    (await request.get("/")).headers()["content-security-policy"].match(/'nonce-([^']+)'/)?.[1];
  const [a, b] = [await nonceOf(), await nonceOf()];
  expect(a).toBeTruthy();
  expect(a).not.toEqual(b);
});

test("página renderiza sem violação de CSP", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (/Content Security Policy|Refused to/i.test(msg.text())) violations.push(msg.text());
  });
  page.on("pageerror", (err) => violations.push(err.message));

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Em construção.");
  await page.waitForLoadState("networkidle");
  expect(violations).toEqual([]);
});

test("health responde ok sem cache e sem detalhes internos", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
  expect(res.headers()["cache-control"]).toContain("no-store");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
});
