import { auth } from "@/lib/auth";
import { ChatInterface } from "@/components/chat/chat-interface";
import { ChatLayoutClient } from "@/components/chat/chat-layout-client";
import { cookies } from "next/headers";
import { canAccessSession } from "@/lib/api-auth";
import { SessionGuard } from "@/components/dashboard/session-guard";

export default async function ChatWithJidPage({
    params,
}: {
    params: Promise<{ jid: string }>;
}) {
    const { jid: rawJid } = await params;
    const session = await auth();

    if (!session?.user?.id) return <div>Acesso não autorizado</div>;

    let clean = rawJid.replace(/\D/g, '');
    if (clean.startsWith('0')) clean = '62' + clean.substring(1);
    const resolvedJid = `${clean}@s.whatsapp.net`;

    const cookieStore = await cookies();
    const sessionId = cookieStore.get("sessionId")?.value;
    let validSessionId: string | null = null;

    if (sessionId) {
        const hasAccess = await canAccessSession(session.user.id, session.user.role, sessionId);
        if (hasAccess) {
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
            <ChatLayoutClient
                key={`${validSessionId}-${resolvedJid}`}
                sessionId={validSessionId}
                initialJid={resolvedJid}
            />
        </div>
    );
}
