import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { mediaDir } from "@/lib/paths";
import { prisma } from "@/lib/prisma";
import { getRawMediaMessage } from "@/modules/whatsapp/store";
import { downloadAndSaveMedia } from "@/lib/webhook";

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
        const { filename } = await params;

        // Security: Prevent directory traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return NextResponse.json({ status: false, message: "Invalid filename" }, { status: 400 });
        }

        // Allow Meta's servers to fetch uploaded Instagram post media if registered in InstagramScheduledPost
        let isPublicIgMedia = false;
        if (filename.startsWith("ig-")) {
            const igPost = await prisma.instagramScheduledPost.findFirst({
                where: { mediaUrl: `/api/media/${filename}` },
                select: { id: true }
            });
            isPublicIgMedia = Boolean(igPost);
        }

        // Authentication check — require session, API key, valid session cookie, or dashboard referer
        let user: Awaited<ReturnType<typeof getAuthenticatedUser>> = null;
        if (!isPublicIgMedia) {
            user = await getAuthenticatedUser(request);
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
            const altExts = ['.pdf', '.ogg', '.opus', '.webm', '.mp3', '.m4a', '.wav', '.mp4', '.jpeg', '.jpg', '.png', '.webp', '.bin'];
            let found = false;
            const checkForExistingFile = () => {
                for (const ext of altExts) {
                    const altPath = path.join(MEDIA_DIR, `${cleanBase}${ext}`);
                    if (existsSync(altPath)) {
                        filePath = altPath;
                        found = true;
                        return true;
                    }
                }
                if (cleanBase.includes('-')) {
                    for (const ext of altExts) {
                        const altPath = path.join(MEDIA_DIR, `${rawKeyId}${ext}`);
                        if (existsSync(altPath)) {
                            filePath = altPath;
                            found = true;
                            return true;
                        }
                    }
                }
                return false;
            };

            checkForExistingFile();

            // If not found on disk, try on-demand download from rawMediaMessagesCache or wait briefly for active incoming downloads
            if (!found) {
                const cachedRaw = getRawMediaMessage(rawKeyId);
                if (cachedRaw) {
                    try {
                        const dlUrl = await downloadAndSaveMedia(cachedRaw.msg, cachedRaw.sessionId);
                        if (dlUrl) {
                            const dlFile = path.join(MEDIA_DIR, path.basename(dlUrl));
                            if (existsSync(dlFile)) {
                                filePath = dlFile;
                                found = true;
                            }
                            await prisma.message.updateMany({
                                where: { keyId: rawKeyId, mediaUrl: null },
                                data: { mediaUrl: dlUrl }
                            }).catch(() => {});
                        }
                    } catch {}
                }
            }

            if (!found && !existsSync(filePath)) {
                let dbMsg = await prisma.message.findFirst({
                    where: { OR: [{ keyId: rawKeyId }, { id: rawKeyId }, { keyId: cleanBase }] },
                    select: { mediaUrl: true, type: true, timestamp: true }
                });

                // If message was just sent/received (or is still being persisted), wait briefly for download/write to complete
                if (!dbMsg || (!dbMsg.mediaUrl && dbMsg.timestamp && (Date.now() - new Date(dbMsg.timestamp).getTime() < 90000))) {
                    for (let attempt = 0; attempt < 6; attempt++) {
                        await new Promise(r => setTimeout(r, 450));
                        if (existsSync(filePath) || checkForExistingFile()) break;
                        dbMsg = await prisma.message.findFirst({
                            where: { OR: [{ keyId: rawKeyId }, { id: rawKeyId }, { keyId: cleanBase }] },
                            select: { mediaUrl: true, type: true, timestamp: true }
                        });
                        if (dbMsg?.mediaUrl && !dbMsg.mediaUrl.startsWith('data:')) {
                            const dbFile = path.join(MEDIA_DIR, path.basename(dbMsg.mediaUrl));
                            if (existsSync(dbFile)) {
                                filePath = dbFile;
                                found = true;
                                break;
                            }
                        } else if (dbMsg?.mediaUrl) {
                            break;
                        }
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

        // Determine content type based on extension + magic byte inspection for audio/video
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
            '.webm': 'audio/webm; codecs=opus',
            '.m4a': 'audio/mp4',
            '.pdf': 'application/pdf',
            '.bin': 'application/octet-stream',
        };

        const fileBuffer = await readFile(filePath);
        let contentType = contentTypeMap[ext] || 'application/octet-stream';

        // Sniff actual container from magic bytes (PDF, WebM, Ogg, MP4, MP3, WAV, PNG, JPEG, WebP)
        if (fileBuffer.length >= 5) {
            // PDF magic bytes: %PDF- (0x25 0x50 0x44 0x46 0x2d)
            if (fileBuffer[0] === 0x25 && fileBuffer[1] === 0x50 && fileBuffer[2] === 0x44 && fileBuffer[3] === 0x46 && fileBuffer[4] === 0x2d) {
                contentType = 'application/pdf';
            }
            // PNG magic bytes: 0x89 0x50 0x4e 0x47
            else if (fileBuffer.length >= 8 && fileBuffer[0] === 0x89 && fileBuffer[1] === 0x50 && fileBuffer[2] === 0x4e && fileBuffer[3] === 0x47) {
                contentType = 'image/png';
            }
            // JPEG magic bytes: 0xff 0xd8 0xff
            else if (fileBuffer[0] === 0xff && fileBuffer[1] === 0xd8 && fileBuffer[2] === 0xff) {
                contentType = 'image/jpeg';
            }
            // WebP magic bytes: RIFF....WEBP
            else if (fileBuffer.length >= 12 && fileBuffer[0] === 0x52 && fileBuffer[1] === 0x49 && fileBuffer[2] === 0x46 && fileBuffer[3] === 0x46 && fileBuffer[8] === 0x57 && fileBuffer[9] === 0x45 && fileBuffer[10] === 0x42 && fileBuffer[11] === 0x50) {
                contentType = 'image/webp';
            }
            // Audio containers
            else if (fileBuffer.length >= 12 && (contentType.startsWith('audio/') || ext === '.bin')) {
                if (fileBuffer[0] === 0x4f && fileBuffer[1] === 0x67 && fileBuffer[2] === 0x67 && fileBuffer[3] === 0x53) {
                    contentType = 'audio/ogg; codecs=opus';
                } else if (fileBuffer[0] === 0x1a && fileBuffer[1] === 0x45 && fileBuffer[2] === 0xdf && fileBuffer[3] === 0xa3) {
                    contentType = 'audio/webm; codecs=opus';
                } else if (fileBuffer[0] === 0x52 && fileBuffer[1] === 0x49 && fileBuffer[2] === 0x46 && fileBuffer[3] === 0x46 && fileBuffer[8] === 0x57 && fileBuffer[9] === 0x41 && fileBuffer[10] === 0x56 && fileBuffer[11] === 0x45) {
                    contentType = 'audio/wav';
                } else if ((fileBuffer[0] === 0x49 && fileBuffer[1] === 0x44 && fileBuffer[2] === 0x33) || (fileBuffer[0] === 0xff && (fileBuffer[1] & 0xe0) === 0xe0)) {
                    contentType = 'audio/mpeg';
                } else if (fileBuffer[4] === 0x66 && fileBuffer[5] === 0x74 && fileBuffer[6] === 0x79 && fileBuffer[7] === 0x70) {
                    contentType = 'audio/mp4';
                }
            }
        }
        const fileSize = fileBuffer.length;
        const range = request.headers.get("range");
        const isDownload = request.nextUrl.searchParams.get("download") === "1";
        const customFilename = request.nextUrl.searchParams.get("filename");
        let finalFilename = customFilename ? path.basename(customFilename) : filename;
        if (contentType === 'application/pdf' && !finalFilename.toLowerCase().endsWith('.pdf')) {
            finalFilename = finalFilename.replace(/\.[^.]+$/, '') + '.pdf';
        }
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
