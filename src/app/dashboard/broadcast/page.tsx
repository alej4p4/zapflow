"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { RefreshCw, Send, CheckCircle2, XCircle, Radio, Clock, AlertTriangle, History, Eye, Calendar, Users, Ban, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { useSocket } from "@/components/chat/socket-context";
import { normalizeSearch } from "@/lib/phone";
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

/** Número canônico do contato (o JID já vem com 55 + DDD). */
function contactNumber(contact: PhoneContact): string {
    const jid = contact.jid.endsWith("@s.whatsapp.net")
        ? contact.jid
        : contact.remoteJidAlt || "";
    return jid.endsWith("@s.whatsapp.net") ? jid.split("@")[0] : "";
}

/** Nome exibido do contato. */
function contactLabel(contact: PhoneContact): string {
    return contact.name || contact.verifiedName || contact.notify || "";
}

/** Interpreta horários como "12h00, 15h00, 18h00" ou "12:00, 15:00, 18:00" */
function parseProgrammedTimes(input: string): { hour: number; minute: number; timeStr: string }[] {
    if (!input || !input.trim()) return [];
    // Match tokens separated by comma, space, semicolon, newline
    const tokens = input.split(/[,;\s\n]+/).map(s => s.trim()).filter(Boolean);
    const results: { hour: number; minute: number; timeStr: string }[] = [];
    const seen = new Set<string>();

    for (const token of tokens) {
        // Match 12h00, 12:00, 12h, 12
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

    const { getSocket, joinSession } = useSocket();

    // Socket for progress updates
    useEffect(() => {
        const socket = getSocket();
        if (!socket || !sessionId) return;

        const onConnect = () => joinSession(sessionId);
        if (socket.connected) joinSession(sessionId);
        socket.on("connect", onConnect);

        const handler = (data: BroadcastProgress) => {
            setBroadcastProgress(data);
            if (data.status === "running") return;

            setLoading(false);
            fetchHistory();
            if (data.status === "completed") {
                if (data.failed === 0) {
                    toast.success(`Disparo concluído: ${data.sent} enviadas.`);
                } else {
                    toast.warning(`Disparo concluído: ${data.sent} enviadas, ${data.failed} falhas.`);
                }
            } else if (data.status === "cancelled") {
                toast.info("Disparo cancelado.");
            }
        };

        socket.on("broadcast.progress", handler);
        return () => { socket.off("connect", onConnect); socket.off("broadcast.progress", handler); };
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

    // Filtro local: nome sem acento ou número
    const filteredContacts = (() => {
        const query = normalizeSearch(pickerSearch);
        const digits = pickerSearch.replace(/\D/g, "");
        if (!query && !digits) return pickerContacts.slice(0, 50);

        return pickerContacts
            .filter(c =>
                normalizeSearch(contactLabel(c)).includes(query) ||
                (digits.length > 0 && contactNumber(c).includes(digits))
            )
            .slice(0, 50);
    })();

    const toggleContact = (id: string) => {
        setSelectedContacts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const addSelectedContacts = () => {
        setContacts(prev => {
            const numbers = new Set(prev.split(/[\n,]+/).map(s => s.trim()).filter(Boolean));
            for (const contact of pickerContacts) {
                const number = contactNumber(contact);
                if (number && selectedContacts.includes(contact.id)) numbers.add(number);
            }
            return Array.from(numbers).join("\n");
        });
        setSelectedContacts([]);
        toast.success("Contatos adicionados aos destinatários");
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

    const addSelectedGroups = () => {
        setContacts(prev => {
            const numbers = new Set(prev.split(/[\n,]+/).map(s => s.trim()).filter(Boolean));
            for (const group of groups) {
                if (selectedGroups.includes(group.jid)) numbers.add(group.jid);
            }
            return Array.from(numbers).join("\n");
        });
        setSelectedGroups([]);
        toast.success("Grupos adicionados aos destinatários");
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

    const handleSend = async () => {
        if (!sessionId) return toast.error("Nenhuma sessão ativa encontrada");
        if (!message.trim()) return toast.error("A mensagem não pode ficar vazia");

        const recipients = contacts.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).map(s => {
            if (!s.includes('@')) return `${s}@s.whatsapp.net`;
            return s;
        });

        if (recipients.length === 0) {
            return toast.error("Nenhum destinatário informado");
        }

        let bodyPayload: any = {
            recipients,
            message,
            delay: delay[0],
            mode: scheduleMode
        };

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

        setLoading(true);
        setBroadcastProgress(null);

        try {
            const res = await fetch(`/api/messages/${sessionId}/broadcast`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(bodyPayload)
            });

            const data = await res.json();

            if (res.ok) {
                if (scheduleMode === "programmed") {
                    toast.success(`${bodyPayload.programmedTimes.length} disparos automáticos programados com sucesso! Executarão em sequência.`);
                    setActiveTab("history");
                    fetchHistory();
                } else if (scheduleMode === "datetime") {
                    toast.success("Disparo agendado com sucesso!");
                    setActiveTab("history");
                    fetchHistory();
                } else {
                    toast.info(`Disparo iniciado para ${recipients.length} destinatários na fila sequencial...`);
                }
            } else {
                toast.error(data.message || "Não foi possível iniciar o disparo");
            }
        } catch (e) {
            console.error(e);
            toast.error("Erro ao enviar o disparo");
        } finally {
            setLoading(false);
        }
    };

    const recipientCount = contacts.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).length;
    const formatJid = (jid: string) => {
        if (!jid) return "-";
        return jid.replace("@s.whatsapp.net", "").replace("@g.us", " (Group)");
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
                <div>
                    <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Disparo em massa</h2>
                    <p className="text-muted-foreground text-sm mt-1">Envie mensagens para vários destinatários de uma só vez.</p>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 bg-muted/50 p-1 rounded-lg w-fit">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${
                                activeTab === tab.id
                                    ? "bg-background shadow-sm text-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <tab.icon className="h-4 w-4" />
                            {tab.label}
                        </button>
                    ))}
                </div>

                {activeTab === "new" && (
                    <>
                        <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2">
                            {/* Recipients Card */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>Destinatários</CardTitle>
                                    <CardDescription>Informe os números separados por vírgula ou linha.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>Números de destino (ex.: 5511999999999)</Label>
                                        <Textarea
                                            placeholder={"628123456789\n628987654321"}
                                            className="h-44 max-h-56 [field-sizing:fixed] overflow-y-auto font-mono text-sm resize-y"
                                            style={{ fieldSizing: "fixed", maxHeight: "220px", height: "180px", overflowY: "auto" }}
                                            value={contacts}
                                            onChange={e => setContacts(e.target.value)}
                                            disabled={loading}
                                        />
                                        <p className="text-xs text-muted-foreground">{recipientCount} números identificados</p>
                                    </div>

                                    <div className="space-y-2 rounded-lg border p-3">
                                        <Label className="flex items-center gap-2">
                                            <Users className="h-4 w-4" /> Buscar contatos do celular
                                        </Label>
                                        <Input
                                            placeholder="Pesquisar por nome ou número..."
                                            value={pickerSearch}
                                            onChange={e => setPickerSearch(e.target.value)}
                                            disabled={loading}
                                        />
                                        <div className="max-h-48 overflow-y-auto divide-y rounded-md border">
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
                                                            disabled={loading}
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
                                            disabled={selectedContacts.length === 0 || loading}
                                        >
                                            <Users className="mr-2 h-4 w-4" />
                                            Adicionar {selectedContacts.length > 0 ? `${selectedContacts.length} ` : ""}aos destinatários
                                        </Button>
                                    </div>

                                    <div className="space-y-2 rounded-lg border p-3">
                                        <Label className="flex items-center gap-2">
                                            <Users className="h-4 w-4" /> Buscar grupos
                                        </Label>
                                        <Input
                                            placeholder="Pesquisar grupo pelo nome..."
                                            value={groupSearch}
                                            onChange={e => setGroupSearch(e.target.value)}
                                            disabled={loading}
                                        />
                                        <div className="max-h-48 overflow-y-auto divide-y rounded-md border">
                                            {groups.length === 0 ? (
                                                <p className="p-3 text-sm text-muted-foreground">Nenhum grupo carregado.</p>
                                            ) : (
                                                groups
                                                    .filter(g => normalizeSearch(g.subject).includes(normalizeSearch(groupSearch)))
                                                    .slice(0, 50)
                                                    .map(group => (
                                                        <label key={group.id} className="flex cursor-pointer items-center gap-3 p-2 hover:bg-muted/50">
                                                            <Checkbox
                                                                checked={selectedGroups.includes(group.jid)}
                                                                onCheckedChange={() => setSelectedGroups(prev => prev.includes(group.jid) ? prev.filter(x => x !== group.jid) : [...prev, group.jid])}
                                                                disabled={loading}
                                                            />
                                                            <span className="min-w-0 flex-1">
                                                                <span className="block truncate text-sm font-medium">{group.subject || group.jid}</span>
                                                                <span className="block truncate font-mono text-xs text-muted-foreground">{group.jid}</span>
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
                                            disabled={selectedGroups.length === 0 || loading}
                                        >
                                            <Users className="mr-2 h-4 w-4" />
                                            Adicionar {selectedGroups.length > 0 ? `${selectedGroups.length} ` : ""}grupo(s)
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Message Card */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>Conteúdo da mensagem</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>Mensagem</Label>
                                        <Textarea
                                            placeholder="Digite sua mensagem aqui..."
                                            className="h-44 max-h-56 [field-sizing:fixed] overflow-y-auto text-sm resize-y"
                                            style={{ fieldSizing: "fixed", maxHeight: "220px", height: "180px", overflowY: "auto" }}
                                            value={message}
                                            onChange={e => setMessage(e.target.value)}
                                            disabled={loading}
                                        />
                                    </div>

                                    <div className="space-y-4 pt-4">
                                        <div className="space-y-2">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <Label className="font-medium">Velocidade: {(delay[0] / 1000).toFixed(1)}s por envio</Label>
                                                <div className="flex items-center gap-1.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => setDelay([200])}
                                                        disabled={loading}
                                                        className={`px-2.5 py-1 text-xs rounded-lg border font-semibold transition-all ${
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
                                                        disabled={loading}
                                                        className={`px-2.5 py-1 text-xs rounded-lg border font-semibold transition-all ${
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
                                                        disabled={loading}
                                                        className={`px-2.5 py-1 text-xs rounded-lg border font-semibold transition-all ${
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
                                                disabled={loading}
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
                                                    disabled={loading}
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
                                                    disabled={loading}
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
                                                    disabled={loading}
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
                                                        disabled={loading}
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
                                                            disabled={loading}
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
                                                            disabled={loading}
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
                                            className="w-full"
                                            onClick={handleSend}
                                            disabled={loading || !sessionId || recipientCount === 0 || !message.trim()}
                                        >
                                            {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                                            {loading
                                                ? "Processando..."
                                                : scheduleMode === "programmed"
                                                    ? `Programar ${parseProgrammedTimes(programmedTimesInput).length} disparo(s) automático(s)`
                                                    : scheduleMode === "datetime"
                                                        ? "Agendar disparo"
                                                        : `Iniciar disparo (${recipientCount} ${recipientCount === 1 ? 'destinatário' : 'destinatários'})`
                                            }
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Live Progress */}
                        {broadcastProgress && (
                            <Card className={`border-2 transition-colors ${
                                broadcastProgress.status === "completed"
                                    ? (broadcastProgress.failed === 0 ? "border-green-500/30 bg-green-50/30 dark:bg-green-950/10" : "border-yellow-500/30 bg-yellow-50/30 dark:bg-yellow-950/10")
                                    : "border-blue-500/30 bg-blue-50/30 dark:bg-blue-950/10"
                            }`}>
                                <CardHeader className="pb-3">
                                    <CardTitle className="flex items-center gap-2 text-lg">
                                        {broadcastProgress.status === "running" ? (
                                            <><Radio className="h-5 w-5 text-blue-500 animate-pulse" /><span>Disparo em andamento</span></>
                                        ) : broadcastProgress.status === "cancelled" ? (
                                            <><Ban className="h-5 w-5 text-muted-foreground" /><span>Disparo cancelado</span></>
                                        ) : broadcastProgress.status === "interrupted" ? (
                                            <><AlertTriangle className="h-5 w-5 text-yellow-500" /><span>Disparo interrompido</span></>
                                        ) : broadcastProgress.failed === 0 ? (
                                            <><CheckCircle2 className="h-5 w-5 text-green-500" /><span>Disparo concluído</span></>
                                        ) : (
                                            <><AlertTriangle className="h-5 w-5 text-yellow-500" /><span>Disparo concluído com erros</span></>
                                        )}
                                    </CardTitle>
                                    <CardDescription>ID: {broadcastProgress.broadcastId}</CardDescription>
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
                                                {broadcastProgress.total - broadcastProgress.sent - broadcastProgress.failed}
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

                                    {broadcastProgress.status === "completed" && broadcastProgress.errors && broadcastProgress.errors.length > 0 && (
                                        <div className="space-y-2">
                                            <h4 className="text-sm font-semibold text-red-600 flex items-center gap-1.5">
                                                <XCircle className="h-4 w-4" /> Failed ({broadcastProgress.errors.length})
                                            </h4>
                                            <div className="max-h-40 overflow-y-auto bg-red-50 dark:bg-red-950/30 rounded-lg p-2 space-y-1">
                                                {broadcastProgress.errors.map((err, i) => (
                                                    <div key={i} className="flex justify-between items-center text-xs py-1 px-2 bg-background/60 rounded">
                                                        <span className="font-mono">{formatJid(err.jid)}</span>
                                                        <span className="text-red-500 truncate ml-2 max-w-[200px]">{err.error}</span>
                                                    </div>
                                                ))}
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
                                                <p className="text-sm font-medium truncate">{log.message}</p>
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
                                Broadcast Detail
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

                                {/* Message */}
                                <div className="bg-muted/30 rounded-lg p-3">
                                    <p className="text-xs text-muted-foreground mb-1">Mensagem:</p>
                                    <p className="text-sm whitespace-pre-wrap break-words">{selectedLog.message}</p>
                                </div>

                                {/* Time */}
                                <div className="flex gap-4 text-xs text-muted-foreground">
                                    <span>Started: {formatTime(selectedLog.startedAt)}</span>
                                    {selectedLog.completedAt && <span>Completed: {formatTime(selectedLog.completedAt)}</span>}
                                </div>

                                {/* Recipients list */}
                                {selectedLog.recipients && selectedLog.recipients.length > 0 && (
                                    <div className="flex-1 overflow-y-auto min-h-0">
                                        <h4 className="text-sm font-semibold mb-2">Recipients ({selectedLog.recipients.length})</h4>
                                        <div className="space-y-1">
                                            {selectedLog.recipients.map(r => (
                                                <div key={r.id}
                                                    className={`flex items-center justify-between gap-2 text-xs py-1.5 px-2 rounded ${
                                                        r.status === "sent" ? "bg-green-500/5" :
                                                        r.status === "failed" ? "bg-red-500/5" : "bg-muted/30"
                                                    }`}
                                                >
                                                    <span className="font-mono truncate">{formatJid(r.jid)}</span>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        <span className={`px-1.5 py-0.5 rounded font-medium ${
                                                            r.status === "sent" ? "text-green-600 bg-green-500/10" :
                                                            r.status === "failed" ? "text-red-500 bg-red-500/10" : "text-muted-foreground bg-muted/50"
                                                        }`}>
                                                            {r.status}
                                                        </span>
                                                        {r.error && (
                                                            <span className="text-red-500 max-w-[200px] truncate" title={r.error}>{r.error}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </DialogContent>
                </Dialog>
            </div>
        </SessionGuard>
    );
}
