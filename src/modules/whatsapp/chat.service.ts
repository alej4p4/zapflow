import { prisma } from "@/lib/prisma";
import { normalizeJid } from "@/lib/jid-utils";
import { waManager } from "@/modules/whatsapp/manager";
import { onMessageSent } from "@/lib/webhook";
import Sticker from "wa-sticker-formatter";
import path from "path";
import { writeFile, mkdir } from "fs/promises";
import { mediaDir } from "@/lib/paths";
import { logger } from "@/lib/logger";

// High-speed memory caches to eliminate repeated database roundtrips on sending
const sessionDbIdCache = new Map<string, string>();
const recentQuotedCache = new Map<string, any>();

export class ChatService {
    /**
     * Get active chats list for a session with last message preview.
     * Cursor-based pagination — `before` is ISO timestamp of last seen chat.
     * Returns chats with last message timestamp < before (older).
     */
    static async getChatsList(
        dbSessionId: string,
        limit = 50,
        before?: string,
        search?: string
    ) {
        // 1. Get latest message per remoteJid with cursor pagination
        const isPostgres = process.env.DATABASE_URL?.startsWith("postgres");
        let rawLastMessages: Array<{
            remoteJid: string;
            content: string | null;
            timestamp: Date;
            type: string;
            fromMe: boolean;
            status?: string;
        }> = [];

        if (isPostgres) {
            const sql = `
                SELECT "remoteJid", "content", "timestamp", "type", "fromMe", "status"
                FROM (
                    SELECT DISTINCT ON ("remoteJid") "remoteJid", "content", "timestamp", "type", "fromMe", "status"
                    FROM "Message"
                    WHERE "sessionId" = $1
                    ${before ? 'AND "timestamp" < $2' : ''}
                    ORDER BY "remoteJid", "timestamp" DESC
                ) sub
                ORDER BY "timestamp" DESC
                LIMIT ${before ? '$3' : '$2'}
            `;
            const params: any[] = [dbSessionId];
            if (before) params.push(new Date(before));
            params.push(limit);
            rawLastMessages = await prisma.$queryRawUnsafe(sql, ...params);
        } else {
            const qParams: any[] = [dbSessionId, dbSessionId];
            if (before) qParams.push(new Date(before));
            qParams.push(limit);

            rawLastMessages = await prisma.$queryRawUnsafe<Array<{
                remoteJid: string;
                content: string | null;
                timestamp: Date;
                type: string;
                fromMe: boolean;
                status?: string;
            }>>(`
                SELECT m1.remoteJid, m1.content, m1.timestamp, m1.type, m1.fromMe, m1.status
                FROM Message m1
                INNER JOIN (
                    SELECT remoteJid, MAX(timestamp) as max_ts
                    FROM Message
                    WHERE sessionId = ?
                    GROUP BY remoteJid
                ) m2 ON m1.remoteJid = m2.remoteJid AND m1.timestamp = m2.max_ts
                WHERE m1.sessionId = ?
                ${before ? 'AND m1.timestamp < ?' : ''}
                ORDER BY m1.timestamp DESC
                LIMIT ?
            `, ...qParams);
        }

        // 2. Fetch all groups and contacts in parallel so ALL groups and contacts load instantaneously (0ms)
        const jids = rawLastMessages.map(m => m.remoteJid);
        const [contactsForMessages, allGroups, directoryContacts] = await Promise.all([
            jids.length > 0
                ? prisma.contact.findMany({
                      where: { sessionId: dbSessionId, jid: { in: jids } },
                      select: { jid: true, name: true, notify: true, profilePic: true }
                  })
                : Promise.resolve([]),
            !before
                ? prisma.group.findMany({
                      where: { sessionId: dbSessionId },
                      select: { jid: true, subject: true, updatedAt: true },
                      orderBy: { subject: "asc" }
                  })
                : prisma.group.findMany({
                      where: { sessionId: dbSessionId, jid: { in: jids } },
                      select: { jid: true, subject: true, updatedAt: true }
                  }),
            !before
                ? prisma.contact.findMany({
                      where: {
                          sessionId: dbSessionId,
                          jid: { endsWith: "@s.whatsapp.net" },
                          OR: [{ name: { not: null } }, { notify: { not: null } }]
                      },
                      select: { jid: true, name: true, notify: true, profilePic: true },
                      orderBy: { name: "asc" },
                      take: 500
                  })
                : Promise.resolve([])
        ]);

        // Build lookup map
        const infoMap = new Map<string, { name: string | null; notify: string | null; profilePic: string | null }>();
        directoryContacts.forEach(c => infoMap.set(c.jid, { name: c.name, notify: c.notify, profilePic: (c.profilePic && c.profilePic.startsWith("http")) ? c.profilePic : null }));
        contactsForMessages.forEach(c => infoMap.set(c.jid, { name: c.name, notify: c.notify, profilePic: (c.profilePic && c.profilePic.startsWith("http")) ? c.profilePic : null }));
        allGroups.forEach(g => infoMap.set(g.jid, { name: g.subject, notify: g.subject, profilePic: null }));

        // 3. Build result array: first chats with messages (sorted by latest timestamp DESC)
        const result: any[] = [];
        const seenJids = new Set<string>();
        for (const msg of rawLastMessages) {
            if (seenJids.has(msg.remoteJid)) continue;
            seenJids.add(msg.remoteJid);

            const info = infoMap.get(msg.remoteJid);
            result.push({
                jid: msg.remoteJid,
                name: info?.name || null,
                notify: info?.notify || null,
                profilePic: info?.profilePic || null,
                lastMessage: {
                    content: msg.content,
                    timestamp: msg.timestamp instanceof Date
                        ? msg.timestamp.toISOString()
                        : String(msg.timestamp),
                    type: msg.type,
                    fromMe: Boolean(msg.fromMe),
                    status: msg.status || "SENT"
                }
            });
        }

        // 4. Append all remaining groups (even without messages yet) so "Grupos" tab & search are 100% complete in 0ms
        if (!before) {
            for (const g of allGroups) {
                if (seenJids.has(g.jid)) continue;
                seenJids.add(g.jid);
                result.push({
                    jid: g.jid,
                    name: g.subject,
                    notify: g.subject,
                    profilePic: null,
                    lastMessage: undefined
                });
            }

            // 5. Append saved directory contacts so "Contatos" tab & search are 100% immediate in 0ms
            for (const c of directoryContacts) {
                if (seenJids.has(c.jid)) continue;
                seenJids.add(c.jid);
                result.push({
                    jid: c.jid,
                    name: c.name || c.notify || null,
                    notify: c.notify || null,
                    profilePic: (c.profilePic && c.profilePic.startsWith("http")) ? c.profilePic : null,
                    lastMessage: undefined
                });
            }
        }

        // 4. Apply in-memory search filter if needed
        if (search && search.trim()) {
            const q = search.toLowerCase();
            return result.filter(c =>
                (c.name || '').toLowerCase().includes(q) ||
                (c.notify || '').toLowerCase().includes(q) ||
                c.jid.toLowerCase().includes(q)
            );
        }

        return result;
    }

