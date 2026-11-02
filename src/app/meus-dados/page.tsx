import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AcaoForm } from "@/components/acao-form";
import { exigirLogin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { cancelarExclusao, solicitarExclusao } from "./actions";

export const metadata: Metadata = { title: "Meus dados" };

/** Direitos do titular (LGPD). Vale também para conta pendente ou suspensa. */
export default async function MeusDadosPage() {
  await connection();
  const perfil = await exigirLogin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("solicitacoes_lgpd")
    .select("id, criado_em")
    .eq("status", "pendente")
    .eq("tipo", "exclusao")
    .maybeSingle();
  const pedido = data as { id: string; criado_em: string } | null;
  const voltar = perfil?.status === "ativo" ? "/painel" : "/aguardando-aprovacao";

  return (
    <main className="auth-shell">
      <section className="auth-card auth-card-largo">
        <p className="eyebrow">LGPD</p>
        <h1 className="auth-title">Meus dados</h1>

        <h2 className="subtitulo">Baixar uma cópia</h2>
        <p className="auth-lead">
          Arquivo JSON com sua conta, perfil, aceites, papéis, empresas, convites e pedidos feitos.
        </p>
        {/* Link simples: o download é um GET para a própria sessão. */}
        <a className="btn btn-inline btn-secondary btn-link" href="/meus-dados/exportar" download>
          Baixar meus dados
        </a>

        <h2 className="subtitulo">Excluir minha conta</h2>
        {pedido ? (
          <>
            <p className="notice" role="status">
              Pedido de exclusão registrado em {new Date(pedido.criado_em).toLocaleDateString("pt-BR")}. A equipe conclui em
              até 15 dias.
            </p>
            <AcaoForm action={cancelarExclusao} rotulo="Desistir do pedido" rotuloEnviando="Cancelando…" variante="secundario" />
          </>
        ) : (
          <>
            <p className="auth-lead">
              Apagamos sua conta, perfil, papéis e vínculos com empresas. O registro de auditoria (quem mudou o quê e quando)
              é mantido por obrigação legal e de segurança.
            </p>
            <AcaoForm action={solicitarExclusao} rotulo="Pedir exclusão da conta" rotuloEnviando="Enviando…" variante="perigo" />
          </>
        )}

        <p className="auth-links">
          <Link href={voltar}>Voltar</Link>
        </p>
      </section>
    </main>
  );
}
