#!/usr/bin/env python3
"""Motor de cálculo do Self assessment da IRON AI (versão 0.1).

É o único lugar onde números são produzidos. O chatbot conduz a conversa e
entrega as respostas; o motor devolve score, fator R, retorno e mapa de dados,
sempre igual para as mesmas respostas (determinístico e versionado).

Uso:
    python3 motor.py respostas.json --pacote food_service.json \
        --modelo modelo_comum.json [--saida resultado.json]

Modelo (doc de frameworks v0.4):
    S = min(teto, Σ w_d × (n_d − 1) / 4)        score de sucesso
    R = 0,30 + 0,60 × S                          fator de captura em 12 meses
    P = R × (Σ FTE_a × C × e_a + Σ L_k)          retorno bruto anual
    Δmargem (p.p.) = P / Receita × 100

Só usa a biblioteca padrão. Fórmulas do pacote são analisadas com ast e
calculadas sem eval, então um pacote não consegue executar código.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import logging
import operator
import sys
from pathlib import Path

MOTOR_VERSAO = "0.4.0"
MAX_UNIDADES = 10  # tipos de unidade por empresa; cada tipo soma todas as lojas daquele tipo
CENARIOS = ("conservador", "base")  # o otimista nunca é mostrado ao cliente
DIMENSOES = ("estrategia", "dados", "processos", "tecnologia", "governanca", "pessoas")

log = logging.getLogger("motor")


class RespostaInvalida(ValueError):
    """Resposta ausente, fora das opções ou incoerente. A mensagem vai para o agente pedir correção."""


# ---------------------------------------------------------------- fórmulas
_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}


def calcular_formula(formula: str, variaveis: dict[str, float]) -> float:
    """Calcula + - * / sobre variáveis conhecidas. Qualquer outra construção é recusada."""
    def _no(n: ast.AST) -> float:
        if isinstance(n, ast.Expression):
            return _no(n.body)
        if isinstance(n, ast.BinOp) and type(n.op) in _OPS:
            return _OPS[type(n.op)](_no(n.left), _no(n.right))
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
            return float(n.value)
        if isinstance(n, ast.Name):
            if n.id not in variaveis:
                raise RespostaInvalida(f"variável sem valor na fórmula: {n.id}")
            return float(variaveis[n.id])
        raise ValueError(f"construção não permitida na fórmula: {type(n).__name__}")
    return _no(ast.parse(formula, mode="eval"))


# ---------------------------------------------------------------- utilidades
def _opcao(tabela: dict, chave: str, pergunta: str):
    if chave not in tabela:
        raise RespostaInvalida(f"{pergunta}: '{chave}' não é uma opção válida ({', '.join(tabela)})")
    return tabela[chave]


def _marcadas(tabela: dict, valor, pergunta: str) -> list:
    """0.3.0: perguntas de escolha múltipla. Aceita uma opção (texto, formato até 0.2.1) ou
    uma lista; repetições contam uma vez só, na ordem em que aparecem."""
    lista = [valor] if isinstance(valor, str) else valor
    if not isinstance(lista, list) or not lista:
        raise RespostaInvalida(f"{pergunta}: marque pelo menos uma opção")
    return [_opcao(tabela, v, pergunta) for v in dict.fromkeys(lista)]


def _media_marcadas(tabela: dict, valor, pergunta: str) -> float:
    """Combinação de ferramentas (ex.: planilhas + sistema): a nota é a média das marcadas."""
    notas = _marcadas(tabela, valor, pergunta)
    return sum(notas) / len(notas)


def _maior_marcada(tabela: dict, valor, pergunta: str) -> float:
    """Uso de IA: vale o estágio mais avançado que a empresa já alcançou."""
    return max(_marcadas(tabela, valor, pergunta))


def _faixa(faixa: list[float], cenario: str) -> float:
    """Conservador usa o limite inferior; base usa o ponto médio (regra do doc)."""
    lo, hi = faixa
    return lo if cenario == "conservador" else (lo + hi) / 2


def _param(valor, cenario: str) -> float:
    if isinstance(valor, dict):
        return valor[cenario] if cenario in valor else valor["valor"]
    return valor


def receita(r: dict, modelo: dict, cenario: str) -> float:
    """Pergunta 2 (decisão de 02/11/2026): valor aproximado em R$; faixa só se o cliente preferir.

    Com valor informado, os dois cenários usam o mesmo número e a diferença entre
    eles vem só dos parâmetros. Com faixa, vale a regra antiga (limite inferior e
    ponto médio) e o resultado é marcado como de menor precisão.
    """
    v = r.get("q2_valor")
    if v is not None:
        if not isinstance(v, (int, float)) or v <= 0:
            raise RespostaInvalida("pergunta 2: o faturamento precisa ser um valor positivo em R$")
        return float(v)
    if "q2" not in r:
        raise RespostaInvalida("pergunta 2 sem resposta")
    return _faixa(_opcao(modelo["self"]["faixas_receita"], r["q2"], "pergunta 2"), cenario)


def nivel(score: float, niveis: list) -> str:
    for minimo, nome in niveis:
        if score >= minimo:
            return nome
    return niveis[-1][1]


# ---------------------------------------------------------------- score
def notas_dimensoes(r: dict, pacote: dict, modelo: dict) -> tuple[dict, dict, float]:
    s = modelo["self"]
    areas_nota = {a: _media_marcadas(s["nota_q5"], v, f"pergunta 5 ({a})") for a, v in r["grade_q5"].items()}
    faltando = set(modelo["areas_operacionais"]) | {"11_ti_seguranca"}
    faltando -= set(areas_nota)
    if faltando:
        raise RespostaInvalida(f"pergunta 5 sem resposta para: {sorted(faltando)}")

    itens = pacote["pergunta_dados_D"]["itens"]
    cob = [_opcao(s["cobertura_fonte"], r["dados_D"].get(f, "não sei"), f"pergunta D ({f})") for f in itens]
    cobertura = sum(cob) / len(itens)
    nota_q8 = _media_marcadas(s["nota_q8"], r.get("q8"), "pergunta 8")
    notas = {
        "estrategia": _opcao(s["nota_q11"], r["q11"], "pergunta 11"),
        "dados": (nota_q8 + 1 + 3 * cobertura) / 2,
        "processos": sum(areas_nota[a] for a in modelo["areas_operacionais"]) / len(modelo["areas_operacionais"]),
        "tecnologia": areas_nota["11_ti_seguranca"],
        "governanca": _opcao(s["nota_q10"], r["q10"], "pergunta 10"),
        "pessoas": _maior_marcada(s["nota_q9"], r.get("q9"), "pergunta 9"),
    }
    areas_nota.update({"01_estrategia": notas["estrategia"], "02_dados": notas["dados"], "03_pessoas": notas["pessoas"]})
    return notas, areas_nota, cobertura


def score_sucesso(notas: dict, modelo: dict) -> tuple[float, float | None]:
    bruto = sum(modelo["pesos_dimensoes"][d] * (notas[d] - 1) / 4 for d in DIMENSOES)
    teto = None
    for t in modelo["travas"]:  # a trava mais restritiva que se aplica vence
        if any(notas[d] <= t["nota_max"] for d in t["dimensoes"]):
            teto = t["teto"] if teto is None else min(teto, t["teto"])
    return (min(bruto, teto) if teto is not None else bruto), teto


def fator_R(score: float, modelo: dict) -> float:
    return modelo["fator_R"]["minimo"] + modelo["fator_R"]["amplitude"] * score


# ---------------------------------------------------------------- retorno
def areas_para_pergunta_6(areas_nota: dict, pacote: dict, modelo: dict) -> list[str]:
    """Escolhe as áreas que a pergunta 6 vai perguntar: maior potencial esperado pelo setor.

    Potencial = participação típica de pessoas × e_a base × espaço para evoluir (5 − nota).
    Assim uma área pequena e manual (ex.: jurídico com 1 pessoa) não toma lugar de Operações.
    """
    dist = pacote["areas"]["distribuicao_tipica_pessoas"]
    cand = modelo["areas_operacionais"] + ["11_ti_seguranca"]
    def potencial(a):
        return dist.get(a, 0) * e_a(a, pacote, modelo)["base"] * (5 - areas_nota[a])
    return sorted(cand, key=potencial, reverse=True)[: modelo["self"]["areas_no_calculo"]]


def e_a(area: str, pacote: dict, modelo: dict) -> dict:
    return pacote["areas"].get("e_a_ajustado", {}).get(area) or modelo["e_a_benchmark"][area]


def retorno(r: dict, pacote: dict, modelo: dict, R: float, cenario: str) -> dict:
    s = modelo["self"]
    receita_c = receita(r, modelo, cenario)
    C = pacote["parametros_padrao"]["C_custo_anual_por_pessoa"]["valor"]

    pessoas = []
    for area, faixa in r["pessoas_q6"].items():
        fte = _faixa(_opcao(s["faixas_pessoas_area"], faixa, f"pergunta 6 ({area})"), cenario)
        ea = e_a(area, pacote, modelo)[cenario]
        pessoas.append({"area": area, "fte": fte, "e_a": ea, "valor": fte * C * ea})

    variaveis = {k: v["valor"] for k, v in pacote["parametros_padrao"].items()}
    us = r.get("unidades")
    if us is None:
        alavancas = _alavancas_formato_antigo(r, pacote, s, variaveis, receita_c, cenario)
    else:
        alavancas = _alavancas_por_unidade(us, pacote, s, variaveis, receita_c, cenario)

    bruto_pessoas = sum(p["valor"] for p in pessoas)
    bruto_alavancas = sum(a["valor"] for a in alavancas)
    P = R * (bruto_pessoas + bruto_alavancas)
    return {"receita_usada": receita_c, "pessoas": pessoas, "alavancas": alavancas,
            "potencial_bruto": bruto_pessoas + bruto_alavancas, "R": R, "P": P,
            # 0.2.1: faixa "até 4,8 mi" tem limite inferior 0; sem receita não há margem a mostrar.
            "delta_margem_pp": P / receita_c * 100 if receita_c > 0 else None}


def _locais(a: dict, cenario: str) -> dict:
    return {k: _param(v, cenario) for k, v in a.items() if isinstance(v, dict) and k != "condicao"}


def _alavancas_formato_antigo(r: dict, pacote: dict, s: dict, variaveis: dict, receita_c: float, cenario: str) -> list:
    """Até 0.3.0: a empresa inteira é uma operação de restaurante (perguntas S1 a S3)."""
    variaveis = dict(variaveis)
    variaveis.update({
        "receita_salao_delivery": receita_c,
        "lugares_total": r["setoriais"]["lugares_total"],
        "ticket_pessoa": _faixa(_opcao(s["faixas_ticket"], r["setoriais"]["ticket_pessoa"], "pergunta S2"), cenario),
    })
    alavancas = []
    for nome in pacote["self_ordem_alavancas"][: pacote["self_alavancas_max"]]:
        a = pacote["alavancas"][nome]
        cond = a.get("condicao")
        if cond and r["setoriais"].get(cond["campo"]) not in cond["em"]:
            alavancas.append({"alavanca": nome, "nome": a["nome"], "linha_dre": a["linha_dre"], "valor": 0.0,
                              "motivo": f"não calculada: {cond['campo']} = {r['setoriais'].get(cond['campo'])}"})
            continue
        valor = calcular_formula(a["formula"], {**variaveis, **_locais(a, cenario)})
        alavancas.append({"alavanca": nome, "nome": a["nome"], "linha_dre": a["linha_dre"], "valor": valor})
    return alavancas


def _alavancas_por_unidade(us: list, pacote: dict, s: dict, variaveis: dict, receita_c: float, cenario: str) -> list:
    """0.4.0: cada tipo de unidade (restaurante, cozinha institucional...) entra com a sua parte da
    receita e as suas variáveis; a alavanca só roda nos segmentos que ela declara."""
    por_segmento = pacote.get("parametros_por_segmento", {})
    alavancas = []
    for nome in pacote["self_ordem_alavancas"][: pacote["self_alavancas_max"]]:
        a = pacote["alavancas"][nome]
        segs = a.get("segmentos")
        cond = a.get("condicao")
        partes = []
        for u in us:
            seg = u["segmento"]
            if segs is not None and seg not in segs:
                continue
            if cond and u.get(cond["campo"]) not in cond["em"]:
                partes.append({"segmento": seg, "valor": 0.0,
                               "motivo": f"não calculada: {cond['campo']} = {u.get(cond['campo'])}"})
                continue
            v = dict(variaveis)
            v.update({k: p["valor"] for k, p in por_segmento.get(seg, {}).items()})
            v["receita_salao_delivery"] = receita_c * (u["participacao_receita"] / 100)
            if "lugares_total" in u:
                v["lugares_total"] = u["lugares_total"]
            if "ticket_pessoa" in u:
                v["ticket_pessoa"] = _faixa(s["faixas_ticket"][u["ticket_pessoa"]], cenario)
            partes.append({"segmento": seg, "valor": calcular_formula(a["formula"], {**v, **_locais(a, cenario)})})
        item = {"alavanca": nome, "nome": a["nome"], "linha_dre": a["linha_dre"],
                "valor": sum((x["valor"] for x in partes), 0.0), "por_unidade": partes}
        if not partes:
            item["motivo"] = "não se aplica aos tipos de unidade informados"
        elif all("motivo" in x for x in partes):
            item["motivo"] = "; ".join(x["motivo"] for x in partes)
        alavancas.append(item)
    return alavancas


def _numero(v, pergunta: str, minimo: float = 0) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v in (float("inf"), float("-inf")) or v < minimo:
        raise RespostaInvalida(f"{pergunta}: informe um número válido")
    return v


def validar_unidades(r: dict, pacote: dict, modelo: dict) -> None:
    """0.4.0: tipos de unidade de negócio. Sem a lista, vale o formato antigo (perguntas S1 a S3)."""
    us = r.get("unidades")
    if us is None:
        return
    if not isinstance(us, list) or not us:
        raise RespostaInvalida("unidades: informe pelo menos um tipo de unidade")
    if len(us) > MAX_UNIDADES:
        raise RespostaInvalida(f"unidades: no máximo {MAX_UNIDADES} tipos")
    segmentos = pacote["segmentos"]
    disponiveis = [k for k, v in segmentos.items() if v.get("no_self")]
    opcoes_campo = {"ticket_pessoa": modelo["self"]["faixas_ticket"],
                    "fila_pico": dict.fromkeys(pacote["perguntas_self"]["S3"]["opcoes"])}
    vistos = set()
    total = 0.0
    for i, u in enumerate(us):
        p = f"unidade {i + 1}"
        if not isinstance(u, dict):
            raise RespostaInvalida(f"{p}: formato inválido")
        seg = u.get("segmento")
        if not isinstance(seg, str) or seg not in disponiveis:
            raise RespostaInvalida(f"{p}: segmento '{seg}' não disponível no Self ({', '.join(disponiveis)})")
        if seg in vistos:
            raise RespostaInvalida(f"{p}: segmento '{seg}' repetido; some as unidades do mesmo tipo numa só")
        vistos.add(seg)
        q = _numero(u.get("quantidade"), f"{p} (quantidade)", 1)
        if q != int(q):
            raise RespostaInvalida(f"{p} (quantidade): informe um número inteiro")
        part = _numero(u.get("participacao_receita"), f"{p} (participação na receita)")
        if part <= 0 or part > 100:
            raise RespostaInvalida(f"{p} (participação na receita): use um valor acima de 0 e até 100%")
        total += part
        for campo in segmentos[seg]["campos_self"]:
            if campo in opcoes_campo:
                valor = u.get(campo)
                _opcao(opcoes_campo[campo], valor if isinstance(valor, str) else None, f"{p} ({campo})")
            else:
                _numero(u.get(campo), f"{p} ({campo})")
    if abs(total - 100) > 0.5:
        raise RespostaInvalida("unidades: a participação na receita dos tipos de unidade precisa somar 100%")


# ---------------------------------------------------------------- validações
def validar_coerencia(r: dict, pacote: dict, modelo: dict) -> list[str]:
    s = modelo["self"]
    validar_unidades(r, pacote, modelo)
    lo_tot, hi_tot = _opcao(s["faixas_pessoas_total"], r["q3"], "pergunta 3")
    soma_lo = sum(_opcao(s["faixas_pessoas_area"], f, "pergunta 6")[0] for f in r["pessoas_q6"].values())
    if soma_lo > hi_tot:
        raise RespostaInvalida(f"pessoas nas áreas ({soma_lo}+) passam do total da empresa (até {hi_tot})")
    if len(r["pessoas_q6"]) > s["areas_no_calculo"]:
        raise RespostaInvalida(f"pergunta 6 aceita no máximo {s['areas_no_calculo']} áreas")
    avisos = []
    rec = receita(r, modelo, "base")
    rpp = rec / ((lo_tot + hi_tot) / 2)
    lo, hi = s["receita_por_pessoa_plausivel"]
    if not lo <= rpp <= hi:
        avisos.append(f"receita por pessoa de R$ {rpp:,.0f} fora do padrão; o agente deve confirmar antes de mostrar")
    return avisos


# ---------------------------------------------------------------- orquestração
def calcular_self(r: dict, pacote: dict, modelo: dict) -> dict:
    if r.get("setor") != pacote["pacote"]:
        raise RespostaInvalida(f"setor '{r.get('setor')}' não corresponde ao pacote '{pacote['pacote']}'")
    avisos = validar_coerencia(r, pacote, modelo)
    notas, areas_nota, cobertura = notas_dimensoes(r, pacote, modelo)
    S, teto = score_sucesso(notas, modelo)
    R = fator_R(S, modelo)
    cen = {c: retorno(r, pacote, modelo, R, c) for c in CENARIOS}

    # O que destrava mais valor: subir 1 ponto em cada dimensão e ver o efeito no score e no retorno.
    destrava = []
    for d in DIMENSOES:
        n2 = dict(notas, **{d: min(notas[d] + 1, modelo["nota_max_self"])})
        S2, _ = score_sucesso(n2, modelo)
        if S2 > S:
            P2 = fator_R(S2, modelo) * cen["conservador"]["potencial_bruto"]
            destrava.append({"dimensao": d, "score_novo": S2, "ganho_score_pp": (S2 - S) * 100,
                             "ganho_retorno": P2 - cen["conservador"]["P"]})
    destrava.sort(key=lambda x: x["ganho_score_pp"], reverse=True)

    # Top 3 oportunidades, com exemplo concreto do pacote do setor.
    casos = pacote.get("casos_de_uso", [])
    comps = [(p["area"], "e_a", p["valor"] * R) for p in cen["conservador"]["pessoas"]] + \
            [(a["alavanca"], a["alavanca"], a["valor"] * R) for a in cen["conservador"]["alavancas"] if a["valor"] > 0]
    top = []
    for chave, tipo, valor in sorted(comps, key=lambda c: c[2], reverse=True)[:3]:
        ex = next((c["nome"] for c in casos if (c["area"] == chave and c["alavanca"] == "e_a")
                   or c["alavanca"] == chave), None)
        top.append({"origem": chave, "valor_conservador": valor, "exemplo": ex})

    mapa = []
    for fid in pacote["pergunta_dados_D"]["itens"]:
        f = pacote["catalogo_fontes"][fid]
        st = r["dados_D"].get(fid, "não sei")
        item = {"fonte": fid, "nome": f["nome"], "situacao": st}
        if st in ("não tem", "parcial"):
            item["como_criar"] = f["se_faltar"]
            item["criar_fonte_com_ia"] = bool(f.get("criar_fonte"))
        mapa.append(item)

    return {
        "versoes": {"motor": MOTOR_VERSAO, "modelo": modelo["versao"], "pacote": f"{pacote['pacote']} {pacote['versao']}"},
        "hash_respostas": hashlib.sha256(json.dumps(r, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16],
        "avisos": avisos,
        "precisao_receita": "informada" if r.get("q2_valor") is not None else "faixa (menor precisão)",
        "score": {"valor": S, "teto_aplicado": teto, "nivel": nivel(S, modelo["niveis"]),
                  "nota_prontidao": sum(modelo["pesos_dimensoes"][d] * notas[d] for d in DIMENSOES),
                  "dimensoes": notas, "cobertura_fontes": cobertura,
                  "ressalva": "Índice fundamentado, não probabilidade estatística, até calibrar com projetos reais."},
        "score_por_area": areas_nota,
        "areas_sugeridas_q6": areas_para_pergunta_6(areas_nota, pacote, modelo),
        "retorno": cen,
        "top3": top,
        "o_que_destrava": destrava[:1],
        "mapa_de_dados": mapa,
    }


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    ap = argparse.ArgumentParser(description="Motor de cálculo do Self assessment IRON AI")
    ap.add_argument("respostas", type=Path)
    ap.add_argument("--pacote", type=Path, required=True)
    ap.add_argument("--modelo", type=Path, required=True)
    ap.add_argument("--saida", type=Path)
    a = ap.parse_args()
    try:
        r, p, m = (json.loads(x.read_text(encoding="utf-8")) for x in (a.respostas, a.pacote, a.modelo))
        res = calcular_self(r, p, m)
    except RespostaInvalida as exc:
        log.error("resposta inválida: %s", exc)
        return 2
    except (OSError, json.JSONDecodeError, KeyError) as exc:
        log.error("falha ao ler ou processar: %r", exc)
        return 1
    for av in res["avisos"]:
        log.warning(av)
    c = res["retorno"]["conservador"]
    margem = "sem receita" if c["delta_margem_pp"] is None else f"{c['delta_margem_pp']:.2f} p.p. de margem"
    log.info("score %.0f%% (%s), R = %.2f, retorno conservador R$ %s/ano, %s",
             res["score"]["valor"] * 100, res["score"]["nivel"], c["R"], f"{c['P']:,.0f}".replace(",", "."), margem)
    texto = json.dumps(res, ensure_ascii=False, indent=2)
    if a.saida:
        a.saida.write_text(texto, encoding="utf-8")
        log.info("resultado gravado em %s", a.saida)
    else:
        print(texto)
    return 0


if __name__ == "__main__":
    sys.exit(main())
