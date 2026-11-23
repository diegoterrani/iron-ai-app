import "server-only";
import path from "node:path";
import { Document, Font, G, Page, Path, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import {
  FASES_PILOTO,
  ROTULOS,
  notaRetorno,
  textoInvestimento,
  textoPessoas,
  textoRegua,
  NIVEIS,
  SELO,
  VEREDITO,
  composicaoCerteza,
  curto,
  custoEspera,
  escalaRegua,
  linhasAtivas,
  linhasForaDaConta,
  minuscula,
  nomeCurto,
  notasProntidao,
  pct,
  pctScore,
  retratoDre,
  travaAtiva,
  vezes,
} from "../apresentacao";
import type { Certeza, Resultado06, Veredito } from "../tipos";
import { LOGO_CAMINHOS, LOGO_TRANSFORMACAO_NOME, LOGO_VIEWBOX, SIMBOLO_VIEWBOX } from "./logo";

/**
 * Relatório do Self 0.6 em PDF (A4), no design system da IRON AI: creme e
 * argila, cantos retos, sem sombras; Source Serif 4 nos títulos, Manrope no
 * texto e IBM Plex Mono nos rótulos. Logo no cabeçalho de toda página e
 * marca d'água ao fundo. Mesmo conteúdo e mesma ordem da tela (8 seções da
 * skill do Self), com as mesmas derivações de `apresentacao.ts`.
 *
 * Segurança: o documento só recebe o resultado já calculado e gravado (lido
 * com RLS pela rota); nada aqui consulta banco, rede ou o LLM. Textos do
 * cliente entram como texto puro (react-pdf não interpreta HTML).
 */

// ------------------------------------------------------------------ fontes
// TTF estáticos gerados das mesmas fontes da tela (OFL). O react-pdf não
// desenha os glifos de WOFF2, por isso a pasta própria (src/fonts/pdf).
const PASTA_FONTES = path.join(process.cwd(), "src", "fonts", "pdf");
let fontesProntas = false;

function registrarFontes() {
  if (fontesProntas) return;
  const f = (nome: string) => path.join(PASTA_FONTES, nome);
  Font.register({
    family: "Manrope",
    fonts: [
      { src: f("manrope-400.ttf"), fontWeight: 400 },
      { src: f("manrope-600.ttf"), fontWeight: 600 },
      { src: f("manrope-700.ttf"), fontWeight: 700 },
    ],
  });
  Font.register({
    family: "SourceSerif",
    fonts: [
      { src: f("source-serif-4-400.ttf"), fontWeight: 400 },
      { src: f("source-serif-4-600.ttf"), fontWeight: 600 },
    ],
  });
  Font.register({
    family: "PlexMono",
    fonts: [
      { src: f("ibm-plex-mono-400.ttf"), fontWeight: 400 },
      { src: f("ibm-plex-mono-600.ttf"), fontWeight: 600 },
    ],
  });
  // Sem hifenização automática (o padrão é do inglês e quebra palavras em português).
  Font.registerHyphenationCallback((palavra) => [palavra]);
  fontesProntas = true;
}

// ------------------------------------------------------------------- tokens
const C = {
  ink: "#141413",
  paper: "#faf9f5",
  surface: "#f0efe6",
  surface2: "#e8e6dc",
  line: "#e7e6e1",
  muted: "#3d3d3a",
  subtle: "#6b6a65",
  faint: "#8f8d86",
  accent: "#c6613f",
  accentText: "#a5502f",
  clay: "#d97757",
  verde: "#2f6b3a",
  danger: "#b42330",
};

const COR_CERTEZA: Record<Certeza, string> = { medido: C.verde, estimado: C.subtle, hipotese: C.accent };
const COR_VEREDITO: Record<Veredito, string> = { seguir: C.verde, deep_para_confirmar: C.accent, comecar_pequeno: C.danger };
const COR_DRE: Record<string, string> = { folha: C.ink, custo: C.muted, outros: C.faint, lucro: C.clay };
const COR_NIVEL = [C.surface2, "#d8d3c4", "#c3bca8", "#aaa28a"];

const s = StyleSheet.create({
  pagina: {
    backgroundColor: C.paper,
    color: C.ink,
    fontFamily: "Manrope",
    fontSize: 9.5,
    lineHeight: 1.5,
    paddingTop: 70,
    paddingBottom: 56,
    paddingHorizontal: 44,
  },
  // A4 = 595 × 842 pt: símbolo de 460 pt de altura centrado na página.
  marca: { position: "absolute", top: 191, left: 0, right: 0, alignItems: "center" },
  cabecalho: {
    position: "absolute",
    top: 24,
    left: 44,
    right: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 0.75,
    borderBottomColor: C.line,
    paddingBottom: 8,
  },
  rodape: {
    position: "absolute",
    bottom: 22,
    left: 44,
    right: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.75,
    borderTopColor: C.line,
    paddingTop: 6,
    fontFamily: "PlexMono",
    fontSize: 7,
    color: C.subtle,
  },
  rotulo: { fontFamily: "PlexMono", fontWeight: 600, fontSize: 7, letterSpacing: 1.2, textTransform: "uppercase", color: C.accentText },
  titulo: { fontFamily: "SourceSerif", fontWeight: 600, fontSize: 24, lineHeight: 1.15, marginTop: 4 },
  subtitulo: { color: C.subtle, marginTop: 4, marginBottom: 14 },
  h2: { fontFamily: "SourceSerif", fontWeight: 600, fontSize: 15, marginBottom: 6 },
  h3: { fontWeight: 700, fontSize: 9.5, marginBottom: 6 },
  secao: { borderTopWidth: 0.75, borderTopColor: C.line, paddingTop: 12, marginTop: 16 },
  dica: { color: C.subtle, fontSize: 8, marginTop: 4 },
  p: { marginBottom: 4 },
  destaque: { fontFamily: "SourceSerif", fontSize: 13, lineHeight: 1.35, marginBottom: 6 },
  kpis: { flexDirection: "row", borderWidth: 0.75, borderColor: C.line },
  kpi: { flex: 1, padding: 10, borderRightWidth: 0.75, borderRightColor: C.line },
  kpiValor: { fontFamily: "SourceSerif", fontSize: 19, lineHeight: 1.15, marginTop: 4, marginBottom: 2 },
  kpiNota: { fontSize: 7.5, color: C.subtle },
  veredito: { borderLeftWidth: 3, backgroundColor: C.surface, padding: 10, marginTop: 12 },
  vereditoTitulo: { fontFamily: "SourceSerif", fontWeight: 600, fontSize: 12, marginBottom: 2 },
  colunas: { flexDirection: "row", gap: 12, marginTop: 12 },
  bloco: { flex: 1, borderWidth: 0.75, borderColor: C.line, padding: 10 },
  barraLinha: { flexDirection: "row", alignItems: "center", marginBottom: 5 },
  barraRotulo: { width: "34%", paddingRight: 6 },
  barraTrilho: { flex: 1, height: 7, backgroundColor: C.surface2, flexDirection: "row" },
  barraValor: { width: 62, textAlign: "right", fontWeight: 700 },
  legenda: { flexDirection: "row", flexWrap: "wrap", marginTop: 6 },
  legendaItem: { flexDirection: "row", alignItems: "center", marginRight: 12, marginBottom: 2, fontSize: 7.5, color: C.muted },
  chave: { width: 7, height: 7, marginRight: 4 },
  tabela: { marginTop: 8, borderTopWidth: 0.75, borderTopColor: C.line },
  tr: { flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: C.line, paddingVertical: 4 },
  th: { fontFamily: "PlexMono", fontWeight: 600, fontSize: 6.5, letterSpacing: 0.8, textTransform: "uppercase", color: C.subtle },
  num: { textAlign: "right" },
  selo: { fontSize: 6.5, fontWeight: 700, borderWidth: 0.75, paddingHorizontal: 3, paddingVertical: 1, alignSelf: "flex-start" },
  cartoes: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 },
  cartao: { borderLeftWidth: 2.5, borderLeftColor: C.verde, backgroundColor: C.surface, paddingVertical: 4, paddingHorizontal: 8, fontWeight: 600 },
  fases: { flexDirection: "row", gap: 3, marginTop: 8 },
  fase: { backgroundColor: C.surface, borderTopWidth: 3, padding: 8 },
  lista: { flexDirection: "row", marginBottom: 3 },
  marcador: { width: 10, color: C.accent },
});

