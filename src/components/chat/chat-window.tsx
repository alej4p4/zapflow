"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
    Send,
    Paperclip,
    ArrowLeft,
    FileText,
    Image as ImageIcon,
    Camera,
    Music,
    Video,
    Download,
    ArrowDown,
    CornerUpLeft,
    Copy,
    Trash2,
    Info,
    X,
    Smile,
    Mic,
    MoreVertical,
    Search,
    Check,
    CheckCheck,
    Clock,
    Users
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { sendChatMessage, sendMediaMessage } from "@/app/dashboard/chat/actions";
import { useSocket } from "./socket-context";
import { chatCache, fetchOrGetChatMessages, type Message } from "./chat-cache";

interface ChatWindowProps {
    sessionId: string;
    jid: string;
    name?: string;
    profilePic?: string | null;
    onBack?: () => void;
}

const PAGE_LIMIT = 50;

function getParticipantColor(name: string): string {
    const colors = [
        "#00a884",
        "#1f7a8c",
        "#e542a3",
        "#e06d53",
        "#8338ec",
        "#3a86ff",
        "#028090",
        "#d97706",
        "#16a34a",
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
}

function MessageStatusCheck({ status }: { status: string }) {
    switch (status) {
        case "READ":
            return <CheckCheck className="h-3.5 w-3.5 text-[#53bdeb] inline-block shrink-0" />;
        case "DELIVERED":
            return <CheckCheck className="h-3.5 w-3.5 text-[#667781] dark:text-[#8696a0] inline-block shrink-0" />;
        case "SENT":
            return <Check className="h-3.5 w-3.5 text-[#667781] dark:text-[#8696a0] inline-block shrink-0" />;
        case "PENDING":
        default:
            return <Clock className="h-3 w-3 text-[#667781] dark:text-[#8696a0] inline-block shrink-0" />;
    }
}

// ─── Lazy media ────────
// ─── Helper for rendering text with links and @mentions ───
function renderMessageContent(content: string | null | undefined, contactMap?: Record<string, string>) {
    if (!content) return null;

    // Matches URLs or @(8 to 25 digits)
    const tokenRegex = /(https?:\/\/[^\s]+)|@(\d{8,25})/g;
    const parts: (string | React.ReactNode)[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(content)) !== null) {
        const matchIndex = match.index;
        if (matchIndex > lastIndex) {
            parts.push(content.substring(lastIndex, matchIndex));
        }

        if (match[1]) {
            const url = match[1];
            parts.push(
                <a
                    key={`url-${matchIndex}`}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#027eb5] dark:text-[#53bdeb] underline hover:opacity-80 break-all"
                    onClick={(e) => e.stopPropagation()}
                >
                    {url}
                </a>
            );
        } else if (match[2]) {
            const id = match[2];
            const resolvedName = contactMap ? (
                contactMap[id] ||
                contactMap[`${id}@lid`] ||
                contactMap[`${id}@s.whatsapp.net`]
            ) : null;
            const displayText = resolvedName ? `@${resolvedName}` : `@${id}`;

            parts.push(
                <span
                    key={`mention-${matchIndex}-${id}`}
                    className="font-medium text-[#00a884] dark:text-[#25d366] inline"
                    title={resolvedName ? `ID: ${id}` : undefined}
                >
                    {displayText}
                </span>
            );
        }

        lastIndex = matchIndex + match[0].length;
    }

    if (lastIndex < content.length) {
        parts.push(content.substring(lastIndex));
    }

    return parts;
}

