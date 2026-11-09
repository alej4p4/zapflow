import { prisma } from "@/lib/prisma";
import { AuthenticationCreds, AuthenticationState, BufferJSON, initAuthCreds, SignalDataTypeMap } from "@whiskeysockets/baileys";
import { logger } from "@/lib/logger";

export const usePrismaAuthState = async (sessionId: string): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> => {
    
    // Helper to read JSON with Buffer handling for single keys (e.g. creds)
    const readData = async (type: string, id: string) => {
        try {
            const key = `${type}-${id}`;
            const data = await prisma.authState.findUnique({
                where: { sessionId_key: { sessionId, key } }
            });
            if (data && data.value) {
                return JSON.parse(JSON.stringify(data.value), BufferJSON.reviver);
            }
            return null;
        } catch (error) {
            logger.error("Auth", 'Error reading auth state:', error);
            return null;
        }
    };

    // Helper to write single data key (e.g. creds)
    const writeData = async (type: string, id: string, data: any) => {
        try {
            const key = `${type}-${id}`;
            const value = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
            
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

                    try {
                        const keyMap = new Map<string, string>();
                        const dbKeys = ids.map(id => {
                            const dbKey = `${type}-${id}`;
                            keyMap.set(dbKey, id);
                            return dbKey;
                        });

                        // Batch query all keys in 1 single round-trip to PostgreSQL
                        const records = await prisma.authState.findMany({
                            where: {
                                sessionId,
                                key: { in: dbKeys }
                            }
                        });

                        for (const record of records) {
                            if (!record.value) continue;
                            const id = keyMap.get(record.key);
                            if (!id) continue;
                            let value = JSON.parse(JSON.stringify(record.value), BufferJSON.reviver);
                            if (type === 'app-state-sync-key' && value) {
                                value = BufferJSON.reviver(null, value);
                            }
                            if (value) {
                                data[id] = value;
                            }
                        }
                    } catch (err) {
                        logger.error("Auth", `Error in batch keys.get for ${type}:`, err);
                    }
                    return data;
                },
                set: async (data) => {
                    const writes: { key: string; value: any }[] = [];
                    const deletes: string[] = [];

                    for (const category in data) {
                        const categoryData = data[category as keyof typeof data];
                        if (!categoryData) continue;
                        
                        for (const id in categoryData) {
                            const value = categoryData[id];
                            const key = `${category}-${id}`;
                            if (value) {
                                writes.push({ key, value: JSON.parse(JSON.stringify(value, BufferJSON.replacer)) });
                            } else {
                                deletes.push(key);
                            }
                        }
                    }

                    // Batch delete all removed keys in 1 query
                    if (deletes.length > 0) {
                        await prisma.authState.deleteMany({
                            where: { sessionId, key: { in: deletes } }
                        }).catch(e => logger.error("Auth", "Error batch deleting auth state:", e));
                    }

                    // Upsert updated keys
                    if (writes.length > 0) {
                        await Promise.all(writes.map(w =>
                            prisma.authState.upsert({
                                where: { sessionId_key: { sessionId, key: w.key } },
                                create: { sessionId, key: w.key, value: w.value },
                                update: { value: w.value }
                            }).catch(e => logger.error("Auth", `Error upserting auth key ${w.key}:`, e))
                        ));
                    }
                }
            }
        },
        saveCreds: async () => {
            await writeData('creds', 'me', creds);
        }
    };
};
