import { prisma } from "@/lib/prisma";
import type { WASocket, WAMessage, Contact } from "@whiskeysockets/baileys";
import { normalizeMessageContent, BufferJSON } from "@whiskeysockets/baileys";
import { onMessageReceived, onMessageSent, dispatchWebhook, downloadAndSaveMedia, extractMediaMessage } from "@/lib/webhook";
import { handleBotCommand, setSessionStartTime } from "../bot/command-handler";
import { resolveToPhoneJid, isLidJid, normalizeJid } from "@/lib/jid-utils";
import { calibrateFromWhatsAppTimestamp, getMonotonicChatTimestamp, getSyncedNow, getSyncedNowUnixSec } from "@/lib/wa-clock";

import { Server } from "socket.io";
import { logger } from "@/lib/logger";
import { upsertAndCrossLinkContact } from "./contacts";

export interface ContactPresenceState {
    status: string;
    lastSeen?: number;
    updatedAt: number;
}

const sessionPresenceCache = new Map<string, Map<string, ContactPresenceState>>();
const rawMediaMessagesCache = new Map<string, { msg: WAMessage; sessionId: string }>();
const localSentMediaCache = new Map<string, string>();

export function registerLocalSentMedia(keyId: string, fileUrl: string) {
    if (!keyId || !fileUrl) return;
    localSentMediaCache.set(keyId, fileUrl);
    if (localSentMediaCache.size > 500) {
        const oldest = localSentMediaCache.keys().next().value;
        if (oldest) localSentMediaCache.delete(oldest);
    }
}

export function getLocalSentMedia(keyId: string): string | undefined {
    return localSentMediaCache.get(keyId);
}

export function getRawMediaMessage(keyId: string): { msg: WAMessage; sessionId: string } | undefined {
    return rawMediaMessagesCache.get(keyId);
}

export function cacheRawMediaMessage(keyId: string, msg: WAMessage, sessionId: string) {
    if (!keyId) return;
    rawMediaMessagesCache.set(keyId, { msg, sessionId });
    if (rawMediaMessagesCache.size > 1500) {
        const oldestKey = rawMediaMessagesCache.keys().next().value;
        if (oldestKey) rawMediaMessagesCache.delete(oldestKey);
    }
}

export function getCachedPresence(sessionId: string, jids: string[]): ContactPresenceState | null {
    const map = sessionPresenceCache.get(sessionId);
    if (!map) return null;
    for (const j of jids) {
        if (!j) continue;
        const found = map.get(j) || map.get(j.split("@")[0]);
        if (found) return found;
    }
    return null;
}

export function setCachedPresence(sessionId: string, jid: string, state: ContactPresenceState) {
    let map = sessionPresenceCache.get(sessionId);
    if (!map) {
        map = new Map();
        sessionPresenceCache.set(sessionId, map);
    }
    map.set(jid, state);
    const bare = jid.split("@")[0];
    if (bare) map.set(bare, state);
}

