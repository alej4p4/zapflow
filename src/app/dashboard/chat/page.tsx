import { auth } from "@/lib/auth";
import { ChatInterface } from "@/components/chat/chat-interface";
import { ChatLayoutClient } from "@/components/chat/chat-layout-client";
import { cookies } from "next/headers";
import { canAccessSession } from "@/lib/api-auth";
import { SessionGuard } from "@/components/dashboard/session-guard";

export default async function ChatPage() {
    const session = await auth();
    console.log("ChatPage Session (Role debug):", session?.user?.role);

    if (!session?.user?.id) return <div>Acesso não autorizado</div>;

    const cookieStore = await cookies();
    const sessionId = cookieStore.get("sessionId")?.value;
    let validSessionId: string | null = null;

    if (sessionId) {
        // Validate access
        const hasAccess = await canAccessSession(session.user.id, session.user.role, sessionId);
        if (hasAccess) {
            // Ideally also check if CONNECTED but canAccessSession checks ownership.
            // We can do an extra check if needed.
            validSessionId = sessionId;
        }
    }

    if (!validSessionId) {
        return (
            <SessionGuard>
                <ChatInterface sessionId={null} />
            </SessionGuard>
        );
    }

    return (
        <div className="-m-3 sm:-m-4 lg:-m-6 h-[calc(100vh-3.5rem)] sm:h-[calc(100vh-4rem)]">
            <ChatLayoutClient key={validSessionId} sessionId={validSessionId} />
        </div>
    );
}
