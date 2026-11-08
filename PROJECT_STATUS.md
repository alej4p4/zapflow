# BarraSoftware (ZapFlow) — Status do Projeto & Guia de Continuidade para IA

> **Atenção para qualquer IA (OpenCode, VSCode Copilot, Claude, Cursor, ChatGPT):**
> Este arquivo é o ponto de partida e a fonte de contexto da aplicação. Leia este documento com atenção antes de realizar qualquer alteração para entender a arquitetura, o que já foi feito e onde paramos.

---

## 📌 1. Visão Geral da Aplicação
- **Nome Oficial:** BarraSoftware
- **Repositório Git:** `https://github.com/alej4p4/zapflow.git`
- **Branch Ativo:** `main`
- **Deploy em Produção:** Railway (`https://zapflow-production-40ae.up.railway.app`)
- **Versão Atual:** `1.6.22`

---

## 🛠️ 2. Stack Tecnológica
- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript
- **WhatsApp Engine:** `@whiskeysockets/baileys` (Multi-Device WebSockets)
- **Banco de Dados & ORM:** PostgreSQL (Neon) gerenciado via **Prisma 6.7** (`prisma/schema.prisma`)
- **Estilização & UI:** Tailwind CSS, Radix UI / Shadcn, Lucide React, Sonner (Toasts)
- **Runtime:** Node.js 20+ no Windows (desenvolvimento local) e Docker / Linux (Railway)

---

## 🚀 3. O que já foi implementado e entregue recentemente

### Módulo de Áudio Completo (v1.6.22)
- **Streaming de Áudio HTTP 206 Partial Content (`/api/media/[filename]`):**
  - Implementado suporte completo ao cabeçalho `Range` HTTP para áudio e vídeo, permitindo ao navegador (Chrome, Edge, Safari, Firefox) carregar por partes, avançar/voltar na barra de progresso e calcular a duração exata do arquivo sem travar.
- **Resolução do bug `Infinity:NaN` do Chromium:**
  - Adicionada detecção e contorno para arquivos gravados pelo MediaRecorder onde o browser reporta `duration === Infinity`, além de proteção numérica com `Number.isFinite()` que garante fallback visual para `"0:00"`.
- **Persistência Imediata de Mensagens de Voz Enviadas (`ChatService.sendMediaMessage`):**
  - O áudio gravado e enviado pelo atendente agora é gravado imediatamente em disco (`mediaDir/${sessionId}-${keyId}.${ext}`) e gravado no banco com URL permanente (`/api/media/...`), garantindo que o áudio continue tocando mesmo após atualizar a página ou após o sync do Baileys.
- **Download Nativo de Mídias e Áudios:**
  - Fluxo de download corrigido: URLs `blob:` são baixadas síncronas sem bloqueio de pop-up; URLs de servidor usam `?download=1&filename=...` com `Content-Disposition: attachment` forçando o navegador a salvar o arquivo diretamente no dispositivo com o nome e formato corretos (.ogg, .mp3, etc.).
- **Transcrição de Voz com IA ("Ler") Resiliente:**
  - Ação "Ler" agora suporta conversão automática de áudios em Base64 para envio ao Whisper, suporta chaves gratuitas da Groq Whisper V3 Turbo e OpenAI, busca de áudios no banco de dados e persistência do texto lido no `localStorage`.
- **Botões Visíveis e Acessíveis:**
  - Os botões "Ler" e "Baixar" agora ficam sempre visíveis no player com opacidade suave (`opacity-80`), facilitando o uso tanto no desktop quanto em telas touch / celulares.

### Rebranding Completo (v1.6.21)
- Todo o sistema foi renomeado de **WA-AKG** para **BarraSoftware** (telas de Login, Registro, Navbar, Documentação Swagger, Webhooks e schemas Prisma).
- Favicon oficial atualizado com o ícone do robô arredondado verde em SVG dinâmico (`src/app/icon.tsx`).

### Estabilidade e Correções Arquiteturais
- **Prisma Singleton (`src/lib/prisma.ts`):** Garantido singleton incondicional para evitar esgotamento do pool de conexões (Connection Pool Exhaustion) no PostgreSQL/Neon.
- **Player de Áudio no Chat (`src/components/chat/chat-window.tsx`):** Eliminado bug de `Infinity:NaN` em arquivos de áudio OGG/Opus do WhatsApp usando `Number.isFinite()` e escutas ativas em `onDurationChange`.
- **Notificação na Aba do Navegador (`src/components/chat/chat-list.tsx`):** Título da aba atualiza dinamicamente para `(N) BarraSoftware` quando há mensagens não lidas.
- **Graceful Shutdown (`src/server/index.ts` e `manager.ts`):** Encerramento limpo de conexões WebSocket e timers do Baileys para evitar sockets zumbis.

### Recursos de Atendimento e CRM
- **Human Handoff (Pausa Inteligente do Robô):**
  - Quando um atendente humano envia mensagem para um contato, o robô silencia auto-respostas por 15 minutos para aquele chat (`src/modules/whatsapp/store/autoreply.ts`).
  - O sistema ignora mensagens enviadas pelo próprio robô para não silenciar a si mesmo.
- **Controle Visual do Robô no Topo do Chat:**
  - Badge no cabeçalho do chat: `🟢 Bot Ativo` ou `🟠 Bot Pausado (Xm restantes)`.
  - Popover interativo que permite pausar manualmente por 15m/1h ou reativar imediatamente com 1 clique (`src/app/api/autoreplies/[sessionId]/pause/route.ts`).
- **Notas Internas Compartilhadas em Nuvem:**
  - Bloco de notas do cliente sincronizado no banco de dados via `/api/contacts/[sessionId]/note`.
  - Todos os operadores da equipe visualizam as observações do cliente em tempo real.

---

## 📋 4. Onde Paramos & Próximas Melhorias (Backlog Prioritário)

1. **Pipeline / Kanban de Atendimento (CRM):**
   - Criar visualização em colunas no estilo Kanban/Trello organizada por Etiquetas (`Novo Lead` ➔ `Em Negociação` ➔ `Aguardando Pagamento` ➔ `Fechado`).
   - Permitir arrastar e soltar (drag & drop) o cartão do contato entre colunas para atualizar a etiqueta no WhatsApp em tempo real.
2. **Resumo Automático de Conversas por IA:**
   - Botão para resumir a conversa inteira do contato em 3 tópicos para troca de turno rápida de operadores.
3. **Relatórios Gerenciais e Métricas de Atendimento:**
   - Dashboard com Tempo Médio de Resposta (TMR), horários de pico e volume de atendimentos por operador.

---

## 💻 5. Comandos Importantes para a IA

- **Verificar integridade do código e tipos:**
  ```powershell
  npx tsc --noEmit
  ```
- **Rodar os testes automatizados:**
  ```powershell
  npm test
  ```
- **Enviar alterações para Produção no Railway:**
  ```powershell
  git add -A
  git commit -m "sua mensagem descritiva"
  git push origin main
  ```
  *(O Railway detecta o push no `main` e faz o build e deploy automaticamente).*