    /**
     * Get messages for a specific chat with cursor pagination (infinite scroll).
     * @param before ISO timestamp — load messages older than this
     * @param limit max messages to return
     */
    static async getMessages(
        dbSessionId: string,
        jid: string,
        limit = 50,
        before?: string
    ) {
        const isGroup = jid.endsWith("@g.us");
        let queryJids: string[] = [jid];

        // Groups only ever have their exact JID - skip Contact lookup completely for groups
        if (!isGroup) {
            const normalizedJid = normalizeJid(jid);
            const contact = await prisma.contact.findFirst({
                where: {
                    sessionId: dbSessionId,
                    OR: [{ jid }, { lid: jid }, { remoteJidAlt: jid }, { jid: normalizedJid }]
                },
                select: { jid: true, lid: true, remoteJidAlt: true }
            });

            const queryJidsSet = new Set([jid, normalizedJid]);
            if (contact) {
                if (contact.jid) queryJidsSet.add(contact.jid);
                if (contact.lid) queryJidsSet.add(contact.lid);
                if (contact.remoteJidAlt) queryJidsSet.add(contact.remoteJidAlt);
            }
            queryJids = Array.from(queryJidsSet);
        }

        const where: any = {
            sessionId: dbSessionId,
            remoteJid: { in: queryJids }
        };

        // Cursor-based: load older messages before this timestamp
        if (before) {
            where.timestamp = { lt: new Date(before) };
        }

        const messages = await prisma.message.findMany({
            where,
            orderBy: { timestamp: 'desc' },
            take: limit + 1, // fetch 1 extra to know if there's more
            select: {
                id: true,
                keyId: true,
                content: true,
                fromMe: true,
                senderJid: true,
                timestamp: true,
                type: true,
                status: true,
                pushName: true,
                mediaUrl: true,
                remoteJid: true,
                quoteId: true
            }
        });

        const hasMore = messages.length > limit;
        if (hasMore) messages.pop();

        // Fetch quoted messages
        const quoteIds = messages.map(m => m.quoteId).filter((id): id is string => !!id);
        const quotedMessagesMap = new Map<string, { content: string | null; fromMe: boolean; senderJid: string | null; pushName: string | null; type: string; mediaUrl: string | null }>();
        let quotedMsgs: any[] = [];
        if (quoteIds.length > 0) {
            try {
                quotedMsgs = await prisma.message.findMany({
                    where: { sessionId: dbSessionId, keyId: { in: quoteIds } },
                    select: { keyId: true, content: true, fromMe: true, senderJid: true, pushName: true, type: true, mediaUrl: true }
                });
                quotedMsgs.forEach(qm => {
                    quotedMessagesMap.set(qm.keyId, {
                        content: qm.content,
                        fromMe: qm.fromMe,
                        senderJid: qm.senderJid,
                        pushName: qm.pushName,
                        type: qm.type,
                        mediaUrl: qm.mediaUrl
                    });
                });
            } catch (e) {
                console.error("Failed to batch load quoted messages:", e);
            }
        }

        const messagesWithQuote = messages.map((m: any) => {
            const quoted = m.quoteId ? quotedMessagesMap.get(m.quoteId) : undefined;
            return {
                ...m,
                quoted: quoted ? {
                    keyId: m.quoteId,
                    content: quoted.content,
                    fromMe: quoted.fromMe,
                    senderJid: quoted.senderJid,
                    pushName: quoted.pushName,
                    type: quoted.type,
                    mediaUrl: quoted.mediaUrl
                } : null
            };
        });

        // Build contactMap & participantNames for mentions and headers
        const contactMap: Record<string, string> = {};
        const participantNamesSet = new Set<string>();
        const candidateIds = new Set<string>();

        let groupParticipants: Array<{ id: string; phoneNumber?: string }> = [];
        if (isGroup) {
            try {
                const group = await prisma.group.findFirst({
                    where: { sessionId: dbSessionId, jid },
                    select: { participants: true }
                });
                groupParticipants = (group?.participants as Array<{ id: string; phoneNumber?: string }>) || [];
                for (const p of groupParticipants) {
                    if (p.id) candidateIds.add(p.id);
                    if (p.phoneNumber) candidateIds.add(p.phoneNumber);
                }
            } catch (e) {
                console.error("Error fetching group participants:", e);
            }
        }

        // Add senderJids and scan mentions from messages & quoted
        for (const m of messages) {
            if (m.senderJid) candidateIds.add(m.senderJid);
            if (m.content) {
                const mentionRegex = /@(\d{8,25})/g;
                let match;
                while ((match = mentionRegex.exec(m.content)) !== null) {
                    candidateIds.add(match[1]);
                    candidateIds.add(`${match[1]}@lid`);
                    candidateIds.add(`${match[1]}@s.whatsapp.net`);
                }
            }
        }
        for (const q of quotedMsgs) {
            if (q.senderJid) candidateIds.add(q.senderJid);
            if (q.content) {
                const mentionRegex = /@(\d{8,25})/g;
                let match;
                while ((match = mentionRegex.exec(q.content)) !== null) {
                    candidateIds.add(match[1]);
                    candidateIds.add(`${match[1]}@lid`);
                    candidateIds.add(`${match[1]}@s.whatsapp.net`);
                }
            }
        }

        const idList = Array.from(candidateIds);
        const bareDigits = idList.map(id => id.split('@')[0]).filter(d => /^\d+$/.test(d));

        if (idList.length > 0 || bareDigits.length > 0) {
            try {
                const contacts = await prisma.contact.findMany({
                    where: {
                        sessionId: dbSessionId,
                        OR: [
                            { jid: { in: idList } },
                            { lid: { in: idList } },
                            { remoteJidAlt: { in: idList } },
                            ...(bareDigits.length > 0 ? [
                                { jid: { in: bareDigits.map(d => `${d}@s.whatsapp.net`) } },
                                { lid: { in: bareDigits.map(d => `${d}@lid`) } }
                            ] : [])
                        ]
                    },
                    select: { jid: true, lid: true, name: true, notify: true, verifiedName: true, remoteJidAlt: true }
                });

                for (const c of contacts) {
                    const displayName = c.name || c.notify || c.verifiedName;
                    if (!displayName) continue;
                    if (c.jid) {
                        contactMap[c.jid] = displayName;
                        contactMap[c.jid.split('@')[0]] = displayName;
                    }
                    if (c.lid) {
                        contactMap[c.lid] = displayName;
                        contactMap[c.lid.split('@')[0]] = displayName;
                    }
                    if (c.remoteJidAlt) {
                        contactMap[c.remoteJidAlt] = displayName;
                        contactMap[c.remoteJidAlt.split('@')[0]] = displayName;
                    }
                }
            } catch (e) {
                console.error("Error batch loading contacts for contactMap:", e);
            }
        }

        // Add pushNames from messages as fast fallback for participants without saved contacts
        for (const m of messages) {
            if (m.pushName && m.senderJid) {
                const bare = m.senderJid.split('@')[0];
                if (!contactMap[m.senderJid]) contactMap[m.senderJid] = m.pushName;
                if (!contactMap[bare]) contactMap[bare] = m.pushName;
            }
        }
        for (const q of quotedMsgs) {
            if (q.pushName && q.senderJid) {
                const bare = q.senderJid.split('@')[0];
                if (!contactMap[q.senderJid]) contactMap[q.senderJid] = q.pushName;
                if (!contactMap[bare]) contactMap[bare] = q.pushName;
            }
        }

        // Load distinct pushNames from previous messages in this group to resolve historical senders
        if (isGroup) {
            try {
                const groupSenders = await prisma.message.findMany({
                    where: {
                        sessionId: dbSessionId,
                        remoteJid: jid,
                        pushName: { not: null }
                    },
                    select: { senderJid: true, pushName: true },
                    distinct: ['senderJid']
                });
                for (const s of groupSenders) {
                    if (s.senderJid && s.pushName) {
                        const bare = s.senderJid.split('@')[0];
                        if (!contactMap[s.senderJid]) contactMap[s.senderJid] = s.pushName;
                        if (!contactMap[bare]) contactMap[bare] = s.pushName;
                    }
                }
            } catch (e) {
                console.error("Error loading distinct group sender pushNames:", e);
            }
        }

        // Link group participant LIDs to phone numbers if resolved
        if (isGroup && groupParticipants.length > 0) {
            for (const p of groupParticipants) {
                const lidNum = p.id ? p.id.split('@')[0] : null;
                const phoneNum = p.phoneNumber ? p.phoneNumber.split('@')[0] : null;
                const name = (phoneNum && contactMap[phoneNum]) ||
                             (lidNum && contactMap[lidNum]) ||
                             (p.phoneNumber && contactMap[p.phoneNumber]) ||
                             (p.id && contactMap[p.id]);

                if (name) {
                    if (lidNum) contactMap[lidNum] = name;
                    if (p.id) contactMap[p.id] = name;
                    if (phoneNum) contactMap[phoneNum] = name;
                    if (p.phoneNumber) contactMap[p.phoneNumber] = name;
                    participantNamesSet.add(name);
                } else if (phoneNum) {
                    const formattedPhone = `+${phoneNum}`;
                    if (lidNum && !contactMap[lidNum]) contactMap[lidNum] = formattedPhone;
                    if (p.id && !contactMap[p.id]) contactMap[p.id] = formattedPhone;
                    participantNamesSet.add(formattedPhone);
                }
            }
        }

        const participantNames = Array.from(participantNamesSet).sort((a, b) => a.localeCompare(b));

        const participantsList = groupParticipants.map(p => {
            const lidNum = p.id ? p.id.split('@')[0] : '';
            const phoneNum = p.phoneNumber ? p.phoneNumber.split('@')[0] : '';
            const resolvedName = (phoneNum && contactMap[phoneNum]) ||
                                 (lidNum && contactMap[lidNum]) ||
                                 (p.phoneNumber && contactMap[p.phoneNumber]) ||
                                 (p.id && contactMap[p.id]) ||
                                 (phoneNum ? `+${phoneNum}` : lidNum);
            return {
                id: p.id,
                name: resolvedName,
                phoneNumber: p.phoneNumber || p.id,
                avatarJid: p.phoneNumber || p.id
            };
        }).sort((a, b) => a.name.localeCompare(b.name));

        // Return chronological order (oldest first)
        return {
            messages: messagesWithQuote.reverse(),
            hasMore,
            contactMap,
            participantNames,
            participantsList
        };
    }

