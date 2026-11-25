import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

const GRAPH_BASE = "https://graph.facebook.com/v21.0";
const inFlightPosts = new Set<string>();

function resolvePublicMediaUrl(rawUrl: string, accountPublicBaseUrl?: string | null): string {
    const trimmed = rawUrl.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;

    const base = (
        accountPublicBaseUrl ||
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.AUTH_URL ||
        ""
    )
        .trim()
        .replace(/\/+$/, "");

    if (!base) {
        throw new Error(
            "URL pública HTTPS não configurada na conta do Instagram (necessária para a Meta baixar a mídia)."
        );
    }

    return `${base}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

async function waitForContainerReady(
    containerId: string,
    accessToken: string,
    maxWaitMs = 90_000
): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < maxWaitMs) {
        const res = await fetch(
            `${GRAPH_BASE}/${encodeURIComponent(containerId)}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`
        );
        const data = await res.json().catch(() => ({}));
        if (data?.status_code === "FINISHED") return;
        if (data?.status_code === "ERROR" || data?.status_code === "EXPIRED") {
            throw new Error(data?.status || `Falha no processamento da mídia (${data?.status_code})`);
        }
        await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error("Tempo limite excedido aguardando processamento da mídia pela Meta.");
}

/**
 * Publica um post agendado na API Oficial do Instagram (Meta Graph API v21.0).
 */
export async function publishInstagramPost(postId: string): Promise<{ igMediaId: string }> {
    const post = await prisma.instagramScheduledPost.findUnique({
        where: { id: postId },
        include: { account: true },
    });

    if (!post) throw new Error("Publicação não encontrada.");
    if (!post.account?.isActive) throw new Error("Conta do Instagram inativa.");

    const { igUserId, accessToken, publicBaseUrl } = post.account;
    const publicMediaUrl = resolvePublicMediaUrl(post.mediaUrl, publicBaseUrl);

    const containerParams = new URLSearchParams({
        access_token: accessToken,
    });

    if (post.mediaType === "REELS") {
        containerParams.set("media_type", "REELS");
        containerParams.set("video_url", publicMediaUrl);
        if (post.caption) containerParams.set("caption", post.caption);
    } else if (post.mediaType === "STORIES") {
        containerParams.set("media_type", "STORIES");
        if (/\.(mp4|mov|m4v)(\?|$)/i.test(publicMediaUrl)) {
            containerParams.set("video_url", publicMediaUrl);
        } else {
            containerParams.set("image_url", publicMediaUrl);
        }
    } else {
        containerParams.set("image_url", publicMediaUrl);
        if (post.caption) containerParams.set("caption", post.caption);
    }

    // 1. Create media container
    const createRes = await fetch(`${GRAPH_BASE}/${encodeURIComponent(igUserId)}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: containerParams.toString(),
    });
    const createJson = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !createJson?.id) {
        const msg = createJson?.error?.message || `Erro HTTP ${createRes.status} ao criar container na Meta`;
        throw new Error(msg);
    }

    const containerId = String(createJson.id);

    // 2. Wait for video/reels/stories processing if needed
    if (post.mediaType === "REELS" || post.mediaType === "STORIES") {
        await waitForContainerReady(containerId, accessToken);
    }

    // 3. Publish container
    const publishParams = new URLSearchParams({
        creation_id: containerId,
        access_token: accessToken,
    });
    const pubRes = await fetch(`${GRAPH_BASE}/${encodeURIComponent(igUserId)}/media_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: publishParams.toString(),
    });
    const pubJson = await pubRes.json().catch(() => ({}));
    if (!pubRes.ok || !pubJson?.id) {
        const msg = pubJson?.error?.message || `Erro HTTP ${pubRes.status} ao publicar mídia na Meta`;
        throw new Error(msg);
    }

    return { igMediaId: String(pubJson.id) };
}

/**
 * Verifica e publica posts do Instagram cujo horário agendado já chegou.
 */
export async function processScheduledInstagramPosts(): Promise<void> {
    try {
        const now = new Date();
        const duePosts = await prisma.instagramScheduledPost.findMany({
            where: {
                status: "PENDING",
                scheduledAt: { lte: now },
            },
            orderBy: { scheduledAt: "asc" },
            take: 10,
        });

        for (const post of duePosts) {
            if (inFlightPosts.has(post.id)) continue;
            inFlightPosts.add(post.id);

            try {
                await prisma.instagramScheduledPost.update({
                    where: { id: post.id },
                    data: { status: "PUBLISHING", error: null },
                });

                const { igMediaId } = await publishInstagramPost(post.id);

                await prisma.instagramScheduledPost.update({
                    where: { id: post.id },
                    data: {
                        status: "PUBLISHED",
                        igMediaId,
                        publishedAt: new Date(),
                        error: null,
                    },
                });

                logger.success("Instagram", `Post ${post.id} publicado com sucesso (igMediaId: ${igMediaId})`);

                if (post.repeatDaily) {
                    const nextDate = new Date(post.scheduledAt.getTime() + 24 * 60 * 60 * 1000);
                    await prisma.instagramScheduledPost.create({
                        data: {
                            accountId: post.accountId,
                            mediaType: post.mediaType,
                            mediaUrl: post.mediaUrl,
                            caption: post.caption,
                            scheduledAt: nextDate,
                            repeatDaily: true,
                            status: "PENDING",
                        },
                    });
                }
            } catch (err: any) {
                const errMsg = err?.message || "Erro ao publicar no Instagram";
                logger.error("Instagram", `Falha ao publicar post ${post.id}: ${errMsg}`);
                await prisma.instagramScheduledPost.update({
                    where: { id: post.id },
                    data: { status: "FAILED", error: errMsg },
                }).catch(() => {});
            } finally {
                inFlightPosts.delete(post.id);
            }
        }
    } catch (e) {
        logger.error("Instagram", "Erro no agendador do Instagram:", e);
    }
}
