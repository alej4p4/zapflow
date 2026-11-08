"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { getCookie, setCookie } from "@/lib/client-cookie";
import { useRouter } from "next/navigation";
import { useSession as useAuthSession } from "next-auth/react";
import { toast } from "sonner";

interface Session {
    id: string;
    sessionId: string;
    name: string;
    status: string;
}

interface SessionContextType {
    sessions: Session[];
    sessionId: string;
    setSessionId: (id: string, updateUrl?: boolean) => void;
    refreshSessions: () => Promise<void>;
    loading: boolean;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [sessionId, setSessionIdState] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const { data: authSession, status: authStatus } = useAuthSession();

    const fetchSessions = useCallback(async () => {
        try {
            const res = await fetch('/api/sessions');
            if (res.ok) {
                const responseData = await res.json();
                const data: Session[] = responseData?.data || [];
                setSessions(data);

                // Priority 1: URL query param (?session=... or ?s=...) - allows multi-tab isolation!
                let urlSessionId: string | null = null;
                if (typeof window !== "undefined") {
                    const params = new URLSearchParams(window.location.search);
                    urlSessionId = params.get("session") || params.get("s");
                }

                // Priority 2: Tab-isolated sessionStorage (unique per browser tab)
                let tabSessionId: string | null = null;
                if (typeof window !== "undefined") {
                    try {
                        tabSessionId = sessionStorage.getItem("zapflow_active_session");
                    } catch {}
                }

                // Priority 3: Cookie (fallback for fresh tab without session specified)
                const cookieId = getCookie("sessionId");

                // Find first valid match according to priority
                const chosen = [urlSessionId, tabSessionId, cookieId].find(
                    id => id && data.some(s => s.sessionId === id)
                );

                if (chosen) {
                    setSessionIdState(chosen);
                    setCookie("sessionId", chosen);
                    if (typeof window !== "undefined") {
                        try { sessionStorage.setItem("zapflow_active_session", chosen); } catch {}
                    }
                } else if (data.length > 0) {
                    // Default to first connected or first
                    const connected = data.find((s: Session) => s.status === "CONNECTED");
                    const target = connected ? connected.sessionId : data[0].sessionId;
                    setSessionIdState(target);
                    setCookie("sessionId", target);
                    if (typeof window !== "undefined") {
                        try { sessionStorage.setItem("zapflow_active_session", target); } catch {}
                    }
                } else {
                    setSessionIdState("");
                    setCookie("sessionId", "");
                    if (typeof window !== "undefined") {
                        try { sessionStorage.removeItem("zapflow_active_session"); } catch {}
                    }
                }
            }
        } catch (error) {
            console.error(error);
            toast.error("Não foi possível carregar as sessões");
        } finally {
            setLoading(false);
        }
    }, []);

    // Re-fetch whenever auth state changes (e.g. login, logout, user switch)
    useEffect(() => {
        if (authStatus === "unauthenticated") {
            setSessions([]);
            setSessionIdState("");
            setLoading(false);
            return;
        }
        fetchSessions();
    }, [authSession?.user?.id, authStatus, fetchSessions]);

    // Also listen to URL changes to switch active session per tab
    useEffect(() => {
        const handlePopState = () => {
            if (typeof window === "undefined") return;
            const params = new URLSearchParams(window.location.search);
            const urlSession = params.get("session") || params.get("s");
            if (urlSession && urlSession !== sessionId) {
                setSessionIdState(urlSession);
                setCookie("sessionId", urlSession);
                try { sessionStorage.setItem("zapflow_active_session", urlSession); } catch {}
            }
        };
        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, [sessionId]);

    const setSessionId = (id: string, updateUrl = true) => {
        setSessionIdState(id);
        setCookie("sessionId", id); // Sync Cookie

        if (typeof window !== "undefined") {
            try {
                // Tab-isolated storage: each tab remembers its own session!
                sessionStorage.setItem("zapflow_active_session", id);
            } catch {}

            if (updateUrl) {
                const url = new URL(window.location.href);
                url.searchParams.set("session", id);
                // If on a specific chat URL (/dashboard/chat/5566...), reset to /dashboard/chat to avoid loading foreign JID
                if (url.pathname.startsWith("/dashboard/chat/")) {
                    url.pathname = "/dashboard/chat";
                }
                window.history.replaceState(null, "", url.toString());
            }

            window.dispatchEvent(new CustomEvent("zapflow:session-changed", { detail: { sessionId: id } }));
        }

        router.refresh();
    };

    return (
        <SessionContext.Provider value={{ sessions, sessionId, setSessionId, refreshSessions: fetchSessions, loading }}>
            {children}
        </SessionContext.Provider>
    );
}

export function useSession() {
    const context = useContext(SessionContext);
    if (!context) {
        throw new Error("useSession must be used within a SessionProvider");
    }
    return context;
}
