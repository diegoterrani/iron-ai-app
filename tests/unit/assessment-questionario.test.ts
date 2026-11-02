import { describe, expect, it } from "vitest";
import { areasParaPergunta6 } from "@/lib/assessment/motor";
import { ajustarPessoasQ6, areasQ6, pendencias, type RespostasSelf } from "@/lib/assessment/questionario";
import { faltasParaConcluir, modelo, montarQuestionario, normalizarEmpresa, normalizarRascunho, pacote } from "@/lib/assessment/self";
import casos from "../fixtures/assessment/casos.json";
import respostasPiloto from "../fixtures/assessment/respostas_piloto_self.json";

const q = montarQuestionario();
// _sobre é um comentário do arquivo do piloto, não uma resposta.
const piloto: Record<string, unknown> = { ...(respostasPiloto as Record<string, unknown>) };
delete piloto._sobre;

describe("questionário do Self", () => {
  it("monta as 8 áreas da pergunta 5, Operações primeiro, e as 11 fontes da pergunta D", () => {
    expect(q.areasQ5).toHaveLength(8);
    expect(q.areasQ5[0].id).toBe("06_operacoes");
    expect(q.dados.itens).toHaveLength(11);
    expect(q.opcoes.receita).toEqual(Object.keys(modelo.self.faixas_receita));
  });

  it("escolhe as áreas da pergunta 6 igual ao motor (todos os casos-ouro válidos)", () => {
    let comparados = 0;
    for (const c of (casos as unknown as { casos: { respostas: RespostasSelf }[] }).casos) {
      const grade = c.respostas.grade_q5;
      if (!grade || q.areasQ5.some((a) => !Object.hasOwn(q.q6.notaQ5, grade[a.id] ?? ""))) continue;
      const notas: Record<string, number> = {};
      for (const a of q.areasQ5) notas[a.id] = modelo.self.nota_q5[grade[a.id]];
      expect(areasQ6(q, grade)).toEqual(areasParaPergunta6(notas, pacote, modelo));
      comparados++;
    }
    expect(comparados).toBeGreaterThan(100);
  });

  it("pergunta 6 espera a 5 estar completa", () => {
    expect(areasQ6(q, { "06_operacoes": "planilhas" })).toEqual([]);
  });

  it("ao mudar a pergunta 5, descarta áreas que saíram da pergunta 6", () => {
    const r = ajustarPessoasQ6(q, { ...(piloto as RespostasSelf), pessoas_q6: { "10_juridico": "1 a 5", "06_operacoes": "151 a 500" } });
    expect(r.pessoas_q6).toEqual({ "06_operacoes": "151 a 500" });
  });
});

describe("rascunho", () => {
  it("as respostas do piloto passam sem alteração (o hash do motor continua o mesmo)", () => {
    const n = normalizarRascunho(piloto, "food_service");
    expect(n.ok && n.respostas).toEqual(piloto);
  });

  it("grava o setor do assessment, nunca o enviado pela tela", () => {
    const n = normalizarRascunho({ setor: "igaming", q3: "21 a 100" }, "food_service");
    expect(n.ok && n.respostas).toEqual({ setor: "food_service", q3: "21 a 100" });
  });

  it("descarta campos desconhecidos", () => {
    const n = normalizarRascunho({ q3: "21 a 100", status: "concluido", resultado: { P: 1e9 } }, "food_service");
    expect(n.ok && n.respostas).toEqual({ setor: "food_service", q3: "21 a 100" });
  });

  it("recusa opção fora da lista e área desconhecida", () => {
    expect(normalizarRascunho({ q3: "1 milhão" }, "food_service").ok).toBe(false);
    expect(normalizarRascunho({ grade_q5: { "99_x": "planilhas" } }, "food_service").ok).toBe(false);
  });

  it("descarta chave de protótipo sem poluir objetos", () => {
    const n = normalizarRascunho(JSON.parse('{"grade_q5": {"__proto__": {"polu": 1}}}'), "food_service");
    expect(n.ok && n.respostas).toEqual({ setor: "food_service" });
    expect(({} as Record<string, unknown>).polu).toBeUndefined();
  });

  it("recusa números inválidos e texto longo", () => {
    expect(normalizarRascunho({ q2_valor: -5 }, "food_service").ok).toBe(false);
    expect(normalizarRascunho({ q2_valor: 1.5 }, "food_service").ok).toBe(false);
    expect(normalizarRascunho({ setoriais: { unidades: 0 } }, "food_service").ok).toBe(false);
    expect(normalizarRascunho({ q7: "x".repeat(501) }, "food_service").ok).toBe(false);
  });

  it("valor exato do faturamento tem precedência sobre a faixa", () => {
    const n = normalizarRascunho({ q2_valor: 1000000, q2: "até 4,8 mi" }, "food_service");
    expect(n.ok && n.respostas).toEqual({ setor: "food_service", q2_valor: 1000000 });
    const f = normalizarRascunho({ q2_valor: null, q2: "até 4,8 mi" }, "food_service");
    expect(f.ok && f.respostas).toEqual({ setor: "food_service", q2: "até 4,8 mi" });
  });

  it("não guarda pessoas de áreas que a pergunta 6 não pede", () => {
    const n = normalizarRascunho({ ...piloto, pessoas_q6: { "10_juridico": "1 a 5" } }, "food_service");
    expect(n.ok && n.respostas.pessoas_q6).toBeUndefined();
  });
});

describe("conclusão", () => {
  const empresa = {
    nome: "Rede Piloto Alfa",
    cnpj: "11222333000181",
    cidade: "São Paulo",
    uf: "SP",
    contato_nome: "Ana",
    contato_cargo: "Diretora",
    contato_email: "ana@rede.com.br",
  };

  it("piloto completo, com empresa cadastrada, não tem pendências", () => {
    expect(faltasParaConcluir(piloto as RespostasSelf, empresa)).toEqual([]);
  });

  it("exige cadastro da empresa com CNPJ válido e e-mail", () => {
    const f = faltasParaConcluir(piloto as RespostasSelf, { ...empresa, cnpj: "11222333000180", contato_email: "ana" });
    expect(f).toEqual(["CNPJ válido", "E-mail do contato principal"]);
    expect(faltasParaConcluir(piloto as RespostasSelf, {})).toHaveLength(5);
  });

  it("aponta o que falta e em qual etapa", () => {
    const p = pendencias(q, { setor: "food_service", q3: "21 a 100" });
    expect(p.map((x) => x.passo)).toContain("perfil");
    expect(p.find((x) => x.texto === "Faturamento anual")?.passo).toBe("perfil");
    expect(p.some((x) => x.passo === "pessoas")).toBe(true);
  });
});

describe("cadastro da empresa", () => {
  it("guarda só dígitos de CNPJ e telefone e descarta campos extras", () => {
    const n = normalizarEmpresa({ nome: " Rede X ", cnpj: "11.222.333/0001-81", contato_telefone: "(11) 99999-0000", papel: "admin" });
    expect(n.ok && n.empresa).toEqual({ nome: "Rede X", cnpj: "11222333000181", contato_telefone: "11999990000" });
  });

  it("recusa UF inexistente e textos longos", () => {
    expect(normalizarEmpresa({ uf: "XX" }).ok).toBe(false);
    expect(normalizarEmpresa({ nome: "x".repeat(201) }).ok).toBe(false);
    expect(normalizarEmpresa({ cnpj: "1".repeat(15) }).ok).toBe(false);
  });
});
