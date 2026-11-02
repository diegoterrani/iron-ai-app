import type { Metadata } from "next";
import { connection } from "next/server";
import { manrope, plexMono, sourceSerif } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "IRON AI · Área do cliente", template: "%s · IRON AI" },
  description: "Área logada da IRON AI: cursos, comunidade e assessments.",
  robots: { index: false, follow: false },
};

/**
 * `connection()` na raiz deixa TODA página dinâmica: cada resposta recebe o
 * nonce da CSP. Página estática (inclusive o 404) sairia sem nonce e teria
 * os scripts bloqueados. Ver docs/seguranca.md.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <html
      lang="pt-BR"
      className={`${manrope.variable} ${sourceSerif.variable} ${plexMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