// --------------------------------------------------------------- peças
const emPct = (f: number) => `${(Math.min(1, Math.max(0, Number.isFinite(f) ? f : 0)) * 100).toFixed(2)}%`;

/** Logo completo (símbolo + nome), em vetor. */
function Logo({ largura }: { largura: number }) {
  const [, , w, h] = LOGO_VIEWBOX.split(" ").map(Number);
  return (
    <Svg viewBox={LOGO_VIEWBOX} width={largura} height={(largura * h) / w}>
      {LOGO_CAMINHOS.filter((c) => !c.grupo).map((c, i) => (
        <Path key={i} d={c.d} fill={c.fill} fillRule="evenodd" />
      ))}
      <G transform={LOGO_TRANSFORMACAO_NOME}>
        {LOGO_CAMINHOS.filter((c) => c.grupo).map((c, i) => (
          <Path key={i} d={c.d} fill={c.fill} fillRule="evenodd" />
        ))}
      </G>
    </Svg>
  );
}

/** Marca d'água: só o símbolo, grande e quase transparente (a opacidade vai em cada caminho). */
function MarcaDagua({ altura }: { altura: number }) {
  const [, , w, h] = SIMBOLO_VIEWBOX.split(" ").map(Number);
  return (
    <Svg viewBox={SIMBOLO_VIEWBOX} width={(altura * w) / h} height={altura}>
      {LOGO_CAMINHOS.filter((c) => !c.grupo).map((c, i) => (
        <Path key={i} d={c.d} fill={c.fill} fillOpacity={0.05} fillRule="evenodd" />
      ))}
    </Svg>
  );
}