// ─── Lazy media with fallback ──────────────────
function LazyMedia({ src, alt }: { src: string; alt: string }) {
    const ref = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { rootMargin: "200px" });
        obs.observe(el);
        return () => obs.disconnect();
    }, []);

    if (hasError) {
        return (
            <div ref={ref} className="mb-1.5 flex items-center gap-3 p-3 rounded-xl bg-black/5 dark:bg-white/5 border border-dashed border-border/50 text-xs text-muted-foreground select-none">
                <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <ImageIcon className="h-5 w-5 opacity-60 text-[#00a884]" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground text-xs">Imagem</p>
                    <p className="text-[11px] opacity-70 truncate">Mídia original não disponível no servidor</p>
                </div>
            </div>
        );
    }

    return (
        <div ref={ref} className="mb-1.5 overflow-hidden rounded-xl relative min-h-[120px] bg-muted/20 flex items-center justify-center">
            {visible ? (
                <>
                    {!loaded && <div className="absolute inset-0 bg-muted/30 rounded-xl animate-pulse" />}
                    <img
                        src={src}
                        alt={alt}
                        className={`max-w-full max-h-80 object-contain rounded-xl transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
                        onLoad={() => setLoaded(true)}
                        onError={() => setHasError(true)}
                        loading="lazy"
                    />
                </>
            ) : (
                <div className="h-36 w-full bg-muted/30 rounded-xl animate-pulse" />
            )}
        </div>
    );
}

function LazyVideo({ src }: { src: string }) {
    const ref = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { rootMargin: "200px" });
        obs.observe(el);
        return () => obs.disconnect();
    }, []);
    return (
        <div ref={ref} className="mb-1.5 overflow-hidden rounded-xl">
            {visible ? <video src={src} controls className="max-w-full max-h-64 rounded-xl" preload="none" />
                : <div className="h-32 bg-muted/30 rounded-xl animate-pulse flex items-center justify-center"><Video className="h-6 w-6 text-muted-foreground/50" /></div>}
        </div>
    );
}

function useDateLabel() {
    const cache = useRef(new Map<string, string>());
    return (timestamp: string): string => {
        const cached = cache.current.get(timestamp);
        if (cached) return cached;
        const date = new Date(timestamp);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
        let label: string;
        if (diffDays === 0) label = "Hoje";
        else if (diffDays === 1) label = "Ontem";
        else label = date.toLocaleDateString("pt-BR", { year: 'numeric', month: 'long', day: 'numeric' });
        cache.current.set(timestamp, label);
        return label;
    };
}

function handleDownload(url: string, fileName: string) {
    toast.info("Baixando...");
    fetch(url).then(res => { if (!res.ok) throw new Error(); return res.blob(); }).then(blob => {
        const dlUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = dlUrl; link.download = fileName;
        document.body.appendChild(link);
        link.click(); link.remove();
        window.URL.revokeObjectURL(dlUrl);
    }).catch(() => toast.error("Falha ao baixar o arquivo"));
}

// ─── Context Menu ──────────────────
interface ContextMenuState {
    x: number;
    y: number;
    msg: Message;
}

function ContextMenu({
    state,
    onClose,
    onReply,
    onDelete
}: {
    state: ContextMenuState;
    onClose: () => void;
    onReply: (msg: Message) => void;
    onDelete: (msg: Message) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [onClose]);

    const items = [
        { label: "Responder", icon: CornerUpLeft, action: () => { onReply(state.msg); onClose(); } },
        { label: "Copiar texto", icon: Copy, action: () => { navigator.clipboard.writeText(state.msg.content || "").then(() => toast.success("Copiado")).catch(() => {}); onClose(); } },
        { label: "Excluir", icon: Trash2, action: () => { onDelete(state.msg); onClose(); }, dangerous: true },
        { label: "Informações", icon: Info, action: () => { toast.info(`Status: ${state.msg.status}\nHorário: ${new Date(state.msg.timestamp).toLocaleString("pt-BR")}`); onClose(); } },
    ];

    const style: React.CSSProperties = { position: "fixed", top: state.y, left: state.x, zIndex: 9999 };
    if (typeof window !== "undefined") {
        if (state.x > window.innerWidth - 180) style.left = state.x - 180;
        if (state.y > window.innerHeight - 200) style.top = state.y - 180;
    }

    return (
        <div ref={ref} style={style} className="w-48 rounded-xl bg-popover/95 backdrop-blur-md border border-border/60 shadow-2xl py-1 animate-in fade-in zoom-in-95 origin-top-left">
            {items.map((item, i) => (
                <button
                    key={i}
                    onClick={item.action}
                    className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors cursor-pointer",
                        item.dangerous ? "text-red-500 hover:bg-red-500/10" : "text-foreground hover:bg-muted"
                    )}
                >
                    <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {item.label}
                </button>
            ))}
        </div>
    );
}


// ─── Isolated Chat Input Bar (Local state = 120 FPS typing with zero message re-renders) ───
function ChatInputBar({
    onSend,
    onUpload,
    replyingTo,
    onCancelReply,
    jid
}: {
    onSend: (text: string) => void;
    onUpload: (type: string) => void;
    replyingTo: Message | null;
    onCancelReply: () => void;
    jid: string;
}) {
    const [input, setInput] = useState("");
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Auto-focus when replying
    useEffect(() => {
        if (replyingTo && inputRef.current) {
            inputRef.current.focus();
        }
    }, [replyingTo]);

    // Focus on jid change
    useEffect(() => {
        inputRef.current?.focus();
    }, [jid]);

    const handleSend = () => {
        const text = input.trim();
        if (!text) return;
        setInput("");
        if (inputRef.current) {
            inputRef.current.style.height = "auto";
        }
        onSend(text);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="shrink-0 px-3.5 py-2.5 bg-[#f0f2f5] dark:bg-[#202c33] border-t border-border/15">
            {/* Reply preview bar */}
            {replyingTo && (
                <div className="mb-2 p-2 rounded-xl bg-white/80 dark:bg-[#111b21]/80 backdrop-blur-sm border-l-4 border-[#00a884] flex items-center justify-between text-xs animate-in slide-in-from-bottom-2 duration-150">
                    <div className="flex-1 truncate pr-2">
                        <span className="font-semibold text-[#00a884] block truncate">
                            Respondendo a {replyingTo.fromMe ? "Você" : (replyingTo.pushName || jid.split('@')[0])}
                        </span>
                        <span className="text-xs text-muted-foreground truncate block">
                            {replyingTo.content || `[${replyingTo.type}]`}
                        </span>
                    </div>
                    <button
                        onClick={onCancelReply}
                        className="p-1 text-muted-foreground hover:text-foreground rounded-full"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            <div className="flex items-end gap-2 max-w-4xl mx-auto">
                {/* Emoji Button */}
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 rounded-full shrink-0 text-[#54656f] dark:text-[#8696a0] hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10"
                    title="Emojis"
                >
                    <Smile className="h-5 w-5" />
                </Button>

                {/* Attachment Popover */}
                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 rounded-full shrink-0 text-[#54656f] dark:text-[#8696a0] hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10"
                            title="Anexar arquivo"
                        >
                            <Paperclip className="h-5 w-5" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-52 p-2 rounded-2xl bg-white dark:bg-[#233138] border border-border/40 shadow-xl" side="top" align="start">
                        <div className="flex flex-col gap-1">
                            <Button variant="ghost" size="sm" className="justify-start gap-3 h-9 text-xs rounded-xl" onClick={() => onUpload('image')}>
                                <span className="h-7 w-7 rounded-full bg-blue-500/15 text-blue-500 flex items-center justify-center">
                                    <ImageIcon className="h-4 w-4" />
                                </span>
                                Fotos e vídeos
                            </Button>
                            <Button variant="ghost" size="sm" className="justify-start gap-3 h-9 text-xs rounded-xl" onClick={() => onUpload('document')}>
                                <span className="h-7 w-7 rounded-full bg-purple-500/15 text-purple-500 flex items-center justify-center">
                                    <FileText className="h-4 w-4" />
                                </span>
                                Documento
                            </Button>
                            <Button variant="ghost" size="sm" className="justify-start gap-3 h-9 text-xs rounded-xl" onClick={() => onUpload('audio')}>
                                <span className="h-7 w-7 rounded-full bg-orange-500/15 text-orange-500 flex items-center justify-center">
                                    <Music className="h-4 w-4" />
                                </span>
                                Áudio
                            </Button>
                        </div>
                    </PopoverContent>
                </Popover>

                {/* Input Textarea capsule */}
                <div className="flex-1 min-w-0 bg-white dark:bg-[#2a3942] rounded-xl px-3.5 py-1.5 shadow-[0_1px_0.5px_rgba(11,20,26,0.1)] flex items-center">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => {
                            setInput(e.target.value);
                            const el = e.target;
                            el.style.height = "auto";
                            el.style.height = Math.min(el.scrollHeight, 120) + "px";
                        }}
                        onKeyDown={handleKeyDown}
                        placeholder="Digite uma mensagem..."
                        rows={1}
                        style={{ minHeight: "26px", maxHeight: "120px" }}
                        className="w-full resize-none bg-transparent text-[15px] text-[#111b21] dark:text-[#e9edef] placeholder-[#8696a0] focus:outline-none leading-relaxed py-1"
                    />
                </div>

                {/* WhatsApp Send Button */}
                {input.trim() ? (
                    <Button
                        onClick={handleSend}
                        size="icon"
                        className="h-10 w-10 rounded-full shrink-0 bg-[#00a884] hover:bg-[#00a884]/90 text-white shadow-sm transition-transform active:scale-95"
                        title="Enviar mensagem"
                    >
                        <Send className="h-4.5 w-4.5 translate-x-0.5" />
                    </Button>
                ) : (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 rounded-full shrink-0 text-[#54656f] dark:text-[#8696a0] hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={() => inputRef.current?.focus()}
                        title="Mensagem de voz"
                    >
                        <Mic className="h-5 w-5" />
                    </Button>
                )}
            </div>
        </div>
    );
}

// ─── Main Component ─────────────────
export function ChatWindow({ sessionId, jid, name, profilePic, onBack }: ChatWindowProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploadType, setUploadType] = useState<string>("image");
    const [isDragging, setIsDragging] = useState(false);
    const [loading, setLoading] = useState(true);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [contactMap, setContactMap] = useState<Record<string, string>>({});
    const [participantNames, setParticipantNames] = useState<string[]>([]);
    const [oldestTimestamp, setOldestTimestamp] = useState<string | null>(null);
    const [autoScroll, setAutoScroll] = useState(true);
    const [newMsgBadge, setNewMsgBadge] = useState(false);

    // Delete confirmation
    const [deleteConfirmMsg, setDeleteConfirmMsg] = useState<Message | null>(null);

    // Reply state
    const [replyingTo, setReplyingTo] = useState<Message | null>(null);

    // Context menu state
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

    const { getSocket, joinSession } = useSocket();
    const getDateLabel = useDateLabel();
    const isGroup = jid.endsWith("@g.us");

    const scrollToBottom = useCallback((smooth = true) => {
        bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
    }, []);

    const fetchMessages = useCallback(async (before?: string, silent = false) => {
        try {
            if (!before && !silent) setLoading(true);
            else if (before) setLoadingMore(true);

            const data = await fetchOrGetChatMessages(sessionId, jid, PAGE_LIMIT, before);
            if (data.contactMap && Object.keys(data.contactMap).length > 0) {
                setContactMap(prev => ({ ...prev, ...data.contactMap }));
            }
            if (data.participantNames && data.participantNames.length > 0) {
                setParticipantNames(data.participantNames);
            }
            if (!before) {
                setMessages(data.messages || []);
                setAutoScroll(true);
            } else if (data.messages?.length > 0) {
                setMessages(prev => [...(data.messages || []), ...prev]);
            }
            setHasMore(data.hasMore);
            if (data.messages?.length > 0) {
                setOldestTimestamp(data.messages[0].timestamp);
            }
        } catch (e) {
            console.error("Falha ao carregar mensagens", e);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [sessionId, jid]);

    // Instant switch with Stale-While-Revalidate memory cache
    useEffect(() => {
        const cacheKey = `${sessionId}:${jid}`;
        const cached = chatCache.get(cacheKey);

        if (cached && cached.messages.length > 0) {
            // INSTANT DISPLAY: Immediately show cached conversation in 0ms!
            setMessages(cached.messages);
            setHasMore(cached.hasMore);
            setOldestTimestamp(cached.oldestTimestamp);
            if (cached.contactMap) setContactMap(cached.contactMap);
            if (cached.participantNames) setParticipantNames(cached.participantNames);
            setLoading(false);
            setAutoScroll(true);
            // Silently check for fresh messages in background without wiping screen
            fetchMessages(undefined, true);
        } else {
            setMessages([]);
            setContactMap({});
            setParticipantNames([]);
            setOldestTimestamp(null);
            setHasMore(false);
            setLoading(true);
            fetchMessages();
        }
    }, [sessionId, jid, fetchMessages]);



    // Socket real-time
    useEffect(() => {
        const socket = getSocket();
        if (!socket) return;
        const onConnect = () => joinSession(sessionId);
        if (socket.connected) joinSession(sessionId);
        socket.on("connect", onConnect);
        const normalizedJid = jid.endsWith("@c.us") ? jid.replace("@c.us", "@s.whatsapp.net") : jid;
        const handler = (newMessages: Message[]) => {
            setMessages(prev => {
                const relevant = newMessages.filter(m => m.remoteJid === normalizedJid || prev.some(p => p.remoteJid === m.remoteJid));
                if (relevant.length === 0) return prev;

                // Remove optimistic temp- messages that match incoming messages fromMe
                let filtered = prev;
                for (const nm of relevant) {
                    if (nm.fromMe) {
                        filtered = filtered.filter(p => !(p.keyId.startsWith("temp-") && p.content === nm.content));
                    }
                }

                const combined = [...filtered, ...relevant];
                const unique = Array.from(new Map(combined.map(m => [m.keyId, m])).values());
                const sorted = unique.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

                // Keep cache in sync
                const cacheKey = `${sessionId}:${jid}`;
                const cached = chatCache.get(cacheKey);
                chatCache.set(cacheKey, {
                    messages: sorted,
                    hasMore: cached?.hasMore ?? false,
                    oldestTimestamp: sorted.length > 0 ? sorted[0].timestamp : null,
                    cachedAt: Date.now()
                });

                return sorted;
            });
        };
        socket.on("message.update", handler);
        return () => {
            socket.off("connect", onConnect);
            socket.off("message.update", handler);
        };
    }, [sessionId, jid, getSocket, joinSession]);

    useEffect(() => {
        if (autoScroll) scrollToBottom(false);
    }, [messages, autoScroll, scrollToBottom]);

    const handleScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        setAutoScroll(atBottom);
        if (atBottom) setNewMsgBadge(false);
        if (el.scrollTop < 100 && hasMore && !loadingMore && oldestTimestamp) {
            const prevHeight = el.scrollHeight;
            fetchMessages(oldestTimestamp).then(() => {
                requestAnimationFrame(() => {
                    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevHeight;
                });
            });
        }
    }, [hasMore, loadingMore, oldestTimestamp, fetchMessages]);

    // 0ms Optimistic Send: message appears instantly on screen with WhatsApp Clock icon
    const handleSend = (text: string) => {
        const replyKeyId = replyingTo?.keyId;
        setReplyingTo(null);

        // 1. Optimistic message creation
        const tempKeyId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const nowIso = new Date().toISOString();

        const optimisticMsg: Message = {
            id: tempKeyId,
            keyId: tempKeyId,
            remoteJid: jid,
            fromMe: true,
            pushName: undefined,
            type: "TEXT",
            content: text,
            mediaUrl: undefined,
            status: "PENDING", // Renders WhatsApp Clock icon immediately
            timestamp: nowIso,
            quoteId: replyKeyId || null,
        };

        // 2. Immediately render on screen & scroll (0ms)
        setMessages(prev => [...prev, optimisticMsg]);
        requestAnimationFrame(() => scrollToBottom(true));

        // 3. Update memory cache immediately
        const cacheKey = `${sessionId}:${jid}`;
        const cached = chatCache.get(cacheKey);
        if (cached) {
            chatCache.set(cacheKey, {
                ...cached,
                messages: [...cached.messages, optimisticMsg],
                cachedAt: Date.now()
            });
        }

        // 4. Instantly notify sidebar to update lastMessage and move to top (0ms)
        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("zapflow:local-message-sent", {
                detail: { jid, content: text, timestamp: nowIso }
            }));
        }

        // 5. Send in background — non-blocking, zero perceived delay
        sendChatMessage(sessionId, jid, text, replyKeyId)
            .then(res => {
                if (res?.keyId) {
                    setMessages(prev => prev.map(m => m.keyId === tempKeyId ? { ...m, keyId: res.keyId!, status: "SENT" } : m));
                    const currentCached = chatCache.get(cacheKey);
                    if (currentCached) {
                        currentCached.messages = currentCached.messages.map(m => m.keyId === tempKeyId ? { ...m, keyId: res.keyId!, status: "SENT" } : m);
                    }
                }
            })
            .catch(err => {
                console.error("Erro ao enviar mensagem:", err);
                toast.error(err?.message || "Falha ao enviar a mensagem");
                setMessages(prev => prev.map(m => m.keyId === tempKeyId ? { ...m, status: "FAILED" } : m));
            });
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape" && replyingTo) {
                e.preventDefault();
                setReplyingTo(null);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [replyingTo]);

    const processFileUpload = async (file: File, explicitType?: string) => {
        const formData = new FormData();
        formData.append("file", file);
        let type = explicitType;
        if (!type || type === '*') {
            if (file.type.startsWith('image/')) type = 'image';
            else if (file.type.startsWith('video/')) type = 'video';
            else if (file.type.startsWith('audio/')) type = 'audio';
            else type = 'document';
        }
        formData.append("type", type);
        formData.append("sessionId", sessionId);
        formData.append("jid", jid);
        try {
            toast.info(`Enviando ${file.name}...`);
            await sendMediaMessage(formData);
            toast.success("Mídia enviada!");
            setTimeout(() => fetchMessages(), 800);
        } catch (error: any) {
            toast.error(error.message || "Falha ao enviar a mídia");
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        await processFileUpload(file, uploadType);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const triggerUpload = (type: string) => {
        setUploadType(type);
        if (fileInputRef.current) {
            fileInputRef.current.accept = type === 'image' ? "image/*" : type === 'video' ? "video/*" : type === 'audio' ? "audio/*" : "*/*";
            fileInputRef.current.click();
        }
    };

    const handleContextMenu = useCallback((e: React.MouseEvent, msg: Message) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, msg });
    }, []);

    const displayName = name || jid.split('@')[0];

    return (
        <div
            className="flex-1 flex flex-col min-w-0 min-h-0 relative select-text"
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) processFileUpload(f);
            }}
        >
            {/* Context menu */}
            {contextMenu && (
                <ContextMenu
                    state={contextMenu}
                    onClose={() => setContextMenu(null)}
                    onReply={(msg) => { setReplyingTo(msg); scrollToBottom(true); }}
                    onDelete={(msg) => setDeleteConfirmMsg(msg)}
                />
            )}

            {/* Drag overlay */}
            {isDragging && (
                <div className="absolute inset-0 z-50 bg-[#00a884]/90 backdrop-blur-sm border-2 border-dashed border-white flex items-center justify-center flex-col gap-3 rounded-lg m-2 text-white">
                    <Paperclip className="h-10 w-10 animate-bounce" />
                    <p className="text-lg font-semibold">Solte o arquivo para enviar</p>
                </div>
            )}

            {/* Delete confirmation dialog */}
            <AlertDialog open={!!deleteConfirmMsg} onOpenChange={(open) => { if (!open) setDeleteConfirmMsg(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Excluir mensagem?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Isso removerá a mensagem selecionada. Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                                const msg = deleteConfirmMsg;
                                if (!msg) return;
                                fetch(`/api/messages/${sessionId}/${jid}/${msg.keyId}`, { method: "DELETE" })
                                    .then(() => {
                                        setMessages(p => p.filter(m => m.keyId !== msg.keyId));
                                        toast.success("Mensagem excluída");
                                    })
                                    .catch(() => toast.error("Falha ao excluir a mensagem"));
                                setDeleteConfirmMsg(null);
                            }}
                        >
                            Excluir
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Loading older indicator */}
            {loadingMore && (
                <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 bg-white/95 dark:bg-[#202c33]/95 backdrop-blur-sm px-4 py-1.5 rounded-full shadow-md border text-xs font-medium flex items-center gap-2">
                    <div className="h-3.5 w-3.5 border-2 border-[#00a884]/30 border-t-[#00a884] rounded-full animate-spin" />
                    Carregando mensagens anteriores...
                </div>
            )}

            {/* WhatsApp Header */}
            <div className="shrink-0 px-4 py-2.5 border-b border-border/15 bg-[#f0f2f5] dark:bg-[#202c33] flex items-center justify-between z-10 select-none">
                <div className="flex items-center gap-3 min-w-0">
                    {onBack && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden shrink-0 text-muted-foreground hover:text-foreground" onClick={onBack}>
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    )}
                    <Avatar className="h-10 w-10 shrink-0 cursor-pointer">
                        <AvatarImage src={profilePic && profilePic.startsWith("http") ? profilePic : `/api/avatar/${sessionId}/${encodeURIComponent(jid)}`} referrerPolicy="no-referrer" />
                        <AvatarFallback className={cn(
                            "text-xs font-bold flex items-center justify-center",
                            isGroup
                                ? "bg-[#00a884]/20 text-[#00a884] dark:bg-[#00a884]/30"
                                : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                        )}>
                            {isGroup ? <Users className="h-5 w-5" /> : displayName.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0 cursor-pointer">
                        <h3 className="text-[15px] font-semibold text-foreground truncate leading-snug">
                            {displayName}
                        </h3>
                        <p className="text-[11.5px] text-muted-foreground truncate flex items-center gap-1.5">
                            {isGroup ? (
                                <span className="truncate">
                                    {participantNames.length > 0 ? participantNames.join(", ") : `Grupo • ${jid}`}
                                </span>
                            ) : (
                                <span className="flex items-center gap-1 text-[#00a884] font-medium">
                                    <span className="h-1.5 w-1.5 rounded-full bg-[#00a884]" />
                                    online
                                </span>
                            )}
                        </p>
                    </div>
                </div>

                {/* Header right icons */}
                <div className="flex items-center gap-1 text-[#54656f] dark:text-[#aebac1]">
                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-black/5 dark:hover:bg-white/10" title="Pesquisar">
                        <Search className="h-4.5 w-4.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-black/5 dark:hover:bg-white/10" title="Mais opções">
                        <MoreVertical className="h-4.5 w-4.5" />
                    </Button>
                </div>
            </div>

            {/* WhatsApp Chat Wallpaper & Message Stream */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 min-h-0 styled-scrollbar"
                onScroll={handleScroll}
                style={{
                    backgroundColor: "var(--wa-bg, #efeae2)",
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='120' height='120' viewBox='0 0 120 120' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M20 20c-3 0-5 2-5 5v12c0 3 2 5 5 5h2v4l5-4h8c3 0 5-2 5-5V25c0-3-2-5-5-5H20zm50 20a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm30 15c-4 0-7 3-7 7v10h14V62c0-4-3-7-7-7zm-70 25c-3 0-5 2-5 5s2 5 5 5 5-2 5-5-2-5-5-5zm65 10c-3 0-6 2-6 5v6c0 3 3 5 6 5h10c3 0 6-2 6-5v-6c0-3-3-5-6-5h-10z' fill='%23687782' fill-opacity='0.06' fill-rule='evenodd'/%3E%3C/svg%3E")`,
                    backgroundSize: "220px 220px"
                }}
            >
                <div className="flex flex-col gap-2 max-w-4xl mx-auto">
                    {loading && messages.length === 0 && (
                        <div className="flex-1 flex items-center justify-center py-32">
                            <div className="h-7 w-7 border-3 border-[#00a884]/30 border-t-[#00a884] rounded-full animate-spin" />
                        </div>
                    )}
                    {!hasMore && messages.length > 0 && (
                        <div className="text-center py-3">
                            <span className="text-[11px] font-medium text-[#54656f] dark:text-[#8696a0] bg-white/90 dark:bg-[#182229]/90 px-3.5 py-1 rounded-lg shadow-sm border border-border/20 uppercase tracking-wide">
                                Início da conversa
                            </span>
                        </div>
                    )}
                    {messages.length === 0 && !loading && (
                        <div className="flex-1 flex items-center justify-center py-20">
                            <div className="bg-white/85 dark:bg-[#182229]/85 px-4 py-2 rounded-xl shadow-sm text-center">
                                <p className="text-xs text-[#54656f] dark:text-[#8696a0]">
                                    Nenhuma mensagem trocada ainda nesta conversa
                                </p>
                            </div>
                        </div>
                    )}
                    {messages.map((msg, idx) => {
                        const showDate = idx === 0 || getDateLabel(msg.timestamp) !== getDateLabel(messages[idx - 1].timestamp);
                        return (
                            <div key={msg.keyId} id={`msg-${msg.keyId}`}>
                                {showDate && (
                                    <div className="flex justify-center my-2.5">
                                        <span className="text-[11.5px] font-medium text-[#54656f] dark:text-[#8696a0] bg-white/95 dark:bg-[#182229]/95 px-3 py-1 rounded-lg shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] select-none">
                                            {getDateLabel(msg.timestamp)}
                                        </span>
                                    </div>
                                )}
                                <div className={cn("flex gap-1 group", msg.fromMe ? "justify-end" : "justify-start")}>
                                    {/* Reply button for my messages (on left) */}
                                    {msg.fromMe && (
                                        <button
                                            onClick={() => { setReplyingTo(msg); scrollToBottom(true); }}
                                            className="self-center p-1.5 text-muted-foreground/50 hover:text-[#00a884] hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-all opacity-0 group-hover:opacity-100 cursor-pointer shrink-0 order-first"
                                            title="Responder"
                                        >
                                            <CornerUpLeft className="h-3.5 w-3.5" />
                                        </button>
                                    )}

                                    {/* Authentic WhatsApp Bubble */}
                                    <div
                                        className={cn(
                                            "flex flex-col max-w-[85%] sm:max-w-[70%] px-3 py-1.5 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] cursor-context-menu relative text-[14.2px] leading-[19px]",
                                            msg.fromMe
                                                ? "bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef] rounded-xl rounded-tr-xs ml-auto"
                                                : "bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] rounded-xl rounded-tl-xs mr-auto"
                                        )}
                                        onContextMenu={(e) => handleContextMenu(e, msg)}
                                    >
                                        {/* Group sender resolved name with WhatsApp participant color */}
                                        {!msg.fromMe && isGroup && (() => {
                                            const sJid = msg.senderJid || "";
                                            const bare = sJid.split('@')[0];
                                            const resolved = (sJid && contactMap[sJid]) ||
                                                             (bare && contactMap[bare]) ||
                                                             msg.pushName ||
                                                             bare ||
                                                             "Membro";
                                            return (
                                                <span
                                                    className="text-[12.5px] font-semibold block mb-0.5 leading-tight select-none truncate"
                                                    style={{ color: getParticipantColor(resolved) }}
                                                >
                                                    {resolved}
                                                </span>
                                            );
                                        })()}

                                        {/* Quoted Message Box inside bubble with mentions and preview */}
                                        {msg.quoted && (
                                            <div
                                                className={cn(
                                                    "mb-1 px-2.5 py-1.5 rounded-lg border-l-4 text-xs select-none cursor-pointer text-left transition-opacity hover:opacity-90 flex items-center justify-between gap-2",
                                                    msg.fromMe
                                                        ? "border-[#00a884] bg-black/5 dark:bg-black/20 text-[#111b21] dark:text-[#e9edef]"
                                                        : "border-[#00a884] bg-black/5 dark:bg-white/5 text-[#111b21] dark:text-[#e9edef]"
                                                )}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const target = document.getElementById(`msg-${msg.quoted?.keyId}`);
                                                    if (target) {
                                                        target.scrollIntoView({ behavior: "smooth", block: "center" });
                                                        target.classList.add("bg-[#00a884]/20", "transition-colors", "duration-500");
                                                        setTimeout(() => {
                                                            target.classList.remove("bg-[#00a884]/20");
                                                        }, 1500);
                                                    } else {
                                                        toast.info("A mensagem original não está carregada na conversa");
                                                    }
                                                }}
                                            >
                                                <div className="flex-1 min-w-0">
                                                    <span className="font-semibold block text-[11px] text-[#00a884] dark:text-[#25d366] truncate mb-0.5">
                                                        {(() => {
                                                            if (msg.quoted.fromMe) return "Você";
                                                            const qJid = msg.quoted.senderJid || "";
                                                            const bare = qJid.split('@')[0];
                                                            return (qJid && contactMap[qJid]) ||
                                                                   (bare && contactMap[bare]) ||
                                                                   msg.quoted.pushName ||
                                                                   bare ||
                                                                   "Contato";
                                                        })()}
                                                    </span>
                                                    <span className="line-clamp-2 block break-all text-xs opacity-80">
                                                        {msg.quoted.type === 'IMAGE' && <Camera className="h-3 w-3 inline mr-1 opacity-70" />}
                                                        {renderMessageContent(msg.quoted.content || (msg.quoted.type === 'IMAGE' ? "Foto" : "Mídia"), contactMap)}
                                                    </span>
                                                </div>
                                                {msg.quoted.type === 'IMAGE' && msg.quoted.mediaUrl && (
                                                    <div className="h-10 w-10 shrink-0 rounded overflow-hidden bg-muted">
                                                        <img src={msg.quoted.mediaUrl} alt="Thumbnail" className="h-full w-full object-cover" />
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* IMAGE (with fallback if mediaUrl is missing) */}
                                        {msg.type === 'IMAGE' && (
                                            msg.mediaUrl ? (
                                                <div className="relative group/media">
                                                    <LazyMedia src={msg.mediaUrl} alt="Imagem" />
                                                    <Button
                                                        size="icon"
                                                        variant="secondary"
                                                        className="absolute top-2 right-2 h-8 w-8 rounded-full opacity-0 group-hover/media:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm"
                                                        onClick={() => handleDownload(msg.mediaUrl!, `IMAGE-${msg.keyId}.jpg`)}
                                                    >
                                                        <Download className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2.5 p-2 rounded-lg bg-black/5 dark:bg-white/5 mb-1.5 text-xs text-muted-foreground select-none">
                                                    <ImageIcon className="h-5 w-5 shrink-0 opacity-60 text-[#00a884]" />
                                                    <span>Foto</span>
                                                </div>
                                            )
                                        )}

                                        {/* VIDEO */}
                                        {msg.type === 'VIDEO' && msg.mediaUrl && (
                                            <div className="relative group/media">
                                                <LazyVideo src={msg.mediaUrl} />
                                                <Button
                                                    size="icon"
                                                    variant="secondary"
                                                    className="absolute top-2 right-2 h-8 w-8 rounded-full opacity-0 group-hover/media:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm z-10"
                                                    onClick={() => handleDownload(msg.mediaUrl!, `VIDEO-${msg.keyId}.mp4`)}
                                                >
                                                    <Download className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        )}

                                        {/* AUDIO */}
                                        {msg.type === 'AUDIO' && msg.mediaUrl && (
                                            <div className="flex items-center gap-2 mb-1.5 py-1">
                                                <audio src={msg.mediaUrl} controls className="h-8 max-w-[220px]" preload="none" />
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-8 w-8 rounded-full"
                                                    onClick={() => handleDownload(msg.mediaUrl!, `AUDIO-${msg.keyId}.mp3`)}
                                                >
                                                    <Download className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        )}

                                        {/* STICKER */}
                                        {msg.type === 'STICKER' && msg.mediaUrl && (
                                            <div className="relative group/media mb-1">
                                                <img src={msg.mediaUrl} alt="Figurinha" className="max-h-36 object-contain rounded-lg" loading="lazy" />
                                                <Button
                                                    size="icon"
                                                    variant="secondary"
                                                    className="absolute -top-1 -right-1 h-6 w-6 rounded-full opacity-0 group-hover/media:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm"
                                                    onClick={() => handleDownload(msg.mediaUrl!, `STICKER-${msg.keyId}.webp`)}
                                                >
                                                    <Download className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        )}

                                        {/* DOCUMENT */}
                                        {msg.type !== 'TEXT' && msg.type !== 'IMAGE' && msg.type !== 'STICKER' && msg.type !== 'VIDEO' && msg.type !== 'AUDIO' && (
                                            <div className={cn("flex items-center justify-between gap-2 py-2 px-3 rounded-lg mb-1", msg.fromMe ? "bg-black/5 dark:bg-black/20" : "bg-black/5 dark:bg-white/5")}>
                                                <div className="flex items-center gap-2.5 truncate min-w-0">
                                                    <FileText className="h-4 w-4 shrink-0 text-[#00a884]" />
                                                    <span className="text-xs font-medium truncate">
                                                        {({ TEXT: "Mensagem", IMAGE: "Imagem", VIDEO: "Vídeo", AUDIO: "Áudio", DOCUMENT: "Documento", STICKER: "Figurinha", LOCATION: "Localização", CONTACT: "Contato" }[msg.type] || "Documento")}
                                                    </span>
                                                </div>
                                                {msg.mediaUrl && (
                                                    <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full shrink-0" onClick={() => handleDownload(msg.mediaUrl!, `${msg.type}-${msg.keyId}`)}>
                                                        <Download className="h-3.5 w-3.5" />
                                                    </Button>
                                                )}
                                            </div>
                                        )}

                                        {/* Text content with mentions & Timestamp + status checks */}
                                        <div className="flex flex-wrap items-end justify-end gap-x-2 gap-y-0.5">
                                            <span className="flex-1 break-words whitespace-pre-wrap text-[14.2px]">
                                                {renderMessageContent(msg.content, contactMap)}
                                            </span>
                                            <div className="inline-flex items-center gap-1 shrink-0 ml-auto select-none pt-0.5">
                                                <span className="text-[11px] leading-none text-[#667781] dark:text-[#8696a0]">
                                                    {new Date(msg.timestamp).toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                                {msg.fromMe && <MessageStatusCheck status={msg.status} />}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Reply button for incoming messages (on right) */}
                                    {!msg.fromMe && (
                                        <button
                                            onClick={() => { setReplyingTo(msg); scrollToBottom(true); }}
                                            className="self-center p-1.5 text-muted-foreground/50 hover:text-[#00a884] hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-all opacity-0 group-hover:opacity-100 cursor-pointer shrink-0"
                                            title="Responder"
                                        >
                                            <CornerUpLeft className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    <div ref={bottomRef} />
                </div>
            </div>

            {/* Floating New message badge */}
            {newMsgBadge && (
                <button
                    onClick={() => { scrollToBottom(true); setNewMsgBadge(false); }}
                    className="absolute bottom-20 right-6 z-20 flex items-center gap-2 rounded-full bg-[#00a884] px-3.5 py-2 text-xs font-semibold text-white shadow-lg hover:bg-[#00a884]/90 transition-all animate-bounce"
                >
                    <ArrowDown className="h-4 w-4" /> Novas mensagens
                </button>
            )}

            {/* WhatsApp Styled Bottom Input Bar */}
            <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
            <ChatInputBar
                onSend={handleSend}
                onUpload={triggerUpload}
                replyingTo={replyingTo}
                onCancelReply={() => setReplyingTo(null)}
                jid={jid}
            />
        </div>
    );
}
