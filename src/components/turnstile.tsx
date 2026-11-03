"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef } from "react";

/** Parte da API do Turnstile que usamos (render explícito). */
interface TurnstileApi {
  render: (el: HTMLElement, opts: { sitekey: string; language?: string }) => string | undefined;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

interface Props {
  siteKey: string;
  nonce?: string;
  /** Muda a cada resposta do servidor: o token é de uso único, então renova. */
  resetKey?: unknown;
}

/**
 * Widget anti-robô da Cloudflare. A validação de verdade é no servidor.
 *
 * Usa render explícito: o modo automático só procura `.cf-turnstile` quando o
 * script carrega pela primeira vez. Ao chegar na tela por navegação interna
 * (ex.: depois de "Sair"), o script já estava carregado, o widget não aparecia,
 * o envio ia sem token e o `reset()` num contêiner vazio lançava erro, o que
 * derrubava a página em "Algo deu errado". Aqui cada montagem cria o próprio
 * widget e cada desmontagem o remove.
 */
export function Turnstile({ siteKey, nonce, resetKey }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const first = useRef(true);

  const renderizar = useCallback(() => {
    const api = window.turnstile;
    if (!api || !ref.current || widgetId.current) return;
    try {
      widgetId.current = api.render(ref.current, { sitekey: siteKey, language: "pt-br" }) ?? null;
    } catch (err) {
      // Sem widget o envio vai sem token e o servidor recusa (falha fechada).
      console.error("turnstile.render_error", (err as Error)?.message);
    }
  }, [siteKey]);

  // Script já carregado (navegação interna): renderiza na montagem.
  // Desmontagem: remove o widget para não deixar referência órfã.
  useEffect(() => {
    renderizar();
    return () => {
      const id = widgetId.current;
      widgetId.current = null;
      if (id) {
        try {
          window.turnstile?.remove(id);
        } catch {
          // Contêiner já saiu da página; nada a limpar.
        }
      }
    };
  }, [renderizar]);

  // Nova resposta do servidor: o token anterior foi gasto, pede outro.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = widgetId.current;
    if (!id) {
      renderizar();
      return;
    }
    try {
      window.turnstile?.reset(id);
    } catch {
      // Widget perdido: recria em vez de derrubar a página.
      widgetId.current = null;
      renderizar();
    }
  }, [resetKey, renderizar]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        nonce={nonce}
        onReady={renderizar}
      />
      <div ref={ref} className="cf-turnstile" />
    </>
  );
}
