import type { Metadata } from "next";
import { connection } from "next/server";
import { exigirLogin } from "@/lib/auth/session";
import { RedefinirForm } from "./form";

export const metadata: Metadata = { title: "Nova senha" };

/** Aberta pelo link de recuperação, que já cria a sessão. */
export default async function RedefinirPage() {
  await connection();
  await exigirLogin();
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1 className="auth-title">Nova senha</h1>
        <RedefinirForm />
      </section>
    </main>
  );
}