function Barra({ fracao, ate, cor }: { fracao: number; ate?: number; cor: string }) {
  return (
    <View style={s.barraTrilho}>
      <View style={{ width: emPct(fracao), backgroundColor: cor }} />
      {ate !== undefined && ate > fracao && <View style={{ width: emPct(ate - fracao), backgroundColor: cor, opacity: 0.3 }} />}
    </View>
  );
}

function LinhaBarra({ rotulo, valor, fracao, ate, cor, larguraRotulo }: { rotulo: string; valor: string; fracao: number; ate?: number; cor: string; larguraRotulo?: string }) {
  return (
    <View style={s.barraLinha} wrap={false}>
      <Text style={[s.barraRotulo, larguraRotulo ? { width: larguraRotulo } : {}]}>{rotulo}</Text>
      <Barra fracao={fracao} ate={ate} cor={cor} />
      <Text style={s.barraValor}>{valor}</Text>
    </View>
  );
}

function Empilhada({ fatias }: { fatias: { fracao: number; cor: string; chave: string }[] }) {
  // Sem flex: 1 (o trilho das linhas cresce na horizontal; aqui a barra é bloco de altura fixa).
  return (
    <View style={{ height: 14, width: "100%", backgroundColor: C.surface2, flexDirection: "row" }}>
      {fatias.map((f) => (
        <View key={f.chave} style={{ width: emPct(f.fracao), backgroundColor: f.cor }} />
      ))}
    </View>
  );
}

function Legenda({ itens }: { itens: { cor: string; texto: string; claro?: boolean }[] }) {
  return (
    <View style={s.legenda}>
      {itens.map((i) => (
        <View key={i.texto} style={s.legendaItem}>
          <View style={[s.chave, { backgroundColor: i.cor, opacity: i.claro ? 0.3 : 1 }]} />
          <Text>{i.texto}</Text>
        </View>
      ))}
    </View>
  );
}

function Selo({ c }: { c: Certeza }) {
  return <Text style={[s.selo, { color: COR_CERTEZA[c], borderColor: COR_CERTEZA[c] }]}>{SELO[c].texto}</Text>;
}

