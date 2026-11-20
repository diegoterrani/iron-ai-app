/**
 * Self 0.6: tudo o que o relatório (tela e PDF) deriva do resultado para
 * mostrar. Funções puras, sem I/O: os números vêm prontos do motor e aqui só
 * se agrupa, ordena e formata. A tela HTML e o PDF usam as mesmas funções,
 * para os dois nunca dizerem coisas diferentes.
 */
import modeloJson from "@/lib/assessment/dados/modelo_comum.json";
import type { Certeza, Linha06, Resultado06, Veredito } from "./tipos";

// ------------------------------------------------------------------ formatos
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const umaCasa = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const ateUmaCasa = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/** Valores grandes arredondados para leitura executiva (R$ 2,1 mi; R$ 290 mil). */
export function curto(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `R$ ${ateUmaCasa.format(v / 1_000_000)} mi`;
  if (Math.abs(v) >= 1_000) return `R$ ${inteiro.format(Math.round(v / 1_000))} mil`;
  return brl.format(v);
}

export const pct = (v: number) => inteiro.format(v);
export const vezes = (v: number) => umaCasa.format(v);

/** Score sem arredondar para cima: o nível usa o valor exato (49,8% é 49%, nunca "50% Exploratório"). */
export const pctScore = (v: number) => inteiro.format(Math.floor(v * 100 + 1e-9));

// ------------------------------------------------------------------- textos
export const SELO: Record<Certeza, { texto: string; explica: string }> = {
  medido: { texto: "medido", explica: "a base da conta é um número que você informou" },
  estimado: { texto: "estimado", explica: "a base veio de uma faixa ou de uma divisão aproximada" },
  hipotese: { texto: "hipótese", explica: "a base usa a referência do setor ou ainda não foi medida" },
};

export const ORDEM_CERTEZA: Certeza[] = ["medido", "estimado", "hipotese"];

export const VEREDITO: Record<Veredito, { titulo: string; texto: string }> = {
  seguir: {
    titulo: "Vale seguir para o Deep",
    texto:
      "Mesmo no cenário conservador, o ganho estimado paga com folga um projeto típico do seu porte. O Deep confirma os números com os seus dados antes de qualquer projeto.",
  },
  deep_para_confirmar: {
    titulo: "Vale o Deep para confirmar antes de decidir",
    texto:
      "No cenário conservador, o ganho estimado não chega a 3 vezes o que um projeto típico do seu porte custa. O Deep mede as hipóteses abaixo; o projeto só faz sentido se elas se confirmarem, ou se começar pelo ganho rápido.",
  },
  comecar_pequeno: {
    titulo: "Hoje não recomendamos um projeto completo",
    texto:
      "No cenário conservador, o ganho estimado não paga um projeto completo. A recomendação honesta é começar só pelo ganho rápido abaixo e voltar a avaliar com o resultado medido.",
  },
};

export const ROTULO_NOTA: Record<keyof Resultado06["prontidao"]["notas"], string> = {
  estrategia: "Patrocínio e orçamento",
  dados: "Dados registrados",
  governanca: "Regra sobre IA e dados",
  pessoas: "Uso de IA hoje",
};

/** Faixas de nível de prontidão do modelo comum (do menor para o maior). */
export const NIVEIS: { de: number; ate: number; nome: string }[] = (modeloJson.niveis as [number, string][])
  .slice()
  .sort((a, b) => a[0] - b[0])
  .map(([de, nome], i, l) => ({ de, ate: l[i + 1]?.[0] ?? 1, nome }));

/** Primeiro trecho do nome de uma linha (antes dos dois-pontos), para rótulos curtos. */
export const nomeCurto = (nome: string) => nome.split(":")[0].trim();

/** Texto com a primeira letra minúscula, para encaixar no meio de uma frase. */
export const minuscula = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

// --------------------------------------------------------------- derivações
/** Linhas que entram na conta, da maior para a menor (conservador). */
export function linhasAtivas(r: Resultado06): Linha06[] {
  return r.linhas.filter((l) => !l.fora && l.conservador > 0).sort((a, b) => b.conservador - a.conservador);
}

/** Linhas fora da conta por motivo que vale explicar (as "fora da conta" do pacote não aparecem). */
export function linhasForaDaConta(r: Resultado06): Linha06[] {
  return r.linhas.filter((l) => l.fora && !l.fora.startsWith("fora da conta"));
}

