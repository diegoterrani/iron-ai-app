import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { ChamarLLM } from "@/lib/assessment/agente/conversa";
import { blocoContexto, estadoParaModelo, type EstadoBanco } from "@/lib/assessment/deep/agente/contexto";
import {
  definirFerramentasDeep,
  executarFerramentaDeep,
  validarLoteRespostas,
  type BancoDeep,
  type EvidenciaParaGravar,
  type PendenciaParaGravar,
  type RespostaParaGravar,
} from "@/lib/assessment/deep/agente/ferramentas";
import { mascararDadosSensiveis } from "@/lib/assessment/deep/agente/mascara";
import { montarPromptDeep } from "@/lib/assessment/deep/agente/prompt";
import { ErroReuniao, turnoDaReuniao, type ServidorDeep } from "@/lib/assessment/deep/agente/reuniao";
import { EntradaInvalida, MAX_TEXTO_ANALISTA, executarTurnoDeep } from "@/lib/assessment/deep/agente/turno";
import { roteiroDeep } from "@/lib/assessment/deep/roteiro";

/**
 * Agente do Deep com API e banco simulados: nenhuma chamada sai da máquina.
 * O que se testa é a fronteira de confiança: o que o modelo propõe só chega
 * ao banco se passar pela validação do roteiro, e dado sensível digitado
 * pelo analista não chega ao modelo nem à transcrição.
 */

type Bloco = Anthropic.Beta.BetaContentBlock;
function resposta(content: Bloco[], stop: Anthropic.Beta.BetaStopReason = "end_turn"): Anthropic.Beta.BetaMessage {
  return {
    id: "msg_teste",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 },
  } as unknown as Anthropic.Beta.BetaMessage;
}
const texto = (t: string) => ({ type: "text", text: t, citations: null }) as unknown as Bloco;
const ferramenta = (name: string, input: unknown, id = `tu_${name}`) => ({ type: "tool_use", id, name, input }) as unknown as Bloco;

function apiSimulada(roteiro: Anthropic.Beta.BetaMessage[]) {
  const recebidas: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const chamar: ChamarLLM = async (p) => {
    recebidas.push(structuredClone(p));
    const r = roteiro.shift();
    if (!r) throw new Error("roteiro acabou");
    return r;
  };
  return { chamar, recebidas };
}

function bancoFalso() {
  const chamadas = { respostas: [] as RespostaParaGravar[][], evidencias: [] as EvidenciaParaGravar[][], pendencias: [] as PendenciaParaGravar[] };
  const banco: BancoDeep = {
    async registrarRespostas(itens) {
      chamadas.respostas.push(itens);
      return { gravadas: itens.length, inalteradas: 0 };
    },
    async registrarEvidencias(itens) {
      chamadas.evidencias.push(itens);
      return { gravadas: itens.length, inalteradas: 0 };
    },
    async registrarPendencia(p) {
      chamadas.pendencias.push(p);
      return "pend-1";
    },
    async verEstado() {
      return { ok: true };
    },
  };
  return { banco, chamadas };
}

const estadoBase = (): EstadoBanco => ({
  deep: { id: "d1", setor: "food_service", pacote_versao: "food_service@0.3", status: "em_andamento", escopo: {} },
  sessoes: [
    { id: "s1", numero: 1, area: "transversal", titulo: "Diretoria", status: "encerrada", participantes: [{ nome: "Mariana", cargo: "CEO" }], resumo: "Escopo: restaurantes e eventos." },
    { id: "s2", numero: 2, area: "B", titulo: "Eventos", status: "aberta", participantes: [{ nome: "Rita" }], resumo: null },
  ],
  respostas: [{ pergunta_id: "t.di3", area: "transversal", valor: ["restaurantes", "eventos"], nao_se_aplica: false, confianca: "alta", participante: "Mariana" }],
  evidencias: [],
  pendencias_abertas: [{ fonte: "F12", descricao: "Planilha de orçamentos", responsavel: "Eventos", prazo: "2026-12-01" }],
});

