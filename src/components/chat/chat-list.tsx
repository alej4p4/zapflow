"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    MessageSquarePlus,
    Search,
    MessageCircle,
    X,
    Tag,
    MoreHorizontal,
    CornerUpLeft,
    Trash2,
    Info,
    Check,
    CheckCheck,
    Pin,
    PinOff,
    Users,
    User,
    Clock,
    FileText,
    Image as ImageIcon,
    Mic,
    Video,
    Maximize2,
    Minimize2
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getChatsStatus, searchWhatsAppContacts } from "@/app/dashboard/chat/actions";
import { useSocket } from "./socket-context";
import { toast } from "sonner";
import { prefetchChatMessages } from "./chat-cache";

export interface ChatContact {
    jid: string;
    name: string | null;
    notify: string | null;
    profilePic: string | null;
    lastMessage?: {
        content: string | null;
        timestamp: string;
        type: string;
        fromMe?: boolean;
    };
}

interface LabelData {
    id: string;
    name: string;
    colorHex: string;
}

interface ChatListProps {
    sessionId: string;
    onSelectChat: (jid: string, name?: string) => void;
    selectedJid?: string;
}

const PAGE_SIZE = 300;

function getDisplayName(chat: ChatContact): string {
    return chat.name || chat.notify || chat.jid.split('@')[0];
}

function getMessagePreview(chat: ChatContact): { text: string; isMedia: boolean; type?: string } {
    if (!chat.lastMessage?.content) {
        if (chat.jid.endsWith("@s.whatsapp.net")) {
            return { text: "Contato da agenda", isMedia: false };
        }
        return { text: "Nenhuma mensagem ainda", isMedia: false };
    }
    const content = chat.lastMessage.content;
    if (chat.lastMessage.type !== "TEXT") {
        const types: Record<string, string> = {
            IMAGE: "Imagem",
            VIDEO: "Vídeo",
            AUDIO: "Áudio",
            DOCUMENT: "Documento",
            STICKER: "Figurinha",
            LOCATION: "Localização",
            CONTACT: "Contato"
        };
        return { text: types[chat.lastMessage.type] || "Mídia", isMedia: true, type: chat.lastMessage.type };
    }
    return { text: content.length > 45 ? content.slice(0, 45) + "…" : content, isMedia: false };
}

function getTimeLabel(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return date.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return "Ontem";
    if (diffDays < 7) return date.toLocaleDateString("pt-BR", { weekday: 'short' });
    return date.toLocaleDateString("pt-BR", { month: 'numeric', day: 'numeric' });
}

