"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Tag, Check, Plus, Trash2, Settings, Loader2, X, Palette } from "lucide-react";

export interface LabelData {
    id: string;
    name: string;
    colorHex: string;
    color?: number;
    sessionId?: string;
    _count?: { chatLabels: number };
}

export const WAP_COLORS = [
    "#FF0000", "#FF7F00", "#FFFF00", "#00FF00", "#0000FF",
    "#4B0082", "#9400D3", "#FF1493", "#00CED1", "#32CD32",
    "#FFD700", "#FF69B4", "#8B4513", "#2F4F4F", "#696969",
    "#708090", "#778899", "#B0C4DE", "#ADD8E6", "#F0E68C"
];

// ─── Label Assignment Popover ────────────────────────────────────────────────
export function LabelAssignPopover({
    sessionId,
    jid,
    children,
    onLabelsChanged,
}: {
    sessionId: string;
    jid: string;
    children: React.ReactNode;
    onLabelsChanged?: () => void;
}) {
    const [labels, setLabels] = useState<LabelData[]>([]);
    const [assigned, setAssigned] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [newLabelName, setNewLabelName] = useState("");
    const [newLabelColorIndex, setNewLabelColorIndex] = useState(3); // default green
    const [isSavingNew, setIsSavingNew] = useState(false);
    const [isManageOpen, setIsManageOpen] = useState(false);
    const openRef = useRef(false);

    const fetchLabelsAndAssigned = useCallback(async () => {
        if (!sessionId || !jid) return;
        setLoading(true);
        try {
            const [labelRes, assignedRes] = await Promise.all([
                fetch(`/api/labels/${sessionId}`),
                fetch(`/api/labels/${sessionId}/chats?jid=${encodeURIComponent(jid)}`)
            ]);
            const labelData = await labelRes.json();
            const assignedData = await assignedRes.json();

            if (labelRes.ok) setLabels(labelData.data?.labels || []);
            if (assignedRes.ok) {
                setAssigned(new Set((assignedData.data || []).map((cl: any) => cl.labelId)));
            }
        } catch (e) {
            console.error("Failed to fetch labels", e);
        } finally {
            setLoading(false);
        }
    }, [sessionId, jid]);

    useEffect(() => {
        if (openRef.current) fetchLabelsAndAssigned();
    }, [fetchLabelsAndAssigned]);

    const toggleLabel = async (labelId: string) => {
        const isAssigned = assigned.has(labelId);
        try {
            // Optimistic update
            setAssigned(prev => {
                const next = new Set(prev);
                if (isAssigned) next.delete(labelId);
                else next.add(labelId);
                return next;
            });

            const res = await fetch(`/api/labels/${sessionId}/chat/${encodeURIComponent(jid)}/labels`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ labelIds: [labelId], action: isAssigned ? "remove" : "add" })
            });

            if (res.ok) {
                toast.success(isAssigned ? "Etiqueta removida" : "Etiqueta atribuída");
                // Notify entire app that labels changed
                if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("zapflow:labels-changed", {
                        detail: { sessionId, jid, labelId, action: isAssigned ? "remove" : "add" }
                    }));
                }
                onLabelsChanged?.();
            } else {
                // Revert on failure
                setAssigned(prev => {
                    const next = new Set(prev);
                    if (isAssigned) next.add(labelId);
                    else next.delete(labelId);
                    return next;
                });
                toast.error("Não foi possível atualizar a etiqueta");
            }
        } catch (e) {
            setAssigned(prev => {
                const next = new Set(prev);
                if (isAssigned) next.add(labelId);
                else next.delete(labelId);
                return next;
            });
            toast.error("Erro ao atualizar etiqueta");
        }
    };

    const handleCreateLabel = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = newLabelName.trim();
        if (!trimmed) return;

        setIsSavingNew(true);
        try {
            const res = await fetch(`/api/labels/${sessionId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: trimmed,
                    color: newLabelColorIndex
                })
            });

            const data = await res.json();
            if (res.ok && data.status) {
                const createdLabel = data.data?.label;
                setLabels(prev => [createdLabel, ...prev]);
                setNewLabelName("");
                setIsCreating(false);
                toast.success(`Etiqueta "${trimmed}" criada!`);

                // Automatically assign newly created label to this chat
                if (createdLabel?.id) {
                    toggleLabel(createdLabel.id);
                }

                if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("zapflow:labels-changed", {
                        detail: { sessionId, jid }
                    }));
                }
            } else {
                toast.error(data.message || "Erro ao criar etiqueta");
            }
        } catch (e) {
            toast.error("Falha na comunicação ao criar etiqueta");
        } finally {
            setIsSavingNew(false);
        }
    };

    return (
        <>
            <Popover onOpenChange={(open) => {
                openRef.current = open;
                if (open) {
                    setIsCreating(false);
                    fetchLabelsAndAssigned();
                }
            }}>
                <PopoverTrigger asChild>{children}</PopoverTrigger>
                <PopoverContent className="w-64 p-2 rounded-2xl shadow-2xl bg-white dark:bg-[#202c33] border border-border/40 z-50 animate-in fade-in zoom-in-95" side="bottom" align="start">
                    <div className="flex items-center justify-between pb-2 mb-1.5 border-b border-border/20 px-1">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                            <Tag className="h-3.5 w-3.5 text-[#00a884]" />
                            Etiquetas da conversa
                        </span>
                        <button
                            type="button"
                            onClick={() => setIsManageOpen(true)}
                            title="Gerenciar etiquetas"
                            className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                        >
                            <Settings className="h-3.5 w-3.5" />
                        </button>
                    </div>

                    {loading ? (
                        <div className="py-4 space-y-2 px-1">
                            <Skeleton className="h-6 w-full rounded-md" />
                            <Skeleton className="h-6 w-4/5 rounded-md" />
                            <Skeleton className="h-6 w-3/5 rounded-md" />
                        </div>
                    ) : (
                        <>
                            <div className="flex flex-col gap-0.5 max-h-52 overflow-y-auto pr-0.5">
                                {labels.length === 0 ? (
                                    <div className="py-4 text-center text-xs text-muted-foreground">
                                        Nenhuma etiqueta criada ainda.
                                    </div>
                                ) : (
                                    labels.map(label => {
                                        const isChecked = assigned.has(label.id);
                                        return (
                                            <button
                                                key={label.id}
                                                type="button"
                                                onClick={() => toggleLabel(label.id)}
                                                className={cn(
                                                    "flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl text-xs transition-colors cursor-pointer text-left",
                                                    isChecked
                                                        ? "bg-[#00a884]/10 text-foreground font-medium"
                                                        : "hover:bg-muted/60 text-muted-foreground hover:text-foreground font-normal"
                                                )}
                                            >
                                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                                    <span
                                                        className="h-2.5 w-2.5 rounded-full shrink-0 shadow-sm"
                                                        style={{ backgroundColor: label.colorHex }}
                                                    />
                                                    <span className="truncate">{label.name}</span>
                                                </div>
                                                <div className={cn(
                                                    "h-4 w-4 rounded-md border flex items-center justify-center shrink-0 transition-colors",
                                                    isChecked
                                                        ? "bg-[#00a884] border-[#00a884] text-white"
                                                        : "border-border/60 bg-transparent"
                                                )}>
                                                    {isChecked && <Check className="h-3 w-3 stroke-[3]" />}
                                                </div>
                                            </button>
                                        );
                                    })
                                )}
                            </div>

                            {/* Inline Creator / Quick Add */}
                            <div className="pt-2 mt-1.5 border-t border-border/20">
                                {!isCreating ? (
                                    <button
                                        type="button"
                                        onClick={() => setIsCreating(true)}
                                        className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-[#00a884] hover:bg-[#00a884]/10 rounded-xl transition-colors cursor-pointer"
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        <span>Nova etiqueta</span>
                                    </button>
                                ) : (
                                    <form onSubmit={handleCreateLabel} className="space-y-2 pt-1 animate-in fade-in duration-100">
                                        <Input
                                            placeholder="Nome da etiqueta..."
                                            value={newLabelName}
                                            onChange={(e) => setNewLabelName(e.target.value)}
                                            className="h-7 text-xs bg-muted/40"
                                            autoFocus
                                        />
                                        {/* Color swatches */}
                                        <div className="flex items-center gap-1 overflow-x-auto py-1 no-scrollbar">
                                            {WAP_COLORS.slice(0, 10).map((hex, idx) => (
                                                <button
                                                    key={hex}
                                                    type="button"
                                                    onClick={() => setNewLabelColorIndex(idx)}
                                                    className={cn(
                                                        "h-4 w-4 rounded-full shrink-0 transition-transform cursor-pointer",
                                                        newLabelColorIndex === idx ? "ring-2 ring-[#00a884] scale-110" : "hover:scale-105"
                                                    )}
                                                    style={{ backgroundColor: hex }}
                                                />
                                            ))}
                                        </div>
                                        <div className="flex items-center justify-end gap-1.5 pt-0.5">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 px-2 text-[11px]"
                                                onClick={() => setIsCreating(false)}
                                                disabled={isSavingNew}
                                            >
                                                Cancelar
                                            </Button>
                                            <Button
                                                type="submit"
                                                size="sm"
                                                className="h-6 px-2.5 text-[11px] bg-[#00a884] hover:bg-[#00a884]/90 text-white gap-1"
                                                disabled={!newLabelName.trim() || isSavingNew}
                                            >
                                                {isSavingNew ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                                Salvar
                                            </Button>
                                        </div>
                                    </form>
                                )}
                            </div>
                        </>
                    )}
                </PopoverContent>
            </Popover>

            {/* Manage Labels Full Modal */}
            <ManageLabelsModal
                sessionId={sessionId}
                isOpen={isManageOpen}
                onClose={() => {
                    setIsManageOpen(false);
                    fetchLabelsAndAssigned();
                }}
            />
        </>
    );
}

// ─── Manage Labels Modal ─────────────────────────────────────────────────────
export function ManageLabelsModal({
    sessionId,
    isOpen,
    onClose,
}: {
    sessionId: string;
    isOpen: boolean;
    onClose: () => void;
}) {
    const [labels, setLabels] = useState<LabelData[]>([]);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState("");
    const [colorIdx, setColorIdx] = useState(3);
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const fetchLabels = useCallback(async () => {
        if (!sessionId) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/labels/${sessionId}`);
            const data = await res.json();
            if (res.ok) setLabels(data.data?.labels || []);
        } catch (e) {
            console.error("Failed to load labels in modal", e);
        } finally {
            setLoading(false);
        }
    }, [sessionId]);

    useEffect(() => {
        if (isOpen) {
            setCreating(false);
            setName("");
            fetchLabels();
        }
    }, [isOpen, fetchLabels]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;

        setSaving(true);
        try {
            const res = await fetch(`/api/labels/${sessionId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: trimmed, color: colorIdx })
            });
            const data = await res.json();
            if (res.ok && data.status) {
                toast.success(`Etiqueta "${trimmed}" cadastrada`);
                setName("");
                setCreating(false);
                fetchLabels();
                if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("zapflow:labels-changed", { detail: { sessionId } }));
                }
            } else {
                toast.error(data.message || "Erro ao criar etiqueta");
            }
        } catch {
            toast.error("Erro na criação");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (labelId: string, labelName: string) => {
        if (!confirm(`Excluir a etiqueta "${labelName}"? Ela será removida de todas as conversas.`)) return;

        setDeletingId(labelId);
        try {
            const res = await fetch(`/api/labels/${sessionId}/${labelId}`, {
                method: "DELETE"
            });
            if (res.ok) {
                toast.success("Etiqueta removida");
                setLabels(prev => prev.filter(l => l.id !== labelId));
                if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("zapflow:labels-changed", { detail: { sessionId } }));
                }
            } else {
                toast.error("Falha ao remover etiqueta");
            }
        } catch {
            toast.error("Erro ao deletar");
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-md p-0 overflow-hidden rounded-2xl bg-white dark:bg-[#111b21] border border-border/40 shadow-2xl">
                <DialogHeader className="p-4 pb-3 border-b border-border/20">
                    <DialogTitle className="text-base font-semibold flex items-center justify-between text-foreground">
                        <span className="flex items-center gap-2">
                            <Tag className="h-5 w-5 text-[#00a884]" />
                            Gerenciar Etiquetas WhatsApp
                        </span>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setCreating(prev => !prev)}
                            className="h-8 px-2.5 text-xs text-[#00a884] hover:bg-[#00a884]/10 rounded-xl"
                        >
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            {creating ? "Cancelar" : "Nova"}
                        </Button>
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground">
                        Crie e organize etiquetas coloridas para classificar leads e conversas.
                    </DialogDescription>
                </DialogHeader>

                {/* Create form if opened */}
                {creating && (
                    <form onSubmit={handleCreate} className="p-4 bg-muted/40 border-b border-border/20 space-y-3 animate-in slide-in-from-top-2">
                        <Input
                            placeholder="Nome da nova etiqueta (ex: Proposta Enviada, VIP, Suporte)..."
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="h-9 text-xs bg-white dark:bg-[#202c33]"
                            autoFocus
                        />
                        <div className="flex items-center gap-1.5 overflow-x-auto py-1 no-scrollbar">
                            {WAP_COLORS.map((hex, idx) => (
                                <button
                                    key={hex}
                                    type="button"
                                    onClick={() => setColorIdx(idx)}
                                    className={cn(
                                        "h-5 w-5 rounded-full shrink-0 transition-transform cursor-pointer shadow-sm",
                                        colorIdx === idx ? "ring-2 ring-[#00a884] ring-offset-2 scale-110" : "hover:scale-105"
                                    )}
                                    style={{ backgroundColor: hex }}
                                />
                            ))}
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setCreating(false)}
                                disabled={saving}
                                className="h-8 text-xs"
                            >
                                Cancelar
                            </Button>
                            <Button
                                type="submit"
                                size="sm"
                                disabled={!name.trim() || saving}
                                className="h-8 text-xs bg-[#00a884] hover:bg-[#00a884]/90 text-white gap-1.5"
                            >
                                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                Salvar etiqueta
                            </Button>
                        </div>
                    </form>
                )}

                {/* Labels List */}
                <div className="max-h-72 overflow-y-auto divide-y divide-border/10 p-2">
                    {loading ? (
                        <div className="p-4 space-y-2">
                            <Skeleton className="h-8 w-full rounded-xl" />
                            <Skeleton className="h-8 w-full rounded-xl" />
                            <Skeleton className="h-8 w-full rounded-xl" />
                        </div>
                    ) : labels.length === 0 ? (
                        <div className="py-8 text-center text-xs text-muted-foreground">
                            Nenhuma etiqueta cadastrada. Clique em "+ Nova" acima para começar.
                        </div>
                    ) : (
                        labels.map(l => (
                            <div key={l.id} className="flex items-center justify-between p-2.5 rounded-xl hover:bg-muted/40 transition-colors">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <span
                                        className="h-3.5 w-3.5 rounded-full shrink-0 shadow-sm"
                                        style={{ backgroundColor: l.colorHex }}
                                    />
                                    <span className="text-xs font-medium text-foreground truncate">{l.name}</span>
                                    {l._count?.chatLabels !== undefined && l._count.chatLabels > 0 && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold">
                                            {l._count.chatLabels} {l._count.chatLabels === 1 ? "conversa" : "conversas"}
                                        </span>
                                    )}
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDelete(l.id, l.name)}
                                    disabled={deletingId === l.id}
                                    title="Excluir etiqueta"
                                    className="h-7 w-7 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-lg cursor-pointer"
                                >
                                    {deletingId === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                </Button>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-3 bg-muted/20 border-t border-border/20 flex justify-end">
                    <Button size="sm" variant="outline" onClick={onClose} className="h-8 text-xs">
                        Fechar
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
