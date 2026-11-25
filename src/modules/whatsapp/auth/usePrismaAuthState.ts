import { prisma } from "@/lib/prisma";
import { AuthenticationCreds, AuthenticationState, BufferJSON, initAuthCreds, proto, SignalDataTypeMap } from "@whiskeysockets/baileys";
import { logger } from "@/lib/logger";

// In-memory key-value cache per session: sessionId -> Map<dbKey, parsedValue>
const sessionKeyCache = new Map<string, Map<string, any>>();
// Pending writes per session: sessionId -> Map<dbKey, any>
const sessionPendingWrites = new Map<string, Map<string, any>>();
// Pending deletes per session: sessionId -> Set<dbKey>
const sessionPendingDeletes = new Map<string, Set<string>>();
// Active flush timer per session
const sessionFlushTimers = new Map<string, NodeJS.Timeout>();
// Active in-progress flush promise per session to prevent overlapping flushes
const sessionFlushPromises = new Map<string, Promise<void>>();

function getSessionCache(sessionId: string): Map<string, any> {
    let cache = sessionKeyCache.get(sessionId);
    if (!cache) {
        cache = new Map<string, any>();
        sessionKeyCache.set(sessionId, cache);
    }
    return cache;
}

function getPendingWrites(sessionId: string): Map<string, any> {
    let map = sessionPendingWrites.get(sessionId);
    if (!map) {
        map = new Map<string, any>();
        sessionPendingWrites.set(sessionId, map);
    }
    return map;
}

function getPendingDeletes(sessionId: string): Set<string> {
    let set = sessionPendingDeletes.get(sessionId);
    if (!set) {
        set = new Set<string>();
        sessionPendingDeletes.set(sessionId, set);
    }
    return set;
}

/**
 * Flushes pending auth writes and deletes to Neon asynchronously.
 * Controlled batching ensures Neon PgBouncer connection limits are never exceeded.
 */
export async function flushSessionAuth(sessionId: string): Promise<void> {
    const existing = sessionFlushPromises.get(sessionId);
    if (existing) {
        try { await existing; } catch {}
    }

    const timer = sessionFlushTimers.get(sessionId);
    if (timer) {
        clearTimeout(timer);
        sessionFlushTimers.delete(sessionId);
    }

    const writesMap = sessionPendingWrites.get(sessionId);
    const deletesSet = sessionPendingDeletes.get(sessionId);

    const hasWrites = writesMap && writesMap.size > 0;
    const hasDeletes = deletesSet && deletesSet.size > 0;

    if (!hasWrites && !hasDeletes) return;

    // Snapshot work and clear pending containers
    const writes = hasWrites ? Array.from(writesMap.entries()) : [];
    const deletes = hasDeletes ? Array.from(deletesSet) : [];
    writesMap?.clear();
    deletesSet?.clear();

    const doFlush = async () => {
        try {
            // 1. Batch delete removed keys
            if (deletes.length > 0) {
                await prisma.authState.deleteMany({
                    where: { sessionId, key: { in: deletes } }
                }).catch(e => logger.error("Auth", `Error batch deleting auth state for ${sessionId}:`, e));
            }

            // 2. Batch upsert updated keys in controlled chunks (concurrency 8) to protect PgBouncer pool
            if (writes.length > 0) {
                const CHUNK_SIZE = 8;
                for (let i = 0; i < writes.length; i += CHUNK_SIZE) {
                    const chunk = writes.slice(i, i + CHUNK_SIZE);
                    await Promise.all(chunk.map(([key, value]) =>
                        prisma.authState.upsert({
                            where: { sessionId_key: { sessionId, key } },
                            create: { sessionId, key, value },
                            update: { value }
                        }).catch(e => logger.error("Auth", `Error upserting auth key ${key} for ${sessionId}:`, e))
                    ));
                }
            }
        } catch (err) {
            logger.error("Auth", `Unexpected error during flushSessionAuth for ${sessionId}:`, err);
        } finally {
            sessionFlushPromises.delete(sessionId);
        }
    };

    const flushPromise = doFlush();
    sessionFlushPromises.set(sessionId, flushPromise);
    await flushPromise;
}

/**
 * Flush all active sessions on server shutdown.
 */
export async function flushAllAuthStates(): Promise<void> {
    const sessionIds = Array.from(new Set([
        ...Array.from(sessionPendingWrites.keys()),
        ...Array.from(sessionPendingDeletes.keys())
    ]));
    await Promise.all(sessionIds.map(id => flushSessionAuth(id)));
}

