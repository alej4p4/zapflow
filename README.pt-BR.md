# WA-AKG — guia em português do Brasil

Gateway local do WhatsApp com painel, sessões, conversas, automações e API.

## Aplicativo desktop para Windows

O instalador independente fica em `release/WA-AKG Setup 1.6.18.exe`. Ele inclui o servidor e o banco SQLite; depois da instalação, o Docker não é necessário.

O instalador gerado nesta cópia do projeto leva junto uma cópia do banco atual. **Não compartilhe esse instalador**, pois ele contém dados e a conta administrativa desta instalação.

## Primeira conexão com o WhatsApp

1. Abra o WA-AKG e entre com a conta administrativa existente.
2. Acesse **Sessões / QR** e crie uma sessão.
3. O WA-AKG inicia a sessão e abre a tela de conexão.
4. No celular, abra WhatsApp → **Aparelhos conectados** → **Conectar aparelho** e escaneie o QR Code.
5. Aguarde o status **Conectada**. A sessão e as credenciais ficam no banco local.

O app desktop guarda os dados em `%APPDATA%\wa-akg\wa-akg.sqlite`. Faça backup desse arquivo para preservar usuários, sessões e credenciais do WhatsApp.

## Gerar uma nova versão

Com Node.js 22 instalado, rode no PowerShell:

```powershell
npm run desktop:dist
```

Para copiar os dados MySQL atuais durante a geração, o banco Docker da instalação original deve estar acessível em `localhost:3306`. Depois de gerado, o aplicativo instalado funciona sem Docker.

## Observação

A API REST e o Swagger mantêm nomes de endpoints, métodos HTTP e exemplos técnicos em inglês para preservar compatibilidade com integrações. A interface e o manual do usuário estão em português do Brasil.
