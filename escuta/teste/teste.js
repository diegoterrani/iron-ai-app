// Página de teste da Fase 1: captura microfone e/ou áudio de uma aba,
// manda PCM 16 kHz ao Worker e mostra a transcrição e os blocos.
const PROTOCOLO = "escuta.v1";
const CANAL = { microfone: 0, aba: 1 };

// Servidor local (porta 8788) fala com o `wrangler dev`; publicado, a página fala com o próprio Worker.
const ENDERECO_WORKER = location.port === "8788" ? "ws://localhost:8787/escuta" : `wss://${location.host}/escuta`;

const el = (id) => document.getElementById(id);
const estado = (texto) => (el("estado").textContent = texto);

let ws = null;
let contexto = null;
const fluxos = [];
const parciais = { microfone: "", aba: "" };

async function conectar() {
  if (ws && ws.readyState <= WebSocket.OPEN) return ws;
  // Aqui o token sai em troca do código de acesso; na Fase 2 quem emite é o app, depois de conferir sessão e MFA.
  // Caminho relativo: /teste/token no Worker, /token no servidor local.
  const resposta = await fetch("token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ codigo: el("codigo").value }),
  });
  if (resposta.status === 401) throw new Error("código de acesso incorreto");
  if (!resposta.ok) throw new Error("não foi possível obter o token de teste");
  const { token } = await resposta.json();

  const conexao = new WebSocket(ENDERECO_WORKER, [PROTOCOLO, token]);
  conexao.binaryType = "arraybuffer";
  conexao.addEventListener("message", (e) => receber(JSON.parse(e.data)));
  conexao.addEventListener("close", (e) => estado(`Conexão fechada (${e.code}).`));
  await new Promise((ok, falha) => {
    conexao.addEventListener("open", ok, { once: true });
    conexao.addEventListener("error", () => falha(new Error("falha ao conectar no Worker")), { once: true });
  });
  ws = conexao;
  return ws;
}

function receber(msg) {
  if (msg.tipo === "parcial" || msg.tipo === "final") {
    parciais[msg.canal] = msg.tipo === "final" ? "" : msg.texto;
    // textContent, nunca innerHTML: a transcrição é texto de terceiros.
    el("parcial").textContent = [parciais.microfone && `Sala: ${parciais.microfone}`, parciais.aba && `Remoto: ${parciais.aba}`]
      .filter(Boolean)
      .join("\n");
  } else if (msg.tipo === "bloco") {
    const item = document.createElement("li");
    const meta = document.createElement("small");
    meta.textContent = `Bloco ${msg.numero} · ${msg.motivo} · ${msg.texto.length} caracteres · ${new Date().toLocaleTimeString("pt-BR")}`;
    const texto = document.createElement("span");
    texto.textContent = msg.texto;
    item.append(meta, texto);
    el("blocos").append(item);
  } else if (msg.tipo === "erro") {
    estado(`Aviso do Worker: ${msg.codigo}${msg.detalhe ? ` (${msg.detalhe})` : ""}`);
  }
}

async function ligar(canal, fluxo) {
  const conexao = await conectar();
  if (!contexto) {
    // 16 kHz direto no contexto: o navegador faz a reamostragem.
    contexto = new AudioContext({ sampleRate: 16000 });
    await contexto.audioWorklet.addModule("captura-worklet.js");
  }
  const fonte = contexto.createMediaStreamSource(fluxo);
  const no = new AudioWorkletNode(contexto, "captura-pcm");
  no.port.onmessage = (e) => {
    if (conexao.readyState !== WebSocket.OPEN) return;
    const quadro = new Uint8Array(1 + e.data.byteLength);
    quadro[0] = CANAL[canal];
    quadro.set(new Uint8Array(e.data), 1);
    conexao.send(quadro);
  };
  fonte.connect(no);
  fluxos.push(fluxo);
  el("parar").disabled = false;
  estado(`Escutando: ${fluxos.length} fonte(s).`);
}

el("mic").addEventListener("click", async () => {
  try {
    // Sem cancelamento de eco e ruído agressivos: eles cortam vozes distantes numa sala.
    const fluxo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } });
    await ligar("microfone", fluxo);
  } catch (err) {
    estado(`Microfone: ${err.message}`);
  }
});

el("aba").addEventListener("click", async () => {
  try {
    // O navegador exige vídeo no pedido; só a faixa de áudio é usada.
    const fluxo = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (fluxo.getAudioTracks().length === 0) {
      fluxo.getTracks().forEach((t) => t.stop());
      throw new Error('sem áudio. Escolha uma aba e marque "Compartilhar áudio da aba".');
    }
    await ligar("aba", new MediaStream(fluxo.getAudioTracks()));
    fluxos.push(fluxo);
  } catch (err) {
    estado(`Aba: ${err.message}`);
  }
});

el("parar").addEventListener("click", async () => {
  fluxos.splice(0).forEach((f) => f.getTracks().forEach((t) => t.stop()));
  await contexto?.close();
  contexto = null;
  ws?.close(1000, "fim");
  ws = null;
  el("parar").disabled = true;
  estado("Parado.");
});
