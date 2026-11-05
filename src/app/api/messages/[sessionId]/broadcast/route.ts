import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { waManager } from "@/modules/whatsapp/manager";
import { runBroadcast } from "@/modules/whatsapp/broadcast-runner";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { toWhatsAppJid } from "@/lib/phone";
import { z } from "zod";

const broadcastBodySchema = z.object({
    recipients: z.array(z.string()),
    message: z.string().min(1),
    delay: z.number().optional(),
    scheduledAt: z.string().optional(),
    mode: z.enum(["now", "datetime", "programmed"]).optional(),
    programmedTimes: z.array(z.string()).optional(),
    scheduledDateTimes: z.array(z.string()).optional(),
    repeatDaily: z.boolean().optional(),
});

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;
        const body = await request.json();

        const parseResult = broadcastBodySchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ error: parseResult.error.flatten() }, { status: 400 });
        }

        const { message, delay, scheduledAt, mode, programmedTimes, scheduledDateTimes, repeatDaily } = parseResult.data;
        // Normaliza e remove duplicados (mesmo número digitado duas vezes)
        const recipients = [...new Set(parseResult.data.recipients.map(toWhatsAppJid).filter(Boolean))];
        if (recipients.length === 0) {
            return NextResponse.json({ status: false, message: "Nenhum destinatário válido", error: "Nenhum destinatário válido" }, { status: 400 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden", error: "Forbidden" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        // Modo Horários Programados (ex.: 12:00, 15:00, 18:00)
        if (mode === "programmed" && programmedTimes && programmedTimes.length > 0) {
            const createdLogs = [];
            for (let i = 0; i < programmedTimes.length; i++) {
                const timeSlot = programmedTimes[i];
                let targetDate: Date;

                if (scheduledDateTimes && scheduledDateTimes[i]) {
                    targetDate = new Date(scheduledDateTimes[i]);
                } else {
                    const [h, m] = timeSlot.split(":");
                    const now = new Date();
                    targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(h, 10), parseInt(m || "0", 10), 0, 0);
                    if (targetDate.getTime() <= now.getTime()) {
                        targetDate.setDate(targetDate.getDate() + 1);
                    }
                }

                const bLog = await prisma.broadcastLog.create({
                    data: {
                        sessionId,
                        message,
                        total: recipients.length,
                        delay: delay || 2000,
                        status: "scheduled",
                        scheduledAt: targetDate,
                        repeatDaily: repeatDaily !== false,
                        timeSlot: timeSlot,
                        recipients: {
                            create: recipients.map(jid => ({
                                jid,
                                status: "pending"
                            }))
                        }
                    }
                });
                createdLogs.push(bLog);
            }

            return NextResponse.json({
                status: true,
                message: `${createdLogs.length} disparo(s) programado(s) com sucesso`,
                data: { count: createdLogs.length, logs: createdLogs }
            });
        }

        // Modo Agendamento de Data/Hora única ou Disparo Imediato
        const logData: any = {
            sessionId,
            message,
            total: recipients.length,
            delay: delay || 2000,
            recipients: {
                create: recipients.map(jid => ({
                    jid,
                    status: "pending"
                }))
            }
        };

        if (scheduledAt) {
            logData.status = "scheduled";
            logData.scheduledAt = new Date(scheduledAt);
        } else {
            logData.status = "running";
        }

        const log = await prisma.broadcastLog.create({
            data: logData
        });

        // Disparo imediato (sem agendamento) entra na fila sequencial da sessão
        if (!scheduledAt) {
            void runBroadcast(log.id);
        }

        return NextResponse.json({
            status: true,
            message: scheduledAt ? "Disparo agendado com sucesso" : "Disparo iniciado na fila sequencial",
            data: { broadcastId: log.id, total: recipients.length }
        });

    } catch (e) {
        console.error("Broadcast error", e);
        return NextResponse.json({ status: false, message: "Failed to start broadcast", error: "Failed to start broadcast" }, { status: 500 });
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden", error: "Forbidden" }, { status: 403 });
        }

        // 1. Procura se existe um disparo ativo em andamento ou na fila
        const activeLog = await prisma.broadcastLog.findFirst({
            where: {
                sessionId,
                status: { in: ["running", "queued"] }
            },
            orderBy: { startedAt: "desc" },
            include: {
                recipients: {
                    where: { status: "failed" },
                    take: 50,
                    select: { jid: true, error: true }
                }
            }
        });

        if (activeLog) {
            return NextResponse.json({
                status: true,
                hasActive: true,
                broadcast: {
                    id: activeLog.id,
                    status: activeLog.status,
                    total: activeLog.total,
                    sent: activeLog.sent,
                    failed: activeLog.failed,
                    message: activeLog.message,
                    delay: activeLog.delay,
                    startedAt: activeLog.startedAt.toISOString(),
                    errors: activeLog.recipients.map(r => ({ jid: r.jid, error: r.error || "Falha no envio" }))
                }
            });
        }

        // 2. Retorna o último disparo recente (se houver)
        const latestLog = await prisma.broadcastLog.findFirst({
            where: { sessionId },
            orderBy: { startedAt: "desc" },
            include: {
                recipients: {
                    where: { status: "failed" },
                    take: 50,
                    select: { jid: true, error: true }
                }
            }
        });

        return NextResponse.json({
            status: true,
            hasActive: false,
            broadcast: latestLog ? {
                id: latestLog.id,
                status: latestLog.status,
                total: latestLog.total,
                sent: latestLog.sent,
                failed: latestLog.failed,
                message: latestLog.message,
                delay: latestLog.delay,
                startedAt: latestLog.startedAt.toISOString(),
                completedAt: latestLog.completedAt?.toISOString() || null,
                errors: latestLog.recipients.map(r => ({ jid: r.jid, error: r.error || "Falha no envio" }))
            } : null
        });
    } catch (e) {
        console.error("Broadcast GET status error", e);
        return NextResponse.json({ status: false, message: "Failed to get broadcast status", error: "Failed to get broadcast status" }, { status: 500 });
    }
}

