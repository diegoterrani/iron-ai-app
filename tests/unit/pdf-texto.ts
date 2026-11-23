/**
 * Extrai o texto de cada página de um PDF gerado pelo @react-pdf/renderer,
 * só para os testes (sem dependência nova). Cobre o que o pdfkit escreve:
 * objetos simples, streams FlateDecode, fontes com ToUnicode e texto em
 * Tj/TJ hexadecimal. Cada bloco BT…ET vira uma linha.
 */
import { inflateSync } from "node:zlib";

interface Obj {
  dict: string;
  stream?: Buffer;
}

function objetos(pdf: Buffer): Map<number, Obj> {
  const mapa = new Map<number, Obj>();
  const latin = pdf.toString("latin1");
  const re = /(\d+) 0 obj\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin))) {
    const inicio = m.index + m[0].length;
    const fim = latin.indexOf("endobj", inicio);
    const corpo = latin.slice(inicio, fim);
    const s = corpo.indexOf("stream");
    if (s >= 0 && corpo.startsWith("<<")) {
      const dict = corpo.slice(0, s);
      let ini = inicio + s + "stream".length;
      if (latin[ini] === "\r") ini++;
      if (latin[ini] === "\n") ini++;
      const tam = Number(/\/Length (\d+)/.exec(dict)?.[1] ?? 0);
      let dados = pdf.subarray(ini, ini + tam);
      if (dict.includes("/FlateDecode")) dados = inflateSync(dados);
      mapa.set(Number(m[1]), { dict, stream: dados });
    } else {
      mapa.set(Number(m[1]), { dict: corpo });
    }
    re.lastIndex = fim;
  }
  return mapa;
}

const ref = (dict: string, chave: string) => {
  const r = new RegExp(`/${chave} (\\d+) 0 R`).exec(dict);
  return r ? Number(r[1]) : null;
};

/** Tabela glifo → texto a partir do CMap ToUnicode. */
function cmap(texto: string): Map<number, string> {
  const t = new Map<number, string>();
  // Ligaduras vêm com mais de um código no mesmo <…> ("<0066 0069>" = "fi").
  const u = (hex: string) => String.fromCodePoint(...(hex.replace(/\s+/g, "").match(/.{4}/g) ?? []).map((h) => parseInt(h, 16)));
  for (const bloco of texto.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, g, v] of bloco[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) t.set(parseInt(g, 16), u(v));
  }
  for (const bloco of texto.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, a, b, resto] of bloco[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g)) {
      const ini = parseInt(a, 16);
      const fim = parseInt(b, 16);
      if (resto.startsWith("[")) {
        const lista = [...resto.matchAll(/<([0-9a-fA-F\s]+)>/g)].map((x) => x[1]);
        for (let g = ini; g <= fim; g++) t.set(g, u(lista[g - ini] ?? ""));
      } else {
        const base = parseInt(resto.slice(1, -1), 16);
        for (let g = ini; g <= fim; g++) t.set(g, String.fromCodePoint(base + g - ini));
      }
    }
  }
  return t;
}

export function textoDasPaginas(pdf: Buffer): string[] {
  const objs = objetos(pdf);
  const raiz = [...objs.values()].find((o) => /\/Type \/Pages\b/.test(o.dict));
  const kids = [...(/\/Kids \[([^\]]*)\]/.exec(raiz?.dict ?? "")?.[1] ?? "").matchAll(/(\d+) 0 R/g)].map((k) => Number(k[1]));
  const cmaps = new Map<number, Map<number, string>>();

  return kids.map((id) => {
    const pagina = objs.get(id)!.dict;
    const recursos = objs.get(ref(pagina, "Resources")!)!.dict;
    const fontes = new Map<string, Map<number, string>>();
    const blocoFontes = /\/Font\s*<<([\s\S]*?)>>/.exec(recursos)?.[1] ?? "";
    for (const [, nome, num] of blocoFontes.matchAll(/\/(\S+) (\d+) 0 R/g)) {
      const fonte = objs.get(Number(num))!.dict;
      const tu = ref(fonte, "ToUnicode");
      if (tu === null) continue;
      if (!cmaps.has(tu)) cmaps.set(tu, cmap(objs.get(tu)!.stream!.toString("latin1")));
      fontes.set(nome, cmaps.get(tu)!);
    }
    const conteudo = objs.get(ref(pagina, "Contents")!)!.stream!.toString("latin1");
    const linhas: string[] = [];
    let atual = "";
    let fonte: Map<number, string> | undefined;
    const decodifica = (hex: string) =>
      (hex.match(/.{4}/g) ?? []).map((g) => fonte?.get(parseInt(g, 16)) ?? "").join("");
    const tokens = /\/(\S+) [\d.]+ Tf|<([0-9a-fA-F]*)>|\bET\b|(-?\d+(?:\.\d+)?) ?(?=[^\]]*\] TJ)/g;
    let t: RegExpExecArray | null;
    while ((t = tokens.exec(conteudo))) {
      if (t[1]) fonte = fontes.get(t[1]);
      else if (t[2] !== undefined) atual += decodifica(t[2]);
      else if (t[3] !== undefined) {
        if (Number(t[3]) < -200) atual += " ";
      } else if (t[0] === "ET") {
        if (atual.trim()) linhas.push(atual.trim());
        atual = "";
      }
    }
    return linhas.join("\n");
  });
}
