import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { mediaDir } from "@/lib/paths";
import { prisma } from "@/lib/prisma";

// Media directory — private, NOT in public/
const MEDIA_DIR = mediaDir;

/**
 * Extract sessionId from media filename.
 * Format: {sessionId}-{messageId}.{ext}
 * e.g. "marketing-1-ABCDEF123456.jpg" → "marketing-1"
 */
function extractSessionId(filename: string): string | null {
    // Remove extension
    const base = filename.replace(/\.[^.]+$/, "");
    // The last segment after the last "-" is the messageId
    const lastDash = base.lastIndexOf("-");
    if (lastDash <= 0) return null;
    return base.substring(0, lastDash);
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ filename: string }> }
) {
    try {
        // Authentication check — require session, API key, valid session cookie, or dashboard referer
        const user = await getAuthenticatedUser(request);
        const cookieHeader = request.headers.get("cookie") || "";
        const referer = request.headers.get("referer") || "";
        const hasAuthCookie = cookieHeader.includes("next-auth.session-token") ||
                              cookieHeader.includes("__Secure-next-auth.session-token") ||
                              cookieHeader.includes("authjs.session-token") ||
                              cookieHeader.includes("__Secure-authjs.session-token") ||
                              cookieHeader.includes("sessionId=");
        const isFromDashboard = referer.includes("/dashboard");
        if (!user && !hasAuthCookie && !isFromDashboard) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { filename } = await params;

        // Security: Prevent directory traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return NextResponse.json({ status: false, message: "Invalid filename", error: "Invalid filename" }, { status: 400 });
        }

        // Session ownership check — extract sessionId from filename
        const sessionId = extractSessionId(filename);
        if (user && sessionId) {
            const canAccess = await canAccessSession(user.id, user.role, sessionId);
            if (!canAccess) {
                return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session's media", error: "Forbidden - Cannot access this session's media" }, { status: 403 });
            }
        }

        let filePath = path.join(MEDIA_DIR, filename);

        // Ensure resolved path is still within MEDIA_DIR
        const resolvedPath = path.resolve(filePath);
        if (!resolvedPath.startsWith(path.resolve(MEDIA_DIR))) {
            return NextResponse.json({ status: false, message: "Access denied", error: "Access denied" }, { status: 403 });
        }

        // Try exact filename first, then alternate image extensions (.jpg, .jpeg, .png, etc.)
        if (!existsSync(filePath)) {
            const base = filename.replace(/\.[^.]+$/, "");
            const altExts = ['.jpeg', '.jpg', '.png', '.webp', '.mp4', '.mp3', '.ogg', '.opus', '.bin'];
            let found = false;
            for (const ext of altExts) {
                const altPath = path.join(MEDIA_DIR, `${base}${ext}`);
                if (existsSync(altPath)) {
                    filePath = altPath;
                    found = true;
                    break;
                }
            }

            // Also check without sessionId- prefix
            if (!found && base.includes('-')) {
                const rawKeyId = base.substring(base.lastIndexOf('-') + 1);
                for (const ext of altExts) {
                    const altPath = path.join(MEDIA_DIR, `${rawKeyId}${ext}`);
                    if (existsSync(altPath)) {
                        filePath = altPath;
                        found = true;
                        break;
                    }
                }
            }

            if (!existsSync(filePath)) {
                // If not on disk, check if message has a base64 Data URL in database
                const rawKeyId = filename.replace(/\.[^.]+$/, "").split('-').pop();
                if (rawKeyId) {
                    try {
                        const msg = await prisma.message.findFirst({
                            where: { keyId: rawKeyId },
                            select: { mediaUrl: true, type: true }
                        });
                        if (msg?.mediaUrl && msg.mediaUrl.startsWith('data:image')) {
                            const base64Data = msg.mediaUrl.split(',')[1];
                            if (base64Data) {
                                const buf = Buffer.from(base64Data, 'base64');
                                return new NextResponse(buf, {
                                    status: 200,
                                    headers: {
                                        'Content-Type': 'image/jpeg',
                                        'Content-Disposition': `inline; filename="${filename}"`,
                                        'Cache-Control': 'public, max-age=86400, immutable',
                                        'X-Content-Type-Options': 'nosniff',
                                    }
                                });
                            }
                        }
                    } catch {}
                }
                return NextResponse.json({ status: false, message: "File not found", error: "File not found" }, { status: 404 });
            }
        }

        const fileBuffer = await readFile(filePath);

        // Determine content type based on extension
        const ext = path.extname(filename).toLowerCase();
        const contentTypeMap: Record<string, string> = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.mp4': 'video/mp4',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.opus': 'audio/opus',
            '.m4a': 'audio/mp4',
            '.pdf': 'application/pdf',
            '.bin': 'application/octet-stream',
        };

        const contentType = contentTypeMap[ext] || 'application/octet-stream';

        return new NextResponse(fileBuffer, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Content-Disposition': `inline; filename="${filename}"`,
                'Cache-Control': 'public, max-age=86400, immutable',
                'X-Content-Type-Options': 'nosniff',
            },
        });

    } catch (error: any) {
        console.error("Media serve error:", error);
        return NextResponse.json({ status: false, message: "Failed to serve media", error: "Failed to serve media" }, { status: 500 });
    }
}
