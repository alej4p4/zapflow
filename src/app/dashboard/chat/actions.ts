"use server";

import { prisma } from "@/lib/prisma";
import { ChatService } from "@/modules/whatsapp/chat.service";
import { getAuthenticatedUserForAction } from "@/lib/server-action-auth";
import { canAccessSession } from "@/lib/api-auth";

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

    const { messages, hasMore } = await ChatService.getMessages(session.id, jid, limit, before);

    return {
        messages: messages.map((msg: any) => ({
            ...msg,
            timestamp: msg.timestamp instanceof Date
                ? msg.timestamp.toISOString()
                : String(msg.timestamp)
        })),
        hasMore
    };
}

// Send a basic text message
export async function sendChatMessage(sessionId: string, jid: string, text: string, quotedMessageId?: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    try {
        const result = await ChatService.sendTextMessage(sessionId, jid, { text }, undefined, quotedMessageId);
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

        await ChatService.sendMediaMessage(
            sessionId,
            jid,
            buffer,
            type,
            file.type,
            file.name,
            caption
        );

        return { success: true };
    } catch (error: any) {
        console.error("Media send error:", error);
        throw new Error(`Failed to send media: ${error.message}`);
    }
}
