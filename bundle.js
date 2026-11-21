var M=Object.defineProperty;var s=(a,e)=>M(a,"name",{value:e,configurable:!0});var w={"/index.html":[`<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Escuta IRON AI: prova de \xE1udio</title>
    <link rel="stylesheet" href="teste.css" />
  </head>
  <body>
    <h1>Escuta IRON AI: prova de \xE1udio</h1>
    <p class="aviso">P\xE1gina s\xF3 para teste. Avise todos os presentes antes de ativar: o \xE1udio \xE9 enviado para transcri\xE7\xE3o.</p>

    <label>C\xF3digo de acesso <input id="codigo" type="password" autocomplete="off" size="30" /></label>
    <div class="botoes">
      <button id="mic" type="button">Ativar microfone (sala)</button>
      <button id="aba" type="button">Adicionar \xE1udio de uma aba (reuni\xE3o online)</button>
      <button id="parar" type="button" disabled>Parar</button>
    </div>
    <p id="estado" role="status">Parado.</p>

    <h2>Ao vivo</h2>
    <p id="parcial" class="parcial"></p>

    <h2>Blocos fechados (o que iria para o agente)</h2>
    <ol id="blocos"></ol>

    <script type="module" src="teste.js"><\/script>
  </body>
</html>
`,"text/html; charset=utf-8"],"/teste.js":[`// P\xE1gina de teste da Fase 1: captura microfone e/ou \xE1udio de uma aba,
// manda PCM 16 kHz ao Worker e mostra a transcri\xE7\xE3o e os blocos.
const PROTOCOLO = "escuta.v1";
const CANAL = { microfone: 0, aba: 1 };

// Servidor local (porta 8788) fala com o \`wrangler dev\`; publicado, a p\xE1gina fala com o pr\xF3prio Worker.
const ENDERECO_WORKER = location.port === "8788" ? "ws://localhost:8787/escuta" : \`wss://\${location.host}/escuta\`;

const el = (id) => document.getElementById(id);
const estado = (texto) => (el("estado").textContent = texto);

let ws = null;
let contexto = null;
const fluxos = [];
const parciais = { microfone: "", aba: "" };

async function conectar() {
  if (ws && ws.readyState <= WebSocket.OPEN) return ws;
  // Aqui o token sai em troca do c\xF3digo de acesso; na Fase 2 quem emite \xE9 o app, depois de conferir sess\xE3o e MFA.
  // Caminho relativo: /teste/token no Worker, /token no servidor local.
  const resposta = await fetch("token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ codigo: el("codigo").value }),
  });
  if (resposta.status === 401) throw new Error("c\xF3digo de acesso incorreto");
  if (!resposta.ok) throw new Error("n\xE3o foi poss\xEDvel obter o token de teste");
  const { token } = await resposta.json();

  const conexao = new WebSocket(ENDERECO_WORKER, [PROTOCOLO, token]);
  conexao.binaryType = "arraybuffer";
  conexao.addEventListener("message", (e) => receber(JSON.parse(e.data)));
  conexao.addEventListener("close", (e) => estado(\`Conex\xE3o fechada (\${e.code}).\`));
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
    // textContent, nunca innerHTML: a transcri\xE7\xE3o \xE9 texto de terceiros.
    el("parcial").textContent = [parciais.microfone && \`Sala: \${parciais.microfone}\`, parciais.aba && \`Remoto: \${parciais.aba}\`]
      .filter(Boolean)
      .join("\\n");
  } else if (msg.tipo === "bloco") {
    const item = document.createElement("li");
    const meta = document.createElement("small");
    meta.textContent = \`Bloco \${msg.numero} \xB7 \${msg.motivo} \xB7 \${msg.texto.length} caracteres \xB7 \${new Date().toLocaleTimeString("pt-BR")}\`;
    const texto = document.createElement("span");
    texto.textContent = msg.texto;
    item.append(meta, texto);
    el("blocos").append(item);
  } else if (msg.tipo === "erro") {
    estado(\`Aviso do Worker: \${msg.codigo}\${msg.detalhe ? \` (\${msg.detalhe})\` : ""}\`);
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
  estado(\`Escutando: \${fluxos.length} fonte(s).\`);
}

el("mic").addEventListener("click", async () => {
  try {
    // Sem cancelamento de eco e ru\xEDdo agressivos: eles cortam vozes distantes numa sala.
    const fluxo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } });
    await ligar("microfone", fluxo);
  } catch (err) {
    estado(\`Microfone: \${err.message}\`);
  }
});

el("aba").addEventListener("click", async () => {
  try {
    // O navegador exige v\xEDdeo no pedido; s\xF3 a faixa de \xE1udio \xE9 usada.
    const fluxo = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (fluxo.getAudioTracks().length === 0) {
      fluxo.getTracks().forEach((t) => t.stop());
      throw new Error('sem \xE1udio. Escolha uma aba e marque "Compartilhar \xE1udio da aba".');
    }
    await ligar("aba", new MediaStream(fluxo.getAudioTracks()));
    fluxos.push(fluxo);
  } catch (err) {
    estado(\`Aba: \${err.message}\`);
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
`,"text/javascript; charset=utf-8"],"/teste.css":[`body { font-family: system-ui, sans-serif; max-width: 52rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
.aviso { border-left: 4px solid #b45309; padding: 0.5rem 0.75rem; background: #fff7ed; }
.botoes { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 1rem 0; }
button { padding: 0.5rem 0.9rem; }
.parcial { min-height: 3rem; color: #555; }
#blocos li { white-space: pre-wrap; margin-bottom: 0.75rem; padding: 0.5rem; background: #f4f4f5; }
#blocos small { display: block; color: #666; }
`,"text/css; charset=utf-8"],"/captura-worklet.js":[`// Roda na thread de \xE1udio: junta as amostras em peda\xE7os de ~250 ms, converte
// para PCM de 16 bits e entrega \xE0 p\xE1gina. O AudioContext j\xE1 est\xE1 em 16 kHz.
class CapturaPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(4000);
    this.usado = 0;
  }

  process(entradas) {
    const canal = entradas[0]?.[0];
    if (!canal) return true;
    for (let i = 0; i < canal.length; i++) {
      const amostra = Math.max(-1, Math.min(1, canal[i]));
      this.buffer[this.usado++] = amostra < 0 ? amostra * 0x8000 : amostra * 0x7fff;
      if (this.usado === this.buffer.length) {
        this.port.postMessage(this.buffer.slice(0).buffer);
        this.usado = 0;
      }
    }
    return true;
  }
}

registerProcessor("captura-pcm", CapturaPcm);
`,"text/javascript; charset=utf-8"]};import{DurableObject as L}from"cloudflare:workers";var P={pausaMs:6e3,minCaracteres:40,maxCaracteres:3500},I=80,g={microfone:"Sala",aba:"Remoto"},f=class{constructor(e=P){this.opcoes=e;if(e.minCaracteres<1||e.maxCaracteres<=e.minCaracteres||e.pausaMs<1)throw new Error("op\xE7\xF5es do segmentador inv\xE1lidas")}opcoes;static{s(this,"Segmentador")}linhas=[];tamanho=0;ultimaFalaMs=null;numero=0;adicionar(e,t){let o=[],n=e.texto.replace(/\s+/g," ").trim();if(!n)return o;for(this.ultimaFalaMs=t;n;){let r=this.mesmaLinha(e.canal)?1:g[e.canal].length+3,i=this.opcoes.maxCaracteres-this.tamanho-r;if(i<1||this.tamanho>0&&i<I&&n.length>i){o.push(this.fechar("tamanho"));continue}let c=N(n,i);this.acrescentar(e.canal,c),n=n.slice(c.length).trim(),n&&o.push(this.fechar("tamanho"))}return o}verificar(e){return this.ultimaFalaMs===null||this.tamanho<this.opcoes.minCaracteres||e-this.ultimaFalaMs<this.opcoes.pausaMs?null:this.fechar("pausa")}encerrar(){return this.tamanho>0?this.fechar("encerramento"):null}mesmaLinha(e){return this.linhas.at(-1)?.canal===e}acrescentar(e,t){let o=this.linhas.at(-1);o&&o.canal===e?(o.texto+=` ${t}`,this.tamanho+=t.length+1):(this.linhas.push({canal:e,texto:t}),this.tamanho+=t.length+g[e].length+3)}fechar(e){let t=this.linhas.map(o=>`${g[o.canal]}: ${o.texto}`).join(`
`);return this.linhas=[],this.tamanho=0,this.ultimaFalaMs=null,this.numero+=1,{numero:this.numero,texto:t,motivo:e}}};function N(a,e){if(a.length<=e)return a;let t=a.lastIndexOf(" ",e);return t>0?a.slice(0,t):a.slice(0,e)}s(N,"cortarEmPalavra");function b(a){return typeof a=="string"&&a.length>=16}s(b,"modoTesteLigado");async function E(a,e){let t=new TextEncoder,[o,n]=await Promise.all([crypto.subtle.digest("SHA-256",t.encode(a)),crypto.subtle.digest("SHA-256",t.encode(e))]),r=new Uint8Array(o),i=new Uint8Array(n),c=0;for(let l=0;l<r.length;l++)c|=(r[l]??0)^(i[l]??0);return c===0}s(E,"codigoConfere");function x(a){return{"Content-Security-Policy":["default-src 'self'",`connect-src 'self' wss://${a}`,"object-src 'none'","base-uri 'none'","form-action 'none'","frame-ancestors 'none'"].join("; "),"Permissions-Policy":"microphone=(self), display-capture=(self), camera=(), geolocation=()","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow"}}s(x,"cabecalhosTeste");var y={"/teste/":"/index.html","/teste/teste.css":"/teste.css","/teste/teste.js":"/teste.js","/teste/captura-worklet.js":"/captura-worklet.js"};var S=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;function C(a){let e="";for(let t of a)e+=String.fromCharCode(t);return btoa(e).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}s(C,"paraBase64Url");function k(a){if(!/^[A-Za-z0-9_-]+$/.test(a))return null;try{let e=atob(a.replace(/-/g,"+").replace(/_/g,"/"));return Uint8Array.from(e,t=>t.charCodeAt(0))}catch{return null}}s(k,"deBase64Url");async function A(a,e){return crypto.subtle.importKey("raw",new TextEncoder().encode(a),{name:"HMAC",hash:"SHA-256"},!1,[e])}s(A,"chave");async function O(a,e){let t=C(new TextEncoder().encode(JSON.stringify(a))),o=await crypto.subtle.sign("HMAC",await A(e,"sign"),new TextEncoder().encode(t));return`${t}.${C(new Uint8Array(o))}`}s(O,"assinarToken");async function T(a,e,t){let o=a.split(".");if(o.length!==2||a.length>1024)return{ok:!1,motivo:"formato"};let[n,r]=o,i=k(r),c=k(n);if(!i||!c)return{ok:!1,motivo:"formato"};if(!await crypto.subtle.verify("HMAC",await A(e,"verify"),i,new TextEncoder().encode(n)))return{ok:!1,motivo:"assinatura"};let d;try{d=JSON.parse(new TextDecoder().decode(c))}catch{return{ok:!1,motivo:"formato"}}if(typeof d!="object"||d===null)return{ok:!1,motivo:"formato"};let{sessao:p,sub:h,exp:m}=d;if(typeof p!="string"||!S.test(p))return{ok:!1,motivo:"formato"};if(typeof h!="string"||!S.test(h))return{ok:!1,motivo:"formato"};if(typeof m!="number"||!Number.isFinite(m))return{ok:!1,motivo:"formato"};let v=Math.floor(t/1e3);return m<=v||m>v+600?{ok:!1,motivo:"expirado"}:{ok:!0,payload:{sessao:p,sub:h,exp:m}}}s(T,"conferirToken");var _="escuta.v1",U={0:"microfone",1:"aba"},W=32001,B=1e3,$=14400*1e3,j={encoding:"linear16",sample_rate:"16000",language:"pt-BR",interim_results:!0,smart_format:!0,endpointing:"300"};function F(a,e,t){return e?b(a.TESTE_CODIGO)&&e===t?!0:a.ORIGENS_PERMITIDAS.split(",").map(o=>o.trim()).filter(Boolean).includes(e):!1}s(F,"origemPermitida");async function H(a,e,t){let o=new Response("N\xE3o encontrado",{status:404});if(!b(e.TESTE_CODIGO))return o;let n=x(t.host);if(t.pathname==="/teste")return Response.redirect(`${t.origin}/teste/`,308);if(t.pathname==="/teste/token"){if(a.method!=="POST")return new Response("M\xE9todo n\xE3o permitido",{status:405,headers:n});if(a.headers.get("Origin")!==t.origin)return new Response("Origem n\xE3o autorizada",{status:403,headers:n});let l;try{let p=await a.text();if(p.length>1024)throw new Error("grande");l=JSON.parse(p).codigo}catch{return new Response("Pedido inv\xE1lido",{status:400,headers:n})}if(typeof l!="string"||!await E(l,e.TESTE_CODIGO))return u("teste.codigo_recusado"),new Response("C\xF3digo incorreto",{status:401,headers:n});let d=await O({sessao:crypto.randomUUID(),sub:crypto.randomUUID(),exp:Math.floor(Date.now()/1e3)+300},e.ESCUTA_TOKEN_SECRET);return u("teste.token_emitido"),Response.json({token:d},{headers:n})}let r=y[t.pathname];if(!r||a.method!=="GET")return o;let i=w[r];if(!i)return o;let c=new Response(i[0],{headers:{"content-type":i[1]}});for(let[l,d]of Object.entries(n))c.headers.set(l,d);return c}s(H,"atenderTeste");function u(a,e={}){console.log(JSON.stringify({evento:a,...e}))}s(u,"log");var oe={async fetch(a,e){let t=new URL(a.url);if(t.pathname==="/saude")return Response.json({ok:!0});let o=!!e.ESCUTA_TOKEN_SECRET&&e.ESCUTA_TOKEN_SECRET.length>=32;if(t.pathname==="/teste"||t.pathname.startsWith("/teste/"))return o?H(a,e,t):new Response("N\xE3o encontrado",{status:404});if(t.pathname!=="/escuta")return new Response("N\xE3o encontrado",{status:404});if(a.headers.get("Upgrade")?.toLowerCase()!=="websocket")return new Response("Esperado WebSocket",{status:426});if(!o)return u("escuta.sem_config"),new Response("Indispon\xEDvel",{status:503});if(!F(e,a.headers.get("Origin"),t.origin))return u("escuta.origem_recusada"),new Response("Origem n\xE3o autorizada",{status:403});let n=(a.headers.get("Sec-WebSocket-Protocol")??"").split(",").map(c=>c.trim());if(n.length!==2||n[0]!==_)return new Response("Protocolo inv\xE1lido",{status:400});let r=await T(n[1]??"",e.ESCUTA_TOKEN_SECRET,Date.now());return r.ok?e.REUNIAO.getByName(r.payload.sessao).fetch(a):(u("escuta.token_recusado",{motivo:r.motivo}),new Response("N\xE3o autorizado",{status:401}))}},R=class extends L{static{s(this,"ReuniaoEscuta")}cliente=null;stt=new Map;abrindo=new Map;segmentador=new f;relogio=null;inicioMs=0;blocos=0;async fetch(e){this.cliente&&this.encerrar(4001,"substitu\xEDda por nova conex\xE3o");let t=new WebSocketPair,[o,n]=[t[0],t[1]];return n.binaryType="arraybuffer",n.accept(),this.cliente=n,this.segmentador=new f,this.inicioMs=Date.now(),this.blocos=0,n.addEventListener("message",r=>this.aoReceber(n,r.data)),n.addEventListener("close",()=>this.aoFechar(n)),n.addEventListener("error",()=>this.aoFechar(n)),this.relogio=setInterval(()=>this.aCadaSegundo(),B),this.enviar({tipo:"pronto"}),u("escuta.aberta"),new Response(null,{status:101,webSocket:o,headers:{"Sec-WebSocket-Protocol":_}})}async aoReceber(e,t){if(e!==this.cliente||typeof t=="string")return;if(t.byteLength<3||t.byteLength>W){this.enviar({tipo:"erro",codigo:"quadro_invalido"});return}let o=U[new Uint8Array(t,0,1)[0]??-1];if(!o){this.enviar({tipo:"erro",codigo:"canal_invalido"});return}let n=await this.conexaoStt(o);n&&n.readyState===WebSocket.OPEN&&n.send(t.slice(1))}conexaoStt(e){let t=this.stt.get(e);if(t)return Promise.resolve(t);let o=this.abrindo.get(e);return o||(o=this.abrirStt(e).finally(()=>this.abrindo.delete(e)),this.abrindo.set(e,o)),o}async abrirStt(e){try{let o=await this.env.AI.run.bind(this.env.AI)("@cf/deepgram/nova-3",j,{websocket:!0}),n=o.webSocket;if(!n)throw new Error(`sem websocket (status ${o.status})`);return n.accept(),n.addEventListener("message",r=>this.aoTranscrever(e,r.data)),n.addEventListener("close",()=>this.sttCaiu(e,n)),n.addEventListener("error",()=>this.sttCaiu(e,n)),this.stt.set(e,n),u("escuta.stt_aberto",{canal:e}),n}catch(t){u("escuta.stt_falhou",{canal:e,erro:t instanceof Error?t.name:"desconhecido"});let o=this.env.TESTE_CODIGO&&t instanceof Error?t.message.slice(0,300):void 0;return this.enviar({tipo:"erro",codigo:"stt_indisponivel",detalhe:o}),null}}sttCaiu(e,t){this.stt.get(e)===t&&(this.stt.delete(e),u("escuta.stt_caiu",{canal:e}),this.enviar({tipo:"erro",codigo:"stt_reconectando"}))}aoTranscrever(e,t){if(typeof t!="string")return;let o;try{o=JSON.parse(t)}catch{return}let n=o.channel?.alternatives?.[0]?.transcript;if(!(typeof n!="string"||!n.trim())){if(o.is_final!==!0){this.enviar({tipo:"parcial",canal:e,texto:n});return}this.enviar({tipo:"final",canal:e,texto:n});for(let r of this.segmentador.adicionar({canal:e,texto:n},Date.now()))this.entregar(r)}}aCadaSegundo(){if(Date.now()-this.inicioMs>$){this.encerrar(4002,"tempo m\xE1ximo de escuta");return}let e=this.segmentador.verificar(Date.now());e&&this.entregar(e)}entregar(e){this.blocos+=1,this.enviar({tipo:"bloco",numero:e.numero,motivo:e.motivo,texto:e.texto}),u("escuta.bloco",{numero:e.numero,motivo:e.motivo,caracteres:e.texto.length})}enviar(e){this.cliente?.readyState===WebSocket.OPEN&&this.cliente.send(JSON.stringify(e))}aoFechar(e){e===this.cliente&&this.encerrar(1e3,"cliente saiu")}encerrar(e,t){let o=this.segmentador.encerrar();o&&this.entregar(o),this.relogio&&clearInterval(this.relogio),this.relogio=null;for(let r of this.stt.values())try{r.close(1e3,"fim")}catch{}this.stt.clear();let n=this.cliente;this.cliente=null;try{n?.close(e,t)}catch{}u("escuta.encerrada",{codigo:e,blocos:this.blocos,segundos:Math.round((Date.now()-this.inicioMs)/1e3)})}};export{R as ReuniaoEscuta,oe as default};
//# sourceMappingURL=index.js.map
