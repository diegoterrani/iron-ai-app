import { describe, expect, it } from "vitest";
import { canalDoBloco, proximoSeq, rotularBloco } from "@/lib/escuta/papeis";

const bloco = "Sala · voz 1: Quantos funcionários vocês têm?\nSala · voz 2: Uns duzentos.\nRemoto: Duzentos e dez.";

describe("papéis na escuta", () => {
  it("presencial: a voz marcada é o consultor, as outras são o cliente", () => {
    expect(rotularBloco(bloco, { chamada: false, vozConsultor: 0 })).toBe(
      "Consultor: Quantos funcionários vocês têm?\nCliente (voz 2): Uns duzentos.\nCliente: Duzentos e dez.",
    );
  });

  it("presencial sem marcação: mantém as vozes sem dizer quem é quem", () => {
    expect(rotularBloco(bloco, { chamada: false, vozConsultor: null })).toBe(
      "Sala (voz 1): Quantos funcionários vocês têm?\nSala (voz 2): Uns duzentos.\nCliente: Duzentos e dez.",
    );
  });

  it("por chamada: microfone é o consultor e a aba é o cliente", () => {
    expect(rotularBloco("Sala: Qual a margem?\nRemoto: Uns oito por cento.", { chamada: true, vozConsultor: null })).toBe(
      "Consultor: Qual a margem?\nCliente: Uns oito por cento.",
    );
  });

  it("não reescreve texto que só parece rótulo no meio da fala", () => {
    expect(rotularBloco("Sala: ele disse Remoto: nada", { chamada: true, vozConsultor: null })).toBe("Consultor: ele disse Remoto: nada");
  });

  it("canal do bloco e numeração crescente sem colisão", () => {
    expect(canalDoBloco("Remoto: a\nRemoto: b")).toBe("remoto");
    expect(canalDoBloco(bloco)).toBe("sala");
    const agora = Date.UTC(2026, 10, 21, 3);
    const a = proximoSeq(0, agora);
    expect(a).toBeGreaterThan(0);
    expect(proximoSeq(a, agora)).toBe(a + 1);
    expect(proximoSeq(a, agora + 60_000)).toBeGreaterThan(a + 1);
  });
});
