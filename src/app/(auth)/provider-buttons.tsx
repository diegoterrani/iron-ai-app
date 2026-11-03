import { entrarComProvedor } from "./actions";

/** Google (pessoal e Workspace) e Microsoft Entra ID. */
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
      <form action={entrarComProvedor}>
        <input type="hidden" name="provedor" value="microsoft" />
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="btn btn-secondary">
          Continuar com Microsoft
        </button>
      </form>
      <p className="field-hint">
        Ao continuar, você aceita os{" "}
        <a href="https://iron-ai.io/politica-de-privacidade.html">Termos e a Política de Privacidade</a>.
      </p>
    </div>
  );
}
