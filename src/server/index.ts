import { loadEnvConfig } from "@next/env";
// Load environment variables before any other imports/logic
loadEnvConfig(process.cwd());

import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { Server } from "socket.io";
import { setupSocket } from "./socket";
import { waManager } from "../modules/whatsapp/manager";
import { logger } from "../lib/logger";
import pkg from "../../package.json";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || "3030", 10);

if (!process.env.AUTH_SECRET) {
  logger.error("Server", "AUTH_SECRET is not set. Generate one with: openssl rand -base64 32");
  process.exit(1);
}

const app = next({ dev, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      if (!req.url) return;
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      logger.error("Server", "Error handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  const io = new Server(server, {
    path: "/api/socket/io",
    addTrailingSlash: false,
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  setupSocket(io);
  // Optional: Global instance for Baileys to emit events
  (global as any).io = io;

  // Initialize WhatsApp Manager
  waManager.setup(io);
  waManager.loadSessions().catch(e => logger.error("Server", "loadSessions error:", e));

  // Disparos que ficaram "em andamento" por causa de um reinício viram "interrompido"
  import("../modules/whatsapp/broadcast-runner")
    .then(m => m.markStaleBroadcasts())
    .catch(e => logger.error("Server", "markStaleBroadcasts error:", e));

  // Garante coluna de agendamento no banco existente (idempotente)
  import("../modules/whatsapp/broadcast-runner")
    .then(m => m.ensureScheduledColumn())
    .catch(e => logger.error("Server", "ensureScheduledColumn error:", e));

  // Processa disparos agendados a cada 30 s
  import("../modules/whatsapp/broadcast-runner")
    .then(m => m.startBroadcastScheduler())
    .catch(e => logger.error("Server", "startBroadcastScheduler error:", e));

  // Backup diário do banco (mantém os 7 últimos)
  import("../modules/backup/backup")
    .then(m => m.startBackups())
    .catch(e => logger.error("Server", "startBackups error:", e));

  // Limpeza de mídia antiga (180 dias, configurável em MEDIA_RETENTION_DAYS)
  import("../modules/maintenance/cleanup")
    .then(m => m.startCleanup())
    .catch(e => logger.error("Server", "startCleanup error:", e));

  // Start Scheduler
  import("../modules/whatsapp/scheduler")
    .then(m => m.startScheduler())
    .catch(e => logger.error("Server", "startScheduler error:", e));

  // Cloudflare 520 Fix: increase keep-alive timeout so Node doesn't kill idle connections that Cloudflare expects to reuse
  // See: https://github.com/vercel/next.js/issues/48962
  server.keepAliveTimeout = 120 * 1000; // 120 seconds
  server.headersTimeout = 120 * 1000; // 120 seconds

  server.listen(port, hostname, () => {
    logger.banner(pkg.name.toUpperCase(), pkg.version, port);
  });

  // Graceful shutdown on SIGTERM / SIGINT
  let isShuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info("Server", `Recebido sinal ${signal}. Encerrando com segurança...`);

    try {
      await waManager.shutdownAll();
      server.close(() => {
        logger.success("Server", "Servidor HTTP e WebSocket encerrados.");
        process.exit(0);
      });

      // Force exit after 10s if connections linger
      setTimeout(() => {
        logger.warn("Server", "Encerramento forçado após timeout.");
        process.exit(0);
      }, 10000).unref();
    } catch (err) {
      logger.error("Server", "Erro durante encerramento:", err);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
});
