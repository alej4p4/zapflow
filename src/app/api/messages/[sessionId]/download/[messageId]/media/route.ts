import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";
import { mediaDir } from "@/lib/paths";

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

        if (!message.mediaUrl) {
            return NextResponse.json({ status: false, message: "Message has no media", error: "Message has no media" }, { status: 404 });
        }

        // 1. External URL: redirect
        if (message.mediaUrl.startsWith("http://") || message.mediaUrl.startsWith("https://")) {
            return NextResponse.redirect(message.mediaUrl);
        }

        // 2. Data URL: decode Base64
        if (message.mediaUrl.startsWith("data:")) {
            const match = message.mediaUrl.match(/^data:([^;]+);base64,(.+)$/);
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
        const baseFilename = path.basename(message.mediaUrl);
        let filePath = path.join(mediaDir, baseFilename);

        if (!fs.existsSync(filePath)) {
            // Fallback to process.cwd()
            const fallbackPath = path.join(process.cwd(), message.mediaUrl);
            if (fs.existsSync(fallbackPath)) {
                filePath = fallbackPath;
            } else {
                return NextResponse.json({ status: false, message: "Media file not found on disk", error: "Media file not found on disk" }, { status: 404 });
            }
        }

        const fileBuffer = fs.readFileSync(filePath);
        const mimeType = message.type === "IMAGE" ? "image/jpeg"
            : message.type === "VIDEO" ? "video/mp4"
            : message.type === "AUDIO" ? "audio/ogg"
            : message.type === "DOCUMENT" ? "application/pdf"
            : "application/octet-stream";

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
