import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import modelo from "@/lib/assessment/dados/modelo_comum.json";
import pacoteJson from "@/lib/assessment/v06/food_service.json";
import {
  NIVEIS,
  composicaoCerteza,
  curto,
  custoEspera,
  escalaRegua,
  linhasAtivas,
  notasProntidao,
  retratoDre,
  travaAtiva,
} from "@/lib/assessment/v06/apresentacao";
import { calcularSelf06 } from "@/lib/assessment/v06/motor";
import { RelatorioPdf06 } from "@/lib/assessment/v06/pdf/relatorio-pdf";
import { progresso06, type Rascunho06 } from "@/lib/assessment/v06/questionario";
import { aprofundamentoParaProgresso, montarQuestionario06 } from "@/lib/assessment/v06/self";
import type { Modelo } from "@/lib/assessment/tipos";
import type { Pacote06, Respostas06 } from "@/lib/assessment/v06/tipos";
import piloto from "../fixtures/assessment/respostas_piloto_06.json";

/** Relatório executivo, PDF e indicador de progresso do Self 0.6 (dados fictícios da Rede Piloto). */
const r = calcularSelf06(piloto as unknown as Respostas06, pacoteJson as unknown as Pacote06, modelo as unknown as Modelo);
const q = montarQuestionario06();
const empresaOk = {
  nome: "Rede Piloto",
  cnpj: "11222333000181",
  cidade: "São Paulo",
  uf: "SP",
  contato_nome: "Pessoa Teste",
  contato_cargo: "Diretoria",
  contato_email: "teste@exemplo.com",
};

describe("progresso do roteiro 0.6", () => {
  it("rascunho vazio: nada feito e o aprofundamento reservado no máximo do pacote", () => {
    const p = progresso06(q, {}, {}, null);
    expect(p.feitos).toBe(0);
    expect(p.total).toBe(13 + q.aprofundarMax);
    expect(p.proximo?.id).toBe("empresa");
  });

  it("aprofundamento só aparece com o retrato econômico completo", () => {
    expect(aprofundamentoParaProgresso({ linhas_vermelhas: ["receitas"] } as Rascunho06)).toBeNull();
    const lista = aprofundamentoParaProgresso(piloto as unknown as Rascunho06);
    expect(lista).not.toBeNull();
    expect(lista!.length).toBeGreaterThan(0);
    expect(lista!.length).toBeLessThanOrEqual(q.aprofundarMax);
  });

  it("tudo respondido: feitos = total e sem próximo passo", () => {
    const rasc = piloto as unknown as Rascunho06;
    const lista = aprofundamentoParaProgresso(rasc)!;
    const nucleo = Object.fromEntries(lista.map((id) => [id, q.perguntas.find((x) => x.id === id)!.opcoes[0]]));
    const p = progresso06(q, { ...rasc, nucleo }, empresaOk, lista);
    expect(p.feitos).toBe(p.total);
    expect(p.proximo).toBeUndefined();
  });

  it("ignora ids desconhecidos ou repetidos vindos da tela", () => {
    const p = progresso06(q, {}, {}, ["sobra", "sobra", "inventada"]);
    expect(p.passos.filter((x) => x.id.startsWith("nucleo:"))).toHaveLength(1);
  });

  it("divisão que não fecha 100% não conta como feita", () => {
    const p = progresso06(q, { divisao: { restaurantes: 60 } }, {}, null);
    expect(p.passos.find((x) => x.id === "divisao")?.feito).toBe(false);
  });
});

describe("derivações do relatório", () => {
  it("linhas ativas em ordem decrescente e composição de certeza somando o total", () => {
    const ativas = linhasAtivas(r);
    for (let i = 1; i < ativas.length; i++) expect(ativas[i - 1].conservador).toBeGreaterThanOrEqual(ativas[i].conservador);
    const comp = composicaoCerteza(r);
    expect(comp.map((c) => c.certeza)).toEqual(["medido", "estimado", "hipotese"]);
    expect(comp.reduce((a, c) => a + c.fracao, 0)).toBeCloseTo(1, 6);
    expect(comp.reduce((a, c) => a + c.valor, 0)).toBeCloseTo(r.total.conservador, -1);
  });

  it("régua sempre mostra a marca de 3 vezes e o retorno", () => {
    const e = escalaRegua(r);
    expect(e.max).toBeGreaterThanOrEqual(4);
    expect(e.max).toBeGreaterThan(e.retorno);
    expect(escalaRegua({ ...r, regua: { ...r.regua, retorno_x: 7.2 } }).max).toBe(8);
  });

  it("custo de esperar é linear no valor por mês", () => {
    expect(custoEspera(r).map((x) => x.valor)).toEqual([3, 6, 12].map((m) => r.por_mes * m));
  });

  it("retrato do DRE soma 100% e não mostra lucro negativo", () => {
    expect(retratoDre(r).reduce((a, f) => a + f.fracao, 0)).toBeCloseTo(1, 6);
    const prejuizo = retratoDre({ ...r, empresa: { ...r.empresa, lucro: -1000 } });
    expect(prejuizo.find((f) => f.id === "lucro")).toBeUndefined();
    expect(retratoDre({ ...r, empresa: { ...r.empresa, receita: 0 } })).toEqual([]);
  });

  it("notas de prontidão entre 0 e 1 e faixas de nível cobrindo de 0 a 1", () => {
    for (const n of notasProntidao(r)) {
      expect(n.fracao).toBeGreaterThanOrEqual(0);
      expect(n.fracao).toBeLessThanOrEqual(1);
    }
    expect(NIVEIS[0].de).toBe(0);
    expect(NIVEIS[NIVEIS.length - 1].ate).toBe(1);
    expect(travaAtiva({ ...r, prontidao: { ...r.prontidao, teto: null } })).toBe(false);
  });

  it("formato curto para leitura executiva", () => {
    expect(curto(2_040_000)).toBe("R$ 2 mi");
    expect(curto(290_400)).toBe("R$ 290 mil");
  });
});

describe("PDF do relatório", () => {
  it("gera um PDF válido com título, logo e as seções da skill", async () => {
    const buf = await renderToBuffer(RelatorioPdf06({ r, cab: { empresa: "Rede Piloto", calculadoEm: "2026-11-20T18:00:00Z" } }));
    const texto = buf.toString("latin1");
    expect(texto.startsWith("%PDF-")).toBe(true);
    expect(buf.length).toBeGreaterThan(20_000);
    // Metadados do documento (texto das páginas vai comprimido).
    expect(texto).toContain("IRON AI");
    expect((texto.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(3);
  }, 30_000);

  it("texto do cliente entra como texto, sem quebrar o documento", async () => {
    const hostil = { ...r, linhas_vermelhas_outro: "<script>alert(1)</script> ) ( \\ %%EOF" };
    const buf = await renderToBuffer(RelatorioPdf06({ r: hostil, cab: { empresa: "<b>Empresa</b>", calculadoEm: "2026-11-20T18:00:00Z" } }));
    expect(buf.toString("latin1").startsWith("%PDF-")).toBe(true);
  }, 30_000);
});
