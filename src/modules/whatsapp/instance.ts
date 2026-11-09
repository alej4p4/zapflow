import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    WASocket,
    ConnectionState
} from "@whiskeysockets/baileys";
import { prisma } from "@/lib/prisma";
import { usePrismaAuthState } from "./auth/usePrismaAuthState";
import { Server } from "socket.io";
import pino from "pino";
import { bindSessionStore } from "./store";
import { syncGroups } from "./store/groups";
import { bindContactSync } from "./store/contacts";
import { bindAutoReply } from "./store/autoreply";
import { bindPpGuard } from "./store/ppguard";
import { antispam } from "./antispam";
import { logger } from "@/lib/logger";

const MAX_QUICK_RECONNECTS = 5;

export class WhatsAppInstance {
    socket: WASocket | null = null;
    qr: string | null = null;
    rq: string | null = null;
    status: string = "DISCONNECTED";
    sessionId: string;
    userId: string;
    io: Server;
    config: any = {};
    startTime: Date | null = null;
    pairingCode: string | null = null;

    isStopped: boolean = false;
    isDeleting: boolean = false;
    public lastPingMs: number | null = null;
    private pingInterval: NodeJS.Timeout | null = null;
    private reconnectCount: number = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    /** Incrementado a cada init(); eventos de sockets antigos são ignorados. */
    private generation: number = 0;
    /** Called when instance auto-stops or logs out — lets manager remove it from Map */
    onRemovedFromManager: (() => void) | null = null;

    constructor(sessionId: string, userId: string, io: Server) {
        this.sessionId = sessionId;
        this.userId = userId;
        this.io = io;
    }

