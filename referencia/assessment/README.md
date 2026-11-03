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

- 0.4.0 (03/11/2026): tipos de unidade de negócio, depois do teste de mesa com
  um cliente que tem 7 restaurantes e 8 cozinhas de hospital. As respostas
  podem trazer `unidades` (segmento, quantidade, parte do faturamento e as
  variáveis do segmento). Cada alavanca declara em que `segmentos` roda e o
  motor soma por unidade, com `parametros_por_segmento` (CMV de 40% na cozinha
  institucional, hipotese_iron). Pacote food_service 0.2.0 ganha o segmento
  `institucional`. Sem `unidades`, o cálculo é o de 0.3.0 (os 200 casos antigos
  continuam iguais); 100 casos novos cobrem as unidades.
- 0.3.0 (02/11/2026): escolha múltipla, a pedido do Terrani. Pergunta 5 (cada
  área) e pergunta 8 usam a média das opções marcadas (planilhas + sistema = 2,5);
  pergunta 9 usa o estágio mais avançado; pergunta 12 continua fora do cálculo.
  Resposta em texto (formato antigo, uma opção) dá o mesmo resultado de antes.
- 0.2.1 (02/11/2026): com receita em faixa "até 4,8 mi", o cenário conservador
  usa receita 0 e a margem dava divisão por zero. Agora `delta_margem_pp` vem
  `null` nesse caso. O limite inferior dessa faixa deve ser revisto no modelo.
- 0.2.0: pergunta 2 aceita receita aproximada em número.
