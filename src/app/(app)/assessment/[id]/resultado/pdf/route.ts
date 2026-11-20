import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { exigirContaAtiva } from "@/lib/auth/session";
import type { EmpresaSelf } from "@/lib/assessment/questionario";
import { RelatorioPdf06 } from "@/lib/assessment/v06/pdf/relatorio-pdf";
import type { Resultado06 } from "@/lib/assessment/v06/tipos";
import { log, newTraceId } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { idValido } from "@/lib/validation/admin";

// O react-pdf e as fontes rodam no Node (lê os TTF do disco), nunca no edge.
export const runtime = "nodejs";

/** Nome de arquivo só com [a-z0-9-]: nada do cliente vira cabeçalho sem limpeza. */
function nomeArquivo(empresa: string | undefined, quando: string): string {
  const base = (empresa ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `iron-ai-self-assessment${base ? `-${base}` : ""}-${quando.slice(0, 10)}.pdf`;
}

/**
 * PDF do relatório do Self 0.6. Mesma regra de acesso da tela de resultado:
 * conta ativa (com MFA quando exigido) e leitura pelo RLS (dono, quem tem
 * assessment.ver na empresa ou super-admin). Quem não pode ver recebe 404,
 * sem dizer se o assessment existe. GET sem efeito colateral; sem cache.
 */
export async function GET(_req: Request, ctx: RouteContext<"/assessment/[id]/resultado/pdf">) {
  // Fora do try: o redirect de sessão precisa chegar ao Next.
  const perfil = await exigirContaAtiva();
  const { id } = await ctx.params;
  if (!idValido(id)) return NextResponse.json({ erro: "não encontrado" }, { status: 404 });

  const trace = newTraceId();
  try {
    const supabase = await createClient();
    const { data: linha } = await supabase
      .from("assessments")
      .select("id, status, empresa")
      .eq("id", id)
      .maybeSingle<{ id: string; status: string; empresa: EmpresaSelf | null }>();
    if (!linha || linha.status !== "concluido") return NextResponse.json({ erro: "não encontrado" }, { status: 404 });

    const { data: res } = await supabase
      .from("assessment_resultados")
      .select("resultado, criado_em")
      .eq("assessment_id", id)
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle<{ resultado: Resultado06 | { formato?: string }; criado_em: string }>();
    // Só o formato 0.6 tem PDF; resultados antigos seguem com "Imprimir".
    if (!res || res.resultado.formato !== "0.6") return NextResponse.json({ erro: "não encontrado" }, { status: 404 });

    const emp = linha.empresa ?? {};
    // Chamado como função (sem hooks): o renderToBuffer exige o <Document> na raiz.
    const pdf = await renderToBuffer(
      RelatorioPdf06({
        r: res.resultado as Resultado06,
        cab: { empresa: emp.nome, local: emp.cidade && emp.uf ? `${emp.cidade}/${emp.uf}` : undefined, calculadoEm: res.criado_em },
      }),
    );

    log("info", "self.pdf.gerado", { trace, ator: perfil.id, bytes: pdf.length });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nomeArquivo(emp.nome, res.criado_em)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    log("error", "self.pdf.erro", { trace, ator: perfil.id, reason: (err as Error)?.name ?? "desconhecido" });
    return NextResponse.json({ erro: `não foi possível gerar o PDF agora (código ${trace})` }, { status: 500 });
  }
}
