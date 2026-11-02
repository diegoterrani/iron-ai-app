import { connection } from "next/server";

/**
 * Verificação de saúde para monitoramento externo.
 * Não expõe versão, ambiente nem dependências (evita reconhecimento).
 */
export async function GET() {
  await connection();
  return Response.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
