import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";

function extractPhoneDigits(jid?: string | null, alt?: string | null): string {
    const pick = (val?: string | null) => {
        if (!val) return "";
        if (val.endsWith("@s.whatsapp.net")) {
            return val.split("@")[0].split(":")[0].replace(/\D/g, "");
        }
        return "";
    };
    return pick(jid) || pick(alt);
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;
        const { searchParams } = new URL(req.url);
        const page = parseInt(searchParams.get("page") || "1");
        const limitParam = searchParams.get("limit") || "10";
        const isAll = limitParam === "all";
        const limit = isAll ? 0 : parseInt(limitParam) || 10;
        const search = searchParams.get("search") || "";
        // Apenas contatos com número de telefone (JIDs @lid não servem para disparo)
        const phonesOnly = searchParams.get("phones") === "1";

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        // Resolve sessionId string to database ID (CUID)
        const sessionData = await prisma.session.findUnique({
            where: { sessionId: sessionId },
            select: { id: true }
        });

        if (!sessionData) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        const and: any[] = [];
        if (search) {
            and.push({
                OR: [
                    { name: { contains: search } },
                    { notify: { contains: search } },
                    { verifiedName: { contains: search } },
                    { jid: { contains: search } },
                    { remoteJidAlt: { contains: search } }
                ]
            });
        }
        if (phonesOnly) {
            and.push({
                OR: [
                    { jid: { endsWith: "@s.whatsapp.net" } },
                    { remoteJidAlt: { endsWith: "@s.whatsapp.net" } }
                ]
            });
        }

        const where: any = {
            sessionId: sessionData.id,
            ...(and.length ? { AND: and } : {}),
        };

        const [contacts, total] = await Promise.all([
            prisma.contact.findMany({
                where,
                ...(isAll ? {} : { skip: (page - 1) * limit, take: limit }),
                orderBy: { name: 'asc' },
                include: {
                    _count: {
                        select: { messages: true }
                    }
                }
            }),
            prisma.contact.count({ where })
        ]);

        return NextResponse.json({
            status: true,
            message: "Contacts retrieved successfully",
            data: contacts,
            meta: {
                total,
                page: isAll ? 1 : page,
                limit: isAll ? total : limit,
                totalPages: isAll ? 1 : Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error("Error fetching contacts:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden", error: "Forbidden" }, { status: 403 });
        }

        const sessionData = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });

        if (!sessionData) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        const body = await req.json();
        const { action } = body;

        if (action === "deleteOne") {
            const { contactId } = body;
            if (!contactId) {
                return NextResponse.json({ status: false, error: "contactId é obrigatório" }, { status: 400 });
            }
            await prisma.contact.deleteMany({
                where: { id: contactId, sessionId: sessionData.id }
            });
            return NextResponse.json({ status: true, message: "Contato removido com sucesso" });
        }

        if (action === "analyze") {
            const [allContacts, failedBroadcastRows] = await Promise.all([
                prisma.contact.findMany({
                    where: { sessionId: sessionData.id },
                    orderBy: { updatedAt: "desc" }
                }),
                prisma.broadcastRecipient.findMany({
                    where: {
                        status: "failed",
                        broadcastLog: { sessionId }
                    },
                    select: { jid: true, error: true },
                    distinct: ["jid"]
                })
            ]);

            const failedJidSet = new Set<string>();
            const failedPhoneSet = new Set<string>();
            const failedErrorsByJid: Record<string, string> = {};

            for (const row of failedBroadcastRows) {
                const jid = row.jid.trim();
                failedJidSet.add(jid);
                failedErrorsByJid[jid] = row.error || "Falha no disparo";
                const digits = jid.split("@")[0].replace(/\D/g, "");
                if (digits.length >= 8) failedPhoneSet.add(digits);
            }

            const duplicates: Array<{ id: string; jid: string; name: string; phone: string; reason: string }> = [];
            const invalidNumbers: Array<{ id: string; jid: string; name: string; reason: string }> = [];
            const failedContacts: Array<{ id: string; jid: string; name: string; phone: string; reason: string }> = [];

            const seenByPhone = new Map<string, (typeof allContacts)[number]>();

            for (const c of allContacts) {
                const displayName = c.name || c.notify || c.verifiedName || "Sem nome";
                const phone = extractPhoneDigits(c.jid, c.remoteJidAlt);

                // Check if failed in broadcast
                if (failedJidSet.has(c.jid) || (c.remoteJidAlt && failedJidSet.has(c.remoteJidAlt)) || (phone && failedPhoneSet.has(phone))) {
                    failedContacts.push({
                        id: c.id,
                        jid: c.jid,
                        name: displayName,
                        phone: phone || c.jid,
                        reason: failedErrorsByJid[c.jid] || (phone ? failedErrorsByJid[`${phone}@s.whatsapp.net`] : "") || "Falhou em disparo anterior (Sem WhatsApp ativo)"
                    });
                }

                // Check invalid or orphan LID without phone
                if (!phone || phone.length < 10 || phone.length > 15) {
                    invalidNumbers.push({
                        id: c.id,
                        jid: c.jid,
                        name: displayName,
                        reason: !phone ? "JID sem número de telefone (@lid órfão)" : `Número com formato inválido (${phone.length} dígitos)`
                    });
                    continue;
                }

                // Check duplicates by normalized phone number
                const existing = seenByPhone.get(phone);
                if (!existing) {
                    seenByPhone.set(phone, c);
                } else {
                    const existingScore = (existing.name ? 2 : 0) + (existing.notify ? 1 : 0) + (existing.jid.endsWith("@s.whatsapp.net") ? 2 : 0);
                    const currentScore = (c.name ? 2 : 0) + (c.notify ? 1 : 0) + (c.jid.endsWith("@s.whatsapp.net") ? 2 : 0);

                    if (currentScore > existingScore) {
                        duplicates.push({
                            id: existing.id,
                            jid: existing.jid,
                            name: existing.name || existing.notify || "Sem nome",
                            phone,
                            reason: `Duplicado do número ${phone} (mantido: ${displayName})`
                        });
                        seenByPhone.set(phone, c);
                    } else {
                        duplicates.push({
                            id: c.id,
                            jid: c.jid,
                            name: displayName,
                            phone,
                            reason: `Duplicado do número ${phone} (mantido: ${existing.name || existing.notify || existing.jid})`
                        });
                    }
                }
            }

            return NextResponse.json({
                status: true,
                data: {
                    totalContacts: allContacts.length,
                    duplicates,
                    invalidNumbers,
                    failedContacts,
                    allFailedBroadcastJids: Array.from(failedJidSet)
                }
            });
        }

        if (action === "cleanup") {
            const { contactIds = [] } = body as { contactIds?: string[] };
            let deletedCount = 0;

            if (Array.isArray(contactIds) && contactIds.length > 0) {
                const res = await prisma.contact.deleteMany({
                    where: {
                        sessionId: sessionData.id,
                        id: { in: contactIds }
                    }
                });
                deletedCount = res.count;
            }

            return NextResponse.json({
                status: true,
                message: `${deletedCount} contato(s) removido(s) com sucesso`,
                data: { deletedCount }
            });
        }

        return NextResponse.json({ status: false, error: "Ação inválida" }, { status: 400 });
    } catch (error) {
        console.error("Error in contacts POST:", error);
        return NextResponse.json({ status: false, error: "Erro interno ao processar contatos" }, { status: 500 });
    }
}
