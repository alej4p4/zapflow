"use server";

import { prisma } from "@/lib/prisma";
import { ChatService } from "@/modules/whatsapp/chat.service";
import { getAuthenticatedUserForAction } from "@/lib/server-action-auth";
import { canAccessSession } from "@/lib/api-auth";
import { waManager } from "@/modules/whatsapp/manager";
import { mediaDir } from "@/lib/paths";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { callFreeLLMWithFallback, type CustomFreeLLMKeys } from "@/lib/free-llm";

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

    try {
        const [rawContacts, rawGroups] = (await Promise.all([
            prisma.$queryRaw`
                SELECT jid, name, notify, "profilePic"
                FROM "Contact"
                WHERE "sessionId" = ${session.id}
                  AND (
                    unaccent(coalesce(name, '')) ILIKE '%' || unaccent(${q}) || '%'
                    OR unaccent(coalesce(notify, '')) ILIKE '%' || unaccent(${q}) || '%'
                    OR unaccent(coalesce("verifiedName", '')) ILIKE '%' || unaccent(${q}) || '%'
                    OR jid ILIKE '%' || ${q} || '%'
                    OR (${digits.length >= 4} AND jid ILIKE '%' || ${digits} || '%')
                  )
                LIMIT 30
            `,
            prisma.$queryRaw`
                SELECT jid, subject as name, subject as notify, null as "profilePic"
                FROM "Group"
                WHERE "sessionId" = ${session.id}
                  AND unaccent(coalesce(subject, '')) ILIKE '%' || unaccent(${q}) || '%'
                LIMIT 15
            `
        ])) as [any[], any[]];

        const combined = [
            ...rawContacts.map(c => ({
                jid: c.jid,
                name: c.name || c.notify || c.jid.split("@")[0],
                notify: c.notify,
                profilePic: (c.profilePic && c.profilePic.startsWith("http")) ? c.profilePic : null,
                isContact: true
            })),
            ...rawGroups.map(g => ({
                jid: g.jid,
                name: g.name || "Grupo",
                notify: g.notify || "Grupo",
                profilePic: null,
                isContact: false
            }))
        ];
        return combined;
    } catch {
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
}

// Global Message Search across all chats in database
export async function searchGlobalMessages(sessionId: string, query: string) {
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

    try {
        const rawMessages: any[] = await prisma.$queryRaw`
            SELECT m.id, m."keyId", m."remoteJid", m."fromMe", m.content, m.timestamp, m.type, m."pushName",
                   c.name as "contactName", c.notify as "contactNotify", c."profilePic" as "contactPic"
            FROM "Message" m
            LEFT JOIN "Contact" c ON c."sessionId" = m."sessionId" AND (c.jid = m."remoteJid" OR c.lid = m."remoteJid")
            WHERE m."sessionId" = ${session.id}
              AND (
                unaccent(coalesce(m.content, '')) ILIKE '%' || unaccent(${q}) || '%'
                OR unaccent(coalesce(m."pushName", '')) ILIKE '%' || unaccent(${q}) || '%'
                OR unaccent(coalesce(c.name, '')) ILIKE '%' || unaccent(${q}) || '%'
                OR unaccent(coalesce(c.notify, '')) ILIKE '%' || unaccent(${q}) || '%'
              )
            ORDER BY m.timestamp DESC
            LIMIT 40
        `;
        return rawMessages.map(m => {
            const contactName = m.contactName || m.contactNotify || m.pushName || m.remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", "");
            return {
                id: m.id,
                keyId: m.keyId,
                jid: m.remoteJid,
                fromMe: m.fromMe,
                content: m.content || "",
                timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp),
                type: m.type,
                contactName,
                profilePic: (m.contactPic && m.contactPic.startsWith("http")) ? m.contactPic : null
            };
        });
    } catch {
        const messages = await prisma.message.findMany({
            where: {
                sessionId: session.id,
                content: { contains: q, mode: "insensitive" }
            },
            orderBy: { timestamp: "desc" },
            take: 40,
            select: {
                id: true,
                keyId: true,
                remoteJid: true,
                fromMe: true,
                content: true,
                timestamp: true,
                type: true,
                pushName: true,
                contract: {
                    select: {
                        name: true,
                        notify: true,
                        profilePic: true
                    }
                }
            }
        });

        return messages.map(m => {
            const contactName = m.contract?.name || m.contract?.notify || m.pushName || m.remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", "");
            return {
                id: m.id,
                keyId: m.keyId,
                jid: m.remoteJid,
                fromMe: m.fromMe,
                content: m.content || "",
                timestamp: m.timestamp.toISOString(),
                type: m.type,
                contactName,
                profilePic: (m.contract?.profilePic && m.contract.profilePic.startsWith("http")) ? m.contract.profilePic : null
            };
        });
    }
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

