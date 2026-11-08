import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { waManager } from "@/modules/whatsapp/manager";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const resolvedParams = await params;
        const sessionId = resolvedParams.sessionId;

        const auth = await getAuthenticatedUser(req);
        if (!auth) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }

        const hasAccess = await canAccessSession(auth.id, auth.role, sessionId);
        if (!hasAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);

        // Always resolve the database session ID to fetch real counts
        const dbSession = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });

        if (!dbSession) {
            return NextResponse.json({ status: false, message: "Session not found" }, { status: 404 });
        }

        const dbSessionId = dbSession.id;

        // Always fetch real counts from database, even when disconnected
        const [contactsCount, groupsCount, messagesCount] = await Promise.all([
            prisma.contact.count({ where: { sessionId: dbSessionId } }),
            prisma.group.count({ where: { sessionId: dbSessionId } }),
            prisma.message.count({ where: { sessionId: dbSessionId } })
        ]);

        if (!instance || instance.status !== "CONNECTED") {
            const statusLabel = instance?.status === "SCAN_QR" ? "Aguardando QR" : (instance?.status || "Desconectado");
            return NextResponse.json({
                status: true,
                message: "Session is not connected",
                data: { 
                    status: instance?.status || "DISCONNECTED", 
                    uptime: 0, 
                    ping: statusLabel, 
                    store: { 
                        contacts: contactsCount, 
                        chats: groupsCount + contactsCount, 
                        messages: messagesCount 
                    } 
                }
            });
        }

        const uptime = instance.startTime ? Date.now() - instance.startTime.getTime() : 0;

        let pingStatus = "Online";
        try {
            if (instance.lastPingMs && instance.lastPingMs > 0) {
                pingStatus = `${instance.lastPingMs}ms`;
            } else if (typeof (instance as any).measurePing === "function") {
                const latency = await (instance as any).measurePing();
                pingStatus = typeof latency === "number" && latency > 0 ? `${latency}ms` : "Online";
            } else {
                pingStatus = "Online";
            }
        } catch {
            pingStatus = "Online";
        }

        return NextResponse.json({
            status: true,
            message: "Session metrics fetched",
            data: {
                status: instance.status,
                uptimeMs: uptime,
                ping: pingStatus,
                store: { 
                    contacts: contactsCount, 
                    chats: groupsCount + contactsCount, // Approximation of total chats
                    messages: messagesCount 
                } 
            }
        });

    } catch (error: any) {
        console.error("Session Monitor API Error:", error);
        return NextResponse.json({ status: false, message: error.message }, { status: 500 });
    }
}
