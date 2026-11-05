import { prisma } from "@/lib/prisma";
import { waManager } from "./manager";
import { logger } from "@/lib/logger";
import type { AnyMessageContent } from "@whiskeysockets/baileys";

const cancelled = new Set<string>();
const active = new Set<string>();

// FIFO queue per session: sessionId -> array of logId
const sessionQueues = new Map<string, string[]>();
const sessionActiveLog = new Map<string, string | null>();

export function cancelBroadcast(logId: string): boolean {
    cancelled.add(logId);

    // If waiting in session queue, remove and mark cancelled
    for (const [sessId, q] of sessionQueues.entries()) {
        const idx = q.indexOf(logId);
        if (idx !== -1) {
            q.splice(idx, 1);
            void prisma.broadcastLog.update({
                where: { id: logId },
                data: { status: "cancelled", completedAt: new Date() }
            }).catch(() => {});
            const io = (global as any).io;
            try {
                io?.to(sessId).emit("broadcast.progress", {
                    broadcastId: logId,
                    status: "cancelled",
                    message: "Disparo cancelado da fila"
                });
            } catch {}
            return true;
        }
    }

    return active.has(logId);
}

export function isBroadcastActive(logId: string): boolean {
    return active.has(logId);
}

export function isSessionBroadcasting(sessionId: string): boolean {
    return !!sessionActiveLog.get(sessionId);
}

/** Marca como interrompidos os disparos que ficaram "running" após um reinício. */
export async function markStaleBroadcasts() {
    try {
        const result = await prisma.broadcastLog.updateMany({
            where: { status: "running" },
            data: { status: "interrupted", completedAt: new Date() }
        });
        if (result.count > 0) {
            logger.warn("Broadcast", `${result.count} disparo(s) marcado(s) como interrompido(s) após reinício`);
        }
    } catch (e) {
        logger.error("Broadcast", "Falha ao marcar disparos interrompidos", e);
    }
}

/**
 * Enfileira um disparo na fila sequencial da sessão.
 * Disparos automáticos e manuais rodam estritamente UM ATRÁS DO OUTRO EM SEQUÊNCIA.
 */
export async function runBroadcast(logId: string): Promise<void> {
    const log = await prisma.broadcastLog.findUnique({
        where: { id: logId },
        select: { sessionId: true, status: true, total: true, sent: true, failed: true }
    });
    if (!log) return;

    if (!sessionQueues.has(log.sessionId)) {
        sessionQueues.set(log.sessionId, []);
    }
    const queue = sessionQueues.get(log.sessionId)!;

    if (!queue.includes(logId) && sessionActiveLog.get(log.sessionId) !== logId) {
        queue.push(logId);
        logger.info("Broadcast", `Disparo ${logId} enfileirado na sessão ${log.sessionId} (posição: ${queue.length})`);
    }

    // Se já houver um disparo rodando nesta sessão, notifica que este está na fila
    if (sessionActiveLog.get(log.sessionId) && sessionActiveLog.get(log.sessionId) !== logId) {
        const io = (global as any).io;
        const position = queue.indexOf(logId) + 1;
        try {
            io?.to(log.sessionId).emit("broadcast.progress", {
                broadcastId: logId,
                status: "queued",
                position,
                total: log.total,
                sent: log.sent,
                failed: log.failed,
                message: `Aguardando disparo anterior terminar (${position}º na fila sequencial)`
            });
        } catch {}
    }

    void processSessionQueue(log.sessionId);
}

async function processSessionQueue(sessionId: string): Promise<void> {
    if (sessionActiveLog.get(sessionId)) {
        // Disparo ativo em andamento — o próximo iniciará assim que este terminar
        return;
    }

    const queue = sessionQueues.get(sessionId);
    if (!queue || queue.length === 0) {
        sessionActiveLog.set(sessionId, null);
        return;
    }

    const nextLogId = queue.shift()!;
    sessionActiveLog.set(sessionId, nextLogId);

    try {
        await executeBroadcast(nextLogId);
    } catch (err) {
        logger.error("Broadcast", `Erro ao executar disparo ${nextLogId} na fila:`, err);
    } finally {
        sessionActiveLog.set(sessionId, null);
        // Processa o próximo item da fila sequencial imediatamente
        void processSessionQueue(sessionId);
    }
}

