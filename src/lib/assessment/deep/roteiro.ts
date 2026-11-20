/**
 * Roteiro do Deep assessment (modo analista): perguntas por área e pilar,
 * com tipo de resposta, núcleo ou aprofundamento e gatilhos.
 *
 * O roteiro é validado inteiro ao carregar (ids únicos e no formato que o
 * banco aceita, pilar na área certa, fontes no catálogo, gatilho apontando
 * para pergunta anterior). Um pacote inconsistente quebra no build e nos
 * testes, nunca no meio de uma reunião.
 *
 * Só funções puras: o agente (PR 3) usa validarValor para conferir cada
 * resposta antes de gravar, e filaDaArea para sugerir a próxima pergunta.
 */
import { z } from "zod";
import pacoteJson from "../dados/food_service.json";
import roteiroJson from "../dados/food_service_deep.json";

export const AREAS = ["A", "B", "C", "transversal"] as const;
export type AreaDeep = (typeof AREAS)[number];

/** Mesmo formato do check de deep_respostas.pergunta_id no banco. */
const ID_PERGUNTA = /^[a-z0-9][a-z0-9_.-]{0,79}$/;
const ID_FONTE = /^F[0-9]{2}$/;
const MAX_TEXTO = 2000;

const gatilhoSchema = z
  .object({
    pergunta: z.string().regex(ID_PERGUNTA),
    igual: z.union([z.string(), z.boolean(), z.number()]).optional(),
    diferente: z.union([z.string(), z.boolean(), z.number()]).optional(),
    contem: z.string().optional(),
  })
  .strict()
  .refine((g) => [g.igual, g.diferente, g.contem].filter((v) => v !== undefined).length === 1, {
    message: "gatilho precisa de exatamente uma condição (igual, diferente ou contem)",
  });

const perguntaSchema = z
  .object({
    id: z.string().regex(ID_PERGUNTA),
    area: z.enum(AREAS),
    pilar: z.string().min(1),
    nucleo: z.boolean(),
    tipo: z.enum(["texto", "numero", "percentual", "moeda", "opcao", "multipla", "sim_nao"]),
    texto: z.string().min(5).max(500),
    unidade: z.string().max(40).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    inteiro: z.boolean().optional(),
    opcoes: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).min(2).optional(),
    fontes: z.array(z.string().regex(ID_FONTE)).optional(),
    gatilho: gatilhoSchema.optional(),
  })
  .strict();

const roteiroSchema = z.object({
  pacote: z.literal("food_service"),
  versao: z.string().regex(/^[0-9]{1,3}\.[0-9]{1,3}$/),
  areas: z.record(z.enum(AREAS), z.object({ nome: z.string(), pilares: z.array(z.string()).min(1) })),
  pilares: z.record(
    z.string(),
    z.object({
      nome: z.string(),
      area: z.enum(AREAS),
      pergunta_central: z.string(),
      fontes: z.array(z.string().regex(ID_FONTE)),
      fica_com_gente: z.string(),
    }),
  ),
  fontes_novas: z.record(z.string().regex(ID_FONTE), z.object({ nome: z.string(), se_faltar: z.string() }).loose()),
  gate: z.object({ itens: z.record(z.string().regex(/^[a-z_]+$/), z.string()) }).loose(),
  perguntas: z.array(perguntaSchema).min(1),
});

export type PerguntaDeep = z.infer<typeof perguntaSchema>;
export type Gatilho = z.infer<typeof gatilhoSchema>;
export type ValorDeep = string | number | boolean | string[];

export interface RoteiroDeep {
  pacote: string;
  versao: string;
  /** Valor gravado em deep_assessments.pacote_versao. */
  pacoteVersao: string;
  areas: Record<AreaDeep, { nome: string; pilares: string[] }>;
  pilares: z.infer<typeof roteiroSchema>["pilares"];
  /** F01 a F11 do pacote mais F12 a F20 do Deep. */
  fontes: Record<string, { nome: string; se_faltar?: string }>;
  /** Critérios de evidência do gate de cada área: gate.<area>.<item>. */
  criteriosGate: string[];
  perguntas: PerguntaDeep[];
  porId: Map<string, PerguntaDeep>;
}

export class RoteiroInvalido extends Error {}

