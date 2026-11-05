import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";

// DELETE: Delete message for everyone (if fromMe) and remove from DB
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string; messageId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId, jid, messageId } = await params;

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const decodedJid = decodeURIComponent(jid);
        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });

        const existingMsg = session
            ? await prisma.message.findFirst({
                  where: { sessionId: session.id, keyId: messageId },
                  select: { id: true, fromMe: true, senderJid: true }
              })
            : null;

        const instance = waManager.getInstance(sessionId);
        if (instance?.socket && (!existingMsg || existingMsg.fromMe)) {
            try {
                await instance.socket.sendMessage(decodedJid, {
                    delete: {
                        remoteJid: decodedJid,
                        fromMe: true,
                        id: messageId,
                        participant: undefined
                    }
                });
            } catch (waErr) {
                console.warn("Non-fatal error revoking message on WhatsApp:", waErr);
            }
        }

        if (session) {
            await prisma.message.deleteMany({
                where: { sessionId: session.id, keyId: messageId }
            });
        }

        try {
            const io = (global as any).io;
            if (io) {
                io.to(sessionId).emit("message.deleted", {
                    keyId: messageId,
                    remoteJid: decodedJid
                });
            }
        } catch {}

        return NextResponse.json({ status: true, message: "Mensagem apagada com sucesso" });
    } catch (error: any) {
        console.error("Delete message error:", error);
        return NextResponse.json({ status: false, message: "Failed to delete message", error: "Failed to delete message" }, { status: 500 });
    }
}

// PATCH: Edit a sent message on WhatsApp and update DB
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string; messageId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId, jid, messageId } = await params;
        const body = await request.json().catch(() => ({}));
        const { text } = body;

        if (!text || !text.trim()) {
            return NextResponse.json({ status: false, message: "Texto é obrigatório para editar a mensagem", error: "Bad Request" }, { status: 400 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Sessão do WhatsApp desconectada", error: "Session not ready" }, { status: 503 });
        }

        const decodedJid = decodeURIComponent(jid);
        const trimmedText = text.trim();

        await instance.socket.sendMessage(decodedJid, {
            text: trimmedText,
            edit: {
                remoteJid: decodedJid,
                id: messageId,
                fromMe: true
            }
        });

        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });

        if (session) {
            await prisma.message.updateMany({
                where: { sessionId: session.id, keyId: messageId },
                data: { content: trimmedText }
            });
        }

        try {
            const io = (global as any).io;
            if (io) {
                io.to(sessionId).emit("message.edit", {
                    keyId: messageId,
                    newContent: trimmedText,
                    isEdited: true
                });
            }
        } catch {}

        return NextResponse.json({ status: true, message: "Mensagem editada com sucesso" });
    } catch (error: any) {
        console.error("Edit message error:", error);
        return NextResponse.json({ status: false, message: "Falha ao editar mensagem", error: error.message || "Failed to edit message" }, { status: 500 });
    }
}
