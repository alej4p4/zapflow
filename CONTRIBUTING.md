# Contribuição — ZapFlow AI

Este projeto segue o **GitHub Flow** rigorosamente, conforme arquitetura CineBG.

## 1. Nenhuma alteração direta na `main`

Todas as alterações devem ser feitas em branches isoladas:

- `feature/nome-da-feature` — novas funcionalidades
- `fix/nome-do-bug` — correções de bugs
- `hotfix/nome` — correções urgentes em produção

Exemplo:

```bash
git checkout -b feature/cadastro-clientes
```

## 2. Pull Requests devem referenciar uma Issue

Cada PR deve obrigatoriamente mencionar a Issue de referência usando palavras-chave do GitHub:

- `Fixes #123`
- `Closes #123`
- `Resolve #123`

Exemplo de descrição de PR:

```
Adiciona tela de cadastro de clientes no módulo CRM.

Fixes #42
```

O merge na branch `main` representa o código aprovado para entrega.

## 3. Incremento de versões

Ao gerar uma nova versão, os 4 arquivos abaixo devem ser incrementados juntos:

| Arquivo | Campo |
|---------|-------|
| `package.json` | `version` |
| `src/config/version.ts` | `APP_VERSION` / `APP_VERSION_CODE` |
| `public/update.json` | `version` / `versionCode` / `updateUrl` |
| `manifest.json` | `version` |

## 4. Disparo de release

Após o merge do PR na `main`, o responsável deve criar a tag localmente:

```bash
git checkout main
git pull origin main
git tag -a v1.1.0 -m "Release v1.1.0"
git push origin v1.1.0
```

O push da tag dispara automaticamente o workflow `.github/workflows/release.yml`, que:

1. Roda em `ubuntu-latest` com Node 22
2. Executa `npm ci` e `npm run build`
3. Empacota a extensão em `ZapFlow-Extensao.zip`
4. Publica o release no GitHub Releases com notas geradas pelo Git

## 5. Versionamento

Usamos [SemVer](https://semver.org/) (Major.Minor.Patch).

Exemplo: `v1.1.0`

## 6. Revisão de código

Todo PR precisa de pelo menos **1 aprovação** antes do merge na `main`.
