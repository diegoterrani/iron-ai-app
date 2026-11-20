// Servidor local da página de teste (Fase 1). Só escuta em 127.0.0.1.
// Serve os arquivos de escuta/teste e emite um token de teste em /token,
// assinado com ESCUTA_TOKEN_SECRET (o mesmo valor de escuta/.dev.vars).
//
// Uso:  ESCUTA_TOKEN_SECRET=<segredo> node scripts/servir-teste.mjs
import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const PORTA = 8788;
// Lista fixa: nenhum caminho vindo da requisição chega ao sistema de arquivos.
const ARQUIVOS = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/teste.css": ["teste.css", "text/css; charset=utf-8"],
  "/teste.js": ["teste.js", "text/javascript; charset=utf-8"],
  "/captura-worklet.js": ["captura-worklet.js", "text/javascript; charset=utf-8"],
};

const segredo = process.env.ESCUTA_TOKEN_SECRET ?? "";
if (segredo.length < 32) {
  console.error("Defina ESCUTA_TOKEN_SECRET com pelo menos 32 caracteres (o mesmo de escuta/.dev.vars).");
  process.exit(1);
}

const base64url = (dado) => Buffer.from(dado).toString("base64url");
// Reunião fictícia, fixa enquanto o servidor roda: recarregar a página cai no mesmo Durable Object.
const sessao = randomUUID();
const analista = randomUUID();

function emitirToken() {
  const corpo = base64url(JSON.stringify({ sessao, sub: analista, exp: Math.floor(Date.now() / 1000) + 300 }));
  return `${corpo}.${base64url(createHmac("sha256", segredo).update(corpo).digest())}`;
}

createServer(async (req, res) => {
  const caminho = new URL(req.url ?? "/", "http://localhost").pathname;
  if (req.method !== "GET") {
    res.writeHead(405).end();
    return;
  }
  if (caminho === "/token") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify({ token: emitirToken() }));
    return;
  }
  const arquivo = ARQUIVOS[caminho];
  if (!arquivo) {
    res.writeHead(404).end("Não encontrado");
    return;
  }
  res
    .writeHead(200, {
      "Content-Type": arquivo[1],
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self'; connect-src 'self' ws://localhost:8787 wss://*.workers.dev; base-uri 'none'; frame-ancestors 'none'",
    })
    .end(await readFile(new URL(`../teste/${arquivo[0]}`, import.meta.url)));
}).listen(PORTA, "127.0.0.1", () => console.log(`Página de teste em http://localhost:${PORTA}`));
