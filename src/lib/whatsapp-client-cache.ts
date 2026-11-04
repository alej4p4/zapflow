// In-memory client cache for WhatsApp contacts and groups (WhatsApp Web method)

export interface CachedContact {
    id: string;
    jid: string;
    name: string | null;
    notify: string | null;
    verifiedName: string | null;
    remoteJidAlt: string | null;
    profilePic?: string | null;
}

export interface CachedGroup {
    id: string;
    jid: string;
    subject: string | null;
    participants?: any[];
}

const contactsCache = new Map<string, { data: CachedContact[]; timestamp: number }>();
const groupsCache = new Map<string, { data: CachedGroup[]; timestamp: number }>();
const inFlightContacts = new Map<string, Promise<CachedContact[]>>();
const inFlightGroups = new Map<string, Promise<CachedGroup[]>>();

const TTL = 3 * 60 * 1000; // 3 minutes

export async function fetchCachedPhoneContacts(sessionId: string, force = false): Promise<CachedContact[]> {
    if (!sessionId) return [];
    const now = Date.now();
    const cached = contactsCache.get(sessionId);
    if (!force && cached && (now - cached.timestamp < TTL)) {
        return cached.data;
    }

    if (inFlightContacts.has(sessionId)) {
        return inFlightContacts.get(sessionId)!;
    }

    const promise = (async () => {
        try {
            const res = await fetch(`/api/contacts/${sessionId}?limit=all&phones=1`);
            if (res.ok) {
                const json = await res.json();
                const list = (json.data || []) as CachedContact[];
                contactsCache.set(sessionId, { data: list, timestamp: Date.now() });
                return list;
            }
            return cached?.data || [];
        } catch (e) {
            console.error("fetchCachedPhoneContacts error", e);
            return cached?.data || [];
        } finally {
            inFlightContacts.delete(sessionId);
        }
    })();

    inFlightContacts.set(sessionId, promise);
    return promise;
}

export function getCachedPhoneContacts(sessionId: string): CachedContact[] | null {
    const cached = contactsCache.get(sessionId);
    return cached ? cached.data : null;
}

export async function fetchCachedGroups(sessionId: string, force = false): Promise<CachedGroup[]> {
    if (!sessionId) return [];
    const now = Date.now();
    const cached = groupsCache.get(sessionId);
    if (!force && cached && (now - cached.timestamp < TTL)) {
        return cached.data;
    }

    if (inFlightGroups.has(sessionId)) {
        return inFlightGroups.get(sessionId)!;
    }

    const promise = (async () => {
        try {
            const res = await fetch(`/api/groups/${sessionId}`);
            if (res.ok) {
                const json = await res.json();
                const list = (json.data || []) as CachedGroup[];
                groupsCache.set(sessionId, { data: list, timestamp: Date.now() });
                return list;
            }
            return cached?.data || [];
        } catch (e) {
            console.error("fetchCachedGroups error", e);
            return cached?.data || [];
        } finally {
            inFlightGroups.delete(sessionId);
        }
    })();

    inFlightGroups.set(sessionId, promise);
    return promise;
}

export function getCachedGroups(sessionId: string): CachedGroup[] | null {
    const cached = groupsCache.get(sessionId);
    return cached ? cached.data : null;
}

export function invalidateWhatsAppClientCache(sessionId?: string) {
    if (sessionId) {
        contactsCache.delete(sessionId);
        groupsCache.delete(sessionId);
    } else {
        contactsCache.clear();
        groupsCache.clear();
    }
}
