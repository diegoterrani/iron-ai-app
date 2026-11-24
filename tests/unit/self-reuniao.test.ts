import { describe, expect, it } from "vitest";
import type { Rascunho06 } from "@/lib/assessment/v06/questionario";
import { contagemDaReuniao, perguntasDaReuniao } from "@/lib/assessment/v06/reuniao";
import { montarQuestionario06 } from "@/lib/assessment/v06/self";

const q = montarQuestionario06();

describe("modo reunião: lista de perguntas", () => {
  it("lista todas as perguntas do roteiro, na ordem, todas pendentes num rascunho vazio", () => {
    const lista = perguntasDaReuniao(q, {});
    // 9 do núcleo fixo + aprofundamento + 3 de prontidão.
    expect(lista).toHaveLength(9 + q.perguntas.length + 3);
    expect(lista[0].campo).toBe("linhas_vermelhas");
    expect(lista.at(-1)?.campo).toBe("patrocinio");
    expect(lista.every((p) => p.situacao === "pendente" && p.valor === null)).toBe(true);
    expect(lista.every((p) => p.opcoes.length > 0)).toBe(true);
    expect(contagemDaReuniao(lista)).toEqual({ total: lista.length, respondidas: 0, aConfirmar: 0 });
  });

  it("mostra o que já foi respondido em texto legível", () => {
    const lv = q.linhasVermelhas[0];
    const seg = q.segmentos[0];
    const dor = q.dores[0];
    const r: Rascunho06 = {
      linhas_vermelhas: [lv.id],
      linhas_vermelhas_outro: "receitas da casa",
      receita_valor: 120_000_000,
      divisao: { [seg.id]: 100 },
      folha_exata: 32.5,
      dor: dor.id,
      nucleo: { [q.perguntas[0].id]: q.perguntas[0].opcoes[0] },
    };
    const lista = perguntasDaReuniao(q, r);
    const por = (campo: string) => lista.find((p) => p.campo === campo)!;
    expect(por("linhas_vermelhas").valor).toBe(`${lv.nome}, receitas da casa`);
    expect(por("receita").valor).toBe("R$ 120.000.000");
    expect(por("divisao").valor).toBe(`${seg.nome} 100%`);
    expect(por("folha").valor).toBe("32,5%");
    expect(por("dor").valor).toBe(dor.nome);
    expect(por(`nucleo.${q.perguntas[0].id}`).situacao).toBe("respondida");
    expect(contagemDaReuniao(lista).respondidas).toBe(6);
  });

  it("a confirmar vence respondida, e faixa e exato contam como a mesma pergunta", () => {
    const r: Rascunho06 = { margem: q.opcoes.margem[0] };
    const lista = perguntasDaReuniao(q, r, ["margem_exata", "receita_faixa", `nucleo.${q.perguntas[0].id}`]);
    const por = (campo: string) => lista.find((p) => p.campo === campo)!;
    expect(por("margem").situacao).toBe("a_confirmar");
    expect(por("receita").situacao).toBe("a_confirmar");
    expect(por(`nucleo.${q.perguntas[0].id}`).situacao).toBe("a_confirmar");
    expect(contagemDaReuniao(lista)).toMatchObject({ respondidas: 0, aConfirmar: 3 });
  });
});