/** Valida o JSON do roteiro e as regras que o esquema sozinho não pega. */
export function carregarRoteiro(json: unknown = roteiroJson, catalogo: Record<string, unknown> = pacoteJson.catalogo_fontes): RoteiroDeep {
  const r = roteiroSchema.parse(json);
  const erros: string[] = [];

  const fontes: RoteiroDeep["fontes"] = {};
  for (const [id, f] of Object.entries(catalogo)) {
    fontes[id] = f as { nome: string; se_faltar?: string };
  }
  for (const [id, f] of Object.entries(r.fontes_novas)) {
    if (fontes[id]) erros.push(`fonte ${id} já existe no catálogo do pacote`);
    fontes[id] = f;
  }

  for (const area of AREAS) {
    if (!r.areas[area]) erros.push(`área ${area} sem definição`);
  }
  for (const [id, p] of Object.entries(r.pilares)) {
    if (!r.areas[p.area]?.pilares.includes(id)) erros.push(`pilar ${id} não está listado na área ${p.area}`);
    for (const f of p.fontes) if (!fontes[f]) erros.push(`pilar ${id}: fonte ${f} fora do catálogo`);
  }

  const porId = new Map<string, PerguntaDeep>();
  for (const p of r.perguntas) {
    if (porId.has(p.id)) erros.push(`pergunta ${p.id} repetida`);
    const pilar = r.pilares[p.pilar];
    if (!pilar) erros.push(`${p.id}: pilar ${p.pilar} não existe`);
    else if (pilar.area !== p.area) erros.push(`${p.id}: pilar ${p.pilar} é da área ${pilar.area}`);
    if (!p.id.startsWith(`${p.area === "transversal" ? "t" : p.area.toLowerCase()}.`)) {
      erros.push(`${p.id}: o id deve começar pela área`);
    }
    const temOpcoes = p.tipo === "opcao" || p.tipo === "multipla";
    if (temOpcoes !== Boolean(p.opcoes)) erros.push(`${p.id}: opções só (e sempre) em opcao e multipla`);
    if (p.opcoes && new Set(p.opcoes).size !== p.opcoes.length) erros.push(`${p.id}: opção repetida`);
    if ((p.min !== undefined || p.max !== undefined || p.inteiro) && !["numero", "moeda"].includes(p.tipo)) {
      erros.push(`${p.id}: limites só em numero e moeda`);
    }
    if (p.min !== undefined && p.max !== undefined && p.min > p.max) erros.push(`${p.id}: min maior que max`);
    for (const f of p.fontes ?? []) if (!fontes[f]) erros.push(`${p.id}: fonte ${f} fora do catálogo`);
    if (p.gatilho) {
      const alvo = porId.get(p.gatilho.pergunta);
      if (!alvo) erros.push(`${p.id}: gatilho aponta para ${p.gatilho.pergunta}, que não vem antes`);
      else if (p.gatilho.contem !== undefined && !alvo.opcoes?.includes(p.gatilho.contem)) {
        erros.push(`${p.id}: gatilho 'contem' com opção que ${alvo.id} não tem`);
      } else {
        const v = p.gatilho.igual ?? p.gatilho.diferente;
        if (v !== undefined && validarValor(alvo, v).ok === false) {
          erros.push(`${p.id}: gatilho compara com valor que ${alvo.id} não aceita`);
        }
      }
    }
    porId.set(p.id, p);
  }

  if (erros.length) throw new RoteiroInvalido(`roteiro do Deep inválido:\n- ${erros.join("\n- ")}`);

  return {
    pacote: r.pacote,
    versao: r.versao,
    pacoteVersao: `${r.pacote}@${r.versao}`,
    areas: r.areas as RoteiroDeep["areas"],
    pilares: r.pilares,
    fontes,
    criteriosGate: (["A", "B", "C"] as const).flatMap((a) =>
      Object.keys(r.gate.itens).map((item) => `gate.${a.toLowerCase()}.${item}`),
    ),
    perguntas: r.perguntas,
    porId,
  };
}

export type ResultadoValidacao = { ok: true; valor: ValorDeep } | { ok: false; erro: string };

/**
 * Confere e normaliza o valor de uma resposta pelo tipo da pergunta. O
 * agente devolve o erro ao modelo, que pede confirmação ao analista em vez
 * de supor um valor.
 */
