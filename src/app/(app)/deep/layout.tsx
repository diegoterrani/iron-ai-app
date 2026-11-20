import type { Metadata } from "next";
import { exigirAnalistaDeep } from "@/lib/auth/deep";

export const metadata: Metadata = { title: { template: "%s · Deep assessment", default: "Deep assessment" } };

/**
 * Deep assessment em modo analista: só Super-admin e Equipe IRON (os demais
 * recebem 404). O banco confere deep.conduzir na empresa e o MFA de novo em
 * cada leitura (RLS) e operação (funções deep_*).
 */
export default async function DeepLayout({ children }: LayoutProps<"/deep">) {
  await exigirAnalistaDeep();
  return <div className="deep">{children}</div>;
}
