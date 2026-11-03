"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: { reset: (el?: HTMLElement) => void };
  }
}

interface Props {
  siteKey: string;
  nonce?: string;
  /** Muda a cada resposta do servidor: o token é de uso único, então renova. */
  resetKey?: unknown;
}

/** Widget anti-robô da Cloudflare. A validação de verdade é no servidor. */
export function Turnstile({ siteKey, nonce, resetKey }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (ref.current) window.turnstile?.reset(ref.current);
  }, [resetKey]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        nonce={nonce}
      />
      <div ref={ref} className="cf-turnstile" data-sitekey={siteKey} data-language="pt-br" />
    </>
  );
}
