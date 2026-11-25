"use client";
import { formatPhoneNumber } from "@/lib/phone";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    MessageSquarePlus,
    ArrowLeft,
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
    ArchiveRestore,
    Star,
    ChevronLeft,
    ChevronRight
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
    phone?: string | null;
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

const PAGE_SIZE = 120;

function playWhatsAppIncomingSound() {
    try {
        if (typeof window !== "undefined" && localStorage.getItem("zapflow_chat_muted") === "1") {
            return;
        }
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

function isRawLidString(s?: string | null): boolean {
    if (!s) return false;
    const clean = s.split('@')[0].replace(/\D/g, "");
    return s.endsWith("@lid") || (clean.length >= 14 && clean.length <= 16 && !clean.startsWith("55"));
}

function getDisplayName(chat: ChatContact): string {
    if (chat.name && chat.name.trim() && !chat.name.endsWith("@lid") && !chat.name.endsWith("@s.whatsapp.net") && !isRawLidString(chat.name)) {
        return chat.name;
    }
    if (chat.notify && chat.notify.trim() && !chat.notify.endsWith("@lid") && !chat.notify.endsWith("@s.whatsapp.net") && !isRawLidString(chat.notify)) {
        return chat.notify;
    }
    const phoneToFormat = chat.phone || (isRawLidString(chat.jid) ? "" : chat.jid);
    if (!phoneToFormat) return "Contato WhatsApp";
    return formatPhoneNumber(phoneToFormat);
}

function normalizeSearch(text: string): string {
    return (text || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

const FLAG_EMOJI_REGEX = /([\u{1F1E6}-\u{1F1FF}]{2})/gu;

function renderFlagsInText(text: string): React.ReactNode {
    if (!text) return text;
    const parts = text.split(FLAG_EMOJI_REGEX);
    if (parts.length === 1) return text;
    return parts.map((part, idx) => {
        if (idx % 2 === 1 && part.length >= 2) {
            const cps = Array.from(part).map(ch => ch.codePointAt(0)?.toString(16)).filter(Boolean);
            if (cps.length === 2) {
                return (
                    <img
                        key={`flag-${idx}-${cps.join("-")}`}
                        src={`https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${cps[0]}-${cps[1]}.svg`}
                        alt={part}
                        className="inline-block h-[1.1em] w-[1.1em] align-[-0.18em] mx-[1px] select-none"
                        draggable={false}
                    />
                );
            }
        }
        return part;
    });
}

function highlightSearch(text: string, query?: string): React.ReactNode {
    if (!text || !query || !query.trim()) return renderFlagsInText(text);
    const cleanQ = normalizeSearch(query);
    if (!cleanQ) return renderFlagsInText(text);

    const normText = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const idx = normText.indexOf(cleanQ);
    if (idx === -1) return renderFlagsInText(text);

    const parts: React.ReactNode[] = [];
    let lastIdx = 0;
    let currIdx = normText.indexOf(cleanQ, lastIdx);

    while (currIdx !== -1) {
        if (currIdx > lastIdx) {
            parts.push(renderFlagsInText(text.slice(lastIdx, currIdx)));
        }
        const matchEnd = currIdx + cleanQ.length;
        parts.push(
            <mark key={currIdx} className="bg-[#00a884]/25 text-[#00a884] dark:bg-[#00a884]/40 dark:text-[#25d366] font-semibold rounded-xs px-0.5">
                {renderFlagsInText(text.slice(currIdx, matchEnd))}
            </mark>
        );
        lastIdx = matchEnd;
        currIdx = normText.indexOf(cleanQ, lastIdx);
    }

    if (lastIdx < text.length) {
        parts.push(renderFlagsInText(text.slice(lastIdx)));
    }

    return parts;
}

function getMessagePreview(chat: ChatContact): { text: string; isMedia: boolean; type?: string } {
    if (!chat.lastMessage) {
        if (chat.jid.endsWith("@g.us")) {
            return { text: "Grupo do WhatsApp", isMedia: false };
        }
        return { text: "Contato da agenda", isMedia: false };
    }
    const rawType = (chat.lastMessage.type || "TEXT").toUpperCase();
    const rawContent = (chat.lastMessage.content || "").trim();
    const isBracketPlaceholder = /^\[(image|video|audio|document|sticker|location|contact|poll|viewonce)\]$/i.test(rawContent);
    const cleanCaption = isBracketPlaceholder ? "" : rawContent;

    if (rawType !== "TEXT") {
        const types: Record<string, string> = {
            IMAGE: cleanCaption || "Foto",
            VIDEO: cleanCaption || "Vídeo",
            AUDIO: "Mensagem de voz",
            DOCUMENT: cleanCaption || "Documento",
            STICKER: "💟 Figurinha",
            LOCATION: cleanCaption ? `📍 ${cleanCaption.split("|")[1] || "Localização"}` : "📍 Localização",
            CONTACT: cleanCaption ? `👤 ${cleanCaption.split("|")[0]}` : "👤 Contato",
            POLL: cleanCaption ? `📊 ${cleanCaption.split("|")[0]}` : "📊 Enquete"
        };
        const label = types[rawType] || cleanCaption || "Mídia";
        return {
            text: label.length > 45 ? label.slice(0, 45) + "…" : label,
            isMedia: true,
            type: rawType
        };
    }
    if (!cleanCaption) {
        return { text: "Mensagem", isMedia: false };
    }
    return { text: cleanCaption.length > 45 ? cleanCaption.slice(0, 45) + "…" : cleanCaption, isMedia: false };
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
    isFavorite: boolean;
    isArchived: boolean;
    isMuted: boolean;
    unreadCount?: number;
}

function ChatContextMenu({
    state,
    onClose,
    onSelect,
    onTogglePin,
    onToggleFavorite,
    onToggleArchive,
    onToggleMute,
    onToggleRead
}: {
    state: CtxMenuState;
    onClose: () => void;
    onSelect: (jid: string, name?: string, profilePic?: string | null) => void;
    onMouseEnter?: () => void;
    onTogglePin: (jid: string) => void;
    onToggleFavorite: (jid: string) => void;
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
            label: state.isFavorite ? "Remover dos Favoritos" : "Adicionar aos Favoritos",
            icon: Star,
            action: () => { onToggleFavorite(state.jid); onClose(); }
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
    isFavorite,
    isArchived,
    isMuted,
    isOnline,
    hasStory,
    onOpenStory,
    draftText,
    presence,
    onSelect,
    onTogglePin,
    onToggleFavorite,
    onToggleArchive,
    onToggleMute,
    onToggleRead,
    sessionId,
    labelDots,
    searchQuery
}: {
    chat: ChatContact;
    isSelected: boolean;
    isPinned: boolean;
    isFavorite: boolean;
    isArchived: boolean;
    isMuted: boolean;
    isOnline?: boolean;
    hasStory?: boolean;
    onOpenStory?: () => void;
    draftText?: string;
    presence?: { status: "composing" | "recording" };
    onSelect: (jid: string, name?: string, profilePic?: string | null) => void;
    onTogglePin: (jid: string, e?: React.MouseEvent) => void;
    onToggleFavorite: (jid: string, e?: React.MouseEvent) => void;
    onToggleArchive: (jid: string, e?: React.MouseEvent) => void;
    onToggleMute: (jid: string, e?: React.MouseEvent) => void;
    onToggleRead: (jid: string, isUnread: boolean) => void;
    sessionId: string;
    labelDots: { colorHex: string; name?: string }[];
    searchQuery?: string;
}) {
    const displayName = getDisplayName(chat);
    const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
    const isGroup = chat.jid.endsWith("@g.us");
    const preview = getMessagePreview(chat);
    const unreadCount = chat.unreadCount || 0;
    const hasMention = isGroup && unreadCount > 0 && Boolean(chat.lastMessage?.content && /@\d{8,}|@[A-Za-z]+/.test(chat.lastMessage.content));

    return (
        <>
            {ctxMenu && (
                <ChatContextMenu
                    state={ctxMenu}
                    onClose={() => setCtxMenu(null)}
                    onSelect={onSelect}
                    onTogglePin={onTogglePin}
                    onToggleFavorite={onToggleFavorite}
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
                        isFavorite,
                        isArchived,
                        isMuted,
                        unreadCount: chat.unreadCount
                    });
                }}
            >
                {/* Avatar with WhatsApp group/user style, green Status ring & online dot */}
                <div
                    className="relative flex-shrink-0"
                    onClick={(e) => {
                        if (hasStory && onOpenStory) {
                            e.stopPropagation();
                            onOpenStory();
                        }
                    }}
                    title={hasStory ? "Clique para ver o Status (Story) deste contato" : undefined}
                >
                    <Avatar className={cn(
                        "h-11 w-11",
                        hasStory && "ring-2 ring-[#25d366] ring-offset-2 ring-offset-background cursor-pointer"
                    )}>
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
                    {!isGroup && (isOnline || presence) && (
                        <span
                            className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-[#25d366] ring-2 ring-background shadow-xs"
                            title="Online agora"
                        />
                    )}
                </div>

                {/* Info & Message preview */}
                <div className="flex-1 min-w-0 overflow-hidden pr-0.5">
                    {/* Line 1: Name + Time */}
                    <div className="flex justify-between items-baseline gap-2 overflow-hidden">
                        <h4 className={cn(
                            "text-[15px] truncate flex items-center gap-1.5 leading-snug flex-1 min-w-0",
                            unreadCount > 0 ? "font-bold text-foreground" : isSelected ? "font-semibold text-foreground" : "font-medium text-foreground"
                        )} title={displayName}>
                            {displayName}
                            {isFavorite && (
                                <span title="Favorito" className="inline-flex shrink-0">
                                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                                </span>
                            )}
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
                                <span className="text-[#667781] dark:text-[#8696a0] truncate">{renderFlagsInText(draftText)}</span>
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
                                <span className="truncate">{renderFlagsInText(preview.text)}</span>
                            </p>
                        )}

                        <div className="flex items-center gap-1 shrink-0">
                            {/* WhatsApp @ Mention Badge */}
                            {hasMention && (
                                <span
                                    className="h-5 w-5 rounded-full bg-[#25d366]/20 text-[#00a884] dark:text-[#25d366] text-[11px] font-extrabold flex items-center justify-center shrink-0"
                                    title="Menção no grupo"
                                >
                                    @
                                </span>
                            )}
                            {/* WhatsApp Green Unread Counter Badge */}
                            {unreadCount > 0 && (
                                <span className={cn(
                                    "min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center tabular-nums shadow-xs",
                                    isMuted
                                        ? "bg-[#8696a0] dark:bg-[#374248] text-white dark:text-[#aebac1]"
                                        : "bg-[#25d366] text-white"
                                )}>
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

    const sanitizeList = (arr: ChatContact[]): ChatContact[] => {
        // Collect known phone numbers in the list
        const phoneJids = new Set<string>();
        for (const c of arr) {
            if (c?.jid && c.jid.endsWith("@s.whatsapp.net")) {
                phoneJids.add(c.jid);
                if (c.phone) phoneJids.add(`${c.phone}@s.whatsapp.net`);
            }
        }

        return arr.filter((c: any) => {
            if (!c?.jid || c.jid === "status@broadcast" || c.jid.endsWith("@broadcast")) return false;
            if (c.jid.endsWith("@lid")) {
                // If an @s.whatsapp.net counterpart exists, drop the duplicate @lid
                if (c.phone && phoneJids.has(`${c.phone}@s.whatsapp.net`)) return false;
                // If name is raw LID digits matching the JID, drop it if an alternative exists
                const bare = c.jid.split('@')[0];
                if ((!c.name || c.name === bare) && phoneJids.has(`${c.phone || bare}@s.whatsapp.net`)) return false;
                // If it is an orphan LID with no name and no message, drop it
                if (!c.name && !c.notify && !c.lastMessage?.content) return false;
            }
            return true;
        });
    };

    const inMem = globalChatListCache.get(sessionId);
    if (inMem && inMem.length > 0) return sanitizeList(inMem);
    if (typeof window === "undefined") return [];
    try {
        const raw = localStorage.getItem(`zapflow_chatlist_v2_${sessionId}`);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                const cleaned = sanitizeList(parsed);
                globalChatListCache.set(sessionId, cleaned);
                return cleaned;
            }
        }
    } catch {}
    return [];
}

let persistChatListTimer: any = null;

function savePersistedChatList(sessionId: string, list: ChatContact[]) {
    if (!sessionId) return;
    globalChatListCache.set(sessionId, list);
    if (typeof window === "undefined") return;
    if (persistChatListTimer) clearTimeout(persistChatListTimer);
    persistChatListTimer = setTimeout(() => {
        try {
            localStorage.setItem(`zapflow_chatlist_v2_${sessionId}`, JSON.stringify(list.slice(0, 450)));
        } catch {}
    }, 400);
}

// ─── Main ChatList Component ─────────
export function ChatList({ sessionId, onSelectChat, selectedJid }: ChatListProps) {
    const initialCached = useMemo(() => loadPersistedChatList(sessionId), [sessionId]);
    const [chats, setChats] = useState<ChatContact[]>(initialCached);
    const [loading, setLoading] = useState(initialCached.length === 0);
    const [searchInput, setSearchInput] = useState("");
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    const [filterType, setFilterType] = useState<"all" | "unread" | "favorites" | "contacts" | "groups" | "pinned" | "archived">("all");
    const [isNewChatOpen, setIsNewChatOpen] = useState(false);
    const [newChatNumber, setNewChatNumber] = useState("");
    const [hasMore, setHasMore] = useState(true);
    const [soundMuted, setSoundMuted] = useState(false);

    // Status / Story (24h) & Call Auto-Reject states
    const [storyText, setStoryText] = useState("");
    const [storyBg, setStoryBg] = useState("#00a884");
    const [isPostingStory, setIsPostingStory] = useState(false);
    const [storiesList, setStoriesList] = useState<Array<{
        jid: string;
        name: string;
        profilePic: string | null;
        fromMe: boolean;
        items: Array<{ keyId: string; type: string; content: string | null; mediaUrl: string | null; timestamp: string }>;
    }>>([]);
    const [activeStoryGroupIdx, setActiveStoryGroupIdx] = useState<number | null>(null);
    const [activeStoryItemIdx, setActiveStoryItemIdx] = useState(0);
    const [rejectCalls, setRejectCalls] = useState(false);
    const [rejectCallMessage, setRejectCallMessage] = useState("Olá! No momento não atendemos ligações por aqui. Por favor, envie uma mensagem de texto ou áudio que já te respondemos!");
    const [isSavingCallCfg, setIsSavingCallCfg] = useState(false);

    const fetchStories = useCallback(async () => {
        if (!sessionId) return;
        try {
            const res = await fetch(`/api/profile/${sessionId}/story`);
            if (!res.ok) return;
            const json = await res.json();
            if (json?.status && Array.isArray(json.data)) {
                setStoriesList(json.data);
            }
        } catch {}
    }, [sessionId]);

    useEffect(() => {
        if (!sessionId) return;
        fetch(`/api/sessions/${sessionId}/settings`)
            .then(r => (r.ok ? r.json() : null))
            .then(json => {
                const cfg = json?.data?.config || {};
                if (typeof cfg.rejectCalls === "boolean") setRejectCalls(cfg.rejectCalls);
                if (typeof cfg.rejectCallMessage === "string" && cfg.rejectCallMessage) setRejectCallMessage(cfg.rejectCallMessage);
            })
            .catch(() => {});
        fetchStories();
    }, [sessionId, fetchStories]);

    // Live presence map per JID ("composing" | "recording") and Online map
    const [presenceMap, setPresenceMap] = useState<Record<string, { status: "composing" | "recording" }>>({});
    const [onlineMap, setOnlineMap] = useState<Record<string, boolean>>({});
    const presenceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    // Track seen incoming keyIds so two-phase instant + media socket updates only increment unreadCount once
    const seenIncomingKeysRef = useRef<Set<string>>(new Set());

    // Unlimited pinned chats (persisted per sessionId in localStorage)
    const [pinnedJids, setPinnedJids] = useState<string[]>([]);
    // Favorite chats
    const [favoriteJids, setFavoriteJids] = useState<string[]>([]);
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
        senderName?: string | null;
        profilePic?: string | null;
    }>>([]);
    const [isSearchingMessages, setIsSearchingMessages] = useState(false);
    const [searchTab, setSearchTab] = useState<"all" | "chats" | "messages">("all");
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
            const storedFavs = localStorage.getItem(`zapflow_fav_chats_${sessionId}`);
            if (storedFavs) {
                const parsed = JSON.parse(storedFavs);
                if (Array.isArray(parsed)) setFavoriteJids(parsed);
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

    // Automatically prefetch top 3 most recent chats into cache for instantaneous opening
    useEffect(() => {
        if (!sessionId || chats.length === 0) return;
        const timer = setTimeout(() => {
            const topChats = chats.filter(c => !!c.lastMessage).slice(0, 3);
            topChats.forEach((c, idx) => {
                setTimeout(() => prefetchChatMessages(sessionId, c.jid), idx * 250);
            });
        }, 500);
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
            setSearchTab("all");
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
        }, 350);

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

    // Toggle Favorite / Unfavorite
    const handleToggleFavorite = useCallback((jid: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        setFavoriteJids(prev => {
            const exists = prev.includes(jid);
            const next = exists ? prev.filter(id => id !== jid) : [jid, ...prev];
            if (typeof window !== "undefined") {
                try {
                    localStorage.setItem(`zapflow_fav_chats_${sessionId}`, JSON.stringify(next));
                } catch {}
            }
            toast.success(exists ? "Removida dos Favoritos" : "⭐ Conversa adicionada aos Favoritos!");
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
                const merged = new Map(
                    existingChatsList
                        .filter(c => c.jid !== "status@broadcast" && !c.jid?.endsWith("@broadcast"))
                        .map(c => [c.jid, c])
                );
                (newChatsList || []).forEach((c: any) => {
                    if (!c?.jid || c.jid === "status@broadcast" || c.jid.endsWith("@broadcast")) return;
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

                // Deduplicate any @lid chat that corresponds to a known phone chat
                const phoneToJid = new Map<string, string>();
                merged.forEach((chat, jid) => {
                    if (jid.endsWith("@s.whatsapp.net")) {
                        phoneToJid.set(jid.split("@")[0], jid);
                    }
                    if (chat.phone) {
                        phoneToJid.set(chat.phone, jid.endsWith("@s.whatsapp.net") ? jid : (phoneToJid.get(chat.phone) || jid));
                    }
                });

                merged.forEach((chat, jid) => {
                    if (jid.endsWith("@lid")) {
                        const bare = jid.split("@")[0];
                        const phoneChatJid = (chat.phone && phoneToJid.get(chat.phone)) || (bare && phoneToJid.get(bare));
                        if (phoneChatJid && phoneChatJid !== jid) {
                            const mainChat = merged.get(phoneChatJid);
                            if (mainChat) {
                                const lidTs = chat.lastMessage?.timestamp ? new Date(chat.lastMessage.timestamp).getTime() : 0;
                                const mainTs = mainChat.lastMessage?.timestamp ? new Date(mainChat.lastMessage.timestamp).getTime() : 0;
                                merged.set(phoneChatJid, {
                                    ...mainChat,
                                    unreadCount: Math.max(mainChat.unreadCount || 0, chat.unreadCount || 0),
                                    lastMessage: lidTs > mainTs ? chat.lastMessage : mainChat.lastMessage
                                });
                            }
                            merged.delete(jid);
                        }
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
                    const rawJid = (msg.remoteJid || (msg as any).jid || "").trim();
                    if (!rawJid || rawJid === "status@broadcast") return;
                    const jid = rawJid;

                    const norm = (j?: string | null) => (j || "").replace("@c.us", "@s.whatsapp.net").toLowerCase();
                    const msgJid = norm(rawJid);
                    const isMsgGroup = msgJid.endsWith("@g.us");
                    const bareMsgNum = isMsgGroup ? "" : msgJid.split("@")[0].replace(/\D/g, "");

                    const selectedNorm = norm(selectedJidRef.current);
                    const isCurrentChat = (selectedNorm === msgJid) || (!isMsgGroup && !selectedNorm.endsWith("@g.us") && bareMsgNum && bareMsgNum === selectedNorm.split("@")[0].replace(/\D/g, ""));
                    if (!jid || jid === "status@broadcast") return;

                    const isNewKey = msg.keyId ? !seenIncomingKeysRef.current.has(msg.keyId) : true;
                    if (msg.keyId) seenIncomingKeysRef.current.add(msg.keyId);

                    const isIncomingFromOther = !msg.fromMe && !isCurrentChat;
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

                    const idx = updated.findIndex(c => {
                        const cNorm = norm(c.jid);
                        if (cNorm === msgJid) return true;
                        if (!isMsgGroup && !cNorm.endsWith("@g.us") && bareMsgNum) {
                            const bareCNum = cNorm.split("@")[0].replace(/\D/g, "");
                            return bareCNum === bareMsgNum;
                        }
                        return false;
                    });
                    if (idx !== -1) {
                        const currentUnread = updated[idx].unreadCount || 0;
                        updated[idx] = {
                            ...updated[idx],
                            name: updated[idx].name || (!msg.fromMe && !isMsgGroup ? msg.pushName : null) || updated[idx].name,
                            unreadCount: isIncomingFromOther && isNewKey
                                ? currentUnread + 1
                                : (isCurrentChat ? 0 : currentUnread),
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
                            name: isMsgGroup ? `Grupo (${rawJid.split("@")[0]})` : (!msg.fromMe ? (msg.pushName || rawJid.split("@")[0]) : rawJid.split("@")[0]),
                            notify: !msg.fromMe && !isMsgGroup ? (msg.pushName || null) : null,
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

        const statusRank: Record<string, number> = { FAILED: 0, PENDING: 1, SENT: 2, DELIVERED: 3, READ: 4 };
        const statusHandler = (data: { keyId: string; remoteJid?: string; status: string }) => {
            if (!data?.status) return;
            setChats(prev => {
                let changed = false;
                const next = prev.map(c => {
                    const matchesLastMsg =
                        (data.keyId && c.lastMessage?.keyId === data.keyId) ||
                        (!data.keyId && data.remoteJid && c.jid === data.remoteJid && c.lastMessage?.fromMe);
                    const currentRank = statusRank[c.lastMessage?.status || "PENDING"] ?? 0;
                    const nextRank = statusRank[data.status] ?? 0;
                    if (matchesLastMsg && nextRank > currentRank) {
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

        const presenceHandler = (data: { id: string; altJids?: string[]; presences: Record<string, { lastKnownPresence?: string }> }) => {
            if (!data?.id || !data?.presences) return;
            const chatJid = data.id.endsWith("@c.us") ? data.id.replace("@c.us", "@s.whatsapp.net") : data.id;
            const bareId = chatJid.split("@")[0];
            const allKeys = [chatJid, ...(bareId ? [bareId] : []), ...(data.altJids || [])];
            for (const [, p] of Object.entries(data.presences)) {
                const st = p?.lastKnownPresence;
                if (st === "available" || st === "composing" || st === "recording" || st === "paused") {
                    setOnlineMap(prev => {
                        const next = { ...prev };
                        for (const k of allKeys) {
                            if (k) {
                                next[k] = true;
                                const b = k.split("@")[0];
                                if (b) next[b] = true;
                            }
                        }
                        return next;
                    });
                } else if (st === "unavailable") {
                    setOnlineMap(prev => {
                        const next = { ...prev };
                        for (const k of allKeys) {
                            if (k) {
                                delete next[k];
                                const b = k.split("@")[0];
                                if (b) delete next[b];
                            }
                        }
                        return next;
                    });
                }

                if (st === "composing" || st === "recording") {
                    setPresenceMap(prev => ({
                        ...prev,
                        [chatJid]: { status: st },
                        ...(bareId ? { [bareId]: { status: st } } : {})
                    }));
                    if (presenceTimersRef.current[chatJid]) clearTimeout(presenceTimersRef.current[chatJid]);
                    presenceTimersRef.current[chatJid] = setTimeout(() => {
                        setPresenceMap(prev => {
                            const copy = { ...prev };
                            delete copy[chatJid];
                            if (bareId) delete copy[bareId];
                            return copy;
                        });
                    }, 4000);
                    return;
                } else if (st === "paused" || st === "unavailable") {
                    setPresenceMap(prev => {
                        if (!prev[chatJid] && (!bareId || !prev[bareId])) return prev;
                        const copy = { ...prev };
                        delete copy[chatJid];
                        if (bareId) delete copy[bareId];
                        return copy;
                    });
                }
            }
        };

        socket.on("message.update", handler);
        socket.on("message.status", statusHandler);
        socket.on("presence.update", presenceHandler);
        const onChatsUpdate = () => { fetchChats(); };
        socket.on("chats.update", onChatsUpdate);
        return () => {
            socket.off("connect", onConnect);
            socket.off("message.update", handler);
            socket.off("message.status", statusHandler);
            socket.off("presence.update", presenceHandler);
            socket.off("chats.update", onChatsUpdate);
        };
    }, [sessionId, getSocket, joinSession, fetchChats]);

    // Instantly update sidebar when a message is sent locally (0ms optimistic)
    useEffect(() => {
        const handleLocalSent = (e: Event) => {
            const { jid: sentJid, content, timestamp, type = "TEXT", keyId } = (e as CustomEvent).detail;
            setChats(prev => {
                let idx = prev.findIndex(c => c.jid === sentJid);
                if (idx === -1 && sentJid.endsWith("@lid")) {
                    // Try to find matching phone chat if known
                    const bare = sentJid.split("@")[0];
                    idx = prev.findIndex(c => c.jid.includes(bare) || (c.phone && sentJid.includes(c.phone)));
                }

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
                    const isLid = sentJid.endsWith("@lid");
                    const rawDigits = sentJid.split("@")[0].replace(/\D/g, "");
                    const isLidDigits = isLid || (rawDigits.length >= 14 && rawDigits.length <= 16 && !rawDigits.startsWith("55"));

                    const next: ChatContact[] = [
                        {
                            jid: sentJid,
                            name: isLidDigits ? null : formatPhoneNumber(sentJid.split("@")[0]),
                            notify: null,
                            profilePic: null,
                            unreadCount: 0,
                            phone: isLidDigits ? null : sentJid.split("@")[0],
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
        const baseTitle = "ZapFlow";
        if (totalUnreadCount > 0) {
            document.title = `(${totalUnreadCount}) ${baseTitle}`;
        } else {
            document.title = baseTitle;
        }
    }, [totalUnreadCount]);

    const filteredAndSortedChats = useMemo(() => {
        let list = chats;

        // 1. Instant text search (immediate 0ms response on every keystroke)
        const cleanQ = normalizeSearch(searchInput);
        if (cleanQ) {
            const digits = searchInput.replace(/\D/g, "");
            const isNumericQuery = digits.length >= 3 && !/[a-zA-Z]/.test(searchInput);
            list = list.filter(chat => {
                const normName = normalizeSearch(chat.name || "");
                const normNotify = normalizeSearch(chat.notify || "");
                const jidDigits = chat.jid.replace(/\D/g, "");
                const phoneDigits = (chat.phone || "").replace(/\D/g, "");

                const matchName = normName.includes(cleanQ) || normNotify.includes(cleanQ);
                const matchDigits = isNumericQuery && (
                    jidDigits.includes(digits) ||
                    phoneDigits.includes(digits) ||
                    (chat.name && chat.name.replace(/\D/g, "").includes(digits))
                );
                const matchJid = chat.jid.toLowerCase().includes(cleanQ);

                return matchName || matchDigits || matchJid;
            });

            // Append matching contacts from address book
            if (extraContacts.length > 0) {
                const existingJids = new Set(list.map(c => c.jid));
                const toAdd = extraContacts.filter(c => !existingJids.has(c.jid));
                list = [...list, ...toAdd];
            }

            // Rank search results by relevance (exact/startsWith name > includes name > phone/JID)
            const getRelevanceScore = (chat: ChatContact) => {
                const n1 = normalizeSearch(chat.name || "");
                const n2 = normalizeSearch(chat.notify || "");
                if (n1 === cleanQ || n2 === cleanQ) return 0;
                if (n1.startsWith(cleanQ) || n2.startsWith(cleanQ)) return 1;
                if (n1.includes(cleanQ) || n2.includes(cleanQ)) return 2;
                return 3;
            };

            list = [...list].sort((a, b) => {
                const scoreDiff = getRelevanceScore(a) - getRelevanceScore(b);
                if (scoreDiff !== 0) return scoreDiff;
                const tA = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0;
                const tB = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0;
                if (tB !== tA) return tB - tA;
                return (a.name || a.notify || a.jid).localeCompare(b.name || b.notify || b.jid, "pt-BR");
            });
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
        } else if (filterType === "favorites") {
            const favSet = new Set(favoriteJids);
            list = list.filter(c => favSet.has(c.jid));
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
    }, [chats, searchInput, extraContacts, filterType, pinnedJids, favoriteJids, archivedSet, selectedLabelId, chatLabelMap]);

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
        (_: number, chat: ChatContact) => {
            const bareJid = chat.jid.split("@")[0];
            const isOnline = Boolean(
                onlineMap[chat.jid] ||
                (bareJid && onlineMap[bareJid]) ||
                (chat.phone && (onlineMap[chat.phone] || onlineMap[`${chat.phone}@s.whatsapp.net`]))
            );
            const storyIdx = storiesList.findIndex(
                s => !s.fromMe && (s.jid === chat.jid || s.jid.split("@")[0] === bareJid || (chat.phone && s.jid.includes(chat.phone)))
            );
            return (
                <ChatRow
                    key={chat.jid}
                    chat={chat}
                    isSelected={selectedJid === chat.jid}
                    isPinned={pinnedJids.includes(chat.jid)}
                    isFavorite={favoriteJids.includes(chat.jid)}
                    isArchived={archivedSet.has(chat.jid)}
                    isMuted={mutedSet.has(chat.jid)}
                    isOnline={isOnline}
                    hasStory={storyIdx !== -1}
                    onOpenStory={storyIdx !== -1 ? () => { setActiveStoryGroupIdx(storyIdx); setActiveStoryItemIdx(0); } : undefined}
                    draftText={draftMap[chat.jid]}
                    presence={presenceMap[chat.jid] || presenceMap[bareJid] || (chat.phone ? presenceMap[chat.phone] || presenceMap[`${chat.phone}@s.whatsapp.net`] : undefined)}
                    onSelect={handleSelectAndClearUnread}
                    onTogglePin={handleTogglePin}
                    onToggleFavorite={handleToggleFavorite}
                    onToggleArchive={handleToggleArchive}
                    onToggleMute={handleToggleMute}
                    onToggleRead={handleToggleRead}
                    sessionId={sessionId}
                    labelDots={chatLabelMap.get(chat.jid) || []}
                    searchQuery={searchInput.trim()}
                />
            );
        },
        [selectedJid, pinnedJids, favoriteJids, archivedSet, mutedSet, onlineMap, storiesList, draftMap, presenceMap, handleSelectAndClearUnread, handleTogglePin, handleToggleFavorite, handleToggleArchive, handleToggleMute, handleToggleRead, sessionId, chatLabelMap, searchInput]
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
                {/* WhatsApp Web Style Syncing Banner */}
                <div className="shrink-0 px-3.5 py-3 border-b border-border/15 bg-[#f0f2f5] dark:bg-[#202c33] flex items-center justify-between">
                    <h3 className="font-semibold text-lg text-foreground tracking-tight">Conversas</h3>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#00a884]" />
                        <span>Sincronizando...</span>
                    </div>
                </div>
                <div className="px-3.5 py-2.5 bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-medium flex items-center gap-2.5">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">Baixando mensagens recentes...</p>
                        <p className="text-[11px] opacity-80 truncate">Mantenha seu celular conectado à internet</p>
                    </div>
                </div>
                <div className="p-3 space-y-3 flex-1 overflow-hidden">
                    <Skeleton className="h-10 w-full rounded-xl" />
                    {[1, 2, 3, 4, 5, 6, 7].map(i => <SkeletonRow key={i} />)}
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
                        {/* Publicar no Status / Stories (24h) */}
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Publicar no Status (Stories 24h)"
                                    className="h-8 w-8 rounded-full text-muted-foreground hover:text-[#00a884] hover:bg-black/5 dark:hover:bg-white/10"
                                >
                                    <span className="h-4 w-4 rounded-full border-2 border-dashed border-[#00a884] flex items-center justify-center">
                                        <span className="h-1.5 w-1.5 rounded-full bg-[#00a884]" />
                                    </span>
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-72 p-3 rounded-2xl shadow-2xl space-y-2.5">
                                <div className="text-xs font-semibold text-foreground flex items-center justify-between">
                                    <span>📸 Publicar no Status (24h)</span>
                                </div>
                                <textarea
                                    rows={3}
                                    value={storyText}
                                    onChange={(e) => setStoryText(e.target.value)}
                                    placeholder="Digite uma frase ou aviso para o seu Status..."
                                    style={{ backgroundColor: storyBg }}
                                    className="w-full rounded-xl p-3 text-white placeholder:text-white/70 text-xs font-semibold text-center outline-none resize-none shadow-inner"
                                />
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5">
                                        {["#00a884", "#0284c7", "#7c3aed", "#e11d48", "#d97706", "#111b21"].map(c => (
                                            <button
                                                key={c}
                                                type="button"
                                                onClick={() => setStoryBg(c)}
                                                className={cn("h-4 w-4 rounded-full border border-white/40 cursor-pointer", storyBg === c && "ring-2 ring-[#00a884] scale-110")}
                                                style={{ backgroundColor: c }}
                                            />
                                        ))}
                                    </div>
                                    <Button
                                        size="sm"
                                        disabled={!storyText.trim() || isPostingStory}
                                        className="h-7 px-3 text-[11px] bg-[#00a884] hover:bg-[#00a884]/90 text-white"
                                        onClick={async () => {
                                            if (!storyText.trim()) return;
                                            setIsPostingStory(true);
                                            try {
                                                const res = await fetch(`/api/profile/${sessionId}/story`, {
                                                    method: "POST",
                                                    headers: { "Content-Type": "application/json" },
                                                    body: JSON.stringify({ text: storyText.trim(), backgroundColor: storyBg })
                                                });
                                                const data = await res.json();
                                                if (res.ok && data.status) {
                                                    toast.success("📸 Status publicado no WhatsApp!");
                                                    setStoryText("");
                                                } else {
                                                    toast.error(data.error || "Falha ao publicar Status");
                                                }
                                            } catch {
                                                toast.error("Erro ao publicar Status");
                                            } finally {
                                                setIsPostingStory(false);
                                            }
                                        }}
                                    >
                                        {isPostingStory ? "Publicando..." : "Publicar Texto"}
                                    </Button>
                                </div>
                                <div className="pt-1.5 border-t border-border/20">
                                    <label className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-muted/60 hover:bg-muted text-[11px] font-medium text-foreground cursor-pointer transition-colors">
                                        <ImageIcon className="h-3.5 w-3.5 text-[#00a884]" />
                                        <span>Enviar Foto ou Vídeo para o Status</span>
                                        <input
                                            type="file"
                                            accept="image/*,video/*"
                                            className="hidden"
                                            onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                setIsPostingStory(true);
                                                try {
                                                    const fd = new FormData();
                                                    fd.append("file", file);
                                                    if (storyText.trim()) fd.append("caption", storyText.trim());
                                                    const res = await fetch(`/api/profile/${sessionId}/story`, {
                                                        method: "POST",
                                                        body: fd
                                                    });
                                                    const data = await res.json();
                                                    if (res.ok && data.status) {
                                                        toast.success("📸 Mídia publicada no Status do WhatsApp!");
                                                        setStoryText("");
                                                        fetchStories();
                                                    } else {
                                                        toast.error(data.error || "Falha ao enviar mídia ao Status");
                                                    }
                                                } catch {
                                                    toast.error("Erro ao enviar mídia ao Status");
                                                } finally {
                                                    setIsPostingStory(false);
                                                    e.target.value = "";
                                                }
                                            }}
                                        />
                                    </label>
                                </div>
                            </PopoverContent>
                        </Popover>

                        {/* Recusa Automática de Ligações */}
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Configurar recusa automática de ligações"
                                    className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10"
                                >
                                    <Settings className={cn("h-4 w-4", rejectCalls && "text-[#00a884]")} />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-72 p-3 rounded-2xl shadow-2xl space-y-2.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold text-foreground">📞 Recusar Ligações Auto</span>
                                    <input
                                        type="checkbox"
                                        checked={rejectCalls}
                                        onChange={(e) => setRejectCalls(e.target.checked)}
                                        className="h-4 w-4 accent-[#00a884] cursor-pointer"
                                    />
                                </div>
                                <p className="text-[11px] text-muted-foreground leading-snug">
                                    Recusa automaticamente chamadas de voz/vídeo e envia a mensagem abaixo:
                                </p>
                                <textarea
                                    rows={3}
                                    value={rejectCallMessage}
                                    onChange={(e) => setRejectCallMessage(e.target.value)}
                                    className="w-full rounded-xl bg-muted/50 border border-border/30 p-2 text-xs text-foreground outline-none focus:border-[#00a884] resize-none"
                                    placeholder="Mensagem automática ao recusar ligação..."
                                />
                                <Button
                                    size="sm"
                                    disabled={isSavingCallCfg}
                                    className="w-full h-7 text-xs bg-[#00a884] hover:bg-[#00a884]/90 text-white"
                                    onClick={async () => {
                                        setIsSavingCallCfg(true);
                                        try {
                                            const res = await fetch(`/api/sessions/${sessionId}/settings`, {
                                                method: "PATCH",
                                                headers: { "Content-Type": "application/json" },
                                                body: JSON.stringify({
                                                    config: {
                                                        rejectCalls,
                                                        rejectCallMessage: rejectCallMessage.trim()
                                                    }
                                                })
                                            });
                                            if (res.ok) {
                                                toast.success(rejectCalls ? "📞 Recusa automática de ligações ativada!" : "Recusa automática de ligações desativada");
                                            } else {
                                                toast.error("Falha ao salvar configuração");
                                            }
                                        } catch {
                                            toast.error("Erro ao salvar configuração");
                                        } finally {
                                            setIsSavingCallCfg(false);
                                        }
                                    }}
                                >
                                    {isSavingCallCfg ? "Salvando..." : "Salvar Configuração"}
                                </Button>
                            </PopoverContent>
                        </Popover>

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

                {/* WhatsApp Web Style Search Bar with Back Arrow */}
                <div className="relative">
                    {isSearchFocused || searchInput ? (
                        <button
                            type="button"
                            onClick={() => {
                                setSearchInput("");
                                setIsSearchFocused(false);
                                searchInputRef.current?.blur();
                            }}
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-[#00a884] hover:bg-black/5 dark:hover:bg-white/10 transition-transform active:scale-95 cursor-pointer z-10"
                            title="Fechar busca (Esc)"
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </button>
                    ) : (
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#667781] dark:text-[#8696a0] pointer-events-none" />
                    )}
                    <Input
                        ref={searchInputRef}
                        placeholder="Pesquisar ou começar uma nova conversa..."
                        value={searchInput}
                        onFocus={() => setIsSearchFocused(true)}
                        onBlur={() => !searchInput && setIsSearchFocused(false)}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Escape") {
                                setSearchInput("");
                                setIsSearchFocused(false);
                                searchInputRef.current?.blur();
                            }
                        }}
                        className="h-9 pl-9 pr-8 text-[13.5px] bg-white dark:bg-[#111b21] border border-border/20 rounded-lg focus-visible:ring-1 focus-visible:ring-[#00a884] placeholder:text-[#667781] dark:placeholder:text-[#8696a0]"
                    />
                    {searchInput && (
                        <button
                            onClick={() => {
                                setSearchInput("");
                                searchInputRef.current?.focus();
                            }}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                            title="Limpar busca"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>

{/* WhatsApp Web Search Tabs: Tudo, Conversas, Mensagens */}
                {searchInput.trim().length >= 2 ? (
                    <div className="flex items-center gap-1.5 pt-1 animate-in fade-in duration-150">
                        <button
                            type="button"
                            onClick={() => setSearchTab("all")}
                            className={cn(
                                "px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer",
                                searchTab === "all"
                                    ? "bg-[#00a884] text-white shadow-xs"
                                    : "bg-muted/70 text-muted-foreground hover:text-foreground"
                            )}
                        >
                            Tudo
                        </button>
                        <button
                            type="button"
                            onClick={() => setSearchTab("chats")}
                            className={cn(
                                "px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer",
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
                                "px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5",
                                searchTab === "messages"
                                    ? "bg-[#00a884] text-white shadow-xs"
                                    : "bg-muted/70 text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <span>Mensagens ({matchingMessages.length})</span>
                            {isSearchingMessages && <Loader2 className="h-3 w-3 animate-spin text-current" />}
                        </button>
                    </div>
                ) : null}

                                {/* Quick Filters: visible when NOT searching */}
                {searchInput.trim().length < 2 && (
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
                                filterType === "unread" && !selectedLabelId ? "bg-white dark:bg-[#111b21] text-[#00a884] dark:text-[#25d366]" : "bg-[#25d366] text-white"
                            )}>
                                {totalUnreadCount}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => { setFilterType("favorites"); setSelectedLabelId(null); }}
                        className={cn(
                            "px-3 py-1 rounded-full text-xs font-medium transition-colors shrink-0 flex items-center gap-1 cursor-pointer",
                            filterType === "favorites" && !selectedLabelId
                                ? "bg-[#00a884] text-white"
                                : "bg-muted/70 hover:bg-muted text-muted-foreground"
                        )}
                    >
                        <Star className={cn("h-3 w-3", filterType === "favorites" && !selectedLabelId ? "fill-white text-white" : "fill-amber-400 text-amber-400")} />
                        <span>Favoritas</span>
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
                        {unreadGroupsCount > 0 && (
                            <span className={cn(
                                "px-1.5 py-0.2 rounded-full text-[10px] font-bold tabular-nums",
                                filterType === "groups" && !selectedLabelId ? "bg-white dark:bg-[#111b21] text-[#00a884] dark:text-[#25d366]" : "bg-[#25d366] text-white"
                            )}>
                                {unreadGroupsCount}
                            </span>
                        )}
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
                )}

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

            {/* Unified Search View (WhatsApp Web style: Conversas + Mensagens) */}
            {searchTab === "all" && searchInput.trim().length >= 2 ? (
                <div className="flex-1 overflow-y-auto divide-y divide-border/10 styled-scrollbar bg-background">
                    {/* Section 1: Conversas */}
                    <div className="sticky top-0 z-10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#00a884] dark:text-[#25d366] bg-muted/70 dark:bg-[#111b21] backdrop-blur-xs border-b border-border/10 flex items-center justify-between">
                        <span>Conversas ({filteredAndSortedChats.length})</span>
                    </div>
                    {filteredAndSortedChats.length === 0 ? (
                        <div className="py-4 px-4 text-xs text-muted-foreground text-center">
                            Nenhuma conversa encontrada
                        </div>
                    ) : (
                        filteredAndSortedChats.map((chat) => (
                            <ChatRow
                                key={chat.jid}
                                chat={chat}
                                isSelected={selectedJid === chat.jid}
                                isPinned={pinnedJids.includes(chat.jid)}
                                isFavorite={favoriteJids.includes(chat.jid)}
                                isArchived={archivedSet.has(chat.jid)}
                                isMuted={mutedSet.has(chat.jid)}
                                isOnline={Boolean(onlineMap[chat.jid] || onlineMap[chat.jid.split("@")[0]])}
                                draftText={draftMap[chat.jid]}
                                presence={presenceMap[chat.jid]}
                                onSelect={handleSelectAndClearUnread}
                                onTogglePin={handleTogglePin}
                                onToggleFavorite={handleToggleFavorite}
                                onToggleArchive={handleToggleArchive}
                                onToggleMute={handleToggleMute}
                                onToggleRead={handleToggleRead}
                                sessionId={sessionId}
                                labelDots={chatLabelMap.get(chat.jid) || []}
                                searchQuery={searchInput.trim()}
                            />
                        ))
                    )}

                    {/* Section 2: Mensagens */}
                    <div className="sticky top-0 z-10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#00a884] dark:text-[#25d366] bg-muted/70 dark:bg-[#111b21] backdrop-blur-xs border-b border-border/10 flex items-center justify-between">
                        <span>Mensagens ({matchingMessages.length})</span>
                        {isSearchingMessages && <Loader2 className="h-3 w-3 animate-spin text-[#00a884]" />}
                    </div>
                    {matchingMessages.length === 0 ? (
                        <div className="py-8 px-4 text-xs text-muted-foreground text-center">
                            {isSearchingMessages ? (
                                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin text-[#00a884]" />
                                    Buscando em mensagens...
                                </div>
                            ) : (
                                <span>Nenhuma mensagem contendo "{searchInput}" encontrada</span>
                            )}
                        </div>
                    ) : (
                        matchingMessages.map((msg) => (
                            <div
                                key={msg.id}
                                onClick={() => {
                                    handleSelectAndClearUnread(msg.jid, msg.contactName, msg.profilePic);
                                    window.dispatchEvent(new CustomEvent("zapflow:scroll-to-message", {
                                        detail: { keyId: msg.keyId, jid: msg.jid, query: searchInput.trim() }
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
                                            {highlightSearch(msg.contactName, searchInput.trim())}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground shrink-0">
                                            {getTimeLabel(msg.timestamp)}
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                                        {msg.fromMe ? (
                                            <span className="font-medium text-[#00a884]">Você: </span>
                                        ) : msg.senderName ? (
                                            <span className="font-medium text-foreground/80">{msg.senderName}: </span>
                                        ) : null}
                                        {highlightSearch(msg.content, searchInput.trim())}
                                    </p>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            ) : null}

            {/* Matching Messages Tab Only */}
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
                                        detail: { keyId: msg.keyId, jid: msg.jid, query: searchInput.trim() }
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
                                            {highlightSearch(msg.contactName, searchInput.trim())}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground shrink-0">
                                            {getTimeLabel(msg.timestamp)}
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                                        {msg.fromMe ? (
                                            <span className="font-medium text-[#00a884]">Você: </span>
                                        ) : msg.senderName ? (
                                            <span className="font-medium text-foreground/80">{msg.senderName}: </span>
                                        ) : null}
                                        {highlightSearch(msg.content, searchInput.trim())}
                                    </p>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            ) : null}

            {/* Virtualized Chat List */}
            <div className={cn("flex-1 min-h-0 bg-background", (searchTab === "messages" || searchTab === "all") && searchInput.trim().length >= 2 && "hidden")}>
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

            {/* Full-Screen WhatsApp Web Status (Stories 24h) Viewer Modal */}
            {activeStoryGroupIdx !== null && storiesList[activeStoryGroupIdx] && (() => {
                const group = storiesList[activeStoryGroupIdx];
                const item = group.items[activeStoryItemIdx] || group.items[0];
                if (!item) return null;
                const goPrev = () => {
                    if (activeStoryItemIdx > 0) {
                        setActiveStoryItemIdx(activeStoryItemIdx - 1);
                    } else if (activeStoryGroupIdx > 0) {
                        const prevGroup = storiesList[activeStoryGroupIdx - 1];
                        setActiveStoryGroupIdx(activeStoryGroupIdx - 1);
                        setActiveStoryItemIdx(Math.max(0, prevGroup.items.length - 1));
                    }
                };
                const goNext = () => {
                    if (activeStoryItemIdx < group.items.length - 1) {
                        setActiveStoryItemIdx(activeStoryItemIdx + 1);
                    } else if (activeStoryGroupIdx < storiesList.length - 1) {
                        setActiveStoryGroupIdx(activeStoryGroupIdx + 1);
                        setActiveStoryItemIdx(0);
                    } else {
                        setActiveStoryGroupIdx(null);
                    }
                };
                return (
                    <div
                        className="fixed inset-0 z-[99999] bg-black/95 backdrop-blur-md flex flex-col items-center justify-between p-4 select-none animate-in fade-in duration-150"
                        onClick={() => setActiveStoryGroupIdx(null)}
                    >
                        {/* Top Progress Bars & Author Header */}
                        <div className="w-full max-w-lg flex flex-col gap-3 z-20" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-1.5">
                                {group.items.map((st, idx) => (
                                    <div key={st.keyId} className="h-1 flex-1 rounded-full bg-white/25 overflow-hidden">
                                        <div
                                            className={cn(
                                                "h-full rounded-full transition-all duration-300",
                                                idx <= activeStoryItemIdx ? "w-full bg-[#25d366]" : "w-0"
                                            )}
                                        />
                                    </div>
                                ))}
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2.5 text-white">
                                    <Avatar className="h-9 w-9 border border-white/30">
                                        <AvatarImage
                                            src={
                                                group.profilePic && group.profilePic.startsWith("http")
                                                    ? group.profilePic
                                                    : group.fromMe
                                                        ? undefined
                                                        : `/api/avatar/${sessionId}/${encodeURIComponent(group.jid)}`
                                            }
                                            referrerPolicy="no-referrer"
                                        />
                                        <AvatarFallback className="text-xs font-bold bg-[#00a884] text-white">
                                            {group.name.slice(0, 2).toUpperCase()}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div>
                                        <p className="text-sm font-semibold leading-tight">{group.name}</p>
                                        <p className="text-[11px] text-white/70">
                                            {new Date(item.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                                        </p>
                                    </div>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9 rounded-full text-white/80 hover:text-white hover:bg-white/10"
                                    onClick={() => setActiveStoryGroupIdx(null)}
                                >
                                    <X className="h-5 w-5" />
                                </Button>
                            </div>
                        </div>

                        {/* Story Content */}
                        <div className="relative flex-1 w-full max-w-lg flex items-center justify-center my-4" onClick={e => e.stopPropagation()}>
                            <button
                                type="button"
                                onClick={goPrev}
                                className="absolute left-2 z-20 h-10 w-10 rounded-full bg-black/50 hover:bg-black/80 text-white flex items-center justify-center cursor-pointer"
                            >
                                <ChevronLeft className="h-6 w-6" />
                            </button>

                            {item.type === "IMAGE" && item.mediaUrl ? (
                                <div className="flex flex-col items-center gap-3 max-h-[72vh]">
                                    <img src={item.mediaUrl} alt="Status" className="max-h-[65vh] max-w-full object-contain rounded-2xl shadow-2xl" />
                                    {item.content && <p className="text-white text-sm text-center bg-black/60 px-4 py-1.5 rounded-xl">{item.content}</p>}
                                </div>
                            ) : item.type === "VIDEO" && item.mediaUrl ? (
                                <div className="flex flex-col items-center gap-3 max-h-[72vh]">
                                    <video src={item.mediaUrl} controls autoPlay className="max-h-[65vh] max-w-full rounded-2xl shadow-2xl" />
                                    {item.content && <p className="text-white text-sm text-center bg-black/60 px-4 py-1.5 rounded-xl">{item.content}</p>}
                                </div>
                            ) : (
                                <div className="w-full h-[60vh] rounded-3xl bg-gradient-to-br from-[#00a884] to-[#0f172a] p-8 flex items-center justify-center text-center shadow-2xl">
                                    <p className="text-white text-xl sm:text-2xl font-bold leading-relaxed whitespace-pre-wrap break-words">
                                        {item.content || "Status"}
                                    </p>
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={goNext}
                                className="absolute right-2 z-20 h-10 w-10 rounded-full bg-black/50 hover:bg-black/80 text-white flex items-center justify-center cursor-pointer"
                            >
                                <ChevronRight className="h-6 w-6" />
                            </button>
                        </div>

                        <div className="text-xs text-white/60">
                            {activeStoryItemIdx + 1} de {group.items.length}
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
