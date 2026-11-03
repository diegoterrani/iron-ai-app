import { describe, expect, it } from "vitest";
import { ConfigError, resolverSiteUrl, siteUrlValidaParaProducao } from "@/lib/env";

describe("siteUrlValidaParaProducao", () => {
  it("aceita o domínio de produção", () => {
    expect(siteUrlValidaParaProducao("https://app.iron-ai.io")).toBe(true);
  });

  it.each([
    ["deploy de preview", "https://iron-ai-app-git-fase-3-convites-iron-security.vercel.app"],
    ["http sem TLS", "http://app.iron-ai.io"],
    ["com caminho", "https://app.iron-ai.io/painel"],
    ["texto inválido", "app.iron-ai.io"],
    ["vazio", ""],
  ])("recusa %s", (_caso, url) => {
    expect(siteUrlValidaParaProducao(url)).toBe(false);
  });
});

describe("resolverSiteUrl", () => {
  const branch = "iron-ai-app-git-auth-url-preview-iron-security.vercel.app";

  it("produção usa a variável, mesmo com endereço de branch presente", () => {
    expect(
      resolverSiteUrl({ VERCEL_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://app.iron-ai.io", VERCEL_BRANCH_URL: branch }),
    ).toBe("https://app.iron-ai.io");
  });

  it("preview usa o endereço da própria branch e ignora a variável", () => {
    expect(
      resolverSiteUrl({ VERCEL_ENV: "preview", NEXT_PUBLIC_SITE_URL: "https://app.iron-ai.io", VERCEL_BRANCH_URL: branch }),
    ).toBe(`https://${branch}`);
  });

  it("local usa a variável, sem barra no fim", () => {
    expect(resolverSiteUrl({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000/" })).toBe("http://localhost:3000");
  });

  it("sem variável fora do preview falha fechado", () => {
    expect(() => resolverSiteUrl({ VERCEL_ENV: "production" })).toThrow(ConfigError);
  });
});

describe("resolverSiteUrl com endereço de branch inválido", () => {
  it("não usa um endereço de branch fora de *.vercel.app", () => {
    expect(() =>
      resolverSiteUrl({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "evil.example.com/x" }),
    ).toThrow(ConfigError);
  });
});
