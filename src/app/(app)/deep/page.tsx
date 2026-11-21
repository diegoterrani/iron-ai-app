import type { Metadata } from "next";
import Link from "next/link";
import { AcaoForm } from "@/components/acao-form";
import { createClient } from "@/lib/supabase/server";
import { abrirDeep } from "./actions";

export const metadata: Metadata = { title: "Deep assessment" };

interface LinhaDeep {
  id: string;
  org_id: string;
  status: "em_andamento" | "concluido" | "cancelado";
  pacote_versao: string;
  criado_em: string;
  turnos: number;
}

const data = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });
const ROTULO_STATUS: Record<LinhaDeep["status"], string> = { em_andamento: "em andamento", concluido: "concluído", cancelado: "cancelado" };
const SELO_STATUS: Record<LinhaDeep["status"], string> = { em_andamento: "selo selo-pendente", concluido: "selo selo-ativo", cancelado: "selo" };

type Empresa = { id: string; nome: string };

/**
 * Empresas em que a pessoa pode conduzir o Deep, numa chamada só
 * (deep_empresas_que_conduzo, migração 20261121200000). Se a função ainda
 * não existir no banco (SQL não aplicado), cai na conferência empresa a
 * empresa, que dá o mesmo resultado mais devagar.
 */
async function empresasQueConduzo(supabase: Awaited<ReturnType<typeof createClient>>, orgs: Empresa[]): Promise<Empresa[]> {
  const { data, error } = await supabase.rpc("deep_empresas_que_conduzo");
  if (!error) return (data ?? []) as Empresa[];
  const permitidas = await Promise.all(
    orgs.map(async (o) => {
      const { data: pode } = await supabase.rpc("tem_permissao", { p_permissao: "deep.conduzir", p_org: o.id });
      return pode === true ? o : null;
    }),
  );
  return permitidas.filter((o): o is Empresa => o !== null);
}

/**
 * Lista os Deeps que o analista conduz (o RLS só devolve as empresas com
 * deep.conduzir) e abre um novo para uma empresa atribuída a ele.
 */
export default async function DeepPage() {
  const supabase = await createClient();
  const [deepsRes, orgsRes] = await Promise.all([
    supabase
      .from("deep_assessments")
      .select("id, org_id, status, pacote_versao, criado_em, turnos")
      .order("criado_em", { ascending: false })
      .limit(100),
    supabase.from("organizations").select("id, nome").order("nome").limit(200),
  ]);
  const deeps = (deepsRes.data ?? []) as LinhaDeep[];
  const orgs = (orgsRes.data ?? []) as { id: string; nome: string }[];
  const nomeOrg = new Map(orgs.map((o) => [o.id, o.nome]));

  // Só as empresas em que o analista pode conduzir (a mesma regra do banco).
  const permitidas = await empresasQueConduzo(supabase, orgs);
  const andamento = new Set(deeps.filter((d) => d.status === "em_andamento").map((d) => d.org_id));
  const paraAbrir = permitidas.filter((o) => !andamento.has(o.id));

  return (
    <main>
      <p className="eyebrow">Modo analista</p>
      <h1 className="title">Deep assessment</h1>
      <p className="lead">
        Reuniões com a empresa conduzidas pelo agente: você lê a pergunta, digita o que foi respondido e o agente grava as
        respostas estruturadas. Cada reunião fica guardada com a transcrição.
      </p>

      <section className="secao" aria-labelledby="sec-deeps">
        <h2 id="sec-deeps">Deeps</h2>
        {deeps.length === 0 ? (
          <p className="field-hint">Nenhum Deep aberto nas empresas atribuídas a você.</p>
        ) : (
          <ul className="lista">
            {deeps.map((d) => (
              <li key={d.id}>
                <span>
                  <Link href={`/deep/${d.id}`}>{nomeOrg.get(d.org_id) ?? "Empresa"}</Link>{" "}
                  <span className={SELO_STATUS[d.status]}>{ROTULO_STATUS[d.status]}</span>
                </span>
                <span className="field-hint">
                  aberto em {data.format(new Date(d.criado_em))} · roteiro {d.pacote_versao} · {d.turnos} turnos
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="secao" aria-labelledby="sec-abrir">
        <h2 id="sec-abrir">Abrir Deep</h2>
        {paraAbrir.length === 0 ? (
          <p className="field-hint">
            Nenhuma empresa disponível: todas já têm Deep em andamento ou nenhuma está atribuída a você. A atribuição é feita
            no backoffice.
          </p>
        ) : (
          <AcaoForm action={abrirDeep} rotulo="Abrir Deep" rotuloEnviando="Abrindo…">
            <div className="field">
              <label htmlFor="orgId">Empresa</label>
              <select id="orgId" name="orgId" required defaultValue="">
                <option value="" disabled>
                  Escolha
                </option>
                {paraAbrir.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nome}
                  </option>
                ))}
              </select>
            </div>
          </AcaoForm>
        )}
        <p className="field-hint">
          Se a empresa já concluiu o Self assessment, o Deep fica ligado a ele e o relatório final parte desse resultado.
        </p>
      </section>
    </main>
  );
}
