# WA-AKG para Windows

Gera um instalador desktop independente do Docker. O pacote inclui o servidor Node, SQLite e uma cópia dos dados do MySQL local.

## Gerar instalador

Com o Docker Desktop aberto e o banco `wa-akg-db` acessível em `localhost:3306`:

```powershell
npm run desktop:dist
```

O instalador fica em `release/WA-AKG Setup 1.6.18.exe`. A compilação exige conexão com a internet para baixar as dependências.

> O instalador contém uma cópia do banco de dados local. Não o compartilhe; ele pode incluir dados e credenciais da sua instalação.

O app instalado usa um banco próprio em `%APPDATA%\wa-akg\wa-akg.sqlite`; os registros e arquivos de log ficam nessa pasta. A instalação Docker original continua separada.
