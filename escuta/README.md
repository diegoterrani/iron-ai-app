# Escuta de reuniões (Worker da Cloudflare)

Agente ouvinte do Deep assessment: o navegador do analista manda o áudio da
reunião, este Worker transcreve em tempo real (Deepgram Nova-3 no Workers AI)
e devolve a transcrição cortada em blocos. Na Fase 3, cada bloco vira uma fala
automática para o agente do Deep.

**Fase 1 (este pacote): prova de áudio.** Nada aqui toca o app nem a produção.
A página de teste roda publicada no próprio Worker (modo de teste) ou na
máquina do analista.

## Como funciona

```
Navegador ──WebSocket (PCM 16 kHz)──▶ Worker ──▶ Durable Object da reunião
                                                  └─▶ Nova-3 (Workers AI)
Navegador ◀── parcial / final / bloco ────────────┘
```

- Um Durable Object por reunião (`deep_sessoes.id`).
- Dois canais: `0` microfone (sala) e `1` áudio da aba (participantes remotos).
  O primeiro byte de cada quadro diz o canal.
- Um bloco fecha por pausa (6 s sem fala) ou por tamanho (3.500 caracteres);
  regras em `src/segmentador.ts`.

## Segurança

- **Token curto**: HMAC-SHA256, vale para uma reunião e por no máximo 10 min
  (`src/token.ts`). Vai no subprotocolo do WebSocket, não na URL.
- **Origem**: só as origens de `ORIGENS_PERMITIDAS` abrem a escuta.
- **Nada é gravado**: sem storage, sem áudio em disco. O log tem só códigos,
  contagens e tamanhos, nunca o texto.
- **Falha fechado**: sem `ESCUTA_TOKEN_SECRET` (32+ caracteres), responde 503.
- Áudio e transcrição saem do Brasil (Cloudflare). O aviso de consentimento e
  o contrato com o cliente precisam cobrir isso antes de uma reunião real.

## Prova de áudio publicada (sem instalar nada)

O Worker serve a página de teste em `/teste/` enquanto o segredo
`TESTE_CODIGO` existir. Apagar o segredo desliga a página e a emissão de
token de teste (tudo volta a responder 404), sem novo deploy.

Enquanto ligado, quem souber o código consegue transcrever áudio na conta.
Use um código longo e aleatório e apague o segredo ao terminar.

1. **Publicar**
   - Comando: conectar o repositório ao Worker `iron-ai-escuta` no painel da
     Cloudflare (Workers Builds), com diretório raiz `escuta` e comando de
     deploy `npx wrangler deploy`
   - Alvo: painel da Cloudflare, conta da IRON
   - Validação: `https://<endereço do Worker>/saude` responde `{"ok":true}`

2. **Segredo do token**
   - Comando: cadastrar o segredo `ESCUTA_TOKEN_SECRET` (32+ caracteres aleatórios)
   - Alvo: Worker `iron-ai-escuta`, Settings, Variables and Secrets
   - Validação: `/teste/` ainda responde 404 (o modo de teste segue desligado)

3. **Ligar o modo de teste**
   - Comando: cadastrar o segredo `TESTE_CODIGO` (16+ caracteres aleatórios)
   - Alvo: o mesmo Worker
   - Validação: `/teste/` abre a página; código errado mostra "código de acesso incorreto"

4. **Testar**
   - Comando: abrir `/teste/` no Chrome ou Edge, digitar o código e seguir os
     passos 5 e 6 da seção abaixo
   - Alvo: navegador do analista
   - Validação: transcrição em "Ao vivo" e blocos fechando após 6 s de silêncio

5. **Desligar**
   - Comando: apagar o segredo `TESTE_CODIGO`
   - Alvo: o mesmo Worker
   - Validação: `/teste/` responde 404

O Workers AI tem cota diária no plano gratuito; para reuniões de mais de
alguns minutos, a conta precisa do plano pago de Workers.

## Prova de áudio local

Cada passo: comando, onde rodar e como conferir.

1. **Dependências**
   - Comando: `npm ci`
   - Alvo: pasta `escuta/`, na máquina do analista
   - Validação: `npm run check` termina com `16 passed`

2. **Segredo local**
   - Comando: criar `escuta/.dev.vars` com `ESCUTA_TOKEN_SECRET=<32+ caracteres aleatórios>`
   - Alvo: pasta `escuta/` (o arquivo está no `.gitignore`)
   - Validação: `git status` não mostra `.dev.vars`

3. **Worker local** (usa o Workers AI da conta; pede `wrangler login` na primeira vez)
   - Comando: `npm run dev`
   - Alvo: pasta `escuta/`
   - Validação: `curl http://localhost:8787/saude` responde `{"ok":true}`

4. **Página de teste**
   - Comando: `ESCUTA_TOKEN_SECRET=<o mesmo segredo> npm run teste:pagina`
     (PowerShell: `$env:ESCUTA_TOKEN_SECRET="<segredo>"; npm run teste:pagina`)
   - Alvo: outro terminal, pasta `escuta/`
   - Validação: `http://localhost:8788` abre no Chrome ou Edge (o campo de código pode ficar vazio)

5. **Teste presencial**
   - Comando: botão "Ativar microfone (sala)" e conversar por 2 minutos
   - Alvo: página de teste
   - Validação: texto aparece em "Ao vivo" em até 2 s; um bloco fecha após 6 s de silêncio

6. **Teste online**
   - Comando: botão "Adicionar áudio de uma aba", escolher a aba da reunião e marcar "Compartilhar áudio da aba"
   - Alvo: página de teste, com a reunião aberta em outra aba do mesmo navegador
   - Validação: falas dos remotos saem como `Remoto:` e as suas como `Sala:`

## O que a prova precisa responder

- A transcrição em pt-BR é boa o bastante com áudio real de sala e de reunião online?
- Os parâmetros `language`, `smart_format` e `endpointing` são aceitos pelo Nova-3
  no Workers AI? (Estão em `PARAMETROS_STT`; só `encoding`, `sample_rate` e
  `interim_results` constam no exemplo oficial.)
- A pausa de 6 s corta os blocos em pontos naturais da conversa?

## Ainda não verificado

O caminho até o Nova-3 (`env.AI.run(..., { websocket: true })`) segue a
documentação da Cloudflare, mas não foi executado: precisa de credencial da
conta. Autenticação, origem, token, modo de teste e segmentação foram
testados localmente.