export const bindSessionStore = (sock: WASocket, sessionId: string, io: Server | null) => {
    if ((sock as any)._storeBound) return;
    (sock as any)._storeBound = true;

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

                const savedMessage = await processAndSaveMessage(msg, dbSessionId, sessionId, type === 'notify', sock, config, io, true);
                if (savedMessage) {
                    processedMessages.push(savedMessage);
                    if (type === 'notify' && !msg.key.fromMe && savedMessage.remoteJid && !savedMessage.remoteJid.endsWith('@g.us')) {
                        const nowSec = Math.floor(Date.now() / 1000);
                        const activeState: ContactPresenceState = { status: 'available', lastSeen: nowSec, updatedAt: nowSec };
                        setCachedPresence(sessionId, savedMessage.remoteJid, activeState);
                        if (msg.key.remoteJid && msg.key.remoteJid !== savedMessage.remoteJid) {
                            setCachedPresence(sessionId, msg.key.remoteJid, activeState);
                        }
                        const altJid = (msg.key as any)?.remoteJidAlt;
                        if (altJid) setCachedPresence(sessionId, altJid, activeState);
                        io?.to(sessionId).emit('presence.update', {
                            id: savedMessage.remoteJid,
                            altJids: [savedMessage.remoteJid, msg.key.remoteJid, altJid].filter(Boolean),
                            presences: { [savedMessage.remoteJid]: { lastKnownPresence: 'available', lastSeen: nowSec } }
                        });
                    }
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
        logger.info("Store", `History sync received: ${messages?.length || 0} messages, ${chats?.length || 0} chats, ${contacts?.length || 0} contacts, latest: ${isLatest}`);

        // Ensure we have the database session ID
        if (!dbSessionId) {
            const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
            if (!session) return;
            dbSessionId = session.id;
        }

        // 1. Sync chats (Groups & 1-on-1 Chats)
        if (chats && chats.length > 0) {
            logger.info("Store", `Syncing ${chats.length} chats from history...`);
            const BATCH_SIZE = 25;
            for (let i = 0; i < chats.length; i += BATCH_SIZE) {
                const chunk = chats.slice(i, i + BATCH_SIZE);
                await Promise.all(
                    chunk.map(chat => {
                        if (!chat.id) return Promise.resolve();
                        if (chat.id.endsWith('@g.us')) {
                            return prisma.group.upsert({
                                where: { sessionId_jid: { sessionId: dbSessionId!, jid: chat.id } },
                                create: {
                                    sessionId: dbSessionId!,
                                    jid: chat.id,
                                    subject: chat.name || "Grupo"
                                },
                                update: {
                                    subject: chat.name || undefined
                                }
                            }).catch(() => {});
                        } else if (!chat.id.includes('@broadcast')) {
                            return prisma.contact.upsert({
                                where: { sessionId_jid: { sessionId: dbSessionId!, jid: chat.id } },
                                create: {
                                    sessionId: dbSessionId!,
                                    jid: chat.id,
                                    name: chat.name || undefined
                                },
                                update: {
                                    name: chat.name || undefined
                                }
                            }).catch(() => {});
                        }
                        return Promise.resolve();
                    })
                );
                await new Promise(r => setImmediate(r));
            }
        }

        // 2. Sync contacts from address book
        if (contacts && contacts.length > 0) {
            logger.info("Store", `Syncing ${contacts.length} contacts from history...`);
            const validContacts = contacts.filter(c => c.id && !c.id.includes('@broadcast'));
            const BATCH_SIZE = 25;
            for (let i = 0; i < validContacts.length; i += BATCH_SIZE) {
                const chunk = validContacts.slice(i, i + BATCH_SIZE);
                await Promise.all(
                    chunk.map(c => upsertAndCrossLinkContact(dbSessionId!, c))
                );
                await new Promise(r => setImmediate(r));
            }
        }

        // 3. Save historical messages with batching (up to 2500 recent messages)
        if (messages && messages.length > 0) {
            const MAX_HISTORY = 2500;
            const messagesToProcess = messages.length > MAX_HISTORY ? messages.slice(-MAX_HISTORY) : messages;
            logger.info("Store", `Syncing ${messagesToProcess.length} historical messages...`);

            const BATCH_SIZE = 30;
            const sevenDaysAgoSec = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
            for (let i = 0; i < messagesToProcess.length; i += BATCH_SIZE) {
                const batch = messagesToProcess.slice(i, i + BATCH_SIZE);
                await Promise.all(
                    batch.map(msg => {
                        const msgTs = msg.messageTimestamp
                            ? (typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : Number(msg.messageTimestamp))
                            : 0;
                        const isRecent = msgTs >= sevenDaysAgoSec;
                        return processAndSaveMessage(msg, dbSessionId!, sessionId, false, sock, undefined, io, isRecent).catch(e => {
                            logger.error("Store", "Error saving historical message", e?.message || e);
                        });
                    })
                );
                // Yield to Node.js event loop
                await new Promise(resolve => setImmediate(resolve));
            }
            logger.success("Store", `Finished syncing ${messagesToProcess.length} historical messages`);
        }

        // 4. Emit to frontend in real-time so conversation list appears automatically
        io?.to(sessionId).emit('chats.update');
        io?.to(sessionId).emit('message.update', []);
        logger.debug("Store", `Finished syncing history`);
    });

    // Handle Contacts Upsert
    sock.ev.on('contacts.upsert', async (contacts) => {
        // Ensure we have the database session ID
        if (!dbSessionId) {
            const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
            if (!session) return;
            dbSessionId = session.id;
        }

        const BATCH_SIZE = 25;
        for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
            const chunk = contacts.slice(i, i + BATCH_SIZE);
            await Promise.all(
                chunk.map(async (c) => {
                    try {
                        if (!c.id) return;
                        await upsertAndCrossLinkContact(dbSessionId!, c);
                        dispatchWebhook(sessionId, "contact.update", { jid: c.id, name: c.name, notify: c.notify });
                    } catch (e) {
                        logger.error("Store", "Error saving contact", e);
                    }
                })
            );
            await new Promise(r => setImmediate(r));
        }
        if (contacts.length > 0) {
            io?.to(sessionId).emit('chats.update');
        }
    });

    const applyMessageStatusUpgrade = async (keyId: string, remoteJid: string | null | undefined, status: string) => {
        const allowedPrevMap: Record<string, string[]> = {
            SENT: ['PENDING'],
            DELIVERED: ['PENDING', 'SENT'],
            READ: ['PENDING', 'SENT', 'DELIVERED'],
        };
        const allowedPrev = allowedPrevMap[status];
        if (!allowedPrev) return;

        const updated = await prisma.message.updateMany({
            where: {
                sessionId: dbSessionId!,
                keyId,
                status: { in: allowedPrev as any }
            },
            data: { status: status as any }
        });

        if (updated.count === 0) return;

        // Emit real-time status checkmarks (SENT -> DELIVERED -> READ) to frontend
        io?.to(sessionId).emit("message.status", {
            keyId,
            remoteJid,
            status
        });

        // Dispatch webhook for message status update
        dispatchWebhook(sessionId, "message.status", {
            keyId,
            remoteJid,
            status
        });
    };

    // Handle Message Status Updates (1-on-1 chats)
    sock.ev.on('messages.update', async (updates) => {
        if (!dbSessionId) return;

        for (const update of updates) {
            try {
                const keyId = update.key?.id;
                if (!keyId) continue;

                if (typeof update.update?.status !== 'number') continue;

                // Baileys WAMessageStatus: 0=ERROR, 1=PENDING, 2=SERVER_ACK, 3=DELIVERY_ACK, 4=READ, 5=PLAYED
                const statusMap: Record<number, string> = {
                    0: 'PENDING',
                    1: 'PENDING',
                    2: 'SENT',
                    3: 'DELIVERED',
                    4: 'READ',
                    5: 'READ', // Played
                };

                const status = statusMap[update.update.status] || 'PENDING';
                await applyMessageStatusUpgrade(keyId, update.key?.remoteJid, status);
            } catch (e) {
                logger.error("Store", "Error updating message status", e);
            }
        }
    });

    // Handle Group Receipt Updates (DELIVERED / READ in groups)
    sock.ev.on('message-receipt.update', async (updates) => {
        if (!dbSessionId) return;

        for (const item of updates) {
            try {
                const keyId = item.key?.id;
                if (!keyId || !item.receipt) continue;
                const status = (item.receipt.readTimestamp || item.receipt.playedTimestamp)
                    ? 'READ'
                    : item.receipt.receiptTimestamp
                        ? 'DELIVERED'
                        : null;
                if (!status) continue;
                await applyMessageStatusUpgrade(keyId, item.key?.remoteJid, status);
            } catch (e) {
                logger.error("Store", "Error updating group receipt status", e);
            }
        }
    });

    // Handle New / Upserted Groups (e.g. number added to a new group or created a group)
    sock.ev.on('groups.upsert', async (newGroups) => {
        if (!dbSessionId) return;
        for (const g of newGroups) {
            try {
                if (!g.id) continue;
                let fullMeta: any = g;
                if (!g.subject || !g.participants) {
                    fullMeta = await sock.groupMetadata(g.id).catch(() => g);
                }
                await prisma.group.upsert({
                    where: { sessionId_jid: { sessionId: dbSessionId, jid: g.id } },
                    create: {
                        sessionId: dbSessionId,
                        jid: g.id,
                        subject: fullMeta.subject || "Grupo",
                        description: fullMeta.desc || null,
                        ownerJid: fullMeta.owner || null,
                        creation: fullMeta.creation ? new Date(fullMeta.creation * 1000) : undefined,
                        restrict: Boolean(fullMeta.restrict),
                        announce: Boolean(fullMeta.announce),
                        participants: (fullMeta.participants || []) as any,
                        metadata: fullMeta as any,
                        isCommunity: Boolean(fullMeta.isCommunity),
                        linkedParentJid: fullMeta.linkedParent || null
                    },
                    update: {
                        subject: fullMeta.subject || undefined,
                        description: fullMeta.desc ?? undefined,
                        ownerJid: fullMeta.owner ?? undefined,
                        restrict: fullMeta.restrict !== undefined ? Boolean(fullMeta.restrict) : undefined,
                        announce: fullMeta.announce !== undefined ? Boolean(fullMeta.announce) : undefined,
                        participants: fullMeta.participants ? (fullMeta.participants as any) : undefined,
                        metadata: fullMeta as any,
                        isCommunity: fullMeta.isCommunity !== undefined ? Boolean(fullMeta.isCommunity) : undefined,
                        linkedParentJid: fullMeta.linkedParent ?? undefined
                    }
                });
                io?.to(sessionId).emit("groups.upsert", [{
                    jid: g.id,
                    subject: fullMeta.subject || "Grupo",
                    participants: fullMeta.participants || []
                }]);
                dispatchWebhook(sessionId, "group.update", { jid: g.id, ...fullMeta });
                logger.info("Store", `Synced new group ${g.id} (${fullMeta.subject || ""}) for session ${sessionId}`);
            } catch (e) {
                logger.error("Store", "Error in groups.upsert handling", e);
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
                    const updated = await prisma.group.updateMany({
                        where: { sessionId: dbSessionId, jid: update.id },
                        data: updateData
                    });
                    if (updated.count === 0) {
                        const g = await sock.groupMetadata(update.id).catch(() => null);
                        if (g) {
                            await prisma.group.upsert({
                                where: { sessionId_jid: { sessionId: dbSessionId, jid: g.id } },
                                create: {
                                    sessionId: dbSessionId,
                                    jid: g.id,
                                    subject: g.subject,
                                    description: g.desc,
                                    ownerJid: g.owner,
                                    creation: g.creation ? new Date(g.creation * 1000) : undefined,
                                    restrict: g.restrict,
                                    announce: g.announce,
                                    participants: g.participants as any,
                                    metadata: g as any,
                                    isCommunity: g.isCommunity || false,
                                    linkedParentJid: g.linkedParent || null
                                },
                                update: updateData
                            });
                        }
                    }
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
            
            // Upsert full group metadata so even if our number was just added to a brand-new group, it is immediately created in DB
            sock.groupMetadata(update.id).then(async (g) => {
                await prisma.group.upsert({
                    where: { sessionId_jid: { sessionId: dbSessionId as string, jid: g.id } },
                    create: {
                        sessionId: dbSessionId as string,
                        jid: g.id,
                        subject: g.subject,
                        description: g.desc,
                        ownerJid: g.owner,
                        creation: g.creation ? new Date(g.creation * 1000) : undefined,
                        restrict: g.restrict,
                        announce: g.announce,
                        participants: g.participants as any,
                        metadata: g as any,
                        isCommunity: g.isCommunity || false,
                        linkedParentJid: g.linkedParent || null
                    },
                    update: {
                        subject: g.subject,
                        description: g.desc,
                        ownerJid: g.owner,
                        restrict: g.restrict,
                        announce: g.announce,
                        participants: g.participants as any,
                        metadata: g as any,
                        isCommunity: g.isCommunity || false,
                        linkedParentJid: g.linkedParent || null
                    }
                });
                io?.to(sessionId).emit("groups.upsert", [{
                    jid: g.id,
                    subject: g.subject,
                    participants: g.participants || []
                }]);
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
            const nowSec = getSyncedNowUnixSec();
            const altJidsSet = new Set<string>();
            if (id) altJidsSet.add(id);

            if (id && !id.endsWith('@g.us')) {
                const bareId = id.split('@')[0];
                const sessionKeys = dbSessionId ? [sessionId, dbSessionId] : [sessionId];

                if (bareId) {
                    const authMappings = await prisma.authState.findMany({
                        where: {
                            sessionId: { in: sessionKeys },
                            key: { in: [`lid-mapping-${bareId}`, `lid-mapping-${bareId}_reverse`] }
                        },
                        select: { key: true, value: true }
                    }).catch(() => []);
                    for (const m of authMappings) {
                        const mappedVal = typeof m.value === 'string' ? m.value.replace(/"/g, '').trim() : '';
                        if (!mappedVal) continue;
                        if (m.key.endsWith('_reverse')) {
                            altJidsSet.add(mappedVal.includes('@') ? mappedVal : `${mappedVal}@s.whatsapp.net`);
                        } else {
                            altJidsSet.add(mappedVal.includes('@') ? mappedVal : `${mappedVal}@lid`);
                        }
                    }
                }

                if (dbSessionId) {
                    const lookupJids = Array.from(altJidsSet);
                    const contacts = await prisma.contact.findMany({
                        where: {
                            sessionId: dbSessionId,
                            OR: [
                                { jid: { in: lookupJids } },
                                { lid: { in: lookupJids } },
                                { remoteJidAlt: { in: lookupJids } }
                            ]
                        },
                        select: { jid: true, lid: true, remoteJidAlt: true, data: true }
                    }).catch(() => []);
                    for (const c of contacts) {
                        if (c.jid) altJidsSet.add(c.jid);
                        if (c.lid) altJidsSet.add(c.lid);
                        if (c.remoteJidAlt) altJidsSet.add(c.remoteJidAlt);
                    }
                }
            }

            const altJids = Array.from(altJidsSet);
            if (id && presences) {
                for (const [senderJid, p] of Object.entries(presences)) {
                    const status = p?.lastKnownPresence || 'unavailable';
                    const isOnline = status === 'available' || status === 'composing' || status === 'recording' || status === 'paused';
                    const prev = getCachedPresence(sessionId, [...altJids, senderJid]);
                    const lastSeen = isOnline ? nowSec : (p?.lastSeen || prev?.lastSeen || undefined);
                    const state: ContactPresenceState = { status, lastSeen, updatedAt: nowSec };
                    for (const aj of altJids) {
                        setCachedPresence(sessionId, aj, state);
                    }
                    if (senderJid && !altJidsSet.has(senderJid)) {
                        setCachedPresence(sessionId, senderJid, state);
                    }

                    // Persist real WhatsApp lastSeen in Contact.data so it survives page reloads & server restarts
                    if (lastSeen && dbSessionId && !id.endsWith('@g.us')) {
                        void prisma.contact.updateMany({
                            where: {
                                sessionId: dbSessionId,
                                OR: [
                                    { jid: { in: altJids } },
                                    { lid: { in: altJids } },
                                    { remoteJidAlt: { in: altJids } }
                                ]
                            },
                            data: {
                                data: { lastSeen } as any
                            }
                        }).catch(() => {});
                    }
                }
            }
            io?.to(sessionId).emit('presence.update', { id, altJids, presences });
        } catch {
            // Ignore socket emit error
        }
    });

    // Background Presence Subscription for active 1-on-1 contacts so "Visto por último" tracks when contacts open WhatsApp globally
    sock.ev.on('connection.update', async ({ connection }) => {
        if (connection === 'open') {
            setTimeout(async () => {
                try {
                    if (!dbSessionId) {
                        const s = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
                        if (s) dbSessionId = s.id;
                    }
                    if (!dbSessionId) return;

                    await sock.sendPresenceUpdate('available').catch(() => {});

                    const recentContacts = await prisma.contact.findMany({
                        where: {
                            sessionId: dbSessionId,
                            NOT: { jid: { endsWith: '@g.us' } }
                        },
                        orderBy: { updatedAt: 'desc' },
                        take: 50,
                        select: { jid: true, lid: true, remoteJidAlt: true, data: true }
                    });

                    // Seed in-memory cache from persisted Contact.data.lastSeen
                    const nowSec = getSyncedNowUnixSec();
                    const jidsToSubscribe = new Set<string>();
                    for (const c of recentContacts) {
                        if (c.jid && !c.jid.includes('broadcast')) jidsToSubscribe.add(c.jid);
                        if (c.lid) jidsToSubscribe.add(c.lid);
                        const savedLastSeen = (c.data as any)?.lastSeen;
                        if (typeof savedLastSeen === 'number' && savedLastSeen > 0) {
                            const existing = getCachedPresence(sessionId, [c.jid, c.lid || ''].filter(Boolean));
                            if (!existing) {
                                const seeded: ContactPresenceState = { status: 'unavailable', lastSeen: savedLastSeen, updatedAt: nowSec };
                                if (c.jid) setCachedPresence(sessionId, c.jid, seeded);
                                if (c.lid) setCachedPresence(sessionId, c.lid, seeded);
                            }
                        }
                    }

                    const subArray = Array.from(jidsToSubscribe).slice(0, 80);
                    if (subArray.length === 0) return;

                    // Load existing tctokens from authState
                    const tcKeys = subArray.map(j => `tctoken-${j}`);
                    const tcRecords = await prisma.authState.findMany({
                        where: {
                            sessionId: { in: [sessionId, dbSessionId] },
                            key: { in: tcKeys }
                        },
                        select: { key: true, value: true }
                    }).catch(() => []);

                    const tcMap = new Map<string, Buffer>();
                    for (const r of tcRecords) {
                        try {
                            const j = r.key.replace(/^tctoken-/, '');
                            const revived = JSON.parse(JSON.stringify(r.value), BufferJSON.reviver);
                            if (revived?.token && Buffer.isBuffer(revived.token)) {
                                tcMap.set(j, revived.token);
                            }
                        } catch {}
                    }

                    // Request privacy tokens for contacts that don't have one yet
                    const missingTokenJids = subArray.filter(j => j.endsWith('@s.whatsapp.net') && !tcMap.has(j)).slice(0, 25);
                    if (missingTokenJids.length > 0 && typeof (sock as any).getPrivacyTokens === 'function') {
                        await (sock as any).getPrivacyTokens(missingTokenJids).catch(() => {});
                    }

                    for (const targetJid of subArray) {
                        const token = tcMap.get(targetJid);
                        await sock.presenceSubscribe(targetJid, token).catch(() => {});
                    }
                } catch {}
            }, 4500);
        }
    });

    // Handle Incoming Voice/Video Calls (WhatsApp Web Call Notification + Optional Auto-Reject)
    sock.ev.on('call', async (calls) => {
        const sessionRow = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true, config: true }
        });
        if (!sessionRow) return;
        dbSessionId = sessionRow.id;
        const sessCfg = (sessionRow.config || {}) as Record<string, any>;

        for (const call of calls) {
            try {
                if (call.status !== 'offer' && call.status !== 'timeout') continue;
                const callKeyId = `call-${call.id}`;
                const rawRemoteJid = call.chatId || call.from;
                if (!rawRemoteJid) continue;
                let remoteJid = normalizeJid(rawRemoteJid);
                if (isLidJid(remoteJid)) {
                    remoteJid = normalizeJid(await resolveToPhoneJid(remoteJid, dbSessionId));
                }

                let autoRejected = false;
                if (call.status === 'offer' && sessCfg.rejectCalls) {
                    try {
                        await sock.rejectCall(call.id, call.from);
                        autoRejected = true;
                        const replyText = (sessCfg.rejectCallMessage || "").trim();
                        if (replyText) {
                            await sock.sendMessage(remoteJid, { text: replyText });
                        }
                    } catch (err) {
                        logger.debug("Store", "Error auto-rejecting call", err);
                    }
                }

                const callText = call.isVideo
                    ? (autoRejected ? "📹 Ligação de vídeo recusada automaticamente" : (call.status === 'timeout' ? "📹 Ligação de vídeo perdida" : "📹 Ligação de vídeo recebida"))
                    : (autoRejected ? "📞 Ligação de voz recusada automaticamente" : (call.status === 'timeout' ? "📞 Ligação de voz perdida" : "📞 Ligação de voz recebida"));

                const saved = await prisma.message.upsert({
                    where: { sessionId_keyId: { sessionId: dbSessionId, keyId: callKeyId } },
                    create: {
                        sessionId: dbSessionId,
                        keyId: callKeyId,
                        remoteJid,
                        fromMe: false,
                        type: "TEXT",
                        content: callText,
                        status: "READ",
                        timestamp: call.date || getSyncedNow()
                    },
                    update: {
                        content: callText
                    }
                });

                io?.to(sessionId).emit('message.update', [{
                    ...saved,
                    timestamp: saved.timestamp instanceof Date ? saved.timestamp.toISOString() : saved.timestamp
                }]);
            } catch (e) {
                logger.debug("Store", "Error saving call notification", e);
            }
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
    io?: Server | null,
    shouldDownloadMedia: boolean = true
) {
    const keyId = msg.key.id;
    const remoteJid = msg.key.remoteJid;
    const fromMe = msg.key.fromMe;
    const pushName = msg.pushName;
    const rawSec = msg.messageTimestamp
        ? (typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : Number(msg.messageTimestamp))
        : 0;
    if (!fromMe && triggerWebhook && rawSec > 0) {
        calibrateFromWhatsAppTimestamp(rawSec);
    }
    let timestamp = rawSec > 0 ? new Date(rawSec * 1000) : getSyncedNow();

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

    const mediaInfo = extractMediaMessage(msg.message);
    if (mediaInfo && keyId) {
        cacheRawMediaMessage(keyId, msg, sessionId);
    }

    // Check if message already exists to avoid duplicates
    // Baileys 'notify' event can sometimes trigger multiple times or for history
    const existingMessage = await prisma.message.findUnique({
        where: { sessionId_keyId: { sessionId: dbSessionId, keyId: keyId! } },
        select: { id: true, status: true, mediaUrl: true, type: true }
    });

    if (existingMessage) {
        // If existing message is media and mediaUrl is missing, attempt recovery
        const isMedia = ['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'STICKER'].includes(existingMessage.type);
        if (isMedia && !existingMessage.mediaUrl && shouldDownloadMedia) {
            try {
                const recoveredUrl = await downloadAndSaveMedia(msg, sessionId);
                if (recoveredUrl) {
                    const updatedMsg = await prisma.message.update({
                        where: { id: existingMessage.id },
                        data: { mediaUrl: recoveredUrl }
                    });
                    io?.to(sessionId).emit('message.update', [{
                        ...updatedMsg,
                        timestamp: updatedMsg.timestamp instanceof Date ? updatedMsg.timestamp.toISOString() : updatedMsg.timestamp
                    }]);
                    logger.success("Store", `Recovered missing mediaUrl for message ${keyId}: ${recoveredUrl}`);
                }
            } catch (e) {
                // Ignore recovery failure
            }
        }

        // Message exists! Only upgrade PENDING -> SENT, never downgrade DELIVERED/READ back to SENT
        if (fromMe && existingMessage.status === 'PENDING') {
            await prisma.message.update({
                where: { id: existingMessage.id },
                data: { status: 'SENT' }
            });
            io?.to(sessionId).emit("message.status", {
                keyId,
                remoteJid,
                status: 'SENT'
            });
        }
        // Return null to indicate "Not New"
        return null;
    }

    // Debug fromMe issue (Keep this for a while)
    if (fromMe === undefined || fromMe === null) {
        logger.warn("Store", `[DEBUG] Message ${keyId} has fromMe=${fromMe}. Key:`, msg.key);
    }

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

    // Determine effective participant for groups & status@broadcast
    const isGroup = remoteJid.endsWith("@g.us");
    const isStatusBroadcast = remoteJid === "status@broadcast";
    const remoteJidAlt = msg.key.remoteJidAlt; // LID/Phone JID handling
    let senderJid = fromMe
        ? (isStatusBroadcast && sock?.user?.id ? `${sock.user.id.split(":")[0].split("@")[0]}@s.whatsapp.net` : undefined)
        : ((isGroup || isStatusBroadcast) ? (msg.key.participant || msg.participant || remoteJidAlt) : remoteJid);

    // Prefer remoteJidAlt for DMs if available (matches webhook logic)
    if (!fromMe && !isGroup && !isStatusBroadcast && remoteJidAlt) {
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

    // Ensure live outgoing messages (fromMe && triggerWebhook) never jump backward in chat due to host clock drift
    if (fromMe && triggerWebhook && !isStatusBroadcast) {
        try {
            const latestInChat = await prisma.message.findFirst({
                where: { sessionId: dbSessionId, remoteJid: finalNormalizedRemoteJid },
                orderBy: { timestamp: "desc" },
                select: { timestamp: true }
            });
            const minGuaranteedTs = getMonotonicChatTimestamp(latestInChat?.timestamp);
            if (timestamp.getTime() < minGuaranteedTs.getTime()) {
                timestamp = minGuaranteedTs;
            }
        } catch {}
    }

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
                                // Never overwrite an existing HD mediaUrl with a quoted thumbnail
                                update: {},
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
    // For AUDIO/STICKER without thumbnail, wait until downloadAndSaveMedia finishes so frontend never hits a 404 before the file is saved.
    if (io && (!mediaInfo || mediaInfo.media?.jpegThumbnail)) {
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

    // Download Media (to save URL to DB) - for live messages (notify + append) and recent history
    let fileUrl: string | null = keyId ? (getLocalSentMedia(keyId) || null) : null;
    if (!fileUrl && shouldDownloadMedia && mediaInfo) {
        const mediaObj = mediaInfo.media;
        const hasRemoteMedia = !!(mediaObj?.url || mediaObj?.directPath || mediaObj?.thumbnailDirectPath);
        if (hasRemoteMedia) {
            try {
                fileUrl = await downloadAndSaveMedia(msg, sessionId);
            } catch (e) {
                logger.error("Store", "Error downloading media in store", e);
            }
        }
    }

    try {
        let activeSessionId = dbSessionId;
        let newMessage;
        try {
            newMessage = await prisma.message.upsert({
                where: {
                    sessionId_keyId: {
                        sessionId: activeSessionId,
                        keyId: keyId!
                    }
                },
                update: {
                    ...(fileUrl && !fileUrl.startsWith("data:") ? { mediaUrl: fileUrl } : {}),
                    ...(fromMe ? { status: "SENT" } : {})
                },
                create: {
                    sessionId: activeSessionId,
                    remoteJid: finalNormalizedRemoteJid,
                    senderJid,
                    fromMe: fromMe || false,
                    keyId: keyId!,
                    pushName,
                    type: messageType as any,
                    content: text,
                    mediaUrl: fileUrl, // Save Media URL
                    status: fromMe ? "SENT" : "PENDING",
                    timestamp,
                    quoteId
                }
            });
        } catch (createErr: any) {
            if (createErr.code === 'P2003') {
                // Foreign key constraint violated: refresh dbSessionId
                const ref = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
                if (ref) {
                    activeSessionId = ref.id;
                    newMessage = await prisma.message.upsert({
                        where: {
                            sessionId_keyId: {
                                sessionId: activeSessionId,
                                keyId: keyId!
                            }
                        },
                        update: {
                            ...(fileUrl && !fileUrl.startsWith("data:") ? { mediaUrl: fileUrl } : {}),
                            ...(fromMe ? { status: "SENT" } : {})
                        },
                        create: {
                            sessionId: activeSessionId,
                            remoteJid: finalNormalizedRemoteJid,
                            senderJid,
                            fromMe: fromMe || false,
                            keyId: keyId!,
                            pushName,
                            type: messageType as any,
                            content: text,
                            mediaUrl: fileUrl,
                            status: fromMe ? "SENT" : "PENDING",
                            timestamp,
                            quoteId
                        }
                    });
                } else {
                    throw createErr;
                }
            } else {
                throw createErr;
            }
        }

        // ⚡ INSTANT MEDIA READY EMIT: Notify frontend that mediaUrl is downloaded and ready for playback
        const finalMediaUrl = newMessage?.mediaUrl || fileUrl;
        if (io && finalMediaUrl) {
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
                mediaUrl: finalMediaUrl,
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
                    // Welcome message is handled centrally by bindAutoReply (with variable substitution & 24h cooldown)
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