    static async getMessagesAround(
        dbSessionId: string,
        jid: string,
        targetKeyId: string
    ) {
        const target = await prisma.message.findFirst({
            where: { sessionId: dbSessionId, keyId: targetKeyId }
        });

        if (!target) {
            return this.getMessages(dbSessionId, jid, 50);
        }

        const isGroup = jid.endsWith("@g.us");
        let queryJids: string[] = [jid];

        if (!isGroup) {
            const normalizedJid = normalizeJid(jid);
            const contact = await prisma.contact.findFirst({
                where: {
                    sessionId: dbSessionId,
                    OR: [{ jid }, { lid: jid }, { remoteJidAlt: jid }, { jid: normalizedJid }]
                },
                select: { jid: true, lid: true, remoteJidAlt: true }
            });

            const queryJidsSet = new Set([jid, normalizedJid]);
            if (contact) {
                if (contact.jid) queryJidsSet.add(contact.jid);
                if (contact.lid) queryJidsSet.add(contact.lid);
                if (contact.remoteJidAlt) queryJidsSet.add(contact.remoteJidAlt);
            }
            queryJids = Array.from(queryJidsSet);
        }

        const [older, newer] = await Promise.all([
            prisma.message.findMany({
                where: {
                    sessionId: dbSessionId,
                    remoteJid: { in: queryJids },
                    timestamp: { lt: target.timestamp }
                },
                orderBy: { timestamp: 'desc' },
                take: 25,
                select: {
                    id: true,
                    keyId: true,
                    content: true,
                    fromMe: true,
                    senderJid: true,
                    timestamp: true,
                    type: true,
                    status: true,
                    pushName: true,
                    mediaUrl: true,
                    remoteJid: true,
                    quoteId: true
                }
            }),
            prisma.message.findMany({
                where: {
                    sessionId: dbSessionId,
                    remoteJid: { in: queryJids },
                    timestamp: { gt: target.timestamp }
                },
                orderBy: { timestamp: 'asc' },
                take: 25,
                select: {
                    id: true,
                    keyId: true,
                    content: true,
                    fromMe: true,
                    senderJid: true,
                    timestamp: true,
                    type: true,
                    status: true,
                    pushName: true,
                    mediaUrl: true,
                    remoteJid: true,
                    quoteId: true
                }
            })
        ]);

        const targetMsg = {
            id: target.id,
            keyId: target.keyId,
            content: target.content,
            fromMe: target.fromMe,
            senderJid: target.senderJid,
            timestamp: target.timestamp,
            type: target.type,
            status: target.status,
            pushName: target.pushName,
            mediaUrl: target.mediaUrl,
            remoteJid: target.remoteJid,
            quoteId: target.quoteId
        };

        const allMessages = [...older.reverse(), targetMsg, ...newer];

        // Fetch quoted messages
        const quoteIds = allMessages.map(m => m.quoteId).filter((id): id is string => !!id);
        const quotedMessagesMap = new Map<string, any>();
        if (quoteIds.length > 0) {
            try {
                const quotedMsgs = await prisma.message.findMany({
                    where: { sessionId: dbSessionId, keyId: { in: quoteIds } },
                    select: { keyId: true, content: true, fromMe: true, senderJid: true, pushName: true, type: true, mediaUrl: true }
                });
                quotedMsgs.forEach(q => quotedMessagesMap.set(q.keyId, q));
            } catch (e) {
                console.error("Error batch fetching quoted messages in getMessagesAround:", e);
            }
        }

        const messagesWithQuote = allMessages.map(msg => ({
            ...msg,
            quoted: msg.quoteId ? quotedMessagesMap.get(msg.quoteId) || null : null
        }));

        return {
            messages: messagesWithQuote,
            hasMore: true,
            contactMap: {},
            participantNames: [],
            participantsList: []
        };
    }

