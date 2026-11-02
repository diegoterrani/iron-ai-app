import Link from "next/link";
import { exigirSuperAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";

interface Contadores {
  pendentes: number;
  ativos: number;
  suspensos: number;
  empresas: number;
}

export default async function AdminPage() {
  await exigirSuperAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_contadores").maybeSingle<Contadores>();

  return (
    <main>
      <p className="eyebrow">Backoffice</p>
      <h1 className="title">Visão geral</h1>
      {error || !data ? (
        <p className="notice notice-error" role="alert">
          Não foi possível carregar os números agora.
        </p>
      ) : (
        <ul className="stats">
          <li>
            <Link href="/admin/usuarios?status=pendente">
              <strong>{data.pendentes}</strong> aguardando aprovação
            </Link>
          </li>
          <li>
            <Link href="/admin/usuarios?status=ativo">
              <strong>{data.ativos}</strong> ativos
            </Link>
          </li>
          <li>
            <Link href="/admin/usuarios?status=suspenso">
              <strong>{data.suspensos}</strong> suspensos
            </Link>
          </li>
          <li>
            <Link href="/admin/empresas">
              <strong>{data.empresas}</strong> empresas
            </Link>
          </li>
        </ul>
      )}
    </main>
  );
}
