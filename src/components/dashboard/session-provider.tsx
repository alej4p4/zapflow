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
    setSessionId: (id: string) => void;
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

                // Sync with cookie or auto-select valid session
                const cookieId = getCookie("sessionId");
                const matchedSession = cookieId ? data.find((s: Session) => s.sessionId === cookieId) : undefined;

                if (matchedSession) {
                    setSessionIdState(matchedSession.sessionId);
                } else if (data.length > 0) {
                    // Prioritize connected session, otherwise fallback to first
                    const connected = data.find((s: Session) => s.status === "CONNECTED");
                    const target = connected ? connected.sessionId : data[0].sessionId;
                    setSessionIdState(target);
                    setCookie("sessionId", target);
                } else {
                    setSessionIdState("");
                    setCookie("sessionId", "");
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

    const setSessionId = (id: string) => {
        setSessionIdState(id);
        setCookie("sessionId", id); // Sync Cookie

        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("zapflow:session-changed", { detail: { sessionId: id } }));
            // If on a specific chat URL (/dashboard/chat/5566...), reset to /dashboard/chat to avoid loading foreign JID
            if (window.location.pathname.startsWith("/dashboard/chat/")) {
                window.history.replaceState(null, "", "/dashboard/chat");
            }
        }

        router.refresh(); // Sync Server Components if any
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
