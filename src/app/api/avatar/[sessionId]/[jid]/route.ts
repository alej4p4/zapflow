import { NextRequest, NextResponse } from "next/server";
import { avatarService } from "@/modules/whatsapp/avatar.service";

export const dynamic = "force-dynamic";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string }> }
) {
    try {
        const { sessionId, jid } = await params;
        if (!sessionId || !jid) {
            return new NextResponse(null, { status: 404 });
        }

        // 1. Try to serve binary image bytes directly
        const imgData = await avatarService.getAvatarImage(sessionId, jid);
        if (imgData) {
            return new NextResponse(new Uint8Array(imgData.buffer), {
                status: 200,
                headers: {
                    "Content-Type": imgData.contentType,
                    "Cache-Control": "public, max-age=86400, stale-while-revalidate=43200",
                }
            });
        }

        // 2. Fallback to redirect if URL exists but proxy timed out
        const url = await avatarService.getAvatarUrl(sessionId, jid);
        if (url) {
            return NextResponse.redirect(url, {
                status: 307,
                headers: {
                    "Cache-Control": "public, max-age=86400",
                }
            });
        }

        // 3. 404 for contacts/groups without picture so Radix Avatar renders fallback
        return new NextResponse(null, {
            status: 404,
            headers: {
                "Cache-Control": "public, max-age=600",
            }
        });
    } catch {
        return new NextResponse(null, { status: 404 });
    }
}
