import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";

// PUT: Mark messages as read or unread
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId, jid } = await params;
        const body = await request.json().catch(() => ({}));
        const { messageIds, markRead } = body;

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        // Decode JID from URL parameter
        const decodedJid = decodeURIComponent(jid);
        const shouldMarkRead = markRead !== undefined ? Boolean(markRead) : true;

        // If specific message IDs provided and marking as read
        if (messageIds && Array.isArray(messageIds) && messageIds.length > 0 && shouldMarkRead) {
            for (const messageId of messageIds) {
                await instance.socket.readMessages([{
                    remoteJid: decodedJid,
                    id: messageId,
                    participant: undefined
                }]);
            }
        } else {
            // Mark chat as read or unread in Baileys
            await instance.socket.chatModify(
                { markRead: shouldMarkRead, lastMessages: [] },
                decodedJid
            );
        }

        return NextResponse.json({
            status: true,
            message: shouldMarkRead ? "Mensagens marcadas como lidas" : "Conversa marcada como não lida"
        });

    } catch (error) {
        console.error("Mark as read error:", error);
        return NextResponse.json({ status: false, message: "Failed to mark messages as read", error: "Failed to mark messages as read" }, { status: 500 });
    }
}
