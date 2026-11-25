import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { waManager } from "@/modules/whatsapp/manager";
import { prisma } from "@/lib/prisma";
import { formatPhoneNumber } from "@/lib/phone";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, error: "Forbidden" }, { status: 403 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });
        if (!session) {
            return NextResponse.json({ status: false, error: "Session not found" }, { status: 404 });
        }

        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const rawStories = await prisma.message.findMany({
            where: {
                sessionId: session.id,
                remoteJid: "status@broadcast",
                timestamp: { gte: since }
            },
            orderBy: { timestamp: "asc" },
            take: 200
        });

        const senderJids = Array.from(new Set(rawStories.map(s => s.senderJid).filter(Boolean))) as string[];
        const contacts = senderJids.length > 0
            ? await prisma.contact.findMany({
                  where: {
                      sessionId: session.id,
                      OR: [
                          { jid: { in: senderJids } },
                          { lid: { in: senderJids } },
                          { remoteJidAlt: { in: senderJids } }
                      ]
                  },
                  select: { jid: true, lid: true, remoteJidAlt: true, name: true, notify: true, profilePic: true }
              })
            : [];

        const grouped = new Map<string, {
            jid: string;
            name: string;
            profilePic: string | null;
            fromMe: boolean;
            items: Array<{
                keyId: string;
                type: string;
                content: string | null;
                mediaUrl: string | null;
                timestamp: string;
            }>;
        }>();

        for (const st of rawStories) {
            const authorJid = st.fromMe ? "me" : (st.senderJid || "unknown@s.whatsapp.net");
            const matchedContact = contacts.find(
                c => c.jid === authorJid || c.lid === authorJid || c.remoteJidAlt === authorJid
            );
            const authorName = st.fromMe
                ? "Meu Status"
                : (matchedContact?.name || matchedContact?.notify || st.pushName || formatPhoneNumber(authorJid));
            const groupKey = st.fromMe ? "me" : (matchedContact?.jid || authorJid);

            if (!grouped.has(groupKey)) {
                grouped.set(groupKey, {
                    jid: groupKey,
                    name: authorName,
                    profilePic: matchedContact?.profilePic || null,
                    fromMe: st.fromMe,
                    items: []
                });
            }
            grouped.get(groupKey)!.items.push({
                keyId: st.keyId,
                type: st.type,
                content: st.content,
                mediaUrl: st.mediaUrl,
                timestamp: st.timestamp.toISOString()
            });
        }

        const storiesList = Array.from(grouped.values()).sort((a, b) => {
            if (a.fromMe) return -1;
            if (b.fromMe) return 1;
            const lastA = a.items[a.items.length - 1]?.timestamp || "";
            const lastB = b.items[b.items.length - 1]?.timestamp || "";
            return lastB.localeCompare(lastA);
        });

        return NextResponse.json({ status: true, data: storiesList });
    } catch (error: any) {
        console.error("Get stories error:", error);
        return NextResponse.json({ status: false, error: "Falha ao carregar Status" }, { status: 500 });
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, error: "Forbidden" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, error: "WhatsApp desconectado" }, { status: 503 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });

        // Gather status recipients (saved contacts with @s.whatsapp.net)
        let statusJidList: string[] = [];
        if (session) {
            const contacts = await prisma.contact.findMany({
                where: {
                    sessionId: session.id,
                    jid: { endsWith: "@s.whatsapp.net" }
                },
                select: { jid: true },
                take: 1500
            });
            statusJidList = contacts.map(c => c.jid);
        }
        if (instance.socket.user?.id) {
            const myClean = instance.socket.user.id.split(":")[0].split("@")[0] + "@s.whatsapp.net";
            if (!statusJidList.includes(myClean)) statusJidList.push(myClean);
        }

        const contentType = request.headers.get("content-type") || "";
        if (contentType.includes("multipart/form-data")) {
            const formData = await request.formData();
            const file = formData.get("file") as File | null;
            const caption = (formData.get("caption") as string) || "";
            if (!file) {
                return NextResponse.json({ status: false, error: "Arquivo obrigatório" }, { status: 400 });
            }
            const buffer = Buffer.from(await file.arrayBuffer());
            const isVideo = file.type.startsWith("video/");
            const sent = await instance.socket.sendMessage(
                "status@broadcast",
                isVideo
                    ? { video: buffer, caption: caption || undefined, mimetype: file.type }
                    : { image: buffer, caption: caption || undefined, mimetype: file.type },
                { statusJidList }
            );
            if (session) {
                const keyId = sent?.key?.id || `story-${Date.now()}`;
                await prisma.message.upsert({
                    where: { sessionId_keyId: { sessionId: session.id, keyId } },
                    create: {
                        sessionId: session.id,
                        keyId,
                        remoteJid: "status@broadcast",
                        fromMe: true,
                        type: isVideo ? "VIDEO" : "IMAGE",
                        content: caption || null,
                        status: "SENT",
                        timestamp: new Date()
                    },
                    update: {}
                }).catch(() => {});
            }
            return NextResponse.json({ status: true, message: "Status com mídia publicado com sucesso!" });
        } else {
            const body = await request.json();
            const text = (body?.text || "").trim();
            const backgroundColor = body?.backgroundColor || "#00a884";
            if (!text) {
                return NextResponse.json({ status: false, error: "Digite um texto para o Status" }, { status: 400 });
            }
            const sent = await instance.socket.sendMessage(
                "status@broadcast",
                { text },
                {
                    backgroundColor,
                    font: 1,
                    statusJidList
                }
            );
            if (session) {
                const keyId = sent?.key?.id || `story-${Date.now()}`;
                await prisma.message.upsert({
                    where: { sessionId_keyId: { sessionId: session.id, keyId } },
                    create: {
                        sessionId: session.id,
                        keyId,
                        remoteJid: "status@broadcast",
                        fromMe: true,
                        type: "TEXT",
                        content: text,
                        status: "SENT",
                        timestamp: new Date()
                    },
                    update: {}
                }).catch(() => {});
            }
            return NextResponse.json({ status: true, message: "Status de texto publicado com sucesso!" });
        }
    } catch (error: any) {
        console.error("Post story error:", error);
        return NextResponse.json({ status: false, error: error?.message || "Falha ao publicar no Status" }, { status: 500 });
    }
}
