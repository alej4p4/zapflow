"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ShieldAlert, WifiOff, RefreshCw, X, Volume2 } from "lucide-react";
import { useSession } from "@/components/dashboard/session-provider";
import Link from "next/link";

interface RegistrationWarningProps {
    role?: string;
    registrationEnabled?: boolean;
}

function playDisconnectAlertSound() {
    try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;

        // Play two short warning tones (880Hz -> 587Hz)
        [0, 0.22].forEach((offset, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(idx === 0 ? 880 : 587.33, now + offset);
            gain.gain.setValueAtTime(0.18, now + offset);
            gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.18);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + offset);
            osc.stop(now + offset + 0.18);
        });
    } catch {
        // Ignore if browser blocked autoplay before user interaction
    }
}

export function RegistrationWarning({ role, registrationEnabled }: RegistrationWarningProps) {
    const { sessions, sessionId, refreshSessions } = useSession();
    const prevStatusMapRef = useRef<Record<string, string>>({});
    const [disconnectedSession, setDisconnectedSession] = useState<{ sessionId: string; name: string; status: string } | null>(null);
    const [dismissedForSession, setDismissedForSession] = useState<Record<string, boolean>>({});

    // 1. Public Registration Warning with 1-click disable button
    useEffect(() => {
        if (role === "SUPERADMIN" && registrationEnabled) {
            const timer = setTimeout(() => {
                toast("O cadastro público está ativado", {
                    description: "Qualquer pessoa pode criar conta. Clique em 'Desativar agora' para bloquear novos cadastros.",
                    icon: <ShieldAlert className="text-amber-500 w-5 h-5" />,
                    duration: 12000,
                    position: "top-center",
                    action: {
                        label: "🔒 Desativar agora",
                        onClick: async () => {
                            try {
                                const res = await fetch("/api/settings/system", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ enableRegistration: false }),
                                });
                                if (res.ok) {
                                    toast.success("Cadastro público bloqueado com sucesso!");
                                } else {
                                    window.location.href = "/dashboard/settings";
                                }
                            } catch {
                                window.location.href = "/dashboard/settings";
                            }
                        }
                    }
                });
            }, 1000);

            return () => clearTimeout(timer);
        }
    }, [role, registrationEnabled]);

    // 2. Poll sessions periodically to detect unexpected disconnections
    useEffect(() => {
        const interval = setInterval(() => {
            refreshSessions().catch(() => {});
        }, 20000);
        return () => clearInterval(interval);
    }, [refreshSessions]);

    // 3. Detect transition from CONNECTED -> disconnected or active session offline
    useEffect(() => {
        if (!sessions || sessions.length === 0) return;

        let newlyDisconnected: { sessionId: string; name: string; status: string } | null = null;

        for (const s of sessions) {
            const prevStatus = prevStatusMapRef.current[s.sessionId];
            if (prevStatus === "CONNECTED" && s.status !== "CONNECTED") {
                newlyDisconnected = s;
                // Reset dismissal when a fresh disconnect occurs
                setDismissedForSession(prev => ({ ...prev, [s.sessionId]: false }));
            }
            prevStatusMapRef.current[s.sessionId] = s.status;
        }

        if (newlyDisconnected) {
            playDisconnectAlertSound();
            setDisconnectedSession(newlyDisconnected);
            toast.error(`Conexão perdida: ${newlyDisconnected.name || newlyDisconnected.sessionId}`, {
                description: "A sessão do WhatsApp desconectou. Reconecte para continuar enviando mensagens.",
                duration: 10000,
            });
            return;
        }

        // Also check if currently selected session is disconnected
        const active = sessions.find(s => s.sessionId === sessionId) || sessions[0];
        // Only warn if the session is genuinely DISCONNECTED or LOGGED_OUT (never during transient CONNECTING/reconnect)
        if (active && (active.status === "DISCONNECTED" || active.status === "LOGGED_OUT") && !dismissedForSession[active.sessionId]) {
            setDisconnectedSession(active);
        } else if (active && (active.status === "CONNECTED" || active.status === "CONNECTING")) {
            setDisconnectedSession(null);
        }
    }, [sessions, sessionId, dismissedForSession]);

    if (!disconnectedSession || dismissedForSession[disconnectedSession.sessionId]) {
        return null;
    }

    return (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 w-[94%] max-w-2xl rounded-xl border border-red-300 bg-red-600/95 text-white shadow-xl backdrop-blur-md px-4 py-2.5 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-3">
            <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1.5 rounded-lg bg-white/15 shrink-0">
                    <WifiOff className="h-4 w-4 text-white animate-pulse" />
                </div>
                <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-semibold truncate">
                        Sessão WhatsApp desconectada: <span className="underline">{disconnectedSession.name || disconnectedSession.sessionId}</span>
                    </p>
                    <p className="text-[11px] text-red-100 truncate">
                        Status atual: {disconnectedSession.status}. Seus disparos e respostas automáticas estão pausados.
                    </p>
                </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
                <button
                    type="button"
                    onClick={() => playDisconnectAlertSound()}
                    title="Testar alerta sonoro"
                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                    <Volume2 className="h-3.5 w-3.5" />
                </button>
                <Link
                    href="/dashboard/sessions"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white text-red-700 hover:bg-red-50 px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors"
                >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Reconectar
                </Link>
                <button
                    type="button"
                    onClick={() => setDismissedForSession(prev => ({ ...prev, [disconnectedSession.sessionId]: true }))}
                    className="p-1.5 rounded-lg hover:bg-white/20 text-white/90 transition-colors"
                    title="Ocultar aviso"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}
