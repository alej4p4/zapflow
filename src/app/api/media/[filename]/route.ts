import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
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
    const base = filename.replace(/\.[^.]+$/, "");
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
                              cookieHeader.includes("authjs") ||
                              cookieHeader.includes("sessionId=");
        const isFromDashboard = referer.includes("/dashboard");
        const isSameOrigin = request.headers.get("sec-fetch-site") === "same-origin";
        if (!user && !hasAuthCookie && !isFromDashboard && !isSameOrigin) {
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

        const cleanBase = filename.replace(/\.[^.]+$/, "");
        const rawKeyId = cleanBase.includes('-') ? cleanBase.substring(cleanBase.lastIndexOf('-') + 1) : cleanBase;

        // Try exact filename first, then alternate extensions
        if (!existsSync(filePath)) {
            const altExts = ['.ogg', '.opus', '.mp3', '.mp4', '.jpeg', '.jpg', '.png', '.webp', '.bin'];
            let found = false;
            for (const ext of altExts) {
                const altPath = path.join(MEDIA_DIR, `${cleanBase}${ext}`);
                if (existsSync(altPath)) {
                    filePath = altPath;
                    found = true;
                    break;
                }
            }

            // Also check without sessionId- prefix
            if (!found && cleanBase.includes('-')) {
                for (const ext of altExts) {
                    const altPath = path.join(MEDIA_DIR, `${rawKeyId}${ext}`);
                    if (existsSync(altPath)) {
                        filePath = altPath;
                        found = true;
                        break;
                    }
                }
            }

            // If not found on disk, query database (with short grace period for active incoming downloads)
            if (!existsSync(filePath)) {
                let dbMsg = await prisma.message.findFirst({
                    where: { OR: [{ keyId: rawKeyId }, { id: rawKeyId }, { keyId: cleanBase }] },
                    select: { mediaUrl: true, type: true, timestamp: true }
                });

                // If message was created in the last 60 seconds and has no mediaUrl yet, wait briefly for download to complete
                if (!dbMsg?.mediaUrl && dbMsg?.timestamp && (Date.now() - new Date(dbMsg.timestamp).getTime() < 60000)) {
                    for (let attempt = 0; attempt < 5; attempt++) {
                        await new Promise(r => setTimeout(r, 500));
                        if (existsSync(filePath)) break;
                        dbMsg = await prisma.message.findFirst({
                            where: { OR: [{ keyId: rawKeyId }, { id: rawKeyId }, { keyId: cleanBase }] },
                            select: { mediaUrl: true, type: true, timestamp: true }
                        });
                        if (dbMsg?.mediaUrl) break;
                    }
                }

                // If database has Data URL, serve directly with Range support
                if (dbMsg?.mediaUrl && dbMsg.mediaUrl.startsWith('data:')) {
                    const match = dbMsg.mediaUrl.match(/^data:([^;]+);base64,(.+)$/);
                    if (match) {
                        const mime = match[1];
                        const base64Data = match[2];
                        const buf = Buffer.from(base64Data, 'base64');
                        const isDownload = request.nextUrl.searchParams.get("download") === "1";
                        const customFilename = request.nextUrl.searchParams.get("filename");
                        const finalFilename = customFilename ? path.basename(customFilename) : filename;
                        const disposition = isDownload ? `attachment; filename="${finalFilename}"` : `inline; filename="${finalFilename}"`;

                        const range = request.headers.get("range");
                        if (range && (mime.startsWith("audio/") || mime.startsWith("video/"))) {
                            const parts = range.replace(/bytes=/, "").split("-");
                            const start = parseInt(parts[0], 10) || 0;
                            const end = parts[1] ? parseInt(parts[1], 10) : buf.length - 1;

                            if (start < buf.length && end < buf.length && start <= end) {
                                const chunk = buf.subarray(start, end + 1);
                                return new NextResponse(chunk, {
                                    status: 206,
                                    headers: {
                                        'Content-Range': `bytes ${start}-${end}/${buf.length}`,
                                        'Accept-Ranges': 'bytes',
                                        'Content-Length': String(chunk.length),
                                        'Content-Type': mime.includes('ogg') && !mime.includes('codecs') ? `${mime}; codecs=opus` : mime,
                                        'Content-Disposition': disposition,
                                        'Cache-Control': 'public, max-age=86400, immutable',
                                        'X-Content-Type-Options': 'nosniff',
                                    }
                                });
                            }
                        }

                        return new NextResponse(buf, {
                            status: 200,
                            headers: {
                                'Content-Type': mime.includes('ogg') && !mime.includes('codecs') ? `${mime}; codecs=opus` : mime,
                                'Content-Disposition': disposition,
                                'Content-Length': String(buf.length),
                                'Accept-Ranges': 'bytes',
                                'Cache-Control': 'public, max-age=86400, immutable',
                                'X-Content-Type-Options': 'nosniff',
                            }
                        });
                    }
                }

                if (!existsSync(filePath)) {
                    return NextResponse.json({ status: false, message: "File not found", error: "File not found" }, { status: 404 });
                }
            }
        }

        // Determine content type based on extension
        const ext = path.extname(filePath || filename).toLowerCase();
        const contentTypeMap: Record<string, string> = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.mp4': 'video/mp4',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg; codecs=opus',
            '.opus': 'audio/ogg; codecs=opus',
            '.m4a': 'audio/mp4',
            '.pdf': 'application/pdf',
            '.bin': 'application/octet-stream',
        };

        const contentType = contentTypeMap[ext] || 'application/octet-stream';
        const fileBuffer = await readFile(filePath);
        const fileSize = fileBuffer.length;
        const range = request.headers.get("range");
        const isDownload = request.nextUrl.searchParams.get("download") === "1";
        const customFilename = request.nextUrl.searchParams.get("filename");
        const finalFilename = customFilename ? path.basename(customFilename) : filename;
        const disposition = isDownload ? `attachment; filename="${finalFilename}"` : `inline; filename="${finalFilename}"`;

        // 🎵 HTTP 206 Partial Content (Range Requests) for audio & video seeking/streaming
        if (range && (contentType.startsWith("audio/") || contentType.startsWith("video/"))) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10) || 0;
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

            if (start >= fileSize || end >= fileSize || start > end) {
                return new NextResponse(null, {
                    status: 416,
                    headers: { 'Content-Range': `bytes */${fileSize}` }
                });
            }

            const chunk = fileBuffer.subarray(start, end + 1);

            return new NextResponse(chunk, {
                status: 206,
                headers: {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': String(chunk.length),
                    'Content-Type': contentType,
                    'Content-Disposition': disposition,
                    'Cache-Control': 'public, max-age=86400',
                    'X-Content-Type-Options': 'nosniff',
                }
            });
        }

        return new NextResponse(fileBuffer, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Content-Disposition': disposition,
                'Accept-Ranges': 'bytes',
                'Content-Length': String(fileSize),
                'Cache-Control': 'public, max-age=86400, immutable',
                'X-Content-Type-Options': 'nosniff',
            },
        });

    } catch (error: any) {
        console.error("Media serve error:", error);
        return NextResponse.json({ status: false, message: "Failed to serve media", error: "Failed to serve media" }, { status: 500 });
    }
}
