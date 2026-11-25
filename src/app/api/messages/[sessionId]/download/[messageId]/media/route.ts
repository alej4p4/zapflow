import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";
import { mediaDir } from "@/lib/paths";
import { getRawMediaMessage } from "@/modules/whatsapp/store";
import { downloadAndSaveMedia } from "@/lib/webhook";

// GET: Download media from message
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; messageId: string }> }
) {
    const { sessionId, messageId } = await params;
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        // Resolve session DB ID
        const session = await prisma.session.findFirst({
            where: { OR: [{ sessionId }, { id: sessionId }] },
            select: { id: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        // Find message in database (search by DB id or keyId)
        const message = await prisma.message.findFirst({
            where: {
                sessionId: session.id,
                OR: [{ id: messageId }, { keyId: messageId }]
            },
        });

        if (!message) {
            return NextResponse.json({ status: false, message: "Message not found", error: "Message not found" }, { status: 404 });
        }

        let mediaUrl = message.mediaUrl;
        if (!mediaUrl) {
            // Try on-demand recovery from rawMediaMessagesCache or existing file in mediaDir
            const cachedRaw = getRawMediaMessage(message.keyId);
            if (cachedRaw) {
                try {
                    const dlUrl = await downloadAndSaveMedia(cachedRaw.msg, cachedRaw.sessionId);
                    if (dlUrl) {
                        mediaUrl = dlUrl;
                        await prisma.message.update({
                            where: { id: message.id },
                            data: { mediaUrl: dlUrl }
                        }).catch(() => {});
                    }
                } catch {}
            }
            if (!mediaUrl) {
                const altExts = ['.ogg', '.opus', '.webm', '.mp3', '.m4a', '.wav', '.mp4', '.jpeg', '.jpg', '.png', '.webp'];
                for (const ext of altExts) {
                    const candidate = path.join(mediaDir, `${sessionId}-${message.keyId}${ext}`);
                    if (fs.existsSync(candidate)) {
                        mediaUrl = `/api/media/${sessionId}-${message.keyId}${ext}`;
                        break;
                    }
                }
            }
        }

        if (!mediaUrl) {
            return NextResponse.json({ status: false, message: "Message has no media", error: "Message has no media" }, { status: 404 });
        }

        // 1. External URL: redirect
        if (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")) {
            return NextResponse.redirect(mediaUrl);
        }

        // 2. Data URL: decode Base64
        if (mediaUrl.startsWith("data:")) {
            const match = mediaUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
                const mimeType = match[1];
                const fileBuffer = Buffer.from(match[2], "base64");
                const ext = mimeType.split("/")[1]?.split(";")[0] || "bin";
                const fileName = `media-${message.keyId}.${ext}`;
                return new NextResponse(fileBuffer, {
                    headers: {
                        "Content-Type": mimeType,
                        "Content-Disposition": `attachment; filename="${fileName}"`,
                    },
                });
            }
        }

        // 3. Local file in mediaDir or relative
        const baseFilename = path.basename(mediaUrl);
        let filePath = path.join(mediaDir, baseFilename);

        if (!fs.existsSync(filePath)) {
            // Fallback to process.cwd() with strict path traversal confinement
            const fallbackPath = path.resolve(process.cwd(), mediaUrl);
            if (fallbackPath.startsWith(path.resolve(process.cwd())) && fs.existsSync(fallbackPath)) {
                filePath = fallbackPath;
            } else {
                return NextResponse.json({ status: false, message: "Media file not found on disk", error: "Media file not found on disk" }, { status: 404 });
            }
        }

        const fileBuffer = fs.readFileSync(filePath);
        let mimeType = message.type === "IMAGE" ? "image/jpeg"
            : message.type === "VIDEO" ? "video/mp4"
            : message.type === "AUDIO" ? "audio/ogg; codecs=opus"
            : message.type === "DOCUMENT" ? "application/pdf"
            : "application/octet-stream";

        if (message.type === "AUDIO" && fileBuffer.length >= 12) {
            if (fileBuffer[0] === 0x1a && fileBuffer[1] === 0x45 && fileBuffer[2] === 0xdf && fileBuffer[3] === 0xa3) {
                mimeType = "audio/webm; codecs=opus";
            } else if (fileBuffer[0] === 0x4f && fileBuffer[1] === 0x67 && fileBuffer[2] === 0x67 && fileBuffer[3] === 0x53) {
                mimeType = "audio/ogg; codecs=opus";
            } else if ((fileBuffer[0] === 0x49 && fileBuffer[1] === 0x44 && fileBuffer[2] === 0x33) || (fileBuffer[0] === 0xff && (fileBuffer[1] & 0xe0) === 0xe0)) {
                mimeType = "audio/mpeg";
            } else if (fileBuffer[4] === 0x66 && fileBuffer[5] === 0x74 && fileBuffer[6] === 0x79 && fileBuffer[7] === 0x70) {
                mimeType = "audio/mp4";
            }
        }

        return new NextResponse(fileBuffer, {
            headers: {
                "Content-Type": mimeType,
                "Content-Disposition": `attachment; filename="${baseFilename}"`,
            },
        });

    } catch (error) {
        console.error("Download media error:", error);
        return NextResponse.json({ status: false, message: "Failed to download media", error: "Failed to download media" }, { status: 500 });
    }
}
