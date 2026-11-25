import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { waManager } from "@/modules/whatsapp/manager";
import { prisma } from "@/lib/prisma";

export async function GET(
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

        const decodedJid = decodeURIComponent(jid);
        let targetJid = decodedJid;

        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });

        let verifiedName: string | null = null;
        if (session) {
            const contact = await prisma.contact.findFirst({
                where: {
                    sessionId: session.id,
                    OR: [
                        { jid: decodedJid },
                        { lid: decodedJid },
                        { remoteJidAlt: decodedJid }
                    ]
                },
                select: { jid: true, remoteJidAlt: true, verifiedName: true }
            });
            if (contact) {
                verifiedName = contact.verifiedName || null;
                if (contact.jid?.endsWith("@s.whatsapp.net")) {
                    targetJid = contact.jid;
                } else if (contact.remoteJidAlt?.endsWith("@s.whatsapp.net")) {
                    targetJid = contact.remoteJidAlt;
                }
            }
        }

        const instance = waManager.getInstance(sessionId);
        let statusText: string | null = null;
        let statusSetAt: string | null = null;
        let businessProfile: any = null;

        if (instance?.socket && !decodedJid.endsWith("@g.us")) {
            try {
                const statusRes: any = await instance.socket.fetchStatus(targetJid);
                if (Array.isArray(statusRes) && statusRes[0]?.status) {
                    const st = statusRes[0].status;
                    statusText = typeof st === "string" ? st : (st?.status || null);
                    if (st?.setAt) statusSetAt = new Date(st.setAt).toISOString();
                } else if (statusRes?.status) {
                    statusText = typeof statusRes.status === "string" ? statusRes.status : null;
                    if (statusRes.setAt) statusSetAt = new Date(statusRes.setAt).toISOString();
                }
            } catch {
                // Contact may hide status or not have one
            }

            try {
                const biz = await instance.socket.getBusinessProfile(targetJid);
                if (biz) {
                    businessProfile = {
                        description: biz.description || null,
                        category: biz.category || null,
                        email: biz.email || null,
                        website: Array.isArray(biz.website) ? biz.website.filter(Boolean) : [],
                        address: biz.address || null
                    };
                }
            } catch {
                // Not a business account
            }
        }

        return NextResponse.json({
            status: true,
            data: {
                about: statusText,
                setAt: statusSetAt,
                verifiedName,
                business: businessProfile
            }
        });
    } catch (error: any) {
        return NextResponse.json({ status: false, error: error?.message || "Failed to fetch contact about" }, { status: 500 });
    }
}
