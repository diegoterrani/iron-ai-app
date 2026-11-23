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
} from "@/lib/assessment/v06/apresentacao";
import type { Certeza, Resultado06 } from "@/lib/assessment/v06/tipos";
import { Barra, BarraEmpilhada, Escala, Regua, classeCerteza } from "./graficos-06";
import { CONTATO_URL } from "@/lib/ui/textos";
import { BotaoImprimir } from "./imprimir";

/**
 * Relatório do Self 0.6 em formato executivo, na ordem fixa da skill do Self:
 * o número, o que preservamos, de onde vem, pessoas, ganho rápido, prontidão
 * e riscos, o que o Deep resolve e o próximo passo. Cada seção abre com um
 * visual e mantém o detalhe (tabelas e textos) logo abaixo. Os números vêm
 * prontos do motor; aqui só se formata. Sem preço: a proposta comercial é
 * feita pela equipe. O PDF (rota ./pdf) usa as mesmas derivações.
 */

function Selo({ c }: { c: Certeza }) {
  return <span className={`selo selo-${c}`}>{SELO[c].texto}</span>;
}

/** Legenda de cor por selo de certeza. */
function LegendaCerteza({ com = false }: { com?: boolean }) {
  return (
    <ul className="g-legenda" aria-hidden="true">
      {(["medido", "estimado", "hipotese"] as const).map((c) => (
        <li key={c}>
          <span className={`g-chave ${classeCerteza(c)}`} />
          {SELO[c].texto}
        </li>
      ))}
      {com && (
        <li>
          <span className="g-chave g-chave-clara" />
          até o cenário base
        </li>
      )}
    </ul>
  );
}

const CLASSE_VEREDITO: Record<Resultado06["regua"]["veredito"], string> = {
  seguir: "g-bom",
  deep_para_confirmar: "g-atencao",
  comecar_pequeno: "g-alerta",
};