async function executeBroadcast(logId: string): Promise<void> {
    const log = await prisma.broadcastLog.findUnique({
        where: { id: logId },
        include: { recipients: true }
    });
    if (!log) return;

    if (cancelled.has(logId) || log.status === "cancelled") {
        return;
    }

    const io = (global as any).io;
    const emit = (payload: Record<string, any>) => {
        try { io?.to(log.sessionId).emit("broadcast.progress", payload); } catch { /* socket caiu */ }
    };

    const instance = waManager.getInstance(log.sessionId);
    if (!instance?.socket) {
        await prisma.broadcastLog.update({
            where: { id: logId },
            data: { status: "interrupted", completedAt: new Date() }
        }).catch(() => {});
        emit({ broadcastId: logId, status: "interrupted", total: log.recipients.length, sent: log.sent, failed: log.failed });
        logger.warn("Broadcast", `Sessão ${log.sessionId} offline: disparo ${logId} pausado`);
        return;
    }

    active.add(logId);
    cancelled.delete(logId);

    const total = log.recipients.length;
    let sent = log.recipients.filter(r => r.status === "sent").length;
    let failed = log.recipients.filter(r => r.status === "failed").length;
    const errors: { jid: string; error: string }[] = [];
    const baseDelay = log.delay || 2000;

    // Detect structured media payload (image, video, document, audio) or plain text
    let messageTemplate = log.message;
    let mediaPayload: { type: "image" | "video" | "document" | "audio"; mimetype: string; filename?: string; base64: string } | null = null;
    let mediaBuffer: Buffer | null = null;

    if (log.message && log.message.startsWith("{") && log.message.includes('"media"')) {
        try {
            const parsed = JSON.parse(log.message);
            if (parsed.media && parsed.media.base64) {
                mediaPayload = parsed.media;
                messageTemplate = parsed.caption || "";
                const cleanBase64 = parsed.media.base64.replace(/^data:[^;]+;base64,/, "");
                mediaBuffer = Buffer.from(cleanBase64, "base64");
            }
        } catch {
            // Fallback plain text
        }
    }

    await prisma.broadcastLog.update({
        where: { id: logId },
        data: { status: "running", startedAt: log.status === "scheduled" ? new Date() : undefined }
    }).catch(() => {});

    emit({
        broadcastId: logId, status: "running", total, sent, failed,
        current: null, progress: total ? Math.round(((sent + failed) / total) * 100) : 0
    });

    let stopReason: "cancelled" | "completed" = "completed";

    try {
        for (const recipient of log.recipients) {
            if (recipient.status === "sent") continue;
            if (cancelled.has(logId)) { stopReason = "cancelled"; break; }

            let current: { jid: string; error: string } | null = null;
            try {
                let target = recipient.jid.trim();
                // Garante formato de JID sem travar o loop de envio com checagens USync do WhatsApp
                if (!target.includes("@")) {
                    const digits = target.replace(/\D/g, "");
                    const withCountry = digits.length <= 11 ? `55${digits}` : digits;
                    target = `${withCountry}@s.whatsapp.net`;
                }

                // Lookup contact name for dynamic variables
                let contactName = "";
                let firstName = "";
                const cleanNumber = target.split("@")[0].replace(/\D/g, "");
                const phoneFormatted = cleanNumber ? `+${cleanNumber}` : "";

                try {
                    const contact = await prisma.contact.findFirst({
                        where: {
                            sessionId: log.sessionId,
                            OR: [
                                { jid: target },
                                { jid: `${cleanNumber}@s.whatsapp.net` }
                            ]
                        },
                        select: { name: true, notify: true }
                    });
                    if (contact) {
                        contactName = (contact.name || contact.notify || "").trim();
                        firstName = contactName.split(" ")[0] || "";
                    }
                } catch {}

                // Saudação dinâmica baseada no horário (Brasil)
                const currentHour = new Date().getHours();
                const saudacao = currentHour >= 5 && currentHour < 12 ? "Bom dia" : currentHour >= 12 && currentHour < 18 ? "Boa tarde" : "Boa noite";

                // Substituição das variáveis dinâmicas na legenda ou texto da mensagem
                const personalizedText = messageTemplate
                    .replace(/\{nome\}/gi, contactName || "Amigo(a)")
                    .replace(/\{primeiro_nome\}/gi, firstName || contactName || "Amigo(a)")
                    .replace(/\{saudacao\}/gi, saudacao)
                    .replace(/\{telefone\}/gi, phoneFormatted || cleanNumber);

                // Presença de digitação: apenas para modo seguro / delays longos (>= 1000ms)
                // Para velocidades rápidas e turbo (< 1000ms), dispara direto um atrás do outro sem travar
                if (baseDelay >= 1000) {
                    try {
                        await instance.socket!.sendPresenceUpdate("composing", target);
                        await new Promise(r => setTimeout(r, 200));
                        await instance.socket!.sendPresenceUpdate("paused", target);
                    } catch {}
                }

                // Monta mensagem de mídia com legenda dinâmica ou texto puro
                let contentToSend: AnyMessageContent;
                if (mediaPayload && mediaBuffer) {
                    const options: any = { mimetype: mediaPayload.mimetype };
                    if (personalizedText && personalizedText.trim().length > 0) {
                        options.caption = personalizedText;
                    }

                    if (mediaPayload.type === "image") {
                        contentToSend = { image: mediaBuffer, ...options };
                    } else if (mediaPayload.type === "video") {
                        contentToSend = { video: mediaBuffer, ...options };
                    } else if (mediaPayload.type === "document") {
                        contentToSend = {
                            document: mediaBuffer,
                            fileName: mediaPayload.filename || "documento",
                            ...options
                        };
                    } else if (mediaPayload.type === "audio") {
                        contentToSend = {
                            audio: mediaBuffer,
                            mimetype: mediaPayload.mimetype || "audio/mp4",
                            ptt: false
                        };
                    } else {
                        contentToSend = {
                            document: mediaBuffer,
                            fileName: mediaPayload.filename || "arquivo",
                            ...options
                        };
                    }
                } else {
                    contentToSend = { text: personalizedText };
                }

                // Obtém socket atualizado (resiliente a reconexões rápidas)
                let liveSocket: typeof instance.socket | null = waManager.getInstance(log.sessionId)?.socket || instance.socket || null;
                if (!liveSocket) {
                    for (let retryWait = 0; retryWait < 6; retryWait++) {
                        await new Promise(r => setTimeout(r, 500));
                        liveSocket = waManager.getInstance(log.sessionId)?.socket || null;
                        if (liveSocket) break;
                    }
                }
                if (!liveSocket) {
                    throw new Error("Sessão desconectada temporariamente");
                }

                // Disparo com skipAntiSpam para não entrar na fila do antispam e não travar após 15 mensagens
                try {
                    await liveSocket.sendMessage(target, contentToSend, { skipAntiSpam: true } as any);
                } catch (sendErr: any) {
                    const errMsg = String(sendErr?.message || "");
                    if (target.endsWith("@s.whatsapp.net") && errMsg.includes("Cannot read properties of null")) {
                        // Resolve LID / canonical JID via onWhatsApp quando o contato não possui mapeamento LID prévio
                        const checkRes = await liveSocket.onWhatsApp(target).catch(() => null);
                        const validEntry = Array.isArray(checkRes) ? checkRes[0] : null;
                        if (validEntry?.exists && validEntry?.jid) {
                            target = validEntry.jid;
                            await liveSocket.sendMessage(target, contentToSend, { skipAntiSpam: true } as any);
                        } else {
                            throw new Error("Número sem WhatsApp ativo ou inválido");
                        }
                    } else {
                        throw sendErr;
                    }
                }

                const wasFailed = recipient.status === "failed";
                sent++;
                if (wasFailed) failed--;

                void prisma.broadcastRecipient.update({
                    where: { id: recipient.id },
                    data: { status: "sent", sentAt: new Date(), jid: target, error: null }
                }).catch(() => {});
            } catch (e: any) {
                const error = e?.message || "Erro desconhecido";
                current = { jid: recipient.jid, error };
                failed++;
                errors.push(current);
                logger.error("Broadcast", `Falha ao enviar para ${recipient.jid}: ${error}`);

                void prisma.broadcastRecipient.update({
                    where: { id: recipient.id },
                    data: { status: "failed", error }
                }).catch(() => {});
            }

            void prisma.broadcastLog.update({
                where: { id: logId },
                data: { sent, failed }
            }).catch(() => {});

            const done = sent + failed;
            emit({
                broadcastId: logId,
                status: "running",
                total,
                sent,
                failed,
                current: recipient.jid,
                progress: total ? Math.round((done / total) * 100) : 0
            });

            if (cancelled.has(logId)) { stopReason = "cancelled"; break; }

            if (baseDelay > 0) {
                // Para delays rápidos (< 1500ms), dispara exatamente no tempo configurado sem jitter alto
                const jitter = baseDelay >= 1500 ? Math.floor(Math.random() * (baseDelay * 0.15)) : 0;
                const actualDelay = Math.max(30, baseDelay + jitter);
                await new Promise(r => setTimeout(r, actualDelay));
            }
        }
    } finally {
        active.delete(logId);
        cancelled.delete(logId);

        const done = sent + failed;
        await prisma.broadcastLog.update({
            where: { id: logId },
            data: {
                status: stopReason,
                sent,
                failed,
                completedAt: new Date()
            }
        }).catch(() => {});

        emit({
            broadcastId: logId,
            status: stopReason,
            total,
            sent,
            failed,
            errors,
            progress: stopReason === "completed" ? 100 : (total ? Math.round((done / total) * 100) : 0),
            completedAt: new Date().toISOString()
        });

        logger.info("Broadcast", `Disparo ${logId} ${stopReason === "cancelled" ? "cancelado" : "concluído"}: ${sent} enviados, ${failed} falhas de ${total}`);

        // Se este disparo é recorrente diário (Horários Programados) e completou, renova para o dia seguinte
        if (stopReason === "completed" && (log as any).repeatDaily && log.scheduledAt) {
            try {
                const nextRun = new Date(log.scheduledAt.getTime() + 24 * 60 * 60 * 1000);
                const nextLog = await prisma.broadcastLog.create({
                    data: {
                        sessionId: log.sessionId,
                        message: log.message,
                        total: log.recipients.length,
                        delay: log.delay,
                        status: "scheduled",
                        scheduledAt: nextRun,
                        repeatDaily: true,
                        timeSlot: (log as any).timeSlot || null,
                        recipients: {
                            create: log.recipients.map(r => ({
                                jid: r.jid,
                                status: "pending"
                            }))
                        }
                    }
                });
                logger.info("Broadcast Scheduler", `Disparo diário renovado para o próximo dia às ${(log as any).timeSlot || 'horário programado'} (${nextRun.toISOString()}) - Novo ID: ${nextLog.id}`);
            } catch (err) {
                logger.error("Broadcast Scheduler", "Falha ao renovar agendamento diário:", err);
            }
        }
    }
}