// Fetch messages around a target keyId for instant search jump
export async function getChatMessagesAround(sessionId: string, jid: string, keyId: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findFirst({
        where: { OR: [{ sessionId }, { id: sessionId }] },
        select: { id: true }
    });

    if (!session) throw new Error("Session not found");

    const { messages, hasMore, contactMap, participantNames, participantsList } = await ChatService.getMessagesAround(session.id, jid, keyId);

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
            keyId: sendResult?.key?.id,
            mediaUrl: (sendResult as any)?.mediaUrl
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
        }, { skipAntiSpam: true } as any);
        return { success: true };
    } catch (e: any) {
        throw new Error(`Failed to send reaction: ${e.message}`);
    }
}

// Send a WhatsApp vCard Contact Card (#C22)
export async function sendContactCardMessage(
    sessionId: string,
    jid: string,
    contactName: string,
    contactPhone: string
) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const cleanPhone = contactPhone.replace(/\D/g, "");
    if (!cleanPhone) throw new Error("Número de telefone inválido");

    const safeName = (contactName || cleanPhone).trim();
    const vcard = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `FN:${safeName}`,
        `TEL;type=CELL;type=VOICE;waid=${cleanPhone}:+${cleanPhone}`,
        "END:VCARD"
    ].join("\n");

    const result = await ChatService.sendTextMessage(sessionId, jid, {
        contacts: {
            displayName: safeName,
            contacts: [{ vcard }]
        }
    });

    return {
        success: true,
        keyId: result?.key?.id
    };
}

// Send a WhatsApp Location Pin (#C22)
export async function sendLocationPinMessage(
    sessionId: string,
    jid: string,
    latitude: number,
    longitude: number,
    name?: string,
    address?: string
) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const result = await ChatService.sendTextMessage(sessionId, jid, {
        location: {
            degreesLatitude: latitude,
            degreesLongitude: longitude,
            name: name?.trim() || undefined,
            address: address?.trim() || undefined
        }
    });

    return {
        success: true,
        keyId: result?.key?.id
    };
}

// Send a WhatsApp Native Poll (#C23)
export async function sendPollMessage(
    sessionId: string,
    jid: string,
    question: string,
    options: string[],
    selectableCount = 1
) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const cleanQuestion = question.trim();
    const cleanOptions = options.map(o => o.trim()).filter(Boolean);
    if (!cleanQuestion || cleanOptions.length < 2) {
        throw new Error("Informe a pergunta e pelo menos 2 opções para a enquete");
    }

    const result = await ChatService.sendTextMessage(sessionId, jid, {
        poll: {
            name: cleanQuestion,
            values: cleanOptions,
            selectableCount: Math.max(1, Math.min(selectableCount, cleanOptions.length))
        }
    });

    return {
        success: true,
        keyId: result?.key?.id
    };
}

// Schedule a message directly from the Chat Window (#C25)
export async function scheduleDirectChatMessage(
    sessionId: string,
    jid: string,
    content: string,
    sendAtIso: string
) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findFirst({
        where: { OR: [{ sessionId }, { id: sessionId }] },
        select: { id: true }
    });
    if (!session) throw new Error("Sessão não encontrada");

    const sendAtDate = new Date(sendAtIso);
    if (isNaN(sendAtDate.getTime()) || sendAtDate.getTime() <= Date.now()) {
        throw new Error("Escolha uma data e horário futuros para o agendamento");
    }

    const scheduled = await prisma.scheduledMessage.create({
        data: {
            sessionId: session.id,
            jid,
            content: content.trim(),
            sendAt: sendAtDate,
            status: "PENDING"
        }
    });

    return {
        success: true,
        id: scheduled.id
    };
}

