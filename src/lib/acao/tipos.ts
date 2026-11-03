/** Resultado de uma operação de formulário (usado por cliente e servidor). */
export interface AcaoState {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
}
