import type { NextConfig } from "next";

/**
 * Cabeçalhos de segurança fixos, aplicados a toda resposta (inclusive /api).
 * A CSP, que depende de nonce por requisição, fica em src/proxy.ts.
 */
const securityHeaders = [
  // Força HTTPS por 2 anos, inclusive subdomínios (mesmo valor do site).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // Área logada nunca deve ser indexada.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

/*
 * cacheComponents/PPR ficam desligados de propósito: a casca estática
 * pré-renderizada no build sai sem o nonce da CSP e o navegador bloqueia
 * os scripts. Numa área logada quase tudo é por usuário, então o ganho de
 * PPR é pequeno e a CSP estrita vale mais (coberto por tests/e2e).
 */
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
