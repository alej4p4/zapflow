import { prisma } from "@/lib/prisma";
import { waManager } from "./manager";
import { resolveToPhoneJid, isLidJid, normalizeJid } from "@/lib/jid-utils";
import { logger } from "@/lib/logger";

interface CacheEntry {
    url: string | null;
    expiresAt: number;
}

interface ImageCacheEntry {
    buffer: Buffer;
    contentType: string;
    expiresAt: number;
}

export class AvatarService {
    private static instance: AvatarService;

    // In-memory URL cache: "sessionId:jid" -> { url, expiresAt }
    private urlCache = new Map<string, CacheEntry>();

    // In-memory binary image cache: "sessionId:jid" -> { buffer, contentType, expiresAt }
    private imageCache = new Map<string, ImageCacheEntry>();

    // In-flight deduplication: "sessionId:jid" -> Promise<string | null>
    private inFlight = new Map<string, Promise<string | null>>();

    // Maximum concurrent requests to Baileys socket to avoid burst throttling
    private activeRequests = 0;
    private readonly MAX_CONCURRENT = 10;
    private queue: Array<() => void> = [];

    public static getInstance(): AvatarService {
        if (!AvatarService.instance) {
            AvatarService.instance = new AvatarService();
        }
        return AvatarService.instance;
    }

    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const execute = async () => {
                this.activeRequests++;
                try {
                    const result = await task();
                    resolve(result);
                } catch (err) {
                    reject(err);
                } finally {
                    this.activeRequests--;
                    if (this.queue.length > 0) {
                        const next = this.queue.shift();
                        next?.();
                    }
                }
            };

            if (this.activeRequests < this.MAX_CONCURRENT) {
                execute();
            } else {
                this.queue.push(execute);
            }
        });
    }

    /**
     * Resolves an avatar URL for a given session and JID.
     */
    async getAvatarUrl(sessionId: string, rawJid: string): Promise<string | null> {
        if (!sessionId || !rawJid) return null;

        const decodedJid = decodeURIComponent(rawJid).trim();
        const cacheKey = `${sessionId}:${decodedJid}`;

        // 1. Check in-memory URL cache
        const cached = this.urlCache.get(cacheKey);
        if (cached && Date.now() < cached.expiresAt) {
            return cached.url;
        }

        // 2. Check if a request is already running for this key
        const existingPromise = this.inFlight.get(cacheKey);
        if (existingPromise) {
            return await existingPromise;
        }

        // 3. Launch fetch task with in-flight deduplication
        const taskPromise = this.fetchAvatarUrl(sessionId, decodedJid, cacheKey);
        this.inFlight.set(cacheKey, taskPromise);

        try {
            return await taskPromise;
        } finally {
            this.inFlight.delete(cacheKey);
        }
    }

    private async fetchAvatarUrl(sessionId: string, jid: string, cacheKey: string): Promise<string | null> {
        try {
            // Find DB session & Baileys session string
            const session = await prisma.session.findFirst({
                where: { OR: [{ sessionId }, { id: sessionId }] },
                select: { id: true, sessionId: true }
            });

            if (!session) {
                return null;
            }

            const dbSessionId = session.id;
            const waSessionId = session.sessionId;

            // Resolve target JID (convert LID to phone JID if applicable)
            let targetJid = jid;
            if (isLidJid(targetJid)) {
                targetJid = await resolveToPhoneJid(targetJid, dbSessionId);
            }
            targetJid = normalizeJid(targetJid);

            // Check if contact in DB already has valid profilePic
            if (!targetJid.endsWith("@g.us")) {
                const contact = await prisma.contact.findFirst({
                    where: { sessionId: dbSessionId, jid: targetJid },
                    select: { profilePic: true }
                });

                if (contact?.profilePic && contact.profilePic.startsWith("http")) {
                    this.urlCache.set(cacheKey, {
                        url: contact.profilePic,
                        expiresAt: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
                    });
                    return contact.profilePic;
                }
            }

            // Find Baileys instance
            const instance = waManager.getInstance(waSessionId) || waManager.getInstance(dbSessionId);
            if (!instance?.socket) {
                return null;
            }

            // Query WhatsApp via Baileys within concurrency limiter
            const ppUrl = await this.enqueue(async () => {
                try {
                    // Try high-res 'image' first
                    return await instance.socket!.profilePictureUrl(targetJid, "image");
                } catch {
                    try {
                        // Fallback to 'preview'
                        return await instance.socket!.profilePictureUrl(targetJid, "preview");
                    } catch {
                        return null;
                    }
                }
            });

            if (ppUrl && typeof ppUrl === "string" && ppUrl.startsWith("http")) {
                // Success: cache for 24h
                this.urlCache.set(cacheKey, {
                    url: ppUrl,
                    expiresAt: Date.now() + 24 * 60 * 60 * 1000
                });

                // Persist to DB asynchronously if it's a contact
                if (!targetJid.endsWith("@g.us")) {
                    prisma.contact.updateMany({
                        where: { sessionId: dbSessionId, jid: targetJid },
                        data: { profilePic: ppUrl }
                    }).catch(() => {});
                }

                return ppUrl;
            } else {
                // Not found or privacy blocked: negative cache for 10 minutes
                this.urlCache.set(cacheKey, {
                    url: null,
                    expiresAt: Date.now() + 10 * 60 * 1000
                });
                return null;
            }
        } catch (error) {
            logger.error("AvatarService", `Error getting avatar for ${jid}:`, error);
            this.urlCache.set(cacheKey, {
                url: null,
                expiresAt: Date.now() + 5 * 60 * 1000
            });
            return null;
        }
    }

    /**
     * Get binary image data for proxying directly from app domain
     */
    async getAvatarImage(sessionId: string, rawJid: string): Promise<{ buffer: Buffer; contentType: string } | null> {
        const decodedJid = decodeURIComponent(rawJid).trim();
        const cacheKey = `${sessionId}:${decodedJid}`;

        // Check image binary cache
        const cachedImg = this.imageCache.get(cacheKey);
        if (cachedImg && Date.now() < cachedImg.expiresAt) {
            return { buffer: cachedImg.buffer, contentType: cachedImg.contentType };
        }

        const url = await this.getAvatarUrl(sessionId, decodedJid);
        if (!url) return null;

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 6000);

            const res = await fetch(url, {
                signal: controller.signal,
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
            });
            clearTimeout(timeout);

            if (!res.ok) return null;

            const arrayBuf = await res.arrayBuffer();
            const buffer = Buffer.from(arrayBuf);
            const contentType = res.headers.get("content-type") || "image/jpeg";

            // Cache binary in memory (limit to 150 items to keep RAM tiny, ~2MB)
            if (this.imageCache.size > 150) {
                const oldestKey = this.imageCache.keys().next().value;
                if (oldestKey) this.imageCache.delete(oldestKey);
            }

            this.imageCache.set(cacheKey, {
                buffer,
                contentType,
                expiresAt: Date.now() + 24 * 60 * 60 * 1000
            });

            return { buffer, contentType };
        } catch {
            return null;
        }
    }
}

export const avatarService = AvatarService.getInstance();
