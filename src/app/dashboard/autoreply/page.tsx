"use client";

import { useState, useEffect } from "react";
import { useSession } from "@/components/dashboard/session-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { BotMessageSquare, Loader2, Plus, Trash2, Image as ImageIcon, Pencil, Clock, Save, CheckCircle2 } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getAutoReplies, createAutoReply, deleteAutoReply, updateAutoReply } from "./actions";
import { SessionGuard } from "@/components/dashboard/session-guard";

const AWAY_SCHEDULE_KEYWORD = "__AWAY_SCHEDULE__";

const WEEK_DAYS = [
    { day: 1, label: "Seg" },
    { day: 2, label: "Ter" },
    { day: 3, label: "Qua" },
    { day: 4, label: "Qui" },
    { day: 5, label: "Sex" },
    { day: 6, label: "Sáb" },
    { day: 0, label: "Dom" },
];

interface AutoReply {
    id: string;
    keyword: string;
    matchType: string;
    response: string;
    isMedia: boolean;
    mediaUrl: string | null;
    mediaType: string | null;
    triggerType: string;
    createdAt: Date;
}

export default function AutoReplyPage() {
    const { sessionId } = useSession();
    const [rules, setRules] = useState<AutoReply[]>([]);
    const [loading, setLoading] = useState(false);

    // Away / Business Hours Schedule state (#14)
    const [awayRuleId, setAwayRuleId] = useState<string | null>(null);
    const [awayEnabled, setAwayEnabled] = useState(false);
    const [startTime, setStartTime] = useState("07:30");
    const [endTime, setEndTime] = useState("18:00");
    const [workDays, setWorkDays] = useState<number[]>([1, 2, 3, 4, 5]);
    const [cooldownMinutes, setCooldownMinutes] = useState("120");
    const [awayMessage, setAwayMessage] = useState(
        "{saudacao}! Recebemos sua mensagem, porém nosso horário de atendimento é de segunda a sexta, das 07:30 às 18:00. Assim que retornarmos, responderemos você!"
    );
    const [savingAway, setSavingAway] = useState(false);
    
    // Form states
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    
    const [keyword, setKeyword] = useState("");
    const [response, setResponse] = useState("");
    const [matchType, setMatchType] = useState("EXACT");
    const [triggerType, setTriggerType] = useState("ALL");
    const [mediaUrl, setMediaUrl] = useState("");
    const [mediaType, setMediaType] = useState("image");

    // Edit states
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [editKeyword, setEditKeyword] = useState("");
    const [editResponse, setEditResponse] = useState("");
    const [editMatchType, setEditMatchType] = useState("EXACT");
    const [editTriggerType, setEditTriggerType] = useState("ALL");
    const [editMediaUrl, setEditMediaUrl] = useState("");
    const [editMediaType, setEditMediaType] = useState("image");

    useEffect(() => {
        if (sessionId) {
            fetchRules();
        }
    }, [sessionId]);

    const fetchRules = async () => {
        if (!sessionId) return;
        setLoading(true);
        try {
            const data = (await getAutoReplies(sessionId)) as unknown as AutoReply[];
            const awayRule = data.find(r => r.keyword === AWAY_SCHEDULE_KEYWORD);
            if (awayRule) {
                setAwayRuleId(awayRule.id);
                try {
                    const parsed = JSON.parse(awayRule.response || "{}");
                    setAwayEnabled(!!parsed.enabled);
                    if (parsed.startTime) setStartTime(parsed.startTime);
                    if (parsed.endTime) setEndTime(parsed.endTime);
                    if (Array.isArray(parsed.workDays)) setWorkDays(parsed.workDays);
                    if (parsed.cooldownMinutes) setCooldownMinutes(String(parsed.cooldownMinutes));
                    if (parsed.message) setAwayMessage(parsed.message);
                } catch { /* ignore */ }
            } else {
                setAwayRuleId(null);
            }
            setRules(data.filter(r => r.keyword !== AWAY_SCHEDULE_KEYWORD));
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Erro ao carregar respostas automáticas");
        } finally {
            setLoading(false);
        }
    };

    const toggleWorkDay = (day: number) => {
        setWorkDays(prev =>
            prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
        );
    };

    const handleSaveAwaySchedule = async () => {
        if (!sessionId) return;
        if (!awayMessage.trim()) {
            toast.error("Informe a mensagem de ausência automática");
            return;
        }
        setSavingAway(true);
        try {
            const payloadJson = JSON.stringify({
                enabled: awayEnabled,
                startTime,
                endTime,
                workDays,
                cooldownMinutes: parseInt(cooldownMinutes, 10) || 120,
                message: awayMessage.trim(),
            });

            if (awayRuleId) {
                await updateAutoReply(sessionId, awayRuleId, {
                    keyword: AWAY_SCHEDULE_KEYWORD,
                    response: payloadJson,
                    matchType: "EXACT",
                    triggerType: "PRIVATE",
                    isMedia: false,
                    mediaUrl: null,
                    mediaType: null,
                });
            } else {
                const created = await createAutoReply(sessionId, {
                    keyword: AWAY_SCHEDULE_KEYWORD,
                    response: payloadJson,
                    matchType: "EXACT",
                    triggerType: "PRIVATE",
                    isMedia: false,
                    mediaUrl: null,
                    mediaType: null,
                });
                setAwayRuleId(created.id);
            }
            toast.success(
                awayEnabled
                    ? "Horário de funcionamento e mensagem de ausência ativados!"
                    : "Configuração de horário salva (desativada)."
            );
        } catch (error: any) {
            toast.error(error.message || "Erro ao salvar horário de funcionamento");
        } finally {
            setSavingAway(false);
        }
    };

    const handleCreate = async () => {
        if (!sessionId) return;
        if (!keyword.trim() || (!response.trim() && !mediaUrl.trim())) {
            toast.error("Informe a palavra-chave e uma resposta ou URL de mídia");
            return;
        }

        setSubmitting(true);
        try {
            await createAutoReply(sessionId, {
                keyword: keyword.trim(),
                response: response.trim(),
                matchType,
                triggerType,
                isMedia: !!mediaUrl.trim(),
                mediaUrl: mediaUrl.trim() || null,
                mediaType: mediaType || null
            });

            toast.success("Regra de resposta automática criada");
            setIsCreateOpen(false);
            fetchRules();
            resetForm();
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Erro ao criar resposta automática");
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (ruleId: string) => {
        if (!sessionId) return;
        try {
            await deleteAutoReply(sessionId, ruleId);
            toast.success("Resposta automática excluída");
            fetchRules();
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Erro ao excluir resposta automática");
        }
    };

    const resetForm = () => {
        setKeyword("");
        setResponse("");
        setMatchType("EXACT");
        setTriggerType("ALL");
        setMediaUrl("");
        setMediaType("image");
    };

    const handleEdit = (rule: AutoReply) => {
        setEditId(rule.id);
        setEditKeyword(rule.keyword);
        setEditResponse(rule.response || "");
        setEditMatchType(rule.matchType);
        setEditTriggerType(rule.triggerType);
        setEditMediaUrl(rule.mediaUrl || "");
        setEditMediaType(rule.mediaType || "image");
        setIsEditOpen(true);
    };

    const handleUpdate = async () => {
        if (!sessionId || !editId) return;
        if (!editKeyword.trim() || (!editResponse.trim() && !editMediaUrl.trim())) {
            toast.error("Informe a palavra-chave e uma resposta ou URL de mídia");
            return;
        }

        setSubmitting(true);
        try {
            await updateAutoReply(sessionId, editId, {
                keyword: editKeyword.trim(),
                response: editResponse.trim(),
                matchType: editMatchType,
                triggerType: editTriggerType,
                isMedia: !!editMediaUrl.trim(),
                mediaUrl: editMediaUrl.trim() || null,
                mediaType: editMediaType || null
            });

            toast.success("Regra de resposta automática atualizada");
            setIsEditOpen(false);
            fetchRules();
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Erro ao atualizar a resposta automática");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <SessionGuard>
            <div className="max-w-5xl space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Respostas automáticas</h1>
                    <p className="text-muted-foreground">Configure horário de expediente, mensagem de ausência e regras por palavra-chave.</p>
                </div>

                <Dialog open={isCreateOpen} onOpenChange={(open) => {
                    setIsCreateOpen(open);
                    if (!open) resetForm();
                }}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="w-4 h-4 mr-2" />
                            Nova regra por palavra-chave
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[500px]">
                        <DialogHeader>
                            <DialogTitle>Criar regra de resposta automática</DialogTitle>
                            <DialogDescription>Adicione uma resposta baseada em palavra-chave.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Palavra-chave</Label>
                                    <Input 
                                        value={keyword} 
                                        onChange={(e) => setKeyword(e.target.value)} 
                                        placeholder="e.g. !help, tabela, frete" 
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Tipo de correspondência</Label>
                                    <Select value={matchType} onValueChange={setMatchType}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="EXACT">Correspondência exata</SelectItem>
                                            <SelectItem value="CONTAINS">Contém</SelectItem>
                                            <SelectItem value="STARTS_WITH">Começa com</SelectItem>
                                            <SelectItem value="REGEX">Expressão regular</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Onde a regra será aplicada</Label>
                                <Select value={triggerType} onValueChange={setTriggerType}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">Conversas privadas e grupos</SelectItem>
                                        <SelectItem value="PRIVATE">Somente conversas privadas</SelectItem>
                                        <SelectItem value="GROUP">Somente grupos</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>Mensagem de resposta (opcional)</Label>
                                <Textarea 
                                    value={response} 
                                    onChange={(e) => setResponse(e.target.value)} 
                                    placeholder="Obrigado pela mensagem! Nossa equipe responderá em breve." 
                                    className="min-h-[120px]"
                                />
                                <p className="text-xs text-muted-foreground">Você pode usar a formatação padrão do WhatsApp (*negrito*, _itálico_, ~tachado~).</p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>URL da mídia (opcional)</Label>
                                    <Input 
                                        value={mediaUrl} 
                                        onChange={(e) => setMediaUrl(e.target.value)} 
                                        placeholder="https://example.com/image.jpg" 
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Tipo de mídia</Label>
                                    <Select value={mediaType} onValueChange={setMediaType}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                             <SelectItem value="image">Imagem</SelectItem>
                                             <SelectItem value="video">Vídeo</SelectItem>
                                             <SelectItem value="document">Documento</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                             <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
                            <Button onClick={handleCreate} disabled={submitting || !keyword.trim() || (!response.trim() && !mediaUrl.trim())}>
                                 {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "Salvar regra"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Card #14: Horário de Funcionamento / Ausência Automática */}
            <Card className="border-primary/20 shadow-sm">
                <CardHeader className="pb-3 border-b bg-muted/20">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-start gap-3">
                            <div className="p-2 rounded-lg bg-primary/10 text-primary mt-0.5">
                                <Clock className="w-5 h-5" />
                            </div>
                            <div>
                                <CardTitle className="text-base flex items-center gap-2">
                                    🕒 Horário de Funcionamento & Ausência Automática
                                    {awayEnabled ? (
                                        <Badge className="bg-emerald-600 text-white text-[10px]">Ativo</Badge>
                                    ) : (
                                        <Badge variant="outline" className="text-[10px]">Desativado</Badge>
                                    )}
                                </CardTitle>
                                <CardDescription className="text-xs mt-0.5">
                                    Responde automaticamente no privado quando alguém envia mensagem fora do horário comercial (nunca dispara em grupos).
                                </CardDescription>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <Label htmlFor="away-switch" className="text-xs font-medium cursor-pointer">
                                {awayEnabled ? "Ativado" : "Desativado"}
                            </Label>
                            <Switch
                                id="away-switch"
                                checked={awayEnabled}
                                onCheckedChange={setAwayEnabled}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="pt-4 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Início do expediente</Label>
                            <Input
                                type="time"
                                value={startTime}
                                onChange={(e) => setStartTime(e.target.value)}
                                className="h-9"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Fim do expediente</Label>
                            <Input
                                type="time"
                                value={endTime}
                                onChange={(e) => setEndTime(e.target.value)}
                                className="h-9"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Intervalo mínimo por contato</Label>
                            <Select value={cooldownMinutes} onValueChange={setCooldownMinutes}>
                                <SelectTrigger className="h-9">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="60">A cada 1 hora</SelectItem>
                                    <SelectItem value="120">A cada 2 horas (Recomendado)</SelectItem>
                                    <SelectItem value="360">A cada 6 horas</SelectItem>
                                    <SelectItem value="720">1 vez a cada 12 horas</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs">Dias de atendimento normal</Label>
                        <div className="flex flex-wrap gap-1.5">
                            {WEEK_DAYS.map((d) => {
                                const active = workDays.includes(d.day);
                                return (
                                    <button
                                        key={d.day}
                                        type="button"
                                        onClick={() => toggleWorkDay(d.day)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                            active
                                                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                                : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
                                        }`}
                                    >
                                        {d.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <Label className="text-xs">Mensagem de ausência (fora do expediente)</Label>
                            <span className="text-[11px] text-muted-foreground">
                                Variáveis: <code className="bg-muted px-1 rounded">{"{saudacao}"}</code>, <code className="bg-muted px-1 rounded">{"{primeiro_nome}"}</code>
                            </span>
                        </div>
                        <Textarea
                            value={awayMessage}
                            onChange={(e) => setAwayMessage(e.target.value)}
                            className="min-h-[80px] text-sm"
                            placeholder="Digite a mensagem que será enviada fora do horário comercial..."
                        />
                    </div>

                    <div className="flex justify-end">
                        <Button onClick={handleSaveAwaySchedule} disabled={savingAway} size="sm" className="gap-1.5">
                            {savingAway ? (
                                <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    Salvando...
                                </>
                            ) : (
                                <>
                                    <Save className="w-3.5 h-3.5" />
                                    Salvar Horário de Atendimento
                                </>
                            )}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {loading ? (
                <div className="flex items-center justify-center p-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : rules.length === 0 ? (
                <Card className="border-dashed shadow-none bg-muted/30">
                    <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                        <BotMessageSquare className="w-12 h-12 text-muted-foreground/50 mb-4" />
                        <h3 className="text-lg font-semibold">Nenhuma regra por palavra-chave configurada</h3>
                        <p className="text-muted-foreground mb-4">Crie regras para responder automaticamente a palavras específicas.</p>
                        <Button variant="outline" onClick={() => setIsCreateOpen(true)}>Criar regra por palavra-chave</Button>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {rules.map((rule) => (
                        <Card key={rule.id} className="flex flex-col h-full hover:shadow-md transition-shadow">
                            <CardHeader className="pb-3 border-b">
                                <div className="flex justify-between items-start">
                                    <div className="space-y-1 pr-2">
                                        <CardTitle className="text-lg flex items-center gap-2">
                                            <span className="font-mono bg-muted px-2 py-0.5 rounded text-sm break-all">{rule.keyword}</span>
                                        </CardTitle>
                                        <div className="flex gap-2 flex-wrap text-xs">
                                            <Badge variant="outline" className="text-muted-foreground font-normal shrink-0">{rule.matchType}</Badge>
                                            <Badge variant="secondary" className="font-normal shrink-0 text-[10px]">{rule.triggerType}</Badge>
                                        </div>
                                    </div>
                                    <div className="shrink-0 flex gap-1">
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-muted" onClick={() => handleEdit(rule)}>
                                            <Pencil className="w-4 h-4" />
                                        </Button>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10">
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                     <AlertDialogTitle>Excluir regra?</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                         Tem certeza de que deseja excluir a resposta automática para a palavra-chave <strong>{rule.keyword}</strong>? Esta ação não pode ser desfeita.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                     <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleDelete(rule.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                                         Excluir
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-4 flex-grow flex flex-col">
                                <div className="text-sm text-foreground bg-muted/30 p-3 rounded-md border whitespace-pre-wrap flex-grow">
                                    {rule.response}
                                </div>
                                {rule.isMedia && (
                                    <div className="mt-3 text-xs flex items-center gap-1 text-blue-600 bg-blue-50 px-2 py-1 rounded w-fit">
                                         <ImageIcon className="w-3 h-3" /> Inclui anexo de mídia
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Edit Auto-Reply Dialog Modal */}
            <Dialog open={isEditOpen} onOpenChange={(open) => {
                setIsEditOpen(open);
                if (!open) setEditId(null);
            }}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                         <DialogTitle>Editar regra de resposta automática</DialogTitle>
                         <DialogDescription>Altere a regra de resposta por palavra-chave.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                 <Label>Palavra-chave</Label>
                                <Input 
                                    value={editKeyword} 
                                    onChange={(e) => setEditKeyword(e.target.value)} 
                                    placeholder="e.g. !help, ping" 
                                />
                            </div>
                            <div className="space-y-2">
                                 <Label>Tipo de correspondência</Label>
                                <Select value={editMatchType} onValueChange={setEditMatchType}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                         <SelectItem value="EXACT">Correspondência exata</SelectItem>
                                         <SelectItem value="CONTAINS">Contém</SelectItem>
                                         <SelectItem value="STARTS_WITH">Começa com</SelectItem>
                                         <SelectItem value="REGEX">Expressão regular</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                             <Label>Onde a regra será aplicada</Label>
                            <Select value={editTriggerType} onValueChange={setEditTriggerType}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                     <SelectItem value="ALL">Conversas privadas e grupos</SelectItem>
                                     <SelectItem value="PRIVATE">Somente conversas privadas</SelectItem>
                                     <SelectItem value="GROUP">Somente grupos</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                             <Label>Mensagem de resposta (opcional)</Label>
                            <Textarea 
                                value={editResponse} 
                                onChange={(e) => setEditResponse(e.target.value)} 
                                placeholder="Texto da resposta..." 
                                className="min-h-[120px]"
                            />
                             <p className="text-xs text-muted-foreground">Você pode usar a formatação padrão do WhatsApp (*negrito*, _itálico_, ~tachado~).</p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>URL da mídia (opcional)</Label>
                                <Input 
                                    value={editMediaUrl} 
                                    onChange={(e) => setEditMediaUrl(e.target.value)} 
                                    placeholder="https://example.com/image.jpg" 
                                />
                            </div>
                            <div className="space-y-2">
                                    <Label>Tipo de mídia</Label>
                                <Select value={editMediaType} onValueChange={setEditMediaType}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                         <SelectItem value="image">Imagem</SelectItem>
                                         <SelectItem value="video">Vídeo</SelectItem>
                                         <SelectItem value="document">Documento</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                         <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancelar</Button>
                        <Button onClick={handleUpdate} disabled={submitting || !editKeyword.trim() || (!editResponse.trim() && !editMediaUrl.trim())}>
                             {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "Salvar alterações"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
        </SessionGuard>
    );
}
