# 📖 Manual do WA-AKG

Bem-vindo ao manual do **WA-AKG**. Aqui você encontra instruções para usar os recursos do painel.

---

## 🚀 Início rápido: conectando o WhatsApp

Antes de usar as automações, conecte uma conta do WhatsApp.

1.  **Crie uma sessão**: acesse **Sessões / QR** e clique em **Criar nova sessão**.
2.  **Dê um nome**: informe um nome para identificar a sessão, por exemplo `vendas`.
3.  **Inicie a sessão**: abra a sessão criada e clique em **Iniciar sessão**. O QR Code será exibido.
4.  **Escaneie o QR Code**: no celular, abra o WhatsApp > **Aparelhos conectados** > **Conectar aparelho** e escaneie o código.
5.  **Aguarde a conexão**: quando o status mostrar `CONNECTED`, a sessão está pronta. Selecione-a no menu superior para usá-la.

---

## 💬 Recursos de mensagens

### 1. Conversas em tempo real
- Acesse **Conversas** para ver seus chats recentes.
- Envie mensagens de texto e imagens.
- Use **Nova conversa** para falar com um número que ainda não aparece no histórico.

### 2. Agendamento
- Acesse **Agendamentos** e crie um novo agendamento.
- **Mensagem**: aceita texto com várias linhas.
- **Mídia**: envie imagens, vídeos ou documentos por URL.
- **Horário**: os envios usam o fuso horário configurado.

### 3. Respostas automáticas
- Acesse **Respostas automáticas** e crie regras por palavra-chave.
- **Tipos de correspondência**:
  - `EXACT`: correspondência exata.
  - `CONTAINS`: a palavra aparece em qualquer parte da mensagem.
  - `STARTS_WITH`: a mensagem começa com a palavra.
- **Mídia**: envie imagens ou vídeos informando uma URL direta.
- **Contexto**: escolha entre todas as conversas, somente conversas privadas ou somente grupos.

---

## 📢 Comunicação em massa

### 1. Disparos em massa
- Envie mensagens para vários números ou grupos.
- **Intervalos entre envios**: configure atrasos para espaçar as mensagens. Isso não garante que uma conta não seja limitada pelo WhatsApp.
- **Destinatários**: cole números separados por vírgula ou selecione um grupo sincronizado.

### 2. Gerenciamento de grupos
- Veja os grupos da sessão na aba **Grupos**.
- Sincronize os participantes para armazená-los no banco local.

---

## 🛠️ Ferramentas

### 1. Contatos
- Pesquise os contatos sincronizados.
- Filtre por nome, telefone ou JID.
- Consulte detalhes como foto do perfil e informações de privacidade.

### 2. Criador de figurinhas
- Envie uma imagem para convertê-la em figurinha do WhatsApp.
- Ative **Remover fundo** se tiver configurado uma chave de API compatível.

---

## ⚙️ Configurações

Na página **Configurações**, você pode personalizar:
- **Identidade visual**: nome e logotipo do painel.
- **Controle de acesso**: listas de permissão ou bloqueio para comandos do bot e respostas automáticas.
- **Fuso horário**: escolha um fuso IANA para que os agendamentos sejam enviados no horário local correto.
- **Chaves de API**: gerencie credenciais para integrações externas.

---

## 🔒 Segurança

- **Chave de API**: guarde-a em local seguro e não a envie ao Git.
- **Acesso por função**: `SUPERADMIN` (acesso total), `OWNER` (gerencia suas sessões), `STAFF` (acesso limitado).
- **Compartilhamento**: responsáveis podem compartilhar sessões com atendentes sem conceder permissão para excluir.
- **Senhas**: são armazenadas com hash bcrypt.
- **Swagger UI**: use uma senha forte na variável `NEXT_PUBLIC_SWAGGER_PASSWORD` do `.env` antes de expor o serviço.

---
<div align="center">
  **Version**: 1.6.1 | **Support**: [GitHub Issues](https://github.com/mrifqidaffaaditya/WA-AKG/issues)
</div>