    static async sendTextMessage(sessionId: string, jid: string, messagePayload: any, mentions?: string[], quotedMessageId?: string) {
        let instance = waManager.getInstance(sessionId);

        // Se a sessão estiver reconectando ou aguardando socket (queda temporária de rede), aguarda até 6s
        if (instance && (!instance.socket || instance.status === "CONNECTING")) {
            for (let i = 0; i < 12; i++) {
                await new Promise(r => setTimeout(r, 500));
                instance = waManager.getInstance(sessionId);
                if (instance?.socket && instance.status === "CONNECTED") break;
            }
        }

        if (!instance || !instance.socket) {
            throw new Error("WhatsApp desconectado ou reconectando. Tente novamente em alguns segundos.");
        }

        // Handle quoted/reply message with in-memory caching for zero SQL latency
        let quotedOption: any = undefined;
        if (quotedMessageId) {
            try {
                const quotedCacheKey = `${sessionId}:${quotedMessageId}`;
                let quotedMsg = recentQuotedCache.get(quotedCacheKey);

                if (!quotedMsg) {
                    let dbSessionId = sessionDbIdCache.get(sessionId);
                    if (!dbSessionId) {
                        const dbSession = await prisma.session.findFirst({ where: { OR: [{ sessionId }, { id: sessionId }] }, select: { id: true } });
                        if (dbSession) {
                            dbSessionId = dbSession.id;
                            sessionDbIdCache.set(sessionId, dbSessionId);
                        }
                    }

                    if (dbSessionId) {
                        quotedMsg = await prisma.message.findFirst({
                            where: { sessionId: dbSessionId, keyId: quotedMessageId },
                            select: { keyId: true, remoteJid: true, fromMe: true, content: true, senderJid: true }
                        });
                        if (quotedMsg) {
                            recentQuotedCache.set(quotedCacheKey, quotedMsg);
                            if (recentQuotedCache.size > 200) {
                                const firstKey = recentQuotedCache.keys().next().value;
                                if (firstKey) recentQuotedCache.delete(firstKey);
                            }
                        }
                    }
                }

                if (quotedMsg) {
                    const rawParticipant = quotedMsg.fromMe 
                        ? instance.socket.user?.id 
                        : (quotedMsg.senderJid || quotedMsg.remoteJid);
                    
                    let cleanParticipant: string | undefined = undefined;
                    if (rawParticipant) {
                        const [userPart, domain] = rawParticipant.split('@');
                        const cleanUser = userPart.split(':')[0];
                        cleanParticipant = domain ? `${cleanUser}@${domain}` : cleanUser;
                    }

                    quotedOption = {
                        key: {
                            remoteJid: quotedMsg.remoteJid,
                            fromMe: quotedMsg.fromMe,
                            id: quotedMsg.keyId,
                            participant: cleanParticipant
                        },
                        message: {
                            conversation: quotedMsg.content || ""
                        }
                    };
                }
            } catch (e) {
                console.error("Error fetching quoted message (non-fatal):", e);
            }
        }

        let msgPayload = typeof messagePayload === "string" ? { text: messagePayload } : { ...messagePayload };

        // Normalize "text" to "caption" if a media message is sent with "text"
        if (msgPayload.text && (msgPayload.image || msgPayload.video || msgPayload.document || msgPayload.audio)) {
            if (!msgPayload.caption) {
                msgPayload.caption = msgPayload.text;
            }
            delete msgPayload.text;
        }

        if (msgPayload.sticker && (msgPayload.sticker.url || typeof msgPayload.sticker === 'string')) {
            const url = msgPayload.sticker.url || msgPayload.sticker;
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`Failed to fetch sticker media`);
                const buffer = await res.arrayBuffer();
                const sticker = new Sticker(Buffer.from(buffer), {
                    pack: msgPayload.sticker.pack || "BarraSoftware Bot",
                    author: msgPayload.sticker.author || "BarraSoftware",
                    type: "full",
                    quality: 50
                });
                msgPayload = { sticker: await sticker.toBuffer() };
            } catch (e: any) {
                throw new Error(`Failed to generate sticker from URL: ${e.message}`);
            }
        }

        if (msgPayload.image && typeof msgPayload.image === 'object' && msgPayload.image.url) {
            try {
                const res = await fetch(msgPayload.image.url);
                if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
                const buffer = await res.arrayBuffer();
                msgPayload.image = Buffer.from(buffer);
            } catch (e: any) {
                throw new Error(`Failed to fetch image from URL: ${e.message}`);
            }
        }

        if (msgPayload.video && typeof msgPayload.video === 'object' && msgPayload.video.url) {
            try {
                const res = await fetch(msgPayload.video.url);
                if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
                const buffer = await res.arrayBuffer();
                msgPayload.video = Buffer.from(buffer);
            } catch (e: any) {
                throw new Error(`Failed to fetch video from URL: ${e.message}`);
            }
        }

        if (msgPayload.document && typeof msgPayload.document === 'object' && msgPayload.document.url) {
            try {
                const res = await fetch(msgPayload.document.url);
                if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
                const buffer = await res.arrayBuffer();
                msgPayload.document = Buffer.from(buffer);
            } catch (e: any) {
                throw new Error(`Failed to fetch document from URL: ${e.message}`);
            }
        }

        if (msgPayload.audio && typeof msgPayload.audio === 'object' && msgPayload.audio.url) {
            try {
                const res = await fetch(msgPayload.audio.url);
                if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
                const buffer = await res.arrayBuffer();
                msgPayload.audio = Buffer.from(buffer);
            } catch (e: any) {
                throw new Error(`Failed to fetch audio from URL: ${e.message}`);
            }
        }

        // Automatically resolve mentions from text only if '@' is present
        if ((!mentions || mentions.length === 0) && (msgPayload.text || msgPayload.caption)) {
            const textContent = msgPayload.text || msgPayload.caption || "";
            if (textContent.includes("@")) {
                const extractedMentions: string[] = [];
                const mentionDigitsRegex = /@(\d{8,25})/g;
                let m;
                while ((m = mentionDigitsRegex.exec(textContent)) !== null) {
                    extractedMentions.push(`${m[1]}@s.whatsapp.net`);
                }
                if (extractedMentions.length > 0) {
                    mentions = extractedMentions;
                }
            }
        }

        if (msgPayload.text && mentions && Array.isArray(mentions)) {
            msgPayload.mentions = mentions;
        }

        // Direct user chat skips anti-spam queue to guarantee 0ms latency identical to WhatsApp Web
        const options: any = { mentions: mentions || [], skipAntiSpam: true };
        if (quotedOption) {
            options.quoted = quotedOption;
        }

        const sendResult = await instance.socket.sendMessage(jid, msgPayload, options);

        // Instant Real-time emit: notify frontend that message is SENT immediately (< 10ms)
        const keyId = sendResult?.key?.id;
        if (keyId && instance.io) {
            instance.io.to(sessionId).emit("message.status", {
                keyId,
                remoteJid: jid,
                status: "SENT"
            });
        }

        // Fire webhook for sent message (non-blocking)
        try {
            const webhookMsg: any = {
                key: sendResult?.key || sendResult || {},
                message: {
                    conversation: typeof msgPayload.text === 'string' ? msgPayload.text : (msgPayload.caption || "")
                },
                messageTimestamp: Math.floor(Date.now() / 1000)
            };

            // Map media types to proper message structure for webhook
            if (msgPayload.image) {
                webhookMsg.message = {
                    imageMessage: { caption: msgPayload.caption || "", mimetype: msgPayload.mimetype || "image/jpeg" }
                };
            } else if (msgPayload.video) {
                webhookMsg.message = {
                    videoMessage: { caption: msgPayload.caption || "", mimetype: msgPayload.mimetype || "video/mp4" }
                };
            } else if (msgPayload.audio) {
                webhookMsg.message = {
                    audioMessage: { mimetype: msgPayload.ptt ? "audio/ogg; codecs=opus" : "audio/mp4" }
                };
            } else if (msgPayload.document) {
                webhookMsg.message = {
                    documentMessage: { caption: msgPayload.caption || "", fileName: msgPayload.fileName || "document", mimetype: msgPayload.mimetype || "application/octet-stream" }
                };
            } else if (msgPayload.sticker) {
                webhookMsg.message = {
                    stickerMessage: {}
                };
            }

            onMessageSent(sessionId, webhookMsg).catch(e => console.error("Webhook error:", e));
        } catch (e) {
            // Non-blocking — webhook failure shouldn't break message send
        }

        return sendResult;
    }

    /**
     * Send a media message locally from a buffer.
     */
    static async sendMediaMessage(
        sessionId: string,
        jid: string,
        buffer: Buffer,
        type: string,
        mimetype: string,
        fileName: string,
        caption: string
    ) {
        let instance = waManager.getInstance(sessionId);

        // Se a sessão estiver reconectando ou aguardando socket (queda temporária de rede), aguarda até 6s
        if (instance && (!instance.socket || instance.status === "CONNECTING")) {
            for (let i = 0; i < 12; i++) {
                await new Promise(r => setTimeout(r, 500));
                instance = waManager.getInstance(sessionId);
                if (instance?.socket && instance.status === "CONNECTED") break;
            }
        }

        if (!instance || !instance.socket) {
            throw new Error("WhatsApp desconectado ou reconectando. Tente novamente em alguns segundos.");
        }

        const messageOptions: any = {};
        if (caption) messageOptions.caption = caption;
        messageOptions.mimetype = mimetype;

        let content: any = {};

        if (type === 'image') {
            content = { image: buffer, ...messageOptions };
        } else if (type === 'video') {
            content = { video: buffer, ...messageOptions };
        } else if (type === 'audio') {
            content = { audio: buffer, mimetype: 'audio/mp4', ptt: false };
        } else if (type === 'voice') {
            content = { audio: buffer, mimetype: mimetype || 'audio/ogg; codecs=opus', ptt: true };
        } else if (type === 'document') {
            content = { document: buffer, mimetype, fileName, ...messageOptions };
        } else if (type === 'sticker') {
            const sticker = new Sticker(buffer, {
                pack: "BarraSoftware Bot",
                author: "BarraSoftware",
                type: "full",
                quality: 50
            });
            content = { sticker: await sticker.toBuffer() };
        } else {
            content = { document: buffer, mimetype, fileName, ...messageOptions };
        }

        const sendResult = await instance.socket.sendMessage(jid, content, { skipAntiSpam: true } as any);

        const keyId = sendResult?.key?.id;
        const ext = type === 'voice' ? 'ogg' : type === 'audio' ? 'mp3' : type === 'image' ? 'jpg' : type === 'video' ? 'mp4' : 'bin';
        const savedFilename = `${sessionId}-${keyId || Date.now()}.${ext}`;
        let fileUrl = `/api/media/${savedFilename}`;
        if (buffer.length <= 1024 * 1024 && (type === 'voice' || type === 'audio' || type === 'image' || type === 'sticker')) {
            const mimeClean = (mimetype || (type === 'voice' ? 'audio/ogg' : type === 'audio' ? 'audio/mpeg' : type === 'sticker' ? 'image/webp' : 'image/jpeg')).split(';')[0].trim();
            fileUrl = `data:${mimeClean};base64,${buffer.toString('base64')}`;
        }
        if (sendResult) {
            (sendResult as any).mediaUrl = fileUrl;
        }

        // Instant Real-time emit: notify frontend that media message is SENT immediately (< 10ms)
        if (keyId && instance.io) {
            instance.io.to(sessionId).emit("message.status", {
                keyId,
                remoteJid: jid,
                status: "SENT"
            });
        }

        // Persist sent media to disk and database in background (non-blocking)
        void (async () => {
            try {
                if (keyId) {
                    const savedFilePath = path.join(mediaDir, savedFilename);
                    await mkdir(path.dirname(savedFilePath), { recursive: true });
                    await writeFile(savedFilePath, buffer);

                    let dbSessionId = sessionDbIdCache.get(sessionId);
                    if (!dbSessionId) {
                        const sessionRecord = await prisma.session.findFirst({
                            where: { OR: [{ sessionId }, { id: sessionId }] },
                            select: { id: true }
                        });
                        if (sessionRecord) {
                            dbSessionId = sessionRecord.id;
                            sessionDbIdCache.set(sessionId, dbSessionId);
                        }
                    }

                    if (dbSessionId) {
                        await prisma.message.upsert({
                            where: {
                                sessionId_keyId: {
                                    sessionId: dbSessionId,
                                    keyId
                                }
                            },
                            update: {
                                mediaUrl: fileUrl,
                                status: "SENT"
                            },
                            create: {
                                sessionId: dbSessionId,
                                remoteJid: jid,
                                fromMe: true,
                                keyId,
                                type: (type === 'voice' || type === 'audio') ? 'AUDIO' : type === 'image' ? 'IMAGE' : type === 'video' ? 'VIDEO' : 'DOCUMENT',
                                content: caption || "",
                                mediaUrl: fileUrl,
                                status: "SENT",
                                timestamp: new Date()
                            }
                        });
                    }
                }
            } catch (saveErr) {
                logger.error("ChatService", "Failed to persist sent media in background", saveErr);
            }
        })();

        // Fire webhook for sent media message (non-blocking)
        try {
            const webhookMsg: any = {
                key: sendResult?.key || sendResult || {},
                message: {
                    conversation: caption || ""
                },
                messageTimestamp: Math.floor(Date.now() / 1000)
            };

            // Map media type to proper message structure for webhook
            if (type === 'image') {
                webhookMsg.message = { imageMessage: { caption: caption || "", mimetype } };
            } else if (type === 'video') {
                webhookMsg.message = { videoMessage: { caption: caption || "", mimetype } };
            } else if (type === 'audio' || type === 'voice') {
                webhookMsg.message = { audioMessage: { mimetype: 'audio/mp4', ptt: type === 'voice' } };
            } else if (type === 'document') {
                webhookMsg.message = { documentMessage: { caption: caption || "", fileName, mimetype } };
            } else if (type === 'sticker') {
                webhookMsg.message = { stickerMessage: {} };
            }

            onMessageSent(sessionId, webhookMsg).catch(e => console.error("Webhook error:", e));
        } catch (e) {
            // Non-blocking
        }

        return sendResult;
    }
}
