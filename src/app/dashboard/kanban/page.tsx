"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useSession } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";
import {
    Columns3,
    Search,
    Plus,
    MessageSquare,
    Phone,
    ArrowRight,
    Clock,
    RefreshCw,
    Tag,
    User,
    Users,
    ChevronRight,
    Sparkles,
    MoveRight
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import {
    getKanbanBoardData,
    moveKanbanContact,
    createKanbanStage,
    KanbanBoardData,
    KanbanContact,
    KanbanColumn
} from "./actions";

const STAGE_PALETTE = [
    "#00a884", // WhatsApp Teal
    "#3b82f6", // Blue
    "#8b5cf6", // Purple
    "#ec4899", // Pink
    "#f59e0b", // Amber
    "#ef4444", // Red
    "#10b981", // Emerald
    "#06b6d4", // Cyan
];

export default function KanbanPage() {
    return (
        <SessionGuard>
            <KanbanContent />
        </SessionGuard>
    );
}

function KanbanContent() {
    const { sessionId } = useSession();

    const [data, setData] = useState<KanbanBoardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [draggingJid, setDraggingJid] = useState<string | null>(null);
    const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);

    // New stage dialog
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newStageName, setNewStageName] = useState("");
    const [newStageColor, setNewStageColor] = useState(STAGE_PALETTE[0]);
    const [creatingStage, setCreatingStage] = useState(false);

    const loadBoard = useCallback(async (isSilent = false) => {
        if (!sessionId) return;
        if (!isSilent) setLoading(true);
        else setRefreshing(true);

        try {
            const res = await getKanbanBoardData(sessionId);
            setData(res);
        } catch (err: any) {
            toast.error(err?.message || "Erro ao carregar o funil do Kanban");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [sessionId]);

    useEffect(() => {
        loadBoard();
    }, [loadBoard]);

    // Handle moving contact to a target column
    const handleMove = async (chatJid: string, targetColId: string) => {
        if (!sessionId || !data) return;

        // Find contact across columns
        let foundContact: KanbanContact | null = null;
        let sourceColId: string = "unlabeled";

        for (const col of data.columns) {
            const c = col.contacts.find(x => x.jid === chatJid);
            if (c) {
                foundContact = c;
                sourceColId = col.id;
                break;
            }
        }
        if (!foundContact) {
            foundContact = data.unlabeled.find(x => x.jid === chatJid) || null;
            sourceColId = "unlabeled";
        }

        if (!foundContact || sourceColId === targetColId) return;

        // Optimistic UI update
        const updatedContact = { ...foundContact, currentLabelId: targetColId === "unlabeled" ? null : targetColId };

        setData(prev => {
            if (!prev) return prev;
            return {
                unlabeled: targetColId === "unlabeled"
                    ? [updatedContact, ...prev.unlabeled.filter(x => x.jid !== chatJid)]
                    : prev.unlabeled.filter(x => x.jid !== chatJid),
                columns: prev.columns.map(col => {
                    if (col.id === sourceColId) {
                        return { ...col, contacts: col.contacts.filter(x => x.jid !== chatJid) };
                    }
                    if (col.id === targetColId) {
                        return { ...col, contacts: [updatedContact, ...col.contacts.filter(x => x.jid !== chatJid)] };
                    }
                    return col;
                })
            };
        });

        const targetName = targetColId === "unlabeled"
            ? "Sem Etiqueta"
            : data.columns.find(c => c.id === targetColId)?.name || "Nova Etapa";

        try {
            await moveKanbanContact(sessionId, chatJid, targetColId === "unlabeled" ? null : targetColId);
            toast.success(`"${foundContact.name}" movido para ${targetName}!`);
        } catch (err: any) {
            toast.error("Falha ao sincronizar etapa. Revertendo...");
            loadBoard(true);
        }
    };

    // HTML5 Drag and Drop handlers
    const handleDragStart = (e: React.DragEvent, jid: string) => {
        setDraggingJid(jid);
        e.dataTransfer.setData("text/plain", jid);
        e.dataTransfer.effectAllowed = "move";
    };

    const handleDragOver = (e: React.DragEvent, colId: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dragOverColumnId !== colId) {
            setDragOverColumnId(colId);
        }
    };

    const handleDragLeave = () => {
        setDragOverColumnId(null);
    };

    const handleDrop = (e: React.DragEvent, colId: string) => {
        e.preventDefault();
        setDragOverColumnId(null);
        const jid = e.dataTransfer.getData("text/plain") || draggingJid;
        setDraggingJid(null);
        if (jid) {
            handleMove(jid, colId);
        }
    };

    // Create a new pipeline stage
    const handleCreateStage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!sessionId || !newStageName.trim() || creatingStage) return;

        setCreatingStage(true);
        try {
            const res = await createKanbanStage(sessionId, newStageName, newStageColor);
            if (res.stage) {
                setData(prev => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        columns: [...prev.columns, { ...res.stage!, contacts: [] }]
                    };
                });
                toast.success(`Etapa "${res.stage.name}" criada com sucesso!`);
                setNewStageName("");
                setIsCreateOpen(false);
            }
        } catch (err: any) {
            toast.error(err?.message || "Erro ao criar nova etapa");
        } finally {
            setCreatingStage(false);
        }
    };

    // Filter contacts based on search query
    const filteredData = useMemo(() => {
        if (!data) return null;
        const q = searchQuery.toLowerCase().trim();
        if (!q) return data;

        const filterList = (list: KanbanContact[]) =>
            list.filter(c =>
                c.name.toLowerCase().includes(q) ||
                c.phone.toLowerCase().includes(q) ||
                (c.lastMessage && c.lastMessage.toLowerCase().includes(q))
            );

        return {
            unlabeled: filterList(data.unlabeled),
            columns: data.columns.map(col => ({
                ...col,
                contacts: filterList(col.contacts)
            }))
        };
    }, [data, searchQuery]);

    const totalContactsInPipeline = useMemo(() => {
        if (!data) return 0;
        return data.unlabeled.length + data.columns.reduce((acc, col) => acc + col.contacts.length, 0);
    }, [data]);

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] p-4 md:p-6 overflow-hidden bg-background">
            {/* Top Bar Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-border/40 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-2xl bg-[#00a884]/10 text-[#00a884] flex items-center justify-center shadow-sm">
                        <Columns3 className="h-5 w-5" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                            Pipeline & Kanban CRM
                            <Badge variant="secondary" className="text-xs font-normal">
                                {totalContactsInPipeline} contatos
                            </Badge>
                        </h1>
                        <p className="text-xs text-muted-foreground">
                            Organize seus contatos por etapas de atendimento com drag & drop em tempo real.
                        </p>
                    </div>
                </div>

                {/* Right controls */}
                <div className="flex items-center gap-2.5">
                    <div className="relative w-56 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar contato ou mensagem..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 h-9 text-xs rounded-xl bg-card"
                        />
                    </div>

                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => loadBoard(true)}
                        disabled={refreshing || loading}
                        className="h-9 w-9 rounded-xl cursor-pointer"
                        title="Atualizar Kanban"
                    >
                        <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin text-[#00a884]" : ""}`} />
                    </Button>

                    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                        <DialogTrigger asChild>
                            <Button className="h-9 text-xs rounded-xl bg-[#00a884] hover:bg-[#00a884]/90 text-white gap-1.5 cursor-pointer">
                                <Plus className="h-4 w-4" />
                                <span>Nova Etapa</span>
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md rounded-2xl">
                            <form onSubmit={handleCreateStage}>
                                <DialogHeader>
                                    <DialogTitle className="flex items-center gap-2 text-foreground">
                                        <Tag className="h-5 w-5 text-[#00a884]" />
                                        Criar Nova Etapa do Funil
                                    </DialogTitle>
                                </DialogHeader>
                                <div className="space-y-4 py-4">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-foreground">Nome da Etapa</label>
                                        <Input
                                            placeholder="Ex: Em Negociação, Aguardando PIX, Fechado..."
                                            value={newStageName}
                                            onChange={(e) => setNewStageName(e.target.value)}
                                            required
                                            className="rounded-xl text-sm"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-foreground">Cor de Destaque</label>
                                        <div className="flex items-center gap-2 pt-1">
                                            {STAGE_PALETTE.map((color) => (
                                                <button
                                                    key={color}
                                                    type="button"
                                                    onClick={() => setNewStageColor(color)}
                                                    className={`h-7 w-7 rounded-full transition-transform cursor-pointer ${newStageColor === color ? "ring-2 ring-offset-2 ring-primary scale-110" : "hover:scale-105"}`}
                                                    style={{ backgroundColor: color }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => setIsCreateOpen(false)}
                                        className="rounded-xl"
                                    >
                                        Cancelar
                                    </Button>
                                    <Button
                                        type="submit"
                                        disabled={creatingStage || !newStageName.trim()}
                                        className="rounded-xl bg-[#00a884] hover:bg-[#00a884]/90 text-white"
                                    >
                                        {creatingStage ? "Criando..." : "Criar Etapa"}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* Kanban Horizontal Board */}
            <div className="flex-1 overflow-x-auto overflow-y-hidden pt-4 pb-2">
                {loading ? (
                    <div className="h-full flex items-center justify-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <RefreshCw className="h-8 w-8 animate-spin text-[#00a884]" />
                            <span className="text-sm">Carregando funil de atendimento...</span>
                        </div>
                    </div>
                ) : !filteredData ? null : (
                    <div className="flex gap-4 h-full min-w-max pb-2">
                        {/* Coluna: Sem Etiqueta */}
                        <KanbanColumnView
                            column={{
                                id: "unlabeled",
                                name: "Sem Etiqueta / Novos",
                                colorHex: "#8696a0",
                                contacts: filteredData.unlabeled
                            }}
                            allColumns={filteredData.columns}
                            isOver={dragOverColumnId === "unlabeled"}
                            onDragOver={(e) => handleDragOver(e, "unlabeled")}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, "unlabeled")}
                            onDragStart={handleDragStart}
                            onMove={handleMove}
                        />

                        {/* Colunas por Etiqueta / Estágio */}
                        {filteredData.columns.map((col) => (
                            <KanbanColumnView
                                key={col.id}
                                column={col}
                                allColumns={filteredData.columns}
                                isOver={dragOverColumnId === col.id}
                                onDragOver={(e) => handleDragOver(e, col.id)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, col.id)}
                                onDragStart={handleDragStart}
                                onMove={handleMove}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

interface ColumnViewProps {
    column: KanbanColumn;
    allColumns: KanbanColumn[];
    isOver: boolean;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: React.DragEvent) => void;
    onDragStart: (e: React.DragEvent, jid: string) => void;
    onMove: (jid: string, targetColId: string) => void;
}

function KanbanColumnView({
    column,
    allColumns,
    isOver,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragStart,
    onMove
}: ColumnViewProps) {
    return (
        <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`w-72 md:w-80 flex flex-col h-full rounded-2xl border transition-colors select-none ${
                isOver
                    ? "bg-[#00a884]/10 border-[#00a884] ring-2 ring-[#00a884]/30"
                    : "bg-muted/30 dark:bg-[#1a2329]/60 border-border/40"
            }`}
        >
            {/* Column Header */}
            <div className="p-3.5 flex items-center justify-between border-b border-border/20">
                <div className="flex items-center gap-2 min-w-0">
                    <span
                        className="h-3 w-3 rounded-full shrink-0 shadow-sm"
                        style={{ backgroundColor: column.colorHex }}
                    />
                    <h3 className="font-semibold text-xs text-foreground truncate">
                        {column.name}
                    </h3>
                </div>
                <Badge
                    variant="secondary"
                    className="h-5 px-1.5 text-[11px] font-bold rounded-md bg-background/80 shrink-0"
                >
                    {column.contacts.length}
                </Badge>
            </div>

            {/* Column Contact Cards List */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
                {column.contacts.length === 0 ? (
                    <div className="h-32 flex flex-col items-center justify-center text-center p-3 border-2 border-dashed border-border/30 rounded-xl text-muted-foreground/60">
                        <Tag className="h-6 w-6 mb-1 opacity-40" />
                        <span className="text-xs">Nenhum contato nesta etapa</span>
                        <span className="text-[10px] mt-0.5 opacity-70">Arraste contatos para cá</span>
                    </div>
                ) : (
                    column.contacts.map((contact) => (
                        <KanbanCardView
                            key={contact.jid}
                            contact={contact}
                            currentColumnId={column.id}
                            allColumns={allColumns}
                            onDragStart={onDragStart}
                            onMove={onMove}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

interface CardViewProps {
    contact: KanbanContact;
    currentColumnId: string;
    allColumns: KanbanColumn[];
    onDragStart: (e: React.DragEvent, jid: string) => void;
    onMove: (jid: string, targetColId: string) => void;
}

function KanbanCardView({
    contact,
    currentColumnId,
    allColumns,
    onDragStart,
    onMove
}: CardViewProps) {
    const chatUrl = `/dashboard/chat?jid=${encodeURIComponent(contact.jid)}`;

    return (
        <div
            draggable
            onDragStart={(e) => onDragStart(e, contact.jid)}
            className="group relative p-3 bg-white dark:bg-[#202c33] rounded-xl border border-border/40 shadow-sm hover:shadow-md hover:border-[#00a884]/40 transition-all cursor-grab active:cursor-grabbing"
        >
            {/* Top row: Avatar + Name + Dropdown to move */}
            <div className="flex items-start gap-2.5 mb-2">
                <Avatar className="h-9 w-9 shrink-0 ring-1 ring-border/20">
                    {contact.profilePic && (
                        <AvatarImage src={contact.profilePic} referrerPolicy="no-referrer" />
                    )}
                    <AvatarFallback className="bg-slate-200 dark:bg-slate-700 text-xs font-semibold">
                        {contact.isGroup ? <Users className="h-4 w-4" /> : <User className="h-4 w-4" />}
                    </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-foreground truncate block" title={contact.name}>
                            {contact.name}
                        </span>

                        {/* Move stage popover for quick clicks/mobile */}
                        <Popover>
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    onClick={(e) => e.stopPropagation()}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer shrink-0"
                                    title="Mover para outra etapa..."
                                >
                                    <MoveRight className="h-3 w-3" />
                                </button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-48 p-2 rounded-xl shadow-xl z-50">
                                <div className="text-[11px] font-semibold text-muted-foreground px-2 py-1 mb-1 border-b border-border/20">
                                    Mover para:
                                </div>
                                <div className="space-y-1">
                                    {currentColumnId !== "unlabeled" && (
                                        <button
                                            type="button"
                                            onClick={() => onMove(contact.jid, "unlabeled")}
                                            className="w-full flex items-center px-2 py-1.5 rounded-lg text-xs hover:bg-muted text-foreground text-left cursor-pointer"
                                        >
                                            <span className="h-2 w-2 rounded-full bg-slate-400 mr-2 shrink-0" />
                                            Sem Etiqueta
                                        </button>
                                    )}
                                    {allColumns.map((col) => (
                                        col.id !== currentColumnId && (
                                            <button
                                                key={col.id}
                                                type="button"
                                                onClick={() => onMove(contact.jid, col.id)}
                                                className="w-full flex items-center px-2 py-1.5 rounded-lg text-xs hover:bg-muted text-foreground text-left cursor-pointer"
                                            >
                                                <span
                                                    className="h-2 w-2 rounded-full mr-2 shrink-0"
                                                    style={{ backgroundColor: col.colorHex }}
                                                />
                                                <span className="truncate">{col.name}</span>
                                            </button>
                                        )
                                    ))}
                                </div>
                            </PopoverContent>
                        </Popover>
                    </div>

                    <span className="text-[11px] text-muted-foreground truncate block">
                        {contact.phone}
                    </span>
                </div>
            </div>

            {/* Last message preview */}
            {contact.lastMessage && (
                <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed mb-2.5 bg-muted/20 dark:bg-black/10 px-2 py-1 rounded-lg">
                    {contact.lastMessage}
                </p>
            )}

            {/* Bottom Actions: Open Chat */}
            <div className="pt-2 border-t border-border/20 flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" />
                    {contact.lastMessageTime ? new Date(contact.lastMessageTime).toLocaleDateString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "Ativo"}
                </span>

                <Link
                    href={chatUrl}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-[#00a884] hover:bg-[#00a884]/10 transition-colors"
                >
                    <MessageSquare className="h-3 w-3" />
                    <span>Abrir Chat</span>
                    <ArrowRight className="h-2.5 w-2.5" />
                </Link>
            </div>
        </div>
    );
}
