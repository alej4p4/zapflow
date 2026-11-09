"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    MessageSquarePlus,
    Loader2,
    Search,
    MessageCircle,
    X,
    Tag,
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
    Eye,
    ChevronDown,
    Settings,
    Volume2,
    VolumeX,
    Archive,
    ArchiveRestore
} from "lucide-react";
import { LabelAssignPopover, LabelData, ManageLabelsModal } from "./label-assign-popover";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getChatsStatus, searchWhatsAppContacts, searchGlobalMessages } from "@/app/dashboard/chat/actions";
import { useSocket } from "./socket-context";
import { toast } from "sonner";
import { prefetchChatMessages } from "./chat-cache";

export interface ChatContact {
    jid: string;
    name: string | null;
    notify: string | null;
    profilePic: string | null;
    lastMessage?: {
        keyId?: string;
        content: string | null;
        timestamp: string;
        type: string;
        fromMe?: boolean;
        status?: string;
    };
    unreadCount?: number;
}

interface ChatListProps {
    sessionId: string;
    onSelectChat: (jid: string, name?: string, profilePic?: string | null) => void;
    selectedJid?: string;
}

const PAGE_SIZE = 600;

function playWhatsAppIncomingSound() {
    try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.09); // A5
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.18);
    } catch {
        // Ignore if blocked before interaction
    }
}

function getDisplayName(chat: ChatContact): string {
    return chat.name || chat.notify || chat.jid.split('@')[0];
}

