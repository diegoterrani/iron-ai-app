import { entrarComProvedor } from "./actions";

/**
 * Login social: só Google (pessoal e Workspace) por enquanto.
 * Microsoft Entra ID fica para depois (decisão do Terrani, 03/11/2026).
 */
export function ProviderButtons({ next }: { next: string }) {
  return (
    <div className="providers">
      <form action={entrarComProvedor}>
        <input type="hidden" name="provedor" value="google" />
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="btn btn-secondary">
          Continuar com Google
        </button>
      </form>
      <p className="field-hint">
        Ao continuar, você aceita os{" "}
        <a href="https://iron-ai.io/politica-de-privacidade.html">Termos e a Política de Privacidade</a>.
      </p>
    </div>
  );
}