export interface FatiaCerteza {
  certeza: Certeza;
  valor: number;
  /** Fração do total conservador (0 a 1). */
  fracao: number;
}

/** Quanto do ganho conservador está em cada selo de certeza (sempre os 3, na ordem medido → hipótese). */
export function composicaoCerteza(r: Resultado06): FatiaCerteza[] {
  const ativas = linhasAtivas(r);
  const total = ativas.reduce((a, l) => a + l.conservador, 0);
  return ORDEM_CERTEZA.map((certeza) => {
    const valor = ativas.filter((l) => l.certeza === certeza).reduce((a, l) => a + l.conservador, 0);
    return { certeza, valor, fracao: total > 0 ? valor / total : 0 };
  });
}

/** Escala da régua de retorno: vai até o maior entre 4× e o retorno + meio ponto, para a marca de 3× ficar sempre visível. */
export function escalaRegua(r: Resultado06): { max: number; retorno: number; alvo: number } {
  const retorno = Math.max(0, r.regua.retorno_x);
  return { max: Math.max(4, Math.ceil(retorno + 0.5)), retorno, alvo: 3 };
}

/** Custo acumulado da espera, em meses, no conservador. */
export function custoEspera(r: Resultado06, meses: number[] = [3, 6, 12]): { meses: number; valor: number }[] {
  return meses.map((m) => ({ meses: m, valor: r.por_mes * m }));
}

export interface FatiaDre {
  id: "folha" | "custo" | "lucro" | "outros";
  nome: string;
  valor: number;
  fracao: number;
  certeza?: Certeza;
}

/**
 * Retrato do DRE informado: como a receita se divide entre folha, insumos,
 * lucro e o resto. Lucro negativo não vira fatia (o texto do relatório já
 * diz que a margem não é positiva). Fatias somam a receita.
 */
export function retratoDre(r: Resultado06, nomeCusto = "Insumos"): FatiaDre[] {
  const e = r.empresa;
  if (!(e.receita > 0)) return [];
  const lucro = Math.max(0, e.lucro);
  const outros = Math.max(0, e.receita - e.folha - e.custo - lucro);
  const fatias: FatiaDre[] = [
    { id: "folha", nome: "Folha com encargos", valor: e.folha, fracao: 0, certeza: e.folha_certeza },
    { id: "custo", nome: nomeCusto, valor: e.custo, fracao: 0, certeza: e.custo_certeza },
    { id: "outros", nome: "Demais custos", valor: outros, fracao: 0 },
    { id: "lucro", nome: "Lucro líquido", valor: lucro, fracao: 0, certeza: e.margem_certeza },
  ];
  const soma = fatias.reduce((a, f) => a + f.valor, 0);
  return fatias.filter((f) => f.valor > 0).map((f) => ({ ...f, fracao: f.valor / soma }));
}

/** Notas de prontidão normalizadas de 0 a 1 (nota 1 a 5 do modelo), na ordem do relatório. */
export function notasProntidao(r: Resultado06): { id: keyof Resultado06["prontidao"]["notas"]; nome: string; fracao: number }[] {
  const n = r.prontidao.notas;
  return (Object.keys(ROTULO_NOTA) as (keyof typeof n)[]).map((id) => ({
    id,
    nome: ROTULO_NOTA[id],
    fracao: Math.min(1, Math.max(0, (n[id] - 1) / 4)),
  }));
}

/** A trava de prontidão segurou o score? Só nesse caso o relatório fala dela. */
export const travaAtiva = (r: Resultado06) => r.prontidao.teto !== null && r.prontidao.score >= r.prontidao.teto - 1e-9;

/** Fases do piloto de 6 semanas, para o infográfico do ganho rápido. */
export const FASES_PILOTO = [
  { semanas: "Semana 1", titulo: "Linha de base", texto: "Medimos o indicador como ele está hoje." },
  { semanas: "Semanas 2 a 5", titulo: "Piloto", texto: "A IA entra no processo escolhido, com a equipe aprovando cada passo." },
  { semanas: "Semana 6", titulo: "Resultado medido", texto: "Comparamos com a linha de base e decidimos o próximo passo." },
] as const;
