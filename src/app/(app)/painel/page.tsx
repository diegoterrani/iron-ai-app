import type { Metadata } from "next";
import Link from "next/link";
import { ConvitesPendentes } from "@/components/convites-pendentes";
import { exigirContaAtiva } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Painel" };

export default async function PainelPage() {
  const perfil = await exigirContaAtiva();
  return (
    <main>
      <p className="eyebrow">Painel</p>
      <h1 className="title">Olá, {perfil.nome}.</h1>
      <p className="lead">Seus cursos, a comunidade e os assessments vão aparecer aqui.</p>
      <ul className="stats">
        <li>
          <Link href="/assessment">
            <strong>Self assessment</strong>
            Score de sucesso, retorno conservador e mapa de dados em 12 minutos.
          </Link>
        </li>
      </ul>
      <ConvitesPendentes />
    </main>
  );
}
