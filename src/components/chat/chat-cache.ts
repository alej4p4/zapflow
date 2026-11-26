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

// Global in-memory map of known participant / contact names for mentions across all conversations
export const globalContactMap = new Map<string, string>();

export function registerGlobalContacts(map?: Record<string, string> | Map<string, string> | null) {
    if (!map) return;
    const entries = map instanceof Map ? map.entries() : Object.entries(map);
    for (const [k, v] of entries) {
        if (k && v && !/^\+?[\d\s\-\(\)]+$/.test(v.trim())) {
            globalContactMap.set(k, v);
            const bare = k.split("@")[0].replace(/\D/g, "");
            if (bare) globalContactMap.set(bare, v);
        }
    }
}

// In-memory cache keyed by "sessionId:jid"
export const chatCache = new Map<string, CachedChat>();
const inFlightRequests = new Map<string, Promise<{ messages: Message[]; hasMore: boolean; contactMap?: Record<string, string>; participantNames?: string[]; participantsList?: GroupParticipant[] }>>();

export async function fetchOrGetChatMessages(
    sessionId: string,
    jid: string,
    limit = 50,
    before?: string,
    forceFresh = false
): Promise<{ messages: Message[]; hasMore: boolean; contactMap?: Record<string, string>; participantNames?: string[]; participantsList?: GroupParticipant[] }> {
    const cacheKey = `${sessionId}:${jid}`;

    if (!before && !forceFresh && inFlightRequests.has(cacheKey)) {
        return inFlightRequests.get(cacheKey)!;
    }

    const promise = (async () => {
        try {
            const data: any = await getChatMessages(sessionId, jid, limit, before);
            const messages: Message[] = data?.messages || [];
            const hasMore: boolean = Boolean(data?.hasMore);
            const contactMap: Record<string, string> = data?.contactMap || {};
            const participantNames: string[] = data?.participantNames || [];
            const participantsList: GroupParticipant[] = data?.participantsList || [];

            registerGlobalContacts(contactMap);
            for (const p of participantsList) {
                if (p.name && !/^\+?[\d\s\-\(\)]+$/.test(p.name.trim())) {
                    if (p.id) globalContactMap.set(p.id, p.name);
                    const bare = p.id.split("@")[0].replace(/\D/g, "");
                    if (bare) globalContactMap.set(bare, p.name);
                    if (p.phoneNumber) {
                        const pBare = p.phoneNumber.split("@")[0].replace(/\D/g, "");
                        if (pBare) globalContactMap.set(pBare, p.name);
                    }
                }
            }

            if (!before) {
                if (messages.length > 0) {
                    chatCache.set(cacheKey, {
                        messages,
                        hasMore,
                        oldestTimestamp: messages[0].timestamp,
                        cachedAt: Date.now(),
                        contactMap,
                        participantNames,
                        participantsList
                    });
                } else if (!chatCache.has(cacheKey)) {
                    // Only cache empty if there wasn't a previous cached conversation
                    chatCache.set(cacheKey, {
                        messages: [],
                        hasMore: false,
                        oldestTimestamp: null,
                        cachedAt: Date.now(),
                        contactMap,
                        participantNames,
                        participantsList
                    });
                }
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
