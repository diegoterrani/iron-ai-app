import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { executarTurno, parametros, type ChamarLLM } from "@/lib/assessment/agente/conversa";
import { agente06, executarFerramenta06, montarPrompt06, type EstadoAgente06 } from "@/lib/assessment/agente/v06";
import { montarQuestionario06 } from "@/lib/assessment/v06/self";

/**
 * Agente do Self 0.6 (skill do Self) com a API simulada: nenhuma chamada sai
 * da máquina. O que o modelo propõe só entra no rascunho se passar pela mesma
 * validação do formulário.
 */
const q = montarQuestionario06();
const vazio: EstadoAgente06 = { setor: "food_service", respostas: {}, empresa: {} };

function resposta(content: Anthropic.Beta.BetaContentBlock[], stop: Anthropic.Beta.BetaStopReason = "end_turn"): Anthropic.Beta.BetaMessage {
  return {
    id: "msg_teste",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Beta.BetaMessage;
}
const texto = (t: string) => ({ type: "text", text: t, citations: null }) as unknown as Anthropic.Beta.BetaContentBlock;
const ferramenta = (name: string, input: unknown) => ({ type: "tool_use", id: `tu_${name}`, name, input }) as unknown as Anthropic.Beta.BetaContentBlock;

describe("ferramentas do agente 0.6", () => {
  it("grava o retrato econômico e devolve o aprofundamento", () => {
    const r = executarFerramenta06(q, "registrar_respostas", {
      respostas: {
        linhas_vermelhas: ["receitas"],
        receita_valor: 110_000_000,
        pessoas: "101 a 500",
        divisao: { restaurantes: 60, institucional: 40 },
        folha: "20 a 25%",
        custo: "30 a 35%",
        contratacoes: "30 a 50% do quadro",
        margem: "5 a 10%",
        dor: "compras",
      },
    }, vazio);
    expect(r.erro).toBe(false);
    expect(r.estado.respostas.formato).toBe("0.6");
    const corpo = JSON.parse(r.conteudo);
    expect(corpo.aprofundar[0]).toMatchObject({ pergunta: "cotacao", respondida: false });
    expect(corpo.aprofundar.length).toBe(3);
  });

  it("mescla o aprofundamento e troca faixa por valor exato", () => {
    const um = executarFerramenta06(q, "registrar_respostas", { respostas: { folha: "20 a 25%", nucleo: { sobra: "não medimos" } } }, vazio);
    const dois = executarFerramenta06(q, "registrar_respostas", { respostas: { folha_exata: 24, nucleo: { escala: "planilha" } } }, um.estado);
    expect(dois.estado.respostas.folha).toBeUndefined();
    expect(dois.estado.respostas.folha_exata).toBe(24);
    expect(dois.estado.respostas.nucleo).toEqual({ sobra: "não medimos", escala: "planilha" });
  });

  it("recusa valor fora da lista e campos que o agente não pode gravar", () => {
    expect(executarFerramenta06(q, "registrar_respostas", { respostas: { margem: "30%" } }, vazio).erro).toBe(true);
    const r = executarFerramenta06(q, "registrar_respostas", { respostas: { setor: "outro", formato: "0.5", pessoas: "até 20" } }, vazio);
    expect(r.erro).toBe(false);
    expect(r.estado.respostas).toMatchObject({ formato: "0.6", setor: "food_service", pessoas: "até 20" });
    expect(JSON.parse(r.conteudo).campos_ignorados).toEqual(["setor", "formato"]);
  });

  it("não grava CNPJ pela conversa e pede o campo seguro", () => {
    expect(executarFerramenta06(q, "registrar_empresa", { empresa: { nome: "Rede X", cnpj: "11222333000181" } }, vazio).erro).toBe(true);
    const pedido = executarFerramenta06(q, "pedir_campo_seguro", { campo: "cnpj" }, vazio);
    expect(pedido.sinal).toEqual({ tipo: "campo_seguro", campo: "cnpj" });
  });

  it("só mostra o resumo sem pendências e esconde CNPJ e telefone no estado", () => {
    expect(JSON.parse(executarFerramenta06(q, "mostrar_resumo", {}, vazio).conteudo).mostrado).toBe(false);
    const estado = executarFerramenta06(q, "ver_estado", {}, { ...vazio, empresa: { cnpj: "11222333000181", contato_telefone: "11999990000" } });
    expect(estado.conteudo).not.toContain("11222333000181");
    expect(estado.conteudo).not.toContain("11999990000");
  });

  it("pede conferência quando a divisão da receita não soma 100%", () => {
    const r = executarFerramenta06(q, "registrar_respostas", { respostas: { divisao: { restaurantes: 50, eventos: 20 } } }, vazio);
    expect(JSON.parse(r.conteudo).conferir[0]).toMatch(/70%/);
  });
});

describe("prompt do agente 0.6", () => {
  const p = montarPrompt06(q);

  it("segue a skill: não calcula, aceita não sei e começa pelo intocável", () => {
    expect(p).toMatch(/Você não calcula nada/);
    expect(p).toMatch(/"Não sei" é resposta válida/);
    expect(p).toMatch(/Bloco A, o que é intocável/);
    expect(p).toMatch(/10 minutos/);
  });

  it("não leva taxas nem números de ganho ao modelo", () => {
    expect(p).not.toMatch(/0\.0125|taxa_por_segmento|fator/);
  });

  it("é igual em todas as conversas (cache de prompt)", () => {
    const a = parametros(agente06(q), [{ role: "user", content: "a" }]);
    const b = parametros(agente06(montarQuestionario06()), [{ role: "user", content: "b" }]);
    expect(a.system).toEqual(b.system);
    expect(a.tools).toEqual(b.tools);
  });
});

describe("turno do agente 0.6", () => {
  it("registra pela ferramenta e termina com texto", async () => {
    const roteiro = [
      resposta([texto("Anotado."), ferramenta("registrar_respostas", { respostas: { contratacoes: "não sei" } })], "tool_use"),
      resposta([texto("Anotado: não sabe.\n---\nE a margem?")]),
    ];
    const chamar: ChamarLLM = async () => roteiro.shift() as Anthropic.Beta.BetaMessage;
    const t = await executarTurno({ agente: agente06(q), historico: [], entrada: "não sei", estado: vazio, chamar });
    expect(t.fim).toBe("ok");
    expect(t.estado.respostas.contratacoes).toBe("não sei");
    expect(t.alterou).toBe(true);
  });
});
