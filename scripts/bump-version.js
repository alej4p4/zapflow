/**
 * bump-version.js
 * Incrementa a versão em sincronia nos 4 arquivos obrigatórios:
 *   - package.json (campo version)
 *   - manifest.json (campo version)
 *   - src/config/version.ts (APP_VERSION / APP_VERSION_CODE)
 *   - public/update.json (version / versionCode / updateUrl)
 *
 * Uso: node scripts/bump-version.js <nova-versao>
 * Exemplo: node scripts/bump-version.js 1.2.1
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const arquivos = {
  packageJson: path.join(ROOT, 'package.json'),
  manifestJson: path.join(ROOT, 'manifest.json'),
  versionTs: path.join(ROOT, 'src', 'config', 'version.ts'),
  updateJson: path.join(ROOT, 'public', 'update.json')
};

function lerJson(caminho) {
  return JSON.parse(fs.readFileSync(caminho, 'utf8'));
}

function gravarJson(caminho, obj) {
  fs.writeFileSync(caminho, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function novaVersaoCode(versao) {
  // Converte 1.2.1 -> 10201 (major*10000 + minor*100 + patch)
  const partes = versao.split('.').map(Number);
  const major = partes[0] || 0;
  const minor = partes[1] || 0;
  const patch = partes[2] || 0;
  return major * 10000 + minor * 100 + patch;
}

function main() {
  const novaVersao = process.argv[2];
  if (!novaVersao || !/^\d+\.\d+\.\d+$/.test(novaVersao)) {
    console.error('Uso: node scripts/bump-version.js <MAJOR.MINOR.PATCH>');
    process.exit(1);
  }

  const versionCode = novaVersaoCode(novaVersao);

  // 1. package.json
  const pkg = lerJson(arquivos.packageJson);
  pkg.version = novaVersao;
  gravarJson(arquivos.packageJson, pkg);

  // 2. manifest.json
  const mf = lerJson(arquivos.manifestJson);
  mf.version = novaVersao;
  gravarJson(arquivos.manifestJson, mf);

  // 3. src/config/version.ts
  const tsContent = `export const APP_VERSION = '${novaVersao}';\nexport const APP_VERSION_CODE = ${versionCode};\nexport const SCHEMA_VERSION = 1;\n`;
  fs.writeFileSync(arquivos.versionTs, tsContent, 'utf8');

  // 4. public/update.json
  const upd = lerJson(arquivos.updateJson);
  upd.version = novaVersao;
  upd.versionCode = versionCode;
  upd.updateUrl = upd.updateUrl.replace(/\/v\d+\.\d+\.\d+\//, `/v${novaVersao}/`);
  gravarJson(arquivos.updateJson, upd);

  console.log(`✓ Versão sincronizada para ${novaVersao} (code ${versionCode})`);
  console.log('  - package.json');
  console.log('  - manifest.json');
  console.log('  - src/config/version.ts');
  console.log('  - public/update.json');
}

main();
