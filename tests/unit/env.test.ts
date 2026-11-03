import { describe, expect, it } from "vitest";
import { siteUrlValidaParaProducao } from "@/lib/env";

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
