import { describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "@/lib/security/turnstile";

const config = { secret: "segredo-de-teste", expectedHostname: "app.iron-ai.io" };

function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("verifyTurnstile", () => {
  it("aprova quando success e hostname conferem", async () => {
    const f = fakeFetch({ success: true, hostname: "app.iron-ai.io" });
    expect(await verifyTurnstile("tok", "1.2.3.4", config, f)).toBe(true);
    const [, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const sent = init.body as URLSearchParams;
    expect(sent.get("secret")).toBe("segredo-de-teste");
    expect(sent.get("remoteip")).toBe("1.2.3.4");
  });

  it("reprova hostname diferente (token roubado de outro site)", async () => {
    expect(await verifyTurnstile("tok", null, config, fakeFetch({ success: true, hostname: "evil.com" }))).toBe(false);
  });

  it("reprova success false", async () => {
    expect(await verifyTurnstile("tok", null, config, fakeFetch({ success: false }))).toBe(false);
  });

  it("reprova HTTP de erro", async () => {
    expect(await verifyTurnstile("tok", null, config, fakeFetch({}, 500))).toBe(false);
  });

  it("falha fechado se a rede cair", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("rede");
    }) as unknown as typeof fetch;
    expect(await verifyTurnstile("tok", null, config, f)).toBe(false);
  });

  it.each([undefined, null, "", 123, "x".repeat(3000)])("reprova token inválido %j sem chamar a rede", async (tok) => {
    const f = fakeFetch({ success: true, hostname: "app.iron-ai.io" });
    expect(await verifyTurnstile(tok, null, config, f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
