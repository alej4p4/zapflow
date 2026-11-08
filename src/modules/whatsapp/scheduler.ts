import { prisma } from "@/lib/prisma";
import { waManager } from "./manager";
import { logger } from "@/lib/logger";
import path from "path";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { mediaDir } from "@/lib/paths";

/** Evita disparo duplo se dois ticks do agendador se sobrepuserem. */
const inFlight = new Set<string>();
const MAX_ATTEMPTS = 3;

/** Monta o conteúdo da mensagem (texto ou mídia de URL). */
async function buildContent(msg: any): Promise<any> {
    if (msg.mediaUrl) {
        let buffer: Buffer;
        const type = msg.mediaType || "image";

        if (msg.mediaUrl.startsWith("data:")) {
            const cleanBase64 = msg.mediaUrl.replace(/^data:[^;]+;base64,/, "");
            buffer = Buffer.from(cleanBase64, "base64");
        } else if (msg.mediaUrl.startsWith("/api/media/") || (!msg.mediaUrl.startsWith("http://") && !msg.mediaUrl.startsWith("https://"))) {
            const filename = path.basename(msg.mediaUrl);
            const filePath = path.join(mediaDir, filename);
            if (existsSync(filePath)) {
                buffer = await readFile(filePath);
            } else {
                throw new Error(`Arquivo de mídia não encontrado no disco: ${filename}`);
            }
        } else {
            const res = await fetch(msg.mediaUrl);
            if (!res.ok) throw new Error(`Falha ao baixar mídia: ${res.status} ${res.statusText}`);
            buffer = Buffer.from(await res.arrayBuffer());
        }

        if (type === "video") return { video: buffer, caption: msg.content };
        if (type === "audio") return { audio: buffer, mimetype: "audio/mp4", ptt: false };
        if (type === "document")
            return { document: buffer, caption: msg.content, fileName: path.basename(msg.mediaUrl) || "arquivo", mimetype: "application/octet-stream" };
        return { image: buffer, caption: msg.content };
    }
    return { text: msg.content };
}

const checkScheduledMessages = async () => {
    try {
        const now = new Date();
        logger.debug("Scheduler", `Checando mensagens devidas antes de ${now.toISOString()}...`);

        const pendingMessages = await prisma.scheduledMessage.findMany({
            where: {
                status: "PENDING",
                sendAt: { lte: now }
            },
            orderBy: { sendAt: "asc" }
        });

        if (pendingMessages.length > 0) {
            logger.info("Scheduler", `${pendingMessages.length} mensagem(ões) devida(s).`);
        }

        for (const msg of pendingMessages) {
            // Mesmo que o app reinicie, mensagens com erro de rede ficam PENDING e voltam aqui.
            if (inFlight.has(msg.id)) continue;
            inFlight.add(msg.id);

            try {
                const instance = waManager.getInstance(msg.sessionId);
                if (!instance?.socket) {
                    logger.warn("Scheduler", `Sessão ${msg.sessionId} desconectada: msg ${msg.id} continua pendente`);
                    continue;
                }

                let lastError: string | null = null;
                let sent = false;

                for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                    try {
                        const content = await buildContent(msg);
                        await instance.socket.sendMessage(msg.jid, content);
                        sent = true;
                        break;
                    } catch (err: any) {
                        lastError = err?.message || String(err);
                        logger.warn("Scheduler", `Msg ${msg.id} tentativa ${attempt}/${MAX_ATTEMPTS} falhou: ${lastError}`);
                        if (attempt < MAX_ATTEMPTS) {
                            await new Promise(r => setTimeout(r, attempt * 10000)); // 10s, 20s
                        }
                    }
                }

                if (sent) {
                    await prisma.scheduledMessage.update({
                        where: { id: msg.id },
                        data: { status: "SENT" }
                    });
                    logger.success("Scheduler", `Msg ${msg.id} enviada para ${msg.jid}`);
                } else {
                    await prisma.scheduledMessage.update({
                        where: { id: msg.id },
                        data: { status: "FAILED" }
                    });
                    logger.error("Scheduler", `Msg ${msg.id} falhou após ${MAX_ATTEMPTS} tentativas (${lastError})`);
                }
            } finally {
                inFlight.delete(msg.id);
            }
        }
    } catch (e) {
        logger.error("Scheduler", "Erro no loop do agendador:", e);
    }
};

export function startScheduler() {
    logger.info("Scheduler", "Iniciando Agendador de Mensagens...");

    // Executa imediatamente ao iniciar
    checkScheduledMessages();

    // Depois roda a cada 30 segundos
    setInterval(checkScheduledMessages, 30 * 1000);
}