/**
 * Processa disparos agendados cujo horário já chegou.
 * Roda a cada 10 segundos no servidor.
 */
export async function processScheduledBroadcasts(): Promise<void> {
    try {
        const now = new Date();
        const due = await prisma.broadcastLog.findMany({
            where: {
                status: "scheduled",
                scheduledAt: { lte: now }
            },
            orderBy: { scheduledAt: "asc" }
        });

        if (due.length === 0) return;

        logger.info("Broadcast Scheduler", `${due.length} disparo(s) agendado(s) devido(s)`);

        for (const log of due) {
            if (active.has(log.id)) continue;
            // Marca como running/queued no DB para não ser capturado por outro ciclo
            await prisma.broadcastLog.update({
                where: { id: log.id },
                data: { status: "running", startedAt: new Date() }
            }).catch(() => {});
            // Enfileira na fila sequencial da sessão
            void runBroadcast(log.id);
        }
    } catch (e) {
        logger.error("Broadcast Scheduler", "Falha ao processar disparos agendados", e);
    }
}

let _bcastTimer: ReturnType<typeof setInterval> | null = null;

export function startBroadcastScheduler(intervalMs = 10 * 1000): void {
    if (_bcastTimer) return;
    void processScheduledBroadcasts();
    _bcastTimer = setInterval(() => {
        void processScheduledBroadcasts();
    }, intervalMs);
}