describe("máscara de dados sensíveis", () => {
  it.each([
    ["CPF com pontuação", "o CPF da Rita é 123.456.789-09", "[CPF removido]"],
    ["CPF corrido", "cpf 12345678909 ok", "[CPF removido]"],
    ["CPF no fim da frase", "o CPF é 123.456.789-09.", "[CPF removido]"],
    ["CNPJ", "CNPJ 12.345.678/0001-95 da Cidreira", "[CNPJ removido]"],
    ["CNPJ corrido", "empresa 12345678000195", "[CNPJ removido]"],
    ["cartão", "cartão 4111 1111 1111 1111 da empresa", "[cartão removido]"],
    ["agência e conta", "ag 1234 conta 56789-0", "[dado bancário removido]"],
    ["chave Pix", "chave pix: financeiro@capim.com.br", "[chave Pix removida]"],
  ])("remove %s", (_n, entrada, marcador) => {
    const r = mascararDadosSensiveis(entrada);
    expect(r.texto).toContain(marcador);
    expect(r.texto).not.toMatch(/\d{4,}/);
  });

  it("preserva o que é matéria-prima do assessment", () => {
    const t = "Perda de 6,5%, 7 satélites, R$ 12.345.678,90 de compras, 1.200 refeições/dia, prazo 2026-12-01, 45 dias";
    const r = mascararDadosSensiveis(t);
    expect(r.texto).toBe(t);
    expect(Object.values(r.contagem).every((n) => n === 0)).toBe(true);
  });
});