// Free LLM AI Assistant for Chat (#C29 - Powered by free-llm-apis router)
export type ChatAIAssistantMode =
    | "improve_professional"
    | "improve_friendly"
    | "improve_persuasive"
    | "fix_grammar"
    | "translate_en"
    | "translate_es"
    | "translate_pt"
    | "suggest_reply"
    | "summarize_chat";

export async function runChatAIAssistant(
    mode: ChatAIAssistantMode,
    inputText: string,
    recentMessages: { fromMe: boolean; sender?: string; content: string }[] = [],
    contactName?: string,
    customKeys?: CustomFreeLLMKeys
): Promise<{
    result: string;
    suggestions?: string[];
    provider: string;
    model: string;
    isLocalFallback?: boolean;
}> {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const cleanInput = (inputText || "").trim();
    const formattedHistory = recentMessages
        .slice(-15)
        .map(m => `${m.fromMe ? "Atendente (Você)" : (m.sender || contactName || "Cliente")}: ${m.content}`)
        .join("\n");

    let systemPrompt =
        "Você é um assistente especialista em atendimento e vendas via WhatsApp no Brasil. Responda sempre em português do Brasil, de forma direta, natural para WhatsApp e sem introduções desnecessárias.";
    let userPrompt = "";

    switch (mode) {
        case "improve_professional":
            userPrompt = `Reescreva a mensagem abaixo tornando-a profissional, clara, cordial e bem estruturada para WhatsApp. Retorne APENAS o texto reescrito:\n\n"${cleanInput}"`;
            break;
        case "improve_friendly":
            userPrompt = `Reescreva a mensagem abaixo em um tom amigável, empático, humano e próximo para WhatsApp (pode usar 1 ou 2 emojis sutis). Retorne APENAS o texto reescrito:\n\n"${cleanInput}"`;
            break;
        case "improve_persuasive":
            userPrompt = `Reescreva a mensagem abaixo com foco comercial/vendas, persuasiva e orientada para ação no WhatsApp. Retorne APENAS o texto reescrito:\n\n"${cleanInput}"`;
            break;
        case "fix_grammar":
            userPrompt = `Corrija qualquer erro ortográfico, gramatical ou de pontuação na mensagem abaixo, mantendo o sentido original. Retorne APENAS o texto corrigido:\n\n"${cleanInput}"`;
            break;
        case "translate_en":
            userPrompt = `Traduza a mensagem abaixo para Inglês natural. Retorne APENAS a tradução:\n\n"${cleanInput}"`;
            break;
        case "translate_es":
            userPrompt = `Traduza a mensagem abaixo para Espanhol natural. Retorne APENAS a tradução:\n\n"${cleanInput}"`;
            break;
        case "translate_pt":
            userPrompt = `Traduza o texto abaixo para Português do Brasil natural. Retorne APENAS a tradução:\n\n"${cleanInput}"`;
            break;
        case "suggest_reply":
            systemPrompt =
                "Você é um especialista em atendimento rápido no WhatsApp. Gere exatamente 3 opções curtas e práticas de resposta para o atendente enviar agora, separadas pela linha '---'. Não numere nem adicione explicações.";
            userPrompt = `Histórico recente da conversa com ${contactName || "o contato"}:\n${formattedHistory || "(Sem mensagens recentes)"}\n\nGere 3 sugestões de resposta variadas (1ª direta/objetiva, 2ª cordial/consultiva, 3ª focada em próximo passo/fechamento), separadas apenas por '---':`;
            break;
        case "summarize_chat":
            userPrompt = `Analise o histórico abaixo da conversa com ${contactName || "o contato"} e faça um resumo executivo curto em tópicos (• Assunto principal, • Status atual, • Próximo passo recomendado):\n\n${formattedHistory || cleanInput}`;
            break;
    }

    try {
        const llmRes = await callFreeLLMWithFallback(
            [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            { customKeys, temperature: 0.65, maxTokens: 700 }
        );

        const cleaned = llmRes.content.replace(/^["']|["']$/g, "").trim();

        if (mode === "suggest_reply") {
            const parts = cleaned
                .split(/---+/)
                .map(s => s.trim().replace(/^[1-3][.)\-]\s*/, ""))
                .filter(Boolean);
            return {
                result: parts[0] || cleaned,
                suggestions: parts.length > 0 ? parts.slice(0, 3) : [cleaned],
                provider: llmRes.provider,
                model: llmRes.model
            };
        }

        return {
            result: cleaned,
            provider: llmRes.provider,
            model: llmRes.model
        };
    } catch {
        // Smart instant local fallback when no API key is configured yet
        const nameLabel = contactName ? contactName.split(" ")[0] : "tudo bem";
        if (mode === "suggest_reply") {
            const lastIncoming = [...recentMessages].reverse().find(m => !m.fromMe)?.content || "";
            const suggestions = [
                `Olá, ${nameLabel}! Recebi sua mensagem${lastIncoming ? ` sobre "${lastIncoming.slice(0, 40)}${lastIncoming.length > 40 ? "..." : ""}"` : ""}. Já estou verificando e te retorno em instantes! 👍`,
                `Perfeito, ${nameLabel}! Muito obrigado pelo retorno. Posso te ajudar com mais algum detalhe agora?`,
                `Combinado! Vou dar andamento por aqui e te aviso assim que estiver concluído. Qualquer dúvida estou à disposição! ✅`
            ];
            return {
                result: suggestions[0],
                suggestions,
                provider: "Assistente Local ZapFlow",
                model: "Modo Instantâneo (Adicione chave grátis Groq/Gemini para IA 70B)",
                isLocalFallback: true
            };
        }

        if (mode === "summarize_chat") {
            const total = recentMessages.length;
            const incomingCount = recentMessages.filter(m => !m.fromMe).length;
            const outgoingCount = total - incomingCount;
            const last3 = recentMessages.slice(-3).map(m => `• ${m.fromMe ? "Você" : (contactName || "Contato")}: ${m.content.slice(0, 90)}`).join("\n");
            return {
                result: `📋 *Resumo da Conversa (${contactName || "Contato"})*\n• Mensagens analisadas: ${total} (${incomingCount} recebidas / ${outgoingCount} enviadas)\n• Últimas interações:\n${last3 || "• Nenhuma mensagem recente"}`,
                provider: "Assistente Local ZapFlow",
                model: "Modo Instantâneo",
                isLocalFallback: true
            };
        }

        // Local text polishing for draft modes
        const base = cleanInput || `Olá, ${nameLabel}! Como posso ajudar você hoje?`;
        const cap = base.charAt(0).toUpperCase() + base.slice(1);
        const endsWithPunct = /[.!?…]$/.test(cap);
        const punctuated = endsWithPunct ? cap : `${cap}.`;

        let polished = punctuated;
        if (mode === "improve_professional") {
            polished = `Prezado(a) ${contactName || ""},\n\n${punctuated}\n\nFico à disposição para qualquer dúvida.`;
        } else if (mode === "improve_friendly") {
            polished = `Oi, ${nameLabel}! 😊\n\n${punctuated}\n\nQualquer coisa é só me chamar!`;
        } else if (mode === "improve_persuasive") {
            polished = `✨ *${nameLabel}*, confira:\n\n${punctuated}\n\nVamos aproveitar e garantir agora mesmo? Me confirme por aqui! 🚀`;
        }

        return {
            result: polished.trim(),
            provider: "Assistente Local ZapFlow",
            model: "Modo Instantâneo",
            isLocalFallback: true
        };
    }
}

// Transcribe WhatsApp Voice Note using Free Groq Whisper Large V3 Turbo or OpenAI Whisper (#C30)
export async function transcribeChatAudioMessage(
    audioUrl: string,
    customKeys?: CustomFreeLLMKeys,
    audioBase64?: string
): Promise<{ text: string; provider: string }> {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const groqKey = customKeys?.groqApiKey?.trim() || process.env.GROQ_API_KEY?.trim();
    const openaiKey = customKeys?.openaiApiKey?.trim() || process.env.OPENAI_API_KEY?.trim();

    if (!groqKey && !openaiKey) {
        throw new Error(
            "Para transcrever áudios com Whisper IA, informe sua chave gratuita da Groq no botão ✨ IA -> Configurar Chaves (obtenha grátis em console.groq.com)."
        );
    }

    // Resolve audio buffer from client base64, /api/media/{filename}, or external URL
    let audioBuffer: Buffer | null = null;
    let fileName = "audio.ogg";

    if (audioBase64) {
        try {
            const clean = audioBase64.replace(/^data:[^;]+;base64,/, "");
            audioBuffer = Buffer.from(clean, "base64");
            fileName = "voice-note.ogg";
        } catch {}
    }

    if (!audioBuffer && audioUrl.includes("/api/media/")) {
        const rawFilename = decodeURIComponent(audioUrl.split("/api/media/").pop()?.split("?")[0] || "");
        if (rawFilename && !rawFilename.includes("..")) {
            fileName = rawFilename;
            let candidatePath = path.join(mediaDir, rawFilename);
            if (!existsSync(candidatePath)) {
                const base = rawFilename.replace(/\.[^.]+$/, "");
                for (const ext of [".ogg", ".opus", ".mp3", ".m4a", ".wav", ".mp4", ".bin"]) {
                    const alt = path.join(mediaDir, `${base}${ext}`);
                    if (existsSync(alt)) {
                        candidatePath = alt;
                        fileName = `${base}${ext === ".bin" ? ".ogg" : ext}`;
                        break;
                    }
                }
            }
            if (existsSync(candidatePath)) {
                audioBuffer = await readFile(candidatePath);
            } else {
                // Check if the message row in the DB has a base64 Data URL or mediaUrl
                const rawKeyId = rawFilename.replace(/\.[^.]+$/, "").split("-").pop();
                if (rawKeyId) {
                    try {
                        const dbMsg = await prisma.message.findFirst({
                            where: { keyId: rawKeyId },
                            select: { mediaUrl: true }
                        });
                        if (dbMsg?.mediaUrl && dbMsg.mediaUrl.startsWith("data:")) {
                            const clean = dbMsg.mediaUrl.replace(/^data:[^;]+;base64,/, "");
                            audioBuffer = Buffer.from(clean, "base64");
                        }
                    } catch {}
                }
            }
        }
    }

    if (!audioBuffer && audioUrl.startsWith("data:")) {
        try {
            const clean = audioUrl.replace(/^data:[^;]+;base64,/, "");
            audioBuffer = Buffer.from(clean, "base64");
        } catch {}
    }

    if (!audioBuffer && (audioUrl.startsWith("http://") || audioUrl.startsWith("https://"))) {
        try {
            const resp = await fetch(audioUrl);
            if (resp.ok) {
                audioBuffer = Buffer.from(await resp.arrayBuffer());
            }
        } catch {}
    }

    if (!audioBuffer) {
        throw new Error("Arquivo de áudio não encontrado no servidor para transcrição.");
    }

    const formData = new FormData();
    const uint8 = new Uint8Array(audioBuffer);
    const blob = new Blob([uint8], { type: "audio/ogg" });
    formData.append("file", blob, fileName.endsWith(".bin") ? "audio.ogg" : fileName);
    formData.append("model", groqKey ? "whisper-large-v3-turbo" : "whisper-1");
    formData.append("language", "pt");
    formData.append("response_format", "json");

    const endpoint = groqKey
        ? "https://api.groq.com/openai/v1/audio/transcriptions"
        : "https://api.openai.com/v1/audio/transcriptions";

    const res = await fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${groqKey || openaiKey}`
        },
        body: formData
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Falha na transcrição Groq Whisper (HTTP ${res.status}): ${errText.slice(0, 120)}`);
    }

    const data = await res.json();
    const text = (data?.text || "").trim();
    if (!text) {
        throw new Error("Não foi possível identificar fala audível nesta gravação.");
    }

    return {
        text,
        provider: "Groq Whisper Large V3 Turbo (Free)"
    };
}

