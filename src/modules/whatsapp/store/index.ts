import { prisma } from "@/lib/prisma";
import type { WASocket, WAMessage, Contact } from "@whiskeysockets/baileys";
import { normalizeMessageContent } from "@whiskeysockets/baileys";
import { onMessageReceived, onMessageSent, dispatchWebhook, downloadAndSaveMedia, extractMediaMessage } from "@/lib/webhook";
import { handleBotCommand, setSessionStartTime } from "../bot/command-handler";
import { resolveToPhoneJid, isLidJid, normalizeJid } from "@/lib/jid-utils";

import { Server } from "socket.io";
import { logger } from "@/lib/logger";

export const bindSessionStore = (sock: WASocket, sessionId: string, io: Server | null) => {
    // Set start time for uptime command
    setSessionStartTime(sessionId);

    // First, get the database Session ID (cuid)
    let dbSessionId: string | null = null;

    // Initialize by fetching the session ID
    (async () => {
        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });
        if (session) {
            dbSessionId = session.id;
            logger.info("Store", `Message store initialized for session ${sessionId} (db: ${dbSessionId})`);
        } else {
            logger.error("Store", `Session ${sessionId} not found for message store`);
        }
    })();

    // Handle Messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // Process all message types: notify, append, and history sync
        if (type !== 'notify' && type !== 'append') {
            // For history sync, we still want to save messages
            logger.debug("Store", `Received ${messages.length} messages of type: ${type}`);
        }

        // Emit to socket room for real-time frontend updates
        if (type === 'notify' || type === 'append') {
            io?.to(sessionId).emit('message.upsert', { messages, type });
        }

        // Ensure we have the database session ID
        if (!dbSessionId) {
            const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
            if (!session) return;
            dbSessionId = session.id;
        }

        const processedMessages = [];

        // Fetch Bot Config for auto-read & welcome message
        const config = await prisma.botConfig.findUnique({
            where: { sessionId: dbSessionId }
        });

        for (const msg of messages) {
            try {
                // Auto Read Logic
                if (type === 'notify' && (config as any)?.autoRead && !msg.key.fromMe) {
                    await sock.readMessages([msg.key]);
                }

                const savedMessage = await processAndSaveMessage(msg, dbSessionId, sessionId, type === 'notify', sock, config, io);
                if (savedMessage) {
                    processedMessages.push(savedMessage);
                }

                // Execute Bot Commands (Only for Notify / New Messages)
                if (type === 'notify' && savedMessage) {
                    // Run in background, don't await strictly to not block saving
                    handleBotCommand(sock, sessionId, msg).catch(e => logger.error("Bot", "Bot Handler Error", e));
                }
            } catch (error) {
                logger.error("Store", "Error saving message", error);
            }
        }

        // Emit to socket room for real-time frontend updates
        if (processedMessages.length > 0) {
            // Serialize for frontend: convert Date to ISO string
            const serialized = processedMessages.map((m: any) => ({
                ...m,
                timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp
            }));
            logger.debug("Socket", `Emitting message.update for ${serialized.length} messages in session ${sessionId}`);
            io?.to(sessionId).emit('message.update', serialized);
        }
    });

    // Handle Message History Sync (when connecting for the first time or syncing)
    sock.ev.on('messaging-history.set', async ({ messages, chats, contacts, isLatest }) => {
        logger.info("Store", `History sync: ${messages?.length || 0} messages, ${chats?.length || 0} chats, ${contacts?.length || 0} contacts, latest: ${isLatest}`);

        // Ensure we have the database session ID
        if (!dbSessionId) {
            const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
            if (!session) return;
            dbSessionId = session.id;
        }

        // Save all historical messages
        if (messages && messages.length > 0) {
            logger.info("Store", `Syncing ${messages.length} historical messages...`);
            for (const msg of messages) {
                try {
                    await processAndSaveMessage(msg, dbSessionId, sessionId, false, sock, undefined, io);
                } catch (error) {
                    logger.error("Store", "Error saving historical message", error);
                }
            }
            logger.success("Store", `Finished syncing ${messages.length} historical messages`);
        }


        // Note: Contacts and Chats are synced by src/modules/whatsapp/store/contacts.ts
        // We only handle messages here to avoid P2002 Unique Constraint Race Conditions.
        logger.debug("Store", `Finished syncing messages`);
    });

    // Handle Contacts Upsert
    sock.ev.on('contacts.upsert', async (contacts) => {
        // Ensure we have the database session ID
        if (!dbSessionId) {
            const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
            if (!session) return;
            dbSessionId = session.id;
        }

        for (const c of contacts) {
            try {
                if (!c.id) continue;
                await prisma.contact.upsert({
                    where: { sessionId_jid: { sessionId: dbSessionId, jid: c.id } },
                    create: {
                        sessionId: dbSessionId,
                        jid: c.id,
                        // @ts-ignore
                        lid: c.lid || undefined,
                        name: c.name || c.notify || c.verifiedName,
                        notify: c.notify,
                        // @ts-ignore
                        verifiedName: c.verifiedName,
                        profilePic: (c.imgUrl && typeof c.imgUrl === "string" && c.imgUrl.startsWith("http")) ? c.imgUrl : undefined,
                        data: c as any
                    },
                    update: {
                        // @ts-ignore
                        lid: c.lid || undefined,
                        name: c.name || undefined,
                        notify: c.notify || undefined,
                        // @ts-ignore
                        verifiedName: c.verifiedName || undefined,
                        profilePic: (c.imgUrl && typeof c.imgUrl === "string" && c.imgUrl.startsWith("http")) ? c.imgUrl : undefined,
                        data: c as any
                    }
                });

                // Dispatch webhook for contact update
                dispatchWebhook(sessionId, "contact.update", { jid: c.id, name: c.name, notify: c.notify });
            } catch (e) {
                logger.error("Store", "Error saving contact", e);
            }
        }
    });

    // Handle Message Status Updates
    sock.ev.on('messages.update', async (updates) => {
        if (!dbSessionId) return;

        for (const update of updates) {
            try {
                const keyId = update.key?.id;
                if (!keyId) continue;

                const statusMap: Record<number, string> = {
                    0: 'PENDING',
                    1: 'SENT',
                    2: 'DELIVERED',
                    3: 'READ',
                    4: 'READ', // Played
                };

                const status = statusMap[update.update?.status || 0] || 'PENDING';

                await prisma.message.updateMany({
                    where: { sessionId: dbSessionId, keyId },
                    data: { status: status as any }
                });

                // Emit real-time status checkmarks (SENT -> DELIVERED -> READ) to frontend
                io?.to(sessionId).emit("message.status", {
                    keyId,
                    remoteJid: update.key?.remoteJid,
                    status
                });

                // Dispatch webhook for message status update
                dispatchWebhook(sessionId, "message.status", {
                    keyId,
                    remoteJid: update.key?.remoteJid,
                    status
                });
            } catch (e) {
                logger.error("Store", "Error updating message status", e);
            }
        }
    });

    // Handle Group Updates
    sock.ev.on('groups.update', async (updates) => {
        if (!dbSessionId) return;

        for (const update of updates) {
            try {
                if (!update.id) continue;
                
                // Keep DB in sync
                const updateData: any = {};
                if (update.subject !== undefined) updateData.subject = update.subject;
                if (update.desc !== undefined) updateData.description = update.desc;
                if (update.restrict !== undefined) updateData.restrict = update.restrict;
                if (update.announce !== undefined) updateData.announce = update.announce;
                if (update.owner !== undefined) updateData.ownerJid = update.owner;
                if (update.linkedParent !== undefined) updateData.linkedParentJid = update.linkedParent;
                if (update.isCommunity !== undefined) updateData.isCommunity = update.isCommunity;

                if (Object.keys(updateData).length > 0) {
                    await prisma.group.updateMany({
                        where: { sessionId: dbSessionId, jid: update.id },
                        data: updateData
                    });
                }
                
                // Trigger webhook
                dispatchWebhook(sessionId, "group.update", {
                    jid: update.id,
                    ...update
                });
            } catch (e) {
                logger.error("Store", "Error in groups.update handling", e);
            }
        }
    });

    // Handle Group Participants Update
    sock.ev.on('group-participants.update', async (update) => {
        if (!dbSessionId || !update.id) return;

        try {
            // update.id is the group JID
            // update.participants is array of JIDs
            // update.action is 'add', 'remove', 'promote', 'demote'
            dispatchWebhook(sessionId, "group.participant", {
                jid: update.id,
                action: update.action,
                participants: update.participants
            });
            
            // To properly resync the group participants in DB, it's safer to re-fetch the entire group metadata
            // But we don't await strictly to not block the socket
            sock.groupMetadata(update.id).then(async (g) => {
                await prisma.group.updateMany({
                    where: { sessionId: dbSessionId as string, jid: update.id as string },
                    data: { participants: g.participants as any }
                });
            }).catch(e => {
                 logger.debug("Store", "Failed to refresh group participants metadata", e);
            });
        } catch (e) {
            logger.error("Store", "Error in group-participants.update handling", e);
        }
    });

    // Handle Presence Update (typing/recording/online)
    sock.ev.on('presence.update', async ({ id, presences }) => {
        try {
            io?.to(sessionId).emit('presence.update', { id, presences });
        } catch {
            // Ignore socket emit error
        }
    });
};

