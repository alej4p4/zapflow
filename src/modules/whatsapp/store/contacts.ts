import { prisma } from "@/lib/prisma";
import type { WASocket } from "@whiskeysockets/baileys";
import { logger } from "@/lib/logger";

function cleanLidJid(raw?: string | null): string | undefined {
    if (!raw || !raw.includes("@lid")) return undefined;
    const base = raw.split(":")[0].split("@")[0].replace(/\D/g, "");
    return base ? `${base}@lid` : undefined;
}

function cleanPnJid(raw?: string | null): string | undefined {
    if (!raw || !raw.includes("@s.whatsapp.net")) return undefined;
    const base = raw.split(":")[0].split("@")[0].replace(/\D/g, "");
    return base ? `${base}@s.whatsapp.net` : undefined;
}

export async function upsertAndCrossLinkContact(dbSessionId: string, raw: any) {
    if (!raw?.id || raw.id.includes("@broadcast") || raw.id.includes("@g.us")) return;

    const jid: string = raw.id;
    const lid = cleanLidJid(raw.lid) || (jid.endsWith("@lid") ? cleanLidJid(jid) : undefined);
    const pn = cleanPnJid(raw.phoneNumber || raw.pnJid || raw.remoteJidAlt) || (jid.endsWith("@s.whatsapp.net") ? cleanPnJid(jid) : undefined);
    const name: string | undefined = raw.name || raw.fullName || raw.verifiedName || undefined;
    const notify: string | undefined = raw.notify || undefined;
    const profilePic: string | undefined = (raw.imgUrl && typeof raw.imgUrl === "string" && raw.imgUrl.startsWith("http")) ? raw.imgUrl : undefined;

    await prisma.contact.upsert({
        where: { sessionId_jid: { sessionId: dbSessionId, jid } },
        create: {
            sessionId: dbSessionId,
            jid,
            lid,
            remoteJidAlt: pn && pn !== jid ? pn : undefined,
            name: name || notify,
            notify,
            verifiedName: raw.verifiedName || undefined,
            profilePic
        },
        update: {
            ...(lid ? { lid } : {}),
            ...(pn && pn !== jid ? { remoteJidAlt: pn } : {}),
            ...(name ? { name } : {}),
            ...(notify ? { notify } : {}),
            ...(raw.verifiedName ? { verifiedName: raw.verifiedName } : {}),
            ...(profilePic ? { profilePic } : {})
        }
    }).catch(() => {});

    // Cross-link the counterpart record (@lid <-> @s.whatsapp.net) so both have the saved name & link
    if (lid && pn && lid !== pn) {
        if (jid === pn) {
            await prisma.contact.updateMany({
                where: { sessionId: dbSessionId, jid: lid },
                data: {
                    remoteJidAlt: pn,
                    lid,
                    ...(name ? { name } : {}),
                    ...(notify ? { notify } : {})
                }
            }).catch(() => {});
        } else if (jid === lid && (name || notify)) {
            await prisma.contact.upsert({
                where: { sessionId_jid: { sessionId: dbSessionId, jid: pn } },
                create: {
                    sessionId: dbSessionId,
                    jid: pn,
                    lid,
                    name: name || notify,
                    notify
                },
                update: {
                    lid,
                    ...(name ? { name } : {}),
                    ...(notify ? { notify } : {})
                }
            }).catch(() => {});
        }
    }
}

/**
 * Full background synchronization of phonebook contacts (via AppState) and LID<->Phone resolution (via Groups + USync).
 */
