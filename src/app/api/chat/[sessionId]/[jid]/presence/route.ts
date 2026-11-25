import { NextResponse, NextRequest } from "next/server";
import { BufferJSON } from "@whiskeysockets/baileys";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { getCachedPresence } from "@/modules/whatsapp/store";

// GET: Subscribe to contact presence & return current online/lastSeen state
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId, jid } = await params;
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, error: "Forbidden" }, { status: 403 });
        }

        const decodedJid = decodeURIComponent(jid);
        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });

        const allJidsSet = new Set<string>([decodedJid]);
        if (decodedJid.endsWith("@c.us")) {
            allJidsSet.add(decodedJid.replace("@c.us", "@s.whatsapp.net"));
        }

        let persistedContactLastSeen: number | null = null;

        if (session) {
            const bareNum = decodedJid.split("@")[0].replace(/\D/g, "");
            const brVariants = new Set<string>([bareNum]);
            if (bareNum.startsWith("55") && bareNum.length === 13 && bareNum[4] === "9") {
                brVariants.add(bareNum.slice(0, 4) + bareNum.slice(5));
            } else if (bareNum.startsWith("55") && bareNum.length === 12) {
                brVariants.add(bareNum.slice(0, 4) + "9" + bareNum.slice(4));
            }
            for (const v of brVariants) {
                if (v && !decodedJid.endsWith("@lid") && !decodedJid.endsWith("@g.us")) {
                    allJidsSet.add(`${v}@s.whatsapp.net`);
                }
            }

            // Look up LID mappings in AuthState (stored under either sessionId or session.id)
            const lidKeys: string[] = [];
            for (const j of Array.from(allJidsSet)) {
                const b = j.split("@")[0];
                if (b) {
                    lidKeys.push(`lid-mapping-${b}`, `lid-mapping-${b}_reverse`);
                }
            }
            if (lidKeys.length > 0) {
                const authMappings = await prisma.authState.findMany({
                    where: {
                        sessionId: { in: [sessionId, session.id] },
                        key: { in: lidKeys }
                    },
                    select: { key: true, value: true }
                });
                for (const m of authMappings) {
                    const mappedVal = typeof m.value === "string" ? m.value.replace(/"/g, "").trim() : "";
                    if (!mappedVal) continue;
                    if (m.key.endsWith("_reverse")) {
                        allJidsSet.add(mappedVal.includes("@") ? mappedVal : `${mappedVal}@s.whatsapp.net`);
                    } else {
                        allJidsSet.add(mappedVal.includes("@") ? mappedVal : `${mappedVal}@lid`);
                    }
                }
            }

            const contacts = await prisma.contact.findMany({
                where: {
                    sessionId: session.id,
                    OR: [
                        { jid: { in: Array.from(allJidsSet) } },
                        { lid: { in: Array.from(allJidsSet) } },
                        { remoteJidAlt: { in: Array.from(allJidsSet) } }
                    ]
                },
                select: { jid: true, lid: true, remoteJidAlt: true, data: true }
            });
            for (const c of contacts) {
                if (c.jid) allJidsSet.add(c.jid);
                if (c.lid) allJidsSet.add(c.lid);
                if (c.remoteJidAlt) allJidsSet.add(c.remoteJidAlt);
                const cLastSeen = Number((c.data as any)?.lastSeen || 0);
                if (cLastSeen > 0 && (!persistedContactLastSeen || cLastSeen > persistedContactLastSeen)) {
                    persistedContactLastSeen = cLastSeen;
                }
            }

            // Second pass: if contact lookup added new JIDs, check their reverse/forward LID mappings too
            const secondPassLidKeys: string[] = [];
            for (const j of Array.from(allJidsSet)) {
                const b = j.split("@")[0];
                if (b && !lidKeys.includes(`lid-mapping-${b}`)) {
                    secondPassLidKeys.push(`lid-mapping-${b}`, `lid-mapping-${b}_reverse`);
                }
            }
            if (secondPassLidKeys.length > 0) {
                const moreMappings = await prisma.authState.findMany({
                    where: {
                        sessionId: { in: [sessionId, session.id] },
                        key: { in: secondPassLidKeys }
                    },
                    select: { key: true, value: true }
                });
                for (const m of moreMappings) {
                    const mappedVal = typeof m.value === "string" ? m.value.replace(/"/g, "").trim() : "";
                    if (!mappedVal) continue;
                    if (m.key.endsWith("_reverse")) {
                        allJidsSet.add(mappedVal.includes("@") ? mappedVal : `${mappedVal}@s.whatsapp.net`);
                    } else {
                        allJidsSet.add(mappedVal.includes("@") ? mappedVal : `${mappedVal}@lid`);
                    }
                }
            }
        }

        const allJids = Array.from(allJidsSet).filter(j => j.endsWith("@s.whatsapp.net") || j.endsWith("@lid"));
        const instance = waManager.getInstance(sessionId);
        if (instance?.socket && !decodedJid.endsWith("@g.us") && allJids.length > 0) {
            // WhatsApp only sends presence.update (online / lastSeen) when our own socket presence is 'available'
            await instance.socket.sendPresenceUpdate("available").catch(() => {});

            // Load Trusted Contact privacy tokens (tctoken-*) required by WhatsApp to disclose global lastSeen
            const tcTokenMap = new Map<string, Buffer>();
            const loadTcTokens = async () => {
                const tokenRows = await prisma.authState.findMany({
                    where: {
                        sessionId: session ? { in: [sessionId, session.id] } : sessionId,
                        key: { in: allJids.map(j => `tctoken-${j}`) }
                    },
                    select: { key: true, value: true }
                });
                for (const row of tokenRows) {
                    try {
                        if (!row.value) continue;
                        const targetJid = row.key.replace(/^tctoken-/, "");
                        const rawStr = typeof row.value === "string" ? row.value : JSON.stringify(row.value);
                        const parsed = JSON.parse(rawStr, BufferJSON.reviver);
                        if (parsed?.token && Buffer.isBuffer(parsed.token)) {
                            tcTokenMap.set(targetJid, parsed.token);
                        }
                    } catch {}
                }
            };

            await loadTcTokens();

            // If no privacy token is stored yet, request it from WhatsApp
            if (tcTokenMap.size === 0 && typeof (instance.socket as any).getPrivacyTokens === "function") {
                try {
                    const resp = await (instance.socket as any).getPrivacyTokens(allJids);
                    const tokensNode = Array.isArray(resp?.content)
                        ? resp.content.find((c: any) => c?.tag === "tokens")
                        : null;
                    if (Array.isArray(tokensNode?.content)) {
                        for (const t of tokensNode.content) {
                            if (t?.tag === "token" && t?.attrs?.jid && Buffer.isBuffer(t.content)) {
                                tcTokenMap.set(t.attrs.jid, t.content);
                            }
                        }
                    }
                    await loadTcTokens();
                } catch {}
            }

            // Pick any valid token across aliases if one specific JID alias lacked its own entry
            const fallbackToken = tcTokenMap.values().next().value as Buffer | undefined;

            const subPromises: Promise<any>[] = [];
            for (const target of allJids) {
                const tokenToUse = tcTokenMap.get(target) || fallbackToken;
                subPromises.push(instance.socket.presenceSubscribe(target, tokenToUse).catch(() => {}));
            }
            await Promise.all(subPromises);

            // Wait up to 450ms if presence/lastSeen is not yet populated in cache so WhatsApp's immediate <presence> packet is captured
            for (let i = 0; i < 5; i++) {
                const current = getCachedPresence(sessionId, allJids);
                if (current && (current.status === "available" || current.status === "composing" || current.status === "recording" || current.lastSeen)) {
                    break;
                }
                await new Promise(r => setTimeout(r, 90));
            }
        }

        const cached = getCachedPresence(sessionId, allJids);
        const isOnline = cached?.status === "available" || cached?.status === "composing" || cached?.status === "recording" || cached?.status === "paused";
        const lastSeen = cached?.lastSeen || persistedContactLastSeen || null;

        return NextResponse.json({
            status: true,
            data: {
                presence: cached?.status || "unavailable",
                isOnline,
                lastSeen,
                altJids: allJids
            }
        });
    } catch (error) {
        console.error("Get presence error:", error);
        return NextResponse.json({ status: false, error: "Failed to get presence" }, { status: 500 });
    }
}

// POST: Send presence (typing, recording, online)
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId, jid } = await params;
        const body = await request.json();
        const { presence } = body;

        if (!presence) {
            return NextResponse.json({ status: false, message: "presence is required", error: "presence is required" }, { status: 400 });
        }

        const validPresences = ['composing', 'recording', 'paused', 'available', 'unavailable'];
        if (!validPresences.includes(presence)) {
            return NextResponse.json({ 
                error: `Invalid presence. Must be one of: ${validPresences.join(', ')}` 
            }, { status: 400 });
        }

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        const decodedJid = decodeURIComponent(jid);

        // Send presence update
        await instance.socket.sendPresenceUpdate(presence as any, decodedJid);

        return NextResponse.json({ status: true, message: `Presence '${presence}' sent to ${decodedJid}` });

    } catch (error) {
        console.error("Send presence error:", error);
        return NextResponse.json({ status: false, message: "Failed to send presence", error: "Failed to send presence" }, { status: 500 });
    }
}
