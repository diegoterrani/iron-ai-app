import { progresso06, type Rascunho06 } from "@/lib/assessment/v06/questionario";
import { aprofundamentoParaProgresso, eFormato06, montarQuestionario06 } from "@/lib/assessment/v06/self";
import type { EmpresaSelf } from "@/lib/assessment/questionario";

/**
 * Passos feitos de um rascunho do Self 0.6, para os cartões da lista e do
 * painel. Rascunhos antigos (0.5) não têm passos: devolve null.
 * Só lê o rascunho (nada de cálculo de resultado).
 */
export function passosDoRascunho(respostas: unknown, empresa: EmpresaSelf | null): { feitos: number; total: number } | null {
  if (!eFormato06(respostas)) return null;
  const r = (respostas ?? {}) as Rascunho06;
  const p = progresso06(montarQuestionario06(), r, empresa ?? {}, aprofundamentoParaProgresso(r));
  return { feitos: p.feitos, total: p.total };
}
