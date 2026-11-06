"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
    ExternalLink,
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
    Users,
    Play,
    Pause,
    AtSign,
    FileDown,
    Zap,
    ChevronUp,
    ChevronDown,
    Pin,
    Settings,
    Plus,
    Forward,
    User,
    RefreshCw,
    Tag,
    MessageCircle,
    Pencil,
    Star,
    Eye,
    ZoomIn,
    ZoomOut,
    RotateCw,
    ChevronLeft,
    ChevronRight,
    MapPin,
    StickyNote,
    CheckSquare,
    BarChart2,
    CalendarClock,
    Bold,
    Italic,
    Strikethrough,
    Code,
    Quote,
    Volume2,
    VolumeX,
    Sparkles,
    Palette,
    Loader2
} from "lucide-react";
import { LabelAssignPopover, LabelData } from "./label-assign-popover";
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

import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { getCachedPhoneContacts, getCachedGroups } from "@/lib/whatsapp-client-cache";
import { globalChatListCache } from "./chat-list";

import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
    sendChatMessage,
    sendMediaMessage,
    reactToChatMessage,
    sendChatPresence,
    forwardChatMessage,
    sendContactCardMessage,
    sendLocationPinMessage,
    sendPollMessage,
    scheduleDirectChatMessage,
    runChatAIAssistant,
    transcribeChatAudioMessage,
    type ChatAIAssistantMode
} from "@/app/dashboard/chat/actions";
import type { CustomFreeLLMKeys } from "@/lib/free-llm";
import { useSocket } from "./socket-context";
import { chatCache, fetchOrGetChatMessages, type Message, type GroupParticipant } from "./chat-cache";

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

// ─── Lazy media & WhatsApp Markdown Formatting (#C24) ────────
function highlightText(text: string, query?: string): React.ReactNode {
    if (!query || !query.trim()) return text;
    const q = query.trim();
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const segments = text.split(regex);
    if (segments.length === 1) return text;
    return segments.map((seg, i) =>
        seg.toLowerCase() === q.toLowerCase() ? (
            <mark key={i} className="bg-amber-300 dark:bg-amber-500/80 text-black dark:text-white rounded-xs px-0.5">
                {seg}
            </mark>
        ) : seg
    );
}

