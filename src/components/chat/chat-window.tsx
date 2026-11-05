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
    Zap
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
import { sendChatMessage, sendMediaMessage, reactToChatMessage } from "@/app/dashboard/chat/actions";
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

// ─── Lazy media ────────
// ─── Helper for rendering text with links and @mentions ───
function renderMessageContent(content: string | null | undefined, contactMap?: Record<string, string>) {
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
            parts.push(content.substring(lastIndex, matchIndex));
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
        parts.push(content.substring(lastIndex));
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

// ─── Authentic WhatsApp Voice Note Audio Player with Speed Control (1x, 1.5x, 2x) ───
function WhatsAppAudioPlayer({ src, downloadFileName }: { src: string; downloadFileName?: string }) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackRate, setPlaybackRate] = useState<number>(1);

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
        <div className="flex items-center gap-2.5 py-1 px-1 my-1 min-w-[240px] max-w-[320px] select-none">
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
                className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-black/5 dark:bg-white/10 hover:bg-black/10 text-muted-foreground hover:text-foreground shrink-0 tabular-nums transition-colors"
                title="Velocidade de reprodução"
            >
                {playbackRate}x
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


const DEFAULT_QUICK_REPLIES = [
    { shortcut: "/ola", label: "Saudação inicial", text: "Olá! Tudo bem? Como posso te ajudar hoje?" },
    { shortcut: "/pix", label: "Dados do PIX", text: "Segue nossa chave PIX para pagamento: [chave]. Por gentileza, nos envie o comprovante após a transferência." },
    { shortcut: "/horario", label: "Horário de atendimento", text: "Nosso horário de funcionamento é de segunda a sexta, das 08h às 18h." },
    { shortcut: "/obrigado", label: "Agradecimento", text: "Muito obrigado pelo contato! Qualquer dúvida estamos à total disposição." },
    { shortcut: "/contrato", label: "Envio de contrato", text: "Segue o contrato para conferência e assinatura. Favor acusar o recebimento." },
    { shortcut: "/embarque", label: "Liberação de embarque", text: "🚨 Atenção: Lote liberado e pronto para embarque. Favor alinhar com os motoristas para seguirem viagem." }
];

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

