# BarraSoftware (ZapFlow) — Status do Projeto & Guia de Continuidade para IA

> **Atenção para qualquer IA (OpenCode, VSCode Copilot, Claude, Cursor, ChatGPT):**
> Este arquivo é o ponto de partida e a fonte de contexto da aplicação. Leia este documento com atenção antes de realizar qualquer alteração para entender a arquitetura, o que já foi feito e onde paramos.

---

## 📌 1. Visão Geral da Aplicação
- **Nome Oficial:** BarraSoftware
- **Repositório Git:** `https://github.com/alej4p4/zapflow.git`
- **Branch Ativo:** `main`
- **Deploy em Produção:** Railway (`https://zapflow-production-40ae.up.railway.app`)
- **Versão Atual:** `1.6.20`

---

## 🛠️ 2. Stack Tecnológica
- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript
- **WhatsApp Engine:** `@whiskeysockets/baileys` (Multi-Device WebSockets)
- **Banco de Dados & ORM:** PostgreSQL (Neon) gerenciado via **Prisma 6.7** (`prisma/schema.prisma`)
- **Estilização & UI:** Tailwind CSS, Radix UI / Shadcn, Lucide React, Sonner (Toasts)
- **Runtime:** Node.js 20+ no Windows (desenvolvimento local) e Docker / Linux (Railway)

---

## 🚀 3. O que já foi implementado e entregue recentemente

### Rebranding Completo
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
   - Permitir arrastar e soltar (drag & drop) o cartão do contato entre colunas para atualizar a etiqueta no WhatsApp.
2. **Transcrição de Áudios Recebidos com IA:**
   - Botão de transcrição rápida para áudios longos recebidos usando Whisper (Groq ou OpenAI).
3. **Relatórios Gerenciais e Métricas de Atendimento:**
   - Dashboard com Tempo Médio de Resposta (TMR), horários de pico e volume por operador.

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
