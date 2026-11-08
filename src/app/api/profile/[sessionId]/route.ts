import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { waManager } from "@/modules/whatsapp/manager";
import { jidNormalizedUser } from "@whiskeysockets/baileys";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance || !instance.socket) {
            return NextResponse.json({ status: false, message: "WhatsApp instance not connected" }, { status: 503 });
        }

        // Fetch display name from creds
        const pushname = instance.socket.user?.name || "";
        const rawJid = instance.socket.user?.id || "";
        const myJid = rawJid ? jidNormalizedUser(rawJid) : "";

        // Fetch status/about safely
        let status = "Hey there! I am using WhatsApp.";
        try {
            if (myJid) {
                const statusResult = await (instance.socket as any).fetchStatus(myJid);
                if (statusResult) {
                    if (Array.isArray(statusResult)) {
                        const first = statusResult[0];
                        if (first?.status) status = first.status;
                    } else if (statusResult.status) {
                        status = statusResult.status;
                    }
                }
            }
        } catch (e) {
            console.log("Could not fetch own status:", e);
        }

        // Fetch profile picture safely
        let pictureUrl = "";
        try {
            if (myJid) {
                pictureUrl = await instance.socket.profilePictureUrl(myJid, 'image') || "";
            }
        } catch (e) {
            // No profile picture set
        }

        return NextResponse.json({
            status: true,
            data: {
                name: pushname,
                pushname: pushname,
                status: status,
                pictureUrl: pictureUrl,
                phone: myJid.split("@")[0].split(":")[0]
            }
        });

    } catch (error: any) {
        console.error("Fetch profile error:", error);
        return NextResponse.json({ status: false, message: error.message }, { status: 500 });
    }
}