/**
 * Adiciona as colunas scheduledAt, repeatDaily e timeSlot ao banco existente.
 * Idempotente.
 */
export async function ensureScheduledColumn(): Promise<void> {
    try {
        const isPostgres = process.env.DATABASE_URL?.startsWith("postgres");
        if (isPostgres) {
            await prisma.$executeRawUnsafe(`ALTER TABLE "BroadcastLog" ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP`);
            await prisma.$executeRawUnsafe(`ALTER TABLE "BroadcastLog" ADD COLUMN IF NOT EXISTS "repeatDaily" BOOLEAN DEFAULT FALSE`);
            await prisma.$executeRawUnsafe(`ALTER TABLE "BroadcastLog" ADD COLUMN IF NOT EXISTS "timeSlot" VARCHAR(20)`);
        } else {
            await prisma.$executeRawUnsafe(`ALTER TABLE "BroadcastLog" ADD COLUMN "scheduledAt" DATETIME`);
            await prisma.$executeRawUnsafe(`ALTER TABLE "BroadcastLog" ADD COLUMN "repeatDaily" BOOLEAN DEFAULT 0`);
            await prisma.$executeRawUnsafe(`ALTER TABLE "BroadcastLog" ADD COLUMN "timeSlot" TEXT`);
        }
    } catch (e: any) {
        const msg = String(e?.message || e);
        if (!/duplicate column|already exists|coluna.*existe/i.test(msg)) {
            logger.warn("Broadcast Scheduler", `Não foi possível verificar colunas de agendamento: ${msg}`);
        }
    }
}
