# Motor de referência do Self assessment

O app calcula com `src/lib/assessment/motor.ts`. Este `motor.py` é a referência:
os testes exigem que os dois deem o mesmo resultado, até a última casa.

| Arquivo | Papel |
| --- | --- |
| `motor.py` | Motor original (só biblioteca padrão). Lê os JSON de `src/lib/assessment/dados/` |
| `gerar_casos.py` | Sorteia 200 conjuntos de respostas (semente fixa), roda o Python e grava `tests/fixtures/assessment/casos.json` |

## Quando mudar o motor, o modelo ou um pacote

1. Altere o Python e o TypeScript juntos e suba `MOTOR_VERSAO` nos dois.
2. Regere os casos: `python3 referencia/assessment/gerar_casos.py`
3. Rode `npm test`: o teste `assessment-motor` compara o piloto e os 200 casos.

Nenhum número sai de LLM: o motor é determinístico e cada resultado guarda as
versões do motor, do modelo e do pacote, mais o hash das respostas.

## Histórico

- 0.2.1 (02/11/2026): com receita em faixa "até 4,8 mi", o cenário conservador
  usa receita 0 e a margem dava divisão por zero. Agora `delta_margem_pp` vem
  `null` nesse caso. O limite inferior dessa faixa deve ser revisto no modelo.
- 0.2.0: pergunta 2 aceita receita aproximada em número.