function scheduleFlush(sessionId: string, immediate = false) {
    if (immediate) {
        if (sessionFlushTimers.has(sessionId)) {
            clearTimeout(sessionFlushTimers.get(sessionId)!);
            sessionFlushTimers.delete(sessionId);
        }
        void flushSessionAuth(sessionId);
        return;
    }

    if (sessionFlushTimers.has(sessionId)) return;

    const t = setTimeout(() => {
        sessionFlushTimers.delete(sessionId);
        void flushSessionAuth(sessionId);
    }, 400); // 400ms debounce
    sessionFlushTimers.set(sessionId, t);
}

export const usePrismaAuthState = async (sessionId: string): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> => {
    
    // Helper to read JSON with Buffer handling for single keys (e.g. creds) with memory caching
    const readData = async (type: string, id: string) => {
        const key = `${type}-${id}`;
        const cache = getSessionCache(sessionId);
        if (cache.has(key)) {
            return cache.get(key);
        }

        try {
            const data = await prisma.authState.findUnique({
                where: { sessionId_key: { sessionId, key } }
            });
            if (data && data.value) {
                const parsed = JSON.parse(JSON.stringify(data.value), BufferJSON.reviver);
                cache.set(key, parsed);
                return parsed;
            }
            return null;
        } catch (error) {
            logger.error("Auth", 'Error reading auth state:', error);
            return null;
        }
    };

    // Helper to write single data key (e.g. creds)
    const writeData = async (type: string, id: string, data: any) => {
        const key = `${type}-${id}`;
        const cache = getSessionCache(sessionId);
        cache.set(key, data);

        try {
            const value = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
            // For creds, write immediately to Neon so credentials are guaranteed saved
            await prisma.authState.upsert({
                where: { sessionId_key: { sessionId, key } },
                create: { sessionId, key, value },
                update: { value }
            });
        } catch (error) {
            logger.error("Auth", 'Error writing auth state:', error);
        }
    };

    const creds: AuthenticationCreds = (await readData('creds', 'me')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data: { [key: string]: SignalDataTypeMap[typeof type] } = {};
                    if (!ids || ids.length === 0) return data;

                    const cache = getSessionCache(sessionId);
                    const missingDbKeys: string[] = [];
                    const keyMap = new Map<string, string>();

                    for (const id of ids) {
                        const dbKey = `${type}-${id}`;
                        if (cache.has(dbKey)) {
                            data[id] = cache.get(dbKey);
                        } else {
                            missingDbKeys.push(dbKey);
                            keyMap.set(dbKey, id);
                        }
                    }

                    // Cache hit for all requested keys -> return immediately in 0ms!
                    if (missingDbKeys.length === 0) {
                        return data;
                    }

                    try {
                        // Batch query missing keys in 1 single round-trip to PostgreSQL
                        const records = await prisma.authState.findMany({
                            where: {
                                sessionId,
                                key: { in: missingDbKeys }
                            }
                        });

                        for (const record of records) {
                            if (!record.value) continue;
                            const id = keyMap.get(record.key);
                            if (!id) continue;
                            let value = JSON.parse(JSON.stringify(record.value), BufferJSON.reviver);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value) as any;
                            }
                            if (value) {
                                cache.set(record.key, value);
                                data[id] = value;
                            }
                        }
                    } catch (err) {
                        logger.error("Auth", `Error in batch keys.get for ${type}:`, err);
                    }
                    return data;
                },
                set: async (data) => {
                    const cache = getSessionCache(sessionId);
                    const pendingWrites = getPendingWrites(sessionId);
                    const pendingDeletes = getPendingDeletes(sessionId);
                    let totalWrites = 0;

                    for (const category in data) {
                        const categoryData = data[category as keyof typeof data];
                        if (!categoryData) continue;
                        
                        for (const id in categoryData) {
                            const value = categoryData[id];
                            const key = `${category}-${id}`;
                            if (value) {
                                cache.set(key, value);
                                pendingWrites.set(key, JSON.parse(JSON.stringify(value, BufferJSON.replacer)));
                                pendingDeletes.delete(key);
                                totalWrites++;
                            } else {
                                cache.delete(key);
                                pendingDeletes.add(key);
                                pendingWrites.delete(key);
                            }
                        }
                    }

                    // Schedule background flush to Neon.
                    // Baileys is NOT blocked by cross-continental DB latency!
                    scheduleFlush(sessionId, totalWrites >= 30);
                }
            }
        },
        saveCreds: async () => {
            await writeData('creds', 'me', creds);
        }
    };
};
