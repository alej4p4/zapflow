"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RefreshCw, Send, CheckCircle2, XCircle, Radio, Clock, AlertTriangle, History, Eye, Calendar, Users, Ban, RotateCcw, Trash2, Sparkles, Plus, Paperclip, FileText, Video as VideoIcon, X, File } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { useSocket } from "@/components/chat/socket-context";
import { normalizeSearch, toWhatsAppJid, extractRecipientTarget } from "@/lib/phone";
import { fetchCachedPhoneContacts, getCachedPhoneContacts, fetchCachedGroups, getCachedGroups } from "@/lib/whatsapp-client-cache";

interface BroadcastProgress {
    broadcastId: string;
    status: "running" | "completed" | "cancelled" | "interrupted" | "scheduled" | "queued";
    total: number;
    sent: number;
    failed: number;
    current?: string | null;
    progress?: number;
    position?: number;
    message?: string;
    errors?: { jid: string; error: string }[];
    startedAt?: string;
    completedAt?: string;
}

interface BroadcastLog {
    id: string;
    sessionId: string;
    message: string;
    total: number;
    sent: number;
    failed: number;
    status: string;
    delay: number;
    startedAt: string;
    scheduledAt: string | null;
    repeatDaily?: boolean;
    timeSlot?: string | null;
    completedAt: string | null;
    _count?: { recipients: number };
    recipients?: BroadcastRecipient[];
}

interface BroadcastRecipient {
    id: string;
    jid: string;
    status: string;
    error: string | null;
    sentAt: string | null;
}

interface PhoneContact {
    id: string;
    jid: string;
    name: string | null;
    notify: string | null;
    verifiedName: string | null;
    remoteJidAlt: string | null;
}

interface PhoneGroup {
    id: string;
    jid: string;
    subject: string | null;
}

interface BroadcastAttachment {
    name: string;
    size: number;
    type: "image" | "video" | "document";
    mimetype: string;
    base64: string;
    previewUrl?: string;
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseBroadcastMessage(msg: string): { text: string; media?: { type: string; filename: string; mimetype?: string } } {
    if (msg && msg.startsWith("{") && msg.includes('"media"')) {
        try {
            const parsed = JSON.parse(msg);
            if (parsed.media) {
                return {
                    text: parsed.caption || "",
                    media: {
                        type: parsed.media.type,
                        filename: parsed.media.filename,
                        mimetype: parsed.media.mimetype
                    }
                };
            }
        } catch {}
    }
    return { text: msg || "" };
}

interface ExcludedRecipient {
    jid: string;
    name: string;
    excludedAt: string;
}

/** Chaves de armazenamento persistente por sessão */
const DRAFT_KEY = (sid: string) => `zapflow_broadcast_draft_${sid}`;
const ACTIVE_KEY = (sid: string) => `zapflow_broadcast_active_${sid}`;
const EXCLUDED_KEY = (sid: string) => `zapflow_broadcast_excluded_${sid}`;
const NAME_MAP_KEY = (sid: string) => `zapflow_broadcast_namemap_${sid}`;

/** Número canônico do contato (o JID já vem com 55 + DDD). */
function contactNumber(contact: PhoneContact | null | undefined): string {
    if (!contact) return "";
    const rawJid = String(contact.jid || "").trim();
    const altJid = String(contact.remoteJidAlt || "").trim();
    const jid = rawJid.endsWith("@s.whatsapp.net") ? rawJid : altJid;
    return jid.endsWith("@s.whatsapp.net") ? (jid.split("@")[0] || "") : "";
}

/** Nome exibido do contato. */
function contactLabel(contact: PhoneContact | null | undefined): string {
    if (!contact) return "";
    return String(contact.name || contact.verifiedName || contact.notify || "").trim();
}

/** Interpreta horários como "12h00, 15h00, 18h00" ou "12:00, 15:00, 18:00" */
function parseProgrammedTimes(input: string): { hour: number; minute: number; timeStr: string }[] {
    if (!input || !input.trim()) return [];
    const tokens = input.split(/[,;\s\n]+/).map(s => s.trim()).filter(Boolean);
    const results: { hour: number; minute: number; timeStr: string }[] = [];
    const seen = new Set<string>();

    for (const token of tokens) {
        const m = token.match(/^(\d{1,2})(?:[hH:](\d{1,2})?)?$/);
        if (m) {
            const h = parseInt(m[1], 10);
            const min = m[2] ? parseInt(m[2], 10) : 0;
            if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
                const timeStr = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
                if (!seen.has(timeStr)) {
                    seen.add(timeStr);
                    results.push({ hour: h, minute: min, timeStr });
                }
            }
        }
    }
    return results.sort((a, b) => a.hour === b.hour ? a.minute - b.minute : a.hour - b.hour);
}

function getNextTargetDate(h: number, m: number): Date {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
    }
    return target;
}

