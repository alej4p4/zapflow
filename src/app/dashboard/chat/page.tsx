"use client";

import { useSession } from "@/components/dashboard/session-provider";
import { ChatLayoutClient } from "@/components/chat/chat-layout-client";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { Loader2 } from "lucide-react";

export default function ChatPage() {
    const { sessionId, loading } = useSession();

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
        <div className="-m-3 sm:-m-4 lg:-m-6 h-[calc(100vh-3.5rem)] sm:h-[calc(100vh-4rem)]">
            <ChatLayoutClient key={sessionId} sessionId={sessionId} />
        </div>
    );
}