export function Relatorio06({ r, assessmentId }: { r: Resultado06; assessmentId: string }) {
  const ativas = linhasAtivas(r);
  const maiorBase = Math.max(1, ...ativas.map((l) => l.base));
  const foraDaConta = linhasForaDaConta(r);
  const v = VEREDITO[r.regua.veredito];
  const lucroPct = r.pct_lucro.conservador;
  const regua = escalaRegua(r);
  const certezas = composicaoCerteza(r);
  const espera = custoEspera(r);
  const maiorEspera = Math.max(1, ...espera.map((e) => e.valor));
  const dre = retratoDre(r);
  const investimento = textoInvestimento(r);
  const lucro = Math.max(0, r.empresa.lucro);
  const maiorDeep = Math.max(1, ...r.deep.itens.map((i) => i.valor));

  return (
    <>
      {/* 1. O número */}
      <section id="r-topo" className="rel-capa" aria-labelledby="r-numero">
        <h2 id="r-numero" className="sr-only">
          O número
        </h2>
        <div className="rel-kpis">
          <div className="rel-kpi rel-kpi-destaque">
            <p className="rel-kpi-rotulo">Ganho anual conservador</p>
            <p className="rel-kpi-valor">{curto(r.total.conservador)}</p>
            <p className="rel-kpi-nota">depois da implantação · base {curto(r.total.base)}</p>
          </div>
          <div className="rel-kpi">
            <p className="rel-kpi-rotulo">{ROTULOS.kpiAtraso}</p>
            <p className="rel-kpi-valor">{curto(r.por_mes)}</p>
            <p className="rel-kpi-nota">{ROTULOS.kpiAtrasoNota}</p>
          </div>
          <div className="rel-kpi">
            <p className="rel-kpi-rotulo">Sobre o lucro de hoje</p>
            <p className="rel-kpi-valor">{lucroPct !== null ? `${pct(lucroPct)}%` : "—"}</p>
            <p className="rel-kpi-nota">{lucroPct !== null ? "do lucro líquido atual" : "margem não positiva: o ganho aparece em R$"}</p>
          </div>
          <div className="rel-kpi">
            <p className="rel-kpi-rotulo">Retorno em 24 meses</p>
            <p className="rel-kpi-valor">{vezes(r.regua.retorno_x)}×</p>
            <p className="rel-kpi-nota">{notaRetorno(r)}</p>
          </div>
        </div>

        <div className={`rel-veredito rel-veredito-${r.regua.veredito}`} role="note">
          <p className="rel-veredito-titulo">{v.titulo}</p>
          <p>{v.texto}</p>
        </div>

        <div className="rel-painel">
          <div className="rel-bloco">
            <h3>Régua de 3 vezes em 24 meses</h3>
            <Regua retorno={regua.retorno} alvo={regua.alvo} max={regua.max} classe={CLASSE_VEREDITO[r.regua.veredito]} />
            {investimento && <p className="rel-investimento">{investimento}</p>}
            <p className="field-hint">{textoRegua(r)} A proposta sai do Deep.</p>
          </div>
          <div className="rel-bloco">
            <h3>{ROTULOS.blocoAtraso}</h3>
            <ul className="g-linhas g-linhas-compactas">
              {espera.map((e) => (
                <li key={e.meses}>
                  <span className="g-rotulo">{e.meses} meses</span>
                  <Barra fracao={e.valor / maiorEspera} classe="g-acento" />
                  <span className="g-valor-texto">{curto(e.valor)}</span>
                </li>
              ))}
            </ul>
            <p className="field-hint">{ROTULOS.notaCruzeiro}</p>
            <p className="field-hint">No primeiro ano, com a prontidão de hoje, a captura estimada é de {curto(r.ano1.conservador)}.</p>
          </div>
        </div>

        {dre.length > 0 && (
          <div className="rel-bloco">
            <h3>Onde o ganho cai no seu DRE</h3>
            <BarraEmpilhada fatias={dre.map((f) => ({ chave: f.id, fracao: f.fracao, classe: `g-dre-${f.id}` }))} />
            <ul className="g-legenda">
              {dre.map((f) => (
                <li key={f.id}>
                  <span className={`g-chave g-dre-${f.id}`} aria-hidden="true" />
                  {f.nome}: {f.pct}% ({curto(f.valor)})
                </li>
              ))}
            </ul>
            {lucro > 0 && (
              <ul className="g-linhas">
                <li>
                  <span className="g-rotulo">Lucro hoje</span>
                  <Barra fracao={lucro / (lucro + r.total.conservador)} classe="g-dre-lucro" alta />
                  <span className="g-valor-texto">{curto(lucro)}</span>
                </li>
                <li>
                  <span className="g-rotulo">Lucro com o ganho conservador</span>
                  <Barra fracao={1} classe="g-acento" alta />
                  <span className="g-valor-texto">{curto(lucro + r.total.conservador)}</span>
                </li>
              </ul>
            )}
            <p className="field-hint">Retrato montado com os números que você informou; o ganho reduz custo ou aumenta receita nas linhas da tabela abaixo.</p>
          </div>
        )}

        {r.alertas.map((a) => (
          <p key={a.codigo} className="notice" role="note">
            {a.texto}
          </p>
        ))}
      </section>

      {/* 2. O que preservamos */}
      <section className="secao" aria-labelledby="r-preserva">
        <h2 id="r-preserva">O que preservamos</h2>
        {r.linhas_vermelhas.length > 0 || r.linhas_vermelhas_outro ? (
          <>
            <ul className="rel-cartoes">
              {r.linhas_vermelhas.map((l) => (
                <li key={l.id}>{l.nome}</li>
              ))}
              {r.linhas_vermelhas_outro && <li>{r.linhas_vermelhas_outro}</li>}
            </ul>
            <p>Nenhuma linha deste relatório toca nesses pontos. A IA trabalha em volta do que é humano, não no lugar dele.</p>
          </>
        ) : (
          <p>Você não marcou nada como intocável. Mesmo assim, nenhuma linha deste relatório mexe em receita, cardápio ou modo de preparo.</p>
        )}
        {r.bloqueadas.length > 0 && <p className="field-hint">Saíram da conta por sua escolha: {r.bloqueadas.map((b) => nomeCurto(b.nome)).join("; ")}.</p>}
      </section>

      {/* 3. De onde vem */}
      <section className="secao" aria-labelledby="r-origem">
        <h2 id="r-origem">De onde vem</h2>
        <div className="rel-painel">
          <div className="rel-bloco rel-bloco-largo">
            <h3>Ganho por linha, por ano</h3>
            <ul className="g-linhas">
              {ativas.map((l) => (
                <li key={l.alavanca}>
                  <span className="g-rotulo">{nomeCurto(l.nome)}</span>
                  <Barra fracao={l.conservador / maiorBase} ate={l.base / maiorBase} classe={classeCerteza(l.certeza)} />
                  <span className="g-valor-texto">{curto(l.conservador)}</span>
                </li>
              ))}
            </ul>
            <LegendaCerteza com />
          </div>
          <div className="rel-bloco">
            <h3>Quão firme é a base</h3>
            <BarraEmpilhada fatias={certezas.map((c) => ({ chave: c.certeza, fracao: c.fracao, classe: classeCerteza(c.certeza) }))} />
            <ul className="g-legenda g-legenda-coluna">
              {certezas.map((c) => (
                <li key={c.certeza}>
                  <span className={`g-chave ${classeCerteza(c.certeza)}`} aria-hidden="true" />
                  {SELO[c.certeza].texto}: {pct(c.fracao * 100)}% ({curto(c.valor)})
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="field-hint">
          O selo diz de onde veio a base de cada conta: {SELO.medido.texto} ({SELO.medido.explica}), {SELO.estimado.texto} ({SELO.estimado.explica}) ou{" "}
          {SELO.hipotese.texto} ({SELO.hipotese.explica}). As taxas de ganho são referências da IRON, medidas no Deep.
        </p>
        <div className="tabela-rolagem">
          <table className="tabela tabela-06">
            <thead>
              <tr>
                <th scope="col">Onde</th>
                <th scope="col">Linha do DRE</th>
                <th scope="col">Conservador</th>
                <th scope="col">Base</th>
                <th scope="col">Certeza</th>
              </tr>
            </thead>
            <tbody>
              {ativas.map((l) => (
                <tr key={l.alavanca}>
                  <td>
                    {l.nome}
                    <span className="field-hint bloco">{l.motivo_certeza}</span>
                  </td>
                  <td>{l.linha_dre}</td>
                  <td className="num">{curto(l.conservador)}</td>
                  <td className="num">{curto(l.base)}</td>
                  <td className="num">
                    <Selo c={l.certeza} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>
                  Total por ano
                </th>
                <td className="num">{curto(r.total.conservador)}</td>
                <td className="num">{curto(r.total.base)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        {foraDaConta.length > 0 && <p className="field-hint">Não entraram: {foraDaConta.map((l) => `${nomeCurto(l.nome)} (${l.fora})`).join("; ")}.</p>}
      </section>

      {/* 4. Pessoas */}
      <section className="secao" aria-labelledby="r-pessoas">
        <h2 id="r-pessoas">Pessoas</h2>
        {r.pessoas.bloqueado_por_quadro ? (
          <p>
            Você marcou o quadro de pessoas como intocável: nenhuma linha conta com deixar de repor vagas. As horas que a IA liberar voltam para tarefas
            de mais valor.
          </p>
        ) : r.pessoas.horas_liberadas > 0 ? (
          <>
            <div className="rel-bloco">
              <BarraEmpilhada
                fatias={[
                  { chave: "horas", fracao: r.pessoas.pct_do_ganho, classe: "g-acento" },
                  { chave: "resto", fracao: 1 - r.pessoas.pct_do_ganho, classe: "g-neutro" },
                ]}
              />
              <ul className="g-legenda">
                <li>
                  <span className="g-chave g-acento" aria-hidden="true" />
                  Horas liberadas: {pct(r.pessoas.pct_do_ganho * 100)}% ({curto(r.pessoas.horas_liberadas)})
                </li>
                <li>
                  <span className="g-chave g-neutro" aria-hidden="true" />
                  Demais linhas: {pct((1 - r.pessoas.pct_do_ganho) * 100)}%
                </li>
              </ul>
            </div>
            <p>{textoPessoas(r)}</p>
          </>
        ) : (
          <p>Nenhuma linha deste relatório depende de deixar de repor vagas.</p>
        )}
      </section>

      {/* 5. Ganho rápido */}
      <section className="secao" aria-labelledby="r-rapido">
        <h2 id="r-rapido">Ganho rápido em 6 semanas</h2>
        <p className="rel-destaque">{r.ganho_rapido.titulo}</p>
        <dl className="rel-meta">
          <div>
            <dt>Meta</dt>
            <dd>{r.ganho_rapido.meta}</dd>
          </div>
          <div>
            <dt>Indicador</dt>
            <dd>{r.ganho_rapido.kpi}</dd>
          </div>
          {r.ganho_rapido.valor_alavanca > 0 && (
            <div>
              <dt>Linha em jogo</dt>
              <dd>{curto(r.ganho_rapido.valor_alavanca)} por ano no conservador</dd>
            </div>
          )}
        </dl>
        <ol className="rel-linha-tempo">
          {FASES_PILOTO.map((f) => (
            <li key={f.titulo}>
              <span className="rel-tempo-quando">{f.semanas}</span>
              <strong>{f.titulo}</strong>
              <span>{f.texto}</span>
            </li>
          ))}
        </ol>
        <p className="field-hint">
          Nasce do problema que você escolheu ({minuscula(r.ganho_rapido.dor)}). O piloto prova o ganho antes de qualquer projeto maior.
        </p>
      </section>

      {/* 6. Prontidão e riscos */}
      <section className="secao" aria-labelledby="r-prontidao">
        <h2 id="r-prontidao">Prontidão e riscos</h2>
        <div className="rel-painel">
          <div className="rel-bloco">
            <h3>
              Nível {r.prontidao.nivel} ({pctScore(r.prontidao.score)}%)
            </h3>
            <Escala niveis={NIVEIS} score={r.prontidao.score} teto={travaAtiva(r) ? r.prontidao.teto : null} />
            <p>
              Com a prontidão de hoje, a empresa captura cerca de {pct(r.prontidao.R * 100)}% do potencial no primeiro ano.
            </p>
            {/* A trava só aparece quando de fato segurou o score. */}
            {travaAtiva(r) && r.prontidao.teto !== null && (
              <p className="field-hint">
                Sem patrocínio com orçamento ou sem dados registrados, projetos de IA costumam parar no piloto; por isso o nível fica limitado a{" "}
                {pct(r.prontidao.teto * 100)}% (linha tracejada).
              </p>
            )}
          </div>
          <div className="rel-bloco">
            <h3>O que pesa na prontidão</h3>
            <ul className="g-linhas g-linhas-compactas">
              {notasProntidao(r).map((n) => (
                <li key={n.id}>
                  <span className="g-rotulo">{n.nome}</span>
                  <Barra fracao={n.fracao} classe="g-tinta" />
                  <span className="g-valor-texto">{pct(n.fracao * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        {r.riscos.length > 0 && (
          <>
            <h3 className="rel-subtitulo">Riscos a tratar</h3>
            <ul className="rel-riscos">
              {r.riscos.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* 7. O que o Deep resolve */}
      <section className="secao" aria-labelledby="r-deep">
        <h2 id="r-deep">O que o Deep resolve</h2>
        {r.deep.itens.length > 0 ? (
          <>
            <p className="rel-destaque">
              {curto(r.deep.valor_em_jogo)} por ano ainda são estimativa ou hipótese. O Deep transforma esse valor em linha de base assinada pelo seu
              financeiro.
            </p>
            <ul className="g-linhas">
              {r.deep.itens.map((i) => (
                <li key={i.nome}>
                  <span className="g-rotulo">{nomeCurto(i.nome)}</span>
                  <Barra fracao={i.valor / maiorDeep} classe={classeCerteza(i.certeza)} />
                  <span className="g-valor-texto">{curto(i.valor)}</span>
                </li>
              ))}
            </ul>
            <div className="tabela-rolagem">
              <table className="tabela tabela-06">
                <thead>
                  <tr>
                    <th scope="col">Linha</th>
                    <th scope="col">Em jogo</th>
                    <th scope="col">O que medimos</th>
                  </tr>
                </thead>
                <tbody>
                  {r.deep.itens.map((i) => (
                    <tr key={i.nome}>
                      <td>
                        {nomeCurto(i.nome)} <Selo c={i.certeza} />
                      </td>
                      <td className="num">{curto(i.valor)}</td>
                      <td>{i.dado}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p>Todas as bases foram informadas por você. O Deep mede as taxas de ganho com os seus dados.</p>
        )}
      </section>

      {/* 8. Próximo passo */}
      <section className="secao nao-imprimir" aria-labelledby="r-proximo">
        <h2 id="r-proximo">Próximo passo</h2>
        <p>Converse com a equipe IRON AI para levar este resultado à sessão executiva e agendar o Deep.</p>
        <div className="acoes">
          <a className="btn btn-inline btn-link" href={CONTATO_URL} target="_blank" rel="noopener noreferrer">
            Agendar conversa sobre o Deep
          </a>
          {/* Link comum: o navegador baixa o arquivo; a rota confere a sessão e o RLS. */}
          <a className="btn btn-inline btn-secondary btn-link" href={`/assessment/${assessmentId}/resultado/pdf`} download>
            Baixar relatório em PDF
          </a>
          <BotaoImprimir />
        </div>
      </section>
    </>
  );
}
