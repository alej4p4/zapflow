"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Users, Plus, RefreshCw, MessageSquare, Link as LinkIcon, Download, LogOut, Loader2, Copy, Check } from "lucide-react";
import { SearchFilter } from "@/components/dashboard/search-filter";
import { useSession } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { toast } from "sonner";
import { fetchCachedGroups, getCachedGroups, invalidateWhatsAppClientCache } from "@/lib/whatsapp-client-cache";

interface Group {
    id: string;
    subject: string | null;
    jid: string;
    participants?: any[];
}

export default function GroupsPage() {
    const { sessionId } = useSession();
    const router = useRouter();

    const initialGroups = (sessionId ? getCachedGroups(sessionId) : null) || [];
    const [groups, setGroups] = useState<Group[]>(initialGroups);
    const [loading, setLoading] = useState(initialGroups.length === 0);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newGroupName, setNewGroupName] = useState("");
    const [searchTerm, setSearchTerm] = useState("");

    // Action states
    const [gettingInviteJid, setGettingInviteJid] = useState<string | null>(null);
    const [exportingJid, setExportingJid] = useState<string | null>(null);
    const [leavingGroup, setLeavingGroup] = useState<Group | null>(null);
    const [isLeaving, setIsLeaving] = useState(false);

    const fetchGroups = async (sessId: string, force = false) => {
        if (!force && !getCachedGroups(sessId)) setLoading(true);
        try {
            const list = await fetchCachedGroups(sessId, force);
            setGroups(list || []);
        } catch (error) {
            toast.error("Não foi possível carregar os grupos");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (sessionId) {
            fetchGroups(sessionId);
        } else {
            setGroups([]);
        }
    }, [sessionId]);

    const handleCreateGroup = async () => {
        if (!sessionId || !newGroupName) return;
        try {
            const res = await fetch(`/api/groups/${sessionId}/create`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId, subject: newGroupName })
            });
            if (res.ok) {
                toast.success("Grupo criado com sucesso!");
                setIsCreateOpen(false);
                setNewGroupName("");
                invalidateWhatsAppClientCache(sessionId);
                fetchGroups(sessionId, true);
            } else {
                toast.error("Não foi possível criar o grupo");
            }
        } catch (error) {
            toast.error("Erro ao criar o grupo");
        }
    };

    // 1. Open Chat in /dashboard/chat
    const handleOpenChat = (jid: string) => {
        router.push(`/dashboard/chat?jid=${encodeURIComponent(jid)}`);
    };

    // 2. Fetch and Copy Invite Link
    const handleCopyInviteLink = async (group: Group) => {
        if (!sessionId) return;
        setGettingInviteJid(group.jid);
        try {
            const res = await fetch(`/api/groups/${sessionId}/${encodeURIComponent(group.jid)}/invite`);
            const data = await res.json();
            if (res.ok && data.inviteUrl) {
                await navigator.clipboard.writeText(data.inviteUrl);
                toast.success("🔗 Link de convite copiado para a área de transferência!");
            } else {
                toast.error(data.error || "O bot precisa ser Administrador para gerar link de convite.");
            }
        } catch (err) {
            toast.error("Erro ao buscar link de convite");
        } finally {
            setGettingInviteJid(null);
        }
    };

    // 3. Export Group Participants (CSV)
    const handleExportParticipants = async (group: Group) => {
        if (!sessionId) return;
        setExportingJid(group.jid);
        try {
            const res = await fetch(`/api/groups/${sessionId}/${encodeURIComponent(group.jid)}`);
            const data = await res.json();
            const participants = data?.participants || group.participants || [];

            if (!participants || participants.length === 0) {
                toast.info("Nenhum participante encontrado neste grupo.");
                return;
            }

            const headers = ["Telefone", "JID", "Cargo"];
            const rows = participants.map((p: any) => {
                const jid = p.id || p.jid || "";
                const cleanPhone = jid.split("@")[0].split(":")[0];
                const role = p.admin === "superadmin" ? "Criador / Dono" : p.admin === "admin" ? "Administrador" : "Membro";
                return [`"${cleanPhone}"`, `"${jid}"`, `"${role}"`].join(";");
            });

            const csvContent = "\uFEFF" + [headers.join(";"), ...rows].join("\r\n");
            const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            const safeName = (group.subject || "grupo").replace(/[^a-zA-Z0-9_-]/g, "_");
            link.download = `membros_${safeName}.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            toast.success(`${participants.length} participantes exportados com sucesso!`);
        } catch (err: any) {
            toast.error("Erro ao exportar participantes: " + (err.message || "desconhecido"));
        } finally {
            setExportingJid(null);
        }
    };

    // 4. Leave Group
    const handleConfirmLeaveGroup = async () => {
        if (!sessionId || !leavingGroup) return;
        setIsLeaving(true);
        try {
            const res = await fetch(`/api/groups/${sessionId}/${encodeURIComponent(leavingGroup.jid)}/leave`, {
                method: "POST"
            });
            if (res.ok) {
                toast.success("Você saiu do grupo com sucesso.");
                setLeavingGroup(null);
                invalidateWhatsAppClientCache(sessionId);
                fetchGroups(sessionId, true);
            } else {
                toast.error("Não foi possível sair do grupo.");
            }
        } catch (err) {
            toast.error("Erro ao sair do grupo.");
        } finally {
            setIsLeaving(false);
        }
    };

    const filteredGroups = groups.filter(g =>
        (g.subject || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        g.jid.includes(searchTerm)
    );

    return (
        <SessionGuard>
            <div className="space-y-6 max-w-6xl mx-auto pb-12">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                            <Users className="h-5 w-5 sm:h-6 sm:w-6 text-[#00a884]" /> Grupos do WhatsApp
                        </h1>
                        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                            {sessionId ? `Gerencie os grupos e participantes da sessão ativa (${sessionId}).` : "Selecione uma sessão no menu superior."}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <Button variant="outline" size="sm" className="flex-1 sm:flex-none h-9 text-xs" onClick={() => sessionId && fetchGroups(sessionId, true)} disabled={loading || !sessionId}>
                            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
                            Atualizar
                        </Button>
                        <Button size="sm" className="flex-1 sm:flex-none h-9 text-xs bg-[#00a884] hover:bg-[#00a884]/90 text-white" onClick={() => setIsCreateOpen(true)} disabled={!sessionId}>
                            <Plus className="h-4 w-4 mr-1.5" /> Criar Novo Grupo
                        </Button>
                    </div>
                </div>

                <SearchFilter
                    placeholder="Buscar grupos por nome ou número..."
                    onSearch={setSearchTerm}
                />

                {/* Create Group Modal */}
                {isCreateOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-150">
                        <div className="bg-white dark:bg-[#111b21] p-5 rounded-2xl border border-border/40 shadow-xl w-full max-w-sm space-y-4">
                            <h2 className="text-base font-bold flex items-center gap-2">
                                <Users className="h-4 w-4 text-[#00a884]" />
                                Criar Novo Grupo
                            </h2>
                            <div className="space-y-3">
                                <div>
                                    <Label className="text-xs">Nome do Grupo</Label>
                                    <Input
                                        value={newGroupName}
                                        onChange={e => setNewGroupName(e.target.value)}
                                        placeholder="Ex: Clientes VIP BarraSoftware"
                                        className="mt-1.5 h-9 text-xs"
                                        autoFocus
                                    />
                                </div>
                                <div className="flex justify-end gap-2 pt-2">
                                    <Button variant="ghost" size="sm" onClick={() => setIsCreateOpen(false)} className="text-xs h-8">Cancelar</Button>
                                    <Button size="sm" onClick={handleCreateGroup} className="text-xs h-8 bg-[#00a884] hover:bg-[#00a884]/90 text-white">Criar Grupo</Button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Leave Confirmation Dialog */}
                <AlertDialog open={!!leavingGroup} onOpenChange={(open) => !open && setLeavingGroup(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Sair do grupo?</AlertDialogTitle>
                            <AlertDialogDescription className="text-xs leading-relaxed">
                                Tem certeza de que deseja remover esta sessão do grupo <strong>"{leavingGroup?.subject}"</strong>? O bot deixará de receber e enviar mensagens neste grupo.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel disabled={isLeaving} className="text-xs h-8">Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={handleConfirmLeaveGroup}
                                disabled={isLeaving}
                                className="bg-red-600 hover:bg-red-700 text-white text-xs h-8"
                            >
                                {isLeaving ? "Saindo..." : "Sim, Sair do Grupo"}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                {/* Groups Grid */}
                {loading ? (
                    <div className="py-20 text-center text-xs text-muted-foreground flex flex-col items-center gap-3">
                        <Loader2 className="h-6 w-6 animate-spin text-[#00a884]" />
                        <span>Carregando grupos sincronizados...</span>
                    </div>
                ) : filteredGroups.length === 0 ? (
                    <div className="py-16 text-center text-xs text-muted-foreground border rounded-2xl bg-muted/20">
                        {sessionId ? "Nenhum grupo encontrado com este nome ou termo." : "Nenhuma sessão selecionada."}
                    </div>
                ) : (
                    <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                        {filteredGroups.map(group => (
                            <Card key={group.id} className="hover:border-[#00a884]/40 transition-all hover:shadow-xs flex flex-col justify-between">
                                <CardHeader className="p-4 pb-3">
                                    <div className="flex items-start gap-3">
                                        <Avatar className="h-11 w-11 shrink-0 border border-border/30">
                                            <AvatarImage src={`/api/avatar/${sessionId}/${encodeURIComponent(group.jid)}`} />
                                            <AvatarFallback className="bg-[#00a884]/15 text-[#00a884] font-bold text-sm">
                                                {group.subject?.slice(0, 2).toUpperCase() || "GP"}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0 flex-1">
                                            <h3 className="font-semibold text-sm text-foreground truncate" title={group.subject || ""}>
                                                {group.subject || "Grupo sem nome"}
                                            </h3>
                                            <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                                                {group.jid}
                                            </p>
                                            <div className="flex items-center gap-1.5 mt-1.5">
                                                <span className="inline-flex items-center text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                                                    👥 {group.participants?.length || 0} membros
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </CardHeader>

                                <CardContent className="p-4 pt-0 space-y-2 border-t border-border/10 mt-2">
                                    <div className="grid grid-cols-2 gap-1.5 pt-3">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleOpenChat(group.jid)}
                                            className="h-8 text-xs gap-1.5 hover:bg-[#00a884] hover:text-white hover:border-[#00a884] cursor-pointer"
                                            title="Abrir janela de conversa do grupo"
                                        >
                                            <MessageSquare className="h-3.5 w-3.5" />
                                            <span>Abrir Chat</span>
                                        </Button>

                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleCopyInviteLink(group)}
                                            disabled={gettingInviteJid === group.jid}
                                            className="h-8 text-xs gap-1.5 cursor-pointer"
                                            title="Copiar link oficial de convite do grupo"
                                        >
                                            {gettingInviteJid === group.jid ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <LinkIcon className="h-3.5 w-3.5 text-blue-600" />
                                            )}
                                            <span>Link Convite</span>
                                        </Button>
                                    </div>

                                    <div className="grid grid-cols-2 gap-1.5">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleExportParticipants(group)}
                                            disabled={exportingJid === group.jid}
                                            className="h-8 text-[11px] gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
                                            title="Baixar lista de telefones dos participantes em planilha CSV"
                                        >
                                            {exportingJid === group.jid ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#00a884]" />
                                            ) : (
                                                <Download className="h-3.5 w-3.5 text-[#00a884]" />
                                            )}
                                            <span>Exportar CSV</span>
                                        </Button>

                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setLeavingGroup(group)}
                                            className="h-8 text-[11px] gap-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-500/10 cursor-pointer"
                                            title="Sair deste grupo"
                                        >
                                            <LogOut className="h-3.5 w-3.5" />
                                            <span>Sair</span>
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </SessionGuard>
    );
}
