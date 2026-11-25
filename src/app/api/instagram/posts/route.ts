import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { publishInstagramPost } from "@/modules/instagram/publisher";
import { mediaDir } from "@/lib/paths";
import fs from "fs/promises";
import path from "path";

export async function GET(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }

        const posts = await prisma.instagramScheduledPost.findMany({
            where: user.role === "SUPERADMIN" ? undefined : { account: { userId: user.id } },
            orderBy: { scheduledAt: "desc" },
            take: 100,
            include: {
                account: {
                    select: { id: true, username: true, igUserId: true },
                },
            },
        });

        return NextResponse.json({ status: true, data: posts });
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

        const formData = await request.formData();
        const accountId = String(formData.get("accountId") || "").trim();
        const mediaType = String(formData.get("mediaType") || "IMAGE").toUpperCase();
        const caption = String(formData.get("caption") || "").trim();
        const scheduledAtRaw = String(formData.get("scheduledAt") || "").trim();
        const repeatDaily = formData.get("repeatDaily") === "true";
        const publishNow = formData.get("publishNow") === "true";
        const remoteMediaUrl = String(formData.get("mediaUrl") || "").trim();
        const file = formData.get("file") as File | null;

        if (!accountId) {
            return NextResponse.json({ status: false, message: "Selecione uma conta do Instagram" }, { status: 400 });
        }

        const account = await prisma.instagramAccount.findUnique({ where: { id: accountId } });
        if (!account || (user.role !== "SUPERADMIN" && account.userId !== user.id)) {
            return NextResponse.json({ status: false, message: "Conta não encontrada" }, { status: 404 });
        }

        let finalMediaUrl = remoteMediaUrl;
        if (file && file.size > 0) {
            const rawExt = path.extname(file.name || "").replace(/[^a-zA-Z0-9.]/g, "").toLowerCase();
            const mime = (file.type || "").toLowerCase();
            const isJpeg = mime === "image/jpeg" || rawExt === ".jpg" || rawExt === ".jpeg";
            const isMp4 = mime === "video/mp4" || rawExt === ".mp4";

            if (mediaType === "IMAGE" && !isJpeg) {
                return NextResponse.json(
                    { status: false, message: "A API do Instagram aceita apenas imagens JPEG (.jpg / .jpeg)." },
                    { status: 400 }
                );
            }
            if (mediaType === "REELS" && !isMp4) {
                return NextResponse.json(
                    { status: false, message: "Reels aceita apenas vídeo MP4 (.mp4)." },
                    { status: 400 }
                );
            }
            if (mediaType === "STORIES" && !isJpeg && !isMp4) {
                return NextResponse.json(
                    { status: false, message: "Stories aceita apenas imagem JPEG (.jpg/.jpeg) ou vídeo MP4 (.mp4)." },
                    { status: 400 }
                );
            }

            await fs.mkdir(mediaDir, { recursive: true });
            const ext = isMp4 ? ".mp4" : ".jpg";
            const filename = `ig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
            const buf = Buffer.from(await file.arrayBuffer());
            await fs.writeFile(path.join(mediaDir, filename), buf);
            finalMediaUrl = `/api/media/${filename}`;
        }

        if (!finalMediaUrl) {
            return NextResponse.json({ status: false, message: "Envie um arquivo ou informe uma URL HTTPS da mídia" }, { status: 400 });
        }

        const scheduledAt = publishNow
            ? new Date()
            : scheduledAtRaw
              ? new Date(scheduledAtRaw)
              : null;

        if (!scheduledAt || isNaN(scheduledAt.getTime())) {
            return NextResponse.json({ status: false, message: "Informe uma data/hora válida para o agendamento" }, { status: 400 });
        }

        const post = await prisma.instagramScheduledPost.create({
            data: {
                accountId: account.id,
                mediaType: ["IMAGE", "REELS", "STORIES"].includes(mediaType) ? mediaType : "IMAGE",
                mediaUrl: finalMediaUrl,
                caption: caption || null,
                scheduledAt,
                repeatDaily,
                status: publishNow ? "PUBLISHING" : "PENDING",
            },
            include: {
                account: { select: { id: true, username: true, igUserId: true } },
            },
        });

        if (publishNow) {
            try {
                const { igMediaId } = await publishInstagramPost(post.id);
                const updated = await prisma.instagramScheduledPost.update({
                    where: { id: post.id },
                    data: { status: "PUBLISHED", igMediaId, publishedAt: new Date() },
                    include: { account: { select: { id: true, username: true, igUserId: true } } },
                });
                return NextResponse.json({ status: true, data: updated, message: "Publicado no Instagram com sucesso!" });
            } catch (pubErr: any) {
                const errMsg = pubErr?.message || "Erro ao publicar no Instagram";
                await prisma.instagramScheduledPost.update({
                    where: { id: post.id },
                    data: { status: "FAILED", error: errMsg },
                });
                return NextResponse.json({ status: false, message: errMsg }, { status: 400 });
            }
        }

        return NextResponse.json({ status: true, data: post, message: "Publicação agendada com sucesso!" });
    } catch (e: any) {
        return NextResponse.json({ status: false, message: e?.message || "Erro ao agendar publicação" }, { status: 500 });
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

        const existing = await prisma.instagramAccount ? await prisma.instagramScheduledPost.findUnique({
            where: { id },
            include: { account: { select: { userId: true } } },
        }) : null;

        if (!existing) {
            return NextResponse.json({ status: false, message: "Agendamento não encontrado" }, { status: 404 });
        }
        if (user.role !== "SUPERADMIN" && existing.account.userId !== user.id) {
            return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });
        }

        await prisma.instagramScheduledPost.delete({ where: { id } });
        return NextResponse.json({ status: true });
    } catch (e: any) {
        return NextResponse.json({ status: false, message: e?.message || "Erro ao excluir agendamento" }, { status: 500 });
    }
}