describe("ferramentas do Deep", () => {
  it("definições usam só ids do roteiro e critérios de gate", () => {
    const tools = definirFerramentasDeep(roteiroDeep);
    expect(tools.map((t) => t.name)).toEqual(["ver_estado", "registrar_respostas", "registrar_evidencias", "registrar_pendencia", "encerrar_reuniao"]);
    const json = JSON.stringify(tools);
    expect(json).toContain("b.ev1");
    expect(json).toContain("gate.a.linha_base");
  });

  it("um lote com várias perguntas, de áreas diferentes, passa inteiro", () => {
    const v = validarLoteRespostas(roteiroDeep, {
      respostas: [
        { pergunta_id: "b.ev1", valor: 40, confianca: "media", trecho: "chegam uns 40 pedidos por mês", participante: "Rita" },
        { pergunta_id: "b.ev2", valor: ["whatsapp", "email", "email"], confianca: "alta", trecho: "e-mail e WhatsApp" },
        { pergunta_id: "c.rh1", valor: 38, confianca: "baixa", trecho: "rotatividade perto de 38%" },
        { pergunta_id: "b.sa5", nao_se_aplica: true, valor: "ignorado", confianca: "alta", trecho: "não tratam reclamação por aqui" },
      ],
    });
    expect("itens" in v).toBe(true);
    if ("itens" in v) {
      expect(v.itens.map((i) => i.area)).toEqual(["B", "B", "C", "B"]);
      expect(v.itens[1].valor).toEqual(["email", "whatsapp"]);
      expect(v.itens[3]).toMatchObject({ nao_se_aplica: true, valor: null });
    }
  });

  it.each([
    ["pergunta fora do roteiro", { pergunta_id: "x.y1", valor: 1, confianca: "alta", trecho: "t" }, "inexistente"],
    ["valor fora da faixa", { pergunta_id: "b.ev4", valor: 140, confianca: "alta", trecho: "t" }, "fora da faixa"],
    ["opção inventada", { pergunta_id: "c.fi1", valor: "robotizada", confianca: "alta", trecho: "t" }, "opção inválida"],
    ["sem trecho", { pergunta_id: "c.rh1", valor: 10, confianca: "alta" }, "trecho"],
    ["confiança inválida", { pergunta_id: "c.rh1", valor: 10, confianca: "total", trecho: "t" }, "confiança"],
    ["campo extra", { pergunta_id: "c.rh1", valor: 10, confianca: "alta", trecho: "t", area: "A" }, "desconhecidos"],
  ])("recusa %s e não grava nada", async (_n, item, mensagem) => {
    const { banco, chamadas } = bancoFalso();
    const ok = { pergunta_id: "b.ev1", valor: 40, confianca: "media", trecho: "40 por mês" };
    const r = await executarFerramentaDeep(roteiroDeep, "B", "registrar_respostas", { respostas: [ok, item] }, banco);
    expect(r.erro).toBe(true);
    expect(r.conteudo).toContain(mensagem);
    expect(chamadas.respostas).toHaveLength(0);
  });

  it("recusa pergunta repetida no lote e lote vazio ou grande demais", async () => {
    const { banco, chamadas } = bancoFalso();
    const item = { pergunta_id: "c.rh1", valor: 10, confianca: "alta", trecho: "t" };
    expect((await executarFerramentaDeep(roteiroDeep, "C", "registrar_respostas", { respostas: [item, item] }, banco)).erro).toBe(true);
    expect((await executarFerramentaDeep(roteiroDeep, "C", "registrar_respostas", { respostas: [] }, banco)).erro).toBe(true);
    const muitos = Array.from({ length: 51 }, () => item);
    expect((await executarFerramentaDeep(roteiroDeep, "C", "registrar_respostas", { respostas: muitos }, banco)).erro).toBe(true);
    expect(chamadas.respostas).toHaveLength(0);
  });

  it("evidência, pendência e resumo da reunião", async () => {
    const { banco, chamadas } = bancoFalso();
    const ev = await executarFerramentaDeep(roteiroDeep, "A", "registrar_evidencias", {
      evidencias: [{ criterio_id: "gate.a.linha_base", tipo: "documento", descricao: "DRE 12 meses", fonte: "F11", cumprido: false }],
    }, banco);
    expect(ev.erro).toBe(false);
    expect(chamadas.evidencias[0][0].criterio_id).toBe("gate.a.linha_base");
    expect((await executarFerramentaDeep(roteiroDeep, "A", "registrar_evidencias", { evidencias: [{ criterio_id: "inventado", tipo: "dado", descricao: "x" }] }, banco)).erro).toBe(true);

    expect((await executarFerramentaDeep(roteiroDeep, "A", "registrar_pendencia", { descricao: "Enviar fichas", fonte: "F07", prazo: "2026-12-05" }, banco)).erro).toBe(false);
    expect((await executarFerramentaDeep(roteiroDeep, "A", "registrar_pendencia", { descricao: "x", prazo: "2026-02-30" }, banco)).erro).toBe(true);
    expect((await executarFerramentaDeep(roteiroDeep, "A", "registrar_pendencia", { descricao: "x", fonte: "F99" }, banco)).erro).toBe(true);
    expect(chamadas.pendencias).toHaveLength(1);

    const fim = await executarFerramentaDeep(roteiroDeep, "A", "encerrar_reuniao", { resumo: "Cozinha central e 7 satélites; perda 8%." }, banco);
    expect(fim.sinal).toEqual({ tipo: "resumo_reuniao", resumo: "Cozinha central e 7 satélites; perda 8%." });
    expect((await executarFerramentaDeep(roteiroDeep, "A", "apagar_tudo", {}, banco)).erro).toBe(true);
  });
});

describe("prompt e contexto", () => {
  it("prompt fixo: traz todas as perguntas e não muda entre chamadas", () => {
    const p = montarPromptDeep(roteiroDeep);
    for (const q of roteiroDeep.perguntas) expect(p).toContain(q.id);
    expect(p).toBe(montarPromptDeep(roteiroDeep));
    expect(p).not.toMatch(/20\d\d-\d\d-\d\d/);
  });

  it("contexto: resumos das reuniões anteriores, sem a atual, e fila da área", () => {
    const e = estadoBase();
    const c = blocoContexto(roteiroDeep, e, "s2");
    expect(c).toContain("Escopo: restaurantes e eventos.");
    const m = estadoParaModelo(roteiroDeep, e, "s2");
    expect(m.reuniao.area).toBe("B");
    expect(m.proximas_da_area[0].id).toBe("b.sa1");
    expect(m.proximas_da_area.some((p) => p.id === "b.ev1")).toBe(true);
    expect(JSON.stringify(m)).not.toContain("\"s2\"");
    expect(() => estadoParaModelo(roteiroDeep, e, "outra")).toThrow();
  });
});

