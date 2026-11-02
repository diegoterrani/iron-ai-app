import type { Metadata } from "next";
import Link from "next/link";
import { AcaoForm } from "@/components/acao-form";
import { exigirSuperAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { concluirExclusao } from "../actions";
import { formatarDataHora } from "../formato";

export const metadata: Metadata = { title: "LGPD" };

interface Pedido {
  id: string;
  user_id: string;
  nome: string | null;
  email: string | null;
  tipo: string;
  status: "pendente" | "concluida" | "cancelada";
  criado_em: string;
  concluido_em: string | null;
}

const STATUS: Record<Pedido["status"], string> = { pendente: "Pendente", concluida: "Concluída", cancelada: "Cancelada" };
const PRAZO_DIAS = 15;

function diasDesde(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export default async function LgpdPage() {
  await exigirSuperAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_listar_solicitacoes_lgpd");
  const pedidos = (data ?? []) as Pedido[];

  return (
    <main>
      <p className="eyebrow">Backoffice</p>
      <h1 className="title">Pedidos LGPD</h1>
      <p className="lead">
        Pedidos de exclusão feitos pelos próprios titulares. Prazo de resposta: {PRAZO_DIAS} dias. A exclusão apaga conta,
        perfil, papéis e vínculos; a auditoria é mantida.
      </p>

      {error ? (
        <p className="notice notice-error" role="alert">
          Não foi possível carregar os pedidos agora.
        </p>
      ) : pedidos.length === 0 ? (
        <p className="notice">Nenhum pedido.</p>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">Titular</th>
                <th scope="col">Pedido em</th>
                <th scope="col">Status</th>
                <th scope="col">Ação</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.nome ? <Link href={`/admin/usuarios/${p.user_id}`}>{p.nome}</Link> : "Conta excluída"}
                    {p.email && <div className="field-hint">{p.email}</div>}
                  </td>
                  <td>
                    {formatarDataHora(p.criado_em)}
                    {p.status === "pendente" && (
                      <div className={diasDesde(p.criado_em) >= PRAZO_DIAS - 3 ? "field-error" : "field-hint"}>
                        há {diasDesde(p.criado_em)} dias
                      </div>
                    )}
                  </td>
                  <td>
                    {STATUS[p.status]}
                    {p.concluido_em && <div className="field-hint">{formatarDataHora(p.concluido_em)}</div>}
                  </td>
                  <td>
                    {p.status === "pendente" ? (
                      <AcaoForm
                        action={concluirExclusao}
                        campos={{ solicitacaoId: p.id }}
                        rotulo="Excluir conta"
                        rotuloEnviando="Excluindo…"
                        variante="perigo"
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
