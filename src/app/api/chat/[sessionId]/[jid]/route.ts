import { prisma } from "@/lib/prisma";
import { resolveToPhoneJid, isLidJid } from "@/lib/jid-utils";
import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";

const sessionCuidRouteCache = new Map<string, string>();

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string, jid: string }> }
) {
    const { sessionId, jid } = await params;
    const decodedJid = decodeURIComponent(jid);

    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        // Get the database Session ID (cuid) from memory cache or DB
        let dbSessionId = sessionCuidRouteCache.get(sessionId);
        if (!dbSessionId) {
            const session = await prisma.session.findFirst({
                where: { OR: [{ sessionId }, { id: sessionId }] },
                select: { id: true }
            });
            if (!session) {
                return NextResponse.json({ error: 'Session not found' }, { status: 404 });
            }
            dbSessionId = session.id;
            sessionCuidRouteCache.set(sessionId, dbSessionId);
            sessionCuidRouteCache.set(dbSessionId, dbSessionId);
        }

        const isGroup = decodedJid.endsWith('@g.us');

        const [messages, group] = await Promise.all([
            prisma.message.findMany({
                where: {
                    sessionId: dbSessionId,
                    remoteJid: decodedJid
                },
                orderBy: { timestamp: 'desc' }, // Fetch NEWEST first
                take: 100
            }),
            isGroup
                ? prisma.group.findUnique({
                      where: {
                          sessionId_jid: {
                              sessionId: dbSessionId,
                              jid: decodedJid
                          }
                      },
                      select: { participants: true }
                  }).catch(() => null)
                : Promise.resolve(null)
        ]);

        // Reverse to show oldest -> newest
        messages.reverse();

        // Enrich with participant info if it's a group
        if (isGroup && group && group.participants) {
            const parts = group.participants as any[];

            const enrichedMessages = messages.map((msg: any) => {
                const sender = msg.senderJid || msg.remoteJid; // Fallback
                const participant = parts.find(p => p.id === sender);

                return {
                    ...msg,
                    sender: participant || sender // Replace or add sender field with object or string
                };
            });

            return NextResponse.json({ status: true, data: enrichedMessages });
        }

        return NextResponse.json({ status: true, data: messages });
    } catch (error) {
        console.error("Fetch messages error:", error);
        return NextResponse.json({ status: false, message: 'Failed to fetch messages', error: 'Failed to fetch messages' }, { status: 500 });
    }
}
