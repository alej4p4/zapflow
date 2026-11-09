"use client";

import { use } from "react";
import { useSession } from "@/components/dashboard/session-provider";
import { ChatLayoutClient } from "@/components/chat/chat-layout-client";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { Loader2 } from "lucide-react";

export default function ChatWithJidPage({
    params,
}: {
    params: Promise<{ jid: string }>;
}) {
    const resolvedParams = use(params);
    const rawJid = resolvedParams.jid || "";
    const { sessionId, loading } = useSession();

    let clean = rawJid.replace(/\D/g, "");
    if (clean.startsWith("0")) clean = "62" + clean.substring(1);
    const resolvedJid = clean ? `${clean}@s.whatsapp.net` : undefined;

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span>Carregando sessão...</span>
            </div>
        );
    }

    if (!sessionId) {
        return (
            <SessionGuard>
                <div className="flex h-full items-center justify-center p-8 text-center text-muted-foreground">
                    Nenhuma sessão do WhatsApp ativa. Selecione uma sessão no menu superior.
                </div>
            </SessionGuard>
        );
    }

    return (
        <div className="chat-full-screen w-full h-full overflow-hidden">
            <ChatLayoutClient
                key={`${sessionId}-${resolvedJid || "none"}`}
                sessionId={sessionId}
                initialJid={resolvedJid}
            />
        </div>
    );
}