function getMessagePreview(chat: ChatContact): { text: string; isMedia: boolean; type?: string } {
    if (!chat.lastMessage) {
        if (chat.jid.endsWith("@g.us")) {
            return { text: "Grupo do WhatsApp", isMedia: false };
        }
        return { text: "Contato da agenda", isMedia: false };
    }
    if (!chat.lastMessage.content && chat.lastMessage.type === "TEXT") {
        return { text: "Mensagem", isMedia: false };
    }
    const content = chat.lastMessage.content || "";
    if (chat.lastMessage.type !== "TEXT") {
        const types: Record<string, string> = {
            IMAGE: content ? `📷 ${content}` : "Foto",
            VIDEO: content ? `🎥 ${content}` : "Vídeo",
            AUDIO: "Mensagem de voz",
            DOCUMENT: content || "Documento",
            STICKER: "Figurinha",
            LOCATION: "Localização",
            CONTACT: "Contato",
            POLL: content ? `📊 ${content.split("|")[0]}` : "📊 Enquete"
        };
        const label = types[chat.lastMessage.type] || "Mídia";
        return {
            text: label.length > 45 ? label.slice(0, 45) + "…" : label,
            isMedia: true,
            type: chat.lastMessage.type
        };
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

function SidebarStatusCheck({ status }: { status?: string }) {
    switch (status) {
        case "READ":
            return <CheckCheck className="h-3.5 w-3.5 text-[#53bdeb] shrink-0" />;
        case "DELIVERED":
            return <CheckCheck className="h-3.5 w-3.5 text-[#667781] dark:text-[#8696a0] shrink-0" />;
        case "PENDING":
            return <Clock className="h-3 w-3 text-[#667781] dark:text-[#8696a0] shrink-0" />;
        case "SENT":
        default:
            return <Check className="h-3.5 w-3.5 text-[#667781] dark:text-[#8696a0] shrink-0" />;
    }
}

// ─── Context Menu ──────────────────
interface CtxMenuState {
    x: number;
    y: number;
    jid: string;
    name: string;
    profilePic?: string | null;
    isPinned: boolean;
    isArchived: boolean;
    isMuted: boolean;
    unreadCount?: number;
}

function ChatContextMenu({
    state,
    onClose,
    onSelect,
    onTogglePin,
    onToggleArchive,
    onToggleMute,
    onToggleRead
}: {
    state: CtxMenuState;
    onClose: () => void;
    onSelect: (jid: string, name?: string, profilePic?: string | null) => void;
    onTogglePin: (jid: string) => void;
    onToggleArchive: (jid: string) => void;
    onToggleMute: (jid: string) => void;
    onToggleRead: (jid: string, isUnread: boolean) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
        document.addEventListener("mousedown", h);
        return () => document.removeEventListener("mousedown", h);
    }, [onClose]);

    const isUnread = Boolean(state.unreadCount && state.unreadCount > 0);
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
            label: state.isMuted ? "Ativar notificações" : "Silenciar notificações",
            icon: state.isMuted ? Volume2 : VolumeX,
            action: () => { onToggleMute(state.jid); onClose(); }
        },
        {
            label: state.isArchived ? "Desarquivar conversa" : "Arquivar conversa",
            icon: state.isArchived ? ArchiveRestore : Archive,
            action: () => { onToggleArchive(state.jid); onClose(); }
        },
        {
            label: isUnread ? "Marcar como lida" : "Marcar como não lida",
            icon: isUnread ? CheckCheck : Eye,
            action: () => { onToggleRead(state.jid, isUnread); onClose(); }
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
        if (state.y > window.innerHeight - 230) style.top = state.y - 230;
    }

    return (
        <div ref={ref} style={style} className="w-56 rounded-xl bg-popover/95 backdrop-blur-md border border-border/60 shadow-2xl py-1 animate-in fade-in zoom-in-95 origin-top-left">
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
    isArchived,
    isMuted,
    draftText,
    presence,
    onSelect,
    onTogglePin,
    onToggleArchive,
    onToggleMute,
    onToggleRead,
    sessionId,
    labelDots
}: {
    chat: ChatContact;
    isSelected: boolean;
    isPinned: boolean;
    isArchived: boolean;
    isMuted: boolean;
    draftText?: string;
    presence?: { status: "composing" | "recording" };
    onSelect: (jid: string, name?: string, profilePic?: string | null) => void;
    onTogglePin: (jid: string, e?: React.MouseEvent) => void;
    onToggleArchive: (jid: string, e?: React.MouseEvent) => void;
    onToggleMute: (jid: string, e?: React.MouseEvent) => void;
    onToggleRead: (jid: string, isUnread: boolean) => void;
    sessionId: string;
    labelDots: { colorHex: string; name?: string }[];
}) {
    const displayName = getDisplayName(chat);
    const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
    const isGroup = chat.jid.endsWith("@g.us");
    const preview = getMessagePreview(chat);
    const unreadCount = chat.unreadCount || 0;

    return (
        <>
            {ctxMenu && (
                <ChatContextMenu
                    state={ctxMenu}
                    onClose={() => setCtxMenu(null)}
                    onSelect={onSelect}
                    onTogglePin={onTogglePin}
                    onToggleArchive={onToggleArchive}
                    onToggleMute={onToggleMute}
                    onToggleRead={onToggleRead}
                />
            )}
            <div
                className={cn(
                    "relative w-full flex items-center gap-3 px-3.5 py-3 transition-colors duration-75 border-b border-border/10 group overflow-hidden cursor-pointer select-none",
                    isSelected
                        ? "bg-[#f0f2f5] dark:bg-[#2a3942]"
                        : "hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]"
                )}
                onClick={() => onSelect(chat.jid, displayName, chat.profilePic)}
                onMouseEnter={() => prefetchChatMessages(sessionId, chat.jid)}
                onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({
                        x: e.clientX,
                        y: e.clientY,
                        jid: chat.jid,
                        name: displayName,
                        profilePic: chat.profilePic,
                        isPinned,
                        isArchived,
                        isMuted,
                        unreadCount: chat.unreadCount
                    });
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
                            unreadCount > 0 ? "font-bold text-foreground" : isSelected ? "font-semibold text-foreground" : "font-medium text-foreground"
                        )} title={displayName}>
                            <span className="online-dot absolute right-2.5 top-1/2 -translate-y-1/2"></span>{displayName}
                            {/* Label dots */}
                            {labelDots.length > 0 && (
                                <span className="flex items-center gap-[3px] shrink-0">
                                    {labelDots.map((d, i) => (
                                        <span key={i} className="h-2 w-2 rounded-full inline-block shadow-xs" style={{ backgroundColor: d.colorHex }} title={d.name || "Etiqueta"} />
                                    ))}
                                </span>
                            )}
                        </h4>
                        {chat.lastMessage && (
                            <span className={cn(
                                "text-[11.5px] flex-shrink-0 tabular-nums",
                                unreadCount > 0
                                    ? "text-[#25d366] font-semibold"
                                    : isPinned
                                        ? "text-[#00a884] font-medium"
                                        : "text-[#667781] dark:text-[#8696a0]"
                            )}>
                                {getTimeLabel(chat.lastMessage.timestamp)}
                            </span>
                        )}
                    </div>

                    {/* Line 2: Presence OR Draft OR Message preview + Status Check + Unread Badge + Pin Icon */}
                    <div className="flex items-center justify-between gap-1 mt-0.5">
                        {presence ? (
                            <p className="text-[13px] text-[#00a884] dark:text-[#25d366] font-medium truncate flex items-center gap-1 flex-1 animate-pulse">
                                {presence.status === "recording" ? (
                                    <>
                                        <Mic className="h-3.5 w-3.5 shrink-0" />
                                        <span>gravando áudio...</span>
                                    </>
                                ) : (
                                    <span>digitando...</span>
                                )}
                            </p>
                        ) : draftText && !isSelected ? (
                            <p className="text-[13px] truncate flex items-center gap-1 flex-1">
                                <span className="text-red-500 dark:text-red-400 font-semibold shrink-0">Rascunho:</span>
                                <span className="text-[#667781] dark:text-[#8696a0] truncate">{draftText}</span>
                            </p>
                        ) : (
                            <p className={cn(
                                "text-[13px] truncate flex items-center gap-1 flex-1",
                                unreadCount > 0 ? "text-foreground font-medium" : "text-[#667781] dark:text-[#8696a0]"
                            )}>
                                {/* From Me checkmark */}
                                {chat.lastMessage?.fromMe && (
                                    <SidebarStatusCheck status={chat.lastMessage.status} />
                                )}
                                {/* Media icon indicator */}
                                {preview.isMedia && (
                                    <span className="shrink-0 text-muted-foreground">
                                        {preview.type === "IMAGE" && <ImageIcon className="h-3.5 w-3.5 inline mr-1" />}
                                        {preview.type === "VIDEO" && <Video className="h-3.5 w-3.5 inline mr-1" />}
                                        {preview.type === "AUDIO" && <Mic className="h-3.5 w-3.5 inline mr-1 text-[#00a884]" />}
                                        {preview.type === "DOCUMENT" && <FileText className="h-3.5 w-3.5 inline mr-1" />}
                                    </span>
                                )}
                                <span className="truncate">{preview.text}</span>
                            </p>
                        )}

                        <div className="flex items-center gap-1 shrink-0">
                            {/* WhatsApp Green Unread Counter Badge */}
                            {unreadCount > 0 && (
                                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#25d366] text-white text-[11px] font-bold flex items-center justify-center tabular-nums shadow-xs">
                                    {unreadCount > 99 ? "99+" : unreadCount}
                                </span>
                            )}

                            {/* Persistent Mute Indicator (#C26) */}
                            {isMuted && (
                                <span title="Notificações silenciadas" className="text-muted-foreground/75 p-0.5">
                                    <VolumeX className="h-3.5 w-3.5" />
                                </span>
                            )}

                            {/* Persistent Pin Indicator */}
                            {isPinned && (
                                <span title="Conversa fixada" className="text-[#00a884] dark:text-[#00a884] p-0.5">
                                    <Pin className="h-3.5 w-3.5 rotate-45 fill-current" />
                                </span>
                            )}

                            {/* Mark Read / Unread Button on Hover (#C18) */}
                            <Button
                                variant="ghost"
                                size="icon"
                                title={unreadCount > 0 ? "Marcar como lida" : "Marcar como não lida"}
                                className="h-6 w-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-[#25d366] shrink-0"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleRead(chat.jid, unreadCount > 0);
                                }}
                            >
                                {unreadCount > 0 ? <CheckCheck className="h-3.5 w-3.5 text-[#25d366]" /> : <Eye className="h-3.5 w-3.5" />}
                            </Button>

                            {/* Mute / Unmute Button on Hover */}
                            <Button
                                variant="ghost"
                                size="icon"
                                title={isMuted ? "Ativar notificações" : "Silenciar notificações"}
                                className={cn(
                                    "h-6 w-6 rounded-full transition-opacity shrink-0",
                                    isMuted ? "opacity-0 group-hover:opacity-100 text-amber-500 hover:text-amber-600" : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                                )}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleMute(chat.jid, e);
                                }}
                            >
                                {isMuted ? <Volume2 className="h-3.5 w-3.5 text-[#00a884]" /> : <VolumeX className="h-3.5 w-3.5" />}
                            </Button>

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

                            {/* Archive / Unarchive Button on Hover */}
                            <Button
                                variant="ghost"
                                size="icon"
                                title={isArchived ? "Desarquivar conversa" : "Arquivar conversa"}
                                className="h-6 w-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
                                onClick={(e) => onToggleArchive(chat.jid, e)}
                            >
                                {isArchived ? <ArchiveRestore className="h-3.5 w-3.5 text-[#00a884]" /> : <Archive className="h-3.5 w-3.5" />}
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

