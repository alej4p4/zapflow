# ZapFlow AI

Transforme seu WhatsApp Web em uma central de atendimento inteligente.

Extensão para Google Chrome que adiciona um painel ERP diretamente dentro do WhatsApp Web, com CRM, disparos de mensagens, captador de leads, funil de vendas, catálogo, respostas rápidas, IA integrada, relatórios e gestão de equipe.

## 📦 Instalação

### Opção A — Instalador automático (Windows)
1. Extraia o `ZapFlow-Instalador.zip`
2. Execute `Instalar-ZapFlow.bat`
3. Reinicie o Chrome
4. Acesse `chrome://extensions` e verifique se o **ZapFlow AI** está ativo

### Opção B — Manual (qualquer sistema)
1. Extraia o ZIP em uma pasta
2. Abra o Chrome em `chrome://extensions`
3. Ative o **Modo do desenvolvedor** (canto superior direito)
4. Clique em **Carregar sem compactação**
5. Selecione a pasta extraída

## 🚀 Como usar

1. Abra o WhatsApp Web: `web.whatsapp.com`
2. Um botão flutuante **ZF** aparecerá no canto inferior esquerdo
3. Clique no **ZF** para abrir o painel lateral do ZapFlow
4. Primeiro login: `admin` / Senha: `admin123`

## 📋 Módulos

| Módulo | Funcionalidade |
|--------|---------------|
| Dashboard | Indicadores gerais (clientes, leads, disparos) |
| WhatsApp | Conexão via QR Code e abrir WhatsApp Web |
| CRM | Cadastro de clientes (nome, telefone, empresa, cidade) |
| Disparos | Envio de mensagens com variáveis `{nome}`, `{empresa}`, `{cidade}` |
| Captador de Leads | Extração de números visíveis na tela do WhatsApp |
| Funil de Vendas | Leads com etapas e temperatura (Frio/Morno/Quente) |
| Catálogo | Produtos com preço e arquivo (imagem/PDF) |
| Respostas Rápidas | Atalhos tipo `/preco`, `/orcamento` |
| IA Integrada | Corrigir, reescrever, traduzir, gerar resposta, resumir (requer chave API) |
| Relatórios | Exportação CSV de clientes, funil e catálogo |
| Equipe | Login, controle de acesso, histórico, relatório por atendente |
| Grafo | Visualização de rede de clientes e leads do funil (via Graphify) |
| Configurações | Intervalo, limite por hora, anti-duplicidade, chave IA |

## 🛠️ Tecnologias

- Chrome Extensions Manifest V3
- JavaScript (ES6)
- localStorage (banco local do navegador)
- HTML/CSS puro (sem dependências externas)

## 🔐 Segurança

- Os dados ficam armazenados apenas no `localStorage` do navegador
- A chave de API da IA é salva localmente
- A extensão só tem permissão para acessar `web.whatsapp.com`

## 🔄 CI/CD (GitHub Actions)

Este projeto utiliza **GitHub Flow** para entrega contínua.

### Fluxo de trabalho

1. Crie uma branch isolada: `feature/nome` ou `fix/nome`
2. Faça suas alterações e abra um Pull Request
3. O PR deve obrigatoriamente referenciar uma Issue: `Fixes #123`
4. Após revisão e aprovação, faça o merge na `main`
5. Crie e push uma tag no formato `v*` para disparar o release automático:

```bash
git checkout main
git pull origin main
git tag -a v1.1.0 -m "Release v1.1.0"
git push origin v1.1.0
```

### Workflow (`.github/workflows/release.yml`)

- Disparado automaticamente ao enviar tag `v*`
- Roda em `ubuntu-latest` com Node 22
- Executa `npm ci` e `npm run build`
- Empacota a extensão em `ZapFlow-Extensao.zip`
- Publica o release no GitHub Releases via `softprops/action-gh-release@v2`

### Versionamento

Os seguintes arquivos devem ser incrementados juntos em cada release:

| Arquivo | Campo |
|---------|-------|
| `package.json` | `version` |
| `manifest.json` | `version` |
| `src/config/version.ts` | `APP_VERSION` / `APP_VERSION_CODE` |
| `public/update.json` | `version` / `versionCode` / `updateUrl` |

## 📄 Licença

MIT License

## 🤝 Contribuição

1. Faça um fork do repositório
2. Crie uma branch para sua feature (`git checkout -b feature/nome`)
3. Commit suas mudanças (`git commit -m 'feat: descrição'`)
4. Push para a branch (`git push origin feature/nome`)
5. Abra um Pull Request

## 📞 Suporte

Para dúvidas ou sugestões, abra uma Issue no GitHub.

---

**ZapFlow AI** — Transforme seu WhatsApp Web em uma central de atendimento inteligente.
