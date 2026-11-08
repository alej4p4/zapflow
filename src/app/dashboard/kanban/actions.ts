"use server";

import { getAuthenticatedUserForAction } from "@/lib/server-action-auth";
import { canAccessSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { ChatService } from "@/modules/whatsapp/chat.service";
import { waManager } from "@/modules/whatsapp/manager";

export interface KanbanContact {
    jid: string;
    name: string;
    phone: string;
    profilePic: string | null;
    lastMessage?: string;
    lastMessageTime?: string;
    isGroup: boolean;
    currentLabelId?: string | null;
    currentLabelName?: string | null;
    currentLabelColor?: string | null;
}

export interface KanbanColumn {
    id: string;
    name: string;
    colorHex: string;
    contacts: KanbanContact[];
}

export interface KanbanBoardData {
    columns: KanbanColumn[];
    unlabeled: KanbanContact[];
}

export async function getKanbanBoardData(sessionId: string): Promise<KanbanBoardData> {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findFirst({
        where: { OR: [{ sessionId }, { id: sessionId }] },
        select: { id: true, sessionId: true }
    });

    if (!session) throw new Error("Session not found");
    const dbSessionId = session.id;

    // 1. Fetch all labels for this session
    const labels = await prisma.label.findMany({
        where: { sessionId: dbSessionId },
        orderBy: { createdAt: "asc" }
    });

    // 2. Fetch all chatLabel mappings
    const chatLabels = await prisma.chatLabel.findMany({
        where: { label: { sessionId: dbSessionId } },
        include: { label: true }
    });

    const chatLabelMap = new Map<string, { id: string; name: string; colorHex: string }>();
    for (const cl of chatLabels) {
        if (!chatLabelMap.has(cl.chatJid)) {
            chatLabelMap.set(cl.chatJid, {
                id: cl.label.id,
                name: cl.label.name,
                colorHex: cl.label.colorHex
            });
        }
    }

    // 3. Fetch recent active chats
    const rawChats = await ChatService.getChatsList(dbSessionId, 250);

    const columnsMap = new Map<string, KanbanContact[]>();
    for (const l of labels) {
        columnsMap.set(l.id, []);
    }
    const unlabeledContacts: KanbanContact[] = [];

    for (const c of rawChats) {
        // Format display phone
        const rawNumber = c.jid.split("@")[0] || "";
        const formattedPhone = rawNumber.length >= 10
            ? rawNumber.replace(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/, "+$1 ($2) $3-$4")
            : rawNumber;

        const assignedLabel = chatLabelMap.get(c.jid);

        const card: KanbanContact = {
            jid: c.jid,
            name: c.name || c.notify || formattedPhone,
            phone: formattedPhone,
            profilePic: c.profilePic || null,
            lastMessage: c.lastMessage?.content || (c.lastMessage?.type === "AUDIO" ? "🎵 Áudio" : c.lastMessage?.type === "IMAGE" ? "📷 Foto" : ""),
            lastMessageTime: c.lastMessage?.timestamp || undefined,
            isGroup: Boolean(c.jid.endsWith("@g.us")),
            currentLabelId: assignedLabel?.id || null,
            currentLabelName: assignedLabel?.name || null,
            currentLabelColor: assignedLabel?.colorHex || null
        };

        if (assignedLabel && columnsMap.has(assignedLabel.id)) {
            columnsMap.get(assignedLabel.id)!.push(card);
        } else {
            unlabeledContacts.push(card);
        }
    }

    const columns: KanbanColumn[] = labels.map(l => ({
        id: l.id,
        name: l.name,
        colorHex: l.colorHex,
        contacts: columnsMap.get(l.id) || []
    }));

    return {
        columns,
        unlabeled: unlabeledContacts
    };
}

export async function moveKanbanContact(
    sessionId: string,
    chatJid: string,
    targetLabelId: string | null
): Promise<{ success: boolean }> {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findFirst({
        where: { OR: [{ sessionId }, { id: sessionId }] },
        select: { id: true, sessionId: true }
    });

    if (!session) throw new Error("Session not found");
    const dbSessionId = session.id;

    // 1. Remove existing label associations for this chat within this session
    await prisma.chatLabel.deleteMany({
        where: {
            chatJid,
            label: { sessionId: dbSessionId }
        }
    });

    // 2. If target is a real label (not unlabeled), add new association
    if (targetLabelId && targetLabelId !== "unlabeled") {
        const label = await prisma.label.findFirst({
            where: { id: targetLabelId, sessionId: dbSessionId }
        });

        if (label) {
            await prisma.chatLabel.create({
                data: {
                    labelId: label.id,
                    chatJid
                }
            });

            // 3. Sync to WhatsApp if online
            try {
                const instance = waManager.getInstance(session.sessionId);
                if (instance?.socket) {
                    await (instance.socket as any).chatModify(
                        { addLabel: { labelId: label.id } },
                        chatJid
                    );
                }
            } catch (err) {
                // Non-blocking sync error
            }
        }
    }

    return { success: true };
}

export async function createKanbanStage(
    sessionId: string,
    name: string,
    colorHex: string
): Promise<{ success: boolean; stage?: { id: string; name: string; colorHex: string } }> {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findFirst({
        where: { OR: [{ sessionId }, { id: sessionId }] },
        select: { id: true }
    });

    if (!session) throw new Error("Session not found");

    const cleanName = name.trim();
    if (!cleanName) throw new Error("Nome da etapa é obrigatório");

    const existing = await prisma.label.findFirst({
        where: { sessionId: session.id, name: cleanName }
    });

    if (existing) {
        throw new Error("Já existe uma etapa ou etiqueta com este nome");
    }

    const created = await prisma.label.create({
        data: {
            sessionId: session.id,
            name: cleanName,
            colorHex: colorHex || "#00a884"
        }
    });

    return {
        success: true,
        stage: {
            id: created.id,
            name: created.name,
            colorHex: created.colorHex
        }
    };
}
