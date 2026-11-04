import { prisma } from "@/lib/prisma";
import { waManager } from "./manager";
import { logger } from "@/lib/logger";
import type { AnyMessageContent } from "@whiskeysockets/baileys";

/**
 * Executa (ou retoma) um disparo em massa a partir do que está gravado no banco.
 * - Só envia destinatários pendentes/falhos: fechar o app e reabrir não duplica envios.
 * - Cancelamento é cooperativo (verifica a flag antes de cada envio).
 */
const cancelled = new Set<string>();
const active = new Set<string>();

export function cancelBroadcast(logId: string): boolean {
    if (!active.has(logId)) return false;
    cancelled.add(logId);
    return true;
}

export function isBroadcastActive(logId: string): boolean {
    return active.has(logId);
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

export async function runBroadcast(logId: string): Promise<void> {
    if (active.has(logId)) return;

    const log = await prisma.broadcastLog.findUnique({
        where: { id: logId },
        include: { recipients: true }
    });
    if (!log) return;

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
    const messageContent: AnyMessageContent = { text: log.message };
    const baseDelay = log.delay || 2000;

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
                // O WhatsApp só entrega no JID canônico (ex.: 5566996876005 -> 556696876005)
                let target = recipient.jid;
                if (target.endsWith("@s.whatsapp.net")) {
                    const number = target.split("@")[0];
                    const [info] = (await instance.socket!.onWhatsApp(number)) || [];
                    if (!info?.exists || !info.jid) {
                        throw new Error("Número não está no WhatsApp");
                    }
                    target = info.jid;
                }

                await instance.socket!.sendMessage(target, messageContent);

                const wasFailed = recipient.status === "failed";
                sent++;
                if (wasFailed) failed--;

                // Atualização assíncrona para não travar a velocidade do envio
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
                const jitter = baseDelay >= 1000 ? Math.floor(Math.random() * (baseDelay * 0.2)) : 0;
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
    }
}

/**
 * Processa disparos agendados cujo horário já chegou.
 * Chame a cada 30 s (ou similar) a partir do servidor.
 */
export async function processScheduledBroadcasts(): Promise<void> {
    try {
        const now = new Date();
        const due = await prisma.broadcastLog.findMany({
            where: {
                status: "scheduled",
                scheduledAt: { lte: now }
            }
        });

        if (due.length === 0) return;

        logger.info("Broadcast Scheduler", `${due.length} disparo agendado(s) devido(s)`);

        for (const log of due) {
            if (active.has(log.id)) continue;
            await prisma.broadcastLog.update({
                where: { id: log.id },
                data: { status: "running", startedAt: new Date() }
            }).catch(() => {});
            void runBroadcast(log.id);
        }
    } catch (e) {
        logger.error("Broadcast Scheduler", "Falha ao processar disparos agendados", e);
    }
}

let _bcastTimer: ReturnType<typeof setInterval> | null = null;

export function startBroadcastScheduler(intervalMs = 30 * 1000): void {
    if (_bcastTimer) return;
    void processScheduledBroadcasts();
    _bcastTimer = setInterval(() => {
        void processScheduledBroadcasts();
    }, intervalMs);
}

/**
 * Adiciona a coluna scheduledAt ao banco existente, se ainda não existir.
 * Idempotente: ignora erro de coluna duplicada.
 */
export async function ensureScheduledColumn(): Promise<void> {
    try {
        const isPostgres = process.env.DATABASE_URL?.startsWith("postgres");
        if (isPostgres) {
            await prisma.$executeRawUnsafe(`ALTER TABLE "BroadcastLog" ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP`);
        } else {
            await prisma.$executeRawUnsafe(`ALTER TABLE "BroadcastLog" ADD COLUMN "scheduledAt" DATETIME`);
        }
    } catch (e: any) {
        const msg = String(e?.message || e);
        if (!/duplicate column|already exists|coluna.*existe/i.test(msg)) {
            logger.warn("Broadcast Scheduler", `Não foi possível adicionar coluna scheduledAt: ${msg}`);
        }
    }
}

