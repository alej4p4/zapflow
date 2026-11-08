"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "./session-provider";

export function SessionSelector() {
    const { sessions, sessionId, setSessionId, loading, refreshSessions } = useSession();
    const selectedSession = sessions.find(s => s.sessionId === sessionId);

    const handleOpenInNewTab = (idToOpen: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (typeof window !== "undefined") {
            window.open(`/dashboard/chat?session=${idToOpen}`, "_blank", "noopener,noreferrer");
        }
    };

    return (
        <div className="flex items-center gap-1 sm:gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:inline">Sessão:</span>
            <div className="w-[140px] sm:w-[200px]">
                <Select value={sessionId} onValueChange={(val) => setSessionId(val)} disabled={loading || sessions.length === 0}>
                    <SelectTrigger className="h-9 border border-border/60 bg-background/50 hover:bg-muted/30 transition-colors rounded-xl shadow-sm focus:ring-1 focus:ring-primary/20">
                        <SelectValue placeholder={loading ? "Carregando..." : "Selecione uma sessão"}>
                            {selectedSession ? (
                                <div className="flex items-center gap-2 text-left">
                                    <span className="relative flex h-2 w-2">
                                        {selectedSession.status === "CONNECTED" && (
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                        )}
                                        <span className={`relative inline-flex rounded-full h-2 w-2 ${selectedSession.status === "CONNECTED" ? "bg-emerald-500" : "bg-destructive"}`}></span>
                                    </span>
                                    <span className="truncate font-medium text-xs sm:text-sm">{selectedSession.name}</span>
                                </div>
                            ) : null}
                        </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border border-border/50 shadow-lg p-1 min-w-[240px]">
                        {sessions.map((s) => (
                            <SelectItem key={s.sessionId} value={s.sessionId} className="rounded-lg py-2 focus:bg-muted/50 cursor-pointer">
                                <div className="flex items-center justify-between w-full gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="relative flex h-2 w-2 shrink-0">
                                            {s.status === "CONNECTED" && (
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                            )}
                                            <span className={`relative inline-flex rounded-full h-2 w-2 ${s.status === "CONNECTED" ? "bg-emerald-500" : "bg-destructive"}`}></span>
                                        </span>
                                        <div className="flex flex-col min-w-0 text-left">
                                            <span className="font-medium text-sm text-foreground truncate">{s.name}</span>
                                            <span className="text-[10px] text-muted-foreground font-mono truncate">{s.sessionId}</span>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={(e) => handleOpenInNewTab(s.sessionId, e)}
                                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0 transition-colors ml-2"
                                        title="Abrir este número em nova aba independente"
                                    >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </SelectItem>
                        ))}
                        {sessions.length === 0 && !loading && (
                            <div className="py-6 px-2 text-xs text-muted-foreground text-center">
                                Nenhuma sessão conectada encontrada.
                            </div>
                        )}
                    </SelectContent>
                </Select>
            </div>
            {selectedSession && (
                <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-9 w-9 hover:bg-muted/50 rounded-xl" 
                    onClick={() => handleOpenInNewTab(selectedSession.sessionId)} 
                    title="Abrir este número em uma nova aba dedicada (sem misturar com outras)"
                >
                    <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                </Button>
            )}
            <Button variant="ghost" size="icon" className="h-9 w-9 hover:bg-muted/50 rounded-xl" onClick={refreshSessions} title="Atualizar sessões" disabled={loading}>
                <RefreshCw className={`h-4 w-4 text-muted-foreground hover:text-foreground ${loading ? 'animate-spin' : ''}`} />
            </Button>
        </div>
    );
}