// ─── Isolated Chat Input Bar (Local state = 120 FPS typing with zero message re-renders) ───
function ChatInputBar({
    onSend,
    onSendAudio,
    onUpload,
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
    replyingTo: Message | null;
    onCancelReply: () => void;
    jid: string;
    sessionId?: string;
    isGroup?: boolean;
    participants?: GroupParticipant[];
}) {
    const [input, setInput] = useState("");
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Audio recording state
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
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

    const filteredQuickReplies = useMemo(() => {
        if (quickReplyQuery === null) return [];
        const q = quickReplyQuery.toLowerCase().trim();
        if (!q) return DEFAULT_QUICK_REPLIES;
        return DEFAULT_QUICK_REPLIES.filter(r =>
            r.shortcut.toLowerCase().includes(q) || r.label.toLowerCase().includes(q) || r.text.toLowerCase().includes(q)
        );
    }, [quickReplyQuery]);

    const handleSelectQuickReply = (r: typeof DEFAULT_QUICK_REPLIES[0]) => {
        if (quickReplyCursorIdx === -1) return;
        const before = input.slice(0, quickReplyCursorIdx);
        const queryLen = quickReplyQuery ? quickReplyQuery.length : 0;
        const after = input.slice(quickReplyCursorIdx + 1 + queryLen);
        const nextInput = `${before}${r.text}${after}`;
        setInput(nextInput);
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
        audioChunksRef.current = [];
        setIsRecording(false);
        setRecordingTime(0);
    };

    const stopAndSendRecording = () => {
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

    // Focus on jid change & reset
    useEffect(() => {
        inputRef.current?.focus();
        setMentionQuery(null);
        setQuickReplyQuery(null);
        cancelRecording();
    }, [jid]);

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setInput(val);
        const el = e.target;
        el.style.height = "auto";
        el.style.height = Math.min(el.scrollHeight, 120) + "px";

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

        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="shrink-0 px-3.5 py-2.5 bg-[#f0f2f5] dark:bg-[#202c33] border-t border-border/15 relative">
            {/* Quick Replies Autocomplete Popover (/) */}
            {quickReplyQuery !== null && filteredQuickReplies.length > 0 && (
                <div className="mb-2 p-1.5 rounded-2xl bg-white dark:bg-[#233138] border border-border/40 shadow-2xl animate-in slide-in-from-bottom-2 duration-150 max-h-56 overflow-y-auto no-scrollbar max-w-md">
                    <div className="px-3 py-1.5 text-[11px] font-semibold text-amber-500 uppercase tracking-wider flex items-center justify-between border-b border-border/10 mb-1">
                        <span className="flex items-center gap-1.5">
                            <Zap className="h-3.5 w-3.5" />
                            <span>Respostas Rápidas ({filteredQuickReplies.length})</span>
                        </span>
                        <span className="text-[10px] text-muted-foreground lowercase">↑↓ Enter</span>
                    </div>
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
                </div>
            )}

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
                        className="p-1 text-muted-foreground hover:text-foreground rounded-full cursor-pointer"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            {isRecording ? (
                /* WhatsApp Web Recording Bar */
                <div className="flex items-center justify-between gap-3 max-w-4xl mx-auto bg-white dark:bg-[#202c33] rounded-2xl px-4 py-2 shadow-md border border-red-500/20 animate-in fade-in duration-150">
                    {/* Discard recording */}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={cancelRecording}
                        className="h-10 w-10 rounded-full text-red-500 hover:text-red-600 hover:bg-red-500/10 cursor-pointer shrink-0 transition-colors"
                        title="Cancelar gravação"
                    >
                        <Trash2 className="h-5 w-5" />
                    </Button>

                    {/* Recording indicators */}
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse shrink-0" />
                        <span className="font-mono text-sm font-semibold text-red-500 shrink-0">
                            {formatRecordingTime(recordingTime)}
                        </span>
                        <div className="flex-1 flex items-center gap-1 overflow-hidden px-2">
                            <span className="text-xs text-muted-foreground select-none truncate">
                                Gravando áudio...
                            </span>
                        </div>
                    </div>

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
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            placeholder={isGroup ? "Digite uma mensagem ou @ para marcar..." : "Digite uma mensagem..."}
                            rows={1}
                            style={{ minHeight: "26px", maxHeight: "120px" }}
                            className="w-full resize-none bg-transparent text-[15px] text-[#111b21] dark:text-[#e9edef] placeholder-[#8696a0] focus:outline-none leading-relaxed py-1"
                        />
                    </div>

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

    // Delete confirmation
    const [deleteConfirmMsg, setDeleteConfirmMsg] = useState<Message | null>(null);

    // Reply state
    const [replyingTo, setReplyingTo] = useState<Message | null>(null);

    // Context menu state
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

    // Close Lightbox on ESC
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && lightboxMedia) {
                setLightboxMedia(null);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [lightboxMedia]);

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

                // Play chime if there are incoming messages from someone else
                const incomingFromOthers = relevant.some(m => !m.fromMe && !m.keyId.startsWith("temp-"));
                if (incomingFromOthers) {
                    playNotificationChime();
                }

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

        return () => {
            socket.off("connect", onConnect);
            socket.off("message.update", handler);
            socket.off("message.reaction", reactionHandler);
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

        const validNumbers = participantsList
            .map(p => p.phoneNumber || p.id)
            .filter((num): num is string => Boolean(num && !num.includes("@g.us")));

        if (validNumbers.length === 0) {
            toast.error("Nenhum número válido encontrado nos membros");
            return;
        }

        if (typeof window !== "undefined") {
            sessionStorage.setItem("zapflow_broadcast_draft_recipients", JSON.stringify(validNumbers));
        }
        toast.success(`${validNumbers.length} membros carregados para novo disparo!`);
        router.push("/dashboard/broadcast");
    };

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
                                onClick={() => toast.info(`Conversa: ${displayName}`)}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
                            >
                                <Info className="h-4 w-4 text-muted-foreground" />
                                <span>Dados do {isGroup ? "grupo" : "contato"}</span>
                            </button>
                        </PopoverContent>
                    </Popover>
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
                                <div className={cn("flex gap-2 group items-start", msg.fromMe ? "justify-end" : "justify-start")}>
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
                onSendAudio={handleSendAudio}
                onUpload={triggerUpload}
                replyingTo={replyingTo}
                onCancelReply={() => setReplyingTo(null)}
                jid={jid}
                sessionId={sessionId}
                isGroup={isGroup}
                participants={participantsList}
            />

            {/* Lightbox Modal (WhatsApp Web Style) */}
            {lightboxMedia && (
                <div
                    className="fixed inset-0 z-[99999] bg-black/95 backdrop-blur-md flex flex-col items-center justify-between p-4 select-none animate-in fade-in duration-150"
                    onClick={() => setLightboxMedia(null)}
                >
                    {/* Top Action Bar */}
                    <div className="w-full flex items-center justify-between px-2 pt-1 pb-3 z-10" onClick={(e) => e.stopPropagation()}>
                        <div className="text-white/80 text-xs font-medium">
                            {name || "Visualizador de Imagem"}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                size="icon"
                                variant="ghost"
                                className="h-10 w-10 text-white/80 hover:text-white hover:bg-white/10 rounded-full"
                                onClick={() => handleDownload(lightboxMedia.src, 'imagem-whatsapp.jpg')}
                                title="Baixar imagem"
                            >
                                <Download className="h-5 w-5" />
                            </Button>
                            <Button
                                size="icon"
                                variant="ghost"
                                className="h-10 w-10 text-white/80 hover:text-white hover:bg-white/10 rounded-full"
                                onClick={() => setLightboxMedia(null)}
                                title="Fechar (ESC)"
                            >
                                <X className="h-5 w-5" />
                            </Button>
                        </div>
                    </div>

                    {/* Image View */}
                    <div className="flex-1 flex items-center justify-center max-w-5xl max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <img
                            src={lightboxMedia.src}
                            alt="Visualização"
                            className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl transition-transform duration-200"
                        />
                    </div>

                    {/* Bottom Caption */}
                    {lightboxMedia.caption ? (
                        <div className="mt-2 max-w-3xl text-center text-sm text-white/95 whitespace-pre-wrap px-4 py-2.5 bg-black/70 backdrop-blur-sm rounded-lg max-h-32 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                            {renderMessageContent(lightboxMedia.caption, contactMap)}
                        </div>
                    ) : <div className="h-6" />}
                </div>
            )}
        </div>
    );
}