async function processAndSaveMessage(
    msg: WAMessage,
    dbSessionId: string,
    sessionId: string,
    triggerWebhook: boolean,
    sock?: WASocket,
    config?: any,
    io?: Server | null
) {
    const keyId = msg.key.id;
    const remoteJid = msg.key.remoteJid;
    const fromMe = msg.key.fromMe;
    const pushName = msg.pushName;
    const timestamp = msg.messageTimestamp
        ? new Date((typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : Number(msg.messageTimestamp)) * 1000)
        : new Date();

    // Filter out Protocol & Empty Messages
    if (!msg.message) return false;
    if (!keyId || !remoteJid) return false;

    // Ignore specific technical message types
    const messageKeys = Object.keys(msg.message);

    // Check for message edit/revoke protocol messages FIRST
    if (messageKeys.includes('protocolMessage')) {
        const pMessage = msg.message.protocolMessage;
        const targetKeyId = pMessage?.key?.id;

        // Message Edit (Type 14)
        if (pMessage?.type === 14 && targetKeyId) {
            const editContent = pMessage?.editedMessage;
            if (editContent) {
                // Determine new text
                const normalizedEdit = normalizeMessageContent(editContent);
                let newText = "";
                if (normalizedEdit?.conversation) newText = normalizedEdit.conversation;
                else if (normalizedEdit?.extendedTextMessage?.text) newText = normalizedEdit.extendedTextMessage.text;

                // Update DB safely
                await prisma.message.updateMany({
                    where: { sessionId: dbSessionId, keyId: targetKeyId },
                    data: { content: newText } // Note: we don't update timestamp of original
                });

                // Emit real-time edit to frontend socket
                try {
                    const io = (global as any).io;
                    if (io) {
                        io.to(sessionId).emit("message.edit", {
                            keyId: targetKeyId,
                            newContent: newText,
                            isEdited: true
                        });
                    }
                } catch {}

                // Trigger Webhook
                if (triggerWebhook) {
                    dispatchWebhook(sessionId, "message.edited", {
                        keyId: targetKeyId,
                        newContent: newText,
                        remoteJid,
                        fromMe
                    });
                }
            }
            return null; // Stop processing as new message
        }

        // Message Revoke/Deleted (Type 0)
        if (pMessage?.type === 0 && targetKeyId) {
            // Check anti-delete config
            let antiDeleteEnabled = false;
            try {
                const s = await prisma.session.findUnique({
                    where: { sessionId },
                    select: { config: true }
                });
                antiDeleteEnabled = !!(s?.config as any)?.antiDelete;
            } catch {}

            if (antiDeleteEnabled) {
                // Anti-delete: read original, keep content, append marker
                const orig = await prisma.message.findFirst({
                    where: { sessionId: dbSessionId, keyId: targetKeyId },
                    select: { content: true }
                });
                const preserved = (orig?.content || "") + "\n\n🛡️ [Deleted by sender — preserved]";
                await prisma.message.updateMany({
                    where: { sessionId: dbSessionId, keyId: targetKeyId },
                    data: { content: preserved }
                });
                // Re-fetch & re-emit so frontend updates
                const updated = await prisma.message.findFirst({
                    where: { sessionId: dbSessionId, keyId: targetKeyId }
                });
                if (updated) {
                    io?.to(sessionId).emit("message.update", [{
                        ...updated,
                        timestamp: updated.timestamp instanceof Date ? updated.timestamp.toISOString() : updated.timestamp
                    }]);
                }
            } else {
                // Normal: mark as deleted
                await prisma.message.updateMany({
                    where: { sessionId: dbSessionId, keyId: targetKeyId },
                    data: { content: "[This message was deleted]", status: "FAILED" }
                });
            }

            // Trigger Webhook
            if (triggerWebhook) {
                dispatchWebhook(sessionId, "message.deleted", {
                    keyId: targetKeyId,
                    remoteJid,
                    fromMe
                });
            }
            return null;
        }
    }

    const ignoredTypes = [
        'protocolMessage',
        'senderKeyDistributionMessage',
        'reactionMessage', // Optional: User might want reactions, but usually "kosong" means junk
        'keepInChatMessage'
    ];

    // If message only contains ignored types, skip (since edit and revoke handled above)
    if (messageKeys.every(k => ignoredTypes.includes(k))) {
        logger.debug("Store", `Skipping technical message: ${keyId} (${messageKeys.join(', ')})`);
        return null;
    }

    // Check if message already exists to avoid duplicates
    // Baileys 'notify' event can sometimes trigger multiple times or for history
    // Baileys 'notify' event can sometimes trigger multiple times or for history
    const existingMessage = await prisma.message.findUnique({
        where: { sessionId_keyId: { sessionId: dbSessionId, keyId: keyId! } },
        select: { id: true, status: true, mediaUrl: true, type: true }
    });

    if (existingMessage) {
        // If existing message is media and mediaUrl is missing, attempt recovery
        const isMedia = ['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'STICKER'].includes(existingMessage.type);
        if (isMedia && !existingMessage.mediaUrl) {
            try {
                const recoveredUrl = await downloadAndSaveMedia(msg, sessionId);
                if (recoveredUrl) {
                    await prisma.message.update({
                        where: { id: existingMessage.id },
                        data: { mediaUrl: recoveredUrl }
                    });
                    logger.success("Store", `Recovered missing mediaUrl for message ${keyId}: ${recoveredUrl}`);
                }
            } catch (e) {
                // Ignore recovery failure
            }
        }

        // Message exists! Update status if changed, but DO NOT re-trigger webhooks/bot
        if (fromMe && existingMessage.status !== 'SENT') {
            await prisma.message.update({
                where: { id: existingMessage.id },
                data: { status: 'SENT' }
            });
        }
        // Return null to indicate "Not New"
        return null;
    }

    // Debug fromMe issue (Keep this for a while)
    if (fromMe === undefined || fromMe === null) {
        logger.warn("Store", `[DEBUG] Message ${keyId} has fromMe=${fromMe}. Key:`, msg.key);
    }

    const mediaInfo = extractMediaMessage(msg.message);
    const messageContent = normalizeMessageContent(msg.message);
    let text = "";
    let messageType = "TEXT";

    // Extract content based on message type (with recursive wrapper unwrapping for media)
    if (mediaInfo) {
        if (mediaInfo.type === 'imageMessage') {
            messageType = "IMAGE";
            text = mediaInfo.media.caption || "";
        } else if (mediaInfo.type === 'videoMessage') {
            messageType = "VIDEO";
            text = mediaInfo.media.caption || "";
        } else if (mediaInfo.type === 'audioMessage') {
            messageType = "AUDIO";
        } else if (mediaInfo.type === 'documentMessage') {
            messageType = "DOCUMENT";
            text = mediaInfo.media.fileName || "";
        } else if (mediaInfo.type === 'stickerMessage') {
            messageType = "STICKER";
        }
    } else if (messageContent?.conversation) {
        text = messageContent.conversation;
    } else if (messageContent?.extendedTextMessage?.text) {
        text = messageContent.extendedTextMessage.text;
    } else if (messageContent?.locationMessage || (messageContent as any)?.liveLocationMessage) {
        const loc = messageContent?.locationMessage || (messageContent as any)?.liveLocationMessage;
        messageType = "LOCATION";
        const lat = loc?.degreesLatitude ?? "";
        const lng = loc?.degreesLongitude ?? "";
        const locName = loc?.name || loc?.caption || "";
        const locAddress = loc?.address || "";
        text = locName || locAddress ? `${lat},${lng}|${locName}|${locAddress}` : `${lat},${lng}`;
    } else if (messageContent?.contactMessage || (messageContent as any)?.contactsArrayMessage) {
        messageType = "CONTACT";
        const cMsg = messageContent?.contactMessage || (messageContent as any)?.contactsArrayMessage?.contacts?.[0];
        const dName = cMsg?.displayName || "Contato";
        const vcard: string = cMsg?.vcard || "";
        const waidMatch = vcard.match(/waid=(\d+)/i);
        const telMatch = vcard.match(/TEL[^:]*:([+\d\s\-()]+)/i);
        const extractedPhone = waidMatch?.[1] || (telMatch?.[1] ? telMatch[1].replace(/\D/g, "") : "");
        text = extractedPhone ? `${dName}|${extractedPhone}` : dName;
    } else if ((messageContent as any)?.pollCreationMessage || (messageContent as any)?.pollCreationMessageV2 || (messageContent as any)?.pollCreationMessageV3) {
        const poll = (messageContent as any)?.pollCreationMessage || (messageContent as any)?.pollCreationMessageV2 || (messageContent as any)?.pollCreationMessageV3;
        messageType = "POLL";
        const pollTitle = poll?.name || "Enquete";
        const pollOpts = Array.isArray(poll?.options) ? poll.options.map((o: any) => o?.optionName || "").filter(Boolean) : [];
        text = `${pollTitle}|${pollOpts.join(";;")}`;
    }

    // Determine effective participant for groups
    // Determine effective participant for groups with standard logic
    const isGroup = remoteJid.endsWith("@g.us");
    const remoteJidAlt = msg.key.remoteJidAlt; // LID/Phone JID handling
    let senderJid = fromMe ? undefined : (isGroup ? (msg.key.participant || msg.participant) : remoteJid);

    // Prefer remoteJidAlt for DMs if available (matches webhook logic)
    if (!fromMe && !isGroup && remoteJidAlt) {
        senderJid = remoteJidAlt;
    }

    // --- Normalize LID JIDs to @s.whatsapp.net ---
    let normalizedRemoteJid = remoteJid;
    if (isLidJid(remoteJid)) {
        normalizedRemoteJid = await resolveToPhoneJid(remoteJid, dbSessionId, remoteJidAlt);
    }
    if (senderJid && isLidJid(senderJid)) {
        senderJid = await resolveToPhoneJid(senderJid, dbSessionId, remoteJidAlt);
    }

    const finalNormalizedRemoteJid = normalizeJid(normalizedRemoteJid);

    // Extract contextInfo (quoted message ID) BEFORE downloading media so we can emit instant socket update
    let quoteId: string | null = null;
    let quotedThumbnail: string | null = null;
    let quotedPreviewObj: {
        keyId: string;
        content: string | null;
        fromMe: boolean;
        senderJid: string | null;
        pushName: string | null;
        type: string;
        mediaUrl: string | null;
    } | null = null;

    if (msg.message) {
        const msgObj = msg.message as any;
        for (const key of Object.keys(msgObj)) {
            const inner = msgObj[key];
            if (inner && typeof inner === 'object' && inner !== null && 'contextInfo' in inner) {
                const contextInfo = (inner as any).contextInfo;
                if (contextInfo?.stanzaId) {
                    quoteId = contextInfo.stanzaId;
                    const qMsg = contextInfo.quotedMessage;
                    if (qMsg) {
                        const thumb = qMsg.imageMessage?.jpegThumbnail ||
                                      qMsg.videoMessage?.jpegThumbnail ||
                                      qMsg.documentMessage?.jpegThumbnail;
                        if (thumb) {
                            try {
                                const buf = Buffer.isBuffer(thumb) ? thumb : Buffer.from(thumb);
                                quotedThumbnail = `data:image/jpeg;base64,${buf.toString('base64')}`;
                            } catch {}
                        }

                        let qType = "TEXT";
                        let qContent: string | null = null;
                        if (qMsg.imageMessage) {
                            qType = "IMAGE";
                            qContent = qMsg.imageMessage.caption || null;
                        } else if (qMsg.videoMessage) {
                            qType = "VIDEO";
                            qContent = qMsg.videoMessage.caption || null;
                        } else if (qMsg.documentMessage) {
                            qType = "DOCUMENT";
                            qContent = qMsg.documentMessage.fileName || qMsg.documentMessage.caption || null;
                        } else if (qMsg.stickerMessage) {
                            qType = "STICKER";
                        } else if (qMsg.audioMessage) {
                            qType = "AUDIO";
                        } else if (qMsg.conversation) {
                            qContent = qMsg.conversation;
                        } else if (qMsg.extendedTextMessage) {
                            qContent = qMsg.extendedTextMessage.text || null;
                        }

                        quotedPreviewObj = {
                            keyId: quoteId!,
                            content: qContent,
                            fromMe: Boolean(contextInfo.participant && (contextInfo.participant.includes(sessionId) || contextInfo.participant.includes("me"))),
                            senderJid: contextInfo.participant || null,
                            pushName: null,
                            type: qType,
                            mediaUrl: quotedThumbnail
                        };

                        if (dbSessionId && quoteId) {
                            prisma.message.upsert({
                                where: {
                                    sessionId_keyId: {
                                        sessionId: dbSessionId,
                                        keyId: quoteId
                                    }
                                },
                                update: {
                                    ...(quotedThumbnail ? { mediaUrl: quotedThumbnail } : {})
                                },
                                create: {
                                    sessionId: dbSessionId,
                                    remoteJid: finalNormalizedRemoteJid,
                                    senderJid: contextInfo.participant || null,
                                    fromMe: Boolean(contextInfo.participant && (contextInfo.participant.includes(sessionId) || contextInfo.participant.includes("me"))),
                                    keyId: quoteId,
                                    pushName: null,
                                    type: qType as any,
                                    content: qContent,
                                    mediaUrl: quotedThumbnail,
                                    status: "SENT",
                                    timestamp: new Date()
                                }
                            }).catch(() => {});
                        }
                    }
                    break;
                }
            }
        }
    }

    // ⚡ INSTANT REAL-TIME SOCKET EMIT (< 15ms) before media download / DB write finishes!
    if (triggerWebhook && io) {
        let inlineMediaPreview: string | null = null;
        if (mediaInfo?.media?.jpegThumbnail) {
            try {
                const buf = Buffer.isBuffer(mediaInfo.media.jpegThumbnail)
                    ? mediaInfo.media.jpegThumbnail
                    : Buffer.from(mediaInfo.media.jpegThumbnail);
                inlineMediaPreview = `data:image/jpeg;base64,${buf.toString('base64')}`;
            } catch {}
        }

        io.to(sessionId).emit('message.update', [{
            id: keyId,
            sessionId: dbSessionId,
            remoteJid: finalNormalizedRemoteJid,
            senderJid,
            fromMe: fromMe || false,
            keyId,
            pushName,
            type: messageType,
            content: text,
            mediaUrl: inlineMediaPreview,
            status: fromMe ? "SENT" : "PENDING",
            timestamp: timestamp.toISOString(),
            quoteId,
            quoted: quotedPreviewObj
        }]);
    }

    // Download Media (to save URL to DB)
    let fileUrl: string | null = null;
    try {
        fileUrl = await downloadAndSaveMedia(msg, sessionId);
    } catch (e) {
        logger.error("Store", "Error downloading media in store", e);
    }

    try {
        const newMessage = await prisma.message.create({
            data: {
                sessionId: dbSessionId,
                remoteJid: finalNormalizedRemoteJid,
                senderJid,
                fromMe: fromMe || false,
                keyId,
                pushName,
                type: messageType as any,
                content: text,
                mediaUrl: fileUrl, // Save Media URL
                status: fromMe ? "SENT" : "PENDING",
                timestamp,
                quoteId
            }
        });

        // ⚡ INSTANT MEDIA READY EMIT: Notify frontend that mediaUrl is downloaded and ready for playback
        if (triggerWebhook && io && fileUrl) {
            io.to(sessionId).emit('message.update', [{
                id: keyId,
                sessionId: dbSessionId,
                remoteJid: finalNormalizedRemoteJid,
                senderJid,
                fromMe: fromMe || false,
                keyId,
                pushName,
                type: messageType,
                content: text,
                mediaUrl: fileUrl,
                status: fromMe ? "SENT" : "PENDING",
                timestamp: timestamp.toISOString(),
                quoteId,
                quoted: quotedPreviewObj
            }]);
        }

        // If this message quotes an image and carries a thumbnail, backfill the original message
        if (quoteId && quotedThumbnail) {
            void prisma.message.updateMany({
                where: {
                    sessionId: dbSessionId,
                    keyId: quoteId,
                    mediaUrl: null
                },
                data: { mediaUrl: quotedThumbnail }
            }).catch(() => {});
        }
        
        // Non-blocking background Contact & Group Participant Upsert + Welcome Message
        const finalRemoteJid = finalNormalizedRemoteJid;
        void (async () => {
            try {
                if (remoteJid && !remoteJid.includes('@g.us') && !remoteJid.includes('status@broadcast')) {
                    const contactJid = finalRemoteJid;
                    await prisma.contact.upsert({
                        where: { sessionId_jid: { sessionId: dbSessionId, jid: contactJid } },
                        create: {
                            sessionId: dbSessionId,
                            jid: contactJid,
                            notify: !fromMe ? pushName : undefined,
                            name: !fromMe ? pushName : undefined,
                            // @ts-ignore
                            remoteJidAlt: remoteJidAlt || undefined
                        },
                        update: !fromMe ? {
                            notify: pushName,
                            // @ts-ignore
                            remoteJidAlt: remoteJidAlt || undefined
                        } : {}
                    });

                    // Welcome Message Logic
                    if (!fromMe && triggerWebhook && config?.welcomeMessage && sock) {
                        const msgCount = await prisma.message.count({
                            where: { sessionId: dbSessionId, remoteJid: finalRemoteJid }
                        });
                        if (msgCount === 1) {
                            logger.info("Store", `Sending welcome message to ${finalRemoteJid}`);
                            await sock.sendMessage(finalRemoteJid, { text: config.welcomeMessage });
                        }
                    }
                } else if (isGroup && !fromMe && pushName) {
                    const effectiveParticipant = msg.key.participant || msg.participant;
                    if (effectiveParticipant) {
                        const participantJid = normalizeJid(effectiveParticipant);
                        await prisma.contact.upsert({
                            where: { sessionId_jid: { sessionId: dbSessionId, jid: participantJid } },
                            create: {
                                sessionId: dbSessionId,
                                jid: participantJid,
                                notify: pushName,
                                name: pushName,
                                // @ts-ignore
                                remoteJidAlt: remoteJidAlt || undefined,
                                // @ts-ignore
                                lid: isLidJid(effectiveParticipant) ? effectiveParticipant : undefined
                            },
                            update: {
                                notify: pushName,
                                // @ts-ignore
                                remoteJidAlt: remoteJidAlt || undefined,
                                // @ts-ignore
                                lid: isLidJid(effectiveParticipant) ? effectiveParticipant : undefined
                            }
                        });
                    }
                }
            } catch {
                // Ignore background contact upsert race conditions
            }
        })();

        // Trigger webhook for new messages only (not history sync)
        if (triggerWebhook) {
            if (fromMe) {
                onMessageSent(sessionId, msg, fileUrl).catch(e => logger.error("Webhook", "Error in onMessageSent", e));
            } else {
                onMessageReceived(sessionId, msg, fileUrl).catch(e => logger.error("Webhook", "Error in onMessageReceived", e));
            }
        }

        return {
            ...newMessage,
            quoted: quotedPreviewObj
        };
    } catch (e: any) {
        logger.error("Store", "Error saving message query", e);
        throw e;
    }
}
// Placeholder - verified that I need to find the logic first
