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

interface BroadcastProgress {
    broadcastId: string;
    status: "running" | "completed" | "cancelled" | "interrupted" | "scheduled";
    total: number;
    sent: number;
    failed: number;
    current?: string | null;
    progress?: number;
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

export default function BroadcastPage() {
    const { sessionId } = useSession();
    const [contacts, setContacts] = useState("");
    const [message, setMessage] = useState("");
    const [delay, setDelay] = useState([2000]);
    const [pickerSearch, setPickerSearch] = useState("");
    const [pickerContacts, setPickerContacts] = useState<PhoneContact[]>([]);
    const [pickerLoading, setPickerLoading] = useState(false);
    const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
    const [groupSearch, setGroupSearch] = useState("");
    const [groups, setGroups] = useState<PhoneGroup[]>([]);
    const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [scheduledAt, setScheduledAt] = useState("");
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

    // Contatos do celular: carrega uma vez e filtra localmente (busca sem acento)
    useEffect(() => {
        if (!sessionId) return;
        (async () => {
            setPickerLoading(true);
            try {
                const res = await fetch(`/api/contacts/${sessionId}?limit=all&phones=1`);
                if (res.ok) {
                    const data = await res.json();
                    const list = (data.data || []).filter((c: PhoneContact) => contactNumber(c));
                    // Nomeados primeiro, depois alfabético sem acento
                    list.sort((a: PhoneContact, b: PhoneContact) => {
                        const na = normalizeSearch(contactLabel(a));
                        const nb = normalizeSearch(contactLabel(b));
                        if (!na !== !nb) return na ? -1 : 1;
                        return na.localeCompare(nb);
                    });
                    setPickerContacts(list);
                }
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

    // Grupos da sessão (lista única, filtro local)
    useEffect(() => {
        if (!sessionId) return;
        (async () => {
            try {
                const res = await fetch(`/api/groups/${sessionId}`);
                if (res.ok) {
                    const data = await res.json();
                    setGroups(data.data || []);
                }
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
        setLoading(true);
        setBroadcastProgress(null);

        try {
            const recipients = contacts.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).map(s => {
                if (!s.includes('@')) return `${s}@s.whatsapp.net`;
                return s;
            });

            if (recipients.length === 0) {
                toast.error("Nenhum destinatário informado");
                setLoading(false);
                return;
            }

            const res = await fetch(`/api/messages/${sessionId}/broadcast`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    recipients,
                    message,
                    delay: delay[0],
                    scheduledAt: scheduledAt || undefined
                })
            });

            const data = await res.json();

            if (res.ok) {
                toast.info(`Broadcast started for ${recipients.length} recipients...`);
            } else {
                toast.error(data.message || "Não foi possível iniciar o disparo");
                setLoading(false);
            }
        } catch (e) {
            console.error(e);
            toast.error("Erro ao enviar o disparo");
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
                                            className="min-h-[200px] font-mono text-sm"
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
                                            className="min-h-[150px]"
                                            value={message}
                                            onChange={e => setMessage(e.target.value)}
                                            disabled={loading}
                                        />
                                    </div>

                                    <div className="space-y-4 pt-4">
                                        <div className="space-y-2">
                                            <Label>Intervalo: {(delay[0] / 1000).toFixed(1)}s</Label>
                                            <Slider
                                                defaultValue={[2000]}
                                                min={1000}
                                                max={15000}
                                                step={500}
                                                value={delay}
                                                onValueChange={setDelay}
                                                disabled={loading}
                                            />
                                            <p className="text-xs text-muted-foreground">Intervalo entre mensagens, com variação aleatória.</p>
                                        </div>

                                        <div className="space-y-2">
                                            <Label className="flex items-center gap-2">
                                                <Clock className="h-4 w-4" /> Agendar disparo para
                                            </Label>
                                            <Input
                                                type="datetime-local"
                                                value={scheduledAt}
                                                onChange={e => setScheduledAt(e.target.value)}
                                                disabled={loading}
                                            />
                                            <p className="text-xs text-muted-foreground">Deixe em branco para enviar agora. Horário do computador.</p>
                                        </div>

                                        <Button
                                            className="w-full"
                                            onClick={handleSend}
                                            disabled={loading || !sessionId || recipientCount === 0 || !message.trim()}
                                        >
                                            {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                                            {loading ? "Enviando..." : "Iniciar disparo"}
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
                                                    <span className="flex items-center gap-1">
                                                        <Calendar className="h-3 w-3" /> {formatTime(log.startedAt)}
                                                    </span>
                                                    {log.status !== "running" && log.status !== "completed" && (
                                                        <span className="flex items-center gap-1 font-medium">
                                                            {log.status === "cancelled" ? "Cancelado" : "Interrompido"}
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