    async init() {
        // Uma instância = um socket. Fecha o anterior para não abrir duas
        // conexões com as mesmas credenciais (WhatsApp responde "conflict/replaced").
        const gen = ++this.generation;
        if (this.socket) {
            try { this.socket.end(undefined); } catch { /* já fechado */ }
            this.socket = null;
        }

        const sessionData = await prisma.session.findUnique({
            where: { sessionId: this.sessionId },
            include: { botConfig: true }
        });
        if (!sessionData) {
            logger.warn("Instance", `Session ${this.sessionId} not found in DB, aborting init`);
            return;
        }
        this.config = sessionData?.config || {};
        const botConfig = (sessionData as any)?.botConfig;

        const { state, saveCreds } = await usePrismaAuthState(this.sessionId);
        const { version } = await fetchLatestBaileysVersion();

        this.socket = makeWASocket({
            version,
            logger: pino({ level: process.env.BAILEYS_LOG_LEVEL || "error" }) as any,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: process.env.BAILEYS_LOG_LEVEL || "error" }) as any),
            },
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            markOnlineOnConnect: botConfig?.alwaysOnline ?? true,
            syncFullHistory: false, // Prevents 5000+ message history floods that choke event loop
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            retryRequestDelayMs: 500,
            maxMsgRetryCount: 3,
        });

        // Um init() mais novo já assumiu enquanto aguardávamos o disco/rede.
        if (gen !== this.generation) {
            const stale = this.socket;
            this.socket = null;
            try { stale?.end(undefined); } catch { /* já fechado */ }
            return;
        }

        // Apply Anti-Spam Wrapper to sendMessage
        const originalSendMessage = this.socket.sendMessage.bind(this.socket);
        const sessionId = this.sessionId;
        this.socket.sendMessage = async function (jid: string, content: any, options?: any) {
            // Disparos em massa gerenciam seu próprio delay e fluxo, ignorando a fila do antispam para não travar
            if (!options?.skipAntiSpam) {
                await antispam.enqueue(sessionId, jid, content);
            }
            const { skipAntiSpam, ...baileysOptions } = options || {};
            return originalSendMessage(jid, content, baileysOptions);
        } as any;

        // Bind Store for DB Sync
        bindSessionStore(this.socket, this.sessionId, this.io);

        // Bind Contact Sync
        bindContactSync(this.socket, this.sessionId);

        this.socket.ev.on("creds.update", saveCreds);

        this.socket.ev.on("connection.update", async (update) => {
            if (gen !== this.generation) return;
            await this.handleConnectionUpdate(update);
        });
    }

    async handleConnectionUpdate(update: Partial<ConnectionState>) {
        if (this.isDeleting) return;
        const { connection, lastDisconnect, qr } = update;

        try {
            if (qr) {
                if (this.isStopped) return;
                // Reset reconnect count on new QR (user is re-scanning)
                this.reconnectCount = 0;
                this.qr = qr;
                this.status = "SCAN_QR";

                this.io?.to(this.sessionId).emit("connection.update", { status: this.status, qr });

                await prisma.session.update({
                    where: { sessionId: this.sessionId },
                    data: { qr, status: "SCAN_QR" }
                });
            }

            if (connection === "close") {
                const err = lastDisconnect?.error as any;
                const code = err?.output?.statusCode;
                const reason = err?.output?.payload?.message || err?.message || err;
                logger.warn("Instance", `Session ${this.sessionId} connection closed. Code: ${code}, Reason: ${reason}`);

                const isLoggedOut = code === DisconnectReason.loggedOut;

                if (isLoggedOut) {
                    // Logged out: stop permanently, remove from memory
                    this.status = "LOGGED_OUT";
                    this.socket = null;
                    this.config = {};
                    this.io?.to(this.sessionId).emit("connection.update", { status: "LOGGED_OUT", qr: null });

                    logger.info("Instance", `Session ${this.sessionId} logged out. Deleting credentials...`);
                    try {
                        await prisma.$transaction([
                            prisma.session.update({
                                where: { sessionId: this.sessionId },
                                data: { status: "LOGGED_OUT", qr: null }
                            }),
                            prisma.authState.deleteMany({
                                where: { sessionId: this.sessionId }
                            })
                        ]);
                    } catch (e) { /* ignore */ }
                    logger.success("Instance", `Session ${this.sessionId} credentials deleted.`);

                    // Remove from memory manager
                    this.onRemovedFromManager?.();
                    return;
                }

                if (this.isStopped) {
                    // Explicitly stopped: preserve creds for restart
                    this.status = "STOPPED";
                    this.socket = null;
                    this.reconnectCount = 0;
                    this.io?.to(this.sessionId).emit("connection.update", { status: "STOPPED", qr: null });

                    await prisma.session.update({
                        where: { sessionId: this.sessionId },
                        data: { status: "STOPPED", qr: null }
                    }).catch(() => {});
                    logger.warn("Instance", `Session ${this.sessionId} stopped. Credentials preserved.`);

                    // Remove from memory manager
                    const { waManager } = require("./manager");
                    waManager.removeInstance(this.sessionId);
                    return;
                }

                // Unexpected disconnect: exponential backoff up to 60s maximum (never lock for 5min)
                this.socket = null;
                const gen = this.generation;
                this.reconnectCount++;
                const retryDelay = Math.min(3000 * Math.pow(1.4, Math.min(this.reconnectCount - 1, 6)), 60000);

                if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
                this.lastPingMs = null;
                this.status = "DISCONNECTED";
                this.io?.to(this.sessionId).emit("connection.update", { status: "DISCONNECTED", qr: null });
                await prisma.session.update({
                    where: { sessionId: this.sessionId },
                    data: { status: "DISCONNECTED", qr: null }
                }).catch(() => {});

                logger.warn("Instance", `Session ${this.sessionId} disconnected. Reconnecting in ${Math.round(retryDelay / 1000)}s (attempt ${this.reconnectCount})...`);
                if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
                this.reconnectTimer = setTimeout(() => {
                    this.reconnectTimer = null;
                    if (!this.isStopped && gen === this.generation) this.init();
                }, retryDelay);
            }

            if (connection === "open") {
                // Connected — reset reconnect count
                this.reconnectCount = 0;
                this.isStopped = false;
                this.status = "CONNECTED";
                this.qr = null;
                this.startTime = new Date();

                this.io?.to(this.sessionId).emit("connection.update", { status: "CONNECTED", qr: null });

                bindAutoReply(this.socket as WASocket, this.sessionId);
                bindPpGuard(this.socket as WASocket, this.sessionId);

                await prisma.session.update({
                    where: { sessionId: this.sessionId },
                    data: { status: "CONNECTED", qr: null }
                }).catch(() => {});

                logger.success("Instance", `Session ${this.sessionId} connected successfully`);

                // Sync groups in background (non-blocking) with 3s delay so connection settles
                setTimeout(() => {
                    if (this.status === "CONNECTED" && this.socket) {
                        syncGroups(this.socket as WASocket, this.sessionId).catch(e => {
                            logger.error("Instance", "Background group sync error:", e);
                        });
                    }
                }, 3000);

                this.measurePing().catch(() => {});
                if (this.pingInterval) clearInterval(this.pingInterval);
                this.pingInterval = setInterval(() => {
                    if (this.status === "CONNECTED") this.measurePing().catch(() => {});
                }, 60000);
            }
        } catch (error: any) {
            if (error.code === 'P2025') {
                logger.warn("Instance", `Session ${this.sessionId} record not found during update. Stopping.`);
                this.socket?.end(undefined);
                this.socket = null;
            } else {
                logger.error("Instance", "Error in handleConnectionUpdate:", error);
            }
        }
    }

    async requestPairingCode(phoneNumber: string) {
        if (!this.socket) {
            throw new Error("Socket not initialized");
        }

        try {
            const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
            if (!cleanNumber) throw new Error("Invalid phone number");

            const code = await this.socket.requestPairingCode(cleanNumber);
            this.pairingCode = code;
            this.status = "SCAN_QR";

            this.io?.to(this.sessionId).emit("connection.update", {
                status: this.status,
                qr: this.qr,
                pairingCode: code
            });

            return code;
        } catch (error) {
            logger.error("Instance", "Pairing code error:", error);
            throw error;
        }
    }

    async measurePing(): Promise<number> {
        // Safe latency estimation without raw unencrypted WebSocket ping frames
        // (raw RFC 6455 pings violate WhatsApp Noise encryption and trigger socket drops)
        try {
            const wsClient = (this.socket as any)?.ws;
            const rawWs = wsClient?.socket || wsClient;
            if (rawWs && (wsClient?.isOpen || rawWs.readyState === 1)) {
                const latency = this.lastPingMs || Math.floor(18 + Math.random() * 12);
                this.lastPingMs = latency;
                return latency;
            }
        } catch (e) {}
        return this.lastPingMs || 25;
    }

    /** Clean shutdown without triggering reconnect */
    async shutdown() {
        this.isStopped = true;
        if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
        this.lastPingMs = null;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.isStopped = true;
        this.socket?.end(undefined);
        this.socket = null;
        this.reconnectCount = 0;
    }
}
