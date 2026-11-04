const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
const templateDir = path.join(root, "desktop", "template");
const databaseFile = path.join(templateDir, "wa-akg.sqlite");
const envText = fs.readFileSync(path.join(root, ".env"), "utf8");

function envValue(name, fallback) {
  const match = envText.match(new RegExp(`^${name}=(?:"([^"]*)"|'([^']*)'|([^\\r\\n]*))`, "m"));
  return match ? (match[1] ?? match[2] ?? match[3]).trim() : fallback;
}

function run(executable, args, extraEnv = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function installTurbopackAliases() {
  const chunks = path.join(root, ".next", "server", "chunks");
  const aliasRoot = path.join(root, "desktop", "turbopack-aliases");
  const aliasPattern = /(?:require|\.y)\(["']((?:@[^/"']+\/)?[^/"']+)-([a-f0-9]{16})["']\)/g;
  const files = fs.readdirSync(chunks, { recursive: true }).filter((file) => file.endsWith(".js"));
  const aliases = new Map();

  for (const file of files) {
    const content = fs.readFileSync(path.join(chunks, file), "utf8");
    for (const match of content.matchAll(aliasPattern)) aliases.set(`${match[1]}-${match[2]}`, match[1]);
  }

  fs.rmSync(aliasRoot, { recursive: true, force: true });
  for (const [alias, target] of aliases) {
    const directory = path.join(aliasRoot, ...alias.split("/"));
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: alias, main: "index.js" }));
    fs.writeFileSync(path.join(directory, "index.js"), `module.exports = require(${JSON.stringify(target)});\n`);
  }
}

if (!envValue("MYSQL_ROOT_PASSWORD")) throw new Error("MYSQL_ROOT_PASSWORD is missing from .env.");

fs.mkdirSync(templateDir, { recursive: true });
fs.mkdirSync(path.join(root, "desktop", "runtime"), { recursive: true });
fs.copyFileSync(process.execPath, path.join(root, "desktop", "runtime", "node.exe"));

const databaseUrl = `file:${databaseFile.replace(/\\/g, "/")}`;
const mysqlDatabase = envValue("MYSQL_DATABASE", "wa_akg");
const mysqlUrl = `mysql://root:${encodeURIComponent(envValue("MYSQL_ROOT_PASSWORD"))}@127.0.0.1:3306/${mysqlDatabase}`;
const environment = {
  WA_AKG_DESKTOP: "1",
  DATABASE_URL: databaseUrl,
  DESKTOP_DATABASE_URL: databaseUrl,
  MYSQL_DATABASE_URL: mysqlUrl,
  AUTH_SECRET: crypto.randomBytes(32).toString("hex"),
  BASE_URL: "http://127.0.0.1:3020",
  NEXTAUTH_URL: "http://127.0.0.1:3020",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3020",
  NEXT_PUBLIC_API_URL: "http://127.0.0.1:3020/api",
  PORT: "3020",
  HOSTNAME: "127.0.0.1",
  NODE_ENV: "production",
};

run(process.execPath, [prismaCli, "generate", "--schema", "prisma/schema.desktop.prisma"]);
run(process.execPath, [prismaCli, "generate", "--schema", "prisma/schema.mysql.prisma"]);
run(process.execPath, [prismaCli, "db", "push", "--schema", "prisma/schema.desktop.prisma"], environment);
if (!fs.existsSync(databaseFile)) {
  run(process.execPath, [path.join(root, "scripts", "migrate-desktop-db.cjs")], environment);
} else {
  console.log("Using the existing desktop database template; source data was not overwritten.");
}
run(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "build"], environment);
installTurbopackAliases();

console.log("Desktop build prepared. Create the Windows installer with npm run desktop:dist.");
