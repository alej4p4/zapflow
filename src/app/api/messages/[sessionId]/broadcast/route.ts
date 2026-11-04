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
    scheduledAt: z.string().optional()
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

        const { message, delay, scheduledAt } = parseResult.data;
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

        // Disparo imediato (sem agendamento) começa a enviar agora.
        if (!scheduledAt) {
            void runBroadcast(log.id);
        }

        return NextResponse.json({
            status: true,
            message: "Broadcast started",
            data: { broadcastId: log.id, total: recipients.length }
        });

    } catch (e) {
        console.error("Broadcast error", e);
        return NextResponse.json({ status: false, message: "Failed to start broadcast", error: "Failed to start broadcast" }, { status: 500 });
    }
}
