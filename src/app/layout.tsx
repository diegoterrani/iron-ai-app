import type { Metadata } from "next";
import { manrope, plexMono, sourceSerif } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "IRON AI · Área do cliente", template: "%s · IRON AI" },
  description: "Área logada da IRON AI: cursos, comunidade e assessments.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${manrope.variable} ${sourceSerif.variable} ${plexMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