export default function BroadcastPage() {
    const { sessionId } = useSession();
    const [contacts, setContacts] = useState("");
    const [message, setMessage] = useState("");
    const [attachment, setAttachment] = useState<BroadcastAttachment | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [delay, setDelay] = useState([500]);
    const [pickerSearch, setPickerSearch] = useState("");
    const initialCachedContacts = (sessionId ? getCachedPhoneContacts(sessionId) : null) || [];
    const [pickerContacts, setPickerContacts] = useState<PhoneContact[]>(initialCachedContacts);
    const [pickerLoading, setPickerLoading] = useState(initialCachedContacts.length === 0);
    const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
    const [groupSearch, setGroupSearch] = useState("");
    const initialCachedGroups = (sessionId ? getCachedGroups(sessionId) : null) || [];
    const [groups, setGroups] = useState<PhoneGroup[]>(initialCachedGroups);
    const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [scheduleMode, setScheduleMode] = useState<"now" | "datetime" | "programmed">("now");
    const [scheduledAt, setScheduledAt] = useState("");
    const [programmedTimesInput, setProgrammedTimesInput] = useState("12h00, 15h00, 18h00");
    const [repeatDaily, setRepeatDaily] = useState(true);
    const [broadcastProgress, setBroadcastProgress] = useState<BroadcastProgress | null>(null);
    const [activeTab, setActiveTab] = useState<"new" | "history">("new");

    // History
    const [history, setHistory] = useState<BroadcastLog[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [selectedLog, setSelectedLog] = useState<BroadcastLog | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false);

    // Destinatários excluídos dos próximos disparos e seleção de erros
    const [excludedRecipients, setExcludedRecipients] = useState<ExcludedRecipient[]>([]);
    const [excludedModalOpen, setExcludedModalOpen] = useState(false);
    const [selectedErrorJids, setSelectedErrorJids] = useState<string[]>([]);
    const [selectedDetailErrorJids, setSelectedDetailErrorJids] = useState<string[]>([]);
    const [customNameMap, setCustomNameMap] = useState<Record<string, string>>({});

    const { getSocket, joinSession } = useSocket();

    // Refs para controle seguro de hidratação de armazenamento
    const isLoadedRef = useRef(false);
    const prevSessionIdRef = useRef<string | null>(null);

    const [isSubmitting, setIsSubmitting] = useState(false);

    // Broadcast ativo em segundo plano (calculado)
    const isBroadcasting = loading || broadcastProgress?.status === "running" || broadcastProgress?.status === "queued";

    // 1. Restaura rascunho e estado ativo de localStorage e sincroniza com backend
    useEffect(() => {
        if (!sessionId || typeof window === "undefined") return;

        if (prevSessionIdRef.current !== sessionId) {
            isLoadedRef.current = false;
            prevSessionIdRef.current = sessionId;
        }

        // A. Importação de rascunho de grupo via chat (suporta JSON array de números ou texto puro)
        const draftGroup = sessionStorage.getItem("zapflow_broadcast_draft_recipients");
        if (draftGroup) {
            try {
                const parsed = JSON.parse(draftGroup);
                if (Array.isArray(parsed)) {
                    setContacts(parsed.join("\n"));
                } else {
                    setContacts(draftGroup);
                }
            } catch {
                setContacts(draftGroup);
            }
            sessionStorage.removeItem("zapflow_broadcast_draft_recipients");
            toast.success("Contatos importados do grupo com sucesso!");
        } else {
            // Restaura formulário salvo no localStorage
            try {
                const rawDraft = localStorage.getItem(DRAFT_KEY(sessionId));
                if (rawDraft) {
                    const draft = JSON.parse(rawDraft);
                    if (typeof draft.contacts === "string") setContacts(draft.contacts);
                    if (typeof draft.message === "string") setMessage(draft.message);
                    if (Array.isArray(draft.delay)) setDelay(draft.delay);
                    if (draft.scheduleMode) setScheduleMode(draft.scheduleMode);
                    if (typeof draft.scheduledAt === "string") setScheduledAt(draft.scheduledAt);
                    if (typeof draft.programmedTimesInput === "string") setProgrammedTimesInput(draft.programmedTimesInput);
                    if (typeof draft.repeatDaily === "boolean") setRepeatDaily(draft.repeatDaily);
                }
            } catch (e) {
                console.error("Falha ao restaurar rascunho do disparo", e);
            }
        }

        // B. Restaura progresso ativo do localStorage para exibição imediata (sem zerar)
        try {
            const rawActive = localStorage.getItem(ACTIVE_KEY(sessionId));
            if (rawActive) {
                const active = JSON.parse(rawActive) as BroadcastProgress;
                setBroadcastProgress(active);
                if (active.status === "running" || active.status === "queued") {
                    setLoading(true);
                }
            }
        } catch (e) {
            console.error("Falha ao restaurar progresso ativo do disparo", e);
        }

        // Restaura lista de excluídos e mapa de nomes personalizados da sessão
        try {
            const rawExcluded = localStorage.getItem(EXCLUDED_KEY(sessionId));
            if (rawExcluded) {
                const parsedEx = JSON.parse(rawExcluded);
                if (Array.isArray(parsedEx)) {
                    const normalized: ExcludedRecipient[] = parsedEx
                        .filter(Boolean)
                        .map(item => {
                            if (typeof item === "string") {
                                const clean = String(item).trim();
                                return { jid: clean, name: clean, excludedAt: new Date().toISOString() };
                            }
                            const cleanJid = String(item?.jid || "").trim();
                            return {
                                jid: cleanJid,
                                name: String(item?.name || cleanJid || "Contato"),
                                excludedAt: item?.excludedAt || new Date().toISOString()
                            };
                        })
                        .filter(item => item.jid.length > 0);
                    setExcludedRecipients(normalized);
                } else {
                    setExcludedRecipients([]);
                }
            } else {
                setExcludedRecipients([]);
            }
        } catch {
            setExcludedRecipients([]);
        }

        try {
            const rawNameMap = localStorage.getItem(NAME_MAP_KEY(sessionId));
            if (rawNameMap) {
                const parsedMap = JSON.parse(rawNameMap);
                if (parsedMap && typeof parsedMap === "object") setCustomNameMap(parsedMap);
            } else {
                setCustomNameMap({});
            }
        } catch {
            setCustomNameMap({});
        }

        isLoadedRef.current = true;

        // C. Sincroniza com o servidor para obter o estado mais recente do banco de dados
        let isMounted = true;
        (async () => {
            try {
                const res = await fetch(`/api/messages/${sessionId}/broadcast`);
                if (!res.ok || !isMounted) return;
                const data = await res.json();
                if (data.status && data.broadcast) {
                    const b = data.broadcast;
                    if (data.hasActive) {
                        const activeState: BroadcastProgress = {
                            broadcastId: b.id,
                            status: b.status,
                            total: b.total,
                            sent: b.sent,
                            failed: b.failed,
                            current: null,
                            progress: b.total ? Math.round(((b.sent + b.failed) / b.total) * 100) : 0,
                            errors: b.errors || [],
                            startedAt: b.startedAt
                        };
                        setBroadcastProgress(activeState);
                        setLoading(true);
                        localStorage.setItem(ACTIVE_KEY(sessionId), JSON.stringify(activeState));
                    } else if (b.completedAt || b.status === "completed" || b.status === "cancelled") {
                        const rawActive = localStorage.getItem(ACTIVE_KEY(sessionId));
                        const currentStored = rawActive ? JSON.parse(rawActive) : null;
                        if (currentStored && currentStored.broadcastId === b.id) {
                            const updatedState: BroadcastProgress = {
                                broadcastId: b.id,
                                status: b.status,
                                total: b.total,
                                sent: b.sent,
                                failed: b.failed,
                                current: null,
                                progress: b.status === "completed" ? 100 : (b.total ? Math.round(((b.sent + b.failed) / b.total) * 100) : 0),
                                errors: b.errors || [],
                                startedAt: b.startedAt,
                                completedAt: b.completedAt
                            };
                            setBroadcastProgress(updatedState);
                            setLoading(false);
                            localStorage.setItem(ACTIVE_KEY(sessionId), JSON.stringify(updatedState));
                        }
                    }
                }
            } catch (e) {
                console.error("Falha ao sincronizar status do disparo com o servidor", e);
            }
        })();

        return () => {
            isMounted = false;
        };
    }, [sessionId]);

    // 2. Salva rascunho de formulário automaticamente a cada digitação (sem zerar ao sair da página)
    useEffect(() => {
        if (!isLoadedRef.current || !sessionId || typeof window === "undefined") return;
        const timer = setTimeout(() => {
            try {
                const draft = {
                    contacts,
                    message,
                    delay,
                    scheduleMode,
                    scheduledAt,
                    programmedTimesInput,
                    repeatDaily
                };
                localStorage.setItem(DRAFT_KEY(sessionId), JSON.stringify(draft));
            } catch {}
        }, 250);

        return () => clearTimeout(timer);
    }, [contacts, message, delay, scheduleMode, scheduledAt, programmedTimesInput, repeatDaily, sessionId]);

    // 3. Socket para acompanhar atualizações em tempo real
    useEffect(() => {
        const socket = getSocket();
        if (!socket || !sessionId) return;

        const onConnect = () => joinSession(sessionId);
        if (socket.connected) joinSession(sessionId);
        socket.on("connect", onConnect);

        const handler = (data: BroadcastProgress) => {
            setBroadcastProgress(data);
            if (typeof window !== "undefined") {
                localStorage.setItem(ACTIVE_KEY(sessionId), JSON.stringify(data));
            }

            if (data.status === "running" || data.status === "queued") {
                setLoading(true);
                return;
            }

            setLoading(false);
            fetchHistory();
            if (data.status === "completed") {
                if (data.failed === 0) {
                    toast.success(`Disparo concluído: ${data.sent} enviadas com sucesso!`);
                } else {
                    toast.warning(`Disparo concluído: ${data.sent} enviadas, ${data.failed} falhas.`);
                }
            } else if (data.status === "cancelled") {
                toast.info("Disparo cancelado.");
            }
        };

        socket.on("broadcast.progress", handler);
        return () => {
            socket.off("connect", onConnect);
            socket.off("broadcast.progress", handler);
        };
    }, [sessionId, getSocket, joinSession]);

    // Fetch history
    const fetchHistory = useCallback(async () => {
        if (!sessionId) return;
        setHistoryLoading(true);
        try {
            const res = await fetch(`/api/messages/${sessionId}/broadcast/history?limit=20`);
            if (res.ok) {
                const data = await res.json();
                setHistory(data.data || []);
            }
        } catch (e) {
            console.error("Failed to fetch broadcast history", e);
        } finally {
            setHistoryLoading(false);
        }
    }, [sessionId]);

    // Load history on mount & tab switch
    useEffect(() => {
        if (activeTab === "history" && sessionId) {
            fetchHistory();
        }
    }, [activeTab, sessionId, fetchHistory]);

    // Contatos do celular: em cache na memória (método WhatsApp Web)
    useEffect(() => {
        if (!sessionId) return;
        (async () => {
            const cached = getCachedPhoneContacts(sessionId);
            if (!cached || cached.length === 0) setPickerLoading(true);
            try {
                const list = await fetchCachedPhoneContacts(sessionId);
                const filtered = (list || []).filter((c: PhoneContact) => contactNumber(c));
                filtered.sort((a: PhoneContact, b: PhoneContact) => {
                    const na = normalizeSearch(contactLabel(a));
                    const nb = normalizeSearch(contactLabel(b));
                    if (!na !== !nb) return na ? -1 : 1;
                    return na.localeCompare(nb);
                });
                setPickerContacts(filtered);
            } catch (e) {
                console.error("Falha ao buscar contatos", e);
            } finally {
                setPickerLoading(false);
            }
        })();
    }, [sessionId]);

    // Conjunto rápido de JIDs e números excluídos dos próximos disparos
    const excludedSet = useMemo(() => {
        const set = new Set<string>();
        (excludedRecipients || []).forEach(item => {
            if (!item) return;
            const rawJid = typeof item === "string" ? item : item.jid;
            const jid = String(rawJid || "").trim().toLowerCase();
            if (!jid) return;
            set.add(jid);
            const bare = (jid.split("@")[0] || "").replace(/\D/g, "");
            if (bare) {
                set.add(bare);
                if (bare.startsWith("55") && bare.length >= 12) {
                    set.add(bare.slice(2));
                }
            }
        });
        return set;
    }, [excludedRecipients]);

    const isJidExcluded = useCallback((jidOrNum: string | null | undefined): boolean => {
        if (!jidOrNum) return false;
        const clean = String(jidOrNum || "").trim().toLowerCase();
        if (!clean) return false;
        if (excludedSet.has(clean)) return true;
        if (!clean.endsWith("@g.us")) {
            const digits = (clean.split("@")[0] || "").replace(/\D/g, "");
            if (digits && excludedSet.has(digits)) return true;
            if (digits.startsWith("55") && digits.length >= 12 && excludedSet.has(digits.slice(2))) return true;
        }
        return false;
    }, [excludedSet]);

    // Mapas bidirecionais entre Nome (grupo/contato) <-> JID real
    const { nameToJidMap, jidToNameMap, groupDisplayNames, contactDisplayNames } = useMemo(() => {
        const n2j = new Map<string, string>();
        const j2n = new Map<string, string>();
        const gNames = new Map<string, string>();
        const cNames = new Map<string, string>();

        // 1. Nomes customizados salvos anteriormente
        Object.entries(customNameMap).forEach(([name, jid]) => {
            if (name && jid) {
                n2j.set(name.toLowerCase(), jid);
                n2j.set(normalizeSearch(name), jid);
                j2n.set(jid, name);
                j2n.set(jid.toLowerCase(), name);
                const bare = jid.split("@")[0];
                if (bare) j2n.set(bare, name);
            }
        });

        // 2. Contatos do celular
        const usedContactNames = new Map<string, number>();
        pickerContacts.forEach(c => {
            const num = contactNumber(c);
            if (!num) return;
            const jid = toWhatsAppJid(num);
            const rawLabel = String(contactLabel(c) || "").trim();
            if (!rawLabel) {
                cNames.set(c.id, num);
                return;
            }
            const key = rawLabel.toLowerCase();
            const count = (usedContactNames.get(key) || 0) + 1;
            usedContactNames.set(key, count);
            const displayName = count > 1 ? `${rawLabel} #${count}` : rawLabel;

            cNames.set(c.id, displayName);
            n2j.set(displayName.toLowerCase(), jid);
            n2j.set(normalizeSearch(displayName), jid);
            if (count === 1) {
                n2j.set(key, jid);
                n2j.set(normalizeSearch(rawLabel), jid);
            }
            j2n.set(jid, displayName);
            j2n.set(num, displayName);
            if (num.startsWith("55") && num.length >= 12) {
                j2n.set(num.slice(2), displayName);
            }
        });

        // 3. Grupos da sessão
        const usedGroupNames = new Map<string, number>();
        groups.forEach(g => {
            if (!g.jid) return;
            const rawSubject = String(g.subject || "Grupo").trim();
            const key = rawSubject.toLowerCase();
            const count = (usedGroupNames.get(key) || 0) + 1;
            usedGroupNames.set(key, count);
            const displayName = count > 1 ? `${rawSubject} #${count}` : rawSubject;

            gNames.set(g.jid, displayName);
            n2j.set(displayName.toLowerCase(), g.jid);
            n2j.set(normalizeSearch(displayName), g.jid);
            if (count === 1) {
                n2j.set(key, g.jid);
                n2j.set(normalizeSearch(rawSubject), g.jid);
            }
            j2n.set(g.jid, displayName);
            j2n.set(g.jid.toLowerCase(), displayName);
        });

        return { nameToJidMap: n2j, jidToNameMap: j2n, groupDisplayNames: gNames, contactDisplayNames: cNames };
    }, [groups, pickerContacts, customNameMap]);

    // Interpreta linhas do campo Destinatários (suporta nomes com vírgula sem quebrar!)
    const parseRecipientLines = useCallback((text: string | null | undefined): string[] => {
        if (!text || typeof text !== "string") return [];
        // Primeiro une linhas que quebraram apenas com "(120363...@g.us)" na linha de baixo
        const mergedText = String(text || "").replace(/\n\s*(\([0-9\-_]+@g\.us\))/gi, " $1");
        const rawLines = mergedText.split(/\n+/);
        const result: string[] = [];
        for (const line of rawLines) {
            const trimmed = String(line || "").trim();
            if (!trimmed) continue;
            // Se a linha contém apenas números/vírgulas (sem letras), separa por vírgula
            if (!/[a-zA-Z]/.test(trimmed) && trimmed.includes(",")) {
                trimmed.split(",").map(s => s.trim()).filter(Boolean).forEach(s => result.push(s));
            } else {
                result.push(trimmed);
            }
        }
        return result;
    }, []);

    // Converte uma linha (nome do grupo, nome do contato ou número/JID) para o JID real do WhatsApp
    const resolveLineToJid = useCallback((line: string | null | undefined): string => {
        const trimmed = String(line || "").trim();
        if (!trimmed) return "";

        const explicit = toWhatsAppJid(trimmed);
        if (explicit) return explicit;

        const lower = trimmed.toLowerCase();
        const norm = normalizeSearch(trimmed);
        const withoutHash = trimmed.replace(/\s+#\d+$/, "").trim();

        return (
            nameToJidMap.get(lower) ||
            nameToJidMap.get(norm) ||
            nameToJidMap.get(withoutHash.toLowerCase()) ||
            nameToJidMap.get(normalizeSearch(withoutHash)) ||
            ""
        );
    }, [nameToJidMap]);

    // Filtro local de contatos (oculta contatos excluídos dos próximos disparos)
    const filteredContacts = useMemo(() => {
        const query = normalizeSearch(pickerSearch);
        const digits = pickerSearch.replace(/\D/g, "");
        return pickerContacts.filter(c => {
            const num = contactNumber(c);
            if (!num || isJidExcluded(num)) return false;
            if (!query && !digits) return true;
            return (
                normalizeSearch(contactLabel(c)).includes(query) ||
                (digits.length > 0 && num.includes(digits))
            );
        });
    }, [pickerContacts, pickerSearch, isJidExcluded]);

    const isAllFilteredContactsSelected = filteredContacts.length > 0 &&
        filteredContacts.every(c => selectedContacts.includes(c.id));

    const toggleSelectAllContacts = () => {
        if (isAllFilteredContactsSelected) {
            const filteredIds = new Set(filteredContacts.map(c => c.id));
            setSelectedContacts(prev => prev.filter(id => !filteredIds.has(id)));
        } else {
            setSelectedContacts(prev => {
                const next = new Set(prev);
                filteredContacts.forEach(c => next.add(c.id));
                return Array.from(next);
            });
        }
    };

    const toggleContact = (id: string) => {
        setSelectedContacts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const addSelectedContacts = () => {
        const newMapEntries: Record<string, string> = {};
        setContacts(prev => {
            const lines = parseRecipientLines(prev);
            const existingJids = new Set(lines.map(resolveLineToJid).filter(Boolean));
            const selectedSet = new Set(selectedContacts);
            const toAdd: string[] = [];
            for (const contact of pickerContacts) {
                const number = contactNumber(contact);
                if (!number || !selectedSet.has(contact.id) || isJidExcluded(number)) continue;
                const jid = toWhatsAppJid(number);
                if (!existingJids.has(jid)) {
                    const displayName = contactDisplayNames.get(contact.id) || String(contactLabel(contact) || "").trim() || number;
                    toAdd.push(displayName);
                    existingJids.add(jid);
                    newMapEntries[displayName] = jid;
                }
            }
            return [...lines, ...toAdd].join("\n");
        });
        if (Object.keys(newMapEntries).length > 0 && sessionId) {
            setCustomNameMap(prev => {
                const updated = { ...prev, ...newMapEntries };
                try { localStorage.setItem(NAME_MAP_KEY(sessionId), JSON.stringify(updated)); } catch {}
                return updated;
            });
        }
        setSelectedContacts([]);
        toast.success("Contatos adicionados (somente nome) aos destinatários");
    };

    // Grupos da sessão: em cache na memória (método WhatsApp Web)
    useEffect(() => {
        if (!sessionId) return;
        (async () => {
            try {
                const list = await fetchCachedGroups(sessionId);
                setGroups(list || []);
            } catch (e) {
                console.error("Falha ao buscar grupos", e);
            }
        })();
    }, [sessionId]);

    const filteredGroups = useMemo(() => {
        const query = normalizeSearch(groupSearch);
        return groups.filter(g => {
            if (!g.jid || isJidExcluded(g.jid)) return false;
            if (!query) return true;
            return normalizeSearch(g.subject).includes(query);
        });
    }, [groups, groupSearch, isJidExcluded]);

    const isAllFilteredGroupsSelected = filteredGroups.length > 0 &&
        filteredGroups.every(g => selectedGroups.includes(g.jid));

    const toggleSelectAllGroups = () => {
        if (isAllFilteredGroupsSelected) {
            const groupJids = new Set(filteredGroups.map(g => g.jid));
            setSelectedGroups(prev => prev.filter(jid => !groupJids.has(jid)));
        } else {
            setSelectedGroups(prev => {
                const next = new Set(prev);
                filteredGroups.forEach(g => next.add(g.jid));
                return Array.from(next);
            });
        }
    };

    const addSelectedGroups = () => {
        const newMapEntries: Record<string, string> = {};
        setContacts(prev => {
            const lines = parseRecipientLines(prev);
            const existingJids = new Set(lines.map(resolveLineToJid).filter(Boolean));
            const selectedSet = new Set(selectedGroups);
            const toAdd: string[] = [];
            for (const group of groups) {
                if (selectedSet.has(group.jid) && !existingJids.has(group.jid) && !isJidExcluded(group.jid)) {
                    const displayName = groupDisplayNames.get(group.jid) || (group.subject || "Grupo").trim();
                    toAdd.push(displayName);
                    existingJids.add(group.jid);
                    newMapEntries[displayName] = group.jid;
                }
            }
            return [...lines, ...toAdd].join("\n");
        });
        if (Object.keys(newMapEntries).length > 0 && sessionId) {
            setCustomNameMap(prev => {
                const updated = { ...prev, ...newMapEntries };
                try { localStorage.setItem(NAME_MAP_KEY(sessionId), JSON.stringify(updated)); } catch {}
                return updated;
            });
        }
        setSelectedGroups([]);
        toast.success("Grupos adicionados (somente nome) aos destinatários");
    };

    // Handlers para anexo de mídia / documento no disparo
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 25 * 1024 * 1024) {
            toast.error("O arquivo ultrapassa o limite máximo de 25MB.");
            if (fileInputRef.current) fileInputRef.current.value = "";
            return;
        }

        let fileType: "image" | "video" | "document" = "document";
        if (file.type.startsWith("image/")) {
            fileType = "image";
        } else if (file.type.startsWith("video/")) {
            fileType = "video";
        }

        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result as string;
            const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
            setAttachment({
                name: file.name,
                size: file.size,
                type: fileType,
                mimetype: file.type || (fileType === "document" ? "application/pdf" : "application/octet-stream"),
                base64,
                previewUrl
            });
            toast.success(`Arquivo "${file.name}" anexado com sucesso!`);
        };
        reader.readAsDataURL(file);
    };

    const removeAttachment = () => {
        if (attachment?.previewUrl) {
            try { URL.revokeObjectURL(attachment.previewUrl); } catch {}
        }
        setAttachment(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    // Deixa SOMENTE o nome do grupo ou nome do contato (e remove parênteses com JID/número e itens excluídos)
    const resolveRecipientNames = useCallback((text: string) => {
        if (!text) return text;
        const lines = parseRecipientLines(text);
        let changed = false;
        const discoveredMap: Record<string, string> = {};
        const outputLines: string[] = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Caso 1: Linha no formato "NOME DO GRUPO (120363...@g.us)" ou "Nome Contato (5566...)"
            const parenMatch = trimmed.match(/^(.+?)\s*[<(]\s*([0-9\-_]+@g\.us|\d+@s\.whatsapp\.net|[0-9+\-\s]{8,20})\s*[>)]$/i);
            if (parenMatch) {
                const cleanName = parenMatch[1].trim();
                const rawTarget = parenMatch[2].trim();
                const jid = toWhatsAppJid(rawTarget);
                if (jid && isJidExcluded(jid)) {
                    changed = true;
                    continue;
                }
                if (cleanName && jid) {
                    discoveredMap[cleanName] = jid;
                    const mappedName = jidToNameMap.get(jid) || cleanName;
                    outputLines.push(mappedName);
                    changed = true;
                    continue;
                }
            }

            // Caso 2: Linha é um JID cru (ex: 120363...@g.us) ou número cru
            const directJid = toWhatsAppJid(trimmed);
            if (directJid) {
                if (isJidExcluded(directJid)) {
                    changed = true;
                    continue;
                }
                const bareNum = directJid.split("@")[0];
                const knownName = jidToNameMap.get(directJid) || jidToNameMap.get(trimmed.toLowerCase()) || jidToNameMap.get(bareNum);
                if (knownName) {
                    outputLines.push(knownName);
                    changed = true;
                    continue;
                }
                outputLines.push(trimmed);
                continue;
            }

            // Caso 3: Linha já é somente o nome do grupo ou contato
            const resolvedJid = resolveLineToJid(trimmed);
            if (resolvedJid && isJidExcluded(resolvedJid)) {
                changed = true;
                continue;
            }
            outputLines.push(trimmed);
        }

        if (Object.keys(discoveredMap).length > 0 && sessionId) {
            setCustomNameMap(prev => {
                const next = { ...prev, ...discoveredMap };
                try { localStorage.setItem(NAME_MAP_KEY(sessionId), JSON.stringify(next)); } catch {}
                return next;
            });
        }

        const joined = outputLines.join("\n");
        return changed || joined !== text ? joined : text;
    }, [parseRecipientLines, jidToNameMap, resolveLineToJid, isJidExcluded, sessionId]);

    // Auto-resolve para deixar somente o nome assim que carregar grupos, contatos ou lista de excluídos
    useEffect(() => {
        if (groups.length > 0 || pickerContacts.length > 0 || excludedRecipients.length > 0) {
            setContacts(prev => resolveRecipientNames(prev));
        }
    }, [groups, pickerContacts, excludedRecipients, resolveRecipientNames]);

    // Exclui destinatários selecionados (com erro) dos próximos disparos
    const handleExcludeRecipients = useCallback((jidsToExclude: string[]) => {
        if (!sessionId || jidsToExclude.length === 0) return;
        const now = new Date().toISOString();

        setExcludedRecipients(prev => {
            const existing = new Set(prev.filter(e => e?.jid).map(e => String(e.jid).toLowerCase()));
            const added: ExcludedRecipient[] = [];
            for (const rawJid of jidsToExclude) {
                const clean = String(rawJid || "").trim();
                if (!clean || existing.has(clean.toLowerCase())) continue;
                existing.add(clean.toLowerCase());
                const bare = clean.split("@")[0] || "";
                const readableName = jidToNameMap.get(clean) || jidToNameMap.get(clean.toLowerCase()) || jidToNameMap.get(bare) || bare;
                added.push({
                    jid: clean,
                    name: readableName,
                    excludedAt: now
                });
            }
            const updated = [...prev, ...added];
            try { localStorage.setItem(EXCLUDED_KEY(sessionId), JSON.stringify(updated)); } catch {}
            return updated;
        });

        // Limpa também dos últimos destinatários salvos na sessão
        try {
            const lastStored = sessionStorage.getItem("zapflow_last_broadcast_recipients");
            if (lastStored) {
                const dropSet = new Set(jidsToExclude.flatMap(j => [j.toLowerCase(), j.split("@")[0]]));
                const kept = parseRecipientLines(lastStored).filter(line => {
                    const rJid = resolveLineToJid(line);
                    if (!rJid) return true;
                    return !dropSet.has(rJid.toLowerCase()) && !dropSet.has(rJid.split("@")[0]);
                });
                sessionStorage.setItem("zapflow_last_broadcast_recipients", kept.join("\n"));
            }
        } catch {}

        setSelectedErrorJids([]);
        setSelectedDetailErrorJids([]);
        toast.success(`${jidsToExclude.length} destinatário(s) excluído(s) dos próximos disparos!`);
    }, [sessionId, jidToNameMap, parseRecipientLines, resolveLineToJid]);

    const handleRestoreExcluded = useCallback((jidToRestore: string) => {
        if (!sessionId) return;
        setExcludedRecipients(prev => {
            const updated = prev.filter(e => e?.jid && e.jid !== jidToRestore);
            try { localStorage.setItem(EXCLUDED_KEY(sessionId), JSON.stringify(updated)); } catch {}
            return updated;
        });
        toast.success("Destinatário restaurado para futuros disparos");
    }, [sessionId]);

    const handleRestoreAllExcluded = useCallback(() => {
        if (!sessionId) return;
        setExcludedRecipients([]);
        try { localStorage.removeItem(EXCLUDED_KEY(sessionId)); } catch {}
        setExcludedModalOpen(false);
        toast.success("Todos os destinatários foram restaurados");
    }, [sessionId]);

    const handleReuseLastRecipients = () => {
        try {
            const stored = sessionStorage.getItem("zapflow_last_broadcast_recipients");
            if (stored) {
                setContacts(stored);
                toast.success("Destinatários do último disparo restaurados!");
            } else {
                toast.info("Nenhum destinatário anterior registrado na sessão.");
            }
        } catch {}
    };

    // Open detail modal
    const openDetail = async (log: BroadcastLog) => {
        setSelectedLog(log);
        setDetailOpen(true);
        setDetailLoading(true);
        try {
            const res = await fetch(`/api/messages/${sessionId}/broadcast/history/${log.id}`);
            if (res.ok) {
                const data = await res.json();
                setSelectedLog(data.data);
            }
        } catch (e) {
            console.error("Failed to fetch broadcast detail", e);
        } finally {
            setDetailLoading(false);
        }
    };

    // Ações de cancelar / reenviar falhas no histórico
    const [logActionId, setLogActionId] = useState<string | null>(null);

    const handleLogAction = async (log: BroadcastLog, action: "cancel" | "retry") => {
        setLogActionId(log.id);
        try {
            const res = await fetch(`/api/messages/${sessionId}/broadcast/history/${log.id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action })
            });
            const data = await res.json();
            if (res.ok) {
                toast.success(action === "cancel" ? "Cancelamento solicitado" : "Reenvio iniciado");
                setDetailOpen(false);
                fetchHistory();
            } else {
                toast.error(data.message || "Não foi possível executar a ação");
            }
        } catch (e) {
            console.error("Falha na ação do disparo", e);
            toast.error("Falha ao executar a ação");
        } finally {
            setLogActionId(null);
        }
    };

    // Cancela o disparo ativo atualmente
    const handleCancelActiveBroadcast = async () => {
        const idToCancel = broadcastProgress?.broadcastId;
        if (!idToCancel || !sessionId) return;
        try {
            const res = await fetch(`/api/messages/${sessionId}/broadcast/history/${idToCancel}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "cancel" })
            });
            const data = await res.json();
            if (res.ok) {
                toast.success("Cancelamento solicitado com sucesso");
                setBroadcastProgress(prev => prev ? { ...prev, status: "cancelled" } : null);
                setLoading(false);
                if (typeof window !== "undefined") {
                    const saved = localStorage.getItem(ACTIVE_KEY(sessionId));
                    if (saved) {
                        try {
                            const parsed = JSON.parse(saved);
                            localStorage.setItem(ACTIVE_KEY(sessionId), JSON.stringify({ ...parsed, status: "cancelled" }));
                        } catch {}
                    }
                }
                fetchHistory();
            } else {
                toast.error(data.message || "Não foi possível cancelar o disparo");
            }
        } catch (e) {
            console.error("Erro ao cancelar disparo", e);
            toast.error("Falha ao comunicar com o servidor");
        }
    };

    // Limpa o painel de progresso concluído/cancelado
    const handleClearProgress = () => {
        if (loading || broadcastProgress?.status === "running" || broadcastProgress?.status === "queued") {
            return toast.warning("Não é possível ocultar enquanto um disparo estiver em andamento.");
        }
        setBroadcastProgress(null);
        if (sessionId && typeof window !== "undefined") {
            localStorage.removeItem(ACTIVE_KEY(sessionId));
        }
    };

    // Limpa campos do formulário conscientemente (sem afetar o disparo em processo)
    const handleClearForm = () => {
        setContacts("");
        setMessage("");
        removeAttachment();
        setPickerSearch("");
        setSelectedContacts([]);
        setSelectedGroups([]);
        if (sessionId && typeof window !== "undefined") {
            localStorage.removeItem(DRAFT_KEY(sessionId));
        }
        toast.success("Formulário limpo para configurar o próximo disparo");
    };

    const handleSend = async () => {
        if (!sessionId) return toast.error("Nenhuma sessão ativa encontrada");
        if (!attachment && !message.trim()) {
            return toast.error("Digite uma mensagem ou anexe uma mídia/documento para o disparo");
        }

        const recipients = parseRecipientLines(contacts)
            .map(line => resolveLineToJid(line) || line.trim())
            .filter(r => Boolean(r) && !isJidExcluded(r));

        if (recipients.length === 0) {
            return toast.error("Nenhum destinatário informado");
        }

        let bodyPayload: any = {
            recipients,
            message: message.trim(),
            delay: delay[0],
            mode: scheduleMode
        };

        if (attachment) {
            bodyPayload.media = {
                base64: attachment.base64,
                filename: attachment.name,
                mimetype: attachment.mimetype,
                type: attachment.type
            };
        }

        if (scheduleMode === "datetime") {
            if (!scheduledAt) {
                return toast.error("Selecione a data e hora do agendamento");
            }
            bodyPayload.scheduledAt = scheduledAt;
        } else if (scheduleMode === "programmed") {
            const times = parseProgrammedTimes(programmedTimesInput);
            if (times.length === 0) {
                return toast.error("Informe pelo menos um horário válido (ex: 12h00, 15h00, 18h00)");
            }
            const scheduledDateTimes = times.map(t => getNextTargetDate(t.hour, t.minute).toISOString());
            bodyPayload.programmedTimes = times.map(t => t.timeStr);
            bodyPayload.scheduledDateTimes = scheduledDateTimes;
            bodyPayload.repeatDaily = repeatDaily;
        }

        setIsSubmitting(true);

        try {
            const res = await fetch(`/api/messages/${sessionId}/broadcast`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(bodyPayload)
            });

            const data = await res.json();

            if (res.ok) {
                try { sessionStorage.setItem("zapflow_last_broadcast_recipients", contacts); } catch {}

                if (scheduleMode === "programmed") {
                    toast.success(`${bodyPayload.programmedTimes.length} disparos automáticos programados com sucesso! Executarão em sequência.`);
                    setActiveTab("history");
                    fetchHistory();
                } else if (scheduleMode === "datetime") {
                    toast.success("Disparo agendado com sucesso!");
                    setActiveTab("history");
                    fetchHistory();
                } else if (isBroadcasting) {
                    toast.success(`Próximo disparo enfileirado com sucesso para ${recipients.length} destinatários! O processo atual continuará até o fim.`);
                    setContacts("");
                    setMessage("");
                    removeAttachment();
                    fetchHistory();
                } else {
                    const newProgress: BroadcastProgress = {
                        broadcastId: data.data.broadcastId,
                        status: "running",
                        total: recipients.length,
                        sent: 0,
                        failed: 0,
                        progress: 0,
                        startedAt: new Date().toISOString()
                    };
                    setBroadcastProgress(newProgress);
                    if (typeof window !== "undefined") {
                        localStorage.setItem(ACTIVE_KEY(sessionId), JSON.stringify(newProgress));
                    }
                    toast.info(`Disparo iniciado para ${recipients.length} destinatários na fila sequencial...`);
                    setContacts("");
                    setMessage("");
                    removeAttachment();
                }
            } else {
                toast.error(data.message || "Não foi possível iniciar o disparo");
            }
        } catch (e) {
            console.error(e);
            toast.error("Erro ao enviar o disparo");
        } finally {
            setIsSubmitting(false);
        }
    };

    const recipientCount = parseRecipientLines(contacts).length;
    const formatJid = (jid: string | null | undefined) => {
        if (!jid) return "-";
        const strJid = String(jid || "").trim();
        if (!strJid) return "-";
        const bare = strJid.split("@")[0] || "";
        const knownName = jidToNameMap.get(strJid) || jidToNameMap.get(strJid.toLowerCase()) || jidToNameMap.get(bare);
        const cleanJid = strJid.replace("@s.whatsapp.net", "").replace("@g.us", " (Grupo)");
        if (knownName && knownName !== bare && knownName !== strJid) {
            return `${knownName} (${cleanJid})`;
        }
        return cleanJid;
    };

    const formatTime = (ts: string) => {
        const d = new Date(ts);
        return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' });
    };

    const tabs = [
        { id: "new" as const, label: "Novo disparo", icon: Send },
        { id: "history" as const, label: "Histórico", icon: History },
    ];

    return (
        <SessionGuard>
            <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-3">
                            <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Disparo em massa</h2>
                            {isBroadcasting && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-600 border border-blue-500/25 animate-pulse">
                                    <Radio className="h-3 w-3 animate-ping" /> Disparando em segundo plano
                                </span>
                            )}
                        </div>
                        <p className="text-muted-foreground text-sm mt-1">Envie mensagens para vários destinatários de uma só vez.</p>
                    </div>

                    {(contacts.trim().length > 0 || message.trim().length > 0) && !isBroadcasting && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleClearForm}
                            className="text-xs text-muted-foreground hover:text-destructive h-8 px-3"
                            title="Limpar formulário e começar novo disparo"
                        >
                            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                            Limpar campos
                        </Button>
                    )}
                </div>

                {/* Tabs */}
                <div className="flex gap-1 bg-muted/50 p-1 rounded-lg w-fit">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`relative flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${
                                activeTab === tab.id
                                    ? "bg-background shadow-sm text-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <tab.icon className="h-4 w-4" />
                            {tab.label}
                            {tab.id === "new" && isBroadcasting && (
                                <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse ml-0.5" />
                            )}
                        </button>
                    ))}
                </div>

                {activeTab === "new" && (
                    <>
                        {isBroadcasting && (
                            <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50/80 p-3.5 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200 flex items-center justify-between gap-3 shadow-xs animate-in fade-in">
                                <div className="flex items-center gap-2.5">
                                    <span className="relative flex h-2.5 w-2.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-600"></span>
                                    </span>
                                    <div>
                                        <span className="font-semibold text-blue-950 dark:text-blue-100">Disparo em andamento:</span>{" "}
                                        <span>Enviando para {broadcastProgress?.total} destinatários ({broadcastProgress?.sent} enviadas).</span>
                                        <p className="text-[11.5px] text-blue-700 dark:text-blue-300 mt-0.5 font-normal">
                                            🔒 O processo atual é <strong>independente e seguro</strong>. Qualquer contato ou grupo adicionado abaixo será preparado exclusivamente para o seu <strong>próximo disparo</strong>.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2">
                            {/* Recipients Card */}
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                                    <div>
                                        <CardTitle className="flex items-center gap-2">
                                            <span>Destinatários</span>
                                            {isBroadcasting && (
                                                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 border border-blue-500/20">
                                                    Próximo Disparo
                                                </span>
                                            )}
                                        </CardTitle>
                                        <CardDescription>
                                            Exibe somente o nome do grupo ou nome do contato (um por linha).
                                        </CardDescription>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1">
                                        {excludedRecipients.length > 0 && (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setExcludedModalOpen(true)}
                                                className="text-xs text-red-600 border-red-200 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/30 h-7 px-2 font-medium cursor-pointer"
                                                title="Ver ou restaurar destinatários excluídos dos próximos disparos"
                                            >
                                                <Ban className="h-3 w-3 mr-1" />
                                                Excluídos ({excludedRecipients.length})
                                            </Button>
                                        )}
                                        {contacts.trim().length > 0 && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    const res = resolveRecipientNames(contacts);
                                                    setContacts(res);
                                                    toast.success("Lista limpa somente com os nomes dos grupos e contatos!");
                                                }}
                                                className="text-xs text-[#00a884] hover:bg-[#00a884]/10 h-7 px-2 font-medium cursor-pointer"
                                                title="Deixar somente o nome do grupo ou contato"
                                            >
                                                <Sparkles className="h-3 w-3 mr-1" />
                                                Somente nomes
                                            </Button>
                                        )}
                                        {(contacts.trim().length > 0 || message.trim().length > 0) && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={handleClearForm}
                                                className="text-xs text-muted-foreground hover:text-destructive h-7 px-2 cursor-pointer"
                                                title="Limpar campos para configurar próximo disparo"
                                            >
                                                <RotateCcw className="h-3 w-3 mr-1" />
                                                Limpar
                                            </Button>
                                        )}
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>Grupos ou contatos de destino (somente nome ou número)</Label>
                                        <Textarea
                                            placeholder={"BOTUVERA X COFCO\nCENTRAL X COFCO\nJoão Silva\n5511999999999"}
                                            className="h-44 max-h-56 [field-sizing:fixed] overflow-y-auto font-mono text-sm resize-y"
                                            style={{ fieldSizing: "fixed", maxHeight: "220px", height: "180px", overflowY: "auto" }}
                                            value={contacts}
                                            onChange={e => setContacts(e.target.value)}
                                            onPaste={() => {
                                                setTimeout(() => {
                                                    setContacts(prev => resolveRecipientNames(prev));
                                                }, 120);
                                            }}
                                            onBlur={() => {
                                                setContacts(prev => resolveRecipientNames(prev));
                                            }}
                                            disabled={isSubmitting}
                                        />
                                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                                            <p>{recipientCount} {recipientCount === 1 ? "destinatário identificado" : "destinatários identificados"}</p>
                                            {typeof window !== "undefined" && sessionStorage.getItem("zapflow_last_broadcast_recipients") && (
                                                <button
                                                    type="button"
                                                    onClick={handleReuseLastRecipients}
                                                    className="text-[11px] text-[#00a884] hover:underline flex items-center gap-1 cursor-pointer"
                                                >
                                                    <History className="h-3 w-3" />
                                                    Reutilizar últimos destinatários
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="space-y-2 rounded-lg border p-3">
                                        <div className="flex items-center justify-between">
                                            <Label className="flex items-center gap-2">
                                                <Users className="h-4 w-4" /> Buscar contatos do celular
                                            </Label>
                                            {filteredContacts.length > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={toggleSelectAllContacts}
                                                    disabled={isSubmitting}
                                                    className="text-xs font-semibold text-primary hover:underline disabled:opacity-50 transition-colors cursor-pointer"
                                                >
                                                    {isAllFilteredContactsSelected ? "Desmarcar todos" : `Selecionar todos (${filteredContacts.length})`}
                                                </button>
                                            )}
                                        </div>
                                        <Input
                                            placeholder="Pesquisar por nome ou número..."
                                            value={pickerSearch}
                                            onChange={e => setPickerSearch(e.target.value)}
                                            disabled={isSubmitting}
                                        />
                                        <div className="max-h-52 overflow-y-auto divide-y rounded-md border">
                                            {pickerLoading ? (
                                                <p className="p-3 text-sm text-muted-foreground">Carregando contatos...</p>
                                            ) : filteredContacts.length === 0 ? (
                                                <p className="p-3 text-sm text-muted-foreground">Nenhum contato encontrado.</p>
                                            ) : (
                                                filteredContacts.map(contact => (
                                                    <label key={contact.id} className="flex cursor-pointer items-center gap-3 p-2 hover:bg-muted/50">
                                                        <Checkbox
                                                            checked={selectedContacts.includes(contact.id)}
                                                            onCheckedChange={() => toggleContact(contact.id)}
                                                            disabled={isSubmitting}
                                                        />
                                                        <span className="min-w-0 flex-1">
                                                            <span className="block truncate text-sm font-medium">
                                                                {contactLabel(contact) || contactNumber(contact)}
                                                            </span>
                                                            <span className="block font-mono text-xs text-muted-foreground">{contactNumber(contact)}</span>
                                                        </span>
                                                    </label>
                                                ))
                                            )}
                                        </div>
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="sm"
                                            className="w-full"
                                            onClick={addSelectedContacts}
                                            disabled={selectedContacts.length === 0 || isSubmitting}
                                        >
                                            <Users className="mr-2 h-4 w-4" />
                                            Adicionar {selectedContacts.length > 0 ? `${selectedContacts.length} ` : ""}aos destinatários
                                        </Button>
                                    </div>

                                    <div className="space-y-2 rounded-lg border p-3">
                                        <div className="flex items-center justify-between">
                                            <Label className="flex items-center gap-2">
                                                <Users className="h-4 w-4" /> Buscar grupos
                                            </Label>
                                            {filteredGroups.length > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={toggleSelectAllGroups}
                                                    disabled={isSubmitting}
                                                    className="text-xs font-semibold text-primary hover:underline disabled:opacity-50 transition-colors cursor-pointer"
                                                >
                                                    {isAllFilteredGroupsSelected ? "Desmarcar todos" : `Selecionar todos (${filteredGroups.length})`}
                                                </button>
                                            )}
                                        </div>
                                        <Input
                                            placeholder="Pesquisar grupo pelo nome..."
                                            value={groupSearch}
                                            onChange={e => setGroupSearch(e.target.value)}
                                            disabled={isSubmitting}
                                        />
                                        <div className="max-h-52 overflow-y-auto divide-y rounded-md border">
                                            {groups.length === 0 ? (
                                                <p className="p-3 text-sm text-muted-foreground">Nenhum grupo carregado.</p>
                                            ) : filteredGroups.length === 0 ? (
                                                <p className="p-3 text-sm text-muted-foreground">Nenhum grupo encontrado na pesquisa.</p>
                                            ) : (
                                                filteredGroups.map(group => (
                                                    <label key={group.id} className="flex cursor-pointer items-center gap-3 p-2 hover:bg-muted/50">
                                                        <Checkbox
                                                            checked={selectedGroups.includes(group.jid)}
                                                            onCheckedChange={() => setSelectedGroups(prev => prev.includes(group.jid) ? prev.filter(x => x !== group.jid) : [...prev, group.jid])}
                                                            disabled={isSubmitting}
                                                        />
                                                        <span className="min-w-0 flex-1">
                                                            <span className="block truncate text-sm font-medium">{groupDisplayNames.get(group.jid) || group.subject || group.jid}</span>
                                                        </span>
                                                    </label>
                                                ))
                                            )}
                                        </div>
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="sm"
                                            className="w-full"
                                            onClick={addSelectedGroups}
                                            disabled={selectedGroups.length === 0 || isSubmitting}
                                        >
                                            <Users className="mr-2 h-4 w-4" />
                                            Adicionar {selectedGroups.length > 0 ? `${selectedGroups.length} ` : ""}grupo(s)
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Message Card */}
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                                    <div>
                                        <CardTitle className="flex items-center gap-2">
                                            <span>Conteúdo da mensagem</span>
                                            {attachment && (
                                                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                                                    Com anexo
                                                </span>
                                            )}
                                        </CardTitle>
                                        <CardDescription>
                                            {attachment 
                                                ? "Texto que acompanhará o arquivo anexado como legenda." 
                                                : "Mensagem de texto com suporte a variáveis personalizadas."}
                                        </CardDescription>
                                    </div>
                                    <div>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            className="hidden"
                                            accept="image/*,video/*,application/pdf,.xlsx,.xls,.csv,.doc,.docx,.txt"
                                            onChange={handleFileSelect}
                                            disabled={isSubmitting}
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => fileInputRef.current?.click()}
                                            disabled={isSubmitting}
                                            className="text-xs h-8 border-dashed hover:border-primary hover:text-primary gap-1.5 cursor-pointer"
                                        >
                                            <Paperclip className="h-3.5 w-3.5 text-primary" />
                                            {attachment ? "Trocar arquivo" : "Anexar mídia / arquivo"}
                                        </Button>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {/* Card de visualização do anexo selecionado */}
                                    {attachment && (
                                        <div className="flex items-center justify-between p-2.5 rounded-lg border bg-primary/5 border-primary/20 transition-all">
                                            <div className="flex items-center gap-3 min-w-0">
                                                {attachment.type === "image" && attachment.previewUrl ? (
                                                    <img
                                                        src={attachment.previewUrl}
                                                        alt="Preview"
                                                        className="h-12 w-12 rounded object-cover border shrink-0 bg-background"
                                                    />
                                                ) : attachment.type === "video" ? (
                                                    <div className="h-12 w-12 rounded bg-purple-500/10 text-purple-600 flex items-center justify-center shrink-0 border border-purple-500/20">
                                                        <VideoIcon className="h-6 w-6" />
                                                    </div>
                                                ) : (
                                                    <div className="h-12 w-12 rounded bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0 border border-amber-500/20">
                                                        <FileText className="h-6 w-6" />
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <p className="text-sm font-semibold truncate text-foreground">{attachment.name}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {formatFileSize(attachment.size)} • <span className="uppercase font-medium text-primary">{attachment.type}</span>
                                                    </p>
                                                </div>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={removeAttachment}
                                                disabled={isSubmitting}
                                                className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0 cursor-pointer"
                                                title="Remover arquivo anexado"
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    )}

                                    <div className="space-y-2">
                                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                                            <Label>
                                                {attachment ? "Legenda do anexo (opcional)" : "Mensagem"}
                                            </Label>
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <span className="text-[11px] text-muted-foreground mr-1">Variáveis:</span>
                                                {[
                                                    { tag: "{primeiro_nome}", label: "Primeiro Nome" },
                                                    { tag: "{nome}", label: "Nome Completo" },
                                                    { tag: "{saudacao}", label: "Bom dia/tarde" },
                                                    { tag: "{telefone}", label: "Telefone" }
                                                ].map(v => (
                                                    <button
                                                        key={v.tag}
                                                        type="button"
                                                        onClick={() => setMessage(prev => prev + (prev.endsWith(" ") || prev === "" ? "" : " ") + v.tag + " ")}
                                                        className="px-2 py-0.5 text-[11px] font-mono font-medium rounded bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 transition-colors cursor-pointer"
                                                        title={`Inserir ${v.tag}`}
                                                        disabled={isSubmitting}
                                                    >
                                                        {v.tag}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <Textarea
                                            placeholder={attachment 
                                                ? "Digite uma legenda personalizada que acompanhará a mídia (opcional)..." 
                                                : "Ex: Olá {primeiro_nome}, {saudacao}! Tudo bem? Digite sua mensagem aqui..."}
                                            className="h-44 max-h-56 [field-sizing:fixed] overflow-y-auto text-sm resize-y"
                                            style={{ fieldSizing: "fixed", maxHeight: "220px", height: "180px", overflowY: "auto" }}
                                            value={message}
                                            onChange={e => setMessage(e.target.value)}
                                            disabled={isSubmitting}
                                        />
                                        <p className="text-[11px] text-muted-foreground">
                                            {attachment 
                                                ? "O arquivo selecionado será disparado diretamente no WhatsApp de cada destinatário com a legenda personalizada acima."
                                                : "Dica: As variáveis são substituídas dinamicamente para cada destinatário com simulação de digitação humana para máxima segurança."}
                                        </p>
                                    </div>

                                    <div className="space-y-4 pt-4">
                                        <div className="space-y-2">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <Label className="font-medium">Velocidade: {(delay[0] / 1000).toFixed(1)}s por envio</Label>
                                                <div className="flex items-center gap-1.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => setDelay([200])}
                                                        disabled={isSubmitting}
                                                        className={`px-2.5 py-1 text-xs rounded-lg border font-semibold transition-all cursor-pointer ${
                                                            delay[0] <= 300 
                                                                ? "bg-amber-500 text-white border-amber-600 shadow-sm" 
                                                                : "bg-muted/80 text-foreground hover:bg-accent border-border"
                                                        }`}
                                                    >
                                                        ⚡ Turbo (0.2s)
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setDelay([500])}
                                                        disabled={isSubmitting}
                                                        className={`px-2.5 py-1 text-xs rounded-lg border font-semibold transition-all cursor-pointer ${
                                                            delay[0] > 300 && delay[0] <= 800 
                                                                ? "bg-primary text-primary-foreground border-primary shadow-sm" 
                                                                : "bg-muted/80 text-foreground hover:bg-accent border-border"
                                                        }`}
                                                    >
                                                        🚀 Rápido (0.5s)
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setDelay([1500])}
                                                        disabled={isSubmitting}
                                                        className={`px-2.5 py-1 text-xs rounded-lg border font-semibold transition-all cursor-pointer ${
                                                            delay[0] > 800 
                                                                ? "bg-emerald-600 text-white border-emerald-700 shadow-sm" 
                                                                : "bg-muted/80 text-foreground hover:bg-accent border-border"
                                                        }`}
                                                    >
                                                        🛡️ Seguro (1.5s)
                                                    </button>
                                                </div>
                                            </div>
                                            <Slider
                                                defaultValue={[500]}
                                                min={100}
                                                max={10000}
                                                step={100}
                                                value={delay}
                                                onValueChange={setDelay}
                                                disabled={isBroadcasting}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                {delay[0] <= 300 
                                                    ? "⚡ Modo Turbo: disparos ultra rápidos em sequência (ideal para grupos)." 
                                                    : delay[0] <= 800 
                                                        ? "🚀 Modo Rápido: excelente equilíbrio entre velocidade máxima e estabilidade." 
                                                        : "🛡️ Modo Seguro: espaçamento padrão com variação aleatória suave."}
                                            </p>
                                        </div>

                                        {/* Programação de Envio e Horários */}
                                        <div className="space-y-3 pt-3 border-t">
                                            <div className="flex items-center justify-between">
                                                <Label className="flex items-center gap-2 font-semibold text-sm">
                                                    <Clock className="h-4 w-4 text-primary" /> Programação de envio
                                                </Label>
                                                <span className="text-[11px] text-muted-foreground font-normal">
                                                    Sequencial (um atrás do outro)
                                                </span>
                                            </div>

                                            {/* Modos de Disparo */}
                                            <div className="grid grid-cols-3 gap-1.5 p-1 bg-muted/60 rounded-lg">
                                                <button
                                                    type="button"
                                                    onClick={() => setScheduleMode("now")}
                                                    disabled={isBroadcasting}
                                                    className={`flex items-center justify-center gap-1.5 py-1.5 px-2 text-xs font-medium rounded-md transition-all ${
                                                        scheduleMode === "now"
                                                            ? "bg-background shadow-sm text-foreground font-semibold"
                                                            : "text-muted-foreground hover:text-foreground"
                                                    }`}
                                                >
                                                    <Send className="h-3.5 w-3.5" /> Agora
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setScheduleMode("datetime")}
                                                    disabled={isBroadcasting}
                                                    className={`flex items-center justify-center gap-1.5 py-1.5 px-2 text-xs font-medium rounded-md transition-all ${
                                                        scheduleMode === "datetime"
                                                            ? "bg-background shadow-sm text-foreground font-semibold"
                                                            : "text-muted-foreground hover:text-foreground"
                                                    }`}
                                                >
                                                    <Calendar className="h-3.5 w-3.5" /> Data/Hora
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setScheduleMode("programmed")}
                                                    disabled={isBroadcasting}
                                                    className={`flex items-center justify-center gap-1.5 py-1.5 px-2 text-xs font-medium rounded-md transition-all ${
                                                        scheduleMode === "programmed"
                                                            ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                                                            : "text-muted-foreground hover:text-foreground"
                                                    }`}
                                                >
                                                    <Clock className="h-3.5 w-3.5" /> Horários
                                                </button>
                                            </div>

                                            {/* Modo: Data e Hora única */}
                                            {scheduleMode === "datetime" && (
                                                <div className="space-y-2 p-3 rounded-lg border bg-muted/20 animate-in fade-in duration-150">
                                                    <Label className="text-xs">Data e horário do envio:</Label>
                                                    <Input
                                                        type="datetime-local"
                                                        value={scheduledAt}
                                                        onChange={e => setScheduledAt(e.target.value)}
                                                        disabled={isBroadcasting}
                                                    />
                                                    <p className="text-[11px] text-muted-foreground">O disparo iniciará automaticamente na data e hora selecionadas.</p>
                                                </div>
                                            )}

                                            {/* Modo: Horários Programados (ex: 12h00, 15h00, 18h00) */}
                                            {scheduleMode === "programmed" && (
                                                <div className="space-y-3 p-3.5 rounded-lg border border-primary/25 bg-primary/5 dark:bg-primary/10 animate-in fade-in duration-150">
                                                    <div className="space-y-1.5">
                                                        <div className="flex items-center justify-between">
                                                            <Label className="text-xs font-semibold text-foreground">
                                                                Horários programados:
                                                            </Label>
                                                            <span className="text-[11px] text-muted-foreground">Ex: 12h00, 15h00, 18h00</span>
                                                        </div>
                                                        <Input
                                                            placeholder="12h00, 15h00, 18h00"
                                                            value={programmedTimesInput}
                                                            onChange={e => setProgrammedTimesInput(e.target.value)}
                                                            disabled={isBroadcasting}
                                                            className="font-mono text-sm bg-background"
                                                        />
                                                    </div>

                                                    {/* Sugestões rápidas */}
                                                    <div className="space-y-1">
                                                        <span className="text-[11px] text-muted-foreground font-medium">Sugestões rápidas:</span>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {[
                                                                "12h00, 15h00, 18h00",
                                                                "08h00, 12h00, 18h00",
                                                                "09h00, 14h00, 17h00",
                                                                "10h00, 16h00, 20h00"
                                                            ].map(preset => (
                                                                <button
                                                                    key={preset}
                                                                    type="button"
                                                                    onClick={() => setProgrammedTimesInput(preset)}
                                                                    disabled={isBroadcasting}
                                                                    className="px-2 py-0.5 text-[11px] rounded bg-background border hover:border-primary hover:text-primary transition-colors text-muted-foreground"
                                                                >
                                                                    {preset}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* Preview dos horários identificados */}
                                                    {(() => {
                                                        const pTimes = parseProgrammedTimes(programmedTimesInput);
                                                        if (pTimes.length === 0) return null;
                                                        return (
                                                            <div className="space-y-1 pt-1">
                                                                <span className="text-[11px] text-muted-foreground font-medium">Horários identificados ({pTimes.length}):</span>
                                                                <div className="flex flex-wrap gap-1.5">
                                                                    {pTimes.map(t => {
                                                                        const nextDate = getNextTargetDate(t.hour, t.minute);
                                                                        const isToday = nextDate.getDate() === new Date().getDate();
                                                                        return (
                                                                            <span
                                                                                key={t.timeStr}
                                                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-background border border-primary/30 text-xs font-medium text-foreground shadow-xs"
                                                                            >
                                                                                <Clock className="h-3 w-3 text-primary" />
                                                                                <span className="font-bold">{t.timeStr}</span>
                                                                                <span className="text-[10px] text-muted-foreground">({isToday ? "Hoje" : "Amanhã"})</span>
                                                                            </span>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}

                                                    {/* Repetir diariamente */}
                                                    <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                                                        <Checkbox
                                                            id="repeatDaily"
                                                            checked={repeatDaily}
                                                            onCheckedChange={(checked) => setRepeatDaily(!!checked)}
                                                            disabled={isBroadcasting}
                                                        />
                                                        <label htmlFor="repeatDaily" className="text-xs text-foreground cursor-pointer font-medium select-none">
                                                            Repetir diariamente nestes horários automaticamente
                                                        </label>
                                                    </div>

                                                    {/* Nota de sequencialidade */}
                                                    <div className="rounded-md bg-background/80 p-2 text-[11px] text-muted-foreground border flex items-start gap-2">
                                                        <RotateCcw className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                                                        <span>
                                                            <strong>Execução sequencial:</strong> Os disparos rodam <strong>um atrás do outro em sequência</strong> sem sobreposição.
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <Button
                                            className="w-full bg-[#00a884] hover:bg-[#00a884]/90 text-white font-medium"
                                            onClick={handleSend}
                                            disabled={isSubmitting || !sessionId || recipientCount === 0 || (!message.trim() && !attachment)}
                                        >
                                            {isSubmitting ? (
                                                <>
                                                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                                    Processando envio...
                                                </>
                                            ) : isBroadcasting ? (
                                                <>
                                                    <Clock className="mr-2 h-4 w-4" />
                                                    Enfileirar para próximo disparo ({recipientCount} {recipientCount === 1 ? 'destinatário' : 'destinatários'})
                                                </>
                                            ) : (
                                                <>
                                                    <Send className="mr-2 h-4 w-4" />
                                                    {scheduleMode === "programmed"
                                                        ? `Programar ${parseProgrammedTimes(programmedTimesInput).length} disparo(s) automático(s)`
                                                        : scheduleMode === "datetime"
                                                            ? "Agendar disparo"
                                                            : `Iniciar disparo (${recipientCount} ${recipientCount === 1 ? 'destinatário' : 'destinatários'})`}
                                                </>
                                            )}
                                        </Button>
                                        {isBroadcasting && (
                                            <p className="text-[11px] text-center text-muted-foreground mt-1">
                                                * O disparo atual continua rodando normalmente. Este novo disparo entrará na fila e iniciará em sequência.
                                            </p>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Live Progress Card */}
                        {broadcastProgress && (
                            <Card className={`border-2 transition-colors ${
                                broadcastProgress.status === "completed"
                                    ? (broadcastProgress.failed === 0 ? "border-green-500/30 bg-green-50/30 dark:bg-green-950/10" : "border-yellow-500/30 bg-yellow-50/30 dark:bg-yellow-950/10")
                                    : broadcastProgress.status === "cancelled" || broadcastProgress.status === "interrupted"
                                        ? "border-destructive/30 bg-destructive/5"
                                        : "border-blue-500/30 bg-blue-50/30 dark:bg-blue-950/10"
                            }`}>
                                <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                                    <div>
                                        <CardTitle className="flex items-center gap-2 text-lg">
                                            {broadcastProgress.status === "running" ? (
                                                <><Radio className="h-5 w-5 text-blue-500 animate-pulse" /><span>Disparo em andamento</span></>
                                            ) : broadcastProgress.status === "queued" ? (
                                                <><Clock className="h-5 w-5 text-amber-500 animate-pulse" /><span>Disparo na fila sequencial</span></>
                                            ) : broadcastProgress.status === "cancelled" ? (
                                                <><Ban className="h-5 w-5 text-muted-foreground" /><span>Disparo cancelado</span></>
                                            ) : broadcastProgress.status === "interrupted" ? (
                                                <><AlertTriangle className="h-5 w-5 text-yellow-500" /><span>Disparo interrompido</span></>
                                            ) : broadcastProgress.failed === 0 ? (
                                                <><CheckCircle2 className="h-5 w-5 text-green-500" /><span>Disparo concluído com sucesso!</span></>
                                            ) : (
                                                <><AlertTriangle className="h-5 w-5 text-yellow-500" /><span>Disparo concluído com erros</span></>
                                            )}
                                        </CardTitle>
                                        <CardDescription>ID: {broadcastProgress.broadcastId}</CardDescription>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {(broadcastProgress.status === "running" || broadcastProgress.status === "queued") ? (
                                            <Button
                                                type="button"
                                                variant="destructive"
                                                size="sm"
                                                onClick={handleCancelActiveBroadcast}
                                                className="h-8 gap-1.5"
                                            >
                                                <Ban className="h-3.5 w-3.5" /> Cancelar envio
                                            </Button>
                                        ) : (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={handleClearProgress}
                                                className="h-8 gap-1.5"
                                            >
                                                <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" /> Ocultar progresso
                                            </Button>
                                        )}
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">Progresso</span>
                                            <span className="font-mono font-medium">
                                                {broadcastProgress.sent + broadcastProgress.failed} / {broadcastProgress.total} ({broadcastProgress.progress || 0}%)
                                            </span>
                                        </div>
                                        <Progress value={broadcastProgress.progress || 0} className="h-3" />
                                    </div>

                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="bg-background rounded-lg p-3 text-center border">
                                            <div className="text-2xl font-bold text-green-600">{broadcastProgress.sent}</div>
                                            <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                                                <CheckCircle2 className="h-3 w-3" /> Enviadas
                                            </div>
                                        </div>
                                        <div className="bg-background rounded-lg p-3 text-center border">
                                            <div className="text-2xl font-bold text-red-500">{broadcastProgress.failed}</div>
                                            <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                                                <XCircle className="h-3 w-3" /> Falhas
                                            </div>
                                        </div>
                                        <div className="bg-background rounded-lg p-3 text-center border">
                                            <div className="text-2xl font-bold text-muted-foreground">
                                                {Math.max(0, broadcastProgress.total - broadcastProgress.sent - broadcastProgress.failed)}
                                            </div>
                                            <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                                                <Clock className="h-3 w-3" /> Pendentes
                                            </div>
                                        </div>
                                    </div>

                                    {broadcastProgress.status === "running" && broadcastProgress.current && (
                                        <div className="flex items-center gap-2 text-sm px-3 py-2 bg-muted/50 rounded-lg">
                                            <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-500" />
                                            <span className="text-muted-foreground">Enviando agora:</span>
                                            <span className="font-mono font-medium">{formatJid(broadcastProgress.current)}</span>
                                        </div>
                                    )}

                                    {broadcastProgress.status === "queued" && (
                                        <div className="flex items-center gap-2 text-sm px-3 py-2 bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-lg border border-amber-500/20">
                                            <Clock className="h-3.5 w-3.5 animate-spin" />
                                            <span>{broadcastProgress.message || "Aguardando disparo anterior terminar na fila sequencial..."}</span>
                                        </div>
                                    )}

                                    {broadcastProgress.errors && broadcastProgress.errors.length > 0 && (
                                        <div className="space-y-2.5 pt-1">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="flex items-center gap-3">
                                                    <h4 className="text-sm font-semibold text-red-600 flex items-center gap-1.5">
                                                        <XCircle className="h-4 w-4" /> Erros de envio ({broadcastProgress.errors.length})
                                                    </h4>
                                                    {(() => {
                                                        const selectableJids = (broadcastProgress.errors || [])
                                                            .map(e => (typeof e === "string" ? e : e?.jid))
                                                            .filter((jid): jid is string => Boolean(jid) && !isJidExcluded(jid));
                                                        if (selectableJids.length === 0) return null;
                                                        const allSelected = selectableJids.every(jid => selectedErrorJids.includes(jid));
                                                        return (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    if (allSelected) {
                                                                        setSelectedErrorJids([]);
                                                                    } else {
                                                                        setSelectedErrorJids(Array.from(new Set(selectableJids)));
                                                                    }
                                                                }}
                                                                className="text-xs font-semibold text-red-600 hover:underline cursor-pointer"
                                                            >
                                                                {allSelected ? "Desmarcar todos" : `Selecionar todos (${selectableJids.length})`}
                                                            </button>
                                                        );
                                                    })()}
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    {selectedErrorJids.length > 0 ? (
                                                        <Button
                                                            type="button"
                                                            variant="destructive"
                                                            size="sm"
                                                            onClick={() => handleExcludeRecipients(selectedErrorJids)}
                                                            className="h-7 text-xs px-2.5 gap-1.5 cursor-pointer"
                                                        >
                                                            <Ban className="h-3.5 w-3.5" />
                                                            Excluir selecionados dos próximos disparos ({selectedErrorJids.length})
                                                        </Button>
                                                    ) : (
                                                        broadcastProgress.errors.some(e => !isJidExcluded(e.jid)) && (
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => {
                                                                    const allErrJids = (broadcastProgress.errors || [])
                                                                        .map(e => (typeof e === "string" ? e : e?.jid))
                                                                        .filter((jid): jid is string => Boolean(jid) && !isJidExcluded(jid));
                                                                    handleExcludeRecipients(allErrJids);
                                                                }}
                                                                className="h-7 text-xs px-2.5 gap-1.5 text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                                                            >
                                                                <Ban className="h-3.5 w-3.5" />
                                                                Excluir todos com erro dos próximos disparos
                                                            </Button>
                                                        )
                                                    )}
                                                </div>
                                            </div>

                                            <p className="text-[11px] text-muted-foreground">
                                                Selecione os números/grupos com erro abaixo para excluí-los automaticamente dos seus próximos disparos.
                                            </p>

                                            <div className="max-h-52 overflow-y-auto bg-red-50/80 dark:bg-red-950/30 rounded-lg p-2 space-y-1 border border-red-200/60 dark:border-red-900/40">
                                                {broadcastProgress.errors.map((err, i) => {
                                                    const excluded = isJidExcluded(err.jid);
                                                    const checked = selectedErrorJids.includes(err.jid);
                                                    return (
                                                        <label
                                                            key={i}
                                                            className={`flex justify-between items-center text-xs py-1.5 px-2.5 rounded transition-colors ${
                                                                excluded
                                                                    ? "bg-muted/60 opacity-60 cursor-default"
                                                                    : checked
                                                                        ? "bg-red-100/90 dark:bg-red-900/40 cursor-pointer"
                                                                        : "bg-background/80 hover:bg-background cursor-pointer"
                                                            }`}
                                                        >
                                                            <div className="flex items-center gap-2.5 min-w-0">
                                                                <Checkbox
                                                                    checked={excluded || checked}
                                                                    disabled={excluded}
                                                                    onCheckedChange={() => {
                                                                        if (excluded) return;
                                                                        setSelectedErrorJids(prev =>
                                                                            prev.includes(err.jid)
                                                                                ? prev.filter(x => x !== err.jid)
                                                                                : [...prev, err.jid]
                                                                        );
                                                                    }}
                                                                />
                                                                <span className="font-mono font-medium truncate">{formatJid(err.jid)}</span>
                                                                {excluded && (
                                                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 border border-red-500/20 shrink-0">
                                                                        Excluído dos próximos
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <span className="text-red-500 truncate ml-2 max-w-[240px]" title={err.error}>
                                                                {err.error}
                                                            </span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )}
                    </>
                )}

                {activeTab === "history" && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <History className="h-5 w-5" />
                                Histórico de disparos
                            </CardTitle>
                            <CardDescription>Histórico permanente das mensagens enviadas.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {historyLoading ? (
                                <div className="flex items-center justify-center py-8">
                                    <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                                </div>
                            ) : history.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground">
                                    <p className="text-sm">Nenhum disparo em massa ainda.</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {history.map(log => (
                                        <div key={log.id}
                                            className="flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/30 transition-colors"
                                        >
                                            {/* Status icon */}
                                            <div className="shrink-0">
                                                {log.status === "running" ? (
                                                    <Radio className="h-8 w-8 text-blue-500 animate-pulse" />
                                                ) : log.status === "scheduled" ? (
                                                    <Clock className="h-8 w-8 text-yellow-500" />
                                                ) : log.status === "completed" ? (
                                                    log.failed === 0
                                                        ? <CheckCircle2 className="h-8 w-8 text-green-500" />
                                                        : <AlertTriangle className="h-8 w-8 text-yellow-500" />
                                                ) : log.status === "cancelled" ? (
                                                    <Ban className="h-8 w-8 text-muted-foreground" />
                                                ) : (
                                                    <AlertTriangle className="h-8 w-8 text-yellow-500" />
                                                )}
                                            </div>

                                            {/* Info */}
                                            <div className="flex-1 min-w-0">
                                                {(() => {
                                                    const parsed = parseBroadcastMessage(log.message);
                                                    return (
                                                        <div className="flex items-center gap-1.5 truncate">
                                                            {parsed.media && (
                                                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 shrink-0">
                                                                    <Paperclip className="h-3 w-3" />
                                                                    {parsed.media.filename || parsed.media.type}
                                                                </span>
                                                            )}
                                                            <p className="text-sm font-medium truncate">{parsed.text || "(Sem legenda)"}</p>
                                                        </div>
                                                    );
                                                })()}
                                                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                                    <span className="flex items-center gap-1">
                                                        <CheckCircle2 className="h-3 w-3 text-green-500" /> {log.sent}
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <XCircle className="h-3 w-3 text-red-500" /> {log.failed}
                                                    </span>
                                                    {log.status === "scheduled" ? (
                                                        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                                                            <Clock className="h-3 w-3" />
                                                            Agendado para: {log.scheduledAt ? formatTime(log.scheduledAt) : "-"}
                                                            {log.timeSlot && ` (${log.timeSlot})`}
                                                            {log.repeatDaily && " • Diário"}
                                                        </span>
                                                    ) : (
                                                        <span className="flex items-center gap-1">
                                                            <Calendar className="h-3 w-3" /> {formatTime(log.startedAt)}
                                                        </span>
                                                    )}
                                                    {log.status !== "running" && log.status !== "completed" && log.status !== "scheduled" && (
                                                        <span className="flex items-center gap-1 font-medium">
                                                            {log.status === "cancelled" ? "Cancelado" : log.status === "queued" ? "Na fila" : "Interrompido"}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Ações */}
                                            <div className="flex shrink-0 items-center gap-1">
                                                {log.status === "running" && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleLogAction(log, "cancel")}
                                                        disabled={logActionId === log.id}
                                                    >
                                                        <Ban className="h-4 w-4 mr-1" /> Cancelar
                                                    </Button>
                                                )}
                                                {log.status === "scheduled" && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
                                                        onClick={() => handleLogAction(log, "cancel")}
                                                        disabled={logActionId === log.id}
                                                    >
                                                        <Ban className="h-4 w-4 mr-1" /> Cancelar agendamento
                                                    </Button>
                                                )}
                                                {log.status !== "running" && log.total > log.sent && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleLogAction(log, "retry")}
                                                        disabled={logActionId === log.id}
                                                    >
                                                        {logActionId === log.id
                                                            ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                                                            : <RotateCcw className="h-4 w-4 mr-1" />}
                                                        Reenviar falhas
                                                    </Button>
                                                )}
                                                <Button variant="ghost" size="sm" onClick={() => openDetail(log)}>
                                                    <Eye className="h-4 w-4 mr-1" /> Detalhes
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Detail Modal */}
                <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
                    <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                {selectedLog?.status === "completed"
                                    ? <CheckCircle2 className="h-5 w-5 text-green-500" />
                                    : <Radio className="h-5 w-5 text-blue-500 animate-pulse" />
                                }
                                Detalhes do disparo
                            </DialogTitle>
                        </DialogHeader>

                        {detailLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : selectedLog ? (
                            <div className="flex flex-col gap-4 overflow-hidden min-h-0">
                                {/* Summary */}
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                                        <div className="text-xl font-bold text-green-600">{selectedLog.sent}</div>
                                        <div className="text-xs text-muted-foreground">Enviadas</div>
                                    </div>
                                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                                        <div className="text-xl font-bold text-red-500">{selectedLog.failed}</div>
                                        <div className="text-xs text-muted-foreground">Falhas</div>
                                    </div>
                                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                                        <div className="text-xl font-bold">{selectedLog.total}</div>
                                        <div className="text-xs text-muted-foreground">Total</div>
                                    </div>
                                </div>

                                {/* Message / Media Content */}
                                <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                                    <p className="text-xs text-muted-foreground">Conteúdo / Mensagem:</p>
                                    {(() => {
                                        const parsed = parseBroadcastMessage(selectedLog.message);
                                        return (
                                            <>
                                                {parsed.media && (
                                                    <div className="flex items-center gap-2 p-2 rounded-md border bg-background/60">
                                                        <Paperclip className="h-4 w-4 text-primary shrink-0" />
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-xs font-semibold truncate">{parsed.media.filename}</p>
                                                            <p className="text-[10px] text-muted-foreground uppercase">{parsed.media.type}</p>
                                                        </div>
                                                    </div>
                                                )}
                                                {parsed.text ? (
                                                    <p className="text-sm whitespace-pre-wrap break-words">{parsed.text}</p>
                                                ) : parsed.media ? (
                                                    <p className="text-xs text-muted-foreground italic">(Sem legenda de texto)</p>
                                                ) : null}
                                            </>
                                        );
                                    })()}
                                </div>

                                {/* Time */}
                                <div className="flex gap-4 text-xs text-muted-foreground">
                                    <span>Início: {formatTime(selectedLog.startedAt)}</span>
                                    {selectedLog.completedAt && <span>Conclusão: {formatTime(selectedLog.completedAt)}</span>}
                                </div>

                                {/* Recipients list */}
                                {selectedLog.recipients && selectedLog.recipients.length > 0 && (
                                    <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <h4 className="text-sm font-semibold">Destinatários ({selectedLog.recipients.length})</h4>
                                            {(() => {
                                                const failedList = selectedLog.recipients!.filter(r => r.status === "failed" && !isJidExcluded(r.jid));
                                                if (failedList.length === 0) return null;
                                                const allFailedSelected = failedList.every(r => selectedDetailErrorJids.includes(r.jid));
                                                return (
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                if (allFailedSelected) {
                                                                    setSelectedDetailErrorJids([]);
                                                                } else {
                                                                    setSelectedDetailErrorJids(failedList.map(r => r.jid));
                                                                }
                                                            }}
                                                            className="text-xs font-semibold text-red-600 hover:underline cursor-pointer"
                                                        >
                                                            {allFailedSelected ? "Desmarcar erros" : `Selecionar erros (${failedList.length})`}
                                                        </button>
                                                        {selectedDetailErrorJids.length > 0 && (
                                                            <Button
                                                                type="button"
                                                                variant="destructive"
                                                                size="sm"
                                                                onClick={() => handleExcludeRecipients(selectedDetailErrorJids)}
                                                                className="h-7 text-xs px-2.5 gap-1 cursor-pointer"
                                                            >
                                                                <Ban className="h-3 w-3" />
                                                                Excluir dos próximos ({selectedDetailErrorJids.length})
                                                            </Button>
                                                        )}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                        <div className="space-y-1">
                                            {selectedLog.recipients.map(r => {
                                                const isFailed = r.status === "failed";
                                                const excluded = isJidExcluded(r.jid);
                                                const checked = selectedDetailErrorJids.includes(r.jid);
                                                return (
                                                    <div key={r.id}
                                                        className={`flex items-center justify-between gap-2 text-xs py-1.5 px-2 rounded ${
                                                            r.status === "sent" ? "bg-green-500/5" :
                                                            isFailed ? "bg-red-500/5" : "bg-muted/30"
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            {isFailed && (
                                                                <Checkbox
                                                                    checked={excluded || checked}
                                                                    disabled={excluded}
                                                                    onCheckedChange={() => {
                                                                        if (excluded) return;
                                                                        setSelectedDetailErrorJids(prev =>
                                                                            prev.includes(r.jid)
                                                                                ? prev.filter(x => x !== r.jid)
                                                                                : [...prev, r.jid]
                                                                        );
                                                                    }}
                                                                />
                                                            )}
                                                            <span className="font-mono truncate">{formatJid(r.jid)}</span>
                                                            {excluded && (
                                                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 border border-red-500/20 shrink-0">
                                                                    Excluído dos próximos
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-2 shrink-0">
                                                            <span className={`px-1.5 py-0.5 rounded font-medium ${
                                                                r.status === "sent" ? "text-green-600 bg-green-500/10" :
                                                                isFailed ? "text-red-500 bg-red-500/10" : "text-muted-foreground bg-muted/50"
                                                            }`}>
                                                                {r.status}
                                                            </span>
                                                            {r.error && (
                                                                <span className="text-red-500 max-w-[200px] truncate" title={r.error}>{r.error}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </DialogContent>
                </Dialog>

                {/* Modal de Destinatários Excluídos dos Próximos Disparos */}
                <Dialog open={excludedModalOpen} onOpenChange={setExcludedModalOpen}>
                    <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2 text-red-600">
                                <Ban className="h-5 w-5" />
                                Destinatários Excluídos ({excludedRecipients.length})
                            </DialogTitle>
                        </DialogHeader>
                        <p className="text-xs text-muted-foreground">
                            Estes contatos ou grupos apresentaram erro e foram marcados para serem ignorados automaticamente nos próximos disparos.
                        </p>
                        <div className="flex-1 overflow-y-auto min-h-0 divide-y border rounded-lg my-2">
                            {excludedRecipients.length === 0 ? (
                                <p className="p-4 text-sm text-center text-muted-foreground">Nenhum destinatário excluído.</p>
                            ) : (
                                excludedRecipients
                                    .filter(item => Boolean(item && (typeof item === "string" || item.jid)))
                                    .map((item, idx) => {
                                        const cleanJid = String((typeof item === "string" ? item : item.jid) || "").trim();
                                        const cleanName = String((typeof item === "object" ? item?.name : "") || cleanJid || "Contato").trim();
                                        const displayJid = cleanJid.replace("@s.whatsapp.net", "").replace("@g.us", " (Grupo)");
                                        return (
                                            <div key={cleanJid || idx} className="flex items-center justify-between gap-3 p-2.5 text-xs hover:bg-muted/30">
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-sm truncate">{cleanName}</p>
                                                    <p className="font-mono text-muted-foreground truncate">{displayJid}</p>
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleRestoreExcluded(cleanJid)}
                                                    className="h-7 text-xs shrink-0 cursor-pointer"
                                                >
                                                    <RotateCcw className="h-3 w-3 mr-1" />
                                                    Restaurar
                                                </Button>
                                            </div>
                                        );
                                    })
                            )}
                        </div>
                        {excludedRecipients.length > 0 && (
                            <div className="flex justify-end gap-2 pt-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleRestoreAllExcluded}
                                    className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                                >
                                    Restaurar todos
                                </Button>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setExcludedModalOpen(false)}
                                    className="text-xs cursor-pointer"
                                >
                                    Fechar
                                </Button>
                            </div>
                        )}
                    </DialogContent>
                </Dialog>
            </div>
        </SessionGuard>
    );
}
