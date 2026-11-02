import { aceitarConvite, recusarConvite } from "@/app/convite-actions";
import { AcaoForm } from "@/components/acao-form";
import { createClient } from "@/lib/supabase/server";

interface Convite {
  id: string;
  empresa: string;
  expira_em: string;
}

const data = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });

/** Convites de empresa para o e-mail confirmado de quem está logado. */
export async function ConvitesPendentes() {
  const supabase = await createClient();
  const { data: linhas, error } = await supabase.rpc("meus_convites");
  const convites = (error ? [] : (linhas ?? [])) as Convite[];
  if (convites.length === 0) return null;

  return (
    <section className="convites" aria-labelledby="convites-titulo">
      <h2 id="convites-titulo">{convites.length === 1 ? "Você tem um convite" : "Você tem convites"}</h2>
      <ul className="lista">
        {convites.map((c) => (
          <li key={c.id}>
            <span>
              <strong>{c.empresa}</strong> convidou você para a área da empresa (vale até{" "}
              {data.format(new Date(c.expira_em))}).
            </span>
            <span className="acoes">
              <AcaoForm action={aceitarConvite} campos={{ conviteId: c.id }} rotulo="Aceitar" rotuloEnviando="Aceitando…" />
              <AcaoForm
                action={recusarConvite}
                campos={{ conviteId: c.id }}
                rotulo="Recusar"
                rotuloEnviando="Recusando…"
                variante="secundario"
              />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