export function validarValor(p: PerguntaDeep, valor: unknown): ResultadoValidacao {
  const erro = (msg: string): ResultadoValidacao => ({ ok: false, erro: `${p.id}: ${msg}` });
  switch (p.tipo) {
    case "texto": {
      if (typeof valor !== "string") return erro("esperava texto");
      const t = valor.trim();
      if (!t) return erro("texto vazio");
      if (t.length > MAX_TEXTO) return erro(`texto acima de ${MAX_TEXTO} caracteres`);
      return { ok: true, valor: t };
    }
    case "numero":
    case "moeda":
    case "percentual": {
      if (typeof valor !== "number" || !Number.isFinite(valor)) return erro("esperava número");
      const min = p.tipo === "percentual" ? 0 : (p.min ?? 0);
      const max = p.tipo === "percentual" ? 100 : (p.max ?? Number.MAX_SAFE_INTEGER);
      if (valor < min || valor > max) return erro(`fora da faixa ${min} a ${max}`);
      if (p.inteiro && !Number.isInteger(valor)) return erro("esperava número inteiro");
      return { ok: true, valor };
    }
    case "sim_nao":
      return typeof valor === "boolean" ? { ok: true, valor } : erro("esperava sim ou não");
    case "opcao":
      return typeof valor === "string" && p.opcoes?.includes(valor) ? { ok: true, valor } : erro("opção inválida");
    case "multipla": {
      if (!Array.isArray(valor) || valor.length === 0) return erro("esperava uma ou mais opções");
      if (!valor.every((v) => typeof v === "string" && p.opcoes?.includes(v))) return erro("opção inválida");
      const unicas = [...new Set(valor as string[])];
      // Ordem do roteiro: a mesma escolha vira sempre o mesmo valor gravado.
      return { ok: true, valor: p.opcoes!.filter((o) => unicas.includes(o)) };
    }
  }
}

/** Resposta vigente como o servidor recebe do banco (deep_estado). */
export interface RespostaVigente {
  valor: unknown;
  nao_se_aplica: boolean;
}

/**
 * O gatilho está ativo? Pergunta sem gatilho sempre vale. Se a pergunta do
 * gatilho ainda não foi respondida (ou não se aplica), a dependente espera.
 */
export function gatilhoAtivo(p: PerguntaDeep, respostas: Record<string, RespostaVigente>): boolean {
  const g = p.gatilho;
  if (!g) return true;
  const r = respostas[g.pergunta];
  if (!r || r.nao_se_aplica) return false;
  if (g.contem !== undefined) return Array.isArray(r.valor) && r.valor.includes(g.contem);
  if (g.igual !== undefined) return r.valor === g.igual;
  return r.valor !== g.diferente;
}

/**
 * Estado do gatilho em cadeia: "aguardando" enquanto a pergunta de que ele
 * depende (ou alguma acima dela) ainda não foi respondida; "inativo" quando
 * a resposta dada, ou um gatilho inativo acima, tira a pergunta da conta.
 */
export function estadoGatilho(
  roteiro: RoteiroDeep,
  p: PerguntaDeep,
  respostas: Record<string, RespostaVigente>,
): "ativo" | "inativo" | "aguardando" {
  if (!p.gatilho) return "ativo";
  const alvo = roteiro.porId.get(p.gatilho.pergunta);
  if (!alvo) return "inativo";
  const acima = estadoGatilho(roteiro, alvo, respostas);
  if (acima !== "ativo") return acima;
  if (!respostas[alvo.id]) return "aguardando";
  return gatilhoAtivo(p, respostas) ? "ativo" : "inativo";
}

export interface SituacaoArea {
  /** Perguntas ainda abertas, núcleo primeiro, na ordem do roteiro. */
  fila: PerguntaDeep[];
  nucleoTotal: number;
  nucleoRespondidas: number;
  /** Núcleo que espera um gatilho ainda sem resposta. */
  aguardandoGatilho: string[];
}

/**
 * Situação de uma área: o que falta perguntar e quanto do núcleo está feito.
 * Pergunta com gatilho inativo sai da conta (não se aplica por
 * consequência); com gatilho ainda sem resposta, fica esperando.
 */
export function situacaoArea(roteiro: RoteiroDeep, area: AreaDeep, respostas: Record<string, RespostaVigente>): SituacaoArea {
  const abertas: PerguntaDeep[] = [];
  const aguardando: string[] = [];
  let nucleoTotal = 0;
  let nucleoRespondidas = 0;

  for (const p of roteiro.perguntas.filter((q) => q.area === area)) {
    const estado = estadoGatilho(roteiro, p, respostas);
    if (estado === "inativo") continue;
    if (p.nucleo) nucleoTotal++;
    if (estado === "aguardando") {
      if (p.nucleo) aguardando.push(p.id);
      continue;
    }
    const respondida = Boolean(respostas[p.id]);
    if (p.nucleo && respondida) nucleoRespondidas++;
    if (!respondida) abertas.push(p);
  }

  abertas.sort((a, b) => Number(b.nucleo) - Number(a.nucleo));
  return { fila: abertas, nucleoTotal, nucleoRespondidas, aguardandoGatilho: aguardando };
}

/** Roteiro do pacote atual, validado uma vez por processo. */
export const roteiroDeep: RoteiroDeep = carregarRoteiro();
