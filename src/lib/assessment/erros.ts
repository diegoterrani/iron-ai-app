/** Resposta ausente, fora das opções ou incoerente. A mensagem vai para a tela pedir correção. */
export class RespostaInvalida extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RespostaInvalida";
  }
}
