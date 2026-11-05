"use server";

import { prisma } from "@/lib/prisma";
import { ChatService } from "@/modules/whatsapp/chat.service";
import { getAuthenticatedUserForAction } from "@/lib/server-action-auth";
import { canAccessSession } from "@/lib/api-auth";
import { waManager } from "@/modules/whatsapp/manager";
import { mediaDir } from "@/lib/paths";
import { readFile } from "fs/promises";
import path from "path";

const CHAT_PAGE_SIZE = parseInt(process.env.NEXT_PUBLIC_CHAT_PAGE_SIZE || "300", 10);

// Fetch chat list with cursor-based pagination & search
export async function getChatsStatus(
    sessionId: string,
    limit = CHAT_PAGE_SIZE,
    before?: string,
    search?: string
) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findFirst({
        where: { OR: [{ sessionId }, { id: sessionId }] },
        select: { id: true }
    });

    if (!session) throw new Error("Session not found");

    return await ChatService.getChatsList(session.id, limit, before, search);
}

// Search contacts from the WhatsApp address book (e.g. searching "Alexandre")
export async function searchWhatsAppContacts(sessionId: string, query: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findFirst({
        where: { OR: [{ sessionId }, { id: sessionId }] },
        select: { id: true }
    });
    if (!session) return [];

    const q = query.trim();
    if (!q || q.length < 2) return [];

    const digits = q.replace(/\D/g, "");

    const contacts = await prisma.contact.findMany({
        where: {
            sessionId: session.id,
            OR: [
                { name: { contains: q, mode: "insensitive" } },
                { notify: { contains: q, mode: "insensitive" } },
                { verifiedName: { contains: q, mode: "insensitive" } },
                { jid: { contains: q, mode: "insensitive" } },
                ...(digits.length >= 4 ? [{ jid: { contains: digits } }] : [])
            ]
        },
        take: 30,
        select: {
            jid: true,
            name: true,
            notify: true,
            profilePic: true
        }
    });

    return contacts.map(c => ({
        jid: c.jid,
        name: c.name || c.notify || c.jid.split("@")[0],
        notify: c.notify,
        profilePic: (c.profilePic && c.profilePic.startsWith("http")) ? c.profilePic : null,
        isContact: true
    }));
}

// Fetch messages for a specific chat with cursor pagination
export async function getChatMessages(
    sessionId: string,
    jid: string,
    limit = 50,
    before?: string
) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findFirst({
        where: { OR: [{ sessionId }, { id: sessionId }] },
        select: { id: true }
    });

    if (!session) throw new Error("Session not found");

    const { messages, hasMore, contactMap, participantNames, participantsList } = await ChatService.getMessages(session.id, jid, limit, before);

    return {
        messages: messages.map((msg: any) => ({
            ...msg,
            timestamp: msg.timestamp instanceof Date
                ? msg.timestamp.toISOString()
                : String(msg.timestamp)
        })),
        hasMore,
        contactMap: contactMap || {},
        participantNames: participantNames || [],
        participantsList: participantsList || []
    };
}

// Send a basic text message
export async function sendChatMessage(sessionId: string, jid: string, text: string, quotedMessageId?: string, mentions?: string[]) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    try {
        const result = await ChatService.sendTextMessage(sessionId, jid, { text }, mentions, quotedMessageId);
        return {
            success: true,
            keyId: result?.key?.id,
            timestamp: result?.messageTimestamp
                ? (typeof result.messageTimestamp === "number" ? result.messageTimestamp * 1000 : Number(result.messageTimestamp) * 1000)
                : Date.now()
        };
    } catch (error: any) {
        throw new Error(`Failed to send message: ${error.message}`);
    }
}

// Upload and Send Media
export async function sendMediaMessage(formData: FormData) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const sessionId = formData.get("sessionId") as string;
    const jid = formData.get("jid") as string;
    const file = formData.get("file") as File;
    const type = formData.get("type") as string;
    const caption = formData.get("caption") as string || "";

    if (!sessionId || !jid || !file || !type) {
        throw new Error("Missing required fields");
    }

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    try {
        const buffer = Buffer.from(await file.arrayBuffer());

        const sendResult = await ChatService.sendMediaMessage(
            sessionId,
            jid,
            buffer,
            type,
            file.type,
            file.name,
            caption
        );

        return {
            success: true,
            keyId: sendResult?.key?.id
        };
    } catch (error: any) {
        console.error("Media send error:", error);
        throw new Error(`Failed to send media: ${error.message}`);
    }
}

