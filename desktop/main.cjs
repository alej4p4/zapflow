const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const port = 3020;
const url = `http://127.0.0.1:${port}`;
let server;

function requestReady() {
  return new Promise((resolve) => {
    const req = http.get(`${url}/auth/login`, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => req.destroy());
  });
}

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    if (await requestReady()) return;
    if (server.exitCode !== null) throw new Error("O servidor do WA-AKG foi encerrado.");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("O servidor do WA-AKG não iniciou após 120 segundos. Consulte desktop.log na pasta de dados do app.");
}

async function openApp() {
  const root = app.getAppPath();
  const dataDir = app.getPath("userData");
  const dbFile = path.join(dataDir, "wa-akg.sqlite");
  const configFile = path.join(dataDir, "desktop-secret");
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbFile)) {
    const template = app.isPackaged
      ? path.join(process.resourcesPath, "wa-akg.sqlite")
      : path.join(root, "desktop", "template", "wa-akg.sqlite");
    fs.copyFileSync(template, dbFile);
  }

  let secret;
  try {
    secret = fs.readFileSync(configFile, "utf8");
  } catch {
    secret = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(configFile, secret, { mode: 0o600 });
  }

  const node = app.isPackaged
    ? path.join(process.resourcesPath, "node.exe")
    : process.env.WA_AKG_NODE_PATH || process.execPath;
  const logFile = path.join(dataDir, "desktop.log");
  // Rotação simples: passou de 5 MB, guarda uma cópia anterior.
  try {
    if (fs.statSync(logFile).size > 5 * 1024 * 1024) {
      const oldLog = `${logFile}.1`;
      if (fs.existsSync(oldLog)) fs.unlinkSync(oldLog);
      fs.renameSync(logFile, oldLog);
    }
  } catch { /* primeiro uso */ }
  const log = fs.createWriteStream(logFile, { flags: "a" });
  server = spawn(node, [
    path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(root, "src", "server", "index.ts"),
  ], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      WA_AKG_DESKTOP: "1",
      WA_AKG_DATA_DIR: path.join(dataDir, "data"),
      DATABASE_URL: `file:${dbFile.replace(/\\/g, "/")}`,
      AUTH_SECRET: secret,
      BASE_URL: url,
      NEXTAUTH_URL: url,
      NEXT_PUBLIC_APP_URL: url,
      NEXT_PUBLIC_API_URL: `${url}/api`,
      TZ: "America/Sao_Paulo",
      LOCALE: "pt-BR",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  server.on("error", (error) => log.write(`${error.stack || error}\n`));

  await waitForServer();
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 650,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await window.loadURL(`${url}/auth/login`);
}

// Instância única: duas cópias do app abririam dois sockets WhatsApp com as
// mesmas credenciais e o WhatsApp derrubaria um com "conflict/replaced".
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(openApp).catch((error) => {
    dialog.showErrorBox("Não foi possível iniciar o WA-AKG", error.message);
    app.quit();
  });

  app.on("before-quit", () => server?.kill());
  app.on("window-all-closed", () => app.quit());
}