// Global in-memory cache for chat list per session (WhatsApp Web method)
export const globalChatListCache = new Map<string, ChatContact[]>();

function loadPersistedChatList(sessionId: string): ChatContact[] {
    if (!sessionId) return [];
    const inMem = globalChatListCache.get(sessionId);
    if (inMem && inMem.length > 0) return inMem;
    if (typeof window === "undefined") return [];
    try {
        const raw = localStorage.getItem(`zapflow_chatlist_v2_${sessionId}`);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                globalChatListCache.set(sessionId, parsed);
                return parsed;
            }
        }
    } catch {}
    return [];
}

function savePersistedChatList(sessionId: string, list: ChatContact[]) {
    if (!sessionId) return;
    globalChatListCache.set(sessionId, list);
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(`zapflow_chatlist_v2_${sessionId}`, JSON.stringify(list.slice(0, 450)));
    } catch {}
}

// ─── Main ChatList Component ─────────
export function ChatList({ sessionId, onSelectChat, selectedJid }: ChatListProps) {
    const initialCached = useMemo(() => loadPersistedChatList(sessionId), [sessionId]);
    const [chats, setChats] = useState<ChatContact[]>(initialCached);
    const [loading, setLoading] = useState(initialCached.length === 0);
    const [searchInput, setSearchInput] = useState("");
    const [filterType, setFilterType] = useState<"all" | "unread" | "contacts" | "groups" | "pinned" | "archived">("all");
    const [isNewChatOpen, setIsNewChatOpen] = useState(false);
    const [newChatNumber, setNewChatNumber] = useState("");
    const [hasMore, setHasMore] = useState(true);
    const [soundMuted, setSoundMuted] = useState(false);

    // Live presence map per JID ("composing" | "recording")
    const [presenceMap, setPresenceMap] = useState<Record<string, { status: "composing" | "recording" }>>({});
    const presenceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    // Track seen incoming keyIds so two-phase instant + media socket updates only increment unreadCount once
    const seenIncomingKeysRef = useRef<Set<string>>(new Set());

    // Unlimited pinned chats (persisted per sessionId in localStorage)
    const [pinnedJids, setPinnedJids] = useState<string[]>([]);
    // Archived chats (#C14)
    const [archivedJids, setArchivedJids] = useState<string[]>([]);
    // Muted chats (#C26)
    const [mutedJids, setMutedJids] = useState<string[]>([]);
    const mutedJidsRef = useRef<string[]>([]);
    mutedJidsRef.current = mutedJids;
    // Per-chat message drafts (#C13)
    const [draftMap, setDraftMap] = useState<Record<string, string>>({});

    const searchInputRef = useRef<HTMLInputElement>(null);

    // Global message search state
    const [matchingMessages, setMatchingMessages] = useState<Array<{
        id: string;
        keyId: string;
        jid: string;
        fromMe: boolean;
        content: string;
        timestamp: string;
        type: string;
        contactName: string;
        profilePic?: string | null;
    }>>([]);
    const [isSearchingMessages, setIsSearchingMessages] = useState(false);
    const [searchTab, setSearchTab] = useState<"chats" | "messages">("chats");
    const msgSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Contacts searched from the address book
    const [extraContacts, setExtraContacts] = useState<ChatContact[]>([]);
    const contactSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Label dots & active session labels
    const [chatLabelMap, setChatLabelMap] = useState<Map<string, { labelId: string; name: string; colorHex: string }[]>>(new Map());
    const [availableLabels, setAvailableLabels] = useState<LabelData[]>([]);
    const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
    const [isManageLabelsOpen, setIsManageLabelsOpen] = useState(false);

    const { getSocket, joinSession } = useSocket();
    const chatsRef = useRef<ChatContact[]>(chats);
    chatsRef.current = chats;
    const selectedJidRef = useRef<string | undefined>(selectedJid);
    selectedJidRef.current = selectedJid;
    const soundMutedRef = useRef<boolean>(soundMuted);
    soundMutedRef.current = soundMuted;
    const fetchingRef = useRef(false);

    // Load mute state, pinned, archived, and drafts from localStorage
    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            setSoundMuted(localStorage.getItem("zapflow_chat_muted") === "1");
        } catch {}
    }, []);

    useEffect(() => {
        if (!sessionId || typeof window === "undefined") return;
        try {
            const storedPinned = localStorage.getItem(`zapflow_pinned_${sessionId}`);
            if (storedPinned) {
                const parsed = JSON.parse(storedPinned);
                if (Array.isArray(parsed)) setPinnedJids(parsed);
            }
            const storedArchived = localStorage.getItem(`zapflow_archived_${sessionId}`);
            if (storedArchived) {
                const parsed = JSON.parse(storedArchived);
                if (Array.isArray(parsed)) setArchivedJids(parsed);
            }
            const storedMuted = localStorage.getItem(`zapflow_muted_${sessionId}`);
            if (storedMuted) {
                const parsed = JSON.parse(storedMuted);
                if (Array.isArray(parsed)) setMutedJids(parsed);
            }
            const storedDrafts = localStorage.getItem(`zapflow_drafts_${sessionId}`);
            if (storedDrafts) {
                const parsed = JSON.parse(storedDrafts);
                if (parsed && typeof parsed === "object") setDraftMap(parsed);
            }
        } catch (e) {
            console.error("Failed to load local chat preferences", e);
        }
    }, [sessionId]);

    // Sync mute changes initiated from ChatWindow (#C26)
    useEffect(() => {
        const handleMuteChanged = (e: Event) => {
            const { jid: targetJid, muted } = (e as CustomEvent<{ jid: string; muted: boolean }>).detail || {};
            if (!targetJid) return;
            setMutedJids(prev => {
                const next = muted
                    ? Array.from(new Set([...prev, targetJid]))
                    : prev.filter(id => id !== targetJid);
                try {
                    localStorage.setItem(`zapflow_muted_${sessionId}`, JSON.stringify(next));
                } catch {}
                return next;
            });
        };
        window.addEventListener("zapflow:mute-changed", handleMuteChanged);
        return () => window.removeEventListener("zapflow:mute-changed", handleMuteChanged);
    }, [sessionId]);

    // Listen for live draft updates from ChatInputBar (#C13)
    useEffect(() => {
        const handleDraftChanged = (e: Event) => {
            const { jid: draftJid, text } = (e as CustomEvent<{ jid: string; text: string }>).detail || {};
            if (!draftJid) return;
            setDraftMap(prev => {
                const next = { ...prev };
                if (text && text.trim()) {
                    next[draftJid] = text;
                } else {
                    delete next[draftJid];
                }
                return next;
            });
        };
        window.addEventListener("zapflow:draft-changed", handleDraftChanged);
        return () => window.removeEventListener("zapflow:draft-changed", handleDraftChanged);
    }, []);

    const toggleMuteSound = () => {
        setSoundMuted(prev => {
            const next = !prev;
            try {
                localStorage.setItem("zapflow_chat_muted", next ? "1" : "0");
            } catch {}
            toast.info(next ? "Som de novas mensagens silenciado 🔕" : "Som de novas mensagens ativado 🔔");
            return next;
        });
    };

    // Automatically prefetch top 15 chats into cache for instantaneous 0ms opening
    useEffect(() => {
        if (!sessionId || chats.length === 0) return;
        const timer = setTimeout(() => {
            const topChats = chats.filter(c => !!c.lastMessage).slice(0, 15);
            topChats.forEach(c => prefetchChatMessages(sessionId, c.jid));
        }, 150);
        return () => clearTimeout(timer);
    }, [sessionId, chats.length]);

    // Dynamic contact search across all contacts in DB
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
                const loadedJids = new Set(chatsRef.current.map(c => c.jid));
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
        }, 100);

        return () => {
            if (contactSearchTimerRef.current) clearTimeout(contactSearchTimerRef.current);
        };
    }, [searchInput, sessionId]);

    // Dynamic search across all historical messages in DB
    useEffect(() => {
        const q = searchInput.trim();
        if (q.length < 2) {
            setMatchingMessages([]);
            setIsSearchingMessages(false);
            setSearchTab("chats");
            return;
        }

        if (msgSearchTimerRef.current) clearTimeout(msgSearchTimerRef.current);
        setIsSearchingMessages(true);
        msgSearchTimerRef.current = setTimeout(async () => {
            try {
                const res = await searchGlobalMessages(sessionId, q);
                setMatchingMessages(res);
            } catch (err) {
                console.error("Error searching global messages:", err);
            } finally {
                setIsSearchingMessages(false);
            }
        }, 250);

        return () => {
            if (msgSearchTimerRef.current) clearTimeout(msgSearchTimerRef.current);
        };
    }, [searchInput, sessionId]);

    // Handle selecting a chat and automatically clearing its unread badge
    const handleSelectAndClearUnread = useCallback((jid: string, name?: string, profilePic?: string | null) => {
        setChats(prev => {
            const target = prev.find(c => c.jid === jid);
            if (!target || !target.unreadCount) return prev;
            const next = prev.map(c => c.jid === jid ? { ...c, unreadCount: 0 } : c);
            savePersistedChatList(sessionId, next);
            return next;
        });
        if (typeof window !== "undefined") {
            try {
                const raw = localStorage.getItem(`zapflow_unread_${sessionId}`);
                if (raw) {
                    const list: string[] = JSON.parse(raw);
                    if (Array.isArray(list) && list.includes(jid)) {
                        localStorage.setItem(`zapflow_unread_${sessionId}`, JSON.stringify(list.filter(x => x !== jid)));
                    }
                }
            } catch {}
        }
        onSelectChat(jid, name, profilePic);
    }, [onSelectChat, sessionId]);

    // Mark Chat as Read / Unread manually (#C18)
    const handleToggleRead = useCallback(async (jid: string, currentlyUnread: boolean) => {
        const nextStatus = !currentlyUnread;
        setChats(prev => {
            const next = prev.map(c => c.jid === jid ? { ...c, unreadCount: currentlyUnread ? 0 : 1 } : c);
            savePersistedChatList(sessionId, next);
            return next;
        });
        if (typeof window !== "undefined") {
            try {
                const raw = localStorage.getItem(`zapflow_unread_${sessionId}`);
                const list: string[] = raw ? JSON.parse(raw) : [];
                const updated = currentlyUnread
                    ? list.filter(x => x !== jid)
                    : Array.from(new Set([...list, jid]));
                localStorage.setItem(`zapflow_unread_${sessionId}`, JSON.stringify(updated));
            } catch {}
        }
        toast.success(currentlyUnread ? "Conversa marcada como lida" : "Conversa marcada como não lida");
        try {
            await fetch(`/api/chat/${sessionId}/${encodeURIComponent(jid)}/read`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ markRead: nextStatus })
            });
        } catch {}
    }, [sessionId]);

    // Toggle Pin / Unpin (Unlimited)
    const handleTogglePin = useCallback((jid: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        setPinnedJids(prev => {
            let next: string[];
            const isCurrentlyPinned = prev.includes(jid);
            if (isCurrentlyPinned) {
                next = prev.filter(id => id !== jid);
                toast.success("Conversa desafixada");
            } else {
                next = [jid, ...prev];
                toast.success(`Conversa fixada no topo (${next.length} fixadas)`);
            }
            if (typeof window !== "undefined") {
                try {
                    localStorage.setItem(`zapflow_pinned_${sessionId}`, JSON.stringify(next));
                } catch {}
            }
            return next;
        });
    }, [sessionId]);

    // Toggle Archive / Unarchive (#C14)
    const handleToggleArchive = useCallback((jid: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        setArchivedJids(prev => {
            let next: string[];
            const isCurrentlyArchived = prev.includes(jid);
            if (isCurrentlyArchived) {
                next = prev.filter(id => id !== jid);
                toast.success("Conversa desarquivada");
            } else {
                next = [jid, ...prev];
                toast.success("Conversa arquivada");
            }
            if (typeof window !== "undefined") {
                try {
                    localStorage.setItem(`zapflow_archived_${sessionId}`, JSON.stringify(next));
                } catch {}
            }
            return next;
        });
    }, [sessionId]);

    // Toggle Mute / Unmute per Chat (#C26)
    const handleToggleMute = useCallback((jid: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        setMutedJids(prev => {
            const isCurrentlyMuted = prev.includes(jid);
            const next = isCurrentlyMuted ? prev.filter(id => id !== jid) : [...prev, jid];
            if (typeof window !== "undefined") {
                try {
                    localStorage.setItem(`zapflow_muted_${sessionId}`, JSON.stringify(next));
                    window.dispatchEvent(new CustomEvent("zapflow:mute-changed", {
                        detail: { jid, muted: !isCurrentlyMuted }
                    }));
                } catch {}
            }
            const isGroup = jid.endsWith("@g.us");
            toast.success(isCurrentlyMuted ? (isGroup ? "🔔 Notificações do grupo ativadas" : "🔔 Notificações da conversa ativadas") : (isGroup ? "🔇 Notificações do grupo silenciadas" : "🔇 Notificações da conversa silenciadas"));
            return next;
        });
    }, [sessionId]);

    // Initial and pagination fetch
    const fetchChats = useCallback(async (cursor?: string, append = false) => {
        if (fetchingRef.current) return;
        fetchingRef.current = true;
        try {
            if (!cursor && chatsRef.current.length === 0) setLoading(true);
            const rawChats: any = await getChatsStatus(sessionId, PAGE_SIZE, cursor || undefined);

            const processChats = (newChatsList: ChatContact[], existingChatsList: ChatContact[] = []) => {
                let manualUnreadSet = new Set<string>();
                if (typeof window !== "undefined") {
                    try {
                        const raw = localStorage.getItem(`zapflow_unread_${sessionId}`);
                        if (raw) {
                            const parsed = JSON.parse(raw);
                            if (Array.isArray(parsed)) manualUnreadSet = new Set(parsed);
                        }
                    } catch {}
                }
                const merged = new Map(existingChatsList.map(c => [c.jid, c]));
                (newChatsList || []).forEach((c: any) => {
                    const existing = merged.get(c.jid);
                    const forcedUnread = manualUnreadSet.has(c.jid) ? 1 : 0;
                    if (!existing) {
                        merged.set(c.jid, { ...c, unreadCount: Math.max(c.unreadCount || 0, forcedUnread) });
                    } else {
                        const newTs = c.lastMessage?.timestamp ? new Date(c.lastMessage.timestamp).getTime() : 0;
                        const oldTs = existing.lastMessage?.timestamp ? new Date(existing.lastMessage.timestamp).getTime() : 0;
                        merged.set(c.jid, {
                            ...existing,
                            ...c,
                            name: c.name || existing.name,
                            notify: c.notify || existing.notify,
                            profilePic: c.profilePic || existing.profilePic,
                            unreadCount: Math.max(existing.unreadCount || 0, forcedUnread),
                            lastMessage: newTs >= oldTs ? (c.lastMessage || existing.lastMessage) : existing.lastMessage
                        });
                    }
                });
                return Array.from(merged.values());
            };

            if (append) {
                setChats(prev => {
                    const next = processChats(rawChats, prev);
                    savePersistedChatList(sessionId, next);
                    return next;
                });
            } else {
                setChats(prev => {
                    const next = processChats(rawChats, prev);
                    savePersistedChatList(sessionId, next);
                    return next;
                });
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
        const persisted = loadPersistedChatList(sessionId);
        if (persisted.length > 0) {
            setChats(persisted);
            setLoading(false);
        } else {
            setChats([]);
        }
        setHasMore(true);
        fetchChats();
    }, [fetchChats, sessionId]);

    // Real-time socket message update + status checkmarks + typing presence
    useEffect(() => {
        const socket = getSocket();
        if (!socket) return;
        const onConnect = () => joinSession(sessionId);
        if (socket.connected) joinSession(sessionId);
        socket.on("connect", onConnect);

        const handler = async (newMessages: any[]) => {
            let needsReload = false;
            let shouldPlaySound = false;

            setChats(prev => {
                const updated = [...prev];
                newMessages.forEach(msg => {
                    const jid = msg.remoteJid;
                    if (!jid || jid === "status@broadcast") return;

                    const isNewKey = msg.keyId ? !seenIncomingKeysRef.current.has(msg.keyId) : true;
                    if (msg.keyId) seenIncomingKeysRef.current.add(msg.keyId);

                    const isIncomingFromOther = !msg.fromMe && jid !== selectedJidRef.current;
                    if (isIncomingFromOther && isNewKey) {
                        if (!mutedJidsRef.current.includes(jid)) {
                            shouldPlaySound = true;
                        }
                        // Automatically unarchive chat if a new message arrives (#C14)
                        setArchivedJids(prevArch => {
                            if (!prevArch.includes(jid)) return prevArch;
                            const nextArch = prevArch.filter(id => id !== jid);
                            try {
                                localStorage.setItem(`zapflow_archived_${sessionId}`, JSON.stringify(nextArch));
                            } catch {}
                            return nextArch;
                        });
                    }

                    // Clear typing indicator for this chat when message arrives
                    setPresenceMap(p => {
                        if (!p[jid]) return p;
                        const copy = { ...p };
                        delete copy[jid];
                        return copy;
                    });

                    const idx = updated.findIndex(c => c.jid === jid);
                    if (idx !== -1) {
                        const currentUnread = updated[idx].unreadCount || 0;
                        updated[idx] = {
                            ...updated[idx],
                            name: updated[idx].name || (!msg.fromMe && !jid.endsWith("@g.us") ? msg.pushName : null) || updated[idx].name,
                            unreadCount: isIncomingFromOther && isNewKey
                                ? currentUnread + 1
                                : (jid === selectedJidRef.current ? 0 : currentUnread),
                            lastMessage: {
                                keyId: msg.keyId,
                                content: msg.content,
                                timestamp: msg.timestamp,
                                type: msg.type,
                                fromMe: Boolean(msg.fromMe),
                                status: msg.status || (msg.fromMe ? "SENT" : "PENDING")
                            }
                        };
                    } else {
                        // Add brand new chat immediately to top of list in 0ms!
                        updated.unshift({
                            jid,
                            name: !msg.fromMe ? (msg.pushName || jid.split("@")[0]) : jid.split("@")[0],
                            notify: !msg.fromMe ? (msg.pushName || null) : null,
                            profilePic: null,
                            unreadCount: isIncomingFromOther ? 1 : 0,
                            lastMessage: {
                                keyId: msg.keyId,
                                content: msg.content,
                                timestamp: msg.timestamp,
                                type: msg.type,
                                fromMe: Boolean(msg.fromMe),
                                status: msg.status || (msg.fromMe ? "SENT" : "PENDING")
                            }
                        });
                        needsReload = true;
                    }
                });

                updated.sort((a, b) => {
                    const tA = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0;
                    const tB = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0;
                    return tB - tA;
                });

                savePersistedChatList(sessionId, updated);
                return updated;
            });

            if (shouldPlaySound && !soundMutedRef.current) {
                playWhatsAppIncomingSound();
            }
            if (needsReload) fetchChats();
        };

        const statusHandler = (data: { keyId: string; remoteJid?: string; status: string }) => {
            if (!data?.status) return;
            setChats(prev => {
                let changed = false;
                const next = prev.map(c => {
                    if (
                        (data.remoteJid && c.jid === data.remoteJid && c.lastMessage?.fromMe) ||
                        (data.keyId && c.lastMessage?.keyId === data.keyId)
                    ) {
                        changed = true;
                        return {
                            ...c,
                            lastMessage: c.lastMessage ? { ...c.lastMessage, status: data.status } : c.lastMessage
                        };
                    }
                    return c;
                });
                if (changed) savePersistedChatList(sessionId, next);
                return changed ? next : prev;
            });
        };

        const presenceHandler = (data: { id: string; presences: Record<string, { lastKnownPresence?: string }> }) => {
            if (!data?.id || !data?.presences) return;
            const chatJid = data.id.endsWith("@c.us") ? data.id.replace("@c.us", "@s.whatsapp.net") : data.id;
            for (const [, p] of Object.entries(data.presences)) {
                const st = p?.lastKnownPresence;
                if (st === "composing" || st === "recording") {
                    setPresenceMap(prev => ({ ...prev, [chatJid]: { status: st } }));
                    if (presenceTimersRef.current[chatJid]) clearTimeout(presenceTimersRef.current[chatJid]);
                    presenceTimersRef.current[chatJid] = setTimeout(() => {
                        setPresenceMap(prev => {
                            const copy = { ...prev };
                            delete copy[chatJid];
                            return copy;
                        });
                    }, 4000);
                    return;
                } else if (st === "paused" || st === "unavailable") {
                    setPresenceMap(prev => {
                        if (!prev[chatJid]) return prev;
                        const copy = { ...prev };
                        delete copy[chatJid];
                        return copy;
                    });
                }
            }
        };

        socket.on("message.update", handler);
        socket.on("message.status", statusHandler);
        socket.on("presence.update", presenceHandler);
        return () => {
            socket.off("connect", onConnect);
            socket.off("message.update", handler);
            socket.off("message.status", statusHandler);
            socket.off("presence.update", presenceHandler);
        };
    }, [sessionId, getSocket, joinSession, fetchChats]);

    // Instantly update sidebar when a message is sent locally (0ms optimistic)
    useEffect(() => {
        const handleLocalSent = (e: Event) => {
            const { jid: sentJid, content, timestamp, type = "TEXT", keyId } = (e as CustomEvent).detail;
            setChats(prev => {
                const idx = prev.findIndex(c => c.jid === sentJid);
                const updated = [...prev];
                if (idx !== -1) {
                    updated[idx] = {
                        ...updated[idx],
                        unreadCount: 0,
                        lastMessage: {
                            keyId,
                            content,
                            timestamp,
                            type,
                            fromMe: true,
                            status: "PENDING"
                        }
                    };
                    const [chatItem] = updated.splice(idx, 1);
                    const next = [chatItem, ...updated];
                    savePersistedChatList(sessionId, next);
                    return next;
                } else {
                    const next: ChatContact[] = [
                        {
                            jid: sentJid,
                            name: sentJid.split("@")[0],
                            notify: null,
                            profilePic: null,
                            unreadCount: 0,
                            lastMessage: {
                                keyId,
                                content,
                                timestamp,
                                type,
                                fromMe: true,
                                status: "PENDING"
                            }
                        },
                        ...updated
                    ];
                    savePersistedChatList(sessionId, next);
                    return next;
                }
            });
        };
        window.addEventListener("zapflow:local-message-sent", handleLocalSent);
        return () => window.removeEventListener("zapflow:local-message-sent", handleLocalSent);
    }, [sessionId]);

    // Fetch labels & chat label assignments with real-time sync
    const reloadLabelsAndAssignments = useCallback(async () => {
        if (!sessionId) return;
        try {
            const [labelRes, chatLabelsRes] = await Promise.all([
                fetch(`/api/labels/${sessionId}`),
                fetch(`/api/labels/${sessionId}/chats`)
            ]);
            if (labelRes.ok) {
                const lData = await labelRes.json();
                setAvailableLabels(lData.data?.labels || []);
            }
            if (chatLabelsRes.ok) {
                const cData = await chatLabelsRes.json();
                const map = new Map<string, { labelId: string; name: string; colorHex: string }[]>();
                for (const cl of (cData.data || [])) {
                    const jid = cl.chatJid;
                    if (!map.has(jid)) map.set(jid, []);
                    map.get(jid)!.push({ labelId: cl.labelId, name: cl.labelName, colorHex: cl.colorHex });
                }
                setChatLabelMap(map);
            }
        } catch (e) {
            console.error("Failed to load label assignments", e);
        }
    }, [sessionId]);

    useEffect(() => {
        reloadLabelsAndAssignments();
        const handler = () => reloadLabelsAndAssignments();
        window.addEventListener("zapflow:labels-changed", handler);
        return () => window.removeEventListener("zapflow:labels-changed", handler);
    }, [reloadLabelsAndAssignments]);

    // ─── INSTANT SEARCH & SORTING (0ms delay, no skeleton wipe, unlimited pinning) ───
    const archivedSet = useMemo(() => new Set(archivedJids), [archivedJids]);
    const mutedSet = useMemo(() => new Set(mutedJids), [mutedJids]);
    const totalUnreadCount = useMemo(() => chats.filter(c => !archivedSet.has(c.jid) && (c.unreadCount || 0) > 0).length, [chats, archivedSet]);
    const totalGroupsCount = useMemo(() => chats.filter(c => !archivedSet.has(c.jid) && c.jid.endsWith("@g.us")).length, [chats, archivedSet]);
    const unreadGroupsCount = useMemo(() => chats.filter(c => !archivedSet.has(c.jid) && c.jid.endsWith("@g.us") && (c.unreadCount || 0) > 0).length, [chats, archivedSet]);
    const totalContactsCount = useMemo(() => chats.filter(c => !archivedSet.has(c.jid) && !c.jid.endsWith("@g.us")).length, [chats, archivedSet]);
    const unreadContactsCount = useMemo(() => chats.filter(c => !archivedSet.has(c.jid) && !c.jid.endsWith("@g.us") && (c.unreadCount || 0) > 0).length, [chats, archivedSet]);

    // Atualiza o título da aba do navegador dinamicamente com o contador de não lidas
    useEffect(() => {
        if (typeof document === "undefined") return;
        const baseTitle = "BarraSoftware";
        if (totalUnreadCount > 0) {
            document.title = `(${totalUnreadCount}) ${baseTitle}`;
        } else {
            document.title = baseTitle;
        }
    }, [totalUnreadCount]);

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

            // Append matching contacts from address book
            if (extraContacts.length > 0) {
                const existingJids = new Set(list.map(c => c.jid));
                const toAdd = extraContacts.filter(c => !existingJids.has(c.jid));
                list = [...list, ...toAdd];
            }
        } else if (filterType === "archived") {
            list = list.filter(c => archivedSet.has(c.jid));
        } else {
            // Exclude archived chats from normal views unless searching
            list = list.filter(c => !archivedSet.has(c.jid));

            if (filterType === "all" && !selectedLabelId) {
                list = [...list].sort((a, b) => {
                    const tA = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : (a.jid.endsWith("@g.us") ? 1 : 0);
                    const tB = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : (b.jid.endsWith("@g.us") ? 1 : 0);
                    if (tB !== tA) return tB - tA;
                    return (a.name || a.jid).localeCompare(b.name || b.jid);
                });
            }
        }

        // 2. Filter buttons: Tudo, Contatos, Grupos, Fixados, Arquivadas, Etiquetas
        if (selectedLabelId) {
            list = list.filter(c => chatLabelMap.get(c.jid)?.some(l => l.labelId === selectedLabelId));
        }

        if (filterType === "unread") {
            list = list.filter(c => (c.unreadCount || 0) > 0);
        } else if (filterType === "contacts") {
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

        pinnedJids.forEach(pjid => {
            const item = list.find(c => c.jid === pjid);
            if (item) pinnedList.push(item);
        });

        list.forEach(c => {
            if (!pinnedSet.has(c.jid)) {
                unpinnedList.push(c);
            }
        });

        return [...pinnedList, ...unpinnedList];
    }, [chats, searchInput, extraContacts, filterType, pinnedJids, archivedSet, selectedLabelId, chatLabelMap]);

    // Keyboard shortcuts listeners (Ctrl+Shift+F to search, Alt+Up/Down to navigate chats)
    useEffect(() => {
        const handleFocusSearch = () => {
            searchInputRef.current?.focus();
            searchInputRef.current?.select();
        };

        const handleNavChat = (e: Event) => {
            const customEvent = e as CustomEvent<{ direction: number }>;
            const direction = customEvent.detail?.direction || 1;
            if (filteredAndSortedChats.length === 0) return;
            const currentIndex = filteredAndSortedChats.findIndex(c => c.jid === selectedJid);
            let nextIndex = currentIndex + direction;
            if (nextIndex < 0) nextIndex = filteredAndSortedChats.length - 1;
            if (nextIndex >= filteredAndSortedChats.length) nextIndex = 0;
            const targetChat = filteredAndSortedChats[nextIndex];
            if (targetChat) handleSelectAndClearUnread(targetChat.jid, getDisplayName(targetChat), targetChat.profilePic);
        };

        window.addEventListener("zapflow:focus-search", handleFocusSearch);
        window.addEventListener("zapflow:nav-chat", handleNavChat as EventListener);
        return () => {
            window.removeEventListener("zapflow:focus-search", handleFocusSearch);
            window.removeEventListener("zapflow:nav-chat", handleNavChat as EventListener);
        };
    }, [filteredAndSortedChats, selectedJid, handleSelectAndClearUnread]);

    const handleEndReached = useCallback(() => {
        if (hasMore && !loading && !searchInput.trim()) {
            const withMsgs = chatsRef.current.filter(c => !!c.lastMessage?.timestamp);
            const last = withMsgs[withMsgs.length - 1];
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
                isArchived={archivedSet.has(chat.jid)}
                isMuted={mutedSet.has(chat.jid)}
                draftText={draftMap[chat.jid]}
                presence={presenceMap[chat.jid]}
                onSelect={handleSelectAndClearUnread}
                onTogglePin={handleTogglePin}
                onToggleArchive={handleToggleArchive}
                onToggleMute={handleToggleMute}
                onToggleRead={handleToggleRead}
                sessionId={sessionId}
                labelDots={chatLabelMap.get(chat.jid) || []}
            />
        ),
        [selectedJid, pinnedJids, archivedSet, mutedSet, draftMap, presenceMap, handleSelectAndClearUnread, handleTogglePin, handleToggleArchive, handleToggleMute, handleToggleRead, sessionId, chatLabelMap]
    );

    const handleStartNewChat = () => {
        if (!newChatNumber) return;
        let clean = newChatNumber.replace(/\D/g, '');
        if (clean.startsWith('0')) clean = '55' + clean.substring(1);
        handleSelectAndClearUnread(`${clean}@s.whatsapp.net`);
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
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            title={soundMuted ? "Ativar som de novas mensagens" : "Silenciar som de novas mensagens"}
                            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10"
                            onClick={toggleMuteSound}
                        >
                            {soundMuted ? <VolumeX className="h-4 w-4 text-amber-500" /> : <Volume2 className="h-4 w-4 text-[#00a884]" />}
                        </Button>
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
                </div>

                {/* Instant Search Bar with Clear Button */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#667781] dark:text-[#8696a0]" />
                    <Input
                        ref={searchInputRef}
                        placeholder="Pesquisar conversa, grupo ou contato..."
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

{/* Search scope tabs: Conversas vs Mensagens */}
                {searchInput.trim().length >= 2 && (
                    <div className="flex items-center gap-1.5 pt-1 animate-in fade-in duration-150">
                        <button
                            type="button"
                            onClick={() => setSearchTab("chats")}
                            className={cn(
                                "px-2.5 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer",
                                searchTab === "chats"
                                    ? "bg-[#00a884] text-white shadow-xs"
                                    : "bg-muted/70 text-muted-foreground hover:text-foreground"
                            )}
                        >
                            Conversas ({filteredAndSortedChats.length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setSearchTab("messages")}
                            className={cn(
                                "px-2.5 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer flex items-center gap-1.5",
                                searchTab === "messages"
                                    ? "bg-[#00a884] text-white shadow-xs"
                                    : "bg-muted/70 text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <span>Mensagens ({matchingMessages.length})</span>
                            {isSearchingMessages && <Loader2 className="h-3 w-3 animate-spin text-current" />}
                        </button>
                    </div>
                )}

                                {/* Quick Filters: Tudo, Não lidas, Contatos, Grupos, Fixados, Arquivadas, Etiquetas */}
                <div className="flex items-center gap-1.5 pt-0.5 overflow-x-auto no-scrollbar">
                    <button
                        onClick={() => { setFilterType("all"); setSelectedLabelId(null); }}
                        className={cn(
                            "px-3 py-1 rounded-full text-xs font-medium transition-colors shrink-0 cursor-pointer",
                            filterType === "all" && !selectedLabelId
                                ? "bg-[#00a884] text-white"
                                : "bg-muted/70 hover:bg-muted text-muted-foreground"
                        )}
                    >
                        Tudo
                    </button>
                    <button
                        onClick={() => { setFilterType("unread"); setSelectedLabelId(null); }}
                        className={cn(
                            "px-3 py-1 rounded-full text-xs font-medium transition-colors shrink-0 flex items-center gap-1.5 cursor-pointer",
                            filterType === "unread" && !selectedLabelId
                                ? "bg-[#00a884] text-white"
                                : "bg-muted/70 hover:bg-muted text-muted-foreground"
                        )}
                    >
                        <span>Não lidas</span>
                        {totalUnreadCount > 0 && (
                            <span className={cn(
                                "px-1.5 py-0.2 rounded-full text-[10px] font-bold tabular-nums",
                                filterType === "unread" && !selectedLabelId ? "bg-white text-[#00a884]" : "bg-[#25d366] text-white"
                            )}>
                                {totalUnreadCount}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => { setFilterType("contacts"); setSelectedLabelId(null); }}
                        className={cn(
                            "px-3 py-1 rounded-full text-xs font-medium transition-colors shrink-0 flex items-center gap-1 cursor-pointer",
                            filterType === "contacts" && !selectedLabelId
                                ? "bg-[#00a884] text-white"
                                : "bg-muted/70 hover:bg-muted text-muted-foreground"
                        )}
                    >
                        <User className="h-3 w-3" />
                        <span>Contatos</span>
                        {unreadContactsCount > 0 ? (
                            <span className={cn(
                                "px-1.5 py-0.2 rounded-full text-[10px] font-bold tabular-nums",
                                filterType === "contacts" && !selectedLabelId ? "bg-white text-[#00a884]" : "bg-[#25d366] text-white"
                            )}>
                                {unreadContactsCount}
                            </span>
                        ) : totalContactsCount > 0 ? (
                            <span className="text-[10px] opacity-80">({totalContactsCount})</span>
                        ) : null}
                    </button>
                    <button
                        onClick={() => { setFilterType("groups"); setSelectedLabelId(null); }}
                        className={cn(
                            "px-3 py-1 rounded-full text-xs font-medium transition-colors shrink-0 flex items-center gap-1 cursor-pointer",
                            filterType === "groups" && !selectedLabelId
                                ? "bg-[#00a884] text-white"
                                : "bg-muted/70 hover:bg-muted text-muted-foreground"
                        )}
                    >
                        <Users className="h-3 w-3" />
                        <span>Grupos</span>
                        {unreadGroupsCount > 0 ? (
                            <span className={cn(
                                "px-1.5 py-0.2 rounded-full text-[10px] font-bold tabular-nums",
                                filterType === "groups" && !selectedLabelId ? "bg-white text-[#00a884]" : "bg-[#25d366] text-white"
                            )}>
                                {unreadGroupsCount}
                            </span>
                        ) : totalGroupsCount > 0 ? (
                            <span className="text-[10px] opacity-80">({totalGroupsCount})</span>
                        ) : null}
                    </button>
                    
                    {archivedJids.length > 0 && (
                        <button
                            onClick={() => { setFilterType("archived"); setSelectedLabelId(null); }}
                            className={cn(
                                "px-3 py-1 rounded-full text-xs font-medium transition-colors shrink-0 flex items-center gap-1 cursor-pointer",
                                filterType === "archived" && !selectedLabelId
                                    ? "bg-[#00a884] text-white"
                                    : "bg-muted/70 hover:bg-muted text-muted-foreground"
                            )}
                        >
                            <Archive className="h-3 w-3" />
                            Arquivadas ({archivedJids.length})
                        </button>
                    )}

                    
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

            {/* Matching Messages List (Global Search) */}
            {searchTab === "messages" && searchInput.trim().length >= 2 ? (
                <div className="flex-1 overflow-y-auto divide-y divide-border/10 styled-scrollbar bg-background">
                    {matchingMessages.length === 0 ? (
                        <div className="py-16 px-4 text-center">
                            {isSearchingMessages ? (
                                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin text-[#00a884]" />
                                    Buscando em mensagens...
                                </div>
                            ) : (
                                <p className="text-xs text-muted-foreground">
                                    Nenhuma mensagem contendo "{searchInput}" encontrada.
                                </p>
                            )}
                        </div>
                    ) : (
                        matchingMessages.map((msg) => (
                            <div
                                key={msg.id}
                                onClick={() => {
                                    handleSelectAndClearUnread(msg.jid, msg.contactName, msg.profilePic);
                                    window.dispatchEvent(new CustomEvent("zapflow:scroll-to-message", {
                                        detail: { keyId: msg.keyId, jid: msg.jid }
                                    }));
                                }}
                                className="p-3 hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] cursor-pointer transition-colors flex items-start gap-3 select-none"
                            >
                                <Avatar className="h-10 w-10 shrink-0 mt-0.5">
                                    <AvatarImage src={msg.profilePic || undefined} />
                                    <AvatarFallback className="bg-[#00a884]/20 text-[#00a884] font-semibold text-xs">
                                        {msg.contactName.slice(0, 2).toUpperCase()}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-1 mb-1">
                                        <span className="text-xs font-semibold text-foreground truncate">
                                            {msg.contactName}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground shrink-0">
                                            {getTimeLabel(msg.timestamp)}
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                                        {msg.fromMe && <span className="font-medium text-[#00a884]">Você: </span>}
                                        {msg.content}
                                    </p>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            ) : null}

            {/* Virtualized Chat List */}
            <div className={cn("flex-1 min-h-0 bg-background", searchTab === "messages" && searchInput.trim().length >= 2 && "hidden")}>
                {filteredAndSortedChats.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                        <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
                            {selectedLabelId ? <Skeleton className="h-6 w-6 rounded-full animate-pulse" /> : <Skeleton className="h-6 w-6 rounded-full animate-pulse" />}
                        </div>
                        <p className="text-sm font-medium text-foreground">
                            {selectedLabelId ? "Nenhuma conversa com esta etiqueta" : "Nenhuma conversa encontrada"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                            {selectedLabelId
                                ? "Atribua esta etiqueta a contatos para visualizá-los aqui."
                                : searchInput ? `Nenhum resultado para "${searchInput}"` : "Nenhuma conversa disponível"}
                        </p>
                        {selectedLabelId && (
                            <Button variant="ghost" size="sm" className="mt-3 text-xs text-[#00a884]" onClick={() => setSelectedLabelId(null)}>
                                Limpar filtro de etiqueta
                            </Button>
                        )}
                        {searchInput && !selectedLabelId && (
                            <Button variant="ghost" size="sm" className="mt-3 text-xs text-[#00a884]" onClick={() => setSearchInput("")}>
                                Limpar busca
                            </Button>
                        )}
                    </div>
                ) : (
                    <Virtuoso
                        style={{ height: "100%" }}
                        className="styled-scrollbar"
                        data={filteredAndSortedChats}
                        computeItemKey={(_: number, chat: ChatContact) => chat.jid}
                        itemContent={itemContent}
                        endReached={handleEndReached}
                        increaseViewportBy={400}
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

            {/* Manage Labels Modal */}
            <ManageLabelsModal
                sessionId={sessionId}
                isOpen={isManageLabelsOpen}
                onClose={() => setIsManageLabelsOpen(false)}
            />
        </div>
    );
}
