import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SairButton } from "@/components/sair-button";
import { getSessao } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/security/redirect";
import { VerificarMfaForm } from "./form";

export const metadata: Metadata = { title: "Verificação em duas etapas" };

export default async function VerificarMfaPage({ searchParams }: PageProps<"/verificar-mfa">) {
  const sessao = await getSessao();
  if (!sessao) redirect("/entrar");
  const next = safeNextPath((await searchParams).next);
  if (!sessao.precisaMfa) redirect(next);

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1 className="auth-title">Verificação em duas etapas</h1>
        <p className="auth-lead">Digite o código de 6 números do seu app autenticador.</p>
        <VerificarMfaForm next={next} />
        <div className="auth-links">
          <SairButton />
        </div>
      </section>
    </main>
  );
}
