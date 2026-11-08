import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import {
    isBotPausedForChat,
    pauseBotForChat,
    unpauseBotForChat,
    getBotPauseRemainingMs
} from "@/modules/whatsapp/store/autoreply";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });
        }
        const { searchParams } = new URL(request.url);
        const jid = searchParams.get("jid");
        if (!jid) {
            return NextResponse.json({ status: false, message: "jid is required" }, { status: 400 });
        }

        const paused = isBotPausedForChat(sessionId, jid);
        const remainingMs = getBotPauseRemainingMs(sessionId, jid);

        return NextResponse.json({ status: true, paused, remainingMs });
    } catch (e: any) {
        return NextResponse.json({ status: false, message: e.message }, { status: 500 });
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });
        }
        const body = await request.json();
        const { jid, action, durationMinutes = 15 } = body;
        if (!jid) {
            return NextResponse.json({ status: false, message: "jid is required" }, { status: 400 });
        }

        if (action === "unpause" || action === "resume") {
            unpauseBotForChat(sessionId, jid);
        } else {
            pauseBotForChat(sessionId, jid, durationMinutes);
        }

        const paused = isBotPausedForChat(sessionId, jid);
        const remainingMs = getBotPauseRemainingMs(sessionId, jid);

        return NextResponse.json({ status: true, paused, remainingMs });
    } catch (e: any) {
        return NextResponse.json({ status: false, message: e.message }, { status: 500 });
    }
}
