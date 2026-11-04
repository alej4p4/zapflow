import { getChatMessages } from "@/app/dashboard/chat/actions";

export interface Message {
    id: string;
    keyId: string;
    content: string;
    fromMe: boolean;
    timestamp: string;
    type: string;
    status: string;
    pushName?: string;
    mediaUrl?: string;
    remoteJid?: string;
    quoteId?: string | null;
    quoted?: {
        keyId: string;
        content: string | null;
        fromMe: boolean;
        senderJid: string | null;
        pushName: string | null;
    } | null;
}

export interface CachedChat {
    messages: Message[];
    hasMore: boolean;
    oldestTimestamp: string | null;
    cachedAt: number;
}

// In-memory cache keyed by "sessionId:jid"
export const chatCache = new Map<string, CachedChat>();
const inFlightRequests = new Map<string, Promise<{ messages: Message[]; hasMore: boolean }>>();

export async function fetchOrGetChatMessages(
    sessionId: string,
    jid: string,
    limit = 50,
    before?: string
): Promise<{ messages: Message[]; hasMore: boolean }> {
    const cacheKey = `${sessionId}:${jid}`;

    if (!before && inFlightRequests.has(cacheKey)) {
        return inFlightRequests.get(cacheKey)!;
    }

    const promise = (async () => {
        try {
            const data: any = await getChatMessages(sessionId, jid, limit, before);
            const messages: Message[] = data.messages || [];
            const hasMore: boolean = Boolean(data.hasMore);

            if (!before && messages) {
                chatCache.set(cacheKey, {
                    messages,
                    hasMore,
                    oldestTimestamp: messages.length > 0 ? messages[0].timestamp : null,
                    cachedAt: Date.now()
                });
            }
            return { messages, hasMore };
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
