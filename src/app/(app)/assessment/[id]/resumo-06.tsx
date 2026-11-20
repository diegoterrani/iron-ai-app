import { textoFaixa, type Empresa06, type Questionario06, type Rascunho06 } from "@/lib/assessment/v06/questionario";
import { formatarCnpj } from "@/lib/validation/cnpj";

/** Resumo legível do rascunho 0.6 para o cliente conferir. Mostra o que foi registrado, sem números do resultado. */
export function Resumo06({ q, r, e }: { q: Questionario06; r: Rascunho06; e: Empresa06 }) {
  const nomeLv = (id: string) => q.linhasVermelhas.find((l) => l.id === id)?.nome ?? id;
  const nomeSeg = (id: string) => q.segmentos.find((s) => s.id === id)?.nome ?? id;
  const faturamento =
    r.receita_valor !== undefined ? `R$ ${new Intl.NumberFormat("pt-BR").format(r.receita_valor)}` : r.receita_faixa ? `faixa ${r.receita_faixa}` : "—";
  const respondidas = q.perguntas.filter((p) => r.nucleo?.[p.id] !== undefined);
  return (
    <dl className="resumo-lista">
      <dt>Empresa</dt>
      <dd>
        {e.nome ?? "—"}, {e.cidade ?? "—"}/{e.uf ?? "—"}. CNPJ {e.cnpj ? formatarCnpj(e.cnpj) : "—"}
      </dd>
      <dt>Contato principal</dt>
      <dd>
        {e.contato_nome ?? "—"} ({e.contato_cargo ?? "—"}), {e.contato_email ?? "—"}
      </dd>
      <dt>O que a IA nunca pode tocar</dt>
      <dd>
        {(r.linhas_vermelhas ?? []).map(nomeLv).join("; ") || "—"}
        {r.linhas_vermelhas_outro ? `; ${r.linhas_vermelhas_outro}` : ""}
      </dd>
      <dt>Porte</dt>
      <dd>
        Faturamento {faturamento}; {r.pessoas ?? "—"} pessoas
      </dd>
      <dt>Divisão da receita</dt>
      <dd>
        {Object.entries(r.divisao ?? {})
          .map(([id, v]) => `${nomeSeg(id)}: ${v}%`)
          .join("; ") || "—"}
      </dd>
      <dt>Retrato econômico</dt>
      <dd>
        <span className="resumo-item">Folha com encargos: {textoFaixa(r.folha, r.folha_exata)} da receita</span>
        <span className="resumo-item">
          {q.custoPrincipal.nome.charAt(0).toUpperCase() + q.custoPrincipal.nome.slice(1)}: {textoFaixa(r.custo, r.custo_exato)} da receita
        </span>
        <span className="resumo-item">Contratações por ano: {r.contratacoes ?? "—"}</span>
        <span className="resumo-item">Margem: {textoFaixa(r.margem, r.margem_exata)}</span>
      </dd>
      <dt>Problema para resolver em 6 semanas</dt>
      <dd>{q.dores.find((d) => d.id === r.dor)?.nome ?? "—"}</dd>
      {respondidas.length > 0 && (
        <>
          <dt>Aprofundamento</dt>
          <dd>
            {respondidas.map((p) => (
              <span key={p.id} className="resumo-item">
                {p.texto} {r.nucleo?.[p.id]}
              </span>
            ))}
          </dd>
        </>
      )}
      <dt>Prontidão</dt>
      <dd>
        <span className="resumo-item">Uso de IA: {r.uso_ia ?? "—"}</span>
        <span className="resumo-item">Regra escrita sobre IA e dados: {r.politica ?? "—"}</span>
        <span className="resumo-item">Patrocínio: {r.patrocinio ?? "—"}</span>
      </dd>
    </dl>
  );
}