// ─── Label Assignment Popover ──────
function LabelAssignPopover({ sessionId, jid, children }: { sessionId: string; jid: string; children: React.ReactNode }) {
    const [labels, setLabels] = useState<LabelData[]>([]);
    const [assigned, setAssigned] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const openRef = useRef(false);

    const fetchLabels = useCallback(async () => {
        setLoading(true);
        try {
            const [labelRes, assignedRes] = await Promise.all([
                fetch(`/api/labels/${sessionId}`),
                fetch(`/api/labels/${sessionId}/chats?jid=${encodeURIComponent(jid)}`)
            ]);
            const labelData = await labelRes.json();
            const assignedData = await assignedRes.json();

            if (labelRes.ok) setLabels(labelData.data?.labels || []);
            if (assignedRes.ok) {
                setAssigned(new Set((assignedData.data || []).map((cl: any) => cl.labelId)));
            }
        } catch (e) {
            console.error("Failed to fetch labels", e);
        } finally {
            setLoading(false);
        }
    }, [sessionId, jid]);

    useEffect(() => {
        if (openRef.current) fetchLabels();
    }, [fetchLabels]);

    const toggleLabel = async (labelId: string) => {
        const isAssigned = assigned.has(labelId);
        try {
            const res = await fetch(`/api/labels/${sessionId}/chat/${encodeURIComponent(jid)}/labels`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ labelIds: [labelId], action: isAssigned ? "remove" : "add" })
            });
            if (res.ok) {
                setAssigned(prev => {
                    const next = new Set(prev);
                    if (isAssigned) next.delete(labelId);
                    else next.add(labelId);
                    return next;
                });
                toast.success(isAssigned ? "Etiqueta removida" : "Etiqueta atribuída");
            }
        } catch (e) {
            toast.error("Não foi possível atualizar a etiqueta");
        }
    };

    return (
        <Popover onOpenChange={(open) => { openRef.current = open; if (open) fetchLabels(); }}>
            <PopoverTrigger asChild>{children}</PopoverTrigger>
            <PopoverContent className="w-56 p-1.5" side="right" align="start">
                <div className="text-xs font-semibold text-muted-foreground px-2 py-1.5">Atribuir etiquetas</div>
                {loading ? (
                    <div className="flex items-center justify-center py-4"><Skeleton className="h-4 w-24" /></div>
                ) : labels.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-2 py-2">Nenhuma etiqueta criada.</p>
                ) : (
                    <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                        {labels.map(label => (
                            <button key={label.id} onClick={() => toggleLabel(label.id)}
                                className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm hover:bg-muted transition-colors cursor-pointer text-left">
                                <div className={cn(
                                    "h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
                                    assigned.has(label.id) ? "border-foreground" : "border-muted-foreground/30"
                                )}>
                                    {assigned.has(label.id) && <Check className="h-2.5 w-2.5" />}
                                </div>
                                <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: label.colorHex }} />
                                <span className="truncate text-xs font-medium">{label.name}</span>
                            </button>
                        ))}
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}

// ─── Context Menu ──────────────────
interface CtxMenuState {
    x: number;
    y: number;
    jid: string;
    name: string;
    profilePic?: string | null;
    isPinned: boolean;
}

function ChatContextMenu({
    state,
    onClose,
    onSelect,
    onTogglePin
}: {
    state: CtxMenuState;
    onClose: () => void;
    onSelect: (jid: string, name?: string, profilePic?: string | null) => void;
    onTogglePin: (jid: string) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
        document.addEventListener("mousedown", h);
        return () => document.removeEventListener("mousedown", h);
    }, [onClose]);

    const items = [
        {
            label: "Abrir conversa",
            icon: MessageCircle,
            action: () => { onSelect(state.jid, state.name, state.profilePic); onClose(); }
        },
        {
            label: state.isPinned ? "Desafixar conversa" : "Fixar conversa no topo",
            icon: state.isPinned ? PinOff : Pin,
            action: () => { onTogglePin(state.jid); onClose(); }
        },
        {
            label: "Copiar JID",
            icon: Info,
            action: () => {
                navigator.clipboard.writeText(state.jid).then(() => toast.success("JID copiado")).catch(() => {});
                onClose();
            }
        },
    ];

    const style: React.CSSProperties = { position: "fixed", top: state.y, left: state.x, zIndex: 9999 };
    if (typeof window !== "undefined") {
        if (state.x > window.innerWidth - 190) style.left = state.x - 190;
        if (state.y > window.innerHeight - 150) style.top = state.y - 150;
    }

    return (
        <div ref={ref} style={style} className="w-52 rounded-xl bg-popover/95 backdrop-blur-md border border-border/60 shadow-2xl py-1 animate-in fade-in zoom-in-95 origin-top-left">
            {items.map((item, i) => (
                <button key={i} onClick={item.action} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors cursor-pointer text-foreground hover:bg-muted font-normal">
                    <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {item.label}
                </button>
            ))}
        </div>
    );
}

