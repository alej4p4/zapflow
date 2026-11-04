import { prisma } from "@/lib/prisma";

export interface SystemConfigData {
    appName: string;
    logoUrl?: string;
    faviconUrl?: string;
    timezone?: string;
    enableRegistration?: boolean;
}

let cachedConfig: SystemConfigData | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

export async function getSystemConfigCached(): Promise<SystemConfigData> {
    const now = Date.now();
    if (cachedConfig && (now - lastFetchTime < CACHE_TTL_MS)) {
        return cachedConfig;
    }

    try {
        // @ts-ignore
        const config = await prisma.systemConfig.findUnique({ where: { id: "default" } });
        cachedConfig = {
            appName: config?.appName || "WA-AKG",
            logoUrl: config?.logoUrl || "",
            faviconUrl: config?.faviconUrl || "/favicon.ico",
            timezone: config?.timezone || "America/Sao_Paulo",
            enableRegistration: config?.enableRegistration ?? true,
        };
        lastFetchTime = now;
        return cachedConfig;
    } catch (e) {
        if (cachedConfig) return cachedConfig;
        return {
            appName: "WA-AKG",
            faviconUrl: "/favicon.ico",
            timezone: "America/Sao_Paulo",
            enableRegistration: true,
        };
    }
}

export function invalidateSystemConfigCache() {
    cachedConfig = null;
    lastFetchTime = 0;
}
