import { prisma } from "@/lib/prisma";
import type { WASocket } from "@whiskeysockets/baileys";
import { logger } from "@/lib/logger";

export async function syncGroups(sock: WASocket, sessionId: string) {
    try {
        // Verify session exists and get the actual database ID
        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });
        
        if (!session) {
            logger.error("Store", `Session ${sessionId} does not exist, cannot sync groups`);
            return;
        }

        // Use session.id (cuid) for foreign key, not sessionId string
        const dbSessionId = session.id;

        const groups = await sock.groupFetchAllParticipating();
        const groupList = Object.values(groups);

        logger.info("Store", `Found ${groupList.length} groups for session ${sessionId}`);

        // Chunk in batches of 15 to avoid saturating DB connections and reduce time from 36s to ~1.5s
        const BATCH_SIZE = 15;
        for (let i = 0; i < groupList.length; i += BATCH_SIZE) {
            const chunk = groupList.slice(i, i + BATCH_SIZE);
            await Promise.all(
                chunk.map(g =>
                    prisma.group.upsert({
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
                    }).catch(e => {
                        logger.error("Store", `Failed to sync group ${g.id}`, e?.message || e);
                    })
                )
            );
        }
        logger.success("Store", `Synced ${groupList.length} groups for session ${sessionId}`);
    } catch (e) {
        logger.error("Store", "Failed to sync groups", e);
    }
}
