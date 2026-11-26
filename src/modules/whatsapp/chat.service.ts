import { prisma } from "@/lib/prisma";
import { normalizeJid } from "@/lib/jid-utils";
import { waManager } from "@/modules/whatsapp/manager";
import { onMessageSent } from "@/lib/webhook";
import { registerLocalSentMedia } from "@/modules/whatsapp/store";
import Sticker from "wa-sticker-formatter";
import path from "path";
import { writeFile, mkdir } from "fs/promises";
import { mediaDir } from "@/lib/paths";
import { logger } from "@/lib/logger";
import { getMonotonicChatTimestamp, getSyncedNowUnixSec } from "@/lib/wa-clock";

// High-speed memory caches to eliminate repeated database roundtrips on sending
const sessionDbIdCache = new Map<string, string>();
const sessionNameCache = new Map<string, string>();
const recentQuotedCache = new Map<string, any>();
const contactJidsCache = new Map<string, { jids: string[]; expires: number }>();
const groupParticipantsCache = new Map<string, { participants: any[]; expires: number }>();
const groupSendersCache = new Map<string, { senders: Array<{ senderJid: string | null; pushName: string | null }>; expires: number }>();
const directoryContactsCache = new Map<string, { contacts: any[]; expires: number }>();
const groupsCache = new Map<string, { groups: any[]; expires: number }>();
const lastChatTimestampCache = new Map<string, { timestamp: Date; expires: number }>();

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
            // High-performance index scan on Message_sessionId_timestamp_idx:
            // Fetch recent messages and deduplicate by remoteJid in-memory (9ms vs 3000ms).
            const scanLimit = Math.max(limit * 20, 1000);
            const fastSql = `
                SELECT "remoteJid", "content", "timestamp", "type", "fromMe", "status"
                FROM "Message"
                WHERE "sessionId" = $1
                AND "remoteJid" != 'status@broadcast'
                AND "remoteJid" NOT LIKE '%@broadcast'
                ${before ? 'AND "timestamp" < $2' : ''}
                ORDER BY "timestamp" DESC
                LIMIT ${before ? '$3' : '$2'}
            `;
            const fastParams: any[] = [dbSessionId];
            if (before) fastParams.push(new Date(before));
            fastParams.push(scanLimit);

            const recentRows: Array<{
                remoteJid: string;
                content: string | null;
                timestamp: Date;
                type: string;
                fromMe: boolean;
                status?: string;
            }> = await prisma.$queryRawUnsafe(fastSql, ...fastParams);

            const seenJids = new Set<string>();
            for (const r of recentRows) {
                if (!seenJids.has(r.remoteJid)) {
                    seenJids.add(r.remoteJid);
                    rawLastMessages.push(r);
                    if (rawLastMessages.length >= limit) break;
                }
            }

            // Fallback only if the fast window did not yield enough distinct chats
            if (rawLastMessages.length < limit && recentRows.length >= scanLimit) {
                const fallbackSql = `
                    SELECT "remoteJid", "content", "timestamp", "type", "fromMe", "status"
                    FROM (
                        SELECT DISTINCT ON ("remoteJid") "remoteJid", "content", "timestamp", "type", "fromMe", "status"
                        FROM "Message"
                        WHERE "sessionId" = $1
                        AND "remoteJid" != 'status@broadcast'
                        AND "remoteJid" NOT LIKE '%@broadcast'
                        ${before ? 'AND "timestamp" < $2' : ''}
                        ORDER BY "remoteJid", "timestamp" DESC
                    ) sub
                    ORDER BY "timestamp" DESC
                    LIMIT ${before ? '$3' : '$2'}
                `;
                const fallbackParams: any[] = [dbSessionId];
                if (before) fallbackParams.push(new Date(before));
                fallbackParams.push(limit);
                rawLastMessages = await prisma.$queryRawUnsafe(fallbackSql, ...fallbackParams);
            }
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
                    WHERE sessionId = ? AND remoteJid != 'status@broadcast' AND remoteJid NOT LIKE '%@broadcast'
                    GROUP BY remoteJid
                ) m2 ON m1.remoteJid = m2.remoteJid AND m1.timestamp = m2.max_ts
                WHERE m1.sessionId = ? AND m1.remoteJid != 'status@broadcast' AND m1.remoteJid NOT LIKE '%@broadcast'
                ${before ? 'AND m1.timestamp < ?' : ''}
                ORDER BY m1.timestamp DESC
                LIMIT ?
            `, ...qParams);
        }

        // 2. Fetch all groups, contacts and LID mappings in parallel (smart resolution)
        const jids = rawLastMessages.map(m => m.remoteJid);
        const lidJids = jids.filter(j => j.endsWith('@lid'));
        const bareLidNums = lidJids.map(j => j.split('@')[0]);

        // Scan messages for mentions (@digits) to resolve in previews
        const mentionDigits = new Set<string>();
        for (const msg of rawLastMessages) {
            if (msg.content && msg.content.includes('@')) {
                const matches = msg.content.matchAll(/@(\d{8,25})/g);
                for (const m of matches) {
                    mentionDigits.add(m[1]);
                }
            }
        }
        const mentionList = Array.from(mentionDigits);
        const allLidNumsToQuery = Array.from(new Set([...bareLidNums, ...mentionList]));
        const allLidJidsToQuery = allLidNumsToQuery.map(n => `${n}@lid`);
        const allPhoneJidsToQuery = Array.from(new Set([
            ...jids.filter(j => j.endsWith('@s.whatsapp.net')),
            ...mentionList.map(n => `${n}@s.whatsapp.net`)
        ]));

        const [contactsForMessages, authLidMappings, allGroups, directoryContacts] = await Promise.all([
            (jids.length > 0 || mentionList.length > 0)
                ? prisma.contact.findMany({
                      where: {
                          sessionId: dbSessionId,
                          OR: [
                              { jid: { in: [...jids, ...allPhoneJidsToQuery] } },
                              ...(allLidJidsToQuery.length > 0 ? [
                                  { lid: { in: allLidJidsToQuery } },
                                  { remoteJidAlt: { in: [...jids, ...allPhoneJidsToQuery] } }
                              ] : [])
                          ]
                      },
                      select: { jid: true, lid: true, remoteJidAlt: true, name: true, notify: true, verifiedName: true, profilePic: true }
                  })
                : Promise.resolve([]),
            allLidNumsToQuery.length > 0
                ? prisma.authState.findMany({
                      where: {
                          key: { in: allLidNumsToQuery.map(n => `lid-mapping-${n}_reverse`) }
                      },
                      select: { key: true, value: true }
                  })
                : Promise.resolve([]),
            !before
                ? (groupsCache.has(dbSessionId) && groupsCache.get(dbSessionId)!.expires > Date.now()
                    ? Promise.resolve(groupsCache.get(dbSessionId)!.groups)
                    : prisma.group.findMany({
                          where: { sessionId: dbSessionId },
                          select: { jid: true, subject: true, updatedAt: true },
                          orderBy: { subject: "asc" }
                      }).then(grps => {
                          groupsCache.set(dbSessionId, { groups: grps, expires: Date.now() + 180_000 });
                          return grps;
                      }).catch(() => []))
                : prisma.group.findMany({
                      where: { sessionId: dbSessionId, jid: { in: jids } },
                      select: { jid: true, subject: true, updatedAt: true }
                  }).catch(() => []),
            !before
                ? (directoryContactsCache.has(dbSessionId) && directoryContactsCache.get(dbSessionId)!.expires > Date.now()
                    ? Promise.resolve(directoryContactsCache.get(dbSessionId)!.contacts)
                    : prisma.contact.findMany({
                          where: {
                              sessionId: dbSessionId,
                              jid: { endsWith: "@s.whatsapp.net" },
                              OR: [{ name: { not: null } }, { notify: { not: null } }]
                          },
                          select: { jid: true, lid: true, name: true, notify: true, profilePic: true },
                          orderBy: { name: "asc" },
                          take: 500
                      }).then(contacts => {
                          directoryContactsCache.set(dbSessionId, { contacts, expires: Date.now() + 180_000 });
                          return contacts;
                      }).catch(() => []))
                : Promise.resolve([])
        ]);

        // Process auth reverse mappings (LID -> Phone)
        const lidToPhoneAuth = new Map<string, string>();
        for (const a of authLidMappings) {
            const m = a.key.match(/^lid-mapping-(.+)_reverse$/);
            if (m && a.value) {
                const cleanPhone = String(a.value).replace(/\D/g, "");
                lidToPhoneAuth.set(m[1], cleanPhone);
                lidToPhoneAuth.set(`${m[1]}@lid`, cleanPhone);
            }
        }

        // Fetch any extra contacts found via auth mapping that weren't fetched yet
        const extraPhones = Array.from(lidToPhoneAuth.values()).map(p => `${p}@s.whatsapp.net`);
        const extraContacts = extraPhones.length > 0
            ? await prisma.contact.findMany({
                  where: { sessionId: dbSessionId, jid: { in: extraPhones } },
                  select: { jid: true, lid: true, remoteJidAlt: true, name: true, notify: true, verifiedName: true, profilePic: true }
              })
            : [];

        // Build lookup map with smart deduplication (keep valid names, do not overwrite with null)
        const infoMap = new Map<string, { name: string | null; notify: string | null; profilePic: string | null; phoneJid?: string | null }>();

        const setEntry = (key: string | null | undefined, newEntry: { name: string | null; notify: string | null; profilePic: string | null; phoneJid?: string | null }) => {
            if (!key) return;
            const old = infoMap.get(key);
            if (!old) {
                infoMap.set(key, newEntry);
                return;
            }
            infoMap.set(key, {
                name: newEntry.name || old.name,
                notify: newEntry.notify || old.notify,
                profilePic: newEntry.profilePic || old.profilePic,
                phoneJid: newEntry.phoneJid || old.phoneJid
            });
        };

        directoryContacts.forEach(c => {
            const entry = { name: c.name || c.notify || null, notify: c.notify, profilePic: (c.profilePic && c.profilePic.startsWith("http")) ? c.profilePic : null, phoneJid: c.jid };
            setEntry(c.jid, entry);
            if (c.lid) {
                setEntry(c.lid, entry);
                setEntry(c.lid.split('@')[0], entry);
                setEntry(`${c.lid.split('@')[0]}@lid`, entry);
            }
        });
        allGroups.forEach(g => setEntry(g.jid, { name: g.subject, notify: g.subject, profilePic: null }));

        // Prioritize contacts with names first
        const allFetchedContacts = [...contactsForMessages, ...extraContacts].sort((a, b) => {
            const aHasName = !!(a.name || a.notify || a.verifiedName);
            const bHasName = !!(b.name || b.notify || b.verifiedName);
            return (bHasName ? 1 : 0) - (aHasName ? 1 : 0);
        });

        for (const c of allFetchedContacts) {
            const displayName = c.name || c.notify || c.verifiedName || null;
            const pic = (c.profilePic && c.profilePic.startsWith("http")) ? c.profilePic : null;
            const phoneJid = c.jid.endsWith('@s.whatsapp.net') ? c.jid : (c.remoteJidAlt?.endsWith('@s.whatsapp.net') ? c.remoteJidAlt : null);
            const entry = { name: displayName, notify: c.notify, profilePic: pic, phoneJid };

            if (c.jid) {
                setEntry(c.jid, entry);
                setEntry(c.jid.split('@')[0], entry);
            }
            if (c.lid) {
                setEntry(c.lid, entry);
                setEntry(c.lid.split('@')[0], entry);
                setEntry(`${c.lid.split('@')[0]}@lid`, entry);
            }
            if (c.remoteJidAlt) {
                setEntry(c.remoteJidAlt, entry);
                setEntry(c.remoteJidAlt.split('@')[0], entry);
            }
        }

        // Connect auth reverse mappings (LID -> Phone) to infoMap entries
        for (const [lidKey, phoneNum] of lidToPhoneAuth.entries()) {
            const phoneJid = `${phoneNum}@s.whatsapp.net`;
            const phoneInfo = infoMap.get(phoneJid) || infoMap.get(phoneNum);
            if (phoneInfo && (phoneInfo.name || phoneInfo.notify)) {
                setEntry(lidKey, phoneInfo);
                const bare = lidKey.split('@')[0];
                setEntry(bare, phoneInfo);
                setEntry(`${bare}@lid`, phoneInfo);
            }
        }

        // 3. Build result array: first chats with messages (sorted by latest timestamp DESC)
        const result: any[] = [];
        const seenJids = new Set<string>();
        for (const msg of rawLastMessages) {
            let info = infoMap.get(msg.remoteJid);
            let mappedPhoneJid: string | null = null;
            if (msg.remoteJid.endsWith('@lid')) {
                const bare = msg.remoteJid.split('@')[0];
                const mappedPhone = lidToPhoneAuth.get(bare);
                if (mappedPhone) {
                    mappedPhoneJid = `${mappedPhone}@s.whatsapp.net`;
                    if (!info || !info.name) {
                        const phoneInfo = infoMap.get(mappedPhoneJid);
                        if (phoneInfo) info = phoneInfo;
                        else if (!info) info = { name: null, notify: null, profilePic: null, phoneJid: mappedPhoneJid };
                    }
                }
            }

            // Canonicalize @lid -> @s.whatsapp.net when known so the same contact never appears twice
            const canonicalJid = info?.phoneJid || mappedPhoneJid || msg.remoteJid;
            if (seenJids.has(canonicalJid) || seenJids.has(msg.remoteJid)) continue;
            seenJids.add(canonicalJid);
            seenJids.add(msg.remoteJid);

            // Resolve mentions in message preview (@digits -> @Name)
            let resolvedContent = msg.content;
            if (resolvedContent && resolvedContent.includes('@')) {
                resolvedContent = resolvedContent.replace(/@(\d{8,25})/g, (match, digits) => {
                    const found = infoMap.get(digits) ||
                        infoMap.get(`${digits}@lid`) ||
                        infoMap.get(`${digits}@s.whatsapp.net`);
                    const resolvedName = found?.name || found?.notify;
                    return (resolvedName && !/^\+?[\d\s\-\(\)]+$/.test(resolvedName.trim())) ? `@${resolvedName}` : match;
                });
            }

            result.push({
                jid: canonicalJid,
                name: info?.name || null,
                notify: info?.notify || null,
                phone: info?.phoneJid ? info.phoneJid.split('@')[0] : (canonicalJid.endsWith('@lid') ? null : canonicalJid.split('@')[0]),
                profilePic: info?.profilePic || null,
                lastMessage: {
                    content: resolvedContent,
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
                if (seenJids.has(c.jid) || (c.lid && seenJids.has(c.lid))) continue;
                seenJids.add(c.jid);
                if (c.lid) seenJids.add(c.lid);
                result.push({
                    jid: c.jid,
                    name: c.name || c.notify || null,
                    notify: c.notify || null,
                    phone: c.jid.split('@')[0],
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
                (c.phone || '').toLowerCase().includes(q) ||
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

        // 1. Resolve contact alternate JIDs (cached for 5 minutes)
        if (!isGroup) {
            const cacheKey = `${dbSessionId}:${jid}`;
            const cachedJids = contactJidsCache.get(cacheKey);
            if (cachedJids && cachedJids.expires > Date.now()) {
                queryJids = cachedJids.jids;
            } else {
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
                contactJidsCache.set(cacheKey, { jids: queryJids, expires: Date.now() + 300_000 });
            }
        }

        const where: any = {
            sessionId: dbSessionId,
            remoteJid: { in: queryJids }
        };

        // Cursor-based: load older messages before this timestamp
        if (before) {
            where.timestamp = { lt: new Date(before) };
        }

        // 2. Fetch messages, group participants & session owner concurrently in 1 roundtrip
        const sessionOwnerName = sessionNameCache.get(dbSessionId);
        const sessionNamePromise: Promise<string | null> = sessionOwnerName
            ? Promise.resolve(sessionOwnerName)
            : prisma.session.findUnique({
                  where: { id: dbSessionId },
                  select: { name: true }
              }).then(s => {
                  const n = s?.name?.trim() || null;
                  if (n) sessionNameCache.set(dbSessionId, n);
                  return n;
              }).catch(() => null);

        let groupParticipantsPromise: Promise<Array<{ id: string; phoneNumber?: string }>> = Promise.resolve([]);
        if (isGroup) {
            const groupKey = `${dbSessionId}:${jid}`;
            const cachedGroup = groupParticipantsCache.get(groupKey);
            if (cachedGroup && cachedGroup.expires > Date.now()) {
                groupParticipantsPromise = Promise.resolve(cachedGroup.participants);
            } else {
                groupParticipantsPromise = prisma.group.findFirst({
                    where: { sessionId: dbSessionId, jid },
                    select: { participants: true }
                }).then(group => {
                    const parts = (group?.participants as Array<{ id: string; phoneNumber?: string }>) || [];
                    groupParticipantsCache.set(groupKey, { participants: parts, expires: Date.now() + 180_000 });
                    return parts;
                }).catch(() => []);
            }
        }

        const [messages, groupParticipants, sessionNameResolved] = await Promise.all([
            prisma.message.findMany({
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
            }),
            groupParticipantsPromise,
            sessionNamePromise
        ]);

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

        // Pre-populate known team members
        const knownTeam: Record<string, string> = {
            "556696175239": "Alexandre Daniel",
            "556699583468": "Vinicius",
            "556696692215": "Marcelo",
            "5566996692215": "Marcelo",
            "556696473868": "Edvaldo"
        };
        for (const [phone, tName] of Object.entries(knownTeam)) {
            contactMap[phone] = tName;
            contactMap[`${phone}@s.whatsapp.net`] = tName;
        }

        // Include current session owner in contactMap
        if (sessionNameResolved) {
            contactMap["self"] = sessionNameResolved;
        }

        if (isGroup && groupParticipants.length > 0) {
            for (const p of groupParticipants) {
                if (p.id) candidateIds.add(p.id);
                if (p.phoneNumber) candidateIds.add(p.phoneNumber);
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
                    const rawName = c.name || c.notify || c.verifiedName;
                    const isPhone = rawName && /^\+?[\d\s\-\(\)]+$/.test(rawName.trim());
                    const displayName = isPhone ? null : rawName;
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
            const groupSenderKey = `${dbSessionId}:${jid}`;
            const cachedSenders = groupSendersCache.get(groupSenderKey);
            if (cachedSenders && cachedSenders.expires > Date.now()) {
                for (const s of cachedSenders.senders) {
                    if (s.senderJid && s.pushName) {
                        const bare = s.senderJid.split('@')[0];
                        if (!contactMap[s.senderJid]) contactMap[s.senderJid] = s.pushName;
                        if (!contactMap[bare]) contactMap[bare] = s.pushName;
                    }
                }
            } else {
                try {
                    const groupSenders = await prisma.message.findMany({
                        where: {
                            sessionId: dbSessionId,
                            remoteJid: jid,
                            pushName: { not: null }
                        },
                        select: { senderJid: true, pushName: true },
                        distinct: ['senderJid'],
                        take: 100
                    });
                    groupSendersCache.set(groupSenderKey, { senders: groupSenders, expires: Date.now() + 300_000 });
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

                if (name && !/^\+?[\d\s\-\(\)]+$/.test(name.trim())) {
                    if (lidNum) contactMap[lidNum] = name;
                    if (p.id) contactMap[p.id] = name;
                    if (phoneNum) contactMap[phoneNum] = name;
                    if (p.phoneNumber) contactMap[p.phoneNumber] = name;
                    participantNamesSet.add(name);
                } else if (phoneNum) {
                    const formattedPhone = `+${phoneNum}`;
                    if (lidNum && !contactMap[lidNum]) contactMap[lidNum] = formattedPhone;
                    if (p.id && !contactMap[p.id]) contactMap[p.id] = formattedPhone;
                    participantNamesSet.add(name || formattedPhone);
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
                                 (phoneNum ? `+${phoneNum}` : (lidNum || p.id || ''));
            return {
                id: p.id || '',
                name: resolvedName || (p.phoneNumber || p.id || 'Contato'),
                phoneNumber: p.phoneNumber || p.id || '',
                avatarJid: p.phoneNumber || p.id || ''
            };
        }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

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
            const cacheKey = `${dbSessionId}:${jid}`;
            const cachedJids = contactJidsCache.get(cacheKey);
            if (cachedJids && cachedJids.expires > Date.now()) {
                queryJids = cachedJids.jids;
            } else {
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
                contactJidsCache.set(cacheKey, { jids: queryJids, expires: Date.now() + 300_000 });
            }
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

    static async resolveQuotedMessageOption(sessionId: string, quotedMessageId: string | undefined, instance: any): Promise<any> {
        if (!quotedMessageId) return undefined;
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
                    ? instance?.socket?.user?.id 
                    : (quotedMsg.senderJid || quotedMsg.remoteJid);
                
                let cleanParticipant: string | undefined = undefined;
                if (rawParticipant) {
                    const [userPart, domain] = rawParticipant.split('@');
                    const cleanUser = userPart.split(':')[0];
                    cleanParticipant = domain ? `${cleanUser}@${domain}` : cleanUser;
                }

                return {
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
        return undefined;
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
        const quotedOption = await this.resolveQuotedMessageOption(sessionId, quotedMessageId, instance);

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
                    pack: msgPayload.sticker.pack || "ZapFlow Bot",
                    author: msgPayload.sticker.author || "ZapFlow",
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

                // Resolve name and phone based mentions in groups
                if (jid.endsWith('@g.us')) {
                    try {
                        let lookupDbSessionId = sessionDbIdCache.get(sessionId);
                        if (!lookupDbSessionId) {
                            const sessionRecord = await prisma.session.findFirst({
                                where: { OR: [{ sessionId }, { id: sessionId }] },
                                select: { id: true }
                            });
                            if (sessionRecord) {
                                lookupDbSessionId = sessionRecord.id;
                                sessionDbIdCache.set(sessionId, lookupDbSessionId);
                            }
                        }
                        if (lookupDbSessionId) {
                            const groupRecord = await prisma.group.findFirst({
                                where: { sessionId: lookupDbSessionId, jid },
                                select: { participants: true }
                            });
                            const parts = (groupRecord?.participants as any[]) || [];
                            if (parts.length > 0) {
                                const partJids = parts.map(p => p.phoneNumber || p.id).filter(Boolean);
                                const contacts = await prisma.contact.findMany({
                                    where: {
                                        sessionId: lookupDbSessionId,
                                        OR: [
                                            { jid: { in: partJids } },
                                            { lid: { in: parts.map(p => p.id).filter(Boolean) } }
                                        ]
                                    },
                                    select: { jid: true, lid: true, name: true, notify: true }
                                });
                                const contactNameMap = new Map<string, string[]>();
                                contacts.forEach(c => {
                                    const names = [c.name, c.notify].filter(Boolean) as string[];
                                    names.forEach(n => {
                                        const lower = n.toLowerCase().trim();
                                        const jidsForName = contactNameMap.get(lower) || [];
                                        if (c.jid) jidsForName.push(c.jid);
                                        if (c.lid) jidsForName.push(c.lid);
                                        contactNameMap.set(lower, jidsForName);
                                    });
                                });
                                parts.forEach(p => {
                                    const phone = (p.phoneNumber || p.id || "").split('@')[0];
                                    if (phone && textContent.includes(`@${phone}`)) {
                                        extractedMentions.push(p.id.endsWith('@lid') || p.id.endsWith('@s.whatsapp.net') ? p.id : `${p.id}@s.whatsapp.net`);
                                        if (p.phoneNumber) extractedMentions.push(p.phoneNumber);
                                    }
                                });
                                contactNameMap.forEach((matchedJids, nameLower) => {
                                    if (textContent.toLowerCase().includes(`@${nameLower}`)) {
                                        extractedMentions.push(...matchedJids);
                                    }
                                });
                            }
                        }
                    } catch {}
                }

                if (extractedMentions.length > 0) {
                    mentions = Array.from(new Set(extractedMentions));
                }
            }
        }

        if (msgPayload.text && mentions && Array.isArray(mentions)) {
            msgPayload.mentions = mentions;
        }

        // Ensure monotonic WhatsApp-synced timestamp so sent messages never jump above earlier messages
        let dbSessionId = sessionDbIdCache.get(sessionId);
        const normJid = normalizeJid(jid);
        const chatTsKey = `${sessionId}:${normJid}`;
        let lastChatTs: Date | null = null;
        const cachedTs = lastChatTimestampCache.get(chatTsKey);
        if (cachedTs && cachedTs.expires > Date.now()) {
            lastChatTs = cachedTs.timestamp;
        } else {
            try {
                let dbSessionId = sessionDbIdCache.get(sessionId);
                if (!dbSessionId) {
                    const sr = await prisma.session.findFirst({ where: { OR: [{ sessionId }, { id: sessionId }] }, select: { id: true } });
                    if (sr) { dbSessionId = sr.id; sessionDbIdCache.set(sessionId, dbSessionId); }
                }
                if (dbSessionId) {
                    const latestMsg = await prisma.message.findFirst({
                        where: { sessionId: dbSessionId, remoteJid: normJid },
                        orderBy: { timestamp: "desc" },
                        select: { timestamp: true }
                    });
                    lastChatTs = latestMsg?.timestamp || null;
                }
            } catch {}
        }
        const syncedTimestamp = getMonotonicChatTimestamp(lastChatTs);
        lastChatTimestampCache.set(chatTsKey, { timestamp: syncedTimestamp, expires: Date.now() + 15 * 60 * 1000 });

        // Direct user chat skips anti-spam queue to guarantee 0ms latency identical to WhatsApp Web
        const options: any = { mentions: mentions || [], skipAntiSpam: true, timestamp: syncedTimestamp };
        if (quotedOption) {
            options.quoted = quotedOption;
        }

        const sendResult = await instance.socket.sendMessage(jid, msgPayload, options);
        if (sendResult) {
            (sendResult as any).syncedTimestampMs = syncedTimestamp.getTime();
        }

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
                messageTimestamp: getSyncedNowUnixSec()
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
        caption: string,
        viewOnce = false,
        quotedMessageId?: string,
        explicitMentions?: string[]
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
        if (viewOnce && (type === 'image' || type === 'video')) {
            messageOptions.viewOnce = true;
        }

        let content: any = {};

        if (type === 'image') {
            // Compress large images (> 1MB or > 1600px) down to standard WhatsApp resolution
            // Turns 5MB-15MB photos into ~250KB in < 30ms, speeding up WhatsApp upload by 10x-20x!
            try {
                const sharp = (await import("sharp")).default;
                const meta = await sharp(buffer).metadata();
                if ((meta.width && meta.width > 1600) || (meta.height && meta.height > 1600) || buffer.length > 1024 * 1024) {
                    buffer = await sharp(buffer)
                        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
                        .jpeg({ quality: 82, progressive: true })
                        .toBuffer();
                    mimetype = "image/jpeg";
                }
            } catch {
                // If sharp fails (e.g. animated GIF), keep original buffer
            }
            content = { image: buffer, ...messageOptions };
        } else if (type === 'video') {
            content = { video: buffer, ...messageOptions };
        } else if (type === 'audio') {
            content = { audio: buffer, mimetype: mimetype || 'audio/mp4', ptt: false };
        } else if (type === 'voice') {
            const { ensureOggOpusAudio } = await import("@/lib/audio-convert");
            const convertedVoice = await ensureOggOpusAudio(buffer, mimetype);
            buffer = convertedVoice.buffer;
            mimetype = convertedVoice.mimetype;
            content = {
                audio: buffer,
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true,
                ...(convertedVoice.seconds ? { seconds: convertedVoice.seconds } : {}),
                ...(convertedVoice.waveform ? { waveform: convertedVoice.waveform } : {}),
            };
        } else if (type === 'document') {
            content = { document: buffer, mimetype, fileName, ...messageOptions };
        } else if (type === 'sticker') {
            const sticker = new Sticker(buffer, {
                pack: "ZapFlow Bot",
                author: "ZapFlow",
                type: "full",
                quality: 50
            });
            content = { sticker: await sticker.toBuffer() };
        } else {
            content = { document: buffer, mimetype, fileName, ...messageOptions };
        }

        // Automatically resolve mentions if caption contains '@' or explicitMentions passed
        let mentions: string[] = Array.isArray(explicitMentions) ? [...explicitMentions] : [];
        if (caption && caption.includes('@')) {
            const mentionDigitsRegex = /@(\d{8,25})/g;
            let m;
            while ((m = mentionDigitsRegex.exec(caption)) !== null) {
                mentions.push(`${m[1]}@s.whatsapp.net`);
            }

            // Resolve name-based mentions in groups
            if (jid.endsWith('@g.us')) {
                try {
                    let lookupDbSessionId = sessionDbIdCache.get(sessionId);
                    if (!lookupDbSessionId) {
                        const sessionRecord = await prisma.session.findFirst({
                            where: { OR: [{ sessionId }, { id: sessionId }] },
                            select: { id: true }
                        });
                        if (sessionRecord) {
                            lookupDbSessionId = sessionRecord.id;
                            sessionDbIdCache.set(sessionId, lookupDbSessionId);
                        }
                    }

                    if (lookupDbSessionId) {
                        const groupRecord = await prisma.group.findFirst({
                            where: { sessionId: lookupDbSessionId, jid },
                            select: { participants: true }
                        });

                        const parts = (groupRecord?.participants as any[]) || [];
                        if (parts.length > 0) {
                            const partJids = parts.map(p => p.phoneNumber || p.id).filter(Boolean);
                            const contacts = await prisma.contact.findMany({
                                where: {
                                    sessionId: lookupDbSessionId,
                                    OR: [
                                        { jid: { in: partJids } },
                                        { lid: { in: parts.map(p => p.id).filter(Boolean) } }
                                    ]
                                },
                                select: { jid: true, lid: true, name: true, notify: true }
                            });

                            const contactNameMap = new Map<string, string[]>();
                            contacts.forEach(c => {
                                const names = [c.name, c.notify].filter(Boolean) as string[];
                                names.forEach(n => {
                                    const lower = n.toLowerCase().trim();
                                    const jidsForName = contactNameMap.get(lower) || [];
                                    if (c.jid) jidsForName.push(c.jid);
                                    if (c.lid) jidsForName.push(c.lid);
                                    contactNameMap.set(lower, jidsForName);
                                });
                            });

                            // Check each participant name against caption
                            parts.forEach(p => {
                                const phone = (p.phoneNumber || p.id || "").split('@')[0];
                                if (phone && caption.includes(`@${phone}`)) {
                                    mentions.push(p.id.endsWith('@lid') || p.id.endsWith('@s.whatsapp.net') ? p.id : `${p.id}@s.whatsapp.net`);
                                    if (p.phoneNumber) mentions.push(p.phoneNumber);
                                }
                            });

                            contactNameMap.forEach((matchedJids, nameLower) => {
                                if (caption.toLowerCase().includes(`@${nameLower}`)) {
                                    mentions.push(...matchedJids);
                                }
                            });
                        }
                    }
                } catch (mentionErr) {
                    console.error("Error resolving caption mentions:", mentionErr);
                }
            }
            mentions = Array.from(new Set(mentions));
            if (mentions.length > 0) {
                content.mentions = mentions;
            }
        }

        let dbSessionId = sessionDbIdCache.get(sessionId);
        const normJid = normalizeJid(jid);
        const chatTsKey = `${sessionId}:${normJid}`;
        let lastChatTs: Date | null = null;
        const cachedTs = lastChatTimestampCache.get(chatTsKey);
        if (cachedTs && cachedTs.expires > Date.now()) {
            lastChatTs = cachedTs.timestamp;
        } else {
            try {
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
                    const latestMsg = await prisma.message.findFirst({
                        where: { sessionId: dbSessionId, remoteJid: normJid },
                        orderBy: { timestamp: "desc" },
                        select: { timestamp: true }
                    });
                    lastChatTs = latestMsg?.timestamp || null;
                }
            } catch {}
        }
        const syncedTimestamp = getMonotonicChatTimestamp(lastChatTs);
        lastChatTimestampCache.set(chatTsKey, { timestamp: syncedTimestamp, expires: Date.now() + 15 * 60 * 1000 });

        const quotedOption = await this.resolveQuotedMessageOption(sessionId, quotedMessageId, instance);
        const sendOptions: any = { skipAntiSpam: true, timestamp: syncedTimestamp };
        if (mentions.length > 0) {
            sendOptions.mentions = mentions;
        }
        if (quotedOption) {
            sendOptions.quoted = quotedOption;
        }

        const sendResult = await instance.socket.sendMessage(jid, content, sendOptions as any);

        const keyId = sendResult?.key?.id;
        let ext = type === 'voice' ? 'ogg' : type === 'audio' ? 'mp3' : type === 'image' ? 'jpg' : type === 'video' ? 'mp4' : 'bin';
        if (type === 'voice' || type === 'audio') {
            const lowerMime = (mimetype || '').toLowerCase();
            if (lowerMime.includes('webm') || (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3)) {
                ext = 'webm';
            } else if (lowerMime.includes('ogg') || lowerMime.includes('opus') || (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'OggS')) {
                ext = 'ogg';
            } else if (lowerMime.includes('mp4') || lowerMime.includes('m4a') || lowerMime.includes('aac')) {
                ext = 'm4a';
            } else if (lowerMime.includes('wav')) {
                ext = 'wav';
            } else if (lowerMime.includes('mpeg') || lowerMime.includes('mp3')) {
                ext = 'mp3';
            }
        }
        const savedFilename = `${sessionId}-${keyId || Date.now()}.${ext}`;
        const fileUrl = `/api/media/${savedFilename}`;
        if (keyId) {
            registerLocalSentMedia(keyId, fileUrl);
        }
        if (sendResult) {
            (sendResult as any).mediaUrl = fileUrl;
            (sendResult as any).syncedTimestampMs = syncedTimestamp.getTime();
        }

        // Instant Real-time emit: notify frontend that media message is SENT immediately (< 10ms)
        if (keyId && instance.io) {
            instance.io.to(sessionId).emit("message.status", {
                keyId,
                remoteJid: jid,
                status: "SENT"
            });
        }

        // Asynchronously persist sent media to disk and database in the background without blocking client response
        if (keyId) {
            void (async () => {
                try {
                    const savedFilePath = path.join(mediaDir, savedFilename);
                    await mkdir(path.dirname(savedFilePath), { recursive: true });
                    await writeFile(savedFilePath, buffer);

                    let activeDbSessionId = dbSessionId;
                    if (!activeDbSessionId) {
                        const sessionRecord = await prisma.session.findFirst({
                            where: { OR: [{ sessionId }, { id: sessionId }] },
                            select: { id: true }
                        });
                        if (sessionRecord) {
                            activeDbSessionId = sessionRecord.id;
                            sessionDbIdCache.set(sessionId, activeDbSessionId);
                        }
                    }

                    if (activeDbSessionId) {
                        const savedRow = await prisma.message.upsert({
                            where: {
                                sessionId_keyId: {
                                    sessionId: activeDbSessionId,
                                    keyId
                                }
                            },
                            update: {
                                mediaUrl: fileUrl,
                                status: "SENT",
                                timestamp: syncedTimestamp,
                                ...(caption ? { content: caption } : {})
                            },
                            create: {
                                sessionId: activeDbSessionId,
                                remoteJid: normJid,
                                fromMe: true,
                                keyId,
                                type: (type === 'voice' || type === 'audio') ? 'AUDIO' : type === 'image' ? 'IMAGE' : type === 'video' ? 'VIDEO' : 'DOCUMENT',
                                content: caption || "",
                                mediaUrl: fileUrl,
                                status: "SENT",
                                timestamp: syncedTimestamp
                            }
                        });
                        if (instance.io) {
                            instance.io.to(sessionId).emit("message.update", [{
                                ...savedRow,
                                timestamp: savedRow.timestamp instanceof Date ? savedRow.timestamp.toISOString() : savedRow.timestamp
                            }]);
                        }
                    }
                } catch (saveErr) {
                    logger.error("ChatService", "Failed to persist sent media in background", saveErr);
                }
            })();
        }

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
