import type { Certeza, Resultado06 } from "@/lib/assessment/v06/tipos";
import { BotaoImprimir } from "./imprimir";

/**
 * Relatório do Self 0.6, na ordem fixa da skill do Self: o número, o que
 * preservamos, de onde vem, pessoas, ganho rápido, prontidão e riscos, o que
 * o Deep resolve e o próximo passo. Os números vêm prontos do motor; aqui só
 * se formata. Sem preço: a proposta comercial é feita pela equipe.
 */

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const vezes = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Valores grandes arredondados para leitura executiva (R$ 2,1 mi; R$ 290 mil). */
function curto(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `R$ ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(v / 1_000_000)} mi`;
  if (Math.abs(v) >= 1_000) return `R$ ${pct.format(Math.round(v / 1_000))} mil`;
  return brl.format(v);
}

/** Score sem arredondar para cima: o nível usa o valor exato. */
const pctScore = (v: number) => pct.format(Math.floor(v * 100 + 1e-9));

const SELO: Record<Certeza, { texto: string; classe: string; explica: string }> = {
  medido: { texto: "medido", classe: "selo selo-medido", explica: "a base da conta é um número que você informou" },
  estimado: { texto: "estimado", classe: "selo selo-estimado", explica: "a base veio de uma faixa ou de uma divisão aproximada" },
  hipotese: { texto: "hipótese", classe: "selo selo-hipotese", explica: "a base usa a referência do setor ou ainda não foi medida" },
};

const VEREDITO: Record<Resultado06["regua"]["veredito"], { titulo: string; texto: string }> = {
  seguir: {
    titulo: "Vale seguir para o Deep",
    texto: "Mesmo no cenário conservador, o ganho estimado paga com folga um projeto típico do seu porte. O Deep confirma os números com os seus dados antes de qualquer projeto.",
  },
  deep_para_confirmar: {
    titulo: "Vale o Deep para confirmar antes de decidir",
    texto: "No cenário conservador, o ganho estimado não chega a 3 vezes o que um projeto típico do seu porte custa. O Deep mede as hipóteses abaixo; o projeto só faz sentido se elas se confirmarem, ou se começar pelo ganho rápido.",
  },
  comecar_pequeno: {
    titulo: "Hoje não recomendamos um projeto completo",
    texto: "No cenário conservador, o ganho estimado não paga um projeto completo. A recomendação honesta é começar só pelo ganho rápido abaixo e voltar a avaliar com o resultado medido.",
  },
};

function Selo({ c }: { c: Certeza }) {
  return <span className={SELO[c].classe}>{SELO[c].texto}</span>;
}

