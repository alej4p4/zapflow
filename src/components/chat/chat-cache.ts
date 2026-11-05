import { getChatMessages } from "@/app/dashboard/chat/actions";

export interface Message {
    id: string;
    keyId: string;
    content: string;
    fromMe: boolean;
    senderJid?: string | null;
    timestamp: string;
    type: string;
    status: string;
    pushName?: string;
    mediaUrl?: string;
    remoteJid?: string;
    quoteId?: string | null;
    reactions?: Record<string, number>;
    userReaction?: string;
    isEdited?: boolean;
    quoted?: {
        keyId: string;
        content: string | null;
        fromMe: boolean;
        senderJid: string | null;
        pushName: string | null;
        type?: string;
        mediaUrl?: string | null;
    } | null;
}

export interface GroupParticipant {
    id: string;
    name: string;
    phoneNumber?: string;
    avatarJid?: string;
}

export interface CachedChat {
    messages: Message[];
    hasMore: boolean;
    oldestTimestamp: string | null;
    cachedAt: number;
    contactMap?: Record<string, string>;
    participantNames?: string[];
    participantsList?: GroupParticipant[];
}

// In-memory cache keyed by "sessionId:jid"
export const chatCache = new Map<string, CachedChat>();
const inFlightRequests = new Map<string, Promise<{ messages: Message[]; hasMore: boolean; contactMap?: Record<string, string>; participantNames?: string[]; participantsList?: GroupParticipant[] }>>();

export async function fetchOrGetChatMessages(
    sessionId: string,
    jid: string,
    limit = 50,
    before?: string
): Promise<{ messages: Message[]; hasMore: boolean; contactMap?: Record<string, string>; participantNames?: string[]; participantsList?: GroupParticipant[] }> {
    const cacheKey = `${sessionId}:${jid}`;

    if (!before && inFlightRequests.has(cacheKey)) {
        return inFlightRequests.get(cacheKey)!;
    }

    const promise = (async () => {
        try {
            const data: any = await getChatMessages(sessionId, jid, limit, before);
            const messages: Message[] = data.messages || [];
            const hasMore: boolean = Boolean(data.hasMore);
            const contactMap: Record<string, string> = data.contactMap || {};
            const participantNames: string[] = data.participantNames || [];
            const participantsList: GroupParticipant[] = data.participantsList || [];

            if (!before && messages) {
                chatCache.set(cacheKey, {
                    messages,
                    hasMore,
                    oldestTimestamp: messages.length > 0 ? messages[0].timestamp : null,
                    cachedAt: Date.now(),
                    contactMap,
                    participantNames,
                    participantsList
                });
            } else if (before && chatCache.has(cacheKey)) {
                const existing = chatCache.get(cacheKey)!;
                existing.contactMap = { ...(existing.contactMap || {}), ...contactMap };
                if (participantsList.length > 0) existing.participantsList = participantsList;
            }
            return { messages, hasMore, contactMap, participantNames, participantsList };
        } finally {
            inFlightRequests.delete(cacheKey);
        }
    })();

    if (!before) {
        inFlightRequests.set(cacheKey, promise);
    }
    return promise;
}

export function prefetchChatMessages(sessionId: string, jid: string) {
    const cacheKey = `${sessionId}:${jid}`;
    if (chatCache.has(cacheKey) || inFlightRequests.has(cacheKey)) return;
    fetchOrGetChatMessages(sessionId, jid, 50).catch(() => {});
}
