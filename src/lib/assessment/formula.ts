/**
 * Calculadora de fórmulas dos pacotes setoriais, sem `eval`.
 *
 * Aceita só o que o motor Python aceita (ast com BinOp + - * /, números e
 * variáveis conhecidas): um pacote alterado não consegue executar código.
 * Sem sinal unário, potência, chamadas ou acesso a propriedades.
 */
import { RespostaInvalida } from "./erros";

type Token =
  | { tipo: "num"; valor: number }
  | { tipo: "nome"; valor: string }
  | { tipo: "op"; valor: "+" | "-" | "*" | "/" }
  | { tipo: "abre" }
  | { tipo: "fecha" };

const NUMERO = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const NOME = /^[A-Za-z_][A-Za-z0-9_]*/;
const MAX_FORMULA = 500;

function tokenizar(formula: string): Token[] {
  if (formula.length > MAX_FORMULA) throw new Error("fórmula longa demais");
  const tokens: Token[] = [];
  let resto = formula;
  while (resto.length > 0) {
    const espaco = /^\s+/.exec(resto);
    if (espaco) {
      resto = resto.slice(espaco[0].length);
      continue;
    }
    const num = NUMERO.exec(resto);
    if (num) {
      tokens.push({ tipo: "num", valor: Number(num[0]) });
      resto = resto.slice(num[0].length);
      continue;
    }
    const nome = NOME.exec(resto);
    if (nome) {
      tokens.push({ tipo: "nome", valor: nome[0] });
      resto = resto.slice(nome[0].length);
      continue;
    }
    const c = resto[0];
    if (c === "+" || c === "-" || c === "*" || c === "/") tokens.push({ tipo: "op", valor: c });
    else if (c === "(") tokens.push({ tipo: "abre" });
    else if (c === ")") tokens.push({ tipo: "fecha" });
    else throw new Error(`construção não permitida na fórmula: '${c}'`);
    resto = resto.slice(1);
  }
  return tokens;
}

/** Calcula a fórmula. Variável sem valor vira RespostaInvalida, como no Python. */
export function calcularFormula(formula: string, variaveis: Readonly<Record<string, number>>): number {
  const tokens = tokenizar(formula);
  let i = 0;

  // expressão := termo (('+' | '-') termo)*   ;   termo := fator (('*' | '/') fator)*
  function expressao(): number {
    let valor = termo();
    for (let t = tokens[i]; t?.tipo === "op" && (t.valor === "+" || t.valor === "-"); t = tokens[i]) {
      i++;
      const dir = termo();
      valor = t.valor === "+" ? valor + dir : valor - dir;
    }
    return valor;
  }

  function termo(): number {
    let valor = fator();
    for (let t = tokens[i]; t?.tipo === "op" && (t.valor === "*" || t.valor === "/"); t = tokens[i]) {
      i++;
      const dir = fator();
      if (t.valor === "/" && dir === 0) throw new Error("divisão por zero na fórmula");
      valor = t.valor === "*" ? valor * dir : valor / dir;
    }
    return valor;
  }

  function fator(): number {
    const t = tokens[i++];
    if (!t) throw new Error("fórmula incompleta");
    if (t.tipo === "num") return t.valor;
    if (t.tipo === "nome") {
      if (!Object.hasOwn(variaveis, t.valor)) throw new RespostaInvalida(`variável sem valor na fórmula: ${t.valor}`);
      const v = variaveis[t.valor];
      if (typeof v !== "number" || !Number.isFinite(v)) throw new RespostaInvalida(`variável inválida na fórmula: ${t.valor}`);
      return v;
    }
    if (t.tipo === "abre") {
      const v = expressao();
      if (tokens[i++]?.tipo !== "fecha") throw new Error("parêntese sem fechar na fórmula");
      return v;
    }
    throw new Error("construção não permitida na fórmula");
  }

  const resultado = expressao();
  if (i !== tokens.length) throw new Error("construção não permitida na fórmula");
  return resultado;
}
