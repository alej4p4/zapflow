# BarraSoftware (ZapFlow) — Status do Projeto & Guia de Continuidade para IA

> **Atenção para qualquer IA (OpenCode, VSCode Copilot, Claude, Cursor, ChatGPT):**
> Este arquivo é o ponto de partida e a fonte de contexto da aplicação. Leia este documento com atenção antes de realizar qualquer alteração para entender a arquitetura, o que já foi feito e onde paramos.

---

## 📌 1. Visão Geral da Aplicação
- **Nome Oficial:** BarraSoftware
- **Repositório Git:** `https://github.com/alej4p4/zapflow.git`
- **Branch Ativo:** `main`
- **Deploy em Produção:** Railway (`https://zapflow-production-40ae.up.railway.app`)
- **Versão Atual:** `1.6.26`
- **Banco de Dados Oficial:** PostgreSQL 18.6 Nativo no Railway (Volume persistente `/var/lib/postgresql/data`, rede privada `postgres.railway.internal:5432`)
- **Volume Persistente de Arquivos:** `zapflow-volume-XrQh` montado em `/app/data` no serviço `zapflow`

---

## 🛠️ 2. Stack Tecnológica
- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript
- **WhatsApp Engine:** `@whiskeysockets/baileys` (Multi-Device WebSockets)
- **Banco de Dados & ORM:** PostgreSQL 18.6 nativo co-alocado no Railway, gerenciado via **Prisma 6.7** (`prisma/schema.prisma`)
- **Estilização & UI:** Tailwind CSS, Radix UI / Shadcn, Lucide React, Sonner (Toasts)
- **Runtime:** Node.js 20+ no Windows (desenvolvimento local) e Docker / Linux (Railway)

---

## 🚀 3. O que já foi implementado e entregue recentemente

### Busca Global de Mensagens no Histórico & Exportação de Contatos (v1.6.26)
- **Busca Global de Mensagens no Histórico Completo (`/dashboard/chat`):**
  - Agora os atendentes podem buscar qualquer termo (ex: "PIX", "orçamento", "comprovante", "endereço") diretamente na barra de busca do chat.
  - Exibição de abas inteligentes: **Conversas** e **Mensagens**.
  - A busca em mensagens pesquisa em todas as mais de 14.800 mensagens do banco de dados com sensibilidade desativada (case-insensitive) e exibe os resultados com nome do cliente, foto, horário e prévia destacada.
  - Ao clicar na mensagem encontrada, o sistema abre a conversa imediatamente e rola com animação suave e destaque verde até a mensagem exata no histórico.
- **Exportação de Contatos em Formato CSV / Excel (`/dashboard/contacts`):**
  - Novo botão "Exportar CSV" na tela de Contatos que baixa a base de contatos em formato CSV compatível com Excel (com codificação UTF-8 BOM para preservar acentuação em português).
- **Busca Insensível a Maiúsculas/Minúsculas nas APIs:**
  - Melhoradas as rotas de busca de contatos e mensagens no PostgreSQL com `mode: 'insensitive'`.

### Painel Executivo com Métricas e Inteligência Operacional (v1.6.25)
- **Dashboard com Métricas em Tempo Real (`/dashboard`):**
  - Contadores ao vivo de mensagens totais (+mensagens de hoje), contatos cadastrados, grupos e sessões ativas.
  - **Histograma 24 Horas de Atividade:** Gráfico interativo com distribuição de mensagens hora a hora ao longo dos últimos 7 dias, destacando automaticamente os horários de pico (ex: 11h, 14h, 17h, 18h).
  - **Distribuição do Funil / Etiquetas:** Visão percentual e quantitativa dos contatos distribuídos em cada etapa do funil do CRM.
  - Grade de Ações Rápidas com atalhos diretos para Kanban, Conversas, Disparos, Etiquetas e Configurações.
- **Botão Direto "Resumo IA" no Topo da Conversa:**
  - Botão destacado no cabeçalho do chat que permite ao atendente resumir toda a conversa do cliente em 3 tópicos executivos com 1 clique.
