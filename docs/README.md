# 📂 Índice da documentação

Bem-vindo à documentação do **WA-AKG**. Use os links abaixo para acessar os guias técnicos e de uso.

---

## 📘 Guias essenciais

| Documento | Finalidade |
| :--- | :--- |
| **[Documentação da API](./API_DOCUMENTATION.md)** | Referência da API REST e de seus endpoints. |
| **[Manual do usuário](./USER_GUIDE.md)** | Instruções para usar os recursos do painel. |
| **[Arquitetura do projeto](./PROJECT_DOCUMENTATION.md)** | Lógica do sistema, diagramas e esquema do banco de dados. |
| **[Configuração do ambiente](./ENVIRONMENT_VARIABLES.md)** | Configuração segura e instalação do servidor. |

---

## 🛠️ Infraestrutura e manutenção

- **[Configuração do banco de dados](./DATABASE_SETUP.md)**: migrações do esquema e configuração do banco.
- **[Guia de atualização](./UPDATE_GUIDE.md)**: como sincronizar atualizações e aplicar correções.
- **[Referência rápida](./API-QUICK-REFERENCE.md)**: exemplos cURL e formatos JID.

---

## 🚦 Primeiros passos com a API

1. **Autenticação**: gere uma chave nas configurações do painel e envie-a no cabeçalho `X-API-Key`.
2. **Sessão**: crie uma em `/api/sessions` e escaneie o QR Code pelo WhatsApp.
3. **Automação**: cadastre uma URL em `/api/webhooks` para receber eventos.

> [!IMPORTANT]
> Configure `AUTH_SECRET` no arquivo `.env` antes de iniciar o aplicativo.

---
<div align="center">
  **Version**: 1.6.1 | **Build Status**: Stable
</div>
