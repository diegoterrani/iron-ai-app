import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Regressão: ao chegar em /entrar por navegação interna (ex.: depois de "Sair"),
 * o widget não aparecia e o reset() lançava erro, derrubando a tela em
 * "Algo deu errado". O script real é trocado por uma imitação sem rede.
 */
const stub = readFileSync(join(__dirname, "fixtures", "turnstile-stub.js"), "utf8");

test.beforeEach(async ({ page }) => {
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({ contentType: "text/javascript", body: stub }),
  );
});

test("widget aparece após navegação interna e o envio não derruba a tela", async ({ page }) => {
  const erros: string[] = [];
  page.on("pageerror", (err) => erros.push(err.message));

  await page.goto("/cadastro");
  await expect(page.locator("input[name=cf-turnstile-response]")).toHaveCount(1);

  // Navegação interna: o script já está carregado.
  await page.getByRole("link", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/entrar/);
  await expect(page.locator("input[name=cf-turnstile-response]")).toHaveCount(1);

  await page.getByLabel("E-mail").fill("teste@exemplo.com");
  await page.getByLabel("Senha").fill("uma-senha-bem-longa-123");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();

  // Sem rede para a Cloudflare o servidor recusa (falha fechada) e o widget renova.
  await expect(page.locator("form .notice-error")).toContainText("robô");
  await expect(page.getByRole("heading", { name: "Algo deu errado" })).toHaveCount(0);
  await expect(page.locator("input[name=cf-turnstile-response]")).toHaveCount(1);
  expect(erros).toEqual([]);
});
