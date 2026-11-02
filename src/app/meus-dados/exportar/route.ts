import { NextResponse } from "next/server";
import { log, newTraceId } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

/**
 * LGPD art. 18, II: acesso aos dados. Devolve um JSON com tudo o que
 * guardamos sobre quem está logado (a função do banco só lê auth.uid()).
 * GET sem efeito colateral; outro site não consegue ler a resposta (sem CORS).
 */
export async function GET() {
  const trace = newTraceId();
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return NextResponse.json({ erro: "faça login" }, { status: 401 });

    const { data, error } = await supabase.rpc("meus_dados");
    if (error || !data) throw error ?? new Error("vazio");

    log("info", "lgpd.exportacao", { trace, ator: auth.user.id });
    const hoje = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="iron-ai-meus-dados-${hoje}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    log("error", "lgpd.exportacao_erro", { trace, reason: (err as Error)?.name ?? "desconhecido" });
    return NextResponse.json({ erro: `não foi possível gerar agora (código ${trace})` }, { status: 500 });
  }
}