describe("turno do agente", () => {
  const entradaVarias = "Rita: chegam uns 40 pedidos de orçamento por mês, por e-mail e WhatsApp. CPF dela 123.456.789-09.";

  it("várias respostas numa fala: uma chamada de registrar_respostas, CPF não sai do servidor", async () => {
    const api = apiSimulada([
      resposta([
        ferramenta("registrar_respostas", {
          respostas: [
            { pergunta_id: "b.ev1", valor: 40, confianca: "media", trecho: "uns 40 pedidos de orçamento por mês", participante: "Rita" },
            { pergunta_id: "b.ev2", valor: ["email", "whatsapp"], confianca: "alta", trecho: "por e-mail e WhatsApp" },
          ],
        }),
      ], "tool_use"),
      resposta([texto("Registrei 40 pedidos por mês, por e-mail e WhatsApp. Quantos dias leva até a primeira proposta?")]),
    ]);
    const { banco, chamadas } = bancoFalso();
    const t = await executarTurnoDeep({
      roteiro: roteiroDeep, area: "B", falas: [], entrada: entradaVarias, contexto: "CONTEXTO-DA-REUNIAO", banco, chamar: api.chamar,
    });

    expect(t.fim).toBe("ok");
    expect(chamadas.respostas).toHaveLength(1);
    expect(chamadas.respostas[0].map((r) => r.pergunta_id)).toEqual(["b.ev1", "b.ev2"]);
    expect(t.sinais).toContainEqual({ tipo: "gravou", respostas: 2, evidencias: 0, pendencias: 0 });
    expect(t.novas.map((f) => f.papel)).toEqual(["analista", "agente", "analista", "agente"]);
    expect(t.mascarados.cpf).toBe(1);
    expect(JSON.stringify(t.novas)).not.toContain("123.456.789-09");
    expect(JSON.stringify(api.recebidas)).not.toContain("123.456.789-09");
    expect(t.uso).toEqual({ entrada: 200, saida: 40, cacheLeitura: 100, cacheEscrita: 20 });

    const p = api.recebidas[0];
    const sistema = p.system as Anthropic.Beta.BetaTextBlockParam[];
    expect(sistema[0].cache_control).toEqual({ type: "ephemeral" });
    expect(sistema[1]).toEqual({ type: "text", text: "CONTEXTO-DA-REUNIAO" });
  });

  it("erro de validação volta ao modelo como resultado de ferramenta, sem gravar", async () => {
    const api = apiSimulada([
      resposta([ferramenta("registrar_respostas", { respostas: [{ pergunta_id: "b.ev4", valor: 140, confianca: "alta", trecho: "140%" }] })], "tool_use"),
      resposta([texto("Conversão de 140% não fecha. Pode confirmar o número?")]),
    ]);
    const { banco, chamadas } = bancoFalso();
    const t = await executarTurnoDeep({ roteiro: roteiroDeep, area: "B", falas: [], entrada: "convertem 140%", contexto: "c", banco, chamar: api.chamar });
    expect(chamadas.respostas).toHaveLength(0);
    const resultado = (api.recebidas[1].messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
    expect(resultado.is_error).toBe(true);
    expect(t.textos.at(-1)).toContain("confirmar");
  });

  it("recusa do modelo grava só a fala do analista", async () => {
    const api = apiSimulada([resposta([], "refusal")]);
    const { banco } = bancoFalso();
    const t = await executarTurnoDeep({ roteiro: roteiroDeep, area: "A", falas: [], entrada: "oi", contexto: "c", banco, chamar: api.chamar });
    expect(t.fim).toBe("recusa");
    expect(t.novas).toEqual([{ papel: "analista", conteudo: "oi" }]);
  });

  it("histórico da reunião vai ao modelo na ordem e nada antigo muda", async () => {
    const api = apiSimulada([resposta([texto("Próxima pergunta.")])]);
    const { banco } = bancoFalso();
    const falas = [
      { papel: "analista" as const, conteudo: "Começar" },
      { papel: "agente" as const, conteudo: [{ type: "text" as const, text: "Quantas cozinhas?" }] },
    ];
    const t = await executarTurnoDeep({ roteiro: roteiroDeep, area: "A", falas, entrada: "uma central", contexto: "c", banco, chamar: api.chamar });
    expect(api.recebidas[0].messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(t.novas[0]).toEqual({ papel: "analista", conteudo: "uma central" });
    expect(t.novas).toHaveLength(2);
  });

  it("recusa fala vazia ou longa demais antes de chamar a API", async () => {
    const api = apiSimulada([]);
    const { banco } = bancoFalso();
    const base = { roteiro: roteiroDeep, area: "A" as const, falas: [], contexto: "c", banco, chamar: api.chamar };
    await expect(executarTurnoDeep({ ...base, entrada: "   " })).rejects.toThrow(EntradaInvalida);
    await expect(executarTurnoDeep({ ...base, entrada: "x".repeat(MAX_TEXTO_ANALISTA + 1) })).rejects.toThrow(EntradaInvalida);
    expect(api.recebidas).toHaveLength(0);
  });
});

describe("turno da reunião (banco simulado)", () => {
  function servidorFalso(opcoes: { erroReserva?: boolean; pacote?: string } = {}) {
    const gravadas: unknown[][] = [];
    const respostas: unknown[][] = [];
    const srv: ServidorDeep = {
      async deepReservarTurno() {
        return opcoes.erroReserva
          ? { falas: [], error: { code: "23514", message: "limite de turnos da reunião atingido" } }
          : { falas: [], error: null };
      },
      async deepEstado() {
        const e = estadoBase();
        if (opcoes.pacote) e.deep.pacote_versao = opcoes.pacote;
        return { estado: e, error: null };
      },
      async deepGravarMensagens(_s, _a, falas) {
        gravadas.push(falas);
        return { ultimaOrdem: falas.length, error: null };
      },
      async deepRegistrarRespostas(_s, _a, itens) {
        respostas.push(itens);
        return { resultado: { gravadas: itens.length, inalteradas: 0 }, error: null };
      },
      async deepRegistrarEvidencias(_s, _a, itens) {
        return { resultado: { gravadas: itens.length, inalteradas: 0 }, error: null };
      },
      async deepRegistrarPendencia() {
        return { id: "p1", error: null };
      },
    };
    return { srv, gravadas, respostas };
  }
  const analista = { userId: "u1", aal2: true };

  it("reserva, lê o estado, roda o agente e grava as falas do turno", async () => {
    const { srv, gravadas, respostas } = servidorFalso();
    const api = apiSimulada([
      resposta([ferramenta("registrar_respostas", { respostas: [{ pergunta_id: "b.ev3", valor: 5, confianca: "media", trecho: "5 dias" }] })], "tool_use"),
      resposta([texto("Anotado: 5 dias. Quantos viram contrato?")]),
    ]);
    const t = await turnoDaReuniao({ deepId: "d1", sessaoId: "s2", analista, texto: "levam 5 dias", chamar: api.chamar, srv });
    expect(respostas).toHaveLength(1);
    expect(gravadas).toHaveLength(1);
    expect(gravadas[0]).toEqual(t.novas);
    expect((api.recebidas[0].system as Anthropic.Beta.BetaTextBlockParam[])[1].text).toContain("Escopo: restaurantes e eventos.");
  });

  it("teto do banco atingido: não chama a API", async () => {
    const { srv } = servidorFalso({ erroReserva: true });
    const api = apiSimulada([]);
    await expect(turnoDaReuniao({ deepId: "d1", sessaoId: "s2", analista, texto: "x", chamar: api.chamar, srv })).rejects.toThrow(ErroReuniao);
    expect(api.recebidas).toHaveLength(0);
  });

  it("Deep aberto com outro roteiro ou reunião de outro Deep: não chama a API", async () => {
    const api = apiSimulada([]);
    await expect(
      turnoDaReuniao({ deepId: "d1", sessaoId: "s2", analista, texto: "x", chamar: api.chamar, srv: servidorFalso({ pacote: "food_service@0.4" }).srv }),
    ).rejects.toThrow("pacote_diferente");
    await expect(
      turnoDaReuniao({ deepId: "d1", sessaoId: "s9", analista, texto: "x", chamar: api.chamar, srv: servidorFalso().srv }),
    ).rejects.toThrow("sessao_de_outro_deep");
    expect(api.recebidas).toHaveLength(0);
  });
});