- **Exportação Limpa de Conversas:**
  - Opção no menu de opções do chat para baixar a conversa completa em `.txt` com cabeçalho oficial da BarraSoftware e formatação legível para auditorias.

### Módulo Kanban CRM & Melhorias de Produtividade (v1.6.24)
- **Pipeline & Kanban CRM (`/dashboard/kanban`):**
  - Tela completa de Kanban com colunas geradas a partir das Etiquetas/Estágios do WhatsApp + coluna "Sem Etiqueta / Novos".
  - **Drag & Drop nativo:** Arraste e solte o cartão do contato entre colunas para atualizar a etiqueta no banco e no WhatsApp em tempo real.
  - Cartões com foto de perfil, nome, telefone formatado, prévia da última mensagem, horário e botão direto **"Abrir Chat"** que navega para a conversa.
  - Menu de ação rápida para mover de etapa sem arrastar (ótimo para telas touch/mobile).
  - Modal para criar novas etapas do funil com seletor de cores da paleta oficial do WhatsApp.
  - Campo de busca instantânea no topo para filtrar contatos e mensagens em todas as colunas simultaneamente.
  - Link de acesso **"Kanban CRM"** integrado na barra lateral do painel (`SidebarNav`).
- **Respostas Rápidas com Variável Dinâmica `{nome}`:**
  - Ao selecionar um atalho digitando `/` (ex: `/ola`), a variável `{nome}` ou `{name}` é substituída automaticamente pelo primeiro nome do contato (`"Olá João! Tudo bem?..."`).
- **Som de Notificação WhatsApp Real:**
  - Melhorado o sintetizador de áudio Web Audio API com desbloqueio `ctx.resume()` e acorde duplo harmônico oficial (D5 587Hz ➔ A5 880Hz), garantindo que novas mensagens toquem com clareza mesmo com a aba em segundo plano.

### Resolução Definitiva de Áudio e Persistência Data URL (v1.6.23)
- **Persistência Dupla (Disco + Base64 Data URL no PostgreSQL):**
  - Mídias de áudio (notas de voz gravadas e recebidas via WhatsApp) de até 1MB agora são salvas tanto no disco permanente (`/app/data/media`) quanto diretamente como `data:audio/ogg;base64,...` no banco de dados na coluna `Message.mediaUrl`.
  - Isso garante **0ms de latência de reprodução**, independência completa de volume efêmero, reprodução garantida mesmo após rebuilds/deploys, e zero erros 404.
- **Volume Persistente no Railway (`zapflow-volume-XrQh`):**
  - Volume de dados dedicado montado em `/app/data`, garantindo que arquivos maiores que 1MB permaneçam salvos entre novas versões do container.
- **Tratamento Elegante no Player do Chat (`WhatsAppAudioPlayer`):**
  - Tratamento de erro aprimorado com indicador visual e toast amigável (`"Áudio indisponível ou expirado no servidor."`) caso um áudio antigo anterior à montagem do volume não exista no disco.
  - O botão de download e a transcrição ("Ler") verificam a integridade antes de disparar a ação, protegendo o usuário de falhas silenciosas.

### Migração de Alta Performance para PostgreSQL Nativo no Railway
- **Fim da Latência Externa e Cold Starts:**
  - Migrado do Neon Serverless para um serviço de **PostgreSQL 18.6 dedicado dentro da rede interna do Railway** (`postgres.railway.internal:5432`).
  - Latência entre o ZapFlow e o banco reduzida de ~80ms (com picos de 3s no cold start do Neon) para **< 2ms** em rede interna contínua.
  - Zero auto-suspend / sleep: o banco fica 100% ativo 24 horas por dia.
- **Migração Completa dos Dados com Zero Perda:**
  - Todos os dados foram migrados com integridade referencial: 1 Admin, 1 Sessão, **21.447 chaves de autenticação do WhatsApp (AuthState)**, **4.940 Contatos**, **171 Grupos**, **14.726 Mensagens** e 2.283 logs de disparos.
  - O banco Neon antigo permanece intacto como backup externo.

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
