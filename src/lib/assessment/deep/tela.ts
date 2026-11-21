/**
 * Funções puras das telas do Deep (modo analista): leitura da transcrição
 * gravada, participantes digitados, valores digitados na correção manual e
 * formatação das respostas. Nada aqui fala com o banco ou com a API.
 */
import { PREFIXO_ESCUTA } from "./agente/escuta";
import { AREAS, situacaoArea, validarValor, type AreaDeep, type PerguntaDeep, type RespostaVigente, type RoteiroDeep, type ResultadoValidacao } from "./roteiro";

export const AVISO_APP = "[Aviso do app]";

export const ROTULO_AREA: Record<AreaDeep, string> = {
  A: "Área A",
  B: "Área B",
  C: "Área C",
  transversal: "Transversal",
};

export function areaValida(v: unknown): v is AreaDeep {
  return typeof v === "string" && (AREAS as readonly string[]).includes(v);
}

// ------------------------------------------------------------- transcrição

export interface FalaReuniao {
  autor: "analista" | "agente";
  texto: string;
}

/**
 * Transcrição para a tela: só os textos do analista e do agente, na ordem.
 * Resultados de ferramentas, raciocínio, avisos do app e trechos da escuta
 * (o texto bruto da transcrição ao vivo) ficam de fora.
 * O texto é mostrado como texto puro (nunca HTML).
 */
export function falasDaReuniao(linhas: readonly { papel: unknown; conteudo: unknown }[]): FalaReuniao[] {
  const falas: FalaReuniao[] = [];
  for (const l of linhas) {
    if (l.papel !== "analista" && l.papel !== "agente") continue;
    const blocos = typeof l.conteudo === "string" ? [{ type: "text", text: l.conteudo }] : Array.isArray(l.conteudo) ? l.conteudo : [];
    for (const b of blocos as { type?: unknown; text?: unknown }[]) {
      if (b?.type !== "text" || typeof b.text !== "string") continue;
      const texto = b.text.trim();
      if (!texto || texto.startsWith(AVISO_APP) || texto.startsWith(PREFIXO_ESCUTA)) continue;
      falas.push({ autor: l.papel, texto });
    }
  }
  return falas;
}

/** Tira os prefixos que só o servidor usa (aviso do app e escuta) do que o analista digitou. */
export function semAvisoDoApp(texto: string): string {
  return texto.replaceAll(AVISO_APP, "").replaceAll(PREFIXO_ESCUTA, "").trim();
}

// ------------------------------------------------------------ participantes

export const MAX_PARTICIPANTES = 30;
const MAX_NOME = 120;

export type ResultadoParticipantes = { ok: true; participantes: { nome: string; cargo?: string }[] } | { ok: false; erro: string };

/**
 * Uma pessoa por linha, "Nome - Cargo" (o cargo é opcional). Só nome e
 * cargo: nada de e-mail, telefone ou documento (o banco recusa outros campos).
 */
export function participantesDoTexto(texto: string): ResultadoParticipantes {
  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (linhas.length > MAX_PARTICIPANTES) return { ok: false, erro: `Até ${MAX_PARTICIPANTES} participantes por reunião.` };
  const participantes: { nome: string; cargo?: string }[] = [];
  for (const linha of linhas) {
    const [nomeBruto, ...resto] = linha.split(/\s+[-–—]\s+/);
    const nome = nomeBruto.trim();
    const cargo = resto.join(" - ").trim();
    if (!nome || nome.length > MAX_NOME) return { ok: false, erro: `Nome inválido: "${linha.slice(0, 40)}".` };
    if (cargo.length > MAX_NOME) return { ok: false, erro: `Cargo longo demais: "${linha.slice(0, 40)}".` };
    if (/@|\d{4,}/.test(linha)) return { ok: false, erro: "Use só nome e cargo, sem e-mail, telefone ou documento." };
    participantes.push(cargo ? { nome, cargo } : { nome });
  }
  return { ok: true, participantes };
}

// ----------------------------------------------------------- valor digitado

/** "180.000,50", "180000.5", "35%" → número; vazio ou texto → null. */
export function numeroDoTexto(texto: string): number | null {
  let t = texto.trim().replace(/^R\$\s*/i, "").replace(/%$/, "").replace(/\s/g, "");
  if (!t) return null;
  // Com vírgula: padrão brasileiro (ponto de milhar, vírgula decimal).
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  // Só pontos de milhar (1.234.567): tira os pontos.
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/**
 * Converte o que o analista digitou na correção para o valor da pergunta e
 * valida com as mesmas regras do agente (validarValor).
 */
export function valorDoFormulario(p: PerguntaDeep, campo: { texto?: string; opcoes?: string[] }): ResultadoValidacao {
  switch (p.tipo) {
    case "texto":
    case "opcao":
      return validarValor(p, (campo.texto ?? "").trim());
    case "numero":
    case "moeda":
    case "percentual": {
      const n = numeroDoTexto(campo.texto ?? "");
      return n === null ? { ok: false, erro: `${p.id}: esperava número` } : validarValor(p, n);
    }
    case "sim_nao":
      return campo.texto === "sim" ? validarValor(p, true) : campo.texto === "nao" ? validarValor(p, false) : { ok: false, erro: `${p.id}: escolha sim ou não` };
    case "multipla":
      return validarValor(p, campo.opcoes ?? []);
  }
}

// --------------------------------------------------------------- exibição

const numeroBr = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

/** Nome legível de uma opção do roteiro (adota_com_treino → adota com treino). */
export function rotuloOpcao(o: string): string {
  return o.replace(/_/g, " ");
}

/** Valor gravado como o analista lê na tela. */
export function formatarValor(p: PerguntaDeep | undefined, valor: unknown, naoSeAplica = false): string {
  if (naoSeAplica) return "não se aplica";
  if (valor === null || valor === undefined) return "—";
  if (typeof valor === "boolean") return valor ? "sim" : "não";
  if (typeof valor === "number") {
    if (p?.tipo === "moeda") return `R$ ${numeroBr.format(valor)}`;
    if (p?.tipo === "percentual") return `${numeroBr.format(valor)}%`;
    return p?.unidade ? `${numeroBr.format(valor)} ${p.unidade}` : numeroBr.format(valor);
  }
  if (Array.isArray(valor)) return valor.map((v) => rotuloOpcao(String(v))).join(", ");
  if (typeof valor === "string") return p?.tipo === "opcao" ? rotuloOpcao(valor) : valor;
  return JSON.stringify(valor);
}

/** Valor atual no formato do campo de correção (texto). */
export function valorParaCampo(p: PerguntaDeep, valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "boolean") return valor ? "sim" : "nao";
  if (typeof valor === "number") return String(valor).replace(".", ",");
  if (Array.isArray(valor)) return "";
  return p.tipo === "texto" || p.tipo === "opcao" ? String(valor) : "";
}

export interface ProgressoArea {
  area: AreaDeep;
  nome: string;
  nucleoTotal: number;
  nucleoRespondidas: number;
  abertas: number;
  aguardandoGatilho: number;
}

/** Progresso de cada área pelo núcleo do roteiro (mesma regra do agente). */
export function progressoDoDeep(roteiro: RoteiroDeep, respostas: Record<string, RespostaVigente>): ProgressoArea[] {
  return AREAS.map((area) => {
    const s = situacaoArea(roteiro, area, respostas);
    return {
      area,
      nome: roteiro.areas[area].nome,
      nucleoTotal: s.nucleoTotal,
      nucleoRespondidas: s.nucleoRespondidas,
      abertas: s.fila.length,
      aguardandoGatilho: s.aguardandoGatilho.length,
    };
  });
}