// Send typing / recording presence update to recipient
export async function sendChatPresence(sessionId: string, jid: string, presence: "composing" | "recording" | "paused") {
    try {
        const user = await getAuthenticatedUserForAction();
        if (!user) return { success: false };
        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) return { success: false };
        await instance.socket.sendPresenceUpdate(presence, jid);
        return { success: true };
    } catch {
        return { success: false };
    }
}

// Forward a message (text or media: image, video, audio, document, sticker) to multiple recipients (#C11)
export async function forwardChatMessage(
    sessionId: string,
    targetJids: string[],
    msg: { content?: string; type: string; mediaUrl?: string }
) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    if (!targetJids || targetJids.length === 0) {
        throw new Error("Selecione pelo menos um destinatário");
    }

    const msgType = (msg.type || "TEXT").toUpperCase();
    const isMedia = msgType !== "TEXT" && !!msg.mediaUrl;

    let mediaBuffer: Buffer | null = null;
    let mimeType = "application/octet-stream";
    let fileName = msg.content || `arquivo-${Date.now()}`;

    if (isMedia && msg.mediaUrl) {
        try {
            if (msg.mediaUrl.startsWith("data:")) {
                const match = msg.mediaUrl.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                    mimeType = match[1];
                    mediaBuffer = Buffer.from(match[2], "base64");
                }
            } else if (msg.mediaUrl.startsWith("/api/media/") || msg.mediaUrl.startsWith("/media/")) {
                const baseName = path.basename(msg.mediaUrl);
                const fullPath = path.join(mediaDir, baseName);
                mediaBuffer = await readFile(fullPath);
                const ext = path.extname(baseName).toLowerCase().replace(".", "");
                const extMimeMap: Record<string, string> = {
                    jpg: "image/jpeg",
                    jpeg: "image/jpeg",
                    png: "image/png",
                    webp: "image/webp",
                    mp4: "video/mp4",
                    mp3: "audio/mp3",
                    ogg: "audio/ogg; codecs=opus",
                    pdf: "application/pdf",
                    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    xls: "application/vnd.ms-excel",
                    csv: "text/csv",
                    doc: "application/msword",
                    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                };
                mimeType = extMimeMap[ext] || "application/octet-stream";
                if (!msg.content) fileName = baseName;
            } else if (msg.mediaUrl.startsWith("http")) {
                const res = await fetch(msg.mediaUrl);
                if (res.ok) {
                    mimeType = res.headers.get("content-type") || mimeType;
                    mediaBuffer = Buffer.from(await res.arrayBuffer());
                }
            }
        } catch (err) {
            console.error("Error loading media buffer for forward:", err);
        }
    }

    const mappedSendType =
        msgType === "IMAGE" ? "image" :
        msgType === "VIDEO" ? "video" :
        msgType === "AUDIO" ? "audio" :
        msgType === "STICKER" ? "sticker" : "document";

    for (const targetJid of targetJids) {
        if (mediaBuffer) {
            await ChatService.sendMediaMessage(
                sessionId,
                targetJid,
                mediaBuffer,
                mappedSendType,
                mimeType,
                fileName,
                msgType === "DOCUMENT" ? "" : (msg.content || "")
            );
        } else {
            await ChatService.sendTextMessage(sessionId, targetJid, { text: msg.content || "" });
        }
    }

    return { success: true, count: targetJids.length };
}

// React to chat message
export async function reactToChatMessage(sessionId: string, jid: string, messageId: string, emoji: string, fromMe?: boolean, participant?: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    try {
        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) throw new Error("WhatsApp session not connected");

        const isGroup = jid.endsWith("@g.us");
        await instance.socket.sendMessage(jid, {
            react: {
                text: emoji,
                key: {
                    remoteJid: jid,
                    fromMe: fromMe ?? false,
                    id: messageId,
                    ...(isGroup && participant ? { participant } : {})
                }
            }
        });
        return { success: true };
    } catch (e: any) {
        throw new Error(`Failed to send reaction: ${e.message}`);
    }
}
