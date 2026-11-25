import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { waManager } from "@/modules/whatsapp/manager";
import { runBroadcast } from "@/modules/whatsapp/broadcast-runner";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { toWhatsAppJid, normalizeSearch } from "@/lib/phone";
import { z } from "zod";

const broadcastMediaSchema = z.object({
    base64: z.string(),
    filename: z.string(),
    mimetype: z.string(),
    type: z.enum(["image", "video", "document", "audio"])
});

const broadcastBodySchema = z.object({
    recipients: z.array(z.string()),
    message: z.string().optional().default(""),
    media: broadcastMediaSchema.optional(),
    messages: z.array(z.object({
        message: z.string().optional().default(""),
        media: broadcastMediaSchema.optional(),
    })).optional(),
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

        const { message, media, messages, delay, scheduledAt, mode, programmedTimes, scheduledDateTimes, repeatDaily } = parseResult.data;

        const validSequence = Array.isArray(messages)
            ? messages.filter(item => Boolean(item.message?.trim() || item.media))
            : [];

        if (!message?.trim() && !media && validSequence.length === 0) {
            return NextResponse.json({ status: false, message: "A mensagem ou mídia deve ser informada", error: "Empty message and media" }, { status: 400 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden", error: "Forbidden" }, { status: 403 });
        }

        // Resolve destinatários (aceita JIDs, números ou nomes puros de grupos/contatos)
        const rawList = parseResult.data.recipients.map(r => r.trim()).filter(Boolean);
        const needsNameLookup = rawList.some(r => !toWhatsAppJid(r));

        let nameMap = new Map<string, string>();
        if (needsNameLookup) {
            const sessionRecord = await prisma.session.findUnique({
                where: { sessionId },
                select: { id: true }
            });
            if (sessionRecord) {
                const [dbGroups, dbContacts] = await Promise.all([
                    prisma.group.findMany({
                        where: { sessionId: sessionRecord.id },
                        select: { jid: true, subject: true }
                    }),
                    prisma.contact.findMany({
                        where: { sessionId: sessionRecord.id },
                        select: { jid: true, name: true, notify: true, verifiedName: true, remoteJidAlt: true }
                    })
                ]);
                for (const c of dbContacts) {
                    const cJid = c.jid.endsWith("@s.whatsapp.net") ? c.jid : (c.remoteJidAlt?.endsWith("@s.whatsapp.net") ? c.remoteJidAlt : "");
                    if (!cJid) continue;
                    const label = (c.name || c.verifiedName || c.notify || "").trim();
                    if (label) {
                        nameMap.set(label.toLowerCase(), cJid);
                        nameMap.set(normalizeSearch(label), cJid);
                    }
                }
                for (const g of dbGroups) {
                    if (g.subject && g.jid) {
                        const s = g.subject.trim();
                        nameMap.set(s.toLowerCase(), g.jid);
                        nameMap.set(normalizeSearch(s), g.jid);
                    }
                }
            }
        }

        const resolvedRecipients = rawList.map(raw => {
            const direct = toWhatsAppJid(raw);
            if (direct) return direct;
            const cleaned = raw.replace(/\s+#\d+$/, "").trim();
            return nameMap.get(cleaned.toLowerCase()) || nameMap.get(normalizeSearch(cleaned)) || "";
        }).filter(Boolean);

        // Normaliza e remove duplicados
        const recipients = [...new Set(resolvedRecipients)];
        if (recipients.length === 0) {
            return NextResponse.json({ status: false, message: "Nenhum destinatário válido", error: "Nenhum destinatário válido" }, { status: 400 });
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        // Converte mensagem e anexo em formato estruturado transparente
        const messageToStore = validSequence.length > 0
            ? JSON.stringify({
                sequence: validSequence.map(item => ({
                    caption: item.message || "",
                    ...(item.media ? { media: item.media } : {})
                }))
            })
            : (media ? JSON.stringify({
                caption: message || "",
                media
            }) : (message || ""));

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
                        message: messageToStore,
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
            message: messageToStore,
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

        const targetLog = activeLog || await prisma.broadcastLog.findFirst({
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

        if (!targetLog) {
            return NextResponse.json({ status: true, hasActive: false, broadcast: null });
        }

        const [allRecipients, scheduledDaily] = await Promise.all([
            prisma.broadcastRecipient.findMany({
                where: { broadcastLogId: targetLog.id },
                select: { jid: true }
            }),
            prisma.broadcastLog.findMany({
                where: { sessionId, repeatDaily: true, status: "scheduled", timeSlot: { not: null } },
                orderBy: { timeSlot: "asc" },
                select: { timeSlot: true }
            })
        ]);

        const programmedSlots = Array.from(
            new Set(scheduledDaily.map(s => s.timeSlot).filter((t): t is string => Boolean(t)))
        );

        return NextResponse.json({
            status: true,
            hasActive: Boolean(activeLog),
            broadcast: {
                id: targetLog.id,
                status: targetLog.status,
                total: targetLog.total,
                sent: targetLog.sent,
                failed: targetLog.failed,
                message: targetLog.message,
                delay: targetLog.delay,
                repeatDaily: targetLog.repeatDaily,
                timeSlot: targetLog.timeSlot,
                programmedSlots: programmedSlots.length > 0 ? programmedSlots : (targetLog.timeSlot ? [targetLog.timeSlot] : []),
                recipientJids: allRecipients.map(r => r.jid),
                startedAt: targetLog.startedAt.toISOString(),
                completedAt: targetLog.completedAt?.toISOString() || null,
                errors: targetLog.recipients.map(r => ({ jid: r.jid, error: r.error || "Falha no envio" }))
            }
        });
    } catch (e) {
        console.error("Broadcast GET status error", e);
        return NextResponse.json({ status: false, message: "Failed to get broadcast status", error: "Failed to get broadcast status" }, { status: 500 });
    }
}
