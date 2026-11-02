#!/usr/bin/env python3
"""Gera os casos de teste que comparam o motor TypeScript com o motor Python (referência).

Sorteia respostas com semente fixa, roda motor.py em cada uma e grava
tests/fixtures/assessment/casos.json. O teste do TypeScript precisa chegar
ao mesmo resultado (ou ao mesmo erro de resposta inválida) em todos.

Uso (na raiz do repositório):
    python3 referencia/assessment/gerar_casos.py
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))
import motor  # noqa: E402

SEMENTE = 20261102
N_CASOS = 200
DADOS = RAIZ / "src/lib/assessment/dados"
SAIDA = RAIZ / "tests/fixtures/assessment/casos.json"


def sortear(rng: random.Random, pacote: dict, modelo: dict) -> dict:
    s = modelo["self"]
    escolha = lambda tabela: rng.choice(list(tabela))  # noqa: E731
    areas = modelo["areas_operacionais"] + ["11_ti_seguranca"]
    r: dict = {"setor": pacote["pacote"], "q3": escolha(s["faixas_pessoas_total"]), "q4": "prefiro não dizer"}
    if rng.random() < 0.8:
        r["q2_valor"] = rng.choice([rng.randint(500_000, 600_000_000), round(rng.uniform(1e6, 3e8), 2)])
    else:
        r["q2"] = escolha(s["faixas_receita"])
    r["setoriais"] = {
        "unidades": rng.randint(1, 80),
        "lugares_total": rng.randint(20, 12_000),
        "ticket_pessoa": escolha(s["faixas_ticket"]),
        "fila_pico": rng.choice(["quase nunca", "só em datas especiais", "toda semana", "quase todo dia"]),
    }
    r["grade_q5"] = {a: escolha(s["nota_q5"]) for a in areas}
    escolhidas = rng.sample(areas, rng.randint(1, s["areas_no_calculo"]))
    r["pessoas_q6"] = {a: escolha(s["faixas_pessoas_area"]) for a in escolhidas}
    r["q7"] = "Tarefa repetitiva descrita pelo cliente."
    r["q8"] = escolha(s["nota_q8"])
    r["dados_D"] = {f: escolha(s["cobertura_fonte"]) for f in pacote["pergunta_dados_D"]["itens"] if rng.random() < 0.9}
    for q in ("q9", "q10", "q11"):
        r[q] = escolha(s[f"nota_{q}"])
    r["q12"] = rng.choice(["reduzir custo", "crescer sem contratar", "melhorar qualidade/atendimento", "ainda explorando"])
    # Alguns casos inválidos de propósito: o TypeScript precisa recusar igual.
    sorteio = rng.random()
    if sorteio < 0.03:
        r["q8"] = "fax"
    elif sorteio < 0.05:
        del r["grade_q5"]["06_operacoes"]
    return r


def main() -> int:
    pacote = json.loads((DADOS / "food_service.json").read_text(encoding="utf-8"))
    modelo = json.loads((DADOS / "modelo_comum.json").read_text(encoding="utf-8"))
    rng = random.Random(SEMENTE)
    casos = []
    for i in range(N_CASOS):
        r = sortear(rng, pacote, modelo)
        try:
            casos.append({"id": i, "respostas": r, "resultado": motor.calcular_self(r, pacote, modelo)})
        except motor.RespostaInvalida as exc:
            casos.append({"id": i, "respostas": r, "erro": str(exc)})
    SAIDA.write_text(json.dumps({"semente": SEMENTE, "motor": motor.MOTOR_VERSAO, "casos": casos},
                                ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    invalidos = sum(1 for c in casos if "erro" in c)
    print(f"{len(casos)} casos gravados em {SAIDA.relative_to(RAIZ)} ({invalidos} inválidos)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
