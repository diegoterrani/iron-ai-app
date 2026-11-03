import { describe, expect, it } from "vitest";
import { buildCsp, generateNonce } from "@/lib/security/csp";

describe("generateNonce", () => {
  it("gera 128 bits em base64", () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it("não repete em 1.000 chamadas", () => {
    const set = new Set(Array.from({ length: 1000 }, generateNonce));
    expect(set.size).toBe(1000);
  });
});

describe("buildCsp", () => {
  const nonce = generateNonce();

  it("produção: nonce, strict-dynamic, sem unsafe-*", () => {
    const csp = buildCsp({ nonce, isDev: false });
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toMatch(/unsafe-(inline|eval)/);
  });

  it("desenvolvimento: libera só unsafe-eval", () => {
    const csp = buildCsp({ nonce, isDev: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it.each(["", "abc", "x' ; script-src *", "nonce com espaço=="])(
    "recusa nonce malformado: %j",
    (bad) => {
      expect(() => buildCsp({ nonce: bad, isDev: false })).toThrow("Nonce inválido");
    },
  );
});