function formatWhatsAppInline(text: string, query?: string): React.ReactNode {
    if (!text) return text;
    // Matches `code`, *bold*, _italic_, ~strike~
    const mdRegex = /(`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;
    const segments = text.split(mdRegex);
    if (segments.length === 1) return highlightText(text, query);

    return segments.map((seg, idx) => {
        if (seg.length >= 3) {
            if (seg.startsWith("`") && seg.endsWith("`")) {
                return (
                    <code key={idx} className="px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/15 font-mono text-[12.5px]">
                        {highlightText(seg.slice(1, -1), query)}
                    </code>
                );
            }
            if (seg.startsWith("*") && seg.endsWith("*")) {
                return <strong key={idx} className="font-bold">{highlightText(seg.slice(1, -1), query)}</strong>;
            }
            if (seg.startsWith("_") && seg.endsWith("_")) {
                return <em key={idx} className="italic">{highlightText(seg.slice(1, -1), query)}</em>;
            }
            if (seg.startsWith("~") && seg.endsWith("~")) {
                return <del key={idx} className="line-through opacity-85">{highlightText(seg.slice(1, -1), query)}</del>;
            }
        }
        return <span key={idx}>{highlightText(seg, query)}</span>;
    });
}

function formatSegmentWithQuotes(text: string, query?: string): React.ReactNode {
    if (!text.includes("> ")) return formatWhatsAppInline(text, query);
    const lines = text.split("\n");
    return lines.map((line, i) => {
        const isLast = i === lines.length - 1;
        if (line.startsWith("> ")) {
            return (
                <div
                    key={i}
                    className="border-l-3 border-[#00a884] pl-2.5 py-0.5 my-0.5 text-foreground/85 italic bg-black/5 dark:bg-white/5 rounded-r-md"
                >
                    {formatWhatsAppInline(line.slice(2), query)}
                </div>
            );
        }
        return (
            <span key={i}>
                {formatWhatsAppInline(line, query)}
                {!isLast && "\n"}
            </span>
        );
    });
}

// ─── Helper for rendering text with links and @mentions ───
function renderMessageContent(content: string | null | undefined, contactMap?: Record<string, string>, highlightQuery?: string) {
    if (!content) return null;

    // Build pattern for URLs and @mentions (digits or known contact names)
    const escapedNames = contactMap
        ? Array.from(new Set(Object.values(contactMap)))
              .filter(n => n && n.trim().length >= 3)
              .sort((a, b) => b.length - a.length)
              .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        : [];

    let tokenRegex: RegExp;
    if (escapedNames.length > 0) {
        // Matches URL, or @(digits), or @(knownName)
        tokenRegex = new RegExp(`(https?:\\/\\/[^\\s]+)|@(\\d{8,25})|@(${escapedNames.join('|')})`, 'g');
    } else {
        tokenRegex = /(https?:\/\/[^\s]+)|@(\d{8,25})|@([A-Za-z0-9_\-\.\+]+)/g;
    }

    const parts: (string | React.ReactNode)[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(content)) !== null) {
        const matchIndex = match.index;
        if (matchIndex > lastIndex) {
            parts.push(formatSegmentWithQuotes(content.substring(lastIndex, matchIndex), highlightQuery));
        }

        if (match[1]) {
            // URL
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
            // @(digits) - resolve via contactMap
            const id = match[2];
            const resolvedName = contactMap ? (
                contactMap[id] ||
                contactMap[`${id}@lid`] ||
                contactMap[`${id}@s.whatsapp.net`]
            ) : null;
            const displayText = resolvedName ? `@${resolvedName}` : `@${id}`;

            parts.push(
                <span
                    key={`mention-id-${matchIndex}-${id}`}
                    className="font-semibold text-[#00a884] dark:text-[#25d366] inline cursor-pointer hover:underline"
                    title={resolvedName ? `ID: ${id}` : undefined}
                >
                    {displayText}
                </span>
            );
        } else if (match[3]) {
            // @(name) - already named mention
            const named = match[3];
            parts.push(
                <span
                    key={`mention-name-${matchIndex}-${named}`}
                    className="font-semibold text-[#00a884] dark:text-[#25d366] inline cursor-pointer hover:underline"
                >
                    @{named}
                </span>
            );
        }

        lastIndex = matchIndex + match[0].length;
    }

    if (lastIndex < content.length) {
        parts.push(formatSegmentWithQuotes(content.substring(lastIndex), highlightQuery));
    }

    return parts;
}

// ─── Lazy media with fallback ──────────────────
function LazyMedia({ src, alt, onClick }: { src: string; alt: string; onClick?: () => void }) {
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
            <div
                ref={ref}
                onClick={onClick}
                className="mb-1.5 flex items-center gap-2.5 p-2.5 rounded-lg bg-black/10 dark:bg-white/5 border border-black/5 dark:border-white/5 text-xs text-muted-foreground select-none cursor-pointer hover:bg-black/15 dark:hover:bg-white/10 transition-colors"
                title="Foto"
            >
                <div className="h-8 w-8 rounded bg-[#00a884]/15 flex items-center justify-center shrink-0">
                    <ImageIcon className="h-4 w-4 text-[#00a884]" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground text-xs">Foto</p>
                    <p className="text-[10px] text-muted-foreground">Clique para visualizar</p>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={ref}
            className="mb-1.5 overflow-hidden rounded-lg relative min-h-[140px] max-w-[340px] bg-black/5 dark:bg-black/30 flex items-center justify-center cursor-pointer group/img select-none"
            onClick={onClick}
        >
            {visible ? (
                <>
                    {!loaded && <div className="absolute inset-0 bg-muted/30 rounded-lg animate-pulse" />}
                    <img
                        src={src}
                        alt={alt}
                        className={`max-w-full max-h-80 object-cover rounded-lg transition-all duration-200 group-hover/img:brightness-95 ${loaded ? 'opacity-100' : 'opacity-0'}`}
                        onLoad={() => setLoaded(true)}
                        onError={() => setHasError(true)}
                        loading="lazy"
                    />
                </>
            ) : (
                <div className="h-36 w-full bg-muted/20 rounded-lg animate-pulse" />
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

const FREE_LLM_KEYS_STORAGE = "zapflow_free_llm_keys_v1";
const AUDIO_TRANSCRIPTIONS_STORAGE = "zapflow_audio_transcriptions_v1";

function loadSavedLLMKeys(): CustomFreeLLMKeys {
    if (typeof window === "undefined") return {};
    try {
        const raw = localStorage.getItem(FREE_LLM_KEYS_STORAGE);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") return parsed;
        }
    } catch {}
    return {};
}

function saveLLMKeys(keys: CustomFreeLLMKeys) {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(FREE_LLM_KEYS_STORAGE, JSON.stringify(keys));
    } catch {}
}

// ─── Authentic WhatsApp Voice Note Audio Player with Speed Control (1x, 1.5x, 2x) & AI Transcription (#C30) ───
function WhatsAppAudioPlayer({ src, downloadFileName }: { src: string; downloadFileName?: string }) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackRate, setPlaybackRate] = useState<number>(1);
    const [transcription, setTranscription] = useState<string | null>(null);
    const [isTranscribing, setIsTranscribing] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined" || !src) return;
        try {
            const raw = localStorage.getItem(AUDIO_TRANSCRIPTIONS_STORAGE);
            if (raw) {
                const map: Record<string, string> = JSON.parse(raw);
                if (map[src]) setTranscription(map[src]);
            }
        } catch {}
    }, [src]);

    const handleTranscribe = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isTranscribing) return;
        setIsTranscribing(true);
        try {
            const keys = loadSavedLLMKeys();
            const res = await transcribeChatAudioMessage(src, keys);
            setTranscription(res.text);
            try {
                const raw = localStorage.getItem(AUDIO_TRANSCRIPTIONS_STORAGE);
                const map: Record<string, string> = raw ? JSON.parse(raw) : {};
                map[src] = res.text;
                localStorage.setItem(AUDIO_TRANSCRIPTIONS_STORAGE, JSON.stringify(map));
            } catch {}
            toast.success("🎙️ Áudio transcrito com sucesso!");
        } catch (err: any) {
            toast.error(err?.message || "Erro ao transcrever áudio");
        } finally {
            setIsTranscribing(false);
        }
    };

    const togglePlay = () => {
        if (!audioRef.current) return;
        if (isPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.play();
        }
    };

    const toggleSpeed = (e: React.MouseEvent) => {
        e.stopPropagation();
        const nextRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
        setPlaybackRate(nextRate);
        if (audioRef.current) {
            audioRef.current.playbackRate = nextRate;
        }
    };

    const formatTime = (seconds: number) => {
        if (!seconds || isNaN(seconds)) return "0:00";
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const time = parseFloat(e.target.value);
        setCurrentTime(time);
        if (audioRef.current) {
            audioRef.current.currentTime = time;
        }
    };

    return (
        <div className="flex flex-col gap-1.5 my-1 min-w-[245px] max-w-[330px] select-none">
            <div className="flex items-center gap-2.5 py-1 px-1">
                <audio
                    ref={audioRef}
                    src={src}
                    preload="metadata"
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => { setIsPlaying(false); setCurrentTime(0); }}
                    onTimeUpdate={() => audioRef.current && setCurrentTime(audioRef.current.currentTime)}
                    onLoadedMetadata={() => audioRef.current && setDuration(audioRef.current.duration)}
                />
                {/* Play/Pause Button */}
                <button
                    type="button"
                    onClick={togglePlay}
                    className="h-10 w-10 rounded-full bg-[#00a884] hover:bg-[#00a884]/90 text-white flex items-center justify-center shrink-0 shadow-sm transition-transform active:scale-95 cursor-pointer"
                    title={isPlaying ? "Pausar" : "Tocar áudio"}
                >
                    {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current ml-0.5" />}
                </button>

                {/* Scrubber & Time */}
                <div className="flex-1 flex flex-col justify-center min-w-0 gap-1">
                    <input
                        type="range"
                        min="0"
                        max={duration || 100}
                        value={currentTime}
                        onChange={handleSeek}
                        className="w-full h-1.5 bg-black/15 dark:bg-white/20 rounded-lg appearance-none cursor-pointer accent-[#00a884]"
                    />
                    <div className="flex justify-between items-center text-[11px] text-muted-foreground tabular-nums px-0.5">
                        <span>{formatTime(currentTime)}</span>
                        <span>{formatTime(duration)}</span>
                    </div>
                </div>

                {/* Speed Pill (1x, 1.5x, 2x) */}
                <button
                    type="button"
                    onClick={toggleSpeed}
                    className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-black/5 dark:bg-white/10 hover:bg-black/10 text-muted-foreground hover:text-foreground shrink-0 tabular-nums transition-colors cursor-pointer"
                    title="Velocidade de reprodução"
                >
                    {playbackRate}x
                </button>

                {/* AI Transcribe Audio Button (#C30) */}
                <button
                    type="button"
                    onClick={handleTranscribe}
                    disabled={isTranscribing}
                    className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-[#00a884]/15 hover:bg-[#00a884]/25 text-[#00a884] dark:text-[#25d366] flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                    title="Transcrever áudio em texto com IA (Groq Whisper)"
                >
                    {isTranscribing ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                        <Sparkles className="h-3 w-3" />
                    )}
                    <span>{transcription ? "Lido" : "Ler"}</span>
                </button>

                {/* Download */}
                {downloadFileName && (
                    <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground shrink-0"
                        onClick={() => handleDownload(src, downloadFileName)}
                        title="Baixar áudio"
                    >
                        <Download className="h-3.5 w-3.5" />
                    </Button>
                )}
            </div>

            {transcription && (
                <div className="px-2.5 py-1.5 rounded-lg bg-black/5 dark:bg-black/25 border border-black/5 dark:border-white/10 text-xs text-foreground/90 flex items-start justify-between gap-2 select-text">
                    <p className="italic leading-relaxed break-words flex-1">
                        &ldquo;{transcription}&rdquo;
                    </p>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(transcription);
                            toast.success("Transcrição copiada!");
                        }}
                        className="p-1 text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
                        title="Copiar transcrição"
                    >
                        <Copy className="h-3 w-3" />
                    </button>
                </div>
            )}
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
    onEdit,
    onDelete,
    onTogglePin,
    onToggleStar,
    onForward,
    onSelectMessages,
    onInspectMessage,
    isPinned,
    isStarred
}: {
    state: ContextMenuState;
    onClose: () => void;
    onReply: (msg: Message) => void;
    onEdit?: (msg: Message) => void;
    onDelete: (msg: Message) => void;
    onTogglePin: (msg: Message) => void;
    onToggleStar?: (msg: Message) => void;
    onForward: (msg: Message) => void;
    onSelectMessages?: (msg: Message) => void;
    onInspectMessage?: (msg: Message) => void;
    isPinned: boolean;
    isStarred?: boolean;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [onClose]);

    const handleCopy = () => {
        const textToCopy = state.msg.content || "";
        if (textToCopy) {
            navigator.clipboard.writeText(textToCopy).then(() => {
                toast.success("Texto copiado para a área de transferência!");
            }).catch(() => {});
        } else {
            toast.info("Nenhum texto para copiar nesta mensagem");
        }
        onClose();
    };

    const canEdit = state.msg.fromMe && state.msg.type === "TEXT" && !state.msg.keyId.startsWith("temp-");

    const items = [
        { label: "Dados da mensagem", icon: Info, action: () => { if (onInspectMessage) onInspectMessage(state.msg); onClose(); } },
        { label: "Responder", icon: CornerUpLeft, action: () => { onReply(state.msg); onClose(); } },
        ...(canEdit && onEdit ? [{ label: "Editar mensagem", icon: Pencil, action: () => { onEdit(state.msg); onClose(); } }] : []),
        { label: "Encaminhar", icon: Forward, action: () => { onForward(state.msg); onClose(); } },
        ...(onSelectMessages ? [{ label: "Selecionar mensagens", icon: CheckSquare, action: () => { onSelectMessages(state.msg); onClose(); } }] : []),
        { label: isPinned ? "Desafixar mensagem" : "Fixar mensagem", icon: Pin, action: () => { onTogglePin(state.msg); onClose(); } },
        ...(onToggleStar ? [{ label: isStarred ? "Remover dos favoritos" : "Favoritar mensagem", icon: Star, action: () => { onToggleStar(state.msg); onClose(); } }] : []),
        { label: "Copiar texto", icon: Copy, action: handleCopy },
        { label: state.msg.fromMe ? "Apagar para todos" : "Excluir mensagem", icon: Trash2, action: () => { onDelete(state.msg); onClose(); }, dangerous: true },
    ];

    const style: React.CSSProperties = { position: "fixed", top: state.y, left: state.x, zIndex: 9999 };
    if (typeof window !== "undefined") {
        if (state.x > window.innerWidth - 200) style.left = state.x - 200;
        if (state.y > window.innerHeight - 260) style.top = state.y - 240;
    }

    return (
        <div ref={ref} style={style} className="w-52 rounded-xl bg-popover/95 backdrop-blur-md border border-border/60 shadow-2xl py-1 animate-in fade-in zoom-in-95 origin-top-left">
            {items.map((item, i) => (
                <button
                    key={i}
                    onClick={item.action}
                    className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors cursor-pointer",
                        item.dangerous ? "text-red-500 hover:bg-red-500/10" : "text-foreground hover:bg-muted"
                    )}
                >
                    <item.icon className={cn("h-4 w-4 shrink-0", item.dangerous ? "text-red-500" : "text-muted-foreground")} />
                    {item.label}
                </button>
            ))}
        </div>
    );
}



// ─── Forward Message Modal (Single or Multi-Message #C11 & #C19) ────────
interface ForwardModalProps {
    sessionId: string;
    message?: Message | null;
    messagesList?: Message[];
    onClose: () => void;
    onForwardComplete?: () => void;
}

function ForwardModal({ sessionId, message, messagesList, onClose, onForwardComplete }: ForwardModalProps) {
    const itemsToForward = useMemo(() => {
        if (messagesList && messagesList.length > 0) return messagesList;
        if (message) return [message];
        return [];
    }, [message, messagesList]);

    const [searchQuery, setSearchQuery] = useState("");
    const [selectedJids, setSelectedJids] = useState<string[]>([]);
    const [isSending, setIsSending] = useState(false);
    const [targets, setTargets] = useState<{ jid: string; name: string; isGroup: boolean; phone?: string }[]>([]);

    useEffect(() => {
        if (!sessionId) return;
        const recentChats = (globalChatListCache.get(sessionId) || []).map(c => ({
            jid: c.jid,
            name: c.name || c.notify || c.jid.split("@")[0],
            isGroup: c.jid.endsWith("@g.us"),
            phone: c.jid.replace("@s.whatsapp.net", "")
        }));

        const cachedContacts = (getCachedPhoneContacts(sessionId) || []).map(c => ({
            jid: c.jid,
            name: c.name || c.notify || c.verifiedName || c.jid.split("@")[0],
            isGroup: false,
            phone: c.jid.replace("@s.whatsapp.net", "")
        }));

        const cachedGroups = (getCachedGroups(sessionId) || []).map(g => ({
            jid: g.jid,
            name: g.subject || g.jid,
            isGroup: true,
            phone: ""
        }));

        const mergedMap = new Map<string, { jid: string; name: string; isGroup: boolean; phone?: string }>();
        recentChats.forEach(t => mergedMap.set(t.jid, t));
        cachedGroups.forEach(t => { if (!mergedMap.has(t.jid)) mergedMap.set(t.jid, t); });
        cachedContacts.forEach(t => { if (!mergedMap.has(t.jid)) mergedMap.set(t.jid, t); });

        setTargets(Array.from(mergedMap.values()));
    }, [sessionId]);

    const filteredTargets = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return targets.slice(0, 50);
        const digits = q.replace(/\D/g, "");
        return targets.filter(t => 
            t.name.toLowerCase().includes(q) || 
            t.jid.toLowerCase().includes(q) ||
            (digits && t.phone?.includes(digits))
        ).slice(0, 50);
    }, [targets, searchQuery]);

    const toggleSelect = (targetJid: string) => {
        setSelectedJids(prev => prev.includes(targetJid) ? prev.filter(x => x !== targetJid) : [...prev, targetJid]);
    };

    const handleConfirmForward = async () => {
        if (selectedJids.length === 0 || itemsToForward.length === 0) return;
        setIsSending(true);
        try {
            for (const msg of itemsToForward) {
                await forwardChatMessage(sessionId, selectedJids, {
                    content: msg.content,
                    type: msg.type,
                    mediaUrl: msg.mediaUrl
                });
            }
            toast.success(
                itemsToForward.length > 1
                    ? `${itemsToForward.length} mensagens encaminhadas para ${selectedJids.length} conversa(s)!`
                    : `Mensagem encaminhada para ${selectedJids.length} conversa(s)!`
            );
            onForwardComplete?.();
            onClose();
        } catch (e: any) {
            toast.error(e?.message || "Erro ao encaminhar mensagem");
        } finally {
            setIsSending(false);
        }
    };

    if (itemsToForward.length === 0) return null;
    const firstMsg = itemsToForward[0];

    return (
        <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-md p-0 overflow-hidden rounded-2xl bg-white dark:bg-[#111b21] border border-border/40 shadow-2xl">
                <DialogHeader className="p-4 pb-2 border-b border-border/20">
                    <DialogTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                        <Forward className="h-5 w-5 text-[#00a884]" />
                        <span>
                            {itemsToForward.length > 1
                                ? `Encaminhar ${itemsToForward.length} mensagens`
                                : "Encaminhar mensagem"}
                        </span>
                    </DialogTitle>
                </DialogHeader>

                {/* Message preview snippet */}
                <div className="mx-4 my-2 p-2.5 rounded-lg bg-muted/60 border border-border/30 text-xs text-muted-foreground flex items-center gap-2.5 border-l-4 border-l-[#00a884]">
                    {itemsToForward.length === 1 && firstMsg.type === "IMAGE" && firstMsg.mediaUrl && (
                        <img src={firstMsg.mediaUrl} alt="Preview" className="h-9 w-9 rounded object-cover shrink-0" />
                    )}
                    <div className="min-w-0 flex-1 truncate">
                        {itemsToForward.length > 1 ? (
                            <span className="font-semibold text-foreground">
                                {itemsToForward.length} mensagens selecionadas para encaminhar
                            </span>
                        ) : (
                            <>
                                <span className="font-semibold text-foreground mr-1">
                                    {firstMsg.type === "IMAGE" ? "📷 Foto:" : firstMsg.type === "VIDEO" ? "🎥 Vídeo:" : firstMsg.type === "AUDIO" ? "🎤 Áudio:" : firstMsg.type === "DOCUMENT" ? "📄 Documento:" : "Mensagem:"}
                                </span>
                                <span>{firstMsg.content || (firstMsg.type === "IMAGE" ? "Imagem" : firstMsg.type === "AUDIO" ? "Mensagem de voz" : "Arquivo de mídia")}</span>
                            </>
                        )}
                    </div>
                </div>

                {/* Search input */}
                <div className="px-4 py-1">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Pesquisar contatos e grupos..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="h-9 pl-9 text-xs bg-muted/40 rounded-xl"
                            autoFocus
                        />
                    </div>
                </div>

                {/* List of contacts and groups */}
                <div className="max-h-64 overflow-y-auto divide-y divide-border/10 px-2 py-1">
                    {filteredTargets.length === 0 ? (
                        <div className="p-4 text-center text-xs text-muted-foreground">
                            Nenhum contato ou grupo encontrado.
                        </div>
                    ) : (
                        filteredTargets.map(target => {
                            const isSelected = selectedJids.includes(target.jid);
                            return (
                                <div
                                    key={target.jid}
                                    onClick={() => toggleSelect(target.jid)}
                                    className={cn(
                                        "flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors",
                                        isSelected ? "bg-[#00a884]/10 dark:bg-[#00a884]/20" : "hover:bg-muted/50"
                                    )}
                                >
                                    <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                                        {target.isGroup ? <Users className="h-4 w-4 text-muted-foreground" /> : <User className="h-4 w-4 text-muted-foreground" />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium text-foreground truncate">{target.name}</p>
                                        <p className="text-xs text-muted-foreground truncate font-mono">{target.isGroup ? "Grupo" : (target.phone || target.jid)}</p>
                                    </div>
                                    <Checkbox
                                        checked={isSelected}
                                        onCheckedChange={() => toggleSelect(target.jid)}
                                        className="rounded-md"
                                    />
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer with actions */}
                <div className="p-3 bg-muted/30 border-t border-border/20 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground font-medium">
                        {selectedJids.length} selecionado(s)
                    </span>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={onClose} disabled={isSending}>
                            Cancelar
                        </Button>
                        <Button
                            size="sm"
                            onClick={handleConfirmForward}
                            disabled={selectedJids.length === 0 || isSending}
                            className="bg-[#00a884] hover:bg-[#00a884]/90 text-white font-medium gap-1.5"
                        >
                            {isSending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Forward className="h-4 w-4" />}
                            <span>Encaminhar</span>
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

interface QuickReplyItem {
    shortcut: string;
    label: string;
    text: string;
}

const DEFAULT_QUICK_REPLIES: QuickReplyItem[] = [
    { shortcut: "/ola", label: "Saudação inicial", text: "Olá! Tudo bem? Como posso te ajudar hoje?" },
    { shortcut: "/pix", label: "Dados do PIX", text: "Segue nossa chave PIX para pagamento: [chave]. Por gentileza, nos envie o comprovante após a transferência." },
    { shortcut: "/horario", label: "Horário de atendimento", text: "Nosso horário de funcionamento é de segunda a sexta, das 08h às 18h." },
    { shortcut: "/endereco", label: "Endereço e localização", text: "Estamos localizados na [Endereço completo]. Venha nos visitar ou utilize o Waze/Google Maps!" },
    { shortcut: "/catalogo", label: "Catálogo / Tabela", text: "Olá! Segue nosso catálogo completo de produtos e serviços atualizados." },
    { shortcut: "/contrato", label: "Envio de contrato", text: "Segue o contrato para conferência e assinatura. Favor acusar o recebimento." },
    { shortcut: "/embarque", label: "Liberação de embarque", text: "🚨 Atenção: Lote liberado e pronto para embarque. Favor alinhar com os motoristas para seguirem viagem." },
    { shortcut: "/obrigado", label: "Agradecimento", text: "Muito obrigado pelo contato e pela preferência! Qualquer dúvida estamos à total disposição." }
];

const STORAGE_KEY_QUICK_REPLIES = "zapflow_custom_quick_replies";

function loadQuickReplies(): QuickReplyItem[] {
    if (typeof window === "undefined") return DEFAULT_QUICK_REPLIES;
    try {
        const stored = localStorage.getItem(STORAGE_KEY_QUICK_REPLIES);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch {}
    return DEFAULT_QUICK_REPLIES;
}

function saveQuickReplies(items: QuickReplyItem[]) {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(STORAGE_KEY_QUICK_REPLIES, JSON.stringify(items));
        window.dispatchEvent(new CustomEvent("zapflow:quick-replies-updated"));
    } catch {}
}


function ChatInfoAndMediaModal({
    isOpen,
    onClose,
    name,
    jid,
    profilePic,
    isGroup,
    messages,
    participants = [],
    sessionId,
    initialTab = "media",
    starredIds = [],
    isMuted,
    isBlocked,
    chatNote = "",
    onSaveChatNote,
    onToggleMute,
    onToggleBlock,
    onClearChat,
    onPreviewMedia,
    onExportParticipants,
    onSendBroadcastToMembers
}: {
    isOpen: boolean;
    onClose: () => void;
    name?: string;
    jid: string;
    profilePic?: string;
    isGroup?: boolean;
    messages: Message[];
    participants?: GroupParticipant[];
    sessionId: string;
    initialTab?: "media" | "docs" | "audio" | "links" | "starred" | "members";
    starredIds?: string[];
    isMuted?: boolean;
    isBlocked?: boolean;
    chatNote?: string;
    onSaveChatNote?: (val: string) => void;
    onToggleMute?: () => void;
    onToggleBlock?: () => void;
    onClearChat?: () => void;
    onPreviewMedia: (src: string, caption?: string) => void;
    onExportParticipants?: () => void;
    onSendBroadcastToMembers?: () => void;
}) {
    const [tab, setTab] = useState<"media" | "docs" | "audio" | "links" | "starred" | "members">(initialTab);
    const [participantSearch, setParticipantSearch] = useState("");

    useEffect(() => {
        if (isOpen) setTab(initialTab);
    }, [isOpen, initialTab]);

    if (!isOpen) return null;

    const mediaMessages = messages.filter(m => (m.type === 'IMAGE' || m.type === 'VIDEO') && m.mediaUrl);
    const docMessages = messages.filter(m => m.type === 'DOCUMENT' && m.mediaUrl);
    const audioMessages = messages.filter(m => m.type === 'AUDIO' && m.mediaUrl);
    const starredMessages = messages.filter(m => starredIds.includes(m.keyId));

    const linkItems: { url: string; text: string; timestamp: string }[] = [];
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    for (const m of messages) {
        if (m.content) {
            const matches = m.content.match(urlRegex);
            if (matches) {
                matches.forEach(u => linkItems.push({ url: u, text: m.content, timestamp: m.timestamp }));
            }
        }
    }

    const filteredParticipants = participants.filter(p =>
        (p.name && p.name.toLowerCase().includes(participantSearch.toLowerCase())) ||
        (p.phoneNumber && p.phoneNumber.includes(participantSearch))
    );

    const displayName = name || jid.split('@')[0];
    const cleanNumber = jid.split('@')[0].replace(/\D/g, "");
    const formattedPhone = cleanNumber.length >= 10 ? `+${cleanNumber}` : jid;

    return (
        <aside className="absolute inset-0 md:static md:w-[340px] lg:w-[375px] xl:w-[390px] h-full border-l border-border/25 bg-[#f0f2f5] dark:bg-[#111b21] flex flex-col shrink-0 z-30 animate-in slide-in-from-right duration-200 select-none overflow-hidden">
            {/* WhatsApp Web Right Drawer Header */}
            <div className="px-4 py-3 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-border/15 flex items-center gap-3 shrink-0">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={onClose}
                    className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground cursor-pointer"
                    title="Fechar painel (Esc)"
                >
                    <X className="h-4.5 w-4.5" />
                </Button>
                <h3 className="text-sm font-semibold text-foreground">
                    Dados do {isGroup ? "grupo" : "contato"}
                </h3>
            </div>

            <div className="flex-1 overflow-y-auto styled-scrollbar space-y-2 pb-4">
                {/* Profile Hero Card */}
                <div className="bg-white dark:bg-[#111b21] px-4 py-5 flex flex-col items-center text-center shadow-2xs border-b border-border/10">
                    <Avatar className="h-24 w-24 mb-3 border-2 border-[#00a884]/30 shadow-md">
                        <AvatarImage src={profilePic && profilePic.startsWith("http") ? profilePic : `/api/avatar/${sessionId}/${encodeURIComponent(jid)}`} referrerPolicy="no-referrer" />
                        <AvatarFallback className="text-2xl font-bold bg-[#00a884]/20 text-[#00a884]">
                            {isGroup ? <Users className="h-10 w-10" /> : displayName.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                    </Avatar>
                    <h2 className="text-base font-bold text-foreground truncate max-w-full px-2">{displayName}</h2>
                    <button
                        type="button"
                        onClick={() => {
                            navigator.clipboard.writeText(isGroup ? jid : cleanNumber || jid);
                            toast.success("Número/JID copiado!");
                        }}
                        className="mt-0.5 text-xs font-mono text-muted-foreground hover:text-[#00a884] flex items-center gap-1 cursor-pointer"
                        title="Clique para copiar"
                    >
                        <span>{isGroup ? `Grupo • ${participants.length} membros` : formattedPhone}</span>
                        <Copy className="h-3 w-3 opacity-70" />
                    </button>

                    {/* Quick Action Buttons */}
                    <div className="flex items-center justify-center gap-3 mt-3 pt-2 border-t border-border/10 w-full">
                        {onToggleMute && (
                            <button
                                type="button"
                                onClick={onToggleMute}
                                className="flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl hover:bg-muted/60 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            >
                                {isMuted ? <VolumeX className="h-4 w-4 text-amber-500" /> : <Volume2 className="h-4 w-4 text-[#00a884]" />}
                                <span className="text-[10.5px] font-medium">{isMuted ? "Silenciado" : "Silenciar"}</span>
                            </button>
                        )}
                        {isGroup && onExportParticipants && (
                            <button
                                type="button"
                                onClick={onExportParticipants}
                                className="flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl hover:bg-muted/60 text-xs text-[#00a884] transition-colors cursor-pointer"
                            >
                                <FileDown className="h-4 w-4" />
                                <span className="text-[10.5px] font-medium">CSV Membros</span>
                            </button>
                        )}
                        {isGroup && onSendBroadcastToMembers && (
                            <button
                                type="button"
                                onClick={onSendBroadcastToMembers}
                                className="flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl hover:bg-muted/60 text-xs text-amber-500 transition-colors cursor-pointer"
                            >
                                <Zap className="h-4 w-4" />
                                <span className="text-[10.5px] font-medium">Disparar</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* Internal Note Section inside Right Drawer (#C31) */}
                {onSaveChatNote && (
                    <div className="bg-white dark:bg-[#111b21] px-4 py-3 shadow-2xs border-y border-border/10 space-y-1.5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                                <StickyNote className="h-3.5 w-3.5" />
                                Notas Internas do Cliente
                            </span>
                            {chatNote.trim().length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => onSaveChatNote("")}
                                    className="text-[10px] text-muted-foreground hover:text-destructive cursor-pointer"
                                >
                                    Limpar
                                </button>
                            )}
                        </div>
                        <textarea
                            rows={2}
                            value={chatNote}
                            onChange={(e) => onSaveChatNote(e.target.value)}
                            placeholder="Adicione observações privadas sobre este contato..."
                            className="w-full rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-500/25 px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-amber-500 resize-none"
                        />
                    </div>
                )}

                {/* Media, Docs, Audio, Links, Starred & Members Card */}
                <div className="bg-white dark:bg-[#111b21] shadow-2xs border-y border-border/10">
                    <div className="flex items-center border-b border-border/15 px-2 gap-0.5 overflow-x-auto no-scrollbar bg-background text-[11px] font-medium">
                        <button
                            type="button"
                            onClick={() => setTab("media")}
                            className={cn(
                                "py-2.5 px-2.5 border-b-2 transition-colors cursor-pointer flex items-center gap-1 shrink-0",
                                tab === "media" ? "border-[#00a884] text-[#00a884] font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <ImageIcon className="h-3 w-3" />
                            <span>Mídias ({mediaMessages.length})</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setTab("docs")}
                            className={cn(
                                "py-2.5 px-2.5 border-b-2 transition-colors cursor-pointer flex items-center gap-1 shrink-0",
                                tab === "docs" ? "border-[#00a884] text-[#00a884] font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <FileText className="h-3 w-3" />
                            <span>Docs ({docMessages.length})</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setTab("audio")}
                            className={cn(
                                "py-2.5 px-2.5 border-b-2 transition-colors cursor-pointer flex items-center gap-1 shrink-0",
                                tab === "audio" ? "border-[#00a884] text-[#00a884] font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Music className="h-3 w-3" />
                            <span>Áudios ({audioMessages.length})</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setTab("links")}
                            className={cn(
                                "py-2.5 px-2.5 border-b-2 transition-colors cursor-pointer flex items-center gap-1 shrink-0",
                                tab === "links" ? "border-[#00a884] text-[#00a884] font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <ExternalLink className="h-3 w-3" />
                            <span>Links ({linkItems.length})</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setTab("starred")}
                            className={cn(
                                "py-2.5 px-2.5 border-b-2 transition-colors cursor-pointer flex items-center gap-1 shrink-0",
                                tab === "starred" ? "border-[#00a884] text-[#00a884] font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Star className="h-3 w-3 text-amber-500" />
                            <span>Favoritas ({starredMessages.length})</span>
                        </button>
                        {isGroup && (
                            <button
                                type="button"
                                onClick={() => setTab("members")}
                                className={cn(
                                    "py-2.5 px-2.5 border-b-2 transition-colors cursor-pointer flex items-center gap-1 shrink-0",
                                    tab === "members" ? "border-[#00a884] text-[#00a884] font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <Users className="h-3 w-3" />
                                <span>Membros ({participants.length})</span>
                            </button>
                        )}
                    </div>

                    <div className="p-3 min-h-[180px]">
                        {tab === "media" && (
                            mediaMessages.length === 0 ? (
                                <div className="py-10 text-center text-muted-foreground">
                                    <ImageIcon className="h-8 w-8 mx-auto opacity-30 mb-1.5" />
                                    <p className="text-xs">Nenhuma foto ou vídeo nesta conversa.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-3 gap-1.5">
                                    {mediaMessages.map(m => (
                                        <div
                                            key={m.keyId}
                                            className="relative group aspect-square rounded-lg overflow-hidden bg-black/10 cursor-pointer border border-border/20 shadow-xs"
                                            onClick={() => onPreviewMedia(m.mediaUrl!, m.content)}
                                        >
                                            {m.type === 'VIDEO' ? (
                                                <video src={m.mediaUrl} className="h-full w-full object-cover" />
                                            ) : (
                                                <img src={m.mediaUrl} alt="Mídia" className="h-full w-full object-cover transition-transform group-hover:scale-105 duration-200" loading="lazy" />
                                            )}
                                            {m.type === 'VIDEO' && (
                                                <span className="absolute top-1 left-1 bg-black/60 rounded p-0.5 text-white">
                                                    <Video className="h-2.5 w-2.5" />
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )
                        )}

                    {tab === "docs" && (
                        docMessages.length === 0 ? (
                            <div className="py-12 text-center text-muted-foreground">
                                <FileText className="h-10 w-10 mx-auto opacity-30 mb-2" />
                                <p className="text-xs">Nenhum documento compartilhado nesta conversa.</p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {docMessages.map(m => (
                                    <div key={m.keyId} className="p-3 rounded-xl bg-muted/30 border border-border/25 flex items-center justify-between gap-3 hover:bg-muted/50 transition-colors">
                                        <div className="h-9 w-9 rounded-lg bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                                            <FileText className="h-5 w-5" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium text-foreground truncate">{m.content || `DOCUMENTO-${m.keyId}`}</p>
                                            <span className="text-[10px] text-muted-foreground">{new Date(m.timestamp).toLocaleDateString("pt-BR")} às {new Date(m.timestamp).toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                        <a
                                            href={m.mediaUrl}
                                            download={m.content || `DOCUMENTO-${m.keyId}`}
                                            className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                                            title="Baixar documento"
                                        >
                                            <Download className="h-4 w-4" />
                                        </a>
                                    </div>
                                ))}
                            </div>
                        )
                    )}

                    {tab === "audio" && (
                        audioMessages.length === 0 ? (
                            <div className="py-12 text-center text-muted-foreground">
                                <Music className="h-10 w-10 mx-auto opacity-30 mb-2" />
                                <p className="text-xs">Nenhum áudio compartilhado nesta conversa.</p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {audioMessages.map(m => (
                                    <div key={m.keyId} className="p-3 rounded-xl bg-muted/30 border border-border/25 flex items-center justify-between gap-3">
                                        <div className="flex-1 min-w-0">
                                            <span className="text-[10px] text-muted-foreground block mb-1">
                                                {m.fromMe ? "Enviado por você" : (m.pushName || "Contato")} • {new Date(m.timestamp).toLocaleDateString("pt-BR")} às {new Date(m.timestamp).toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                            <audio src={m.mediaUrl} controls className="w-full h-8" preload="none" />
                                        </div>
                                        <a
                                            href={m.mediaUrl}
                                            download={`AUDIO-${m.keyId}.mp3`}
                                            className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
                                            title="Baixar áudio"
                                        >
                                            <Download className="h-4 w-4" />
                                        </a>
                                    </div>
                                ))}
                            </div>
                        )
                    )}

                    {tab === "links" && (
                        linkItems.length === 0 ? (
                            <div className="py-12 text-center text-muted-foreground">
                                <ExternalLink className="h-10 w-10 mx-auto opacity-30 mb-2" />
                                <p className="text-xs">Nenhum link encontrado nas mensagens.</p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {linkItems.map((item, idx) => (
                                    <a
                                        key={idx}
                                        href={item.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-3 rounded-xl bg-muted/30 border border-border/25 flex items-center justify-between gap-3 hover:bg-muted/50 transition-colors group"
                                    >
                                        <div className="flex-1 min-w-0">
                                            <span className="text-xs font-semibold text-[#00a884] dark:text-[#25d366] truncate block group-hover:underline">{item.url}</span>
                                            <p className="text-[11px] text-muted-foreground truncate">{item.text}</p>
                                        </div>
                                        <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-foreground shrink-0" />
                                    </a>
                                ))}
                            </div>
                        )
                    )}

                    {tab === "starred" && (
                        starredMessages.length === 0 ? (
                            <div className="py-12 text-center text-muted-foreground">
                                <Star className="h-10 w-10 mx-auto opacity-30 mb-2 text-amber-500" />
                                <p className="text-xs">Nenhuma mensagem favoritada nesta conversa.</p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {starredMessages.map(m => (
                                    <div
                                        key={m.keyId}
                                        onClick={() => {
                                            onClose();
                                            setTimeout(() => {
                                                const target = document.getElementById(`msg-${m.keyId}`);
                                                if (target) {
                                                    target.scrollIntoView({ behavior: "smooth", block: "center" });
                                                    target.classList.add("bg-amber-500/20", "transition-colors", "duration-500");
                                                    setTimeout(() => target.classList.remove("bg-amber-500/20"), 1500);
                                                }
                                            }, 120);
                                        }}
                                        className="p-3 rounded-xl bg-muted/30 border border-border/25 flex items-start justify-between gap-3 hover:bg-muted/50 transition-colors cursor-pointer"
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5 mb-1">
                                                <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />
                                                <span className="text-[11px] font-semibold text-foreground truncate">
                                                    {m.fromMe ? "Você" : (m.pushName || "Contato")}
                                                </span>
                                                <span className="text-[10px] text-muted-foreground">
                                                    • {new Date(m.timestamp).toLocaleDateString("pt-BR")} às {new Date(m.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                                                </span>
                                            </div>
                                            <p className="text-xs text-foreground/90 whitespace-pre-wrap line-clamp-3">
                                                {m.content || `[${m.type}]`}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    )}

                    {tab === "members" && isGroup && (
                        <div className="flex flex-col gap-3">
                            <Input
                                placeholder="Pesquisar membro pelo nome ou número..."
                                value={participantSearch}
                                onChange={e => setParticipantSearch(e.target.value)}
                                className="h-9 text-xs"
                            />
                            <div className="divide-y border rounded-xl overflow-hidden max-h-72 overflow-y-auto styled-scrollbar">
                                {filteredParticipants.length === 0 ? (
                                    <p className="p-4 text-xs text-muted-foreground text-center">Nenhum membro encontrado.</p>
                                ) : (
                                    filteredParticipants.map(p => {
                                        const rawNum = (p.phoneNumber || p.id || "").split("@")[0].replace(/\D/g, "");
                                        const targetJid = rawNum ? `${rawNum}@s.whatsapp.net` : p.id;
                                        return (
                                            <div key={p.id} className="p-2.5 flex items-center justify-between gap-3 hover:bg-muted/40 transition-colors">
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    <div className="h-8 w-8 rounded-full bg-[#00a884]/20 text-[#00a884] font-bold text-xs flex items-center justify-center shrink-0">
                                                        {(p.name || p.id).slice(0, 1).toUpperCase()}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <span className="text-xs font-medium text-foreground block truncate">{p.name || "Participante"}</span>
                                                        <span className="text-[10px] font-mono text-muted-foreground block truncate">{p.phoneNumber || p.id}</span>
                                                    </div>
                                                </div>
                                                {targetJid && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7 px-2.5 text-[11px] text-[#00a884] hover:bg-[#00a884]/10 gap-1 shrink-0 cursor-pointer"
                                                        onClick={() => {
                                                            window.dispatchEvent(new CustomEvent("zapflow:open-chat", {
                                                                detail: { jid: targetJid, name: p.name || rawNum }
                                                            }));
                                                            onClose();
                                                        }}
                                                    >
                                                        <MessageCircle className="h-3.5 w-3.5" />
                                                        Conversar
                                                    </Button>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    )}
                    </div>
                </div>

                {/* Danger Actions Card (#C39: Block/Unblock Contact & Clear Chat) */}
                <div className="bg-white dark:bg-[#111b21] shadow-2xs border-y border-border/10 divide-y divide-border/10">
                    {onClearChat && (
                        <button
                            type="button"
                            onClick={onClearChat}
                            className="w-full px-4 py-3 flex items-center gap-3 text-xs font-medium text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer text-left"
                        >
                            <Trash2 className="h-4 w-4 shrink-0" />
                            <span>Limpar mensagens da conversa</span>
                        </button>
                    )}
                    {!isGroup && onToggleBlock && (
                        <button
                            type="button"
                            onClick={onToggleBlock}
                            className="w-full px-4 py-3 flex items-center gap-3 text-xs font-medium text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer text-left"
                        >
                            <X className="h-4 w-4 shrink-0" />
                            <span>{isBlocked ? `Desbloquear ${displayName}` : `Bloquear ${displayName}`}</span>
                        </button>
                    )}
                </div>
            </div>
        </aside>
    );
}

function QuickRepliesManagerModal({
    isOpen,
    onClose,
    quickReplies,
    onSave
}: {
    isOpen: boolean;
    onClose: () => void;
    quickReplies: QuickReplyItem[];
    onSave: (items: QuickReplyItem[]) => void;
}) {
    const [list, setList] = useState<QuickReplyItem[]>(quickReplies);
    const [newShortcut, setNewShortcut] = useState("");
    const [newLabel, setNewLabel] = useState("");
    const [newText, setNewText] = useState("");

    useEffect(() => {
        setList(quickReplies);
    }, [quickReplies]);

    if (!isOpen) return null;

    const handleAdd = (e: React.FormEvent) => {
        e.preventDefault();
        const sc = newShortcut.trim().startsWith("/") ? newShortcut.trim().toLowerCase() : `/${newShortcut.trim().toLowerCase()}`;
        if (!sc || sc.length < 2) {
            toast.error("Informe um atalho válido começando com /");
            return;
        }
        if (!newLabel.trim()) {
            toast.error("Informe um título para o modelo");
            return;
        }
        if (!newText.trim()) {
            toast.error("Informe o texto da mensagem");
            return;
        }
        const updated = [...list.filter(item => item.shortcut !== sc), { shortcut: sc, label: newLabel.trim(), text: newText.trim() }];
        setList(updated);
        onSave(updated);
        setNewShortcut("");
        setNewLabel("");
        setNewText("");
        toast.success(`Atalho ${sc} salvo!`);
    };

    const handleDelete = (sc: string) => {
        const updated = list.filter(item => item.shortcut !== sc);
        setList(updated);
        onSave(updated);
        toast.success("Resposta rápida removida");
    };

    const handleReset = () => {
        setList(DEFAULT_QUICK_REPLIES);
        onSave(DEFAULT_QUICK_REPLIES);
        toast.success("Modelos restaurados para o padrão!");
    };

    return (
        <div className="fixed inset-0 z-[99999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150 select-none" onClick={onClose}>
            <div className="w-full max-w-xl bg-white dark:bg-[#202c33] rounded-2xl shadow-2xl border border-border/30 overflow-hidden flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="px-5 py-3.5 border-b border-border/15 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-foreground">
                        <Zap className="h-4 w-4 text-amber-500" />
                        <h3 className="font-semibold text-sm">Gerenciador de Respostas Rápidas</h3>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground cursor-pointer" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                {/* Form to add new */}
                <form onSubmit={handleAdd} className="p-4 bg-muted/20 border-b border-border/10 flex flex-col gap-2.5">
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Atalho (ex: /tabela)</label>
                            <input
                                type="text"
                                value={newShortcut}
                                onChange={e => setNewShortcut(e.target.value)}
                                placeholder="/exemplo"
                                className="w-full px-3 py-1.5 rounded-lg bg-background border border-border/40 text-xs font-mono outline-none focus:border-[#00a884]"
                            />
                        </div>
                        <div>
                            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Título / Rótulo</label>
                            <input
                                type="text"
                                value={newLabel}
                                onChange={e => setNewLabel(e.target.value)}
                                placeholder="Nome descritivo"
                                className="w-full px-3 py-1.5 rounded-lg bg-background border border-border/40 text-xs outline-none focus:border-[#00a884]"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Texto completo da mensagem</label>
                        <textarea
                            value={newText}
                            onChange={e => setNewText(e.target.value)}
                            placeholder="Digite o texto que será colado automaticamente ao usar este atalho..."
                            rows={2}
                            className="w-full px-3 py-2 rounded-lg bg-background border border-border/40 text-xs outline-none resize-none focus:border-[#00a884]"
                        />
                    </div>
                    <div className="flex justify-end">
                        <Button type="submit" size="sm" className="bg-[#00a884] hover:bg-[#00a884]/90 text-white text-xs gap-1.5 cursor-pointer">
                            <Plus className="h-3.5 w-3.5" /> Adicionar Atalho
                        </Button>
                    </div>
                </form>

                {/* List of current quick replies */}
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2 styled-scrollbar">
                    <div className="flex items-center justify-between text-xs text-muted-foreground font-medium mb-1">
                        <span>Atalhos cadastrados ({list.length})</span>
                        <button type="button" onClick={handleReset} className="text-[11px] text-muted-foreground hover:text-foreground underline cursor-pointer">
                            Restaurar padrões
                        </button>
                    </div>
                    {list.map(item => (
                        <div key={item.shortcut} className="p-3 rounded-xl bg-background border border-border/30 flex items-start justify-between gap-3 group hover:border-[#00a884]/40 transition-colors">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="font-mono text-xs font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-md">
                                        {item.shortcut}
                                    </span>
                                    <span className="text-xs font-medium text-foreground truncate">{item.label}</span>
                                </div>
                                <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-2">{item.text}</p>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-full text-muted-foreground hover:text-red-500 hover:bg-red-500/10 cursor-pointer shrink-0"
                                onClick={() => handleDelete(item.shortcut)}
                                title="Excluir atalho"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function playNotificationChime() {
    if (typeof window === "undefined") return;
    try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.25);
    } catch {}
}

function showDesktopNotification(title: string, body: string, icon?: string) {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
        try {
            const n = new Notification(title, {
                body,
                icon: icon || "/favicon.ico",
                badge: "/favicon.ico",
                tag: "zapflow-msg"
            });
            n.onclick = () => {
                window.focus();
                n.close();
            };
        } catch {}
    } else if (Notification.permission === "default") {
        try {
            Notification.requestPermission();
        } catch {}
    }
}

const EMOJI_CATEGORIES = [
    {
        id: "freq",
        label: "Frequentes",
        emojis: ["👍", "✅", "🙏", "🚛", "📦", "📍", "⚠️", "🚨", "😀", "😂", "❤️", "🤝", "🔥", "👏", "💰", "📄", "⏰", "📞", "👀", "🚀"]
    },
    {
        id: "logistics",
        label: "Frota & Operação",
        emojis: ["🚛", "🚚", "🚜", "📦", "📍", "🗺️", "⛽", "🛠️", "⚠️", "🚨", "🛑", "✅", "❌", "📄", "📋", "📊", "💰", "💳", "🧾", "🔐", "🏢", "🏭", "🌾", "🌽", "🌱", "⚖️", "⏱️", "📅", "📲", "📞"]
    },
    {
        id: "faces",
        label: "Rostos & Gestos",
        emojis: ["😀", "😃", "😄", "😁", "😅", "😂", "🤣", "😊", "😇", "🙂", "😉", "😌", "😍", "😎", "🤩", "🤔", "🤨", "😐", "🙄", "😮", "😢", "😭", "😤", "👍", "👎", "👌", "✌️", "🤞", "🙏", "🤝", "👏", "🙌", "💪", "👋", "🫡"]
    },
    {
        id: "symbols",
        label: "Símbolos",
        emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💯", "💥", "✨", "⭐", "🌟", "⚡", "🔥", "🎉", "🎊", "📌", "📎", "🔗", "🔍", "📢", "🔔", "🔕", "🟢", "🟡", "🔴", "🔵", "⬆️", "➡️", "⬇️"]
    }
];

function persistChatDraft(sessionId: string | undefined, jid: string, text: string) {
    if (typeof window === "undefined" || !sessionId || !jid) return;
    try {
        const key = `zapflow_drafts_${sessionId}`;
        const raw = localStorage.getItem(key);
        const map: Record<string, string> = raw ? JSON.parse(raw) : {};
        if (text.trim()) {
            map[jid] = text;
        } else {
            delete map[jid];
        }
        localStorage.setItem(key, JSON.stringify(map));
        window.dispatchEvent(new CustomEvent("zapflow:draft-changed", { detail: { jid, text } }));
    } catch {}
}

// ─── Isolated Chat Input Bar (Local state = 120 FPS typing with zero message re-renders) ───
function ChatInputBar({
    onSend,
    onSendAudio,
    onUpload,
    onPasteFile,
    onOpenSendContact,
    onOpenSendLocation,
    onOpenSendPoll,
    onOpenScheduleMessage,
    onOpenAIAssistant,
    onOpenCamera,
    availableStickers = [],
    onSendStickerFile,
    onSendStickerUrl,
    replyingTo,
    onCancelReply,
    jid,
    sessionId,
    isGroup,
    participants = []
}: {
    onSend: (text: string, mentions?: string[]) => void;
    onSendAudio?: (blob: Blob, mimeType: string) => void;
    onUpload: (type: string) => void;
    onPasteFile?: (file: File) => void;
    onOpenSendContact?: () => void;
    onOpenSendLocation?: () => void;
    onOpenSendPoll?: () => void;
    onOpenScheduleMessage?: (draftText: string) => void;
    onOpenAIAssistant?: (initialMode: ChatAIAssistantMode, draftText: string) => void;
    onOpenCamera?: () => void;
    availableStickers?: string[];
    onSendStickerFile?: (file: File) => void;
    onSendStickerUrl?: (url: string) => void;
    replyingTo: Message | null;
    onCancelReply: () => void;
    jid: string;
    sessionId?: string;
    isGroup?: boolean;
    participants?: GroupParticipant[];
}) {
    const [input, setInput] = useState("");
    const [emojiTab, setEmojiTab] = useState<string>("freq");
    const [pickerMode, setPickerMode] = useState<"emoji" | "sticker">("emoji");
    const [emojiSearch, setEmojiSearch] = useState("");
    const [dismissedLinkUrl, setDismissedLinkUrl] = useState<string | null>(null);
    const [isRewritingDraft, setIsRewritingDraft] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const stickerInputRef = useRef<HTMLInputElement>(null);
    const lastTypingSentRef = useRef<number>(0);

    // Detect URL in input for live WhatsApp Web Link Preview (#C37)
    const detectedInputUrl = useMemo(() => {
        const m = input.match(/https?:\/\/[^\s]+/i);
        if (!m) return null;
        return m[0] === dismissedLinkUrl ? null : m[0];
    }, [input, dismissedLinkUrl]);

    // Allow external AI Assistant modal to inject text directly into the input bar (#C29)
    useEffect(() => {
        const handleSetInput = (e: Event) => {
            const { text } = (e as CustomEvent<{ text: string }>).detail || {};
            if (typeof text === "string") {
                setInput(text);
                persistChatDraft(sessionId, jid, text);
                setTimeout(() => {
                    if (inputRef.current) {
                        inputRef.current.focus();
                        inputRef.current.style.height = "auto";
                        inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + "px";
                    }
                }, 20);
            }
        };
        window.addEventListener("zapflow:set-chat-input", handleSetInput);
        return () => window.removeEventListener("zapflow:set-chat-input", handleSetInput);
    }, [sessionId, jid]);

    const handleInlineAIRewrite = async (mode: ChatAIAssistantMode) => {
        if (!input.trim()) {
            onOpenAIAssistant?.(mode, "");
            return;
        }
        setIsRewritingDraft(true);
        try {
            const keys = loadSavedLLMKeys();
            const res = await runChatAIAssistant(mode, input, [], undefined, keys);
            if (res.result) {
                setInput(res.result);
                persistChatDraft(sessionId, jid, res.result);
                toast.success(`✨ Texto aprimorado (${res.provider})`);
                setTimeout(() => {
                    if (inputRef.current) {
                        inputRef.current.focus();
                        inputRef.current.style.height = "auto";
                        inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + "px";
                    }
                }, 20);
            }
        } catch (err: any) {
            toast.error(err?.message || "Erro ao processar texto com IA");
        } finally {
            setIsRewritingDraft(false);
        }
    };

    // Audio recording state (#C20)
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [recordedPreview, setRecordedPreview] = useState<{ blob: Blob; url: string; mimeType: string } | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Mention state
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [mentionCursorIdx, setMentionCursorIdx] = useState<number>(-1);
    const [selectedMentionIdx, setSelectedMentionIdx] = useState(0);

    // Quick Replies state (/)
    const [quickReplyQuery, setQuickReplyQuery] = useState<string | null>(null);
    const [quickReplyCursorIdx, setQuickReplyCursorIdx] = useState<number>(-1);
    const [selectedQuickReplyIdx, setSelectedQuickReplyIdx] = useState(0);
    const [quickReplies, setQuickReplies] = useState<QuickReplyItem[]>(DEFAULT_QUICK_REPLIES);
    const [isQuickRepliesManagerOpen, setIsQuickRepliesManagerOpen] = useState(false);

    useEffect(() => {
        setQuickReplies(loadQuickReplies());
        const handleUpdated = () => setQuickReplies(loadQuickReplies());
        window.addEventListener("zapflow:quick-replies-updated", handleUpdated);
        return () => window.removeEventListener("zapflow:quick-replies-updated", handleUpdated);
    }, []);

    const filteredQuickReplies = useMemo(() => {
        if (quickReplyQuery === null) return [];
        const q = quickReplyQuery.toLowerCase().trim();
        if (!q) return quickReplies;
        return quickReplies.filter(r =>
            r.shortcut.toLowerCase().includes(q) || r.label.toLowerCase().includes(q) || r.text.toLowerCase().includes(q)
        );
    }, [quickReplyQuery, quickReplies]);

    const handleSelectQuickReply = (r: QuickReplyItem) => {
        let before = "";
        let after = "";
        if (quickReplyCursorIdx === -1 || (quickReplyQuery === "" && !input.includes("/"))) {
            before = input.trim() ? `${input.trim()} ` : "";
            after = "";
        } else {
            before = input.slice(0, quickReplyCursorIdx);
            const queryLen = quickReplyQuery ? quickReplyQuery.length : 0;
            after = input.slice(quickReplyCursorIdx + 1 + queryLen);
        }
        const nextInput = `${before}${r.text}${after.startsWith(" ") ? after : (after ? " " + after : "")}`;
        setInput(nextInput);
        persistChatDraft(sessionId, jid, nextInput);
        setQuickReplyQuery(null);
        setQuickReplyCursorIdx(-1);

        setTimeout(() => {
            if (inputRef.current) {
                inputRef.current.focus();
                const pos = before.length + r.text.length;
                inputRef.current.setSelectionRange(pos, pos);
            }
        }, 10);
    };

    const handleInsertEmoji = (emoji: string) => {
        const el = inputRef.current;
        const start = el?.selectionStart ?? input.length;
        const end = el?.selectionEnd ?? input.length;
        const nextInput = input.slice(0, start) + emoji + input.slice(end);
        setInput(nextInput);
        persistChatDraft(sessionId, jid, nextInput);
        setTimeout(() => {
            if (inputRef.current) {
                inputRef.current.focus();
                const pos = start + emoji.length;
                inputRef.current.setSelectionRange(pos, pos);
            }
        }, 10);
    };

    // WhatsApp Text Formatting helper (#C24)
    const applyFormatting = (prefix: string, suffix = prefix) => {
        const el = inputRef.current;
        const start = el?.selectionStart ?? input.length;
        const end = el?.selectionEnd ?? input.length;
        const selected = input.slice(start, end);
        const placeholder = selected || "texto";
        const replacement = `${prefix}${placeholder}${suffix}`;
        const nextInput = input.slice(0, start) + replacement + input.slice(end);
        setInput(nextInput);
        persistChatDraft(sessionId, jid, nextInput);
        setTimeout(() => {
            if (inputRef.current) {
                inputRef.current.focus();
                if (selected) {
                    const pos = start + replacement.length;
                    inputRef.current.setSelectionRange(pos, pos);
                } else {
                    inputRef.current.setSelectionRange(start + prefix.length, start + prefix.length + placeholder.length);
                }
            }
        }, 10);
    };

    const startRecording = async () => {
        try {
            if (!navigator.mediaDevices?.getUserMedia) {
                toast.error("Navegador não suporta gravação de áudio");
                return;
            }

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            let mimeType = 'audio/webm;codecs=opus';
            if (typeof MediaRecorder !== 'undefined') {
                if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
                    mimeType = 'audio/ogg;codecs=opus';
                } else if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                    mimeType = 'audio/webm;codecs=opus';
                } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
                    mimeType = 'audio/mp4';
                } else {
                    mimeType = '';
                }
            }

            const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            mediaRecorderRef.current = recorder;
            audioChunksRef.current = [];

            recorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                }
            };

            recorder.start(250);
            setIsRecording(true);
            setRecordingTime(0);
            if (sessionId && jid) {
                sendChatPresence(sessionId, jid, "recording").catch(() => {});
            }

            if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = setInterval(() => {
                setRecordingTime(prev => prev + 1);
            }, 1000);
        } catch (err: any) {
            console.error("Erro ao iniciar gravação:", err);
            toast.error("Permissão de microfone negada ou indisponível");
        }
    };

    const cancelRecording = () => {
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        if (mediaRecorderRef.current) {
            if (mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop();
            }
            mediaRecorderRef.current.stream?.getTracks().forEach(t => t.stop());
        }
        if (recordedPreview?.url) {
            URL.revokeObjectURL(recordedPreview.url);
        }
        setRecordedPreview(null);
        audioChunksRef.current = [];
        setIsRecording(false);
        setRecordingTime(0);
    };

    const pauseAndPreviewRecording = () => {
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        const recorder = mediaRecorderRef.current;
        if (!recorder) return;

        const currentStream = recorder.stream;
        const actualMime = recorder.mimeType || 'audio/ogg';

        recorder.onstop = () => {
            currentStream?.getTracks().forEach(t => t.stop());
            const audioBlob = new Blob(audioChunksRef.current, { type: actualMime });
            audioChunksRef.current = [];
            if (audioBlob.size > 0) {
                const url = URL.createObjectURL(audioBlob);
                setRecordedPreview({ blob: audioBlob, url, mimeType: actualMime });
            }
        };

        if (recorder.state !== 'inactive') {
            recorder.stop();
        }
    };

    const stopAndSendRecording = () => {
        if (recordedPreview) {
            const { blob, mimeType, url } = recordedPreview;
            URL.revokeObjectURL(url);
            setRecordedPreview(null);
            setIsRecording(false);
            setRecordingTime(0);
            if (blob.size > 0 && onSendAudio) {
                onSendAudio(blob, mimeType);
            }
            return;
        }

        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        const recorder = mediaRecorderRef.current;
        if (!recorder) return;

        const currentStream = recorder.stream;
        const actualMime = recorder.mimeType || 'audio/ogg';

        recorder.onstop = () => {
            currentStream?.getTracks().forEach(t => t.stop());
            const audioBlob = new Blob(audioChunksRef.current, { type: actualMime });
            audioChunksRef.current = [];
            setIsRecording(false);
            setRecordingTime(0);
            if (audioBlob.size > 0 && onSendAudio) {
                onSendAudio(audioBlob, actualMime);
            }
        };

        if (recorder.state !== 'inactive') {
            recorder.stop();
        }
    };

    const formatRecordingTime = (secs: number) => {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    useEffect(() => {
        return () => {
            if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
            if (mediaRecorderRef.current?.state !== 'inactive') {
                mediaRecorderRef.current?.stop();
                mediaRecorderRef.current?.stream?.getTracks().forEach(t => t.stop());
            }
        };
    }, []);

    // Filter participants by mention query
    const filteredParticipants = useMemo(() => {
        if (!isGroup || mentionQuery === null) return [];
        const q = mentionQuery.toLowerCase().trim();
        if (!q) return participants.slice(0, 10);
        return participants.filter(p =>
            p.name.toLowerCase().includes(q) || (p.phoneNumber && p.phoneNumber.includes(q))
        ).slice(0, 10);
    }, [isGroup, mentionQuery, participants]);

    // Handle selecting a participant from autocomplete
    const handleSelectParticipant = (p: GroupParticipant) => {
        if (mentionCursorIdx === -1) return;
        const before = input.slice(0, mentionCursorIdx);
        const queryLen = mentionQuery ? mentionQuery.length : 0;
        const after = input.slice(mentionCursorIdx + 1 + queryLen);
        const mentionTag = `@${p.name} `;
        const nextInput = `${before}${mentionTag}${after}`;
        setInput(nextInput);
        persistChatDraft(sessionId, jid, nextInput);
        setMentionQuery(null);
        setMentionCursorIdx(-1);

        setTimeout(() => {
            if (inputRef.current) {
                inputRef.current.focus();
                const pos = before.length + mentionTag.length;
                inputRef.current.setSelectionRange(pos, pos);
            }
        }, 10);
    };

    // Auto-focus when replying
    useEffect(() => {
        if (replyingTo && inputRef.current) {
            inputRef.current.focus();
        }
    }, [replyingTo]);

    // Focus on jid change & load saved per-chat draft (#C13)
    useEffect(() => {
        inputRef.current?.focus();
        setMentionQuery(null);
        setQuickReplyQuery(null);
        cancelRecording();
        if (typeof window !== "undefined" && sessionId && jid) {
            try {
                const raw = localStorage.getItem(`zapflow_drafts_${sessionId}`);
                const map: Record<string, string> = raw ? JSON.parse(raw) : {};
                setInput(map[jid] || "");
            } catch {
                setInput("");
            }
        } else {
            setInput("");
        }
    }, [jid, sessionId]);

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setInput(val);
        persistChatDraft(sessionId, jid, val);
        const el = e.target;
        el.style.height = "auto";
        el.style.height = Math.min(el.scrollHeight, 120) + "px";

        // Send typing presence (throttled every 4 seconds)
        if (sessionId && jid && val.trim().length > 0) {
            const now = Date.now();
            if (now - lastTypingSentRef.current > 4000) {
                lastTypingSentRef.current = now;
                sendChatPresence(sessionId, jid, "composing").catch(() => {});
            }
        }

        const cursor = el.selectionStart || 0;
        const textBefore = val.slice(0, cursor);

        // Quick replies trigger (/)
        const slashMatch = textBefore.match(/\/([a-zA-Z0-9_\u00C0-\u00FF]*)$/);
        if (slashMatch) {
            setQuickReplyQuery(slashMatch[1]);
            setQuickReplyCursorIdx(slashMatch.index!);
            setSelectedQuickReplyIdx(0);
        } else {
            setQuickReplyQuery(null);
        }

        if (isGroup) {
            const atMatch = textBefore.match(/@([a-zA-Z0-9_\u00C0-\u00FF]*)$/);
            if (atMatch) {
                setMentionQuery(atMatch[1]);
                setMentionCursorIdx(atMatch.index!);
                setSelectedMentionIdx(0);
            } else {
                setMentionQuery(null);
            }
        }
    };

    const handleSend = () => {
        const text = input.trim();
        if (!text) return;

        // Extract mentions if in group
        let mentions: string[] | undefined = undefined;
        if (isGroup && participants.length > 0) {
            const foundMentions = new Set<string>();
            for (const p of participants) {
                if (p.name && text.includes(`@${p.name}`)) {
                    foundMentions.add(p.id.endsWith('@lid') || p.id.endsWith('@s.whatsapp.net') ? p.id : `${p.id}@s.whatsapp.net`);
                    if (p.phoneNumber) {
                        foundMentions.add(p.phoneNumber.endsWith('@s.whatsapp.net') ? p.phoneNumber : `${p.phoneNumber}@s.whatsapp.net`);
                    }
                }
            }
            if (foundMentions.size > 0) {
                mentions = Array.from(foundMentions);
            }
        }

        setInput("");
        persistChatDraft(sessionId, jid, "");
        setMentionQuery(null);
        setQuickReplyQuery(null);
        if (inputRef.current) {
            inputRef.current.style.height = "auto";
        }
        onSend(text, mentions);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // Quick replies keyboard navigation
        if (quickReplyQuery !== null && filteredQuickReplies.length > 0) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedQuickReplyIdx(prev => (prev + 1) % filteredQuickReplies.length);
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedQuickReplyIdx(prev => (prev - 1 + filteredQuickReplies.length) % filteredQuickReplies.length);
                return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const chosen = filteredQuickReplies[selectedQuickReplyIdx] || filteredQuickReplies[0];
                if (chosen) handleSelectQuickReply(chosen);
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                setQuickReplyQuery(null);
                return;
            }
        }

        if (mentionQuery !== null && filteredParticipants.length > 0) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedMentionIdx(prev => (prev + 1) % filteredParticipants.length);
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedMentionIdx(prev => (prev - 1 + filteredParticipants.length) % filteredParticipants.length);
                return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const chosen = filteredParticipants[selectedMentionIdx] || filteredParticipants[0];
                if (chosen) handleSelectParticipant(chosen);
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                setMentionQuery(null);
                return;
            }
        }

        // WhatsApp formatting keyboard shortcuts (#C24: Ctrl+B = *bold*, Ctrl+I = _italic_)
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
            e.preventDefault();
            applyFormatting("*", "*");
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
            e.preventDefault();
            applyFormatting("_", "_");
            return;
        }

        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="shrink-0 px-3.5 py-2.5 bg-[#f0f2f5] dark:bg-[#202c33] border-t border-border/15 relative">
            {/* Quick Replies Autocomplete Popover (/) */}
            {quickReplyQuery !== null && (
                <div className="mb-2 p-1.5 rounded-2xl bg-white dark:bg-[#233138] border border-border/40 shadow-2xl animate-in slide-in-from-bottom-2 duration-150 max-h-56 overflow-y-auto no-scrollbar max-w-md">
                    <div className="px-3 py-1.5 text-[11px] font-semibold text-amber-500 uppercase tracking-wider flex items-center justify-between border-b border-border/10 mb-1">
                        <span className="flex items-center gap-1.5">
                            <Zap className="h-3.5 w-3.5" />
                            <span>Respostas Rápidas ({filteredQuickReplies.length})</span>
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setIsQuickRepliesManagerOpen(true)}
                                className="hover:underline flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                                title="Gerenciar modelos salvos"
                            >
                                <Settings className="h-3 w-3" />
                                <span>Gerenciar</span>
                            </button>
                            <span className="text-[10px] text-muted-foreground lowercase">↑↓ Enter</span>
                        </div>
                    </div>
                    {filteredQuickReplies.length === 0 ? (
                        <div className="p-3 text-center">
                            <p className="text-xs text-muted-foreground mb-2">Nenhum atalho encontrado para &quot;/{quickReplyQuery}&quot;</p>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="text-xs gap-1.5 h-7 cursor-pointer"
                                onClick={() => setIsQuickRepliesManagerOpen(true)}
                            >
                                <Plus className="h-3.5 w-3.5" /> Criar nova resposta rápida
                            </Button>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-0.5">
                            {filteredQuickReplies.map((r, idx) => (
                                <button
                                    key={r.shortcut}
                                    type="button"
                                    onClick={() => handleSelectQuickReply(r)}
                                    className={cn(
                                        "w-full px-3 py-2 rounded-xl text-left transition-colors cursor-pointer select-none flex flex-col gap-0.5",
                                        idx === selectedQuickReplyIdx
                                            ? "bg-amber-500/15 dark:bg-amber-500/25 text-foreground"
                                            : "hover:bg-black/5 dark:hover:bg-white/5 text-foreground"
                                    )}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="font-mono text-xs font-semibold text-amber-600 dark:text-amber-400">{r.shortcut}</span>
                                        <span className="text-[11px] font-medium text-muted-foreground">{r.label}</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground truncate">{r.text}</p>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Quick Replies Manager Modal */}
            <QuickRepliesManagerModal
                isOpen={isQuickRepliesManagerOpen}
                onClose={() => setIsQuickRepliesManagerOpen(false)}
                quickReplies={quickReplies}
                onSave={(updated) => {
                    setQuickReplies(updated);
                    saveQuickReplies(updated);
                }}
            />

            {/* WhatsApp Group Mentions Autocomplete Popover */}
            {mentionQuery !== null && filteredParticipants.length > 0 && (
                <div className="mb-2 p-1.5 rounded-2xl bg-white dark:bg-[#233138] border border-border/40 shadow-2xl animate-in slide-in-from-bottom-2 duration-150 max-h-56 overflow-y-auto no-scrollbar">
                    <div className="px-3 py-1.5 text-[11px] font-semibold text-[#00a884] dark:text-[#25d366] uppercase tracking-wider flex items-center gap-1.5 border-b border-border/10 mb-1">
                        <AtSign className="h-3.5 w-3.5" />
                        <span>Mencionar participante ({filteredParticipants.length})</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                        {filteredParticipants.map((p, idx) => (
                            <button
                                key={p.id || idx}
                                type="button"
                                onClick={() => handleSelectParticipant(p)}
                                className={cn(
                                    "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-left transition-colors cursor-pointer select-none",
                                    idx === selectedMentionIdx
                                        ? "bg-[#00a884]/15 dark:bg-[#00a884]/25 text-foreground"
                                        : "hover:bg-black/5 dark:hover:bg-white/5 text-foreground"
                                )}
                            >
                                <Avatar className="h-7 w-7 shrink-0">
                                    <AvatarImage
                                        src={`/api/avatar/${sessionId}/${encodeURIComponent(p.avatarJid || p.id)}`}
                                        referrerPolicy="no-referrer"
                                    />
                                    <AvatarFallback className="text-[10px] font-bold bg-[#00a884]/20 text-[#00a884]">
                                        {p.name.slice(0, 2).toUpperCase()}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium truncate leading-tight">{p.name}</p>
                                    {p.phoneNumber && (
                                        <p className="text-[10px] text-muted-foreground truncate">{p.phoneNumber.split('@')[0]}</p>
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Live URL Link Preview Bar above input (#C37) */}
            {detectedInputUrl && (() => {
                let host = detectedInputUrl;
                try {
                    host = new URL(detectedInputUrl).hostname.replace(/^www\./, "");
                } catch {}
                return (
                    <div className="mb-2 p-2 rounded-xl bg-white/90 dark:bg-[#111b21]/90 backdrop-blur-sm border-l-4 border-[#00a884] flex items-center justify-between gap-2.5 text-xs animate-in slide-in-from-bottom-2 duration-150">
                        <div className="h-9 w-9 rounded-lg bg-[#00a884]/15 text-[#00a884] flex items-center justify-center shrink-0">
                            <ExternalLink className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <span className="font-semibold text-foreground block truncate">{host}</span>
                            <span className="text-[11px] text-[#00a884] truncate block">{detectedInputUrl}</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setDismissedLinkUrl(detectedInputUrl)}
                            className="p-1 text-muted-foreground hover:text-foreground rounded-full cursor-pointer"
                            title="Remover prévia do link"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                );
            })()}

            {/* Reply preview bar */}
            {replyingTo && (
                <div className="mb-2 p-2 rounded-xl bg-white/80 dark:bg-[#111b21]/80 backdrop-blur-sm border-l-4 border-[#00a884] flex items-center justify-between text-xs animate-in slide-in-from-bottom-2 duration-150">
                    <div className="flex-1 truncate pr-2">
                        <span className="font-semibold text-[#00a884] block truncate">
                            Respondendo a {replyingTo.fromMe ? "Você" : (replyingTo.pushName || jid.split('@')[0])}
                        </span>
                        <span className="text-xs text-muted-foreground truncate block">
                            {replyingTo.type === 'IMAGE' && <Camera className="h-3 w-3 inline mr-1 opacity-70" />}
                            {replyingTo.type === 'VIDEO' && <Video className="h-3 w-3 inline mr-1 opacity-70" />}
                            {replyingTo.content || (replyingTo.type === 'IMAGE' ? "Foto" : (replyingTo.type === 'VIDEO' ? "Vídeo" : `[${replyingTo.type}]`))}
                        </span>
                    </div>
                    {(replyingTo.type === 'IMAGE' || replyingTo.type === 'VIDEO') && replyingTo.mediaUrl && (
                        <div className="h-9 w-9 shrink-0 rounded overflow-hidden mr-2 bg-black/10">
                            <img src={replyingTo.mediaUrl} alt="Thumbnail" className="h-full w-full object-cover" />
                        </div>
                    )}
                    <button
                        onClick={onCancelReply}
                        className="p-1 text-muted-foreground hover:text-foreground rounded-full cursor-pointer"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            {isRecording ? (
                /* WhatsApp Web Recording & Audio Preview Bar (#C20) */
                <div className="flex items-center justify-between gap-2.5 max-w-4xl mx-auto bg-white dark:bg-[#202c33] rounded-2xl px-3.5 py-2 shadow-md border border-red-500/20 animate-in fade-in duration-150">
                    {/* Discard recording */}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={cancelRecording}
                        className="h-9 w-9 rounded-full text-red-500 hover:text-red-600 hover:bg-red-500/10 cursor-pointer shrink-0 transition-colors"
                        title="Descartar gravação"
                    >
                        <Trash2 className="h-5 w-5" />
                    </Button>

                    {recordedPreview ? (
                        /* Inline Audio Preview Player before sending */
                        <div className="flex-1 flex items-center gap-2 min-w-0 px-1">
                            <audio src={recordedPreview.url} controls className="w-full h-9" />
                        </div>
                    ) : (
                        /* Live Recording Indicators + Pause/Preview button */
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse shrink-0" />
                            <span className="font-mono text-sm font-semibold text-red-500 shrink-0">
                                {formatRecordingTime(recordingTime)}
                            </span>
                            <div className="flex-1 flex items-center gap-1 overflow-hidden px-1">
                                <span className="text-xs text-muted-foreground select-none truncate">
                                    Gravando áudio...
                                </span>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={pauseAndPreviewRecording}
                                className="h-8 px-2.5 rounded-full text-xs gap-1.5 border-red-500/30 text-red-500 hover:bg-red-500/10 cursor-pointer shrink-0"
                                title="Pausar e ouvir o áudio antes de enviar"
                            >
                                <Pause className="h-3.5 w-3.5 fill-current" />
                                <span className="hidden sm:inline">Ouvir prévia</span>
                            </Button>
                        </div>
                    )}

                    {/* Send Voice Note */}
                    <Button
                        type="button"
                        onClick={stopAndSendRecording}
                        size="icon"
                        className="h-10 w-10 rounded-full bg-[#00a884] hover:bg-[#00a884]/90 text-white shadow-md shrink-0 active:scale-95 transition-transform cursor-pointer"
                        title="Enviar mensagem de voz"
                    >
                        <Send className="h-4.5 w-4.5 translate-x-0.5" />
                    </Button>
                </div>
            ) : (
                <div className="flex items-end gap-2 max-w-4xl mx-auto">
                    {/* Functional WhatsApp Emoji & Sticker Picker (#C9 & #C35) */}
                    <input
                        type="file"
                        accept="image/*"
                        ref={stickerInputRef}
                        className="hidden"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f && onSendStickerFile) onSendStickerFile(f);
                            if (stickerInputRef.current) stickerInputRef.current.value = "";
                        }}
                    />
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-10 w-10 rounded-full shrink-0 text-[#54656f] dark:text-[#8696a0] hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                                title="Emojis e Figurinhas (Stickers)"
                            >
                                <Smile className="h-5 w-5" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-2.5 rounded-2xl bg-white dark:bg-[#233138] border border-border/40 shadow-2xl" side="top" align="start">
                            {/* Top Switcher: Emojis vs Stickers */}
                            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-muted/60 mb-2">
                                <button
                                    type="button"
                                    onClick={() => setPickerMode("emoji")}
                                    className={cn(
                                        "py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer",
                                        pickerMode === "emoji"
                                            ? "bg-white dark:bg-[#111b21] text-[#00a884] shadow-2xs"
                                            : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    😊 Emojis
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPickerMode("sticker")}
                                    className={cn(
                                        "py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer",
                                        pickerMode === "sticker"
                                            ? "bg-white dark:bg-[#111b21] text-[#00a884] shadow-2xs"
                                            : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    🖼️ Figurinhas ({availableStickers.length})
                                </button>
                            </div>

                            {pickerMode === "emoji" ? (
                                <>
                                    <div className="mb-2">
                                        <Input
                                            placeholder="Pesquisar categoria ou filtrar..."
                                            value={emojiSearch}
                                            onChange={(e) => setEmojiSearch(e.target.value)}
                                            className="h-7 text-xs bg-muted/40"
                                        />
                                    </div>
                                    <div className="flex items-center gap-1 border-b border-border/15 pb-1.5 mb-2 overflow-x-auto no-scrollbar">
                                        {EMOJI_CATEGORIES.map(cat => (
                                            <button
                                                key={cat.id}
                                                type="button"
                                                onClick={() => setEmojiTab(cat.id)}
                                                className={cn(
                                                    "px-2 py-1 rounded-lg text-[10.5px] font-semibold whitespace-nowrap transition-colors cursor-pointer",
                                                    emojiTab === cat.id
                                                        ? "bg-[#00a884]/15 text-[#00a884] dark:text-[#25d366]"
                                                        : "text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
                                                )}
                                            >
                                                {cat.label}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="grid grid-cols-7 gap-1 max-h-48 overflow-y-auto styled-scrollbar p-0.5">
                                        {(emojiSearch.trim()
                                            ? Array.from(new Set(EMOJI_CATEGORIES.flatMap(c => c.emojis)))
                                            : (EMOJI_CATEGORIES.find(c => c.id === emojiTab)?.emojis || EMOJI_CATEGORIES[0].emojis)
                                        ).map(emoji => (
                                            <button
                                                key={emoji}
                                                type="button"
                                                onClick={() => handleInsertEmoji(emoji)}
                                                className="h-9 w-9 rounded-lg flex items-center justify-center text-lg hover:bg-black/5 dark:hover:bg-white/10 hover:scale-110 transition-transform cursor-pointer select-none"
                                            >
                                                {emoji}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <div className="space-y-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => stickerInputRef.current?.click()}
                                        className="w-full h-8 text-xs gap-1.5 border-dashed border-[#00a884]/50 text-[#00a884] hover:bg-[#00a884]/10 cursor-pointer"
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        <span>Criar figurinha de imagem</span>
                                    </Button>

                                    {availableStickers.length === 0 ? (
                                        <div className="py-8 text-center text-xs text-muted-foreground space-y-1">
                                            <p>Nenhuma figurinha salva ainda.</p>
                                            <p className="text-[10.5px]">Clique em &ldquo;Criar figurinha&rdquo; acima ou favorite figurinhas recebidas na conversa!</p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto styled-scrollbar p-1">
                                            {availableStickers.map((sUrl, i) => (
                                                <button
                                                    key={`${sUrl}-${i}`}
                                                    type="button"
                                                    onClick={() => onSendStickerUrl?.(sUrl)}
                                                    className="aspect-square rounded-xl p-1 hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center transition-transform hover:scale-105 cursor-pointer border border-border/20"
                                                    title="Clique para enviar esta figurinha"
                                                >
                                                    <img src={sUrl} alt="Sticker" className="max-h-full max-w-full object-contain" />
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </PopoverContent>
                    </Popover>

                    {/* Attachment Popover (#C22, #C23 & #C36 Camera) */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-10 w-10 rounded-full shrink-0 text-[#54656f] dark:text-[#8696a0] hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                                title="Anexar (Câmera, Fotos, Documento, Áudio, Contato, Localização, Enquete)"
                            >
                                <Paperclip className="h-5 w-5" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-2 rounded-2xl bg-white dark:bg-[#233138] border border-border/40 shadow-xl" side="top" align="start">
                            <div className="flex flex-col gap-1">
                                <Button variant="ghost" size="sm" className="justify-start gap-3 h-9 text-xs rounded-xl cursor-pointer" onClick={() => onOpenCamera?.()}>
                                    <span className="h-7 w-7 rounded-full bg-rose-500/15 text-rose-500 flex items-center justify-center">
                                        <Camera className="h-4 w-4" />
                                    </span>
                                    Câmera (Tirar foto)
                                </Button>
                                <Button variant="ghost" size="sm" className="justify-start gap-3 h-9 text-xs rounded-xl cursor-pointer" onClick={() => onUpload('image')}>
                                    <span className="h-7 w-7 rounded-full bg-blue-500/15 text-blue-500 flex items-center justify-center">
                                        <ImageIcon className="h-4 w-4" />
                                    </span>
                                    Fotos e vídeos
                                </Button>
                                <Button variant="ghost" size="sm" className="justify-start gap-3 h-9 text-xs rounded-xl cursor-pointer" onClick={() => onUpload('document')}>
                                    <span className="h-7 w-7 rounded-full bg-purple-500/15 text-purple-500 flex items-center justify-center">
                                        <FileText className="h-4 w-4" />
                                    </span>
                                    Documento
                                </Button>
                                <Button variant="ghost" size="sm" className="justify-start gap-3 h-9 text-xs rounded-xl cursor-pointer" onClick={() => onUpload('audio')}>
                                    <span className="h-7 w-7 rounded-full bg-orange-500/15 text-orange-500 flex items-center justify-center">
                                        <Music className="h-4 w-4" />
                                    </span>
                                    Áudio
                                </Button>
                                <div className="h-px bg-border/20 my-0.5" />
                                <Button variant="ghost" size="sm" className="justify-start gap-3 h-9 text-xs rounded-xl cursor-pointer" onClick={() => onOpenSendContact?.()}>
                                    <span className="h-7 w-7 rounded-full bg-cyan-500/15 text-cyan-500 flex items-center justify-center">
                                        <User className="h-4 w-4" />
                                    </span>
                                    Contato (vCard)
                                </Button>
                                <Button variant="ghost" size="sm" className="justify-start gap-3 h-9 text-xs rounded-xl cursor-pointer" onClick={() => onOpenSendLocation?.()}>
                                    <span className="h-7 w-7 rounded-full bg-emerald-500/15 text-emerald-500 flex items-center justify-center">
                                        <MapPin className="h-4 w-4" />
                                    </span>
                                    Localização
                                </Button>
                                <Button variant="ghost" size="sm" className="justify-start gap-3 h-9 text-xs rounded-xl cursor-pointer" onClick={() => onOpenSendPoll?.()}>
                                    <span className="h-7 w-7 rounded-full bg-amber-500/15 text-amber-500 flex items-center justify-center">
                                        <BarChart2 className="h-4 w-4" />
                                    </span>
                                    Enquete
                                </Button>
                            </div>
                        </PopoverContent>
                    </Popover>

                    {/* WhatsApp Text Formatting Toolbar Popover (#C24) */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="hidden sm:inline-flex h-10 w-10 rounded-full shrink-0 text-[#54656f] dark:text-[#8696a0] hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                                title="Formatar texto (*Negrito*, _Itálico_, ~Tachado~, `Código`, > Citação)"
                            >
                                <Bold className="h-4.5 w-4.5" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent side="top" align="start" className="w-auto p-1.5 rounded-2xl bg-white dark:bg-[#233138] border border-border/40 shadow-2xl flex items-center gap-1">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2.5 text-xs gap-1 rounded-xl cursor-pointer"
                                onClick={() => applyFormatting("*", "*")}
                                title="Negrito (Ctrl+B)"
                            >
                                <Bold className="h-3.5 w-3.5" />
                                <span>Negrito</span>
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2.5 text-xs gap-1 rounded-xl cursor-pointer"
                                onClick={() => applyFormatting("_", "_")}
                                title="Itálico (Ctrl+I)"
                            >
                                <Italic className="h-3.5 w-3.5" />
                                <span>Itálico</span>
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2.5 text-xs gap-1 rounded-xl cursor-pointer"
                                onClick={() => applyFormatting("~", "~")}
                                title="Tachado"
                            >
                                <Strikethrough className="h-3.5 w-3.5" />
                                <span>Tachado</span>
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2.5 text-xs gap-1 rounded-xl cursor-pointer"
                                onClick={() => applyFormatting("`", "`")}
                                title="Monoespaçado"
                            >
                                <Code className="h-3.5 w-3.5" />
                                <span>Código</span>
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2.5 text-xs gap-1 rounded-xl cursor-pointer"
                                onClick={() => applyFormatting("> ", "")}
                                title="Bloco de citação"
                            >
                                <Quote className="h-3.5 w-3.5" />
                                <span>Citar</span>
                            </Button>
                        </PopoverContent>
                    </Popover>

                    {/* Quick Replies Trigger Button (⚡) */}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                            if (quickReplyQuery !== null) {
                                setQuickReplyQuery(null);
                            } else {
                                setQuickReplyQuery("");
                                setQuickReplyCursorIdx(input.length);
                                setSelectedQuickReplyIdx(0);
                                inputRef.current?.focus();
                            }
                        }}
                        className={cn(
                            "h-10 w-10 rounded-full shrink-0 transition-colors cursor-pointer",
                            quickReplyQuery !== null
                                ? "text-amber-500 bg-amber-500/15"
                                : "text-[#54656f] dark:text-[#8696a0] hover:text-amber-500 hover:bg-black/5 dark:hover:bg-white/10"
                        )}
                        title="Respostas Rápidas (/)"
                    >
                        <Zap className="h-5 w-5" />
                    </Button>

                    {/* Free LLM AI Assistant Popover Button (✨ IA #C29) */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                disabled={isRewritingDraft}
                                className="h-10 w-10 rounded-full shrink-0 text-purple-600 dark:text-purple-400 hover:bg-purple-500/15 transition-colors cursor-pointer"
                                title="✨ Assistente de IA Gratuita (Sugerir Resposta, Melhorar Texto, Resumir Conversa)"
                            >
                                {isRewritingDraft ? (
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                ) : (
                                    <Sparkles className="h-5 w-5" />
                                )}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent side="top" align="start" className="w-64 p-2 rounded-2xl bg-white dark:bg-[#233138] border border-border/40 shadow-2xl z-50">
                            <div className="px-2.5 py-1.5 border-b border-border/15 mb-1 flex items-center justify-between">
                                <span className="text-xs font-bold text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                                    <Sparkles className="h-3.5 w-3.5" />
                                    Assistente IA (Free LLM)
                                </span>
                                <button
                                    type="button"
                                    onClick={() => onOpenAIAssistant?.("suggest_reply", input)}
                                    className="text-[10.5px] text-[#00a884] hover:underline font-medium cursor-pointer"
                                >
                                    Abrir Painel
                                </button>
                            </div>
                            <div className="flex flex-col gap-0.5 text-xs">
                                <button
                                    type="button"
                                    onClick={() => onOpenAIAssistant?.("suggest_reply", input)}
                                    className="w-full px-2.5 py-2 rounded-xl text-left hover:bg-purple-500/10 text-foreground font-medium flex items-center gap-2 transition-colors cursor-pointer"
                                >
                                    <span>💡</span>
                                    <span>Sugerir 3 respostas para o chat</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onOpenAIAssistant?.("summarize_chat", input)}
                                    className="w-full px-2.5 py-2 rounded-xl text-left hover:bg-purple-500/10 text-foreground font-medium flex items-center gap-2 transition-colors cursor-pointer"
                                >
                                    <span>📋</span>
                                    <span>Resumir histórico da conversa</span>
                                </button>
                                <div className="h-px bg-border/15 my-1" />
                                <span className="px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Reescrever texto digitado
                                </span>
                                <button
                                    type="button"
                                    onClick={() => handleInlineAIRewrite("improve_professional")}
                                    className="w-full px-2.5 py-1.5 rounded-xl text-left hover:bg-muted/60 text-foreground flex items-center gap-2 transition-colors cursor-pointer"
                                >
                                    <span>💼</span>
                                    <span>Tom Profissional e Claro</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleInlineAIRewrite("improve_friendly")}
                                    className="w-full px-2.5 py-1.5 rounded-xl text-left hover:bg-muted/60 text-foreground flex items-center gap-2 transition-colors cursor-pointer"
                                >
                                    <span>😊</span>
                                    <span>Tom Amigável e Empático</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleInlineAIRewrite("improve_persuasive")}
                                    className="w-full px-2.5 py-1.5 rounded-xl text-left hover:bg-muted/60 text-foreground flex items-center gap-2 transition-colors cursor-pointer"
                                >
                                    <span>🚀</span>
                                    <span>Tom Comercial / Vendas</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleInlineAIRewrite("fix_grammar")}
                                    className="w-full px-2.5 py-1.5 rounded-xl text-left hover:bg-muted/60 text-foreground flex items-center gap-2 transition-colors cursor-pointer"
                                >
                                    <span>✅</span>
                                    <span>Corrigir Gramática / Ortografia</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleInlineAIRewrite("translate_en")}
                                    className="w-full px-2.5 py-1.5 rounded-xl text-left hover:bg-muted/60 text-foreground flex items-center gap-2 transition-colors cursor-pointer"
                                >
                                    <span>🌐</span>
                                    <span>Traduzir para Inglês</span>
                                </button>
                            </div>
                        </PopoverContent>
                    </Popover>

                    {/* Input Textarea capsule */}
                    <div className="flex-1 min-w-0 bg-white dark:bg-[#2a3942] rounded-xl px-3.5 py-1.5 shadow-[0_1px_0.5px_rgba(11,20,26,0.1)] flex items-center">
                        <textarea
                            ref={inputRef}
                            value={input}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            onPaste={(e) => {
                                if (!onPasteFile) return;
                                const items = e.clipboardData?.items;
                                if (items) {
                                    for (let i = 0; i < items.length; i++) {
                                        const item = items[i];
                                        if (item.kind === "file") {
                                            const file = item.getAsFile();
                                            if (file) {
                                                e.preventDefault();
                                                onPasteFile(file);
                                                return;
                                            }
                                        }
                                    }
                                }
                                const files = e.clipboardData?.files;
                                if (files && files.length > 0) {
                                    e.preventDefault();
                                    onPasteFile(files[0]);
                                }
                            }}
                            placeholder={isGroup ? "Digite uma mensagem, / para respostas rápidas, @ ou Ctrl+V para colar print..." : "Digite uma mensagem, / para respostas rápidas ou Ctrl+V para colar print..."}
                            rows={1}
                            style={{ minHeight: "26px", maxHeight: "120px" }}
                            className="w-full resize-none bg-transparent text-[15px] text-[#111b21] dark:text-[#e9edef] placeholder-[#8696a0] focus:outline-none leading-relaxed py-1"
                        />
                    </div>

                    {/* Schedule Message Directly Button (#C25) */}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onOpenScheduleMessage?.(input)}
                        className="h-10 w-10 rounded-full shrink-0 text-[#54656f] dark:text-[#8696a0] hover:text-[#00a884] hover:bg-[#00a884]/10 transition-colors cursor-pointer"
                        title="Agendar mensagem para este contato/grupo"
                    >
                        <CalendarClock className="h-5 w-5" />
                    </Button>

                    {/* WhatsApp Send Button or Mic Button */}
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
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 rounded-full shrink-0 text-[#54656f] dark:text-[#8696a0] hover:text-[#00a884] hover:bg-[#00a884]/10 transition-colors cursor-pointer"
                            onClick={startRecording}
                            title="Gravar mensagem de voz"
                        >
                            <Mic className="h-5 w-5" />
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Main Component ─────────────────
export function ChatWindow({ sessionId, jid, name, profilePic, onBack }: ChatWindowProps) {
    const router = useRouter();
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
    const [lightboxMedia, setLightboxMedia] = useState<{ src: string; caption?: string | null } | null>(null);
    const [participantNames, setParticipantNames] = useState<string[]>([]);
    const [participantsList, setParticipantsList] = useState<GroupParticipant[]>([]);
    const [oldestTimestamp, setOldestTimestamp] = useState<string | null>(null);
    const [autoScroll, setAutoScroll] = useState(true);
    const [newMsgBadge, setNewMsgBadge] = useState(false);

    // Delete & Edit confirmation (#C8)
    const [deleteConfirmMsg, setDeleteConfirmMsg] = useState<Message | null>(null);
    const [editingMessage, setEditingMessage] = useState<{ keyId: string; text: string } | null>(null);
    const [isSavingEdit, setIsSavingEdit] = useState(false);

    // Reply state
    const [replyingTo, setReplyingTo] = useState<Message | null>(null);

    // Media preview modal before sending (Multi-file queue #C15)
    const [previewFiles, setPreviewFiles] = useState<{
        file: File;
        type: string;
        previewUrl: string;
        caption: string;
    }[]>([]);
    const [activePreviewIdx, setActivePreviewIdx] = useState<number>(0);
    const previewFile = previewFiles[activePreviewIdx] || null;

    // Lightbox Zoom & Rotate state (#C16)
    const [lightboxZoom, setLightboxZoom] = useState<number>(1);
    const [lightboxRotation, setLightboxRotation] = useState<number>(0);

    // Multi-Select Messages state (#C19)
    const [isSelectMode, setIsSelectMode] = useState<boolean>(false);
    const [selectedMsgIds, setSelectedMsgIds] = useState<string[]>([]);
    const [forwardingMessagesList, setForwardingMessagesList] = useState<Message[] | null>(null);

    // Internal Chat Notes state (#C21)
    const [chatNote, setChatNote] = useState<string>("");

    // Mute Chat state (#C26)
    const [isChatMuted, setIsChatMuted] = useState<boolean>(false);
    const isChatMutedRef = useRef<boolean>(false);
    isChatMutedRef.current = isChatMuted;

    // Message Info / Details modal (#C27)
    const [inspectingMessage, setInspectingMessage] = useState<Message | null>(null);

    // Send Contact (vCard) modal state (#C22)
    const [isSendContactOpen, setIsSendContactOpen] = useState(false);
    const [contactSearchQuery, setContactSearchQuery] = useState("");
    const [customContactName, setCustomContactName] = useState("");
    const [customContactPhone, setCustomContactPhone] = useState("");
    const [isSendingSpecial, setIsSendingSpecial] = useState(false);

    // Send Location modal state (#C22)
    const [isSendLocationOpen, setIsSendLocationOpen] = useState(false);
    const [locLat, setLocLat] = useState("");
    const [locLng, setLocLng] = useState("");
    const [locName, setLocName] = useState("");
    const [locAddress, setLocAddress] = useState("");
    const [isGettingGeo, setIsGettingGeo] = useState(false);

    // Send Poll modal state (#C23)
    const [isSendPollOpen, setIsSendPollOpen] = useState(false);
    const [pollQuestion, setPollQuestion] = useState("");
    const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
    const [pollAllowMultiple, setPollAllowMultiple] = useState(false);
    const [votedPolls, setVotedPolls] = useState<Record<string, string[]>>({});

    // Schedule Message modal state (#C25)
    const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
    const [scheduleText, setScheduleText] = useState("");
    const [scheduleDateTime, setScheduleDateTime] = useState("");
    const [isSavingSchedule, setIsSavingSchedule] = useState(false);

    // Context menu state
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

    // In-chat message search (WhatsApp Web style)
    const [isSearching, setIsSearching] = useState(false);
    const [isChatInfoModalOpen, setIsChatInfoModalOpen] = useState(false);
    const [chatInfoModalTab, setChatInfoModalTab] = useState<"media" | "docs" | "audio" | "links" | "starred" | "members">("media");
    const [searchQuery, setSearchQuery] = useState("");
    const [searchMatchIdx, setSearchMatchIdx] = useState(0);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const searchMatches = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return [];
        return messages.filter(m => (m.content && m.content.toLowerCase().includes(q)) || (m.pushName && m.pushName.toLowerCase().includes(q)));
    }, [messages, searchQuery]);

    const scrollToSearchMatch = useCallback((msg: Message) => {
        const target = document.getElementById(`msg-${msg.keyId}`);
        if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "center" });
            target.classList.add("ring-2", "ring-amber-500", "rounded-xl", "transition-all", "duration-300");
            setTimeout(() => {
                target.classList.remove("ring-2", "ring-amber-500");
            }, 1800);
        }
    }, []);

    const handleNextSearchMatch = useCallback(() => {
        if (searchMatches.length === 0) return;
        const nextIdx = (searchMatchIdx + 1) % searchMatches.length;
        setSearchMatchIdx(nextIdx);
        scrollToSearchMatch(searchMatches[nextIdx]);
    }, [searchMatches, searchMatchIdx, scrollToSearchMatch]);

    const handlePrevSearchMatch = useCallback(() => {
        if (searchMatches.length === 0) return;
        const prevIdx = (searchMatchIdx - 1 + searchMatches.length) % searchMatches.length;
        setSearchMatchIdx(prevIdx);
        scrollToSearchMatch(searchMatches[prevIdx]);
    }, [searchMatches, searchMatchIdx, scrollToSearchMatch]);

    // Keyboard shortcut (Ctrl+F) to toggle search
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
                e.preventDefault();
                setIsSearching(true);
                setTimeout(() => searchInputRef.current?.focus(), 50);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    // Pinned Messages (Multiple Carousel #C31) & Starred Messages state (persisted per sessionId:jid in localStorage) (#C12)
    const [pinnedMessageIds, setPinnedMessageIds] = useState<string[]>([]);
    const [activePinnedIdx, setActivePinnedIdx] = useState<number>(0);
    const [starredIds, setStarredIds] = useState<string[]>([]);

    // Favorite Stickers & Sticker Picker state (#C35)
    const [favoriteStickers, setFavoriteStickers] = useState<string[]>([]);

    // Webcam Photo Capture Modal state (#C36)
    const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
    const cameraVideoRef = useRef<HTMLVideoElement>(null);
    const cameraStreamRef = useRef<MediaStream | null>(null);

    // Block Contact state (#C39)
    const [isContactBlocked, setIsContactBlocked] = useState(false);

    // Chat Wallpaper Theme (#C33)
    const [chatWallpaper, setChatWallpaper] = useState<"default" | "dark" | "emerald" | "ocean" | "minimal">("default");

    // Free LLM AI Assistant Modal State (#C29)
    const [isAIAssistantOpen, setIsAIAssistantOpen] = useState(false);
    const [aiMode, setAiMode] = useState<ChatAIAssistantMode>("suggest_reply");
    const [aiInputDraft, setAiInputDraft] = useState("");
    const [aiResult, setAiResult] = useState("");
    const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
    const [aiProviderInfo, setAiProviderInfo] = useState<{ provider: string; model: string; isLocalFallback?: boolean } | null>(null);
    const [isRunningAI, setIsRunningAI] = useState(false);
    const [showLLMKeyConfig, setShowLLMKeyConfig] = useState(false);
    const [llmKeys, setLlmKeys] = useState<CustomFreeLLMKeys>({});

    // Forward message modal state
    const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);

    // Live typing / recording presence state
    const [presenceInfo, setPresenceInfo] = useState<{ isComposing: boolean; isRecording: boolean; sender?: string } | null>(null);
    const presenceTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Active chat assigned labels
    const [chatLabels, setChatLabels] = useState<LabelData[]>([]);

    const fetchCurrentChatLabels = useCallback(async () => {
        if (!sessionId || !jid) return;
        try {
            const res = await fetch(`/api/labels/${sessionId}/chats?jid=${encodeURIComponent(jid)}`);
            if (res.ok) {
                const data = await res.json();
                const labels: LabelData[] = (data.data || []).map((cl: any) => ({
                    id: cl.labelId,
                    name: cl.labelName,
                    colorHex: cl.colorHex,
                }));
                setChatLabels(labels);
            }
        } catch (e) {
            console.error("Failed to fetch active chat labels", e);
        }
    }, [sessionId, jid]);

    useEffect(() => {
        fetchCurrentChatLabels();
        const handleLabelsChanged = () => fetchCurrentChatLabels();
        window.addEventListener("zapflow:labels-changed", handleLabelsChanged);
        return () => window.removeEventListener("zapflow:labels-changed", handleLabelsChanged);
    }, [fetchCurrentChatLabels]);


    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const savedWp = localStorage.getItem("zapflow_chat_wallpaper_v1") as any;
            if (savedWp && ["default", "dark", "emerald", "ocean", "minimal"].includes(savedWp)) {
                setChatWallpaper(savedWp);
            }
            const rawFavStickers = localStorage.getItem("zapflow_fav_stickers_v1");
            if (rawFavStickers) {
                const parsedFav = JSON.parse(rawFavStickers);
                if (Array.isArray(parsedFav)) setFavoriteStickers(parsedFav);
            }
            setLlmKeys(loadSavedLLMKeys());
        } catch {}
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const savedMulti = localStorage.getItem(`zapflow_pinned_msgs_${sessionId}_${jid}`);
            if (savedMulti) {
                const parsed = JSON.parse(savedMulti);
                setPinnedMessageIds(Array.isArray(parsed) ? parsed : []);
            } else {
                const legacySingle = localStorage.getItem(`zapflow_pinned_msg_${sessionId}_${jid}`);
                setPinnedMessageIds(legacySingle ? [legacySingle] : []);
            }
            setActivePinnedIdx(0);
            const rawStars = localStorage.getItem(`zapflow_starred_${sessionId}_${jid}`);
            setStarredIds(rawStars ? JSON.parse(rawStars) : []);
            const savedNote = localStorage.getItem(`zapflow_notes_${sessionId}_${jid}`);
            setChatNote(savedNote || "");
            const rawMuted = localStorage.getItem(`zapflow_muted_${sessionId}`);
            const mutedList: string[] = rawMuted ? JSON.parse(rawMuted) : [];
            setIsChatMuted(Array.isArray(mutedList) && mutedList.includes(jid));
            const rawBlocked = localStorage.getItem(`zapflow_blocked_${sessionId}`);
            const blockedList: string[] = rawBlocked ? JSON.parse(rawBlocked) : [];
            setIsContactBlocked(Array.isArray(blockedList) && blockedList.includes(jid));
        } catch {}
        setIsSelectMode(false);
        setSelectedMsgIds([]);
    }, [sessionId, jid]);

    const availableStickers = useMemo(() => {
        const fromHistory = messages
            .filter(m => m.type === "STICKER" && m.mediaUrl)
            .map(m => m.mediaUrl as string);
        return Array.from(new Set([...favoriteStickers, ...fromHistory]));
    }, [favoriteStickers, messages]);

    const handleToggleFavoriteSticker = useCallback((stickerUrl: string) => {
        setFavoriteStickers(prev => {
            const exists = prev.includes(stickerUrl);
            const next = exists ? prev.filter(u => u !== stickerUrl) : [stickerUrl, ...prev];
            try {
                localStorage.setItem("zapflow_fav_stickers_v1", JSON.stringify(next));
            } catch {}
            toast.success(exists ? "Figurinha removida das favoritas" : "⭐ Figurinha salva nas favoritas!");
            return next;
        });
    }, []);

    // Sync mute changes initiated from ChatList (#C26)
    useEffect(() => {
        const handleMuteChanged = (e: Event) => {
            const { jid: targetJid, muted } = (e as CustomEvent<{ jid: string; muted: boolean }>).detail || {};
            if (targetJid === jid) {
                setIsChatMuted(Boolean(muted));
            }
        };
        window.addEventListener("zapflow:mute-changed", handleMuteChanged);
        return () => window.removeEventListener("zapflow:mute-changed", handleMuteChanged);
    }, [jid]);

    const handleToggleChatMute = useCallback(() => {
        setIsChatMuted(prev => {
            const next = !prev;
            try {
                const rawMuted = localStorage.getItem(`zapflow_muted_${sessionId}`);
                const list: string[] = rawMuted ? JSON.parse(rawMuted) : [];
                const updated = next ? Array.from(new Set([...list, jid])) : list.filter(x => x !== jid);
                localStorage.setItem(`zapflow_muted_${sessionId}`, JSON.stringify(updated));
                window.dispatchEvent(new CustomEvent("zapflow:mute-changed", { detail: { jid, muted: next } }));
            } catch {}
            toast.success(next ? "🔇 Notificações desta conversa silenciadas" : "🔔 Notificações desta conversa ativadas");
            return next;
        });
    }, [sessionId, jid]);

    const handleSaveChatNote = useCallback((val: string) => {
        setChatNote(val);
        if (typeof window === "undefined") return;
        try {
            if (val.trim()) {
                localStorage.setItem(`zapflow_notes_${sessionId}_${jid}`, val);
            } else {
                localStorage.removeItem(`zapflow_notes_${sessionId}_${jid}`);
            }
        } catch {}
    }, [sessionId, jid]);

    const toggleSelectMessage = useCallback((keyId: string) => {
        setSelectedMsgIds(prev => prev.includes(keyId) ? prev.filter(id => id !== keyId) : [...prev, keyId]);
    }, []);

    const handleToggleStar = useCallback((msg: Message) => {
        setStarredIds(prev => {
            const isStarred = prev.includes(msg.keyId);
            const next = isStarred ? prev.filter(id => id !== msg.keyId) : [...prev, msg.keyId];
            try {
                localStorage.setItem(`zapflow_starred_${sessionId}_${jid}`, JSON.stringify(next));
            } catch {}
            toast.success(isStarred ? "Mensagem removida dos favoritos" : "⭐ Mensagem adicionada aos favoritos!");
            return next;
        });
    }, [sessionId, jid]);

    const pinnedMessagesList = useMemo(() => {
        if (pinnedMessageIds.length === 0) return [];
        return pinnedMessageIds
            .map(id => messages.find(m => m.keyId === id))
            .filter((m): m is Message => Boolean(m));
    }, [messages, pinnedMessageIds]);

    const pinnedMessage = useMemo(() => {
        if (pinnedMessagesList.length === 0) return null;
        return pinnedMessagesList[activePinnedIdx % pinnedMessagesList.length] || pinnedMessagesList[0];
    }, [pinnedMessagesList, activePinnedIdx]);

    const handleTogglePin = useCallback((msg: Message) => {
        setPinnedMessageIds(prev => {
            const isCurrentlyPinned = prev.includes(msg.keyId);
            const next = isCurrentlyPinned
                ? prev.filter(id => id !== msg.keyId)
                : [msg.keyId, ...prev].slice(0, 5);
            try {
                if (next.length > 0) {
                    localStorage.setItem(`zapflow_pinned_msgs_${sessionId}_${jid}`, JSON.stringify(next));
                } else {
                    localStorage.removeItem(`zapflow_pinned_msgs_${sessionId}_${jid}`);
                    localStorage.removeItem(`zapflow_pinned_msg_${sessionId}_${jid}`);
                }
            } catch {}
            toast.success(isCurrentlyPinned ? "Mensagem desafixada" : `📌 Mensagem fixada no topo (${next.length} fixada${next.length > 1 ? "s" : ""})!`);
            return next;
        });
        setActivePinnedIdx(0);
    }, [sessionId, jid]);

    const handleUnpin = useCallback((keyIdToRemove?: string) => {
        setPinnedMessageIds(prev => {
            const targetId = keyIdToRemove || pinnedMessage?.keyId;
            const next = targetId ? prev.filter(id => id !== targetId) : [];
            try {
                if (next.length > 0) {
                    localStorage.setItem(`zapflow_pinned_msgs_${sessionId}_${jid}`, JSON.stringify(next));
                } else {
                    localStorage.removeItem(`zapflow_pinned_msgs_${sessionId}_${jid}`);
                    localStorage.removeItem(`zapflow_pinned_msg_${sessionId}_${jid}`);
                }
            } catch {}
            return next;
        });
        setActivePinnedIdx(0);
        toast.success("Mensagem desafixada");
    }, [sessionId, jid, pinnedMessage]);

    // Gallery images & Lightbox keyboard navigation (#C16)
    const galleryImages = useMemo(() => {
        return messages.filter(m => m.type === "IMAGE" && m.mediaUrl);
    }, [messages]);

    const currentGalleryIdx = useMemo(() => {
        if (!lightboxMedia) return -1;
        return galleryImages.findIndex(m => m.mediaUrl === lightboxMedia.src);
    }, [lightboxMedia, galleryImages]);

    const handleLightboxNav = useCallback((dir: 1 | -1) => {
        if (galleryImages.length <= 1 || currentGalleryIdx === -1) return;
        const nextIdx = (currentGalleryIdx + dir + galleryImages.length) % galleryImages.length;
        const target = galleryImages[nextIdx];
        if (target?.mediaUrl) {
            setLightboxZoom(1);
            setLightboxRotation(0);
            setLightboxMedia({ src: target.mediaUrl, caption: target.content });
        }
    }, [galleryImages, currentGalleryIdx]);

    useEffect(() => {
        if (!lightboxMedia) {
            setLightboxZoom(1);
            setLightboxRotation(0);
            return;
        }
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setLightboxMedia(null);
            } else if (e.key === "ArrowRight") {
                e.preventDefault();
                handleLightboxNav(1);
            } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                handleLightboxNav(-1);
            } else if (e.key === "+" || e.key === "=") {
                e.preventDefault();
                setLightboxZoom(z => Math.min(4, +(z + 0.25).toFixed(2)));
            } else if (e.key === "-") {
                e.preventDefault();
                setLightboxZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)));
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [lightboxMedia, handleLightboxNav]);

    // Request desktop notifications permission quietly
    useEffect(() => {
        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
            Notification.requestPermission().catch(() => {});
        }
    }, []);

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
            if (data.participantsList && data.participantsList.length > 0) {
                setParticipantsList(data.participantsList);
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
            if (cached.participantsList) setParticipantsList(cached.participantsList);
            setLoading(false);
            setAutoScroll(true);
            // Silently check for fresh messages in background without wiping screen
            fetchMessages(undefined, true);
        } else {
            setMessages([]);
            setContactMap({});
            setParticipantNames([]);
            setParticipantsList([]);
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

                // Play chime and desktop notification if there are incoming messages from someone else (unless muted #C26)
                const incomingFromOthers = relevant.filter(m => !m.fromMe && !m.keyId.startsWith("temp-"));
                if (incomingFromOthers.length > 0) {
                    const el = scrollRef.current;
                    if (el && el.scrollHeight - el.scrollTop - el.clientHeight > 140) {
                        setNewMsgBadge(true);
                    }
                    if (!isChatMutedRef.current) {
                        playNotificationChime();
                        if (typeof document !== "undefined" && document.hidden) {
                            const lastMsg = incomingFromOthers[incomingFromOthers.length - 1];
                            const senderName = lastMsg.pushName || name || "WhatsApp";
                            showDesktopNotification(
                                isGroup ? `${senderName} (${name || "Grupo"})` : senderName,
                                lastMsg.content || (lastMsg.type === 'IMAGE' ? "📷 Foto" : "📎 Arquivo")
                            );
                        }
                    }
                }

                // Remove optimistic temp- messages that match incoming messages fromMe
                let filtered = prev;
                for (const nm of relevant) {
                    if (nm.fromMe) {
                        filtered = filtered.filter(p => !(p.keyId.startsWith("temp-") && (p.content === nm.content || p.type === nm.type)));
                    }
                }

                // Merge by keyId so two-phase updates (instant text/thumb -> full mediaUrl) preserve existing fields
                const mapByKey = new Map<string, Message>();
                for (const m of filtered) {
                    mapByKey.set(m.keyId, m);
                }
                for (const nm of relevant) {
                    const existing = mapByKey.get(nm.keyId);
                    if (existing) {
                        mapByKey.set(nm.keyId, {
                            ...existing,
                            ...nm,
                            mediaUrl: nm.mediaUrl || existing.mediaUrl,
                            quoted: nm.quoted || existing.quoted,
                            reactions: nm.reactions || existing.reactions,
                            userReaction: nm.userReaction || existing.userReaction
                        });
                    } else {
                        mapByKey.set(nm.keyId, nm);
                    }
                }
                const unique = Array.from(mapByKey.values());
                const sorted = unique.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

                // Keep cache in sync
                const cacheKey = `${sessionId}:${jid}`;
                const cached = chatCache.get(cacheKey);
                chatCache.set(cacheKey, {
                    ...(cached || {}),
                    messages: sorted,
                    hasMore: cached?.hasMore ?? false,
                    oldestTimestamp: sorted.length > 0 ? sorted[0].timestamp : null,
                    cachedAt: Date.now()
                });

                return sorted;
            });
        };
        socket.on("message.update", handler);

        const statusHandler = (data: { keyId: string; remoteJid?: string; status: string }) => {
            if (!data?.keyId || !data?.status) return;
            setMessages(prev => {
                let updatedAny = false;
                const next = prev.map(m => {
                    if (m.keyId === data.keyId && m.status !== data.status) {
                        updatedAny = true;
                        return { ...m, status: data.status };
                    }
                    return m;
                });
                if (updatedAny) {
                    const cacheKey = `${sessionId}:${jid}`;
                    const cached = chatCache.get(cacheKey);
                    if (cached) {
                        cached.messages = next;
                    }
                    return next;
                }
                return prev;
            });
        };
        socket.on("message.status", statusHandler);

        const reactionHandler = (data: { keyId: string; emoji: string; fromMe?: boolean }) => {
            if (!data?.keyId) return;
            setMessages(prev => prev.map(m => {
                if (m.keyId !== data.keyId) return m;
                const nextReactions = { ...(m.reactions || {}) };
                if (data.emoji) {
                    nextReactions[data.emoji] = (nextReactions[data.emoji] || 0) + 1;
                }
                return {
                    ...m,
                    userReaction: data.fromMe ? (data.emoji || undefined) : m.userReaction,
                    reactions: Object.keys(nextReactions).length > 0 ? nextReactions : undefined
                };
            }));
        };
        socket.on("message.reaction", reactionHandler);

        const editHandler = (data: { keyId: string; newContent: string; isEdited?: boolean }) => {
            if (!data?.keyId) return;
            setMessages(prev => prev.map(m => {
                if (m.keyId !== data.keyId) return m;
                return {
                    ...m,
                    content: data.newContent,
                    isEdited: true
                };
            }));
        };
        socket.on("message.edit", editHandler);

        const deletedHandler = (data: { keyId: string; remoteJid?: string }) => {
            if (!data?.keyId) return;
            setMessages(prev => prev.filter(m => m.keyId !== data.keyId));
        };
        socket.on("message.deleted", deletedHandler);

        const presenceHandler = (data: { id: string; presences: Record<string, { lastKnownPresence?: string }> }) => {
            if (!data?.id || !data?.presences) return;
            const targetJid = jid.endsWith("@c.us") ? jid.replace("@c.us", "@s.whatsapp.net") : jid;
            if (data.id !== targetJid && data.id !== jid) return;

            for (const [senderJid, p] of Object.entries(data.presences)) {
                const status = p?.lastKnownPresence;
                if (status === "composing" || status === "recording") {
                    let senderName = "";
                    if (isGroup) {
                        const cleanPhone = senderJid.split("@")[0].replace(/\D/g, "");
                        senderName = (contactMap && (contactMap[senderJid] || contactMap[cleanPhone])) || "";
                    }

                    setPresenceInfo({
                        isComposing: status === "composing",
                        isRecording: status === "recording",
                        sender: senderName
                    });

                    if (presenceTimerRef.current) clearTimeout(presenceTimerRef.current);
                    presenceTimerRef.current = setTimeout(() => {
                        setPresenceInfo(null);
                    }, 4000);
                    return;
                } else if (status === "paused" || status === "unavailable") {
                    setPresenceInfo(null);
                }
            }
        };
        socket.on("presence.update", presenceHandler);


        return () => {
            socket.off("connect", onConnect);
            socket.off("message.update", handler);
            socket.off("message.status", statusHandler);
            socket.off("message.reaction", reactionHandler);
            socket.off("message.edit", editHandler);
            socket.off("message.deleted", deletedHandler);
            socket.off("presence.update", presenceHandler);
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
    const handleSend = (text: string, mentions?: string[]) => {
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
        sendChatMessage(sessionId, jid, text, replyKeyId, mentions)
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

    
    const handleCloseCurrentChat = useCallback(() => {
        onBack?.();
        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("zapflow:close-chat"));
        }
    }, [onBack]);

    // Keyboard shortcuts (Escape to dismiss or close chat #C38, Ctrl+Shift+F to search chats, Alt+Up/Down to navigate)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (isSearching) {
                    setIsSearching(false);
                    setSearchQuery("");
                } else if (isSelectMode) {
                    setIsSelectMode(false);
                    setSelectedMsgIds([]);
                } else if (replyingTo) {
                    setReplyingTo(null);
                } else if (previewFiles.length > 0) {
                    previewFiles.forEach(p => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
                    setPreviewFiles([]);
                    setActivePreviewIdx(0);
                } else if (forwardingMessage || forwardingMessagesList) {
                    setForwardingMessage(null);
                    setForwardingMessagesList(null);
                } else if (isChatInfoModalOpen) {
                    setIsChatInfoModalOpen(false);
                } else if (
                    !lightboxMedia &&
                    !editingMessage &&
                    !deleteConfirmMsg &&
                    !inspectingMessage &&
                    !isSendContactOpen &&
                    !isSendLocationOpen &&
                    !isSendPollOpen &&
                    !isScheduleModalOpen &&
                    !isAIAssistantOpen &&
                    !isCameraModalOpen
                ) {
                    handleCloseCurrentChat();
                }
            }

            if (e.ctrlKey && e.shiftKey && (e.key === "F" || e.key === "f")) {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent("zapflow:focus-search"));
            }

            if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent("zapflow:nav-chat", {
                    detail: { direction: e.key === "ArrowDown" ? 1 : -1 }
                }));
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [
        isSearching,
        isSelectMode,
        replyingTo,
        previewFiles,
        forwardingMessage,
        forwardingMessagesList,
        isChatInfoModalOpen,
        lightboxMedia,
        editingMessage,
        deleteConfirmMsg,
        inspectingMessage,
        isSendContactOpen,
        isSendLocationOpen,
        isSendPollOpen,
        isScheduleModalOpen,
        isAIAssistantOpen,
        isCameraModalOpen,
        handleCloseCurrentChat
    ]);


    const processFileUpload = async (file: File, explicitType?: string, caption?: string) => {
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
        if (caption) formData.append("caption", caption);

        // 0ms Optimistic Media Render (Image, Video, Document, Audio)
        const localBlobUrl = URL.createObjectURL(file);
        const tempKeyId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const nowIso = new Date().toISOString();
        const mappedMsgType = type === "image" ? "IMAGE" : type === "video" ? "VIDEO" : type === "audio" ? "AUDIO" : "DOCUMENT";
        const displayContent = caption || (mappedMsgType === "DOCUMENT" ? file.name : "");

        const optimisticMsg: Message = {
            id: tempKeyId,
            keyId: tempKeyId,
            remoteJid: jid,
            fromMe: true,
            pushName: undefined,
            type: mappedMsgType,
            content: displayContent,
            mediaUrl: localBlobUrl,
            status: "PENDING",
            timestamp: nowIso,
            quoteId: replyingTo?.keyId || null,
        };

        setReplyingTo(null);
        setMessages(prev => [...prev, optimisticMsg]);
        requestAnimationFrame(() => scrollToBottom(true));

        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("zapflow:local-message-sent", {
                detail: { jid, content: displayContent || file.name, timestamp: nowIso, type: mappedMsgType, keyId: tempKeyId }
            }));
        }

        try {
            const res = await sendMediaMessage(formData);
            setMessages(prev => prev.map(m => m.keyId === tempKeyId ? { ...m, keyId: res?.keyId || m.keyId, status: "SENT" } : m));
        } catch (error: any) {
            toast.error(error.message || "Falha ao enviar a mídia");
            setMessages(prev => prev.map(m => m.keyId === tempKeyId ? { ...m, status: "FAILED" } : m));
        }
    };

    const initiateFilesPreview = (fileList: File[] | FileList, explicitType?: string) => {
        const filesArr = Array.from(fileList);
        if (filesArr.length === 0) return;

        const newItems = filesArr.map(file => {
            let type = explicitType;
            if (!type || type === '*') {
                if (file.type.startsWith('image/')) type = 'image';
                else if (file.type.startsWith('video/')) type = 'video';
                else if (file.type.startsWith('audio/')) type = 'audio';
                else type = 'document';
            }
            const previewUrl = URL.createObjectURL(file);
            return {
                file,
                type: type || 'document',
                previewUrl,
                caption: ""
            };
        });

        setPreviewFiles(prev => {
            const next = [...prev, ...newItems];
            return next;
        });
        setActivePreviewIdx(prev => (previewFiles.length === 0 ? 0 : prev));
    };

    const initiateFilePreview = (file: File, explicitType?: string) => {
        initiateFilesPreview([file], explicitType);
    };

    // Send Sticker from image file or saved sticker URL (#C35)
    const handleSendStickerFile = async (file: File) => {
        const localBlobUrl = URL.createObjectURL(file);
        const tempKeyId = `temp-sticker-${Date.now()}`;
        const nowIso = new Date().toISOString();

        const optimisticMsg: Message = {
            id: tempKeyId,
            keyId: tempKeyId,
            remoteJid: jid,
            fromMe: true,
            type: "STICKER",
            content: "",
            mediaUrl: localBlobUrl,
            status: "PENDING",
            timestamp: nowIso,
            quoteId: replyingTo?.keyId || null,
        };
        setReplyingTo(null);
        setMessages(prev => [...prev, optimisticMsg]);
        requestAnimationFrame(() => scrollToBottom(true));

        const formData = new FormData();
        formData.append("file", file);
        formData.append("pack", "ZapFlow");
        formData.append("author", "ZapFlow CRM");

        try {
            const res = await fetch(`/api/messages/${sessionId}/${encodeURIComponent(jid)}/sticker`, {
                method: "POST",
                body: formData
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json?.error?.message || "Falha ao converter/enviar figurinha");
            setMessages(prev => prev.map(m => m.keyId === tempKeyId ? { ...m, keyId: json?.data?.key?.id || m.keyId, status: "SENT" } : m));
            toast.success("🖼️ Figurinha enviada!");
        } catch (err: any) {
            toast.error(err?.message || "Erro ao enviar figurinha");
            setMessages(prev => prev.map(m => m.keyId === tempKeyId ? { ...m, status: "FAILED" } : m));
        }
    };

    const handleSendStickerUrl = async (url: string) => {
        try {
            const resp = await fetch(url);
            const blob = await resp.blob();
            const file = new File([blob], `sticker-${Date.now()}.webp`, { type: blob.type || "image/webp" });
            await handleSendStickerFile(file);
        } catch {
            toast.error("Não foi possível reenviar esta figurinha");
        }
    };

    // Webcam Capture Modal Handlers (#C36)
    const handleCloseCamera = useCallback(() => {
        if (cameraStreamRef.current) {
            cameraStreamRef.current.getTracks().forEach(t => t.stop());
            cameraStreamRef.current = null;
        }
        setIsCameraModalOpen(false);
    }, []);

    const handleOpenCamera = async () => {
        if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
            toast.error("Câmera não suportada ou sem permissão neste navegador");
            return;
        }
        setIsCameraModalOpen(true);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
            cameraStreamRef.current = stream;
            setTimeout(() => {
                if (cameraVideoRef.current) {
                    cameraVideoRef.current.srcObject = stream;
                    cameraVideoRef.current.play().catch(() => {});
                }
            }, 80);
        } catch {
            toast.error("Permissão de câmera negada ou nenhuma webcam encontrada");
            setIsCameraModalOpen(false);
        }
    };

    const handleCaptureCameraPhoto = () => {
        const video = cameraVideoRef.current;
        if (!video) return;
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
            if (!blob) return;
            const file = new File([blob], `CAMERA-${Date.now()}.jpg`, { type: "image/jpeg" });
            handleCloseCamera();
            initiateFilePreview(file, "image");
        }, "image/jpeg", 0.92);
    };

    // Block / Unblock Contact & Clear Conversation (#C39)
    const handleToggleBlockContact = async () => {
        if (isGroup) return;
        const action = isContactBlocked ? "unblock" : "block";
        try {
            const res = await fetch(`/api/contacts/${sessionId}/${encodeURIComponent(jid)}/${action}`, {
                method: "POST"
            });
            if (!res.ok) throw new Error("Falha ao atualizar bloqueio do contato");
            const next = !isContactBlocked;
            setIsContactBlocked(next);
            try {
                const rawBlocked = localStorage.getItem(`zapflow_blocked_${sessionId}`);
                const list: string[] = rawBlocked ? JSON.parse(rawBlocked) : [];
                const updated = next ? Array.from(new Set([...list, jid])) : list.filter(x => x !== jid);
                localStorage.setItem(`zapflow_blocked_${sessionId}`, JSON.stringify(updated));
            } catch {}
            toast.success(next ? "🚫 Contato bloqueado no WhatsApp" : "✅ Contato desbloqueado no WhatsApp");
        } catch (err: any) {
            toast.error(err?.message || "Erro ao bloquear/desbloquear contato");
        }
    };

    const handleClearConversation = () => {
        if (messages.length === 0) {
            toast.info("A conversa já está vazia");
            return;
        }
        if (typeof window !== "undefined" && !window.confirm("Tem certeza que deseja limpar as mensagens exibidas nesta conversa?")) {
            return;
        }
        setMessages([]);
        const cacheKey = `${sessionId}:${jid}`;
        chatCache.delete(cacheKey);
        toast.success("🧹 Mensagens da conversa limpas!");
    };

    const handleRemovePreviewFile = (idxToRemove: number) => {
        setPreviewFiles(prev => {
            const item = prev[idxToRemove];
            if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
            const next = prev.filter((_, i) => i !== idxToRemove);
            setActivePreviewIdx(curr => Math.min(curr, Math.max(0, next.length - 1)));
            return next;
        });
    };

    const handleSendPreviewFile = async () => {
        if (previewFiles.length === 0) return;
        const itemsToSend = [...previewFiles];
        setPreviewFiles([]);
        setActivePreviewIdx(0);
        for (const item of itemsToSend) {
            await processFileUpload(item.file, item.type, item.caption);
            if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        }
    };

    const handleCancelPreviewFile = () => {
        previewFiles.forEach(p => {
            if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
        });
        setPreviewFiles([]);
        setActivePreviewIdx(0);
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        initiateFilesPreview(files, uploadType);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const handleSendAudio = async (blob: Blob, mimeType: string) => {
        const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('webm') ? 'webm' : 'mp4';
        const file = new File([blob], `AUDIO-${Date.now()}.${ext}`, { type: mimeType });

        // 0ms Optimistic Audio Voice Note
        const localBlobUrl = URL.createObjectURL(blob);
        const tempKeyId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const nowIso = new Date().toISOString();

        const optimisticMsg: Message = {
            id: tempKeyId,
            keyId: tempKeyId,
            remoteJid: jid,
            fromMe: true,
            pushName: undefined,
            type: "AUDIO",
            content: "",
            mediaUrl: localBlobUrl,
            status: "PENDING",
            timestamp: nowIso,
            quoteId: replyingTo?.keyId || null,
        };

        setReplyingTo(null);
        setMessages(prev => [...prev, optimisticMsg]);
        requestAnimationFrame(() => scrollToBottom(true));

        const formData = new FormData();
        formData.append("file", file);
        formData.append("type", "voice");
        formData.append("sessionId", sessionId);
        formData.append("jid", jid);

        try {
            await sendMediaMessage(formData);
            setMessages(prev => prev.map(m => m.keyId === tempKeyId ? { ...m, status: "SENT" } : m));
            setTimeout(() => fetchMessages(undefined, true), 1200);
        } catch (error: any) {
            console.error("Erro ao enviar áudio:", error);
            toast.error(error?.message || "Falha ao enviar áudio");
            setMessages(prev => prev.map(m => m.keyId === tempKeyId ? { ...m, status: "FAILED" } : m));
        }
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

    const handleReaction = async (msg: Message, emoji: string) => {
        const isRemoving = msg.userReaction === emoji;
        const targetEmoji = isRemoving ? "" : emoji;

        // 0ms Optimistic reaction update
        setMessages(prev => prev.map(m => {
            if (m.keyId !== msg.keyId) return m;
            const nextReactions = { ...(m.reactions || {}) };
            if (msg.userReaction) {
                const count = (nextReactions[msg.userReaction] || 1) - 1;
                if (count <= 0) delete nextReactions[msg.userReaction];
                else nextReactions[msg.userReaction] = count;
            }
            if (!isRemoving) {
                nextReactions[emoji] = (nextReactions[emoji] || 0) + 1;
            }
            return {
                ...m,
                userReaction: isRemoving ? undefined : emoji,
                reactions: Object.keys(nextReactions).length > 0 ? nextReactions : undefined
            };
        }));

        try {
            await reactToChatMessage(
                sessionId,
                jid,
                msg.keyId,
                targetEmoji,
                msg.fromMe,
                msg.senderJid || undefined
            );
        } catch (err: any) {
            console.error("Erro ao enviar reação:", err);
            toast.error(err?.message || "Falha ao reagir à mensagem");
        }
    };

    
    // Export full conversation to formatted .txt file
    const handleExportConversation = () => {
        if (messages.length === 0) return toast.info("Nenhuma mensagem para exportar");

        let textOutput = `=======================================================\n`;
        textOutput += `HISTÓRICO DE CONVERSA - ZAPFLOW\n`;
        textOutput += `Conversa: ${displayName || jid}\n`;
        textOutput += `Data da Exportação: ${new Date().toLocaleString("pt-BR")}\n`;
        textOutput += `Total de Mensagens: ${messages.length}\n`;
        textOutput += `=======================================================\n\n`;

        for (const msg of messages) {
            const timeStr = new Date(msg.timestamp).toLocaleString("pt-BR");
            const sender = msg.fromMe
                ? "Você"
                : (msg.pushName || (isGroup ? ((msg.remoteJid && contactMap[msg.remoteJid]) || (msg.remoteJid ? msg.remoteJid.split("@")[0] : "")) : (displayName || jid)));
            let msgText = msg.content || "";
            if (msg.type !== "TEXT" && !msgText) {
                msgText = `[${msg.type || "MÍDIA"}]`;
            }
            textOutput += `[${timeStr}] ${sender}: ${msgText}\n`;
        }

        const blob = new Blob([textOutput], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const safeName = (displayName || "conversa").replace(/[^a-zA-Z0-9_-]/g, "_");
        const dateStr = new Date().toISOString().slice(0, 10);
        link.href = url;
        link.download = `ZapFlow_${safeName}_${dateStr}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success("Histórico da conversa exportado com sucesso (.txt)!");
    };

    // Export conversation history as CSV (#C32)
    const handleExportConversationCsv = () => {
        if (messages.length === 0) {
            toast.info("Nenhuma mensagem para exportar nesta conversa");
            return;
        }
        const header = "Data/Hora,Direcao,Remetente,Tipo,Conteudo,Status\n";
        const rows = messages.map(msg => {
            const timeStr = new Date(msg.timestamp).toLocaleString("pt-BR");
            const dir = msg.fromMe ? "Enviada" : "Recebida";
            const sender = msg.fromMe
                ? "Você"
                : (msg.pushName || (isGroup ? ((msg.remoteJid && contactMap[msg.remoteJid]) || (msg.remoteJid ? msg.remoteJid.split("@")[0] : "")) : (displayName || jid)));
            const typeStr = msg.type || "TEXT";
            const contentStr = (msg.content || `[${typeStr}]`).replace(/"/g, '""').replace(/\r?\n/g, " ");
            const statusStr = msg.status || (msg.fromMe ? "SENT" : "RECEIVED");
            return `"${timeStr}","${dir}","${String(sender).replace(/"/g, '""')}","${typeStr}","${contentStr}","${statusStr}"`;
        }).join("\n");

        const csvContent = "\uFEFF" + header + rows;
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const safeName = (displayName || "conversa").replace(/[^a-zA-Z0-9_-]/g, "_");
        const dateStr = new Date().toISOString().slice(0, 10);
        link.href = url;
        link.download = `ZapFlow_${safeName}_${dateStr}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success("📊 Histórico da conversa exportado em planilha (.csv)!");
    };

    // Change Chat Wallpaper Theme (#C33)
    const handleChangeWallpaper = (theme: "default" | "dark" | "emerald" | "ocean" | "minimal") => {
        setChatWallpaper(theme);
        if (typeof window !== "undefined") {
            try {
                localStorage.setItem("zapflow_chat_wallpaper_v1", theme);
            } catch {}
        }
        toast.success("🎨 Papel de parede da conversa atualizado!");
    };

    // Free LLM AI Assistant handlers (#C29)
    const handleRunAIAssistant = async (modeToRun: ChatAIAssistantMode, draftTextOverride?: string) => {
        setIsRunningAI(true);
        setAiMode(modeToRun);
        const textToUse = draftTextOverride !== undefined ? draftTextOverride : aiInputDraft;
        try {
            const recentContext = messages
                .filter(m => m.content && m.content.trim().length > 0)
                .slice(-15)
                .map(m => ({
                    fromMe: m.fromMe,
                    sender: m.pushName || (m.fromMe ? "Você" : displayName),
                    content: m.content || ""
                }));
            const currentKeys = loadSavedLLMKeys();
            const res = await runChatAIAssistant(modeToRun, textToUse, recentContext, displayName, currentKeys);
            setAiResult(res.result);
            setAiSuggestions(res.suggestions || []);
            setAiProviderInfo({
                provider: res.provider,
                model: res.model,
                isLocalFallback: res.isLocalFallback
            });
        } catch (err: any) {
            toast.error(err?.message || "Erro ao executar Assistente de IA");
        } finally {
            setIsRunningAI(false);
        }
    };

    const handleOpenAIAssistant = (initialMode: ChatAIAssistantMode, draftText: string) => {
        setAiInputDraft(draftText || "");
        setAiMode(initialMode);
        setIsAIAssistantOpen(true);
        handleRunAIAssistant(initialMode, draftText || "");
    };

    const exportGroupParticipants = () => {
        if (!participantsList || participantsList.length === 0) {
            toast.error("Nenhum participante encontrado para exportar");
            return;
        }

        const cleanGroupName = (name || "grupo").replace(/[/\\?%*:|"<>]/g, "_");
        const header = "Nome,Telefone,JID\n";
        const rows = participantsList.map(p => {
            const safeName = `"${(p.name || '').replace(/"/g, '""')}"`;
            const safePhone = `"${(p.phoneNumber || p.id || '').replace(/"/g, '""')}"`;
            const safeJid = `"${(p.id || '').replace(/"/g, '""')}"`;
            return `${safeName},${safePhone},${safeJid}`;
        }).join("\n");

        const csvContent = "\uFEFF" + header + rows;
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `participantes_${cleanGroupName}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        toast.success(`${participantsList.length} participantes exportados para CSV!`);
    };

    const sendBroadcastToGroupMembers = () => {
        if (!participantsList || participantsList.length === 0) {
            toast.error("Nenhum participante disponível para disparo");
            return;
        }

        const validRecipients = participantsList
            .map(p => {
                const num = p.phoneNumber || p.id;
                if (!num || num.includes("@g.us")) return null;
                const clean = num.replace(/\D/g, "");
                return p.name ? `${p.name} (${clean})` : clean;
            })
            .filter((s): s is string => Boolean(s));

        if (validRecipients.length === 0) {
            toast.error("Nenhum número válido encontrado nos membros");
            return;
        }

        if (typeof window !== "undefined") {
            sessionStorage.setItem("zapflow_broadcast_draft_recipients", JSON.stringify(validRecipients));
        }
        toast.success(`${validRecipients.length} membros carregados com nomes para novo disparo!`);
        router.push("/dashboard/broadcast");
    };

    // Send vCard Contact (#C22)
    const handleSendContactCard = async (cName: string, cPhone: string) => {
        const cleanPhone = cPhone.replace(/\D/g, "");
        if (!cleanPhone) {
            toast.error("Informe um número de telefone válido");
            return;
        }
        const safeName = (cName || cleanPhone).trim();
        setIsSendingSpecial(true);
        const tempKeyId = `temp-${Date.now()}`;
        const nowIso = new Date().toISOString();
        const contentPayload = `${safeName}|${cleanPhone}`;

        const optimisticMsg: Message = {
            id: tempKeyId,
            keyId: tempKeyId,
            remoteJid: jid,
            fromMe: true,
            type: "CONTACT",
            content: contentPayload,
            status: "PENDING",
            timestamp: nowIso,
        };
        setMessages(prev => [...prev, optimisticMsg]);
        setIsSendContactOpen(false);
        setCustomContactName("");
        setCustomContactPhone("");
        requestAnimationFrame(() => scrollToBottom(true));

        try {
            const res = await sendContactCardMessage(sessionId, jid, safeName, cleanPhone);
            setMessages(prev => prev.map(m => m.keyId === tempKeyId ? { ...m, keyId: res?.keyId || m.keyId, status: "SENT" } : m));
            toast.success("Cartão de contato enviado!");
        } catch (err: any) {
            toast.error(err?.message || "Erro ao enviar contato");
            setMessages(prev => prev.map(m => m.keyId === tempKeyId ? { ...m, status: "FAILED" } : m));
        } finally {
            setIsSendingSpecial(false);
        }
    };

    // Capture Browser Geolocation (#C22)
    const handleCaptureBrowserGeo = () => {
        if (typeof navigator === "undefined" || !navigator.geolocation) {
            toast.error("Geolocalização não suportada pelo navegador");
            return;
        }
        setIsGettingGeo(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setLocLat(pos.coords.latitude.toFixed(6));
                setLocLng(pos.coords.longitude.toFixed(6));
                if (!locName) setLocName("Minha localização atual");
                setIsGettingGeo(false);
                toast.success("Localização capturada com sucesso!");
            },
            () => {
                setIsGettingGeo(false);
                toast.error("Permissão de localização negada ou indisponível");
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    };

    // Send Location Pin (#C22)
    const handleSendLocationPin = async () => {
        const latNum = parseFloat(locLat.replace(",", "."));
        const lngNum = parseFloat(locLng.replace(",", "."));
        if (isNaN(latNum) || isNaN(lngNum)) {
            toast.error("Informe coordenadas válidas de Latitude e Longitude");
            return;
        }
        setIsSendingSpecial(true);
        const tempKeyId = `temp-${Date.now()}`;
        const nowIso = new Date().toISOString();
        const contentPayload = locName || locAddress
            ? `${latNum},${lngNum}|${locName.trim()}|${locAddress.trim()}`
            : `${latNum},${lngNum}`;

        const optimisticMsg: Message = {
            id: tempKeyId,
            keyId: tempKeyId,
            remoteJid: jid,
            fromMe: true,
            type: "LOCATION",
            content: contentPayload,
            status: "PENDING",
            timestamp: nowIso,
        };
        setMessages(prev => [...prev, optimisticMsg]);
        setIsSendLocationOpen(false);
        requestAnimationFrame(() => scrollToBottom(true));

        try {
            const res = await sendLocationPinMessage(sessionId, jid, latNum, lngNum, locName, locAddress);
            setMessages(prev => prev.map(m => m.keyId === tempKeyId ? { ...m, keyId: res?.keyId || m.keyId, status: "SENT" } : m));
            toast.success("Localização enviada!");
            setLocLat("");
            setLocLng("");
            setLocName("");
            setLocAddress("");
        } catch (err: any) {
            toast.error(err?.message || "Erro ao enviar localização");
            setMessages(prev => prev.map(m => m.keyId === tempKeyId ? { ...m, status: "FAILED" } : m));
        } finally {
            setIsSendingSpecial(false);
        }
    };

    // Send Native Poll (#C23)
    const handleSendPoll = async () => {
        const cleanQ = pollQuestion.trim();
        const cleanOpts = pollOptions.map(o => o.trim()).filter(Boolean);
        if (!cleanQ || cleanOpts.length < 2) {
            toast.error("Informe a pergunta e pelo menos 2 opções");
            return;
        }
        setIsSendingSpecial(true);
        const tempKeyId = `temp-${Date.now()}`;
        const nowIso = new Date().toISOString();
        const contentPayload = `${cleanQ}|${cleanOpts.join(";;")}`;

        const optimisticMsg: Message = {
            id: tempKeyId,
            keyId: tempKeyId,
            remoteJid: jid,
            fromMe: true,
            type: "POLL",
            content: contentPayload,
            status: "PENDING",
            timestamp: nowIso,
        };
        setMessages(prev => [...prev, optimisticMsg]);
        setIsSendPollOpen(false);
        requestAnimationFrame(() => scrollToBottom(true));

        try {
            const res = await sendPollMessage(
                sessionId,
                jid,
                cleanQ,
                cleanOpts,
                pollAllowMultiple ? cleanOpts.length : 1
            );
            setMessages(prev => prev.map(m => m.keyId === tempKeyId ? { ...m, keyId: res?.keyId || m.keyId, status: "SENT" } : m));
            toast.success("📊 Enquete enviada!");
            setPollQuestion("");
            setPollOptions(["", ""]);
            setPollAllowMultiple(false);
        } catch (err: any) {
            toast.error(err?.message || "Erro ao enviar enquete");
            setMessages(prev => prev.map(m => m.keyId === tempKeyId ? { ...m, status: "FAILED" } : m));
        } finally {
            setIsSendingSpecial(false);
        }
    };

    // Confirm Direct Schedule Message (#C25)
    const handleConfirmSchedule = async () => {
        if (!scheduleText.trim() || !scheduleDateTime) {
            toast.error("Preencha o texto da mensagem e o horário do agendamento");
            return;
        }
        setIsSavingSchedule(true);
        try {
            const sendAtIso = new Date(scheduleDateTime).toISOString();
            await scheduleDirectChatMessage(sessionId, jid, scheduleText.trim(), sendAtIso);
            toast.success(`🕒 Mensagem agendada para ${new Date(scheduleDateTime).toLocaleString("pt-BR")}!`);
            setIsScheduleModalOpen(false);
            setScheduleText("");
            setScheduleDateTime("");
        } catch (err: any) {
            toast.error(err?.message || "Falha ao agendar mensagem");
        } finally {
            setIsSavingSchedule(false);
        }
    };

    const displayName = name || jid.split('@')[0];

    return (
        <div className="flex-1 flex flex-row min-w-0 min-h-0 overflow-hidden relative">
            <div
                className="flex-1 flex flex-col min-w-0 min-h-0 relative select-text"
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        initiateFilesPreview(e.dataTransfer.files);
                    }
                }}
            >
            {/* Webcam Capture Modal (#C36) */}
            <Dialog open={isCameraModalOpen} onOpenChange={(open) => { if (!open) handleCloseCamera(); }}>
                <DialogContent className="max-w-lg rounded-2xl bg-white dark:bg-[#202c33] border border-border/40 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                            <Camera className="h-4.5 w-4.5 text-[#00a884]" />
                            <span>Tirar Foto com a Câmera</span>
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-1">
                        <div className="relative rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center border border-border/30">
                            <video
                                ref={cameraVideoRef}
                                autoPlay
                                playsInline
                                muted
                                className="w-full h-full object-cover"
                            />
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={handleCloseCamera}>
                                Cancelar
                            </Button>
                            <Button
                                size="sm"
                                className="bg-[#00a884] hover:bg-[#00a884]/90 text-white gap-1.5"
                                onClick={handleCaptureCameraPhoto}
                            >
                                <Camera className="h-4 w-4" />
                                <span>Capturar Foto</span>
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
            {/* Context menu */}
            {(forwardingMessage || (forwardingMessagesList && forwardingMessagesList.length > 0)) && (
                <ForwardModal
                    sessionId={sessionId}
                    message={forwardingMessage}
                    messagesList={forwardingMessagesList || undefined}
                    onClose={() => {
                        setForwardingMessage(null);
                        setForwardingMessagesList(null);
                        setIsSelectMode(false);
                        setSelectedMsgIds([]);
                    }}
                />
            )}
            {contextMenu && (
                <ContextMenu
                    state={contextMenu}
                    onClose={() => setContextMenu(null)}
                    onReply={(msg) => { setReplyingTo(msg); scrollToBottom(true); }}
                    onEdit={(msg) => setEditingMessage({ keyId: msg.keyId, text: msg.content || "" })}
                    onDelete={(msg) => setDeleteConfirmMsg(msg)}
                    onTogglePin={handleTogglePin}
                    onToggleStar={handleToggleStar}
                    onForward={msg => setForwardingMessage(msg)}
                    onSelectMessages={(msg) => {
                        setIsSelectMode(true);
                        setSelectedMsgIds([msg.keyId]);
                    }}
                    onInspectMessage={(msg) => setInspectingMessage(msg)}
                    isPinned={pinnedMessageIds.includes(contextMenu.msg.keyId)}
                    isStarred={starredIds.includes(contextMenu.msg.keyId)}
                />
            )}

            {/* Free LLM AI Assistant Modal (#C29) */}
            <Dialog open={isAIAssistantOpen} onOpenChange={setIsAIAssistantOpen}>
                <DialogContent className="max-w-lg rounded-2xl bg-white dark:bg-[#202c33] border border-border/40 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-base font-semibold flex items-center justify-between text-foreground pr-4">
                            <span className="flex items-center gap-2">
                                <Sparkles className="h-4.5 w-4.5 text-purple-500" />
                                <span>Assistente de IA Gratuita ({displayName})</span>
                            </span>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setShowLLMKeyConfig(prev => !prev)}
                                className="h-7 px-2.5 text-[11px] gap-1 rounded-full cursor-pointer"
                            >
                                <Settings className="h-3 w-3" />
                                <span>{showLLMKeyConfig ? "Voltar ao Assistente" : "Chaves Gratuitas"}</span>
                            </Button>
                        </DialogTitle>
                    </DialogHeader>

                    {showLLMKeyConfig ? (
                        <div className="space-y-3 py-1 text-xs">
                            <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/25 text-foreground space-y-1">
                                <p className="font-semibold text-purple-600 dark:text-purple-400">
                                    ⚡ Roteador Multi-Provedor Free LLM APIs
                                </p>
                                <p className="text-[11px] text-muted-foreground leading-relaxed">
                                    Configure uma ou mais chaves 100% gratuitas abaixo. Se uma atingir o limite por minuto, o ZapFlow alterna automaticamente para a próxima! (A chave da Groq também ativa a transcrição gratuita de áudios Whisper V3).
                                </p>
                            </div>

                            <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1 styled-scrollbar">
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="font-semibold text-foreground">1. Groq API Key (Llama 3.3 70B + Whisper Áudio)</label>
                                        <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="text-[10.5px] text-[#00a884] hover:underline">
                                            Gerar chave grátis ↗
                                        </a>
                                    </div>
                                    <Input
                                        type="password"
                                        placeholder="gsk_..."
                                        value={llmKeys.groqApiKey || ""}
                                        onChange={e => setLlmKeys(prev => ({ ...prev, groqApiKey: e.target.value }))}
                                        className="h-8 text-xs font-mono"
                                    />
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="font-semibold text-foreground">2. Google AI Studio (Gemini 2.0 Flash)</label>
                                        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-[10.5px] text-[#00a884] hover:underline">
                                            Gerar chave grátis ↗
                                        </a>
                                    </div>
                                    <Input
                                        type="password"
                                        placeholder="AIzaSy..."
                                        value={llmKeys.geminiApiKey || ""}
                                        onChange={e => setLlmKeys(prev => ({ ...prev, geminiApiKey: e.target.value }))}
                                        className="h-8 text-xs font-mono"
                                    />
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="font-semibold text-foreground">3. OpenRouter (:free Models)</label>
                                        <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-[10.5px] text-[#00a884] hover:underline">
                                            Gerar chave grátis ↗
                                        </a>
                                    </div>
                                    <Input
                                        type="password"
                                        placeholder="sk-or-v1-..."
                                        value={llmKeys.openrouterApiKey || ""}
                                        onChange={e => setLlmKeys(prev => ({ ...prev, openrouterApiKey: e.target.value }))}
                                        className="h-8 text-xs font-mono"
                                    />
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="font-semibold text-foreground">4. Cerebras Cloud (Llama 3.3 70B Ultra-Fast)</label>
                                        <a href="https://cloud.cerebras.ai" target="_blank" rel="noopener noreferrer" className="text-[10.5px] text-[#00a884] hover:underline">
                                            Gerar chave grátis ↗
                                        </a>
                                    </div>
                                    <Input
                                        type="password"
                                        placeholder="csk-..."
                                        value={llmKeys.cerebrasApiKey || ""}
                                        onChange={e => setLlmKeys(prev => ({ ...prev, cerebrasApiKey: e.target.value }))}
                                        className="h-8 text-xs font-mono"
                                    />
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <Button variant="ghost" size="sm" onClick={() => setShowLLMKeyConfig(false)}>
                                    Cancelar
                                </Button>
                                <Button
                                    size="sm"
                                    className="bg-[#00a884] hover:bg-[#00a884]/90 text-white"
                                    onClick={() => {
                                        saveLLMKeys(llmKeys);
                                        setShowLLMKeyConfig(false);
                                        toast.success("🔑 Chaves gratuitas de IA salvas neste navegador!");
                                        handleRunAIAssistant(aiMode);
                                    }}
                                >
                                    Salvar Chaves
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3 py-1">
                            {/* Quick Mode Pills */}
                            <div className="flex flex-wrap gap-1.5">
                                {[
                                    { id: "suggest_reply", label: "💡 Sugerir 3 Respostas" },
                                    { id: "summarize_chat", label: "📋 Resumir Conversa" },
                                    { id: "improve_professional", label: "💼 Profissional" },
                                    { id: "improve_friendly", label: "😊 Amigável" },
                                    { id: "improve_persuasive", label: "🚀 Comercial" },
                                    { id: "fix_grammar", label: "✅ Corrigir" }
                                ].map(item => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => handleRunAIAssistant(item.id as ChatAIAssistantMode)}
                                        className={cn(
                                            "px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer",
                                            aiMode === item.id
                                                ? "bg-purple-600 text-white"
                                                : "bg-muted/70 hover:bg-muted text-muted-foreground"
                                        )}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>

                            {/* Draft input for rewrite modes */}
                            {aiMode !== "suggest_reply" && aiMode !== "summarize_chat" && (
                                <div className="space-y-1">
                                    <label className="text-[11px] font-medium text-muted-foreground">Texto base para aprimorar:</label>
                                    <div className="flex gap-1.5">
                                        <Input
                                            value={aiInputDraft}
                                            onChange={e => setAiInputDraft(e.target.value)}
                                            placeholder="Digite o rascunho que deseja melhorar..."
                                            className="h-8 text-xs"
                                        />
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            className="h-8 text-xs shrink-0"
                                            disabled={isRunningAI}
                                            onClick={() => handleRunAIAssistant(aiMode)}
                                        >
                                            Gerar
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* Output Area */}
                            {isRunningAI ? (
                                <div className="py-10 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                                    <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
                                    <span>Consultando IA gratuita...</span>
                                </div>
                            ) : aiMode === "suggest_reply" && aiSuggestions.length > 0 ? (
                                <div className="space-y-2 max-h-64 overflow-y-auto pr-1 styled-scrollbar">
                                    <span className="text-[11px] font-semibold text-muted-foreground block">
                                        Clique em uma sugestão para preencher a caixa de mensagem:
                                    </span>
                                    {aiSuggestions.map((sug, i) => (
                                        <button
                                            key={i}
                                            type="button"
                                            onClick={() => {
                                                window.dispatchEvent(new CustomEvent("zapflow:set-chat-input", { detail: { text: sug } }));
                                                setIsAIAssistantOpen(false);
                                                toast.success("✨ Resposta inserida na barra de digitação!");
                                            }}
                                            className="w-full p-3 rounded-xl bg-muted/40 hover:bg-purple-500/10 border border-border/30 hover:border-purple-500/40 text-left text-xs text-foreground transition-all cursor-pointer space-y-1"
                                        >
                                            <div className="flex items-center justify-between text-[10.5px] font-bold text-purple-600 dark:text-purple-400">
                                                <span>Opção {i + 1}</span>
                                                <span>Usar no chat →</span>
                                            </div>
                                            <p className="whitespace-pre-wrap leading-relaxed">{sug}</p>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <textarea
                                        rows={5}
                                        value={aiResult}
                                        onChange={e => setAiResult(e.target.value)}
                                        className="w-full rounded-xl bg-muted/40 dark:bg-[#2a3942] border border-border/40 px-3 py-2 text-xs text-foreground outline-none focus:border-purple-500 resize-none leading-relaxed"
                                    />
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        {aiMode === "summarize_chat" ? (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-8 text-xs gap-1.5"
                                                onClick={() => {
                                                    const nextNote = chatNote.trim() ? `${chatNote}\n\n${aiResult}` : aiResult;
                                                    handleSaveChatNote(nextNote);
                                                    toast.success("📝 Resumo salvo no Bloco de Notas Interno da conversa!");
                                                    setIsAIAssistantOpen(false);
                                                }}
                                            >
                                                <StickyNote className="h-3.5 w-3.5 text-amber-500" />
                                                <span>Salvar no Bloco de Notas Interno</span>
                                            </Button>
                                        ) : <span />}
                                        <div className="flex items-center gap-2 ml-auto">
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-8 text-xs gap-1"
                                                onClick={() => {
                                                    navigator.clipboard.writeText(aiResult);
                                                    toast.success("Texto copiado!");
                                                }}
                                            >
                                                <Copy className="h-3.5 w-3.5" />
                                                <span>Copiar</span>
                                            </Button>
                                            <Button
                                                size="sm"
                                                className="h-8 text-xs bg-[#00a884] hover:bg-[#00a884]/90 text-white"
                                                onClick={() => {
                                                    window.dispatchEvent(new CustomEvent("zapflow:set-chat-input", { detail: { text: aiResult } }));
                                                    setIsAIAssistantOpen(false);
                                                    toast.success("✨ Texto inserido na barra de digitação!");
                                                }}
                                            >
                                                Usar na Conversa
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {aiProviderInfo && (
                                <div className="pt-1 border-t border-border/20 flex items-center justify-between text-[10.5px] text-muted-foreground">
                                    <span>
                                        Motor ativo: <strong className="text-foreground">{aiProviderInfo.provider}</strong> ({aiProviderInfo.model})
                                    </span>
                                    {aiProviderInfo.isLocalFallback && (
                                        <button
                                            type="button"
                                            onClick={() => setShowLLMKeyConfig(true)}
                                            className="text-purple-500 hover:underline font-semibold cursor-pointer"
                                        >
                                            + Ativar Groq/Gemini 70B Grátis
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Dados da Mensagem Modal (#C27) */}
            <Dialog open={!!inspectingMessage} onOpenChange={(open) => { if (!open) setInspectingMessage(null); }}>
                <DialogContent className="max-w-md rounded-2xl bg-white dark:bg-[#202c33] border border-border/40 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                            <Info className="h-4.5 w-4.5 text-[#00a884]" />
                            <span>Dados da mensagem</span>
                        </DialogTitle>
                    </DialogHeader>
                    {inspectingMessage && (
                        <div className="space-y-3 py-1">
                            <div
                                className={cn(
                                    "p-3 rounded-xl text-sm shadow-xs border border-black/5 dark:border-white/10",
                                    inspectingMessage.fromMe
                                        ? "bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef]"
                                        : "bg-muted/60 dark:bg-[#111b21] text-foreground"
                                )}
                            >
                                <p className="whitespace-pre-wrap break-words text-xs">
                                    {inspectingMessage.content || `[${inspectingMessage.type}]`}
                                </p>
                            </div>
                            <div className="divide-y border rounded-xl overflow-hidden text-xs">
                                <div className="p-2.5 flex items-center justify-between">
                                    <span className="text-muted-foreground font-medium">Status</span>
                                    <span className="font-semibold flex items-center gap-1.5">
                                        {inspectingMessage.fromMe ? (
                                            <>
                                                <MessageStatusCheck status={inspectingMessage.status} />
                                                <span>
                                                    {inspectingMessage.status === "READ"
                                                        ? "Lida pelo destinatário"
                                                        : inspectingMessage.status === "DELIVERED"
                                                            ? "Entregue"
                                                            : inspectingMessage.status === "SENT"
                                                                ? "Enviada"
                                                                : "Pendente"}
                                                </span>
                                            </>
                                        ) : (
                                            <span className="text-[#00a884]">Recebida</span>
                                        )}
                                    </span>
                                </div>
                                <div className="p-2.5 flex items-center justify-between">
                                    <span className="text-muted-foreground font-medium">Data e horário exatos</span>
                                    <span className="font-mono font-medium">
                                        {new Date(inspectingMessage.timestamp).toLocaleDateString("pt-BR")} às {new Date(inspectingMessage.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                    </span>
                                </div>
                                <div className="p-2.5 flex items-center justify-between">
                                    <span className="text-muted-foreground font-medium">Tipo</span>
                                    <span className="font-mono uppercase">{inspectingMessage.type}</span>
                                </div>
                                <div className="p-2.5 flex items-center justify-between">
                                    <span className="text-muted-foreground font-medium">ID da Mensagem</span>
                                    <span className="font-mono text-[11px] truncate max-w-[200px]" title={inspectingMessage.keyId}>
                                        {inspectingMessage.keyId}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Send Contact (vCard) Modal (#C22) */}
            <Dialog open={isSendContactOpen} onOpenChange={setIsSendContactOpen}>
                <DialogContent className="max-w-md rounded-2xl bg-white dark:bg-[#202c33] border border-border/40 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                            <User className="h-4.5 w-4.5 text-[#00a884]" />
                            <span>Enviar Cartão de Contato (vCard)</span>
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-1">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Selecionar da sua lista de conversas/agenda:</label>
                            <Input
                                placeholder="Pesquisar contato pelo nome ou número..."
                                value={contactSearchQuery}
                                onChange={(e) => setContactSearchQuery(e.target.value)}
                                className="h-8 text-xs"
                            />
                            <div className="max-h-36 overflow-y-auto divide-y border rounded-xl styled-scrollbar">
                                {(globalChatListCache.get(sessionId) || [])
                                    .filter(c => !c.jid.endsWith("@g.us"))
                                    .filter(c => {
                                        const q = contactSearchQuery.trim().toLowerCase();
                                        if (!q) return true;
                                        return (c.name || c.notify || "").toLowerCase().includes(q) || c.jid.includes(q);
                                    })
                                    .slice(0, 20)
                                    .map(c => {
                                        const cName = c.name || c.notify || c.jid.split("@")[0];
                                        const cPhone = c.jid.split("@")[0].replace(/\D/g, "");
                                        return (
                                            <button
                                                key={c.jid}
                                                type="button"
                                                disabled={isSendingSpecial}
                                                onClick={() => handleSendContactCard(cName, cPhone)}
                                                className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-muted/50 transition-colors cursor-pointer text-xs"
                                            >
                                                <div className="truncate">
                                                    <p className="font-semibold text-foreground truncate">{cName}</p>
                                                    <p className="text-[10px] font-mono text-muted-foreground">+{cPhone}</p>
                                                </div>
                                                <span className="text-[#00a884] font-semibold shrink-0">Enviar</span>
                                            </button>
                                        );
                                    })}
                            </div>
                        </div>

                        <div className="relative flex py-1 items-center">
                            <div className="flex-grow border-t border-border/30" />
                            <span className="flex-shrink mx-2 text-[10px] uppercase text-muted-foreground">ou digite manualmente</span>
                            <div className="flex-grow border-t border-border/30" />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <Input
                                placeholder="Nome do contato"
                                value={customContactName}
                                onChange={(e) => setCustomContactName(e.target.value)}
                                className="h-9 text-xs"
                            />
                            <Input
                                placeholder="Telefone (ex: 5566999999999)"
                                value={customContactPhone}
                                onChange={(e) => setCustomContactPhone(e.target.value)}
                                className="h-9 text-xs"
                            />
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                            <Button variant="ghost" size="sm" onClick={() => setIsSendContactOpen(false)}>
                                Cancelar
                            </Button>
                            <Button
                                size="sm"
                                disabled={!customContactPhone.trim() || isSendingSpecial}
                                className="bg-[#00a884] hover:bg-[#00a884]/90 text-white"
                                onClick={() => handleSendContactCard(customContactName || customContactPhone, customContactPhone)}
                            >
                                Enviar Contato
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Send Location Pin Modal (#C22) */}
            <Dialog open={isSendLocationOpen} onOpenChange={setIsSendLocationOpen}>
                <DialogContent className="max-w-md rounded-2xl bg-white dark:bg-[#202c33] border border-border/40 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                            <MapPin className="h-4.5 w-4.5 text-[#00a884]" />
                            <span>Enviar Localização no WhatsApp</span>
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-1">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isGettingGeo}
                            onClick={handleCaptureBrowserGeo}
                            className="w-full justify-center gap-2 h-9 text-xs border-[#00a884]/40 text-[#00a884] hover:bg-[#00a884]/10 cursor-pointer"
                        >
                            <MapPin className="h-4 w-4" />
                            <span>{isGettingGeo ? "Obtendo localização do GPS..." : "📍 Usar minha localização atual (GPS)"}</span>
                        </Button>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-[11px] text-muted-foreground">Latitude</label>
                                <Input
                                    placeholder="-15.550000"
                                    value={locLat}
                                    onChange={(e) => setLocLat(e.target.value)}
                                    className="h-8 text-xs"
                                />
                            </div>
                            <div>
                                <label className="text-[11px] text-muted-foreground">Longitude</label>
                                <Input
                                    placeholder="-54.300000"
                                    value={locLng}
                                    onChange={(e) => setLocLng(e.target.value)}
                                    className="h-8 text-xs"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-[11px] text-muted-foreground">Nome do Local (opcional)</label>
                            <Input
                                placeholder="Ex: Escritório / Fazenda / Galpão"
                                value={locName}
                                onChange={(e) => setLocName(e.target.value)}
                                className="h-8 text-xs"
                            />
                        </div>
                        <div>
                            <label className="text-[11px] text-muted-foreground">Endereço completo (opcional)</label>
                            <Input
                                placeholder="Ex: Av. Brasil, 1000 - Centro"
                                value={locAddress}
                                onChange={(e) => setLocAddress(e.target.value)}
                                className="h-8 text-xs"
                            />
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                            <Button variant="ghost" size="sm" onClick={() => setIsSendLocationOpen(false)}>
                                Cancelar
                            </Button>
                            <Button
                                size="sm"
                                disabled={!locLat.trim() || !locLng.trim() || isSendingSpecial}
                                className="bg-[#00a884] hover:bg-[#00a884]/90 text-white"
                                onClick={handleSendLocationPin}
                            >
                                Enviar Localização
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Create & Send Poll Modal (#C23) */}
            <Dialog open={isSendPollOpen} onOpenChange={setIsSendPollOpen}>
                <DialogContent className="max-w-md rounded-2xl bg-white dark:bg-[#202c33] border border-border/40 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                            <BarChart2 className="h-4.5 w-4.5 text-[#00a884]" />
                            <span>Criar Enquete</span>
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-1">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Pergunta</label>
                            <Input
                                placeholder="Faça uma pergunta..."
                                value={pollQuestion}
                                onChange={(e) => setPollQuestion(e.target.value)}
                                className="h-9 text-xs mt-1"
                            />
                        </div>
                        <div className="space-y-2 max-h-52 overflow-y-auto pr-1 styled-scrollbar">
                            <label className="text-xs font-medium text-muted-foreground">Opções</label>
                            {pollOptions.map((opt, idx) => (
                                <div key={idx} className="flex items-center gap-1.5">
                                    <Input
                                        placeholder={`Opção ${idx + 1}`}
                                        value={opt}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setPollOptions(prev => prev.map((o, i) => i === idx ? val : o));
                                        }}
                                        className="h-8 text-xs"
                                    />
                                    {pollOptions.length > 2 && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                                            onClick={() => setPollOptions(prev => prev.filter((_, i) => i !== idx))}
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </Button>
                                    )}
                                </div>
                            ))}
                            {pollOptions.length < 12 && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPollOptions(prev => [...prev, ""])}
                                    className="w-full h-8 text-xs gap-1.5 border-dashed cursor-pointer"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    Adicionar opção
                                </Button>
                            )}
                        </div>
                        <label className="flex items-center gap-2 text-xs cursor-pointer select-none pt-1">
                            <Checkbox
                                checked={pollAllowMultiple}
                                onCheckedChange={(c) => setPollAllowMultiple(Boolean(c))}
                            />
                            <span>Permitir várias respostas</span>
                        </label>
                        <div className="flex justify-end gap-2 pt-1">
                            <Button variant="ghost" size="sm" onClick={() => setIsSendPollOpen(false)}>
                                Cancelar
                            </Button>
                            <Button
                                size="sm"
                                disabled={!pollQuestion.trim() || pollOptions.filter(o => o.trim()).length < 2 || isSendingSpecial}
                                className="bg-[#00a884] hover:bg-[#00a884]/90 text-white"
                                onClick={handleSendPoll}
                            >
                                Enviar Enquete
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Schedule Direct Chat Message Modal (#C25) */}
            <Dialog open={isScheduleModalOpen} onOpenChange={setIsScheduleModalOpen}>
                <DialogContent className="max-w-md rounded-2xl bg-white dark:bg-[#202c33] border border-border/40 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                            <CalendarClock className="h-4.5 w-4.5 text-[#00a884]" />
                            <span>Agendar mensagem para {displayName}</span>
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-1">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Mensagem a ser enviada</label>
                            <textarea
                                rows={3}
                                value={scheduleText}
                                onChange={(e) => setScheduleText(e.target.value)}
                                placeholder="Digite a mensagem que será enviada automaticamente..."
                                className="w-full mt-1 rounded-xl bg-muted/40 dark:bg-[#2a3942] border border-border/40 px-3 py-2 text-xs text-foreground outline-none focus:border-[#00a884] resize-none"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Atalhos rápidos de horário</label>
                            <div className="flex flex-wrap gap-1.5">
                                {[
                                    { label: "+30 min", fn: () => new Date(Date.now() + 30 * 60000) },
                                    { label: "+1 hora", fn: () => new Date(Date.now() + 60 * 60000) },
                                    {
                                        label: "Amanhã 08:00",
                                        fn: () => {
                                            const d = new Date();
                                            d.setDate(d.getDate() + 1);
                                            d.setHours(8, 0, 0, 0);
                                            return d;
                                        }
                                    },
                                    {
                                        label: "Amanhã 14:00",
                                        fn: () => {
                                            const d = new Date();
                                            d.setDate(d.getDate() + 1);
                                            d.setHours(14, 0, 0, 0);
                                            return d;
                                        }
                                    }
                                ].map((preset, i) => (
                                    <button
                                        key={i}
                                        type="button"
                                        onClick={() => {
                                            const d = preset.fn();
                                            const tzOffset = d.getTimezoneOffset() * 60000;
                                            const localIso = new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
                                            setScheduleDateTime(localIso);
                                        }}
                                        className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#00a884]/15 text-[#00a884] hover:bg-[#00a884]/25 transition-colors cursor-pointer"
                                    >
                                        {preset.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Data e Hora do Disparo</label>
                            <Input
                                type="datetime-local"
                                value={scheduleDateTime}
                                onChange={(e) => setScheduleDateTime(e.target.value)}
                                className="h-9 text-xs mt-1"
                            />
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                            <Button variant="ghost" size="sm" onClick={() => setIsScheduleModalOpen(false)}>
                                Cancelar
                            </Button>
                            <Button
                                size="sm"
                                disabled={!scheduleText.trim() || !scheduleDateTime || isSavingSchedule}
                                className="bg-[#00a884] hover:bg-[#00a884]/90 text-white"
                                onClick={handleConfirmSchedule}
                            >
                                {isSavingSchedule ? "Agendando..." : "Confirmar Agendamento"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Drag overlay */}
            {isDragging && (
                <div className="absolute inset-0 z-50 bg-[#00a884]/90 backdrop-blur-sm border-2 border-dashed border-white flex items-center justify-center flex-col gap-3 rounded-lg m-2 text-white">
                    <Paperclip className="h-10 w-10 animate-bounce" />
                    <p className="text-lg font-semibold">Solte um ou mais arquivos para enviar</p>
                </div>
            )}

            {/* Edit sent message dialog (#C8) */}
            <Dialog open={!!editingMessage} onOpenChange={(open) => { if (!open) setEditingMessage(null); }}>
                <DialogContent className="max-w-md rounded-2xl bg-white dark:bg-[#202c33] border border-border/40 shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                            <Pencil className="h-4.5 w-4.5 text-[#00a884]" />
                            <span>Editar mensagem enviada</span>
                        </DialogTitle>
                    </DialogHeader>
                    <div className="py-2">
                        <textarea
                            value={editingMessage?.text || ""}
                            onChange={(e) => setEditingMessage(prev => prev ? { ...prev, text: e.target.value } : null)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    const btn = document.getElementById("zapflow-confirm-edit-btn");
                                    btn?.click();
                                }
                            }}
                            rows={3}
                            className="w-full rounded-xl bg-muted/40 dark:bg-[#2a3942] border border-border/40 px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-[#00a884] resize-none"
                            placeholder="Digite o novo texto da mensagem..."
                            autoFocus
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setEditingMessage(null)} disabled={isSavingEdit}>
                            Cancelar
                        </Button>
                        <Button
                            id="zapflow-confirm-edit-btn"
                            size="sm"
                            disabled={!editingMessage?.text.trim() || isSavingEdit}
                            className="bg-[#00a884] hover:bg-[#00a884]/90 text-white"
                            onClick={async () => {
                                if (!editingMessage || !editingMessage.text.trim()) return;
                                const { keyId, text } = editingMessage;
                                const cleanText = text.trim();
                                setIsSavingEdit(true);
                                try {
                                    const res = await fetch(`/api/messages/${sessionId}/${encodeURIComponent(jid)}/${encodeURIComponent(keyId)}`, {
                                        method: "PATCH",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ text: cleanText })
                                    });
                                    if (!res.ok) throw new Error("Falha ao editar mensagem");
                                    setMessages(prev => prev.map(m => m.keyId === keyId ? { ...m, content: cleanText, isEdited: true } : m));
                                    toast.success("Mensagem editada com sucesso!");
                                    setEditingMessage(null);
                                } catch (err: any) {
                                    toast.error(err?.message || "Erro ao editar a mensagem");
                                } finally {
                                    setIsSavingEdit(false);
                                }
                            }}
                        >
                            Salvar alteração
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Delete confirmation dialog (#C8) */}
            <AlertDialog open={!!deleteConfirmMsg} onOpenChange={(open) => { if (!open) setDeleteConfirmMsg(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {deleteConfirmMsg?.fromMe ? "Apagar mensagem para todos?" : "Excluir mensagem?"}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {deleteConfirmMsg?.fromMe
                                ? "Esta mensagem será revogada no WhatsApp de todos os participantes e removida do histórico."
                                : "Isso removerá a mensagem selecionada do seu histórico local."}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                                const msg = deleteConfirmMsg;
                                if (!msg) return;
                                fetch(`/api/messages/${sessionId}/${encodeURIComponent(jid)}/${encodeURIComponent(msg.keyId)}`, { method: "DELETE" })
                                    .then(() => {
                                        setMessages(p => p.filter(m => m.keyId !== msg.keyId));
                                        toast.success(msg.fromMe ? "Mensagem apagada para todos" : "Mensagem excluída");
                                    })
                                    .catch(() => toast.error("Falha ao excluir a mensagem"));
                                setDeleteConfirmMsg(null);
                            }}
                        >
                            {deleteConfirmMsg?.fromMe ? "Apagar para todos" : "Excluir"}
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
                    <Avatar className="h-10 w-10 shrink-0 cursor-pointer hover:opacity-85 transition-opacity" onClick={() => { setChatInfoModalTab("media"); setIsChatInfoModalOpen(true); }}>
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
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { setChatInfoModalTab("media"); setIsChatInfoModalOpen(true); }}>
                        <div className="flex items-center gap-2">
                            <h3 className="text-[15px] font-semibold text-foreground truncate leading-snug">
                                {displayName}
                            </h3>
                            {isChatMuted && (
                                <span title="Notificações desta conversa silenciadas" className="text-muted-foreground shrink-0">
                                    <VolumeX className="h-3.5 w-3.5" />
                                </span>
                            )}
                            {/* Contact Labels in Header */}
                            {chatLabels.length > 0 && (
                                <div className="hidden sm:flex items-center gap-1 shrink-0 overflow-hidden" onClick={e => e.stopPropagation()}>
                                    {chatLabels.slice(0, 3).map(l => (
                                        <span
                                            key={l.id}
                                            className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border shadow-xs"
                                            style={{
                                                backgroundColor: `${l.colorHex}15`,
                                                borderColor: `${l.colorHex}45`,
                                                color: l.colorHex
                                            }}
                                            title={l.name}
                                        >
                                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: l.colorHex }} />
                                            <span className="truncate max-w-[80px]">{l.name}</span>
                                        </span>
                                    ))}
                                    {chatLabels.length > 3 && (
                                        <span className="text-[10px] text-muted-foreground font-semibold px-1 py-0.2 rounded-full bg-muted">
                                            +{chatLabels.length - 3}
                                        </span>
                                    )}
                                </div>
                            )}
                            <LabelAssignPopover sessionId={sessionId} jid={jid}>
                                <button
                                    type="button"
                                    onClick={e => e.stopPropagation()}
                                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-[#00a884] px-1.5 py-0.5 rounded-full bg-black/5 dark:bg-white/10 hover:bg-[#00a884]/15 transition-colors shrink-0 cursor-pointer"
                                    title="Atribuir etiquetas para este contato"
                                >
                                    <Tag className="h-2.5 w-2.5" />
                                    <span>{chatLabels.length === 0 ? "Etiquetar" : "+"}</span>
                                </button>
                            </LabelAssignPopover>
                        </div>
                        <p className="text-[11.5px] text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
                            {presenceInfo ? (
                                <span className="flex items-center gap-1.5 text-[#00a884] font-medium animate-pulse">
                                    {presenceInfo.isRecording ? (
                                        <>
                                            <Mic className="h-3 w-3" />
                                            <span>{presenceInfo.sender ? `${presenceInfo.sender} gravando áudio...` : "gravando áudio..."}</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="h-1.5 w-1.5 rounded-full bg-[#00a884]" />
                                            <span>{presenceInfo.sender ? `${presenceInfo.sender} digitando...` : "digitando..."}</span>
                                        </>
                                    )}
                                </span>
                            ) : isGroup ? (
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
                    {isGroup && participantsList.length > 0 && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={exportGroupParticipants}
                            className="hidden md:flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium text-[#00a884] hover:bg-[#00a884]/10 rounded-full cursor-pointer transition-colors"
                            title={`Exportar ${participantsList.length} participantes para CSV`}
                        >
                            <FileDown className="h-4 w-4" />
                            <span>Exportar ({participantsList.length})</span>
                        </Button>
                    )}
                    {/* Internal Chat Notes Popover (#C21) */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className={cn(
                                    "h-9 w-9 rounded-full hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer relative",
                                    chatNote.trim().length > 0 && "text-amber-500 bg-amber-500/10"
                                )}
                                title={chatNote.trim().length > 0 ? "Notas internas da conversa (com anotação)" : "Adicionar nota interna da conversa"}
                            >
                                <StickyNote className="h-4 w-4" />
                                {chatNote.trim().length > 0 && (
                                    <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-amber-500" />
                                )}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-80 p-3 rounded-2xl shadow-2xl bg-white dark:bg-[#233138] border border-border/30 z-50">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                                    <StickyNote className="h-3.5 w-3.5" />
                                    Bloco de Notas Interno
                                </span>
                                {chatNote.trim().length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            handleSaveChatNote("");
                                            toast.info("Nota interna limpa");
                                        }}
                                        className="text-[10px] text-muted-foreground hover:text-destructive cursor-pointer"
                                    >
                                        Limpar
                                    </button>
                                )}
                            </div>
                            <textarea
                                value={chatNote}
                                onChange={(e) => handleSaveChatNote(e.target.value)}
                                rows={4}
                                placeholder="Anote informações sobre este cliente/grupo (visível apenas para você no painel)..."
                                className="w-full rounded-xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-500/30 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-amber-500 resize-none"
                            />
                            <p className="text-[10px] text-muted-foreground mt-1.5">
                                Salvo automaticamente neste navegador para esta conversa.
                            </p>
                        </PopoverContent>
                    </Popover>

                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                            "h-9 w-9 rounded-full hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer relative",
                            starredIds.length > 0 && "text-amber-500"
                        )}
                        title={`Mensagens favoritas (${starredIds.length})`}
                        onClick={() => {
                            setChatInfoModalTab("starred");
                            setIsChatInfoModalOpen(true);
                        }}
                    >
                        <Star className={cn("h-4 w-4", starredIds.length > 0 && "fill-amber-400 text-amber-400")} />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                            "h-9 w-9 rounded-full hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer",
                            isSearching && "bg-[#00a884]/15 text-[#00a884]"
                        )}
                        title="Pesquisar mensagens (Ctrl+F)"
                        onClick={() => {
                            setIsSearching(prev => {
                                const next = !prev;
                                if (next) setTimeout(() => searchInputRef.current?.focus(), 50);
                                else setSearchQuery("");
                                return next;
                            });
                        }}
                    >
                        <Search className="h-4.5 w-4.5" />
                    </Button>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer" title="Mais opções">
                                <MoreVertical className="h-4.5 w-4.5" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-56 p-1.5 rounded-2xl shadow-2xl bg-white dark:bg-[#233138] border border-border/30 z-50 animate-in fade-in zoom-in-95 duration-100">
                            {isGroup && (
                                <>
                                    <button
                                        type="button"
                                        onClick={exportGroupParticipants}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
                                    >
                                        <FileDown className="h-4 w-4 text-[#00a884]" />
                                        <span>Exportar membros (CSV)</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={sendBroadcastToGroupMembers}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
                                    >
                                        <Zap className="h-4 w-4 text-amber-500" />
                                        <span>Criar disparo com membros</span>
                                    </button>
                                    <div className="h-px bg-border/15 my-1" />
                                </>
                            )}
                            <button
                                type="button"
                                onClick={() => { setChatInfoModalTab(isGroup ? "members" : "media"); setIsChatInfoModalOpen(true); }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
                            >
                                <Info className="h-4 w-4 text-muted-foreground" />
                                <span>Dados do {isGroup ? "grupo" : "contato"}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => { setChatInfoModalTab("media"); setIsChatInfoModalOpen(true); }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
                            >
                                <ImageIcon className="h-4 w-4 text-blue-500" />
                                <span>Mídias, links e docs</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => { setChatInfoModalTab("starred"); setIsChatInfoModalOpen(true); }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
                            >
                                <Star className="h-4 w-4 text-amber-500" />
                                <span>Mensagens favoritas ({starredIds.length})</span>
                            </button>
                            <LabelAssignPopover sessionId={sessionId} jid={jid}>
                                <button
                                    type="button"
                                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
                                >
                                    <Tag className="h-4 w-4 text-emerald-500" />
                                    <span>Etiquetas da conversa</span>
                                </button>
                            </LabelAssignPopover>

                            <button
                                type="button"
                                onClick={handleToggleChatMute}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
                            >
                                {isChatMuted ? <Volume2 className="h-4 w-4 text-[#00a884]" /> : <VolumeX className="h-4 w-4 text-amber-500" />}
                                <span>{isChatMuted ? "Ativar notificações" : "Silenciar notificações"}</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    setIsSelectMode(true);
                                    setSelectedMsgIds([]);
                                }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
                            >
                                <CheckSquare className="h-4 w-4 text-[#00a884]" />
                                <span>Selecionar mensagens</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => handleOpenAIAssistant("summarize_chat", "")}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
                            >
                                <Sparkles className="h-4 w-4 text-purple-500" />
                                <span>Assistente IA (Resumir / Sugerir)</span>
                            </button>

                            <button
                                type="button"
                                onClick={handleExportConversation}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
                            >
                                <FileText className="h-4 w-4 text-[#00a884]" />
                                <span>Exportar conversa (.txt)</span>
                            </button>

                            <button
                                type="button"
                                onClick={handleExportConversationCsv}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
                            >
                                <FileDown className="h-4 w-4 text-emerald-500" />
                                <span>Exportar conversa (.csv / Excel)</span>
                            </button>

                            <div className="h-px bg-border/15 my-1" />
                            <div className="px-3 py-1.5 space-y-1.5">
                                <span className="text-[10.5px] font-semibold text-muted-foreground flex items-center gap-1.5">
                                    <Palette className="h-3 w-3 text-[#00a884]" />
                                    <span>Papel de parede do chat</span>
                                </span>
                                <div className="flex items-center gap-2">
                                    {[
                                        { id: "default", label: "Padrão WhatsApp", color: "#efeae2" },
                                        { id: "dark", label: "Grafite Escuro", color: "#0b141a" },
                                        { id: "emerald", label: "Verde Suave", color: "#d1fae5" },
                                        { id: "ocean", label: "Azul Oceano", color: "#dbeafe" },
                                        { id: "minimal", label: "Cinza Limpo", color: "#f1f5f9" }
                                    ].map(wp => (
                                        <button
                                            key={wp.id}
                                            type="button"
                                            onClick={() => handleChangeWallpaper(wp.id as any)}
                                            title={wp.label}
                                            className={cn(
                                                "h-5 w-5 rounded-full border transition-transform cursor-pointer",
                                                chatWallpaper === wp.id ? "ring-2 ring-[#00a884] scale-110" : "hover:scale-105 border-border/60"
                                            )}
                                            style={{ backgroundColor: wp.color }}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div className="h-px bg-border/15 my-1" />
                            <button
                                type="button"
                                onClick={handleClearConversation}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
                            >
                                <Trash2 className="h-4 w-4 text-amber-500" />
                                <span>Limpar conversa</span>
                            </button>
                            {!isGroup && (
                                <button
                                    type="button"
                                    onClick={handleToggleBlockContact}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-destructive rounded-xl hover:bg-destructive/10 transition-colors text-left cursor-pointer"
                                >
                                    <X className="h-4 w-4" />
                                    <span>{isContactBlocked ? "Desbloquear contato" : "Bloquear contato"}</span>
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={handleCloseCurrentChat}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
                            >
                                <ArrowLeft className="h-4 w-4" />
                                <span>Fechar conversa (Esc)</span>
                            </button>

                        </PopoverContent>
                    </Popover>
                </div>
            </div>

            {/* Internal Note Sticky Banner (#C21) */}
            {chatNote.trim().length > 0 && (
                <div className="shrink-0 px-4 py-1.5 bg-amber-50/95 dark:bg-amber-950/35 border-b border-amber-500/25 flex items-center justify-between gap-2 z-15 text-xs">
                    <div className="flex items-center gap-2 min-w-0 text-amber-800 dark:text-amber-300">
                        <StickyNote className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                        <span className="font-semibold shrink-0">Nota interna:</span>
                        <span className="truncate">{chatNote}</span>
                    </div>
                </div>
            )}

            {/* In-chat Search Bar (WhatsApp Web style) */}
            {isSearching && (
                <div className="shrink-0 px-4 py-2 bg-white dark:bg-[#111b21] border-b border-border/20 flex items-center gap-2 z-20 shadow-xs animate-in slide-in-from-top-2 duration-150 select-none">
                    <Search className="h-4 w-4 text-[#00a884] shrink-0" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setSearchMatchIdx(0);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                if (e.shiftKey) handlePrevSearchMatch();
                                else handleNextSearchMatch();
                            } else if (e.key === "Escape") {
                                e.preventDefault();
                                setIsSearching(false);
                                setSearchQuery("");
                            }
                        }}
                        placeholder="Pesquisar mensagens na conversa..."
                        className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                        autoFocus
                    />
                    {searchQuery.trim() && (
                        <span className="text-xs text-muted-foreground tabular-nums select-none shrink-0 font-medium px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10">
                            {searchMatches.length > 0 ? `${searchMatchIdx + 1} de ${searchMatches.length}` : "0 encontrados"}
                        </span>
                    )}
                    <div className="flex items-center gap-0.5">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground cursor-pointer"
                            disabled={searchMatches.length === 0}
                            onClick={handlePrevSearchMatch}
                            title="Anterior (Shift+Enter)"
                        >
                            <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground cursor-pointer"
                            disabled={searchMatches.length === 0}
                            onClick={handleNextSearchMatch}
                            title="Próxima (Enter)"
                        >
                            <ChevronDown className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground cursor-pointer"
                            onClick={() => {
                                setIsSearching(false);
                                setSearchQuery("");
                            }}
                            title="Fechar busca (Esc)"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}

            {/* WhatsApp Multi-Pinned Messages Carousel Banner (#C31) */}
            {pinnedMessage && (
                <div
                    onClick={() => {
                        const target = document.getElementById(`msg-${pinnedMessage.keyId}`);
                        if (target) {
                            target.scrollIntoView({ behavior: "smooth", block: "center" });
                            target.classList.add("bg-[#00a884]/20", "transition-colors", "duration-500");
                            setTimeout(() => target.classList.remove("bg-[#00a884]/20"), 1500);
                        }
                        if (pinnedMessagesList.length > 1) {
                            setActivePinnedIdx(prev => (prev + 1) % pinnedMessagesList.length);
                        }
                    }}
                    className="shrink-0 px-4 py-2 bg-white/95 dark:bg-[#182229]/95 backdrop-blur-sm border-b border-border/20 flex items-center justify-between gap-3 z-15 cursor-pointer shadow-xs select-none hover:bg-black/5 dark:hover:bg-white/5 transition-colors animate-in slide-in-from-top-1 duration-150"
                >
                    <div className="flex items-center gap-2.5 min-w-0">
                        {pinnedMessagesList.length > 1 && (
                            <div className="flex flex-col gap-0.5 shrink-0">
                                {pinnedMessagesList.map((pm, idx) => (
                                    <span
                                        key={pm.keyId}
                                        className={cn(
                                            "w-1 rounded-full transition-all",
                                            idx === activePinnedIdx % pinnedMessagesList.length
                                                ? "h-3 bg-[#00a884]"
                                                : "h-1.5 bg-muted-foreground/30"
                                        )}
                                    />
                                ))}
                            </div>
                        )}
                        <div className="h-6 w-6 rounded-full bg-[#00a884]/15 flex items-center justify-center shrink-0 text-[#00a884]">
                            <Pin className="h-3.5 w-3.5 rotate-45 fill-current" />
                        </div>
                        <div className="flex flex-col min-w-0">
                            <span className="text-[11px] font-semibold text-[#00a884] dark:text-[#25d366] flex items-center gap-1.5">
                                <span>Mensagem fixada</span>
                                {pinnedMessagesList.length > 1 && (
                                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#00a884]/15 font-bold tabular-nums">
                                        {(activePinnedIdx % pinnedMessagesList.length) + 1}/{pinnedMessagesList.length}
                                    </span>
                                )}
                            </span>
                            <p className="text-xs text-foreground/90 truncate max-w-lg">
                                {pinnedMessage.content || (pinnedMessage.type === 'IMAGE' ? "Foto" : "Mídia")}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleUnpin(pinnedMessage.keyId);
                        }}
                        className="p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                        title="Desafixar esta mensagem"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}

            {/* WhatsApp Chat Wallpaper & Message Stream (#C33) */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 min-h-0 styled-scrollbar"
                onScroll={handleScroll}
                style={{
                    backgroundColor:
                        chatWallpaper === "dark"
                            ? "#0b141a"
                            : chatWallpaper === "emerald"
                                ? "#ecfdf5"
                                : chatWallpaper === "ocean"
                                    ? "#eff6ff"
                                    : chatWallpaper === "minimal"
                                        ? "#f8fafc"
                                        : "var(--wa-bg, #efeae2)",
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
                                <div
                                    onClick={() => {
                                        if (isSelectMode) toggleSelectMessage(msg.keyId);
                                    }}
                                    className={cn(
                                        "flex gap-2 group items-start rounded-lg transition-colors",
                                        msg.fromMe ? "justify-end" : "justify-start",
                                        isSelectMode && "cursor-pointer px-2 py-1 hover:bg-[#00a884]/10",
                                        isSelectMode && selectedMsgIds.includes(msg.keyId) && "bg-[#00a884]/15"
                                    )}
                                >
                                    {/* Multi-select checkbox (#C19) */}
                                    {isSelectMode && (
                                        <div className="self-center shrink-0 mr-1 order-first">
                                            <div
                                                className={cn(
                                                    "h-5 w-5 rounded-md border-2 flex items-center justify-center transition-colors",
                                                    selectedMsgIds.includes(msg.keyId)
                                                        ? "bg-[#00a884] border-[#00a884] text-white"
                                                        : "border-slate-400 dark:border-slate-500 bg-white/80 dark:bg-slate-800/80"
                                                )}
                                            >
                                                {selectedMsgIds.includes(msg.keyId) && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                                            </div>
                                        </div>
                                    )}

                                    {/* Sender Avatar for incoming group messages on left (WhatsApp Web style) */}
                                    {!msg.fromMe && isGroup && (() => {
                                        const sJid = msg.senderJid || "";
                                        const bare = sJid.split('@')[0];
                                        const resolved = (sJid && contactMap[sJid]) ||
                                                         (bare && contactMap[bare]) ||
                                                         msg.pushName ||
                                                         bare ||
                                                         "Membro";
                                        return (
                                            <Avatar className="h-7 w-7 mt-0.5 shrink-0 select-none shadow-xs">
                                                <AvatarImage
                                                    src={`/api/avatar/${sessionId}/${encodeURIComponent(sJid || '')}`}
                                                    referrerPolicy="no-referrer"
                                                />
                                                <AvatarFallback
                                                    className="text-[9.5px] font-bold text-white uppercase"
                                                    style={{ backgroundColor: getParticipantColor(resolved) }}
                                                >
                                                    {resolved.slice(0, 2)}
                                                </AvatarFallback>
                                            </Avatar>
                                        );
                                    })()}

                                    {/* Action buttons (Reply & React) for my messages (on left) */}
                                    {msg.fromMe && (
                                        <div className="flex items-center self-center opacity-0 group-hover:opacity-100 transition-opacity order-first">
                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <button
                                                        type="button"
                                                        className="p-1.5 text-muted-foreground/50 hover:text-[#00a884] hover:bg-black/5 dark:hover:bg-white/10 rounded-full cursor-pointer"
                                                        title="Reagir"
                                                    >
                                                        <Smile className="h-3.5 w-3.5" />
                                                    </button>
                                                </PopoverTrigger>
                                                <PopoverContent side="top" align="end" className="p-1.5 w-auto rounded-full bg-white dark:bg-[#233138] shadow-2xl border border-border/30 flex items-center gap-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                                                    {["👍", "❤️", "😂", "😮", "😢", "🙏"].map(emoji => (
                                                        <button
                                                            key={emoji}
                                                            type="button"
                                                            onClick={() => handleReaction(msg, emoji)}
                                                            className={cn(
                                                                "h-8 w-8 flex items-center justify-center text-lg rounded-full hover:scale-125 transition-transform hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer",
                                                                msg.userReaction === emoji && "bg-[#00a884]/20 scale-110"
                                                            )}
                                                        >
                                                            {emoji}
                                                        </button>
                                                    ))}
                                                </PopoverContent>
                                            </Popover>
                                            <button
                                                type="button"
                                                onClick={() => { setReplyingTo(msg); scrollToBottom(true); }}
                                                className="p-1.5 text-muted-foreground/50 hover:text-[#00a884] hover:bg-black/5 dark:hover:bg-white/10 rounded-full cursor-pointer"
                                                title="Responder"
                                            >
                                                <CornerUpLeft className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    )}

                                    {/* Authentic WhatsApp Bubble */}
                                    <div
                                        className={cn(
                                            "flex flex-col max-w-[85%] sm:max-w-[70%] px-3 py-1.5 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] cursor-context-menu relative text-[14.2px] leading-[19px] group/bubble",
                                            msg.fromMe
                                                ? "bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef] rounded-xl rounded-tr-xs ml-auto"
                                                : "bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] rounded-xl rounded-tl-xs mr-auto"
                                        )}
                                        onContextMenu={(e) => handleContextMenu(e, msg)}
                                        onDoubleClick={() => { setReplyingTo(msg); scrollToBottom(true); }}
                                    >
                                        {/* WhatsApp Web Hover Menu Chevron in top-right corner (#C12) */}
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const rect = e.currentTarget.getBoundingClientRect();
                                                setContextMenu({ x: rect.left, y: rect.bottom + 4, msg });
                                            }}
                                            className={cn(
                                                "absolute top-1 right-1 z-10 h-5 w-5 rounded-full flex items-center justify-center opacity-0 group-hover/bubble:opacity-100 transition-opacity cursor-pointer shadow-xs",
                                                msg.fromMe
                                                    ? "bg-[#d9fdd3]/95 dark:bg-[#005c4b]/95 text-[#54656f] dark:text-[#aebac1]"
                                                    : "bg-white/95 dark:bg-[#202c33]/95 text-[#54656f] dark:text-[#aebac1]"
                                            )}
                                            title="Mais opções da mensagem"
                                        >
                                            <ChevronDown className="h-3.5 w-3.5" />
                                        </button>

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
                                                        {msg.quoted.type === 'VIDEO' && <Video className="h-3 w-3 inline mr-1 opacity-70" />}
                                                        {renderMessageContent(msg.quoted.content || (msg.quoted.type === 'IMAGE' ? "Foto" : (msg.quoted.type === 'VIDEO' ? "Vídeo" : (msg.quoted.type === 'AUDIO' ? "Áudio" : "Mídia"))), contactMap)}
                                                    </span>
                                                </div>
                                                {msg.quoted && (msg.quoted.type === 'IMAGE' || msg.quoted.type === 'VIDEO' || msg.quoted.type === 'STICKER') && msg.quoted.mediaUrl && (
                                                    <div className="h-10 w-10 shrink-0 rounded-md overflow-hidden bg-black/10 dark:bg-white/10 border border-black/5 dark:border-white/10 shadow-xs">
                                                        <img src={msg.quoted.mediaUrl} alt="Thumbnail" className="h-full w-full object-cover" loading="lazy" />
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* IMAGE (with fallback if mediaUrl is missing) */}
                                        {msg.type === 'IMAGE' && (
                                            msg.mediaUrl ? (
                                                <div className="relative group/media">
                                                    <LazyMedia src={msg.mediaUrl} alt="Imagem" onClick={() => setLightboxMedia({ src: msg.mediaUrl!, caption: msg.content })} />
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

                                        {/* AUDIO (WhatsApp Voice Note Player with 1x, 1.5x, 2x speed) */}
                                        {msg.type === 'AUDIO' && msg.mediaUrl && (
                                            <WhatsAppAudioPlayer src={msg.mediaUrl} downloadFileName={`AUDIO-${msg.keyId}.mp3`} />
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
                                                <Button
                                                    size="icon"
                                                    variant="secondary"
                                                    className="absolute -top-1 right-6 h-6 w-6 rounded-full opacity-0 group-hover/media:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm"
                                                    onClick={(e) => { e.stopPropagation(); handleToggleFavoriteSticker(msg.mediaUrl!); }}
                                                    title={favoriteStickers.includes(msg.mediaUrl) ? "Remover das figurinhas favoritas" : "Favoritar figurinha"}
                                                >
                                                    <Star className={cn("h-3 w-3", favoriteStickers.includes(msg.mediaUrl) && "fill-amber-400 text-amber-400")} />
                                                </Button>
                                            </div>
                                        )}

                                        {/* LOCATION Card (WhatsApp Web Rich Location Card #C17) */}
                                        {msg.type === 'LOCATION' && (() => {
                                            const [coordsRaw, locName, locAddr] = (msg.content || "").split("|");
                                            const coords = (coordsRaw || "").trim();
                                            const mapsUrl = coords ? `https://www.google.com/maps?q=${encodeURIComponent(coords)}` : "https://www.google.com/maps";
                                            return (
                                                <div
                                                    className={cn(
                                                        "flex flex-col rounded-xl overflow-hidden mb-1.5 min-w-[240px] max-w-[300px] border border-black/10 dark:border-white/10 select-none",
                                                        msg.fromMe ? "bg-black/5 dark:bg-black/25" : "bg-black/5 dark:bg-white/5"
                                                    )}
                                                >
                                                    <a
                                                        href={mapsUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="relative h-28 w-full bg-emerald-950/20 dark:bg-emerald-900/30 flex flex-col items-center justify-center gap-1.5 group/map overflow-hidden"
                                                    >
                                                        <div className="absolute inset-0 opacity-25 bg-[radial-gradient(#00a884_1px,transparent_1px)] [background-size:12px_12px]" />
                                                        <div className="h-10 w-10 rounded-full bg-red-500/90 text-white flex items-center justify-center shadow-lg group-hover/map:scale-110 transition-transform z-10">
                                                            <MapPin className="h-5 w-5" />
                                                        </div>
                                                        <span className="text-[11px] font-semibold text-[#00a884] dark:text-[#25d366] bg-white/90 dark:bg-[#202c33]/90 px-2.5 py-0.5 rounded-full shadow-xs z-10">
                                                            🗺️ Abrir no Google Maps
                                                        </span>
                                                    </a>
                                                    <div className="px-3 py-2 flex flex-col gap-0.5">
                                                        <p className="text-xs font-semibold text-foreground truncate">
                                                            {locName || "Localização compartilhada"}
                                                        </p>
                                                        <p className="text-[11px] text-muted-foreground truncate">
                                                            {locAddr || coords || "Ver no mapa"}
                                                        </p>
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {/* CONTACT Card (WhatsApp Web vCard #C17) */}
                                        {msg.type === 'CONTACT' && (() => {
                                            const [contactNameRaw, contactPhoneRaw] = (msg.content || "Contato").split("|");
                                            const contactName = (contactNameRaw || "Contato").trim();
                                            const contactPhone = (contactPhoneRaw || "").replace(/\D/g, "");
                                            return (
                                                <div
                                                    className={cn(
                                                        "flex flex-col rounded-xl overflow-hidden mb-1.5 min-w-[240px] max-w-[300px] border border-black/10 dark:border-white/10 select-none",
                                                        msg.fromMe ? "bg-black/5 dark:bg-black/25" : "bg-black/5 dark:bg-white/5"
                                                    )}
                                                >
                                                    <div className="flex items-center gap-3 p-3">
                                                        <div className="h-10 w-10 rounded-full bg-[#00a884]/20 text-[#00a884] flex items-center justify-center font-bold text-sm shrink-0">
                                                            {contactName.slice(0, 2).toUpperCase()}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-xs font-semibold text-foreground truncate">
                                                                {contactName}
                                                            </p>
                                                            <p className="text-[11px] text-muted-foreground truncate">
                                                                {contactPhone ? `+${contactPhone}` : "Cartão de contato WhatsApp"}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="grid grid-cols-2 border-t border-black/10 dark:border-white/10 divide-x divide-black/10 dark:divide-white/10 text-center">
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (contactPhone) {
                                                                    const targetJid = `${contactPhone}@s.whatsapp.net`;
                                                                    window.dispatchEvent(new CustomEvent("zapflow:open-chat", {
                                                                        detail: { jid: targetJid, name: contactName }
                                                                    }));
                                                                } else {
                                                                    navigator.clipboard.writeText(contactName);
                                                                    toast.info("Nome do contato copiado");
                                                                }
                                                            }}
                                                            className="py-2 text-[11.5px] font-semibold text-[#00a884] hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                                                        >
                                                            💬 Conversar
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                navigator.clipboard.writeText(contactPhone || contactName);
                                                                toast.success("Contato copiado!");
                                                            }}
                                                            className="py-2 text-[11.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                                                        >
                                                            📋 Copiar
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {/* POLL Card (WhatsApp Web Native Poll #C23) */}
                                        {msg.type === 'POLL' && (() => {
                                            const [qRaw, optsRaw] = (msg.content || "Enquete").split("|");
                                            const pollQ = (qRaw || "Enquete").trim();
                                            const pollOpts = (optsRaw || "").split(";;").map(o => o.trim()).filter(Boolean);
                                            const selectedOpts = votedPolls[msg.keyId] || [];
                                            return (
                                                <div
                                                    className={cn(
                                                        "flex flex-col rounded-xl p-3 mb-1.5 min-w-[240px] max-w-[310px] border border-black/10 dark:border-white/10 select-none gap-2",
                                                        msg.fromMe ? "bg-black/5 dark:bg-black/25" : "bg-black/5 dark:bg-white/5"
                                                    )}
                                                >
                                                    <div className="flex items-start gap-2">
                                                        <BarChart2 className="h-4 w-4 text-[#00a884] shrink-0 mt-0.5" />
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-xs font-bold text-foreground leading-snug break-words">
                                                                {pollQ}
                                                            </p>
                                                            <span className="text-[10px] text-muted-foreground">
                                                                Selecione uma ou mais opções
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col gap-1.5 mt-0.5">
                                                        {pollOpts.map((opt, oIdx) => {
                                                            const isChecked = selectedOpts.includes(opt);
                                                            return (
                                                                <button
                                                                    key={oIdx}
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setVotedPolls(prev => {
                                                                            const curr = prev[msg.keyId] || [];
                                                                            const next = curr.includes(opt)
                                                                                ? curr.filter(x => x !== opt)
                                                                                : [...curr, opt];
                                                                            return { ...prev, [msg.keyId]: next };
                                                                        });
                                                                    }}
                                                                    className={cn(
                                                                        "w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-left text-xs transition-all cursor-pointer",
                                                                        isChecked
                                                                            ? "border-[#00a884] bg-[#00a884]/15 font-semibold text-foreground"
                                                                            : "border-black/10 dark:border-white/10 bg-white/50 dark:bg-white/5 hover:bg-black/5"
                                                                    )}
                                                                >
                                                                    <div className="flex items-center gap-2 truncate">
                                                                        <span className={cn(
                                                                            "h-4 w-4 rounded-full border flex items-center justify-center shrink-0",
                                                                            isChecked ? "bg-[#00a884] border-[#00a884] text-white" : "border-slate-400"
                                                                        )}>
                                                                            {isChecked && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                                                                        </span>
                                                                        <span className="truncate">{opt}</span>
                                                                    </div>
                                                                    {isChecked && (
                                                                        <span className="text-[10px] font-bold text-[#00a884]">1</span>
                                                                    )}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {/* DOCUMENT (WhatsApp Web Rich File Card #C10) */}
                                        {msg.type !== 'TEXT' && msg.type !== 'IMAGE' && msg.type !== 'STICKER' && msg.type !== 'VIDEO' && msg.type !== 'AUDIO' && msg.type !== 'LOCATION' && msg.type !== 'CONTACT' && msg.type !== 'POLL' && (() => {
                                            const rawFileName = (msg.type === 'DOCUMENT' && msg.content ? msg.content.trim() : "") ||
                                                `DOCUMENTO-${msg.keyId.slice(-6)}.pdf`;
                                            const extMatch = rawFileName.match(/\.([a-zA-Z0-9]{2,5})$/);
                                            const ext = (extMatch ? extMatch[1] : (msg.mediaUrl?.split('.').pop() || "DOC")).toUpperCase().slice(0, 4);
                                            const badgeColor =
                                                ext === "PDF"
                                                    ? "bg-red-500 text-white"
                                                    : (ext === "XLS" || ext === "XLSX" || ext === "CSV")
                                                        ? "bg-emerald-600 text-white"
                                                        : (ext === "DOC" || ext === "DOCX")
                                                            ? "bg-blue-600 text-white"
                                                            : (ext === "XML" || ext === "ZIP" || ext === "RAR")
                                                                ? "bg-amber-600 text-white"
                                                                : "bg-[#00a884] text-white";
                                            return (
                                                <div
                                                    className={cn(
                                                        "flex items-center justify-between gap-3 py-2.5 px-3 rounded-xl mb-1.5 min-w-[230px] border border-black/5 dark:border-white/10 select-none",
                                                        msg.fromMe ? "bg-black/5 dark:bg-black/25" : "bg-black/5 dark:bg-white/5"
                                                    )}
                                                >
                                                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                                        <div className={cn("h-10 w-9 rounded-lg flex flex-col items-center justify-center shrink-0 font-bold text-[9.5px] tracking-wider shadow-xs", badgeColor)}>
                                                            <FileText className="h-4 w-4 mb-0.5 opacity-90" />
                                                            <span>{ext}</span>
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-xs font-semibold text-foreground truncate" title={rawFileName}>
                                                                {rawFileName}
                                                            </p>
                                                            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                                                                Arquivo {ext} • WhatsApp
                                                            </span>
                                                        </div>
                                                    </div>
                                                    {msg.mediaUrl && (
                                                        <div className="flex items-center gap-1 shrink-0">
                                                            <a
                                                                href={msg.mediaUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                onClick={(e) => e.stopPropagation()}
                                                                className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-[#00a884] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                                                                title="Abrir / Visualizar documento"
                                                            >
                                                                <Eye className="h-4 w-4" />
                                                            </a>
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-8 w-8 rounded-full shrink-0 text-muted-foreground hover:text-foreground"
                                                                onClick={() => handleDownload(msg.mediaUrl!, rawFileName)}
                                                                title="Baixar arquivo"
                                                            >
                                                                <Download className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })()}

                                        {/* Link Preview Card for TEXT messages with URL (#C37) */}
                                        {msg.type === 'TEXT' && msg.content && (() => {
                                            const urlMatch = msg.content.match(/https?:\/\/[^\s<>"']+/i);
                                            if (!urlMatch) return null;
                                            const linkUrl = urlMatch[0].replace(/[.,;:!?)]+$/, "");
                                            let host = linkUrl;
                                            try { host = new URL(linkUrl).hostname.replace(/^www\./, ""); } catch {}
                                            return (
                                                <a
                                                    href={linkUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className={cn(
                                                        "flex items-center gap-2.5 mb-1.5 mt-0.5 rounded-lg overflow-hidden border border-black/5 dark:border-white/10 hover:opacity-90 transition-opacity select-none min-w-[220px] max-w-[320px]",
                                                        msg.fromMe ? "bg-black/5 dark:bg-black/25" : "bg-black/5 dark:bg-white/5"
                                                    )}
                                                >
                                                    <div className="h-14 w-14 shrink-0 bg-white dark:bg-[#111b21] flex items-center justify-center">
                                                        <img
                                                            src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
                                                            alt=""
                                                            className="h-7 w-7 object-contain"
                                                            loading="lazy"
                                                        />
                                                    </div>
                                                    <div className="min-w-0 flex-1 py-1.5 pr-2.5">
                                                        <p className="text-xs font-semibold text-foreground truncate">{host}</p>
                                                        <p className="text-[10.5px] text-muted-foreground truncate">{linkUrl}</p>
                                                    </div>
                                                    <ExternalLink className="h-3.5 w-3.5 mr-2.5 shrink-0 text-muted-foreground" />
                                                </a>
                                            );
                                        })()}

                                        {/* Text content with mentions & Timestamp + status checks */}
                                        <div className="flex flex-wrap items-end justify-end gap-x-2 gap-y-0.5">
                                            {msg.type !== 'DOCUMENT' && msg.type !== 'LOCATION' && msg.type !== 'CONTACT' && msg.type !== 'POLL' && (
                                                <span className="flex-1 break-words whitespace-pre-wrap text-[14.2px]">
                                                    {renderMessageContent(msg.content, contactMap, searchQuery)}
                                                </span>
                                            )}
                                            <div className="inline-flex items-center gap-1 shrink-0 ml-auto select-none pt-0.5">
                                                {starredIds.includes(msg.keyId) && (
                                                    <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0 mr-0.5" />
                                                )}
                                                {msg.isEdited && (
                                                    <span className="text-[10px] italic text-[#667781] dark:text-[#8696a0] select-none mr-0.5">
                                                        editada
                                                    </span>
                                                )}
                                                <span className="text-[11px] leading-none text-[#667781] dark:text-[#8696a0]">
                                                    {new Date(msg.timestamp).toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                                {msg.fromMe && <MessageStatusCheck status={msg.status} />}
                                            </div>
                                        </div>

                                        {/* Floating reaction pills at bottom corner of bubble */}
                                        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                                            <div className={cn(
                                                "absolute -bottom-2.5 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white dark:bg-[#202c33] shadow-[0_1px_3px_rgba(0,0,0,0.25)] border border-border/25 text-[11px] select-none",
                                                msg.fromMe ? "right-2" : "left-2"
                                            )}>
                                                {Object.entries(msg.reactions).map(([emoji, count]) => (
                                                    <span key={emoji} className="flex items-center gap-0.5 cursor-pointer" onClick={() => handleReaction(msg, emoji)}>
                                                        <span>{emoji}</span>
                                                        {count > 1 && <span className="text-[10px] text-muted-foreground font-semibold">{count}</span>}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Action buttons (Reply & React) for incoming messages (on right) */}
                                    {!msg.fromMe && (
                                        <div className="flex items-center self-center opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <button
                                                        type="button"
                                                        className="p-1.5 text-muted-foreground/50 hover:text-[#00a884] hover:bg-black/5 dark:hover:bg-white/10 rounded-full cursor-pointer"
                                                        title="Reagir"
                                                    >
                                                        <Smile className="h-3.5 w-3.5" />
                                                    </button>
                                                </PopoverTrigger>
                                                <PopoverContent side="top" align="start" className="p-1.5 w-auto rounded-full bg-white dark:bg-[#233138] shadow-2xl border border-border/30 flex items-center gap-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                                                    {["👍", "❤️", "😂", "😮", "😢", "🙏"].map(emoji => (
                                                        <button
                                                            key={emoji}
                                                            type="button"
                                                            onClick={() => handleReaction(msg, emoji)}
                                                            className={cn(
                                                                "h-8 w-8 flex items-center justify-center text-lg rounded-full hover:scale-125 transition-transform hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer",
                                                                msg.userReaction === emoji && "bg-[#00a884]/20 scale-110"
                                                            )}
                                                        >
                                                            {emoji}
                                                        </button>
                                                    ))}
                                                </PopoverContent>
                                            </Popover>
                                            <button
                                                type="button"
                                                onClick={() => { setReplyingTo(msg); scrollToBottom(true); }}
                                                className="p-1.5 text-muted-foreground/50 hover:text-[#00a884] hover:bg-black/5 dark:hover:bg-white/10 rounded-full cursor-pointer"
                                                title="Responder"
                                            >
                                                <CornerUpLeft className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    <div ref={bottomRef} />
                </div>
            </div>

            {/* Floating Scroll-to-Bottom button with unread badge (#C38) */}
            {(!autoScroll || newMsgBadge) && messages.length > 0 && (
                <button
                    type="button"
                    onClick={() => { scrollToBottom(true); setNewMsgBadge(false); }}
                    className="absolute bottom-20 right-6 z-20 h-10 w-10 rounded-full bg-white dark:bg-[#202c33] text-[#54656f] dark:text-[#aebac1] shadow-[0_2px_6px_rgba(11,20,26,0.25)] border border-border/20 flex items-center justify-center hover:scale-105 transition-transform cursor-pointer animate-in fade-in zoom-in-95 duration-150"
                    title="Rolar para a última mensagem"
                >
                    <ChevronDown className="h-5 w-5" />
                    {newMsgBadge && (
                        <span className="absolute -top-1.5 -right-1 h-4.5 min-w-4.5 px-1 rounded-full bg-[#25d366] text-white text-[10px] font-bold flex items-center justify-center shadow">
                            •
                        </span>
                    )}
                </button>
            )}

            {/* Multi-Select Messages Action Bar (#C19) */}
            {isSelectMode && (
                <div className="shrink-0 px-4 py-2.5 bg-[#f0f2f5] dark:bg-[#202c33] border-t border-border/25 flex items-center justify-between gap-3 z-20 select-none animate-in slide-in-from-bottom-2 duration-150">
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground cursor-pointer"
                            onClick={() => {
                                setIsSelectMode(false);
                                setSelectedMsgIds([]);
                            }}
                            title="Cancelar seleção (Esc)"
                        >
                            <X className="h-4.5 w-4.5" />
                        </Button>
                        <span className="text-sm font-semibold text-foreground">
                            {selectedMsgIds.length} selecionada{selectedMsgIds.length === 1 ? "" : "s"}
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={selectedMsgIds.length === 0}
                            onClick={() => {
                                const selectedObjs = messages.filter(m => selectedMsgIds.includes(m.keyId));
                                if (selectedObjs.length > 0) setForwardingMessagesList(selectedObjs);
                            }}
                            className="h-8 px-2.5 text-xs font-medium gap-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                            title="Encaminhar selecionadas"
                        >
                            <Forward className="h-4 w-4 text-[#00a884]" />
                            <span className="hidden sm:inline">Encaminhar</span>
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={selectedMsgIds.length === 0}
                            onClick={() => {
                                setStarredIds(prev => {
                                    const next = Array.from(new Set([...prev, ...selectedMsgIds]));
                                    try {
                                        localStorage.setItem(`zapflow_starred_${sessionId}_${jid}`, JSON.stringify(next));
                                    } catch {}
                                    return next;
                                });
                                toast.success(`⭐ ${selectedMsgIds.length} mensagem(ns) favoritada(s)!`);
                                setIsSelectMode(false);
                                setSelectedMsgIds([]);
                            }}
                            className="h-8 px-2.5 text-xs font-medium gap-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                            title="Favoritar selecionadas"
                        >
                            <Star className="h-4 w-4 text-amber-500" />
                            <span className="hidden sm:inline">Favoritar</span>
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={selectedMsgIds.length === 0}
                            onClick={() => {
                                const selectedObjs = messages.filter(m => selectedMsgIds.includes(m.keyId));
                                const combined = selectedObjs
                                    .map(m => m.content || "")
                                    .filter(Boolean)
                                    .join("\n\n");
                                if (combined) {
                                    navigator.clipboard.writeText(combined);
                                    toast.success(`${selectedObjs.length} mensagem(ns) copiada(s)!`);
                                }
                                setIsSelectMode(false);
                                setSelectedMsgIds([]);
                            }}
                            className="h-8 px-2.5 text-xs font-medium gap-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                            title="Copiar textos selecionados"
                        >
                            <Copy className="h-4 w-4 text-blue-500" />
                            <span className="hidden sm:inline">Copiar</span>
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={selectedMsgIds.length === 0}
                            onClick={async () => {
                                const idsToDel = [...selectedMsgIds];
                                setIsSelectMode(false);
                                setSelectedMsgIds([]);
                                for (const id of idsToDel) {
                                    try {
                                        await fetch(`/api/messages/${sessionId}/${encodeURIComponent(jid)}/${encodeURIComponent(id)}`, { method: "DELETE" });
                                    } catch {}
                                }
                                setMessages(prev => prev.filter(m => !idsToDel.includes(m.keyId)));
                                toast.success(`${idsToDel.length} mensagem(ns) excluída(s)`);
                            }}
                            className="h-8 px-2.5 text-xs font-medium gap-1.5 rounded-lg text-destructive hover:bg-destructive/10 cursor-pointer"
                            title="Apagar selecionadas"
                        >
                            <Trash2 className="h-4 w-4" />
                            <span className="hidden sm:inline">Apagar</span>
                        </Button>
                    </div>
                </div>
            )}

            {/* WhatsApp Styled Bottom Input Bar */}
            <input type="file" multiple ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
            <ChatInputBar
                onSend={handleSend}
                onSendAudio={handleSendAudio}
                onUpload={triggerUpload}
                onPasteFile={(file) => initiateFilePreview(file)}
                onOpenSendContact={() => setIsSendContactOpen(true)}
                onOpenSendLocation={() => setIsSendLocationOpen(true)}
                onOpenSendPoll={() => setIsSendPollOpen(true)}
                onOpenScheduleMessage={(draft) => {
                    if (draft?.trim()) setScheduleText(draft.trim());
                    if (!scheduleDateTime) {
                        const d = new Date(Date.now() + 30 * 60000);
                        const tzOffset = d.getTimezoneOffset() * 60000;
                        setScheduleDateTime(new Date(d.getTime() - tzOffset).toISOString().slice(0, 16));
                    }
                    setIsScheduleModalOpen(true);
                }}
                onOpenAIAssistant={handleOpenAIAssistant}
                onOpenCamera={handleOpenCamera}
                availableStickers={availableStickers}
                onSendStickerFile={handleSendStickerFile}
                onSendStickerUrl={handleSendStickerUrl}
                replyingTo={replyingTo}
                onCancelReply={() => setReplyingTo(null)}
                jid={jid}
                sessionId={sessionId}
                isGroup={isGroup}
                participants={participantsList}
            />

            {/* Lightbox Modal with Zoom, Rotate & Gallery Navigation (WhatsApp Web Style #C16) */}
            {lightboxMedia && (
                <div
                    className="fixed inset-0 z-[99999] bg-black/95 backdrop-blur-md flex flex-col items-center justify-between p-4 select-none animate-in fade-in duration-150"
                    onClick={() => setLightboxMedia(null)}
                >
                    {/* Top Action Bar */}
                    <div className="w-full flex items-center justify-between px-2 pt-1 pb-3 z-20" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2 text-white/85 text-xs font-medium">
                            <span>{name || "Visualizador de Imagem"}</span>
                            {galleryImages.length > 1 && currentGalleryIdx !== -1 && (
                                <span className="px-2 py-0.5 rounded-full bg-white/10 text-[11px] tabular-nums">
                                    {currentGalleryIdx + 1} de {galleryImages.length}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Button
                                size="icon"
                                variant="ghost"
                                className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10 rounded-full cursor-pointer"
                                onClick={() => setLightboxZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}
                                title="Diminuir Zoom (-)"
                            >
                                <ZoomOut className="h-4.5 w-4.5" />
                            </Button>
                            <button
                                type="button"
                                onClick={() => { setLightboxZoom(1); setLightboxRotation(0); }}
                                className="px-2 py-1 rounded-md text-[11px] font-semibold text-white/80 hover:text-white hover:bg-white/10 tabular-nums cursor-pointer"
                                title="Resetar Zoom e Rotação"
                            >
                                {Math.round(lightboxZoom * 100)}%
                            </button>
                            <Button
                                size="icon"
                                variant="ghost"
                                className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10 rounded-full cursor-pointer"
                                onClick={() => setLightboxZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))}
                                title="Aumentar Zoom (+)"
                            >
                                <ZoomIn className="h-4.5 w-4.5" />
                            </Button>
                            <Button
                                size="icon"
                                variant="ghost"
                                className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10 rounded-full cursor-pointer"
                                onClick={() => setLightboxRotation(r => (r + 90) % 360)}
                                title="Girar 90°"
                            >
                                <RotateCw className="h-4.5 w-4.5" />
                            </Button>
                            <Button
                                size="icon"
                                variant="ghost"
                                className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10 rounded-full cursor-pointer"
                                onClick={() => handleDownload(lightboxMedia.src, 'imagem-whatsapp.jpg')}
                                title="Baixar imagem"
                            >
                                <Download className="h-4.5 w-4.5" />
                            </Button>
                            <Button
                                size="icon"
                                variant="ghost"
                                className="h-9 w-9 text-white/80 hover:text-white hover:bg-white/10 rounded-full cursor-pointer"
                                onClick={() => setLightboxMedia(null)}
                                title="Fechar (ESC)"
                            >
                                <X className="h-5 w-5" />
                            </Button>
                        </div>
                    </div>

                    {/* Image View with Left/Right Gallery Navigation & Wheel Zoom */}
                    <div
                        className="relative flex-1 w-full flex items-center justify-center max-h-[72vh] overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                        onWheel={(e) => {
                            e.preventDefault();
                            if (e.deltaY < 0) setLightboxZoom(z => Math.min(4, +(z + 0.2).toFixed(2)));
                            else setLightboxZoom(z => Math.max(0.5, +(z - 0.2).toFixed(2)));
                        }}
                    >
                        {galleryImages.length > 1 && (
                            <button
                                type="button"
                                onClick={() => handleLightboxNav(-1)}
                                className="absolute left-3 z-20 h-11 w-11 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center shadow-lg transition-transform active:scale-95 cursor-pointer"
                                title="Foto anterior (←)"
                            >
                                <ChevronLeft className="h-6 w-6" />
                            </button>
                        )}

                        <img
                            src={lightboxMedia.src}
                            alt="Visualização"
                            style={{
                                transform: `scale(${lightboxZoom}) rotate(${lightboxRotation}deg)`
                            }}
                            className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-2xl transition-transform duration-150"
                        />

                        {galleryImages.length > 1 && (
                            <button
                                type="button"
                                onClick={() => handleLightboxNav(1)}
                                className="absolute right-3 z-20 h-11 w-11 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center shadow-lg transition-transform active:scale-95 cursor-pointer"
                                title="Próxima foto (→)"
                            >
                                <ChevronRight className="h-6 w-6" />
                            </button>
                        )}
                    </div>

                    {/* Bottom Caption & Gallery Thumbnail Strip */}
                    <div className="w-full flex flex-col items-center gap-2 z-20" onClick={(e) => e.stopPropagation()}>
                        {lightboxMedia.caption && (
                            <div className="max-w-3xl text-center text-sm text-white/95 whitespace-pre-wrap px-4 py-2 bg-black/70 backdrop-blur-sm rounded-lg max-h-24 overflow-y-auto">
                                {renderMessageContent(lightboxMedia.caption, contactMap)}
                            </div>
                        )}
                        {galleryImages.length > 1 && (
                            <div className="flex items-center gap-1.5 overflow-x-auto max-w-2xl py-1 px-2 rounded-xl bg-white/5">
                                {galleryImages.map((imgMsg) => {
                                    const isCurrent = imgMsg.mediaUrl === lightboxMedia.src;
                                    return (
                                        <button
                                            key={imgMsg.keyId}
                                            type="button"
                                            onClick={() => {
                                                setLightboxZoom(1);
                                                setLightboxRotation(0);
                                                setLightboxMedia({ src: imgMsg.mediaUrl!, caption: imgMsg.content });
                                            }}
                                            className={cn(
                                                "h-12 w-12 rounded-lg overflow-hidden shrink-0 border-2 transition-all cursor-pointer",
                                                isCurrent ? "border-[#00a884] scale-105 opacity-100" : "border-transparent opacity-50 hover:opacity-85"
                                            )}
                                        >
                                            <img src={imgMsg.mediaUrl!} alt="" className="h-full w-full object-cover" />
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* WhatsApp Web Style Multi-File Media Preview Modal before Sending (#C15) */}
            {previewFiles.length > 0 && previewFile && (
                <div className="fixed inset-0 z-[99999] bg-black/90 backdrop-blur-md flex flex-col justify-between p-4 sm:p-6 animate-in fade-in duration-150 select-none">
                    {/* Top bar with file name, count badge and close button */}
                    <div className="w-full flex items-center justify-between z-10">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="text-white/90 text-xs font-medium truncate max-w-md">
                                {previewFile.file.name} ({(previewFile.file.size / (1024 * 1024)).toFixed(2)} MB)
                            </span>
                            {previewFiles.length > 1 && (
                                <span className="px-2 py-0.5 rounded-full bg-[#00a884]/30 text-[#25d366] text-[11px] font-semibold">
                                    {activePreviewIdx + 1} de {previewFiles.length} arquivos
                                </span>
                            )}
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 rounded-full text-white/80 hover:text-white hover:bg-white/10 cursor-pointer"
                            onClick={handleCancelPreviewFile}
                            title="Cancelar tudo (Esc)"
                        >
                            <X className="h-5 w-5" />
                        </Button>
                    </div>

                    {/* Media Preview centered */}
                    <div className="flex-1 flex items-center justify-center p-4 max-h-[62vh] overflow-hidden">
                        {previewFile.type === 'image' && (
                            <img
                                src={previewFile.previewUrl}
                                alt="Pré-visualização"
                                className="max-w-full max-h-[58vh] object-contain rounded-xl shadow-2xl"
                            />
                        )}
                        {previewFile.type === 'video' && (
                            <video
                                src={previewFile.previewUrl}
                                controls
                                className="max-w-full max-h-[58vh] rounded-xl shadow-2xl"
                            />
                        )}
                        {previewFile.type !== 'image' && previewFile.type !== 'video' && (
                            <div className="flex flex-col items-center gap-3 p-8 rounded-2xl bg-white/10 text-white">
                                <FileText className="h-16 w-16 text-[#00a884]" />
                                <p className="font-semibold text-base">{previewFile.file.name}</p>
                                <p className="text-xs text-white/70">{(previewFile.file.size / 1024).toFixed(1)} KB</p>
                            </div>
                        )}
                    </div>

                    {/* Bottom Queue Strip + Caption Input + Send Button (#C15) */}
                    <div className="w-full max-w-2xl mx-auto flex flex-col gap-3">
                        {/* Thumbnail Strip of queued files + Add More button */}
                        <div className="flex items-center justify-center gap-2 overflow-x-auto py-1">
                            {previewFiles.map((item, idx) => (
                                <div
                                    key={idx}
                                    onClick={() => setActivePreviewIdx(idx)}
                                    className={cn(
                                        "relative h-14 w-14 rounded-xl overflow-hidden border-2 flex items-center justify-center bg-white/10 cursor-pointer shrink-0 group/thumb transition-all",
                                        idx === activePreviewIdx ? "border-[#00a884] scale-105" : "border-white/20 opacity-70 hover:opacity-100"
                                    )}
                                >
                                    {item.type === 'image' ? (
                                        <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                                    ) : (
                                        <FileText className="h-6 w-6 text-white/80" />
                                    )}
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleRemovePreviewFile(idx);
                                        }}
                                        className="absolute top-0.5 right-0.5 h-4.5 w-4.5 rounded-full bg-black/75 text-white flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity cursor-pointer"
                                        title="Remover arquivo"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </div>
                            ))}
                            <button
                                type="button"
                                onClick={() => triggerUpload(uploadType || "*")}
                                className="h-14 w-14 rounded-xl border-2 border-dashed border-white/30 hover:border-[#00a884] text-white/70 hover:text-[#00a884] flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                                title="Adicionar mais arquivos"
                            >
                                <Plus className="h-6 w-6" />
                            </button>
                        </div>

                        <div className="w-full flex items-center gap-2 bg-[#2a3942] rounded-2xl p-1.5 shadow-2xl">
                            <input
                                type="text"
                                value={previewFile.caption}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    setPreviewFiles(prev => prev.map((item, i) => i === activePreviewIdx ? { ...item, caption: val } : item));
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        handleSendPreviewFile();
                                    } else if (e.key === "Escape") {
                                        e.preventDefault();
                                        handleCancelPreviewFile();
                                    }
                                }}
                                placeholder="Adicione uma legenda..."
                                className="flex-1 bg-transparent px-3 py-2 text-sm text-white placeholder:text-white/50 outline-none"
                                autoFocus
                            />
                            <button
                                type="button"
                                onClick={handleSendPreviewFile}
                                className="h-10 px-4 rounded-full bg-[#00a884] hover:bg-[#00a884]/90 text-white flex items-center justify-center gap-1.5 shrink-0 shadow-md cursor-pointer transition-transform active:scale-95 text-xs font-semibold"
                                title="Enviar todos (Enter)"
                            >
                                <Send className="h-4 w-4 fill-current" />
                                {previewFiles.length > 1 && <span>({previewFiles.length})</span>}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            </div>

            {/* Right-side Contact / Group Info Drawer — WhatsApp Web 3-column layout (#C34, #C39) */}
            <ChatInfoAndMediaModal
                isOpen={isChatInfoModalOpen}
                onClose={() => setIsChatInfoModalOpen(false)}
                name={displayName}
                jid={jid}
                profilePic={profilePic || undefined}
                isGroup={isGroup}
                messages={messages}
                participants={participantsList}
                sessionId={sessionId}
                initialTab={chatInfoModalTab}
                starredIds={starredIds}
                isMuted={isChatMuted}
                isBlocked={isContactBlocked}
                chatNote={chatNote}
                onSaveChatNote={handleSaveChatNote}
                onToggleMute={handleToggleChatMute}
                onToggleBlock={handleToggleBlockContact}
                onClearChat={handleClearConversation}
                onPreviewMedia={(src, caption) => {
                    setLightboxMedia({ src, caption });
                }}
                onExportParticipants={exportGroupParticipants}
                onSendBroadcastToMembers={sendBroadcastToGroupMembers}
            />
        </div>
    );
}