export async function syncAddressBookAndLids(sock: WASocket, sessionId: string, dbSessionIdParam?: string) {
    try {
        let dbSessionId = dbSessionIdParam;
        if (!dbSessionId) {
            const s = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
            if (!s) return;
            dbSessionId = s.id;
        }

        // 1. Trigger WhatsApp AppState resync for contact collections so all phonebook contacts are pulled
        try {
            if (typeof (sock as any).resyncAppState === "function") {
                logger.info("Store", `Resyncing WhatsApp AppState contacts for session ${sessionId}...`);
                await (sock as any).resyncAppState(
                    ["critical_unblock_low", "regular_high", "regular_low", "regular"],
                    false
                );
            }
        } catch (err: any) {
            logger.warn("Store", `AppState resync warning for ${sessionId}: ${err?.message || err}`);
        }

        // 2. Resolve LIDs for saved @s.whatsapp.net contacts that still have lid = null via USync
        const unlinkedPnContacts = await prisma.contact.findMany({
            where: {
                sessionId: dbSessionId,
                jid: { endsWith: "@s.whatsapp.net" },
                lid: null
            },
            select: { id: true, jid: true, name: true, notify: true }
        });

        if (unlinkedPnContacts.length > 0 && (sock as any).signalRepository?.lidMapping?.getLIDsForPNs) {
            logger.info("Store", `Resolving LIDs via USync for ${unlinkedPnContacts.length} saved phonebook contacts...`);
            const CHUNK = 50;
            let resolvedCount = 0;

            for (let i = 0; i < unlinkedPnContacts.length; i += CHUNK) {
                const batch = unlinkedPnContacts.slice(i, i + CHUNK);
                const pnJids = batch.map(c => c.jid);
                try {
                    const pairs = await (sock as any).signalRepository.lidMapping.getLIDsForPNs(pnJids);
                    if (Array.isArray(pairs) && pairs.length > 0) {
                        const byPn = new Map(batch.map(c => [c.jid, c]));
                        await Promise.all(
                            pairs.map(async (pair: { lid: string; pn: string }) => {
                                const cleanLid = cleanLidJid(pair.lid);
                                const cleanPn = cleanPnJid(pair.pn);
                                if (!cleanLid || !cleanPn) return;
                                const contactObj = byPn.get(cleanPn);
                                await prisma.contact.updateMany({
                                    where: { sessionId: dbSessionId!, jid: cleanPn },
                                    data: { lid: cleanLid }
                                }).catch(() => {});

                                await prisma.contact.updateMany({
                                    where: { sessionId: dbSessionId!, jid: cleanLid },
                                    data: {
                                        remoteJidAlt: cleanPn,
                                        lid: cleanLid,
                                        ...(contactObj?.name ? { name: contactObj.name } : {}),
                                        ...(contactObj?.notify ? { notify: contactObj.notify } : {})
                                    }
                                }).catch(() => {});
                                resolvedCount++;
                            })
                        );
                    }
                } catch {
                    // Continue with next batch if one USync chunk fails
                }
                await new Promise(r => setTimeout(r, 150));
            }
            logger.success("Store", `Resolved ${resolvedCount} contact LIDs via USync for session ${sessionId}`);
        }

        // 3. Cross-link any @lid contact whose LID matches a saved @s.whatsapp.net contact
        const allSavedPnWithLid = await prisma.contact.findMany({
            where: {
                sessionId: dbSessionId,
                jid: { endsWith: "@s.whatsapp.net" },
                lid: { not: null },
                OR: [{ name: { not: null } }, { notify: { not: null } }]
            },
            select: { jid: true, lid: true, name: true, notify: true }
        });

        const BATCH = 50;
        for (let i = 0; i < allSavedPnWithLid.length; i += BATCH) {
            const chunk = allSavedPnWithLid.slice(i, i + BATCH);
            await Promise.all(
                chunk.map(c =>
                    prisma.contact.updateMany({
                        where: { sessionId: dbSessionId!, jid: c.lid!, name: null },
                        data: {
                            remoteJidAlt: c.jid,
                            lid: c.lid!,
                            ...(c.name ? { name: c.name } : {}),
                            ...(c.notify ? { notify: c.notify } : {})
                        }
                    }).catch(() => {})
                )
            );
        }
    } catch (e: any) {
        logger.error("Store", `Error in syncAddressBookAndLids for ${sessionId}:`, e?.message || e);
    }
}

/**
 * Sync contacts from WhatsApp to database.
 * Uses proper Baileys events for syncing and correct Session.id foreign key.
 */
export function bindContactSync(sock: WASocket, sessionId: string) {
    if ((sock as any)._contactSyncBound) return;
    (sock as any)._contactSyncBound = true;

    let dbSessionId: string | null = null;

    // Initialize by fetching the session ID
    (async () => {
        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });
        if (session) {
            dbSessionId = session.id;
            logger.info("Store", `Contact sync initialized for session ${sessionId} (db: ${dbSessionId})`);
        } else {
            logger.error("Store", `Session ${sessionId} not found for contact sync`);
        }
    })();

    // When connection opens, run full address book & LID sync in background
    sock.ev.on("connection.update", async (update) => {
        if (update.connection === "open") {
            setTimeout(() => {
                syncAddressBookAndLids(sock, sessionId, dbSessionId || undefined).catch(() => {});
            }, 3000);
        }
    });

    // Handle contacts.update event (fires when contacts are updated)
    sock.ev.on("contacts.update", async (updates) => {
        if (!dbSessionId) {
            const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
            if (!session) return;
            dbSessionId = session.id;
        }

        const BATCH_SIZE = 25;
        for (let i = 0; i < updates.length; i += BATCH_SIZE) {
            const chunk = updates.slice(i, i + BATCH_SIZE);
            await Promise.all(chunk.map(u => upsertAndCrossLinkContact(dbSessionId!, u)));
            await new Promise(r => setImmediate(r));
        }
    });

    // Listen for messaging-history.set to sync chats and contacts with full LID & phoneNumber links
    sock.ev.on("messaging-history.set", async ({ chats, contacts }) => {
        if (!dbSessionId) {
            const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
            if (!session) return;
            dbSessionId = session.id;
        }

        const validChats = (chats || []).filter(c => c.id && !c.id.includes("@g.us") && !c.id.includes("@broadcast"));
        const BATCH_SIZE = 25;

        for (let i = 0; i < validChats.length; i += BATCH_SIZE) {
            const chunk = validChats.slice(i, i + BATCH_SIZE);
            await Promise.all(chunk.map(chat => upsertAndCrossLinkContact(dbSessionId!, chat)));
            await new Promise(r => setImmediate(r));
        }

        if (contacts && contacts.length > 0) {
            const validContacts = contacts.filter(c => c.id);
            for (let i = 0; i < validContacts.length; i += BATCH_SIZE) {
                const chunk = validContacts.slice(i, i + BATCH_SIZE);
                await Promise.all(chunk.map(contact => upsertAndCrossLinkContact(dbSessionId!, contact)));
                await new Promise(r => setImmediate(r));
            }
        }

        logger.success("Store", `Synced contacts from messaging history for session ${sessionId}`);
    });
}
