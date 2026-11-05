import { prisma } from "@/lib/prisma";
import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { waManager } from "@/modules/whatsapp/manager";
import { runBroadcast, cancelBroadcast } from "@/modules/whatsapp/broadcast-runner";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; logId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId, logId } = await params;

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden", error: "Forbidden" }, { status: 403 });
        }

        const log = await prisma.broadcastLog.findFirst({
            where: { id: logId, sessionId },
            include: { recipients: true }
        });

        if (!log) {
            return NextResponse.json({ status: false, message: "Broadcast not found" }, { status: 404 });
        }

        return NextResponse.json({ status: true, data: log });
    } catch (e) {
        console.error("Broadcast detail error:", e);
        return NextResponse.json({ status: false, message: "Failed to fetch detail" }, { status: 500 });
    }
}

/**
 * Ações sobre um disparo:
 *  - cancel: para o envio em andamento ou cancela agendamento futuro
 *  - retry: reenvia apenas quem falhou ou ficou pendente
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; logId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId, logId } = await params;
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden", error: "Forbidden" }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const action = body?.action;

        const log = await prisma.broadcastLog.findFirst({
            where: { id: logId, sessionId }
        });
        if (!log) {
            return NextResponse.json({ status: false, message: "Broadcast not found" }, { status: 404 });
        }

        if (action === "cancel") {
            if (log.status === "scheduled" || log.status === "queued") {
                cancelBroadcast(logId);
                await prisma.broadcastLog.update({
                    where: { id: logId },
                    data: { status: "cancelled", completedAt: new Date() }
                });
                return NextResponse.json({ status: true, message: "Agendamento cancelado com sucesso" });
            }

            if (log.status !== "running") {
                return NextResponse.json({ status: false, message: "Este disparo não está em andamento" }, { status: 400 });
            }
            const runnerActive = cancelBroadcast(logId);
            if (!runnerActive) {
                // Nada rodando em memória (ex.: app reiniciou): encerra direto.
                await prisma.broadcastLog.update({
                    where: { id: logId },
                    data: { status: "cancelled", completedAt: new Date() }
                });
            }
            return NextResponse.json({ status: true, message: "Cancelamento solicitado" });
        }

        if (action === "retry") {
            if (log.status === "running") {
                return NextResponse.json({ status: false, message: "Aguarde o disparo atual terminar" }, { status: 400 });
            }
            const pending = await prisma.broadcastRecipient.count({
                where: { broadcastLogId: logId, status: { in: ["pending", "failed"] } }
            });
            if (pending === 0) {
                return NextResponse.json({ status: false, message: "Nada para reenviar" }, { status: 400 });
            }

            const instance = waManager.getInstance(sessionId);
            if (!instance?.socket) {
                return NextResponse.json({ status: false, message: "Sessão do WhatsApp desconectada" }, { status: 503 });
            }

            await prisma.broadcastRecipient.updateMany({
                where: { broadcastLogId: logId, status: "failed" },
                data: { status: "pending", error: null }
            });
            await prisma.broadcastLog.update({
                where: { id: logId },
                data: { status: "running", completedAt: null }
            });

            void runBroadcast(logId);
            return NextResponse.json({ status: true, message: "Reenvio iniciado", data: { pending } });
        }

        return NextResponse.json({ status: false, message: "Ação inválida" }, { status: 400 });
    } catch (e) {
        console.error("Broadcast action error:", e);
        return NextResponse.json({ status: false, message: "Falha ao executar a ação" }, { status: 500 });
    }
}
