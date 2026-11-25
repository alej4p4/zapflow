import { prisma } from "@/lib/prisma";
import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { ChatService } from "@/modules/whatsapp/chat.service";

const sessionCuidApiCache = new Map<string, string>();

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    const { sessionId } = await params;

    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden" }, { status: 403 });
        }

        // Get the database Session ID (cuid) with fast in-memory cache
        let dbSessionId = sessionCuidApiCache.get(sessionId);
        if (!dbSessionId) {
            const session = await prisma.session.findFirst({
                where: { OR: [{ sessionId }, { id: sessionId }] },
                select: { id: true }
            });
            if (!session) {
                return NextResponse.json({ status: false, message: "Session not found", error: 'Session not found' }, { status: 404 });
            }
            dbSessionId = session.id;
            sessionCuidApiCache.set(sessionId, dbSessionId);
            sessionCuidApiCache.set(dbSessionId, dbSessionId);
        }

        // Fetch chats using the new ChatService
        const chatList = await ChatService.getChatsList(dbSessionId);

        return NextResponse.json({ status: true, message: "Chats fetched successfully", data: chatList });
    } catch (error) {
        console.error("Chat API error:", error);
        return NextResponse.json({ status: false, message: "Failed to fetch chats", error: 'Failed to fetch chats' }, { status: 500 });
    }
}
