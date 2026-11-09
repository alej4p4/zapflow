import { prisma } from "@/lib/prisma";
import type { WASocket } from "@whiskeysockets/baileys";
import { logger } from "@/lib/logger";

/**
 * Sync contacts from WhatsApp to database.
 * Uses proper Baileys events for syncing and correct Session.id foreign key.
 */
export function bindContactSync(sock: WASocket, sessionId: string) {
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

    // Handle contacts.update event (fires when contacts are updated)
    sock.ev.on('contacts.update', async (updates) => {
        if (!dbSessionId) {
            const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
            if (!session) return;
            dbSessionId = session.id;
        }
        
        logger.debug("Store", `Received ${updates.length} contact updates for session ${sessionId}`);
        const BATCH_SIZE = 20;
        for (let i = 0; i < updates.length; i += BATCH_SIZE) {
            const chunk = updates.slice(i, i + BATCH_SIZE);
            await Promise.all(
                chunk.map(update => {
                    if (!update.id) return Promise.resolve();
                    return prisma.contact.upsert({
                        where: { sessionId_jid: { sessionId: dbSessionId!, jid: update.id } },
                        create: {
                            sessionId: dbSessionId!,
                            jid: update.id,
                            name: update.name || update.notify,
                            notify: update.notify,
                            profilePic: (update.imgUrl && update.imgUrl.startsWith("http")) ? update.imgUrl : undefined
                        },
                        update: {
                            name: update.name || undefined,
                            notify: update.notify || undefined,
                            profilePic: (update.imgUrl && update.imgUrl.startsWith("http")) ? update.imgUrl : undefined
                        }
                    }).catch(e => {
                        logger.error("Store", `Failed to sync contact ${update.id}:`, e?.message || e);
                    });
                })
            );
            await new Promise(r => setImmediate(r));
        }
    });

    // Also listen for messaging events to auto-create contacts
    sock.ev.on('messaging-history.set', async ({ chats, contacts, messages, isLatest }) => {
        if (!dbSessionId) {
            const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
            if (!session) return;
            dbSessionId = session.id;
        }
        
        logger.info("Store", `Received messaging history: ${chats.length} chats, ${contacts?.length || 0} contacts, ${messages.length} messages`);
        
        // Sync chats as contacts (for personal chats) in batches of 20
        const validChats = chats.filter(c => c.id && !c.id.includes('@g.us') && !c.id.includes('@broadcast'));
        const BATCH_SIZE = 20;

        for (let i = 0; i < validChats.length; i += BATCH_SIZE) {
            const chunk = validChats.slice(i, i + BATCH_SIZE);
            await Promise.all(
                chunk.map(chat =>
                    prisma.contact.upsert({
                        where: { sessionId_jid: { sessionId: dbSessionId!, jid: chat.id! } },
                        create: {
                            sessionId: dbSessionId!,
                            jid: chat.id!,
                            name: chat.name || undefined,
                            notify: (chat as any).notify || undefined
                        },
                        update: {
                            name: chat.name || undefined
                        }
                    }).catch(e => {
                        logger.error("Store", `Failed to sync chat contact ${chat.id}:`, e?.message || e);
                    })
                )
            );
            await new Promise(r => setImmediate(r));
        }
        
        // Sync explicit contacts in batches of 20
        if (contacts && contacts.length > 0) {
            const validContacts = contacts.filter(c => c.id);
            for (let i = 0; i < validContacts.length; i += BATCH_SIZE) {
                const chunk = validContacts.slice(i, i + BATCH_SIZE);
                await Promise.all(
                    chunk.map(contact =>
                        prisma.contact.upsert({
                            where: { sessionId_jid: { sessionId: dbSessionId!, jid: contact.id! } },
                            create: {
                                sessionId: dbSessionId!,
                                jid: contact.id!,
                                name: contact.name || contact.notify,
                                notify: contact.notify
                            },
                            update: {
                                name: contact.name || undefined,
                                notify: contact.notify || undefined
                            }
                        }).catch(e => {
                            logger.error("Store", `Failed to sync contact ${contact.id}:`, e?.message || e);
                        })
                    )
                );
                await new Promise(r => setImmediate(r));
            }
        }
        
        logger.success("Store", `Synced contacts from messaging history for session ${sessionId}`);
    });
}
