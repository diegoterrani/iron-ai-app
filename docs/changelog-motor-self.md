# Changelog do motor do Self

Toda mudança que altera números do Self sobe a versão do motor (`MOTOR_VERSAO_06`)
ou do pacote do setor (`versao` no JSON). Resultados já gravados guardam as
versões com que foram calculados e não são recalculados.

## Motor 0.7.0 · pacote food_service 0.5.0 (23/11/2026)

**Investimento e retorno (M1).**
- Novo módulo `src/lib/assessment/v06/fluxo.ts`: fluxo de caixa de 24 meses,
  função pura, mesma conta do deck da reunião (acumulados arredondados mês a mês).
- Tabela de preço versionada no pacote (`regua.precos`): Deep dive R$ 63 mil em
  2 meses; onda R$ 360 mil (decisão do Terrani em 23/11, igual ao deck v11),
  30% na entrada e 70% em 6 parcelas a partir do go-live, metade do Deep
  descontada da Onda 1; operação R$ 8 mil/mês e tecnologia R$ 15 mil/mês por
  onda a partir do go-live; rampa de 3 meses; 24 meses; IR/CSLL 34%.
- Ondas no pacote (`regua.ondas`): Onda 1 = desperdício e compras (go-live mês 6);
  Onda 2 = escala, rotatividade, retaguarda, reservas, giro e eventos (go-live mês 9).
  Onda sem ganho não entra no investimento.
- Saem `investimento_por_receita`, `custo_mudanca_por_investimento` e
  `meses_efetivos_24m`. O veredito (3× e 2×) usa o retorno do fluxo.
- Resultado ganha `regua.fluxo` (IRON, tecnologia, cruzamento, exposição máxima,
  sobra para os sócios, ondas e os 24 meses). Resultados do motor 0.6.0 seguem
  abrindo com o texto antigo (custo de mudança).
- Tela e PDF: "com custo de mudança" vira "com investimento IRON e tecnologia";
  nova linha "Investimento de referência em 24 meses: R$ X (IRON R$ Y + tecnologia R$ Z)".

**Textos (M2, M3, M5).**
- "Cada mês sem agir" vira "Cada mês de atraso · R$ X · de ganho adiado, em ritmo de cruzeiro".
- "O custo de esperar" vira "Quanto o atraso adia", com a frase do ritmo de cruzeiro.
- Pessoas: "Ninguém é demitido…" e o ganho conservador se a empresa repuser todas as vagas.
- Piloto: semanas 1 e 2 linha de base assinada pelo financeiro; semanas 3 a 6 piloto; semana 6 resultado medido.

**DRE (M4).** Percentuais inteiros pelo método do maior resto (somam sempre 100);
o lucro é 100 menos os custos, nunca arredondado à parte.

**Testes.** `tests/unit/assessment-fluxo06.test.ts` (conta de referência do pedido
com onda de R$ 170 mil e a do deck com R$ 360 mil, propriedade de 1000 entradas do
DRE, snapshots da tela e da página 3 do PDF). `tests/unit/pdf-texto.ts` extrai o
texto do PDF sem dependência nova.
