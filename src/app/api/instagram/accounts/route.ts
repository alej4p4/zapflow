import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { z } from "zod";

const accountSchema = z.object({
    username: z.string().min(1),
    igUserId: z.string().min(3),
    accessToken: z.string().min(10),
    publicBaseUrl: z.string().optional().nullable(),
});

export async function GET(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }

        const accounts = await prisma.instagramAccount.findMany({
            where: user.role === "SUPERADMIN" ? undefined : { userId: user.id },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                userId: true,
                username: true,
                igUserId: true,
                publicBaseUrl: true,
                isActive: true,
                createdAt: true,
                _count: { select: { posts: true } },
            },
        });

        return NextResponse.json({ status: true, data: accounts });
    } catch (e: any) {
        return NextResponse.json({ status: false, message: e?.message || "Erro interno" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const parsed = accountSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ status: false, message: "Dados inválidos", error: parsed.error.flatten() }, { status: 400 });
        }

        const cleanUsername = parsed.data.username.trim().replace(/^@/, "");
        const cleanIgId = parsed.data.igUserId.trim();
        const cleanToken = parsed.data.accessToken.trim();
        const cleanBase = parsed.data.publicBaseUrl?.trim().replace(/\/+$/, "") || null;

        // Validate token against Meta Graph API before saving
        let verifiedUsername = cleanUsername;
        try {
            const verifyRes = await fetch(
                `https://graph.facebook.com/v21.0/${encodeURIComponent(cleanIgId)}?fields=id,username&access_token=${encodeURIComponent(cleanToken)}`
            );
            const verifyJson = await verifyRes.json().catch(() => ({}));
            if (!verifyRes.ok || verifyJson?.error) {
                return NextResponse.json(
                    {
                        status: false,
                        message: verifyJson?.error?.message || "Token ou Instagram Business ID inválido na Meta.",
                    },
                    { status: 400 }
                );
            }
            if (verifyJson?.username) {
                verifiedUsername = String(verifyJson.username);
            }
        } catch {
            return NextResponse.json(
                { status: false, message: "Não foi possível validar o token junto à API da Meta." },
                { status: 502 }
            );
        }

        const account = await prisma.instagramAccount.upsert({
            where: {
                userId_igUserId: {
                    userId: user.id,
                    igUserId: cleanIgId,
                },
            },
            create: {
                userId: user.id,
                username: verifiedUsername,
                igUserId: cleanIgId,
                accessToken: cleanToken,
                publicBaseUrl: cleanBase,
                isActive: true,
            },
            update: {
                username: verifiedUsername,
                accessToken: cleanToken,
                publicBaseUrl: cleanBase,
                isActive: true,
            },
            select: {
                id: true,
                username: true,
                igUserId: true,
                publicBaseUrl: true,
                isActive: true,
                createdAt: true,
            },
        });

        return NextResponse.json({ status: true, data: account });
    } catch (e: any) {
        return NextResponse.json({ status: false, message: e?.message || "Erro ao salvar conta" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }

        const id = request.nextUrl.searchParams.get("id");
        if (!id) {
            return NextResponse.json({ status: false, message: "ID obrigatório" }, { status: 400 });
        }

        const existing = await prisma.instagramAccount.findUnique({ where: { id } });
        if (!existing) {
            return NextResponse.json({ status: false, message: "Conta não encontrada" }, { status: 404 });
        }
        if (user.role !== "SUPERADMIN" && existing.userId !== user.id) {
            return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });
        }

        await prisma.instagramAccount.delete({ where: { id } });
        return NextResponse.json({ status: true });
    } catch (e: any) {
        return NextResponse.json({ status: false, message: e?.message || "Erro ao remover conta" }, { status: 500 });
    }
}
