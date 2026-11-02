import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { cspNonce } from "@/lib/auth/request";
import { safeNextPath } from "@/lib/security/redirect";
import { ProviderButtons } from "../provider-buttons";
import { EntrarForm } from "./form";

export const metadata: Metadata = { title: "Entrar" };

const ERROS: Record<string, string> = {
  oauth: "Não foi possível entrar com esse provedor. Tente de novo.",
  link: "Esse link expirou ou já foi usado. Peça um novo.",
  provedor: "Provedor de login não suportado.",
};

export default async function EntrarPage({ searchParams }: PageProps<"/entrar">) {
  await connection();
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const erro = typeof params.erro === "string" ? ERROS[params.erro] : undefined;

  return (
    <>
      <p className="eyebrow">Área do cliente</p>
      <h1 className="auth-title">Entrar</h1>
      {erro && (
        <p className="notice notice-error" role="alert">
          {erro}
        </p>
      )}
      <ProviderButtons next={next} />
      <p className="divider">ou com e-mail</p>
      <EntrarForm
        next={next}
        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
        nonce={await cspNonce()}
      />
      <p className="auth-links">
        <Link href="/recuperar-senha">Esqueci a senha</Link>
        <span aria-hidden="true"> · </span>
        <Link href="/cadastro">Criar conta</Link>
      </p>
    </>
  );
}
