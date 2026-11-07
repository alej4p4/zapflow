"use client";

import { ChatLayoutClient } from "./chat-layout-client";

interface ChatInterfaceProps {
    sessionId: string | null;
}

export function ChatInterface({ sessionId }: ChatInterfaceProps) {
    if (!sessionId) {
        return (
            <div className="flex h-full items-center justify-center p-8 text-center text-muted-foreground">
                Nenhuma sessão do WhatsApp ativa. Selecione uma sessão no menu superior.
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full -m-3 sm:-m-4 lg:-m-6">
            <div className="flex-1 overflow-hidden bg-background">
                <ChatLayoutClient key={sessionId} sessionId={sessionId} />
            </div>
        </div>
    );
}
