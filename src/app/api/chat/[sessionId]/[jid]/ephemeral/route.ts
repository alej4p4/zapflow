import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { waManager } from "@/modules/whatsapp/manager";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId, jid } = await params;
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, error: "Forbidden" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, error: "WhatsApp desconectado" }, { status: 503 });
        }

        const body = await request.json();
        const duration = Number(body?.duration || 0); // 0 = off, 86400 = 24h, 604800 = 7d, 7776000 = 90d
        const decodedJid = decodeURIComponent(jid);

        if (decodedJid.endsWith("@g.us")) {
            await instance.socket.groupToggleEphemeral(decodedJid, duration);
        } else {
            await instance.socket.sendMessage(decodedJid, {
                disappearingMessagesInChat: duration > 0 ? duration : false
            });
        }

        return NextResponse.json({
            status: true,
            message: duration > 0 ? "Mensagens temporárias ativadas" : "Mensagens temporárias desativadas",
            duration
        });
    } catch (error: any) {
        console.error("Toggle ephemeral error:", error);
        return NextResponse.json({ status: false, error: error?.message || "Falha ao alterar mensagens temporárias" }, { status: 500 });
    }
}