// ─── Chat Row ──────────────────────
function ChatRow({
    chat,
    isSelected,
    isPinned,
    onSelect,
    onTogglePin,
    sessionId,
    labelDots
}: {
    chat: ChatContact;
    isSelected: boolean;
    isPinned: boolean;
    onSelect: (jid: string, name?: string, profilePic?: string | null) => void;
    onTogglePin: (jid: string, e?: React.MouseEvent) => void;
    sessionId: string;
    labelDots: { colorHex: string }[];
}) {
    const displayName = getDisplayName(chat);
    const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
    const isGroup = chat.jid.endsWith("@g.us");
    const preview = getMessagePreview(chat);

    return (
        <>
            {ctxMenu && (
                <ChatContextMenu
                    state={ctxMenu}
                    onClose={() => setCtxMenu(null)}
                    onSelect={onSelect}
                    onTogglePin={onTogglePin}
                />
            )}
            <div
                className={cn(
                    "relative w-full flex items-center gap-3 px-3.5 py-3 transition-colors duration-100 border-b border-border/10 group overflow-hidden cursor-pointer select-none",
                    isSelected
                        ? "bg-[#f0f2f5] dark:bg-[#2a3942] border-l-4 border-l-[#00a884]"
                        : "hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]/70 border-l-4 border-l-transparent"
                )}
                onClick={() => onSelect(chat.jid, displayName, chat.profilePic)}
                onMouseEnter={() => prefetchChatMessages(sessionId, chat.jid)}
                onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({ x: e.clientX, y: e.clientY, jid: chat.jid, name: displayName, profilePic: chat.profilePic, isPinned });
                }}
            >
                {/* Avatar with WhatsApp group/user style */}
                <Avatar className="h-11 w-11 flex-shrink-0">
                    <AvatarImage src={chat.profilePic && chat.profilePic.startsWith("http") ? chat.profilePic : `/api/avatar/${sessionId}/${encodeURIComponent(chat.jid)}`} referrerPolicy="no-referrer" />
                    <AvatarFallback className={cn(
                        "text-xs font-semibold flex items-center justify-center",
                        isGroup
                            ? "bg-[#00a884]/15 text-[#00a884] dark:bg-[#00a884]/25"
                            : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                    )}>
                        {isGroup ? <Users className="h-5 w-5" /> : displayName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                </Avatar>

                {/* Info & Message preview */}
                <div className="flex-1 min-w-0 overflow-hidden pr-0.5">
                    {/* Line 1: Name + Time */}
                    <div className="flex justify-between items-baseline gap-2 overflow-hidden">
                        <h4 className={cn(
                            "text-[15px] truncate flex items-center gap-1.5 leading-snug flex-1 min-w-0",
                            isSelected ? "font-semibold text-foreground" : "font-medium text-foreground"
                        )} title={displayName}>
                            <span className="truncate">{displayName}</span>
                            {/* Label dots */}
                            {labelDots.length > 0 && (
                                <span className="flex items-center gap-[3px] shrink-0">
                                    {labelDots.map((d, i) => (
                                        <span key={i} className="h-2 w-2 rounded-full inline-block" style={{ backgroundColor: d.colorHex }} title="Etiqueta" />
                                    ))}
                                </span>
                            )}
                        </h4>
                        {chat.lastMessage && (
                            <span className={cn(
                                "text-[11.5px] flex-shrink-0 tabular-nums",
                                isPinned ? "text-[#00a884] font-medium" : "text-[#667781] dark:text-[#8696a0]"
                            )}>
                                {getTimeLabel(chat.lastMessage.timestamp)}
                            </span>
                        )}
                    </div>

                    {/* Line 2: Message preview + Status Check + Pin Icon + Actions */}
                    <div className="flex items-center justify-between gap-1 mt-0.5">
                        <p className="text-[13px] text-[#667781] dark:text-[#8696a0] truncate flex items-center gap-1 flex-1">
                            {/* From Me checkmark */}
                            {chat.lastMessage?.fromMe && (
                                <CheckCheck className="h-3.5 w-3.5 text-[#53bdeb] shrink-0" />
                            )}
                            {/* Media icon indicator */}
                            {preview.isMedia && (
                                <span className="shrink-0 text-muted-foreground">
                                    {preview.type === "IMAGE" && <ImageIcon className="h-3.5 w-3.5 inline mr-1" />}
                                    {preview.type === "VIDEO" && <Video className="h-3.5 w-3.5 inline mr-1" />}
                                    {preview.type === "AUDIO" && <Mic className="h-3.5 w-3.5 inline mr-1" />}
                                    {preview.type === "DOCUMENT" && <FileText className="h-3.5 w-3.5 inline mr-1" />}
                                </span>
                            )}
                            <span className="truncate">{preview.text}</span>
                        </p>

                        <div className="flex items-center gap-1 shrink-0">
                            {/* Persistent Pin Indicator */}
                            {isPinned && (
                                <span title="Conversa fixada" className="text-[#00a884] dark:text-[#00a884] p-0.5">
                                    <Pin className="h-3.5 w-3.5 rotate-45 fill-current" />
                                </span>
                            )}

                            {/* Pin / Unpin Button on Hover */}
                            <Button
                                variant="ghost"
                                size="icon"
                                title={isPinned ? "Desafixar" : "Fixar no topo"}
                                className={cn(
                                    "h-6 w-6 rounded-full transition-opacity shrink-0",
                                    isPinned ? "opacity-0 group-hover:opacity-100 text-[#00a884]" : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                                )}
                                onClick={(e) => onTogglePin(chat.jid, e)}
                            >
                                {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5 rotate-45" />}
                            </Button>

                            {/* Tag Button on Hover */}
                            <LabelAssignPopover sessionId={sessionId} jid={chat.jid}>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Etiquetas"
                                    className="h-6 w-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <Tag className="h-3 w-3" />
                                </Button>
                            </LabelAssignPopover>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

function SkeletonRow() {
    return (
        <div className="flex items-center gap-3 px-3.5 py-3 border-b border-border/10">
            <Skeleton className="h-11 w-11 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-2">
                <div className="flex justify-between">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-10" />
                </div>
                <Skeleton className="h-3.5 w-44" />
            </div>
        </div>
    );
}

// ─── Main ChatList Component ─────────
export function ChatList({ sessionId, onSelectChat, selectedJid }: ChatListProps) {
    const [chats, setChats] = useState<ChatContact[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchInput, setSearchInput] = useState("");
    const [filterType, setFilterType] = useState<"all" | "contacts" | "groups" | "pinned">("all");
    const [isNewChatOpen, setIsNewChatOpen] = useState(false);
    const [newChatNumber, setNewChatNumber] = useState("");
    const [hasMore, setHasMore] = useState(true);

    // Unlimited pinned chats (persisted per sessionId in localStorage)
    const [pinnedJids, setPinnedJids] = useState<string[]>([]);

    // Contacts searched from the 4,613 address book contacts
    const [extraContacts, setExtraContacts] = useState<ChatContact[]>([]);
    const contactSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Label dots per JID — {colorHex}[]
    const [chatLabelMap, setChatLabelMap] = useState<Map<string, { colorHex: string }[]>>(new Map());

    const { getSocket, joinSession } = useSocket();
    const chatsRef = useRef<ChatContact[]>(chats);
    chatsRef.current = chats;
    const fetchingRef = useRef(false);

    // Automatically prefetch top chats into cache for instantaneous 0ms opening
    useEffect(() => {
        if (!sessionId || chats.length === 0) return;
        const timer = setTimeout(() => {
            const topChats = chats.slice(0, 8);
            topChats.forEach(c => prefetchChatMessages(sessionId, c.jid));
        }, 300);
        return () => clearTimeout(timer);
    }, [sessionId, chats]);

    // Dynamic contact search (e.g. searching "Alexandre" across all 4,613 contacts)
    useEffect(() => {
        const q = searchInput.trim();
        if (q.length < 2) {
            setExtraContacts([]);
            return;
        }

        if (contactSearchTimerRef.current) clearTimeout(contactSearchTimerRef.current);
        contactSearchTimerRef.current = setTimeout(async () => {
            try {
                const results = await searchWhatsAppContacts(sessionId, q);
                const loadedJids = new Set(chats.map(c => c.jid));
                const newContacts: ChatContact[] = results
                    .filter(c => !loadedJids.has(c.jid))
                    .map(c => ({
                        jid: c.jid,
                        name: c.name,
                        notify: c.notify,
                        profilePic: c.profilePic,
                        lastMessage: undefined
                    }));
                setExtraContacts(newContacts);
            } catch (err) {
                console.error("Error searching contacts:", err);
            }
        }, 120);

        return () => {
            if (contactSearchTimerRef.current) clearTimeout(contactSearchTimerRef.current);
        };
    }, [searchInput, sessionId, chats]);

    // Load pinned chats from localStorage on mount
    useEffect(() => {
        if (!sessionId || typeof window === "undefined") return;
        try {
            const stored = localStorage.getItem(`zapflow_pinned_${sessionId}`);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    setPinnedJids(parsed);
                }
            }
        } catch (e) {
            console.error("Failed to load pinned chats from localStorage", e);
        }
    }, [sessionId]);

    // Toggle Pin / Unpin (Unlimited - NO 5 chat limit!)
    const handleTogglePin = useCallback((jid: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        setPinnedJids(prev => {
            let next: string[];
            const isCurrentlyPinned = prev.includes(jid);
            if (isCurrentlyPinned) {
                next = prev.filter(id => id !== jid);
                toast.success("Conversa desafixada");
            } else {
                next = [jid, ...prev]; // Prepend so latest pinned is on top
                toast.success(`Conversa fixada no topo (${next.length} fixadas)`);
            }
            if (typeof window !== "undefined") {
                try {
                    localStorage.setItem(`zapflow_pinned_${sessionId}`, JSON.stringify(next));
                } catch (err) {}
            }
            return next;
        });
    }, [sessionId]);

    // Initial and pagination fetch
    const fetchChats = useCallback(async (cursor?: string, append = false) => {
        if (fetchingRef.current) return;
        fetchingRef.current = true;
        try {
            if (!cursor) setLoading(true);
            const rawChats: any = await getChatsStatus(sessionId, PAGE_SIZE, cursor || undefined);

            const processChats = (newChatsList: ChatContact[], existingChatsList: ChatContact[] = []) => {
                const merged = new Map(existingChatsList.map(c => [c.jid, c]));
                (newChatsList || []).forEach((c: any) => {
                    const existing = merged.get(c.jid);
                    if (!existing || (c.lastMessage?.timestamp && (!existing.lastMessage?.timestamp || new Date(c.lastMessage.timestamp) > new Date(existing.lastMessage.timestamp)))) {
                        merged.set(c.jid, c);
                    }
                });
                return Array.from(merged.values());
            };

            if (append) {
                setChats(prev => processChats(rawChats, prev));
            } else {
                setChats(processChats(rawChats));
            }
            setHasMore((rawChats || []).length >= PAGE_SIZE);
        } catch (error) {
            console.error("Failed to load chats", error);
        } finally {
            setLoading(false);
            fetchingRef.current = false;
        }
    }, [sessionId]);

    useEffect(() => {
        setChats([]);
        setHasMore(true);
        fetchChats();
    }, [fetchChats]);

    // Real-time socket message update
    useEffect(() => {
        const socket = getSocket();
        if (!socket) return;
        const onConnect = () => joinSession(sessionId);
        if (socket.connected) joinSession(sessionId);
        socket.on("connect", onConnect);

        const handler = async (newMessages: any[]) => {
            let needsReload = false;
            setChats(prev => {
                const updated = [...prev];
                newMessages.forEach(msg => {
                    const jid = msg.remoteJid;
                    const idx = updated.findIndex(c => c.jid === jid);
                    if (idx !== -1) {
                        updated[idx] = {
                            ...updated[idx],
                            lastMessage: {
                                content: msg.content,
                                timestamp: msg.timestamp,
                                type: msg.type,
                                fromMe: Boolean(msg.fromMe)
                            }
                        };
                    } else {
                        needsReload = true;
                    }
                });
                updated.sort((a, b) => {
                    const tA = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0;
                    const tB = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0;
                    return tB - tA;
                });
                return updated;
            });
            if (needsReload) fetchChats();
        };

        socket.on("message.update", handler);
        return () => {
            socket.off("connect", onConnect);
            socket.off("message.update", handler);
        };
    }, [sessionId, getSocket, joinSession, fetchChats]);

    // Instantly update sidebar when a message is sent locally (0ms optimistic)
    useEffect(() => {
        const handleLocalSent = (e: Event) => {
            const { jid: sentJid, content, timestamp } = (e as CustomEvent).detail;
            setChats(prev => {
                const idx = prev.findIndex(c => c.jid === sentJid);
                if (idx === -1) return prev;
                const updated = [...prev];
                updated[idx] = {
                    ...updated[idx],
                    lastMessage: {
                        content,
                        timestamp,
                        type: "TEXT",
                        fromMe: true
                    }
                };
                const [chatItem] = updated.splice(idx, 1);
                return [chatItem, ...updated];
            });
        };
        window.addEventListener("zapflow:local-message-sent", handleLocalSent);
        return () => window.removeEventListener("zapflow:local-message-sent", handleLocalSent);
    }, []);

    // Fetch label assignments
    useEffect(() => {
        if (!sessionId) return;
        (async () => {
            try {
                const res = await fetch(`/api/labels/${sessionId}/chats`);
                if (!res.ok) return;
                const data = await res.json();
                const map = new Map<string, { colorHex: string }[]>();
                for (const cl of (data.data || [])) {
                    const jid = cl.chatJid;
                    if (!map.has(jid)) map.set(jid, []);
                    map.get(jid)!.push({ colorHex: cl.colorHex });
                }
                setChatLabelMap(map);
            } catch (e) {
                console.error("Failed to load label assignments", e);
            }
        })();
    }, [sessionId]);

    // ─── INSTANT SEARCH & SORTING (0ms delay, no skeleton wipe, unlimited pinning) ───
    const filteredAndSortedChats = useMemo(() => {
        let list = chats;

        // 1. Instant text search (immediate 0ms response on every keystroke)
        const q = searchInput.trim().toLowerCase();
        if (q) {
            const digits = q.replace(/\D/g, "");
            list = list.filter(chat => {
                const name = (chat.name || chat.notify || "").toLowerCase();
                const jid = chat.jid.toLowerCase();
                const lastContent = (chat.lastMessage?.content || "").toLowerCase();

                const matchName = name.includes(q);
                const matchJid = jid.includes(q);
                const matchContent = lastContent.includes(q);
                const matchDigits = digits.length >= 3 && jid.replace(/\D/g, "").includes(digits);

                return matchName || matchJid || matchContent || matchDigits;
            });

            // Append matching contacts from address book (e.g. searching "Alexandre")
            if (extraContacts.length > 0) {
                const existingJids = new Set(list.map(c => c.jid));
                const toAdd = extraContacts.filter(c => !existingJids.has(c.jid));
                list = [...list, ...toAdd];
            }
        }

        // 2. Filter buttons: Tudo, Contatos, Grupos, Fixados
        if (filterType === "contacts") {
            list = list.filter(c => !c.jid.endsWith("@g.us"));
        } else if (filterType === "groups") {
            list = list.filter(c => c.jid.endsWith("@g.us"));
        } else if (filterType === "pinned") {
            const pinnedSet = new Set(pinnedJids);
            list = list.filter(c => pinnedSet.has(c.jid));
        }

        // 3. Pin Ordering: ALL pinned chats at the very top (in order of pinnedJids), then remaining chats
        const pinnedSet = new Set(pinnedJids);
        const pinnedList: ChatContact[] = [];
        const unpinnedList: ChatContact[] = [];

        // Add pinned chats in the order they are stored in pinnedJids
        pinnedJids.forEach(pjid => {
            const item = list.find(c => c.jid === pjid);
            if (item) pinnedList.push(item);
        });

        // Add the rest
        list.forEach(c => {
            if (!pinnedSet.has(c.jid)) {
                unpinnedList.push(c);
            }
        });

        return [...pinnedList, ...unpinnedList];
    }, [chats, searchInput, extraContacts, filterType, pinnedJids]);

    const handleEndReached = useCallback(() => {
        if (hasMore && !loading && !searchInput.trim()) {
            const last = chatsRef.current[chatsRef.current.length - 1];
            const c = last?.lastMessage?.timestamp;
            if (c) fetchChats(c, true);
        }
    }, [hasMore, loading, searchInput, fetchChats]);

    const itemContent = useCallback(
        (_: number, chat: ChatContact) => (
            <ChatRow
                key={chat.jid}
                chat={chat}
                isSelected={selectedJid === chat.jid}
                isPinned={pinnedJids.includes(chat.jid)}
                onSelect={onSelectChat}
                onTogglePin={handleTogglePin}
                sessionId={sessionId}
                labelDots={chatLabelMap.get(chat.jid) || []}
            />
        ),
        [selectedJid, pinnedJids, onSelectChat, handleTogglePin, sessionId, chatLabelMap]
    );

    const handleStartNewChat = () => {
        if (!newChatNumber) return;
        let clean = newChatNumber.replace(/\D/g, '');
        if (clean.startsWith('0')) clean = '62' + clean.substring(1);
        onSelectChat(`${clean}@s.whatsapp.net`);
        setIsNewChatOpen(false);
        setNewChatNumber("");
    };

    if (loading && chats.length === 0) {
        return (
            <div className="flex flex-col h-full overflow-hidden bg-background">
                <div className="p-3 space-y-3">
                    <Skeleton className="h-10 w-full rounded-lg" />
                    {[1, 2, 3, 4, 5, 6].map(i => <SkeletonRow key={i} />)}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden bg-background select-none">
            {/* WhatsApp Styled Left Header */}
            <div className="shrink-0 px-3.5 pt-3 pb-2.5 space-y-2.5 border-b border-border/15 bg-[#f0f2f5] dark:bg-[#202c33]">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-lg text-foreground tracking-tight">
                            Conversas
                        </h3>
                        {chats.length > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-muted font-medium text-muted-foreground">
                                {chats.length}
                            </span>
                        )}
                        {pinnedJids.length > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-[#00a884]/15 text-[#00a884] font-medium flex items-center gap-1">
                                <Pin className="h-3 w-3 rotate-45 fill-current" />
                                {pinnedJids.length}
                            </span>
                        )}
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        title="Nova conversa"
                        className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={() => setIsNewChatOpen(!isNewChatOpen)}
                    >
                        {isNewChatOpen ? <X className="h-4 w-4" /> : <MessageSquarePlus className="h-4 w-4" />}
                    </Button>
                </div>

                {/* Instant Search Bar with Clear Button */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#667781] dark:text-[#8696a0]" />
                    <Input
                        placeholder="Pesquisar conversa ou contato..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        className="h-9 pl-9 pr-8 text-[13.5px] bg-white dark:bg-[#111b21] border border-border/20 rounded-lg focus-visible:ring-1 focus-visible:ring-[#00a884] placeholder:text-[#667781] dark:placeholder:text-[#8696a0]"
                    />
                    {searchInput && (
                        <button
                            onClick={() => setSearchInput("")}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground"
                            title="Limpar busca"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>

                {/* Quick Filters: Tudo, Contatos, Grupos, Fixados */}
                <div className="flex items-center gap-1.5 pt-0.5 overflow-x-auto no-scrollbar">
                    <button
                        onClick={() => setFilterType("all")}
                        className={cn(
                            "px-3 py-1 rounded-full text-xs font-medium transition-colors shrink-0 cursor-pointer",
                            filterType === "all"
                                ? "bg-[#00a884] text-white"
                                : "bg-muted/70 hover:bg-muted text-muted-foreground"
                        )}
                    >
                        Tudo
                    </button>
                    <button
                        onClick={() => setFilterType("contacts")}
                        className={cn(
                            "px-3 py-1 rounded-full text-xs font-medium transition-colors shrink-0 flex items-center gap-1 cursor-pointer",
                            filterType === "contacts"
                                ? "bg-[#00a884] text-white"
                                : "bg-muted/70 hover:bg-muted text-muted-foreground"
                        )}
                    >
                        <User className="h-3 w-3" />
                        Contatos
                    </button>
                    <button
                        onClick={() => setFilterType("groups")}
                        className={cn(
                            "px-3 py-1 rounded-full text-xs font-medium transition-colors shrink-0 flex items-center gap-1 cursor-pointer",
                            filterType === "groups"
                                ? "bg-[#00a884] text-white"
                                : "bg-muted/70 hover:bg-muted text-muted-foreground"
                        )}
                    >
                        <Users className="h-3 w-3" />
                        Grupos
                    </button>
                    <button
                        onClick={() => setFilterType("pinned")}
                        className={cn(
                            "px-3 py-1 rounded-full text-xs font-medium transition-colors shrink-0 flex items-center gap-1 cursor-pointer",
                            filterType === "pinned"
                                ? "bg-[#00a884] text-white"
                                : "bg-muted/70 hover:bg-muted text-muted-foreground"
                        )}
                    >
                        <Pin className="h-3 w-3 rotate-45" />
                        Fixados {pinnedJids.length > 0 && `(${pinnedJids.length})`}
                    </button>
                </div>

                {/* New Chat Form Drawer */}
                {isNewChatOpen && (
                    <div className="p-3 bg-white dark:bg-[#111b21] rounded-xl space-y-2 border border-border/40 shadow-sm animate-in slide-in-from-top-2">
                        <Label className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
                            Número com DDD (ex: 5566999999999)
                        </Label>
                        <div className="flex gap-2">
                            <Input
                                placeholder="5566999999999"
                                value={newChatNumber}
                                onChange={(e) => setNewChatNumber(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleStartNewChat()}
                                className="h-8 text-sm"
                                autoFocus
                            />
                            <Button size="sm" className="h-8 px-3 bg-[#00a884] hover:bg-[#00a884]/90 text-white" onClick={handleStartNewChat}>
                                Abrir
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Virtualized Chat List */}
            <div className="flex-1 min-h-0 bg-background">
                {filteredAndSortedChats.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                        <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
                            <MessageCircle className="h-6 w-6 text-muted-foreground/50" />
                        </div>
                        <p className="text-sm font-medium text-foreground">Nenhuma conversa encontrada</p>
                        <p className="text-xs text-muted-foreground mt-1">
                            {searchInput ? `Nenhum resultado para "${searchInput}"` : "Nenhuma conversa disponível"}
                        </p>
                        {searchInput && (
                            <Button variant="ghost" size="sm" className="mt-3 text-xs text-[#00a884]" onClick={() => setSearchInput("")}>
                                Limpar busca
                            </Button>
                        )}
                    </div>
                ) : (
                    <Virtuoso
                        style={{ height: "100%" }}
                        data={filteredAndSortedChats}
                        computeItemKey={(_: number, chat: ChatContact) => chat.jid}
                        itemContent={itemContent}
                        endReached={handleEndReached}
                        increaseViewportBy={300}
                        components={{
                            Footer: () => hasMore && !loading && !searchInput.trim() ? (
                                <div className="py-4 text-center">
                                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                                        Carregando mais conversas...
                                    </span>
                                </div>
                            ) : null
                        }}
                    />
                )}
            </div>
        </div>
    );
}