/** Escala de 0 a `max` com barra, marca vertical opcional e rótulos (régua de retorno e prontidão). */
function Escala({
  faixas,
  fracao,
  marca,
  corBarra,
  corMarca,
  rotulos,
}: {
  faixas?: { de: number; ate: number; cor: string }[];
  fracao: number;
  marca?: number;
  corBarra: string;
  corMarca: string;
  rotulos: { em: number; texto: string }[];
}) {
  return (
    <View wrap={false}>
      <View style={{ height: 22, position: "relative" }}>
        <View style={{ position: "absolute", top: 5, left: 0, right: 0, height: 12, backgroundColor: C.surface2 }} />
        {faixas?.map((f) => (
          <View key={f.de} style={{ position: "absolute", top: 5, left: emPct(f.de), width: emPct(f.ate - f.de), height: 12, backgroundColor: f.cor }} />
        ))}
        <View style={{ position: "absolute", top: faixas ? 9 : 5, left: 0, width: emPct(fracao), height: faixas ? 4 : 12, backgroundColor: corBarra }} />
        {marca !== undefined && <View style={{ position: "absolute", top: 0, left: emPct(marca), width: 1.5, height: 22, backgroundColor: corMarca }} />}
      </View>
      <View style={{ height: 12, position: "relative", marginTop: 2 }}>
        {rotulos.map((r) => (
          <Text
            key={r.texto}
            style={{
              position: "absolute",
              left: emPct(r.em),
              width: 60,
              marginLeft: r.em <= 0 ? 0 : r.em >= 1 ? -60 : -30,
              textAlign: r.em <= 0 ? "left" : r.em >= 1 ? "right" : "center",
              fontFamily: "PlexMono",
              fontSize: 6.5,
              color: C.subtle,
            }}
          >
            {r.texto}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Seção do relatório. `inteira`: não se divide entre páginas (o título nunca fica sozinho no pé). */
function Secao({ titulo, children, inteira = false }: { titulo: string; children: ReactNode; inteira?: boolean }) {
  return (
    <View style={s.secao} wrap={!inteira}>
      <Text style={s.h2} minPresenceAhead={200}>
        {titulo}
      </Text>
      {children}
    </View>
  );
}

// -------------------------------------------------------------- documento
export interface CabecalhoPdf {
  empresa?: string;
  local?: string;
  calculadoEm: string;
}

const dataLonga = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" });

export function RelatorioPdf06({ r, cab }: { r: Resultado06; cab: CabecalhoPdf }) {
  registrarFontes();
  const ativas = linhasAtivas(r);
  const maiorBase = Math.max(1, ...ativas.map((l) => l.base));
  const fora = linhasForaDaConta(r);
  const v = VEREDITO[r.regua.veredito];
  const corV = COR_VEREDITO[r.regua.veredito];
  const regua = escalaRegua(r);
  const certezas = composicaoCerteza(r);
  const espera = custoEspera(r);
  const maiorEspera = Math.max(1, ...espera.map((e) => e.valor));
  const dre = retratoDre(r);
  const investimento = textoInvestimento(r);
  const lucro = Math.max(0, r.empresa.lucro);
  const maiorDeep = Math.max(1, ...r.deep.itens.map((i) => i.valor));
  const lucroPct = r.pct_lucro.conservador;
  const data = dataLonga.format(new Date(cab.calculadoEm));
  const nomeEmpresa = cab.empresa?.trim() || "Empresa avaliada";

  return (
    <Document
      title={`Self Assessment: ${nomeEmpresa}`}
      author="IRON AI"
      subject="Relatório executivo do Self Assessment"
      creator="IRON AI"
      producer="IRON AI"
      language="pt-BR"
    >
      <Page size="A4" style={s.pagina}>
        {/* Marca d'água e moldura repetidas em toda página. */}
        <View style={s.marca} fixed>
          <MarcaDagua altura={460} />
        </View>
        <View style={s.cabecalho} fixed>
          <Logo largura={92} />
          <Text style={s.rotulo}>Self Assessment · Relatório executivo</Text>
        </View>
        <View style={s.rodape} fixed>
          <Text>
            {nomeEmpresa} · {data} · confidencial
          </Text>
          <Text render={({ pageNumber, totalPages }) => `iron-ai.io · ${pageNumber} de ${totalPages}`} />
        </View>

        {/* 1. O número */}
        <Text style={s.rotulo}>Food service{cab.local ? ` · ${cab.local}` : ""}</Text>
        <Text style={s.titulo}>Resultado: {nomeEmpresa}</Text>
        <Text style={s.subtitulo}>Calculado em {data}. Valores anuais em R$, cenário conservador em destaque.</Text>

        <View style={s.kpis} wrap={false}>
          <View style={[s.kpi, { backgroundColor: C.ink }]}>
            <Text style={[s.rotulo, { color: C.clay }]}>Ganho anual conservador</Text>
            <Text style={[s.kpiValor, { color: C.paper }]}>{curto(r.total.conservador)}</Text>
            <Text style={[s.kpiNota, { color: C.surface2 }]}>depois da implantação · base {curto(r.total.base)}</Text>
          </View>
          <View style={s.kpi}>
            <Text style={s.rotulo}>{ROTULOS.kpiAtraso}</Text>
            <Text style={s.kpiValor}>{curto(r.por_mes)}</Text>
            <Text style={s.kpiNota}>{ROTULOS.kpiAtrasoNota}</Text>
          </View>
          <View style={s.kpi}>
            <Text style={s.rotulo}>Sobre o lucro de hoje</Text>
            <Text style={s.kpiValor}>{lucroPct !== null ? `${pct(lucroPct)}%` : "—"}</Text>
            <Text style={s.kpiNota}>{lucroPct !== null ? "do lucro líquido atual" : "margem não positiva"}</Text>
          </View>
          <View style={[s.kpi, { borderRightWidth: 0 }]}>
            <Text style={s.rotulo}>Retorno em 24 meses</Text>
            <Text style={s.kpiValor}>{vezes(r.regua.retorno_x)}×</Text>
            <Text style={s.kpiNota}>{notaRetorno(r)}</Text>
          </View>
        </View>

        <View style={[s.veredito, { borderLeftColor: corV }]} wrap={false}>
          <Text style={s.vereditoTitulo}>{v.titulo}</Text>
          <Text>{v.texto}</Text>
        </View>

        <View style={s.colunas} wrap={false}>
          <View style={s.bloco}>
            <Text style={s.h3}>Régua de 3 vezes em 24 meses</Text>
            <Escala
              fracao={regua.retorno / regua.max}
              marca={regua.alvo / regua.max}
              corBarra={corV}
              corMarca={C.ink}
              rotulos={Array.from({ length: regua.max + 1 }, (_, i) => ({ em: i / regua.max, texto: `${i}×` }))}
            />
            {investimento && <Text style={{ fontWeight: 700, marginTop: 4 }}>{investimento}</Text>}
            <Text style={s.dica}>{textoRegua(r)}</Text>
          </View>
          <View style={s.bloco}>
            <Text style={s.h3}>{ROTULOS.blocoAtraso}</Text>
            {espera.map((e) => (
              <LinhaBarra key={e.meses} rotulo={`${e.meses} meses`} valor={curto(e.valor)} fracao={e.valor / maiorEspera} cor={C.accent} larguraRotulo="28%" />
            ))}
            <Text style={s.dica}>{ROTULOS.notaCruzeiro}</Text>
            <Text style={s.dica}>No primeiro ano, com a prontidão de hoje, a captura estimada é de {curto(r.ano1.conservador)}.</Text>
          </View>
        </View>

        {dre.length > 0 && (
          <View style={[s.bloco, { marginTop: 12 }]} wrap={false}>
            <Text style={s.h3}>Onde o ganho cai no seu DRE</Text>
            <Empilhada fatias={dre.map((f) => ({ chave: f.id, fracao: f.fracao, cor: COR_DRE[f.id] }))} />
            <Legenda itens={dre.map((f) => ({ cor: COR_DRE[f.id], texto: `${f.nome}: ${f.pct}% (${curto(f.valor)})` }))} />
            {lucro > 0 && (
              <View style={{ marginTop: 6 }}>
                <LinhaBarra rotulo="Lucro hoje" valor={curto(lucro)} fracao={lucro / (lucro + r.total.conservador)} cor={C.clay} />
                <LinhaBarra rotulo="Lucro com o ganho conservador" valor={curto(lucro + r.total.conservador)} fracao={1} cor={C.accent} />
              </View>
            )}
          </View>
        )}

        {r.alertas.map((a) => (
          <View key={a.codigo} style={[s.veredito, { borderLeftColor: C.faint }]} wrap={false}>
            <Text>{a.texto}</Text>
          </View>
        ))}

        {/* 2. O que preservamos */}
        <Secao titulo="O que preservamos" inteira>
          {r.linhas_vermelhas.length > 0 || r.linhas_vermelhas_outro ? (
            <>
              <View style={s.cartoes}>
                {r.linhas_vermelhas.map((l) => (
                  <Text key={l.id} style={s.cartao}>
                    {l.nome}
                  </Text>
                ))}
                {r.linhas_vermelhas_outro && <Text style={s.cartao}>{r.linhas_vermelhas_outro}</Text>}
              </View>
              <Text style={s.p}>Nenhuma linha deste relatório toca nesses pontos. A IA trabalha em volta do que é humano, não no lugar dele.</Text>
            </>
          ) : (
            <Text style={s.p}>
              Você não marcou nada como intocável. Mesmo assim, nenhuma linha deste relatório mexe em receita, cardápio ou modo de preparo.
            </Text>
          )}
          {r.bloqueadas.length > 0 && <Text style={s.dica}>Saíram da conta por sua escolha: {r.bloqueadas.map((b) => nomeCurto(b.nome)).join("; ")}.</Text>}
        </Secao>

        {/* 3. De onde vem */}
        <Secao titulo="De onde vem">
          <View style={s.colunas} wrap={false}>
            <View style={[s.bloco, { flex: 2 }]}>
              <Text style={s.h3}>Ganho por linha, por ano (conservador; trecho claro até o base)</Text>
              {ativas.map((l) => (
                <LinhaBarra
                  key={l.alavanca}
                  rotulo={nomeCurto(l.nome)}
                  valor={curto(l.conservador)}
                  fracao={l.conservador / maiorBase}
                  ate={l.base / maiorBase}
                  cor={COR_CERTEZA[l.certeza]}
                />
              ))}
              <Legenda itens={(["medido", "estimado", "hipotese"] as const).map((c) => ({ cor: COR_CERTEZA[c], texto: SELO[c].texto }))} />
            </View>
            <View style={s.bloco}>
              <Text style={s.h3}>Quão firme é a base</Text>
              <Empilhada fatias={certezas.map((c) => ({ chave: c.certeza, fracao: c.fracao, cor: COR_CERTEZA[c.certeza] }))} />
              <View style={{ marginTop: 6 }}>
                {certezas.map((c) => (
                  <View key={c.certeza} style={s.legendaItem}>
                    <View style={[s.chave, { backgroundColor: COR_CERTEZA[c.certeza] }]} />
                    <Text>
                      {SELO[c.certeza].texto}: {pct(c.fracao * 100)}% ({curto(c.valor)})
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
          <Text style={s.dica}>
            O selo diz de onde veio a base de cada conta: {SELO.medido.texto} ({SELO.medido.explica}), {SELO.estimado.texto} ({SELO.estimado.explica}) ou{" "}
            {SELO.hipotese.texto} ({SELO.hipotese.explica}). As taxas de ganho são referências da IRON, medidas no Deep.
          </Text>
          <View style={s.tabela}>
            <View style={s.tr} fixed>
              <Text style={[s.th, { flex: 3.2 }]}>Onde</Text>
              <Text style={[s.th, { flex: 1.4 }]}>Linha do DRE</Text>
              <Text style={[s.th, s.num, { flex: 0.9 }]}>Conservador</Text>
              <Text style={[s.th, s.num, { flex: 0.9 }]}>Base</Text>
              <Text style={[s.th, { flex: 0.8, paddingLeft: 8 }]}>Certeza</Text>
            </View>
            {ativas.map((l) => (
              <View key={l.alavanca} style={s.tr} wrap={false}>
                <View style={{ flex: 3.2, paddingRight: 6 }}>
                  <Text>{l.nome}</Text>
                  <Text style={[s.dica, { marginTop: 1 }]}>{l.motivo_certeza}</Text>
                </View>
                <Text style={{ flex: 1.4, paddingRight: 4 }}>{l.linha_dre}</Text>
                <Text style={[s.num, { flex: 0.9 }]}>{curto(l.conservador)}</Text>
                <Text style={[s.num, { flex: 0.9 }]}>{curto(l.base)}</Text>
                <View style={{ flex: 0.8, paddingLeft: 8 }}>
                  <Selo c={l.certeza} />
                </View>
              </View>
            ))}
            <View style={[s.tr, { backgroundColor: C.surface }]} wrap={false}>
              <Text style={[s.th, { flex: 4.6, paddingLeft: 2 }]}>Total por ano</Text>
              <Text style={[s.num, { flex: 0.9, fontWeight: 700 }]}>{curto(r.total.conservador)}</Text>
              <Text style={[s.num, { flex: 0.9, fontWeight: 700 }]}>{curto(r.total.base)}</Text>
              <Text style={{ flex: 0.8 }} />
            </View>
          </View>
          {fora.length > 0 && <Text style={s.dica}>Não entraram: {fora.map((l) => `${nomeCurto(l.nome)} (${l.fora})`).join("; ")}.</Text>}
        </Secao>

        {/* 4. Pessoas */}
        <Secao titulo="Pessoas" inteira>
          {r.pessoas.bloqueado_por_quadro ? (
            <Text style={s.p}>
              Você marcou o quadro de pessoas como intocável: nenhuma linha conta com deixar de repor vagas. As horas que a IA liberar voltam para
              tarefas de mais valor.
            </Text>
          ) : r.pessoas.horas_liberadas > 0 ? (
            <View wrap={false}>
              <Empilhada
                fatias={[
                  { chave: "horas", fracao: r.pessoas.pct_do_ganho, cor: C.accent },
                  { chave: "resto", fracao: 1 - r.pessoas.pct_do_ganho, cor: C.surface2 },
                ]}
              />
              <Legenda
                itens={[
                  { cor: C.accent, texto: `Horas liberadas: ${pct(r.pessoas.pct_do_ganho * 100)}% (${curto(r.pessoas.horas_liberadas)})` },
                  { cor: C.surface2, texto: `Demais linhas: ${pct((1 - r.pessoas.pct_do_ganho) * 100)}%` },
                ]}
              />
              <Text style={[s.p, { marginTop: 6 }]}>{textoPessoas(r)}</Text>
            </View>
          ) : (
            <Text style={s.p}>Nenhuma linha deste relatório depende de deixar de repor vagas.</Text>
          )}
        </Secao>

        {/* 5. Ganho rápido */}
        <Secao titulo="Ganho rápido em 6 semanas" inteira>
          <View wrap={false}>
            <Text style={s.destaque}>{r.ganho_rapido.titulo}</Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.rotulo}>Meta</Text>
                <Text>{r.ganho_rapido.meta}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rotulo}>Indicador</Text>
                <Text>{r.ganho_rapido.kpi}</Text>
              </View>
              {r.ganho_rapido.valor_alavanca > 0 && (
                <View style={{ flex: 1 }}>
                  <Text style={s.rotulo}>Linha em jogo</Text>
                  <Text>{curto(r.ganho_rapido.valor_alavanca)} por ano no conservador</Text>
                </View>
              )}
            </View>
            <View style={s.fases}>
              {FASES_PILOTO.map((f, i) => (
                <View key={f.titulo} style={[s.fase, { flex: i === 1 ? 2 : 1, borderTopColor: i === 0 ? C.ink : i === 2 ? C.verde : C.accent }]}>
                  <Text style={[s.rotulo, { color: C.subtle }]}>{f.semanas}</Text>
                  <Text style={{ fontWeight: 700 }}>{f.titulo}</Text>
                  <Text style={{ fontSize: 8.5 }}>{f.texto}</Text>
                </View>
              ))}
            </View>
            <Text style={s.dica}>
              Nasce do problema que você escolheu ({minuscula(r.ganho_rapido.dor)}). O piloto prova o ganho antes de qualquer projeto maior.
            </Text>
          </View>
        </Secao>

        {/* 6. Prontidão e riscos */}
        <Secao titulo="Prontidão e riscos" inteira>
          <View style={s.colunas} wrap={false}>
            <View style={s.bloco}>
              <Text style={s.h3}>
                Nível {r.prontidao.nivel} ({pctScore(r.prontidao.score)}%)
              </Text>
              <Escala
                faixas={NIVEIS.map((n, i) => ({ de: n.de, ate: n.ate, cor: COR_NIVEL[i] ?? C.surface2 }))}
                fracao={r.prontidao.score}
                marca={travaAtiva(r) && r.prontidao.teto !== null ? r.prontidao.teto : undefined}
                corBarra={C.ink}
                corMarca={C.danger}
                rotulos={NIVEIS.map((n) => ({ em: (n.de + n.ate) / 2, texto: n.nome }))}
              />
              <Text style={[s.p, { marginTop: 4 }]}>
                Com a prontidão de hoje, a empresa captura cerca de {pct(r.prontidao.R * 100)}% do potencial no primeiro ano.
              </Text>
              {travaAtiva(r) && r.prontidao.teto !== null && (
                <Text style={s.dica}>
                  Sem patrocínio com orçamento ou sem dados registrados, projetos de IA costumam parar no piloto; por isso o nível fica limitado a{" "}
                  {pct(r.prontidao.teto * 100)}% (linha vermelha).
                </Text>
              )}
            </View>
            <View style={s.bloco}>
              <Text style={s.h3}>O que pesa na prontidão</Text>
              {notasProntidao(r).map((n) => (
                <LinhaBarra key={n.id} rotulo={n.nome} valor={`${pct(n.fracao * 100)}%`} fracao={n.fracao} cor={C.ink} larguraRotulo="46%" />
              ))}
            </View>
          </View>
          {r.riscos.length > 0 && (
            <View style={{ marginTop: 10 }}>
              <Text style={s.h3}>Riscos a tratar</Text>
              {r.riscos.map((x) => (
                <View key={x} style={s.lista} wrap={false}>
                  <Text style={s.marcador}>•</Text>
                  <Text style={{ flex: 1 }}>{x}</Text>
                </View>
              ))}
            </View>
          )}
        </Secao>

        {/* 7. O que o Deep resolve */}
        <Secao titulo="O que o Deep resolve">
          {r.deep.itens.length > 0 ? (
            <>
              <Text style={s.destaque}>
                {curto(r.deep.valor_em_jogo)} por ano ainda são estimativa ou hipótese. O Deep transforma esse valor em linha de base assinada pelo seu
                financeiro.
              </Text>
              <View wrap={false}>
                {r.deep.itens.map((i) => (
                  <LinhaBarra key={i.nome} rotulo={nomeCurto(i.nome)} valor={curto(i.valor)} fracao={i.valor / maiorDeep} cor={COR_CERTEZA[i.certeza]} />
                ))}
              </View>
              <View style={s.tabela}>
                <View style={s.tr}>
                  <Text style={[s.th, { flex: 2 }]}>Linha</Text>
                  <Text style={[s.th, s.num, { flex: 0.8, paddingRight: 8 }]}>Em jogo</Text>
                  <Text style={[s.th, { flex: 3 }]}>O que medimos</Text>
                </View>
                {r.deep.itens.map((i) => (
                  <View key={i.nome} style={s.tr} wrap={false}>
                    <View style={{ flex: 2, paddingRight: 6, flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                      <Text>{nomeCurto(i.nome)}</Text>
                      <Selo c={i.certeza} />
                    </View>
                    <Text style={[s.num, { flex: 0.8, paddingRight: 8 }]}>{curto(i.valor)}</Text>
                    <Text style={{ flex: 3 }}>{i.dado}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <Text style={s.p}>Todas as bases foram informadas por você. O Deep mede as taxas de ganho com os seus dados.</Text>
          )}
        </Secao>

        {/* 8. Próximo passo */}
        <Secao titulo="Próximo passo" inteira>
          <View wrap={false}>
            <Text style={s.p}>Converse com a equipe IRON AI para levar este resultado à sessão executiva e agendar o Deep.</Text>
            <Text style={s.dica}>
              Motor {r.versoes.motor} · modelo {r.versoes.modelo} · pacote {r.versoes.pacote} · código {r.hash_respostas}
            </Text>
          </View>
        </Secao>
      </Page>
    </Document>
  );
}
