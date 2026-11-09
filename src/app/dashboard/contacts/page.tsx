"use client";

import { useState, useEffect } from "react";
import { useSession } from "@/components/dashboard/session-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import {
    Pagination,
    PaginationContent,
    PaginationItem,
} from "@/components/ui/pagination";

import { Search, Loader2, User, Sparkles, Trash2, AlertTriangle, CheckCircle2, Ban, Copy, Download } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { toast } from "sonner";

interface Contact {
    id: string;
    jid: string;
    name?: string;
    notify?: string;
    verifiedName?: string;
    profilePic?: string;
    remoteJidAlt?: string;
}

interface CleanupDiagnostic {
    totalContacts: number;
    duplicates: Array<{ id: string; jid: string; name: string; phone: string; reason: string }>;
    invalidNumbers: Array<{ id: string; jid: string; name: string; reason: string }>;
    failedContacts: Array<{ id: string; jid: string; name: string; phone: string; reason: string }>;
    allFailedBroadcastJids: string[];
}

// In-memory client cache for contacts pagination (WhatsApp Web method)
const contactsPageCache = new Map<string, { data: Contact[]; meta: any }>();

export default function ContactListPage() {
    const { sessionId } = useSession();

    // Filters
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState("10");

    const cacheKey = `${sessionId}:${page}:${limit}:${search}`;
    const initialCached = contactsPageCache.get(cacheKey);

    const [contacts, setContacts] = useState<Contact[]>(initialCached?.data || []);
    const [loading, setLoading] = useState(!initialCached && !!sessionId);
    const [meta, setMeta] = useState(initialCached?.meta || { total: 0, totalPages: 1 });

    // Cleanup Modal State
    const [cleanupOpen, setCleanupOpen] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [cleaning, setCleaning] = useState(false);
    const [diagnostic, setDiagnostic] = useState<CleanupDiagnostic | null>(null);
    const [cleanDuplicates, setCleanDuplicates] = useState(true);
    const [cleanInvalid, setCleanInvalid] = useState(true);
    const [cleanFailed, setCleanFailed] = useState(true);
    const [syncBroadcastExclude, setSyncBroadcastExclude] = useState(true);
    const [exporting, setExporting] = useState(false);

    const handleExportCSV = async () => {
        if (!sessionId) return;
        setExporting(true);
        try {
            const res = await fetch(`/api/contacts/${sessionId}?limit=all`);
            const json = await res.json();
            if (!res.ok || !json.data) throw new Error(json.error || "Falha ao obter contatos");

            const list = json.data as Contact[];
            if (list.length === 0) {
                toast.info("Nenhum contato encontrado para exportação.");
                return;
            }

            const getContactPhone = (c: Contact) => {
                if (c.jid?.endsWith("@s.whatsapp.net")) {
                    return c.jid.split("@")[0].split(":")[0];
                }
                if (c.remoteJidAlt?.endsWith("@s.whatsapp.net")) {
                    return c.remoteJidAlt.split("@")[0].split(":")[0];
                }
                return c.remoteJidAlt || c.jid || "";
            };

            const headers = ["Nome", "Nome Notificacao", "Telefone", "JID", "ID Alternativo"];
            const rows = list.map(c => [
                `"${(c.name || c.verifiedName || "").replace(/"/g, '""')}"`,
                `"${(c.notify || "").replace(/"/g, '""')}"`,
                `"${getContactPhone(c)}"`,
                `"${c.jid || ""}"`,
                `"${c.remoteJidAlt || ""}"`
            ].join(";"));

            const csvContent = "\uFEFF" + [headers.join(";"), ...rows].join("\r\n");
            const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            const nowStr = new Date().toISOString().slice(0, 10);
            link.download = `contatos_barrasoftware_${nowStr}.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            toast.success(`${list.length} contatos exportados com sucesso!`);
        } catch (err: any) {
            console.error("Export error:", err);
            toast.error("Erro ao exportar contatos: " + (err.message || "desconhecido"));
        } finally {
            setExporting(false);
        }
    };

    // Debounce Search
    useEffect(() => {
        const timer = setTimeout(() => {
            setPage(1); // Reset to page 1 on search
            fetchContacts();
        }, 500);
        return () => clearTimeout(timer);
    }, [search]);

    // Fetch on page/session/limit change
    useEffect(() => {
        fetchContacts();
    }, [page, sessionId, limit]);

    const fetchContacts = async (forceRefresh = false) => {
        if (!sessionId) return;
        const key = `${sessionId}:${page}:${limit}:${search}`;
        if (forceRefresh) {
            contactsPageCache.clear();
        }
        if (!contactsPageCache.has(key)) setLoading(true);
        try {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: limit,
                search: search
            });

            const res = await fetch(`/api/contacts/${sessionId}?${params}`);
            const data = await res.json();

            if (res.ok) {
                setContacts(data.data);
                setMeta(data.meta);
                contactsPageCache.set(key, { data: data.data, meta: data.meta });
            } else {
                setContacts([]);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenCleanup = async () => {
        if (!sessionId) return;
        setCleanupOpen(true);
        setAnalyzing(true);
        try {
            const res = await fetch(`/api/contacts/${sessionId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "analyze" }),
            });
            const data = await res.json();
            if (res.ok && data.status) {
                setDiagnostic(data.data);
            } else {
                toast.error(data.error || "Não foi possível analisar os contatos");
            }
        } catch {
            toast.error("Erro ao analisar base de contatos");
        } finally {
            setAnalyzing(false);
        }
    };

    const handleExecuteCleanup = async () => {
        if (!sessionId || !diagnostic) return;
        setCleaning(true);
        try {
            const idsToDelete = new Set<string>();
            if (cleanDuplicates) diagnostic.duplicates.forEach(d => idsToDelete.add(d.id));
            if (cleanInvalid) diagnostic.invalidNumbers.forEach(i => idsToDelete.add(i.id));
            if (cleanFailed) diagnostic.failedContacts.forEach(f => idsToDelete.add(f.id));

            const res = await fetch(`/api/contacts/${sessionId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "cleanup",
                    contactIds: Array.from(idsToDelete)
                }),
            });
            const data = await res.json();

            if (res.ok && data.status) {
                let blockedCount = 0;
                if (syncBroadcastExclude && diagnostic.allFailedBroadcastJids.length > 0) {
                    try {
                        const storageKey = `zapflow_broadcast_excluded_${sessionId}`;
                        const raw = localStorage.getItem(storageKey);
                        let existing: any[] = [];
                        try {
                            const parsed = raw ? JSON.parse(raw) : [];
                            existing = Array.isArray(parsed) ? parsed : [];
                        } catch {
                            existing = [];
                        }

                        const now = new Date().toISOString();
                        const existingMap = new Map<string, { jid: string; name: string; excludedAt: string }>();

                        existing.forEach(item => {
                            if (!item) return;
                            const jid = typeof item === "string" ? item.trim() : String(item.jid || "").trim();
                            if (jid) {
                                const name = typeof item === "object" && item.name ? String(item.name).trim() : jid;
                                const excludedAt = typeof item === "object" && item.excludedAt ? String(item.excludedAt) : now;
                                existingMap.set(jid.toLowerCase(), { jid, name, excludedAt });
                            }
                        });

                        for (const rawJid of diagnostic.allFailedBroadcastJids) {
                            const jid = String(rawJid || "").trim();
                            if (!jid) continue;
                            if (!existingMap.has(jid.toLowerCase())) {
                                existingMap.set(jid.toLowerCase(), { jid, name: jid, excludedAt: now });
                            }
                            const digits = (jid.split("@")[0] || "").replace(/\D/g, "");
                            if (digits && digits.length >= 8) {
                                const waJid = `${digits}@s.whatsapp.net`.toLowerCase();
                                if (!existingMap.has(waJid)) {
                                    existingMap.set(waJid, { jid: `${digits}@s.whatsapp.net`, name: digits, excludedAt: now });
                                }
                            }
                        }

                        localStorage.setItem(storageKey, JSON.stringify(Array.from(existingMap.values())));
                        blockedCount = diagnostic.allFailedBroadcastJids.length;
                    } catch { /* ignore */ }
                }

                toast.success(
                    `${data.data.deletedCount} contato(s) limpo(s) da base` +
                    (blockedCount > 0 ? ` e ${blockedCount} número(s) com falha bloqueado(s) nos próximos disparos!` : "!")
                );
                setCleanupOpen(false);
                await fetchContacts(true);
            } else {
                toast.error(data.error || "Erro ao executar limpeza");
            }
        } catch {
            toast.error("Erro ao executar limpeza de contatos");
        } finally {
            setCleaning(false);
        }
    };

    const handleDeleteSingleContact = async (contact: Contact) => {
        if (!sessionId) return;
        try {
            const res = await fetch(`/api/contacts/${sessionId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "deleteOne", contactId: contact.id }),
            });
            if (res.ok) {
                toast.success(`Contato "${contact.name || contact.notify || contact.jid}" removido`);
                await fetchContacts(true);
            } else {
                toast.error("Não foi possível excluir o contato");
            }
        } catch {
            toast.error("Erro ao excluir contato");
        }
    };

    const selectedCleanupCount = diagnostic ? (() => {
        const ids = new Set<string>();
        if (cleanDuplicates) diagnostic.duplicates.forEach(d => ids.add(d.id));
        if (cleanInvalid) diagnostic.invalidNumbers.forEach(i => ids.add(i.id));
        if (cleanFailed) diagnostic.failedContacts.forEach(f => ids.add(f.id));
        return ids.size;
    })() : 0;

    return (
        <SessionGuard>
            <div className="space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">Contatos</h2>
                        <p className="text-muted-foreground">
                            Gerencie, visualize e higienize sua base de contatos salvos.
                        </p>
                    </div>
                    <Button
                        onClick={handleOpenCleanup}
                        variant="outline"
                        className="border-amber-300 bg-amber-50/70 hover:bg-amber-100/80 text-amber-900 font-medium gap-2"
                    >
                        <Sparkles className="h-4 w-4 text-amber-600" />
                        🧹 Limpeza de Base / Inválidos
                    </Button>
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                            <div className="space-y-1">
                                <CardTitle>Lista de contatos</CardTitle>
                                <CardDescription>
                                    Total: {meta.total} contatos encontrados
                                </CardDescription>
                            </div>
                            <div className="flex items-center gap-2 w-full md:w-auto">
                                <Select value={limit} onValueChange={(val) => { setLimit(val); setPage(1); }}>
                                    <SelectTrigger className="w-[120px]">
                                        <SelectValue placeholder="Por página" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {[10, 25, 50, 100].map((l) => (
                                            <SelectItem key={l} value={l.toString()}>
                                                {l} / página
                                            </SelectItem>
                                        ))}
                                        <SelectItem value="all">Mostrar todos</SelectItem>
                                    </SelectContent>
                                </Select>
                                <div className="relative w-full md:w-64">
                                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Buscar contatos..."
                                        className="pl-8"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                    />
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleExportCSV}
                                    disabled={exporting || loading}
                                    className="gap-2 shrink-0 border-border/40 hover:bg-muted text-xs h-9 cursor-pointer"
                                    title="Baixar lista completa de contatos em formato CSV compatível com Excel"
                                >
                                    {exporting ? (
                                        <Loader2 className="h-4 w-4 animate-spin text-[#00a884]" />
                                    ) : (
                                        <Download className="h-4 w-4 text-[#00a884]" />
                                    )}
                                    <span>{exporting ? "Exportando..." : "Exportar CSV"}</span>
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[80px]">Imagem</TableHead>
                                        <TableHead>Nome / nome exibido</TableHead>
                                        <TableHead className="hidden md:table-cell">JID (ID)</TableHead>
                                        <TableHead className="hidden md:table-cell">Telefone / alternativo</TableHead>
                                        <TableHead className="w-[70px] text-right">Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-24 text-center">
                                                <div className="flex justify-center items-center gap-2">
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    Carregando...
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : contacts.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-24 text-center">
                                                Nenhum contato encontrado.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        contacts.map((contact) => (
                                            <TableRow key={contact.id}>
                                                <TableCell>
                                                    <Avatar>
                                                        <AvatarImage src={contact.profilePic && contact.profilePic.startsWith("http") ? contact.profilePic : (sessionId ? `/api/avatar/${sessionId}/${encodeURIComponent(contact.jid)}` : "")} referrerPolicy="no-referrer" />
                                                        <AvatarFallback><User className="h-4 w-4" /></AvatarFallback>
                                                    </Avatar>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{contact.name || contact.notify || "Desconhecido"}</span>
                                                        {contact.verifiedName && (
                                                            <span className="text-xs text-green-600 flex items-center gap-1">
                                                                ✓ {contact.verifiedName}
                                                            </span>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell font-mono text-sm text-muted-foreground">
                                                    {contact.jid}
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell text-sm">
                                                    {contact.remoteJidAlt || "-"}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-muted-foreground hover:text-red-600"
                                                        title="Remover contato"
                                                        onClick={() => handleDeleteSingleContact(contact)}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Pagination */}
                        {meta.totalPages > 1 && (
                            <div className="mt-4">
                                <Pagination>
                                    <PaginationContent>
                                        <PaginationItem>
                                            <Button
                                                variant="ghost"
                                                disabled={page <= 1}
                                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                            >
                                                Anterior
                                            </Button>
                                        </PaginationItem>

                                        <PaginationItem>
                                            <span className="text-sm text-muted-foreground mx-4">
                                                Página {page} de {meta.totalPages}
                                            </span>
                                        </PaginationItem>

                                        <PaginationItem>
                                            <Button
                                                variant="ghost"
                                                disabled={page >= meta.totalPages}
                                                onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))}
                                            >
                                                Próxima
                                            </Button>
                                        </PaginationItem>
                                    </PaginationContent>
                                </Pagination>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Modal de Diagnóstico e Limpeza Automática (#11) */}
                <Dialog open={cleanupOpen} onOpenChange={setCleanupOpen}>
                    <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Sparkles className="h-5 w-5 text-amber-500" />
                                Limpeza Inteligente de Contatos e Números Inválidos
                            </DialogTitle>
                            <DialogDescription>
                                Identifique e remova contatos duplicados, registros sem telefone válido e números que falharam em disparos anteriores.
                            </DialogDescription>
                        </DialogHeader>

                        {analyzing ? (
                            <div className="py-10 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                                <Loader2 className="h-7 w-7 animate-spin text-primary" />
                                <p className="text-sm">Analisando base de contatos e histórico de falhas de disparo...</p>
                            </div>
                        ) : diagnostic ? (
                            <div className="space-y-4 py-2">
                                <div className="grid grid-cols-3 gap-2.5">
                                    <div className="rounded-lg border p-3 bg-amber-50/50 border-amber-200">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-medium text-amber-800">Duplicados</span>
                                            <Copy className="h-3.5 w-3.5 text-amber-600" />
                                        </div>
                                        <p className="text-2xl font-bold text-amber-900 mt-1">{diagnostic.duplicates.length}</p>
                                    </div>
                                    <div className="rounded-lg border p-3 bg-red-50/50 border-red-200">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-medium text-red-800">Falha no Disparo</span>
                                            <Ban className="h-3.5 w-3.5 text-red-600" />
                                        </div>
                                        <p className="text-2xl font-bold text-red-900 mt-1">
                                            {Math.max(diagnostic.failedContacts.length, diagnostic.allFailedBroadcastJids.length)}
                                        </p>
                                    </div>
                                    <div className="rounded-lg border p-3 bg-muted/40 dark:bg-muted/20 border-border/60">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-medium text-muted-foreground">Sem Telefone / LID</span>
                                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                                        </div>
                                        <p className="text-2xl font-bold text-foreground mt-1">{diagnostic.invalidNumbers.length}</p>
                                    </div>
                                </div>

                                <div className="space-y-2.5 rounded-xl border p-3.5 bg-muted/20">
                                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        Selecione o que deseja higienizar:
                                    </p>

                                    <label className="flex items-start gap-2.5 cursor-pointer py-1">
                                        <Checkbox
                                            checked={cleanDuplicates}
                                            onCheckedChange={(v) => setCleanDuplicates(!!v)}
                                            className="mt-0.5"
                                        />
                                        <div className="text-xs">
                                            <span className="font-semibold text-foreground">
                                                Remover contatos duplicados ({diagnostic.duplicates.length})
                                            </span>
                                            <p className="text-muted-foreground">
                                                Mantém apenas o contato mais completo para cada número de telefone.
                                            </p>
                                        </div>
                                    </label>

                                    <label className="flex items-start gap-2.5 cursor-pointer py-1">
                                        <Checkbox
                                            checked={cleanFailed}
                                            onCheckedChange={(v) => setCleanFailed(!!v)}
                                            className="mt-0.5"
                                        />
                                        <div className="text-xs">
                                            <span className="font-semibold text-foreground">
                                                Remover contatos que falharam em disparos ({diagnostic.failedContacts.length})
                                            </span>
                                            <p className="text-muted-foreground">
                                                Exclui da agenda contatos cujo número retornou erro ou não possui WhatsApp ativo.
                                            </p>
                                        </div>
                                    </label>

                                    <label className="flex items-start gap-2.5 cursor-pointer py-1">
                                        <Checkbox
                                            checked={cleanInvalid}
                                            onCheckedChange={(v) => setCleanInvalid(!!v)}
                                            className="mt-0.5"
                                        />
                                        <div className="text-xs">
                                            <span className="font-semibold text-foreground">
                                                Remover JIDs internos sem número (@lid órfãos) ({diagnostic.invalidNumbers.length})
                                            </span>
                                            <p className="text-muted-foreground">
                                                Remove registros técnicos sem número de telefone que não podem receber disparos.
                                            </p>
                                        </div>
                                    </label>

                                    <label className="flex items-start gap-2.5 cursor-pointer py-1 pt-2 border-t border-border/60">
                                        <Checkbox
                                            checked={syncBroadcastExclude}
                                            onCheckedChange={(v) => setSyncBroadcastExclude(!!v)}
                                            className="mt-0.5"
                                        />
                                        <div className="text-xs">
                                            <span className="font-semibold text-red-700">
                                                🚫 Bloquear todos os números com falha ({diagnostic.allFailedBroadcastJids.length}) nos próximos disparos
                                            </span>
                                            <p className="text-muted-foreground">
                                                Adiciona automaticamente os números que deram erro na lista de exclusão do Disparo em Massa.
                                            </p>
                                        </div>
                                    </label>
                                </div>

                                {(diagnostic.duplicates.length > 0 || diagnostic.failedContacts.length > 0) && (
                                    <div className="space-y-1.5">
                                        <p className="text-xs font-medium text-muted-foreground">
                                            Prévia de registros detectados:
                                        </p>
                                        <div className="max-h-40 overflow-y-auto rounded-lg border bg-background divide-y text-xs">
                                            {diagnostic.failedContacts.slice(0, 15).map((item) => (
                                                <div key={`fail-${item.id}`} className="px-3 py-1.5 flex items-center justify-between gap-2">
                                                    <div className="truncate">
                                                        <span className="font-medium text-red-700">{item.name}</span>{" "}
                                                        <span className="font-mono text-muted-foreground">({item.phone})</span>
                                                    </div>
                                                    <Badge variant="outline" className="text-[10px] border-red-200 text-red-700 shrink-0">
                                                        Falha no disparo
                                                    </Badge>
                                                </div>
                                            ))}
                                            {diagnostic.duplicates.slice(0, 15).map((item) => (
                                                <div key={`dup-${item.id}`} className="px-3 py-1.5 flex items-center justify-between gap-2">
                                                    <div className="truncate">
                                                        <span className="font-medium">{item.name}</span>{" "}
                                                        <span className="font-mono text-muted-foreground">({item.phone})</span>
                                                    </div>
                                                    <Badge variant="outline" className="text-[10px] border-amber-200 text-amber-700 shrink-0">
                                                        Duplicado
                                                    </Badge>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {selectedCleanupCount === 0 && (!syncBroadcastExclude || diagnostic.allFailedBroadcastJids.length === 0) && (
                                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 flex items-center gap-2 text-xs text-emerald-800">
                                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                                        Sua base de contatos está limpa! Nenhum item pendente para remoção com os filtros atuais.
                                    </div>
                                )}
                            </div>
                        ) : null}

                        <DialogFooter className="gap-2">
                            <Button variant="outline" onClick={() => setCleanupOpen(false)}>
                                Cancelar
                            </Button>
                            <Button
                                onClick={handleExecuteCleanup}
                                disabled={cleaning || analyzing || (!selectedCleanupCount && (!syncBroadcastExclude || !diagnostic?.allFailedBroadcastJids.length))}
                                className="bg-amber-600 hover:bg-amber-700 text-white"
                            >
                                {cleaning ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Limpando...
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="h-4 w-4 mr-2" />
                                        Executar Limpeza ({selectedCleanupCount} contatos)
                                    </>
                                )}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </SessionGuard>
    );
}