export function Relatorio06({ r }: { r: Resultado06 }) {
  const ativas = r.linhas.filter((l) => !l.fora && l.conservador > 0).sort((a, b) => b.conservador - a.conservador);
  const foraDaConta = r.linhas.filter((l) => l.fora && !l.fora.startsWith("fora da conta"));
  const v = VEREDITO[r.regua.veredito];
  const lucroPct = r.pct_lucro.conservador;

  return (
    <>
      {/* 1. O número */}
      <div className="resultado-numeros">
        <div>
          <p className="field-hint">Ganho anual conservador, depois da implantação</p>
          <p className="resultado-numero">{curto(r.total.conservador)}</p>
          <p>{lucroPct !== null ? `Cerca de ${pct.format(lucroPct)}% do lucro líquido de hoje` : "Margem não positiva: o ganho aparece em R$."}</p>
          <p className="field-hint">
            Cenário base: {curto(r.total.base)} por ano. No primeiro ano, com a prontidão de hoje: {curto(r.ano1.conservador)}.
          </p>
        </div>
        <div>
          <p className="field-hint">Cada mês sem agir</p>
          <p className="resultado-numero">{curto(r.por_mes)}</p>
          <p>É o valor conservador que fica na mesa a cada mês.</p>
        </div>
      </div>
      <p className="notice" role="note">
        <strong>{v.titulo}.</strong> {v.texto}
      </p>
      <p className="field-hint">
        Régua usada: retorno de {vezes.format(r.regua.retorno_x)} vezes em 24 meses no conservador, já descontado o custo de mudança das equipes. O
        investimento é uma referência da IRON para empresas do seu porte, não uma proposta; a proposta sai do Deep.
      </p>
      {r.alertas.map((a) => (
        <p key={a.codigo} className="notice" role="note">
          {a.texto}
        </p>
      ))}

      {/* 2. O que preservamos */}
      <section className="secao" aria-labelledby="r-preserva">
        <h2 id="r-preserva">O que preservamos</h2>
        {r.linhas_vermelhas.length > 0 || r.linhas_vermelhas_outro ? (
          <>
            <ul>
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
        {r.bloqueadas.length > 0 && (
          <p className="field-hint">
            Saíram da conta por sua escolha: {r.bloqueadas.map((b) => b.nome.split(":")[0]).join("; ")}.
          </p>
        )}
      </section>

      {/* 3. De onde vem */}
      <section className="secao" aria-labelledby="r-origem">
        <h2 id="r-origem">De onde vem</h2>
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
        {foraDaConta.length > 0 && (
          <p className="field-hint">Não entraram: {foraDaConta.map((l) => `${l.nome.split(":")[0]} (${l.fora})`).join("; ")}.</p>
        )}
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
          <p>
            {pct.format(r.pessoas.pct_do_ganho * 100)}% do ganho ({curto(r.pessoas.horas_liberadas)} por ano) vem de horas liberadas na retaguarda e no
            atendimento remoto. Isso não é corte: com contratações na faixa de {r.pessoas.contratacoes} por ano, o ganho vem de não repor parte das vagas
            que já abrem e de levar pessoas para tarefas de mais valor. Se a empresa preferir repor todas, esse valor sai da conta.
          </p>
        ) : (
          <p>Nenhuma linha deste relatório depende de deixar de repor vagas.</p>
        )}
      </section>

      {/* 5. Ganho rápido */}
      <section className="secao" aria-labelledby="r-rapido">
        <h2 id="r-rapido">Ganho rápido em 6 semanas</h2>
        <p>
          <strong>{r.ganho_rapido.titulo}.</strong> Meta: {r.ganho_rapido.meta.charAt(0).toLowerCase() + r.ganho_rapido.meta.slice(1)}. Indicador:{" "}
          {r.ganho_rapido.kpi.toLowerCase()}.
        </p>
        <p className="field-hint">
          Nasce do problema que você escolheu ({r.ganho_rapido.dor.toLowerCase()})
          {r.ganho_rapido.valor_alavanca > 0 ? `, numa linha que vale ${curto(r.ganho_rapido.valor_alavanca)} por ano no conservador` : ""}. O piloto
          prova o ganho em uma unidade antes de qualquer projeto maior.
        </p>
      </section>

      {/* 6. Prontidão e riscos */}
      <section className="secao" aria-labelledby="r-prontidao">
        <h2 id="r-prontidao">Prontidão e riscos</h2>
        <p>
          Nível <strong>{r.prontidao.nivel}</strong> ({pctScore(r.prontidao.score)}%). Com a prontidão de hoje, a empresa captura cerca de{" "}
          {pct.format(r.prontidao.R * 100)}% do potencial no primeiro ano.
        </p>
        {/* A trava só aparece quando de fato segurou o score. */}
        {r.prontidao.teto !== null && r.prontidao.score >= r.prontidao.teto - 1e-9 && (
          <p className="field-hint">
            Sem patrocínio com orçamento ou sem dados registrados, projetos de IA costumam parar no piloto; por isso o nível fica limitado a{" "}
            {pct.format(r.prontidao.teto * 100)}%.
          </p>
        )}
        <ul>
          {r.riscos.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>

      {/* 7. O que o Deep resolve */}
      <section className="secao" aria-labelledby="r-deep">
        <h2 id="r-deep">O que o Deep resolve</h2>
        {r.deep.itens.length > 0 ? (
          <>
            <p>
              {curto(r.deep.valor_em_jogo)} por ano deste relatório ainda são estimativa ou hipótese. O Deep transforma esse valor em linha de base
              assinada pelo seu financeiro, com os dados abaixo:
            </p>
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
                        {i.nome.split(":")[0]} <Selo c={i.certeza} />
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
        <BotaoImprimir />
      </section>
    </>
  );
}
