import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/security/redirect";

describe("safeNextPath (anti open redirect)", () => {
  it.each([
    ["/painel", "/painel"],
    ["/cursos/ia?aba=2#topo", "/cursos/ia?aba=2#topo"],
    ["/a/../b", "/b"],
  ])("aceita caminho interno %j", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "javascript:alert(1)",
    "painel",
    "",
    "/\u0000x",
    "/ok\nSet-Cookie:x",
    "/" + "a".repeat(600),
    null,
    undefined,
    42,
  ])("recusa %j", (input) => {
    expect(safeNextPath(input)).toBe("/painel");
  });

  it("usa o fallback informado", () => {
    expect(safeNextPath("//x", "/redefinir-senha")).toBe("/redefinir-senha");
  });
});
