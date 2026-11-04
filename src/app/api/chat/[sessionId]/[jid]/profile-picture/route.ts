import { NextResponse, NextRequest } from "next/server";
import { avatarService } from "@/modules/whatsapp/avatar.service";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// GET: Fetch profile picture URL or binary image
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string }> }
) {
    try {
        const { sessionId, jid } = await params;
        const decodedJid = decodeURIComponent(jid);

        // Check format param: ?json=true returns JSON, otherwise binary/redirect
        const wantJson = request.nextUrl.searchParams.get("json") === "true";

        if (wantJson) {
            const url = await avatarService.getAvatarUrl(sessionId, decodedJid);
            return NextResponse.json({
                success: !!url,
                jid: decodedJid,
                profilePicUrl: url,
            });
        }

        // Return binary image
        const imgData = await avatarService.getAvatarImage(sessionId, decodedJid);
        if (imgData) {
            return new NextResponse(new Uint8Array(imgData.buffer), {
                status: 200,
                headers: {
                    "Content-Type": imgData.contentType,
                    "Cache-Control": "public, max-age=86400, stale-while-revalidate=43200",
                }
            });
        }

        const url = await avatarService.getAvatarUrl(sessionId, decodedJid);
        if (url) {
            return NextResponse.redirect(url, {
                status: 307,
                headers: {
                    "Cache-Control": "public, max-age=86400",
                }
            });
        }

        return new NextResponse(null, { status: 404 });
    } catch {
        return new NextResponse(null, { status: 404 });
    }
}

// POST: Compatibility endpoint for fetching profile picture URL
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
        const decodedJid = decodeURIComponent(jid);

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const profilePicUrl = await avatarService.getAvatarUrl(sessionId, decodedJid);

        return NextResponse.json({
            success: true,
            jid: decodedJid,
            profilePicUrl
        });
    } catch (error) {
        console.error("Fetch profile picture error:", error);
        return NextResponse.json({ status: false, message: "Failed to fetch profile picture", error: "Failed to fetch profile picture" }, { status: 500 });
    }
}
