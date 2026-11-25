/**
 * WhatsApp Server Clock Synchronization Utility
 *
 * Compensates for any clock drift on the host machine (e.g., if the Windows/Linux
 * system clock is behind or ahead of true UTC / WhatsApp server time) so that:
 * 1. Outgoing messages sent from ZapFlow always receive the true UTC timestamp
 *    and never jump above incoming messages in the conversation.
 * 2. "Last Seen" (visto por último) timestamps match WhatsApp's real UTC clock.
 */

let clockOffsetMs = 0;
let isSyncing = false;
let lastNetworkSyncAt = 0;

/**
 * Calibrate clock offset from a live WhatsApp server timestamp (in seconds).
 * Only called for live incoming messages (type === 'notify', !fromMe).
 */
export function calibrateFromWhatsAppTimestamp(waTimestampSec: number) {
    if (!waTimestampSec || !Number.isFinite(waTimestampSec)) return;
    const waMs = waTimestampSec * 1000;
    const localMs = Date.now();
    const diff = waMs - localMs;
    // Ignore historical messages older than 2 hours or absurd values (> 24h)
    if (Math.abs(diff) > 2 * 60 * 60 * 1000) return;
    // Smoothly adopt WhatsApp server timestamp as authority when difference exceeds 1s
    if (Math.abs(diff) > 1000) {
        clockOffsetMs = diff;
        lastNetworkSyncAt = Date.now();
    }
}

/**
 * Calibrate clock offset against reliable HTTP Date headers (Cloudflare / Google).
 */
export async function syncClockWithNetwork(): Promise<void> {
    if (isSyncing) return;
    isSyncing = true;
    try {
        const urls = ["https://1.1.1.1", "https://www.google.com"];
        for (const url of urls) {
            try {
                const start = Date.now();
                const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(4000) });
                const end = Date.now();
                const dateHeader = res.headers.get("date");
                if (dateHeader) {
                    const netMs = new Date(dateHeader).getTime();
                    if (!isNaN(netMs)) {
                        const rttHalf = Math.round((end - start) / 2);
                        const diff = (netMs + rttHalf) - end;
                        clockOffsetMs = diff;
                        lastNetworkSyncAt = Date.now();
                        break;
                    }
                }
            } catch {
                // try next URL
            }
        }
    } finally {
        isSyncing = false;
    }
}

// Trigger initial sync on module load and refresh every 10 minutes
void syncClockWithNetwork();
setInterval(() => {
    void syncClockWithNetwork();
}, 10 * 60 * 1000).unref?.();

/**
 * Returns the current Date adjusted to true UTC / WhatsApp server time.
 */
export function getSyncedNow(): Date {
    return new Date(Date.now() + clockOffsetMs);
}

/**
 * Returns the current Unix timestamp in seconds adjusted to true UTC / WhatsApp server time.
 */
export function getSyncedNowUnixSec(): number {
    return Math.floor((Date.now() + clockOffsetMs) / 1000);
}

/**
 * Returns the current clock offset in milliseconds (TrueUTC - LocalClock).
 */
export function getClockOffsetMs(): number {
    return clockOffsetMs;
}

/**
 * Guarantees that an outgoing message in a chat gets a timestamp at least 1 second
 * after the latest existing message in that chat so it never jumps upward in the list.
 */
export function getMonotonicChatTimestamp(lastChatMsgTimestamp?: Date | string | number | null): Date {
    const syncedMs = Date.now() + clockOffsetMs;
    if (!lastChatMsgTimestamp) return new Date(syncedMs);
    const lastMs = lastChatMsgTimestamp instanceof Date
        ? lastChatMsgTimestamp.getTime()
        : new Date(lastChatMsgTimestamp).getTime();
    if (isNaN(lastMs)) return new Date(syncedMs);
    return new Date(Math.max(syncedMs, lastMs + 1000));
}
