import localFont from "next/font/local";

// Fontes servidas pelo próprio app (sem Google Fonts): CSP font-src 'self'
// e nenhum dado do visitante enviado a terceiros (LGPD).
export const manrope = localFont({
  src: [
    { path: "../fonts/manrope-latin-400-normal.woff2", weight: "400" },
    { path: "../fonts/manrope-latin-500-normal.woff2", weight: "500" },
    { path: "../fonts/manrope-latin-600-normal.woff2", weight: "600" },
    { path: "../fonts/manrope-latin-700-normal.woff2", weight: "700" },
  ],
  variable: "--font-sans",
  display: "swap",
});

export const sourceSerif = localFont({
  src: "../fonts/source-serif-4-latin-opsz-normal.woff2",
  variable: "--font-serif",
  display: "swap",
});

export const plexMono = localFont({
  src: [
    { path: "../fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400" },
    { path: "../fonts/ibm-plex-mono-latin-600-normal.woff2", weight: "600" },
  ],
  variable: "--font-mono",
  display: "swap",
});
