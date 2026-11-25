"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
    GitBranch,
    Plus,
    Trash2,
    Save,
    Sparkles,
    MessageSquare,
    ListOrdered,
    UserCheck,
    HelpCircle,
    Loader2,
} from "lucide-react";
import {
    CHATBOT_FLOW_KEYWORD,
    DEFAULT_RECEPTION_FLOW,
    type ChatbotFlowConfig,
    type FlowStep,
    type FlowStepType,
} from "@/lib/chatbot-flow";
import { createAutoReply, updateAutoReply } from "@/app/dashboard/autoreply/actions";

interface Props {
    sessionId: string;
    existingRule: { id: string; response: string } | null;
    onSaved: () => void;
}

const STEP_TYPE_META: Record<FlowStepType, { label: string; color: string; icon: typeof MessageSquare }> = {
    collect_input: { label: "Perguntar e Salvar Resposta", color: "bg-blue-500/10 text-blue-600 border-blue-500/30", icon: HelpCircle },
    menu: { label: "Menu de Opções", color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30", icon: ListOrdered },
    message: { label: "Enviar Mensagem", color: "bg-slate-500/10 text-slate-600 border-slate-500/30", icon: MessageSquare },
    handoff: { label: "Transferir p/ Atendente", color: "bg-amber-500/10 text-amber-600 border-amber-500/30", icon: UserCheck },
};

export function ChatbotFlowBuilder({ sessionId, existingRule, onSaved }: Props) {
    const [flow, setFlow] = useState<ChatbotFlowConfig>(() => ({
        ...DEFAULT_RECEPTION_FLOW,
        enabled: false,
    }));
    const [saving, setSaving] = useState(false);
    const [kanbanLabels, setKanbanLabels] = useState<Array<{ id: string; name: string; colorHex: string }>>([]);

    useEffect(() => {
        if (!sessionId) return;
        fetch(`/api/labels/${sessionId}`)
            .then(r => (r.ok ? r.json() : null))
            .then(json => {
                if (Array.isArray(json?.data)) setKanbanLabels(json.data);
            })
            .catch(() => {});
    }, [sessionId]);

    useEffect(() => {
        if (existingRule?.response) {
            try {
                const parsed = JSON.parse(existingRule.response);
                if (parsed && Array.isArray(parsed.steps)) {
                    setFlow(parsed);
                    return;
                }
            } catch {}
        }
        setFlow({ ...DEFAULT_RECEPTION_FLOW, enabled: false });
    }, [existingRule?.id, existingRule?.response]);

    const handleSave = async () => {
        if (!sessionId) return;
        setSaving(true);
        try {
            const payload = JSON.stringify(flow);
            if (existingRule?.id) {
                await updateAutoReply(sessionId, existingRule.id, {
                    keyword: CHATBOT_FLOW_KEYWORD,
                    matchType: "EXACT",
                    response: payload,
                    isMedia: false,
                    mediaUrl: null,
                    mediaType: null,
                    triggerType: "PRIVATE",
                });
            } else {
                await createAutoReply(sessionId, {
                    keyword: CHATBOT_FLOW_KEYWORD,
                    matchType: "EXACT",
                    response: payload,
                    isMedia: false,
                    mediaUrl: null,
                    mediaType: null,
                    triggerType: "PRIVATE",
                });
            }
            toast.success("Fluxo do Chatbot salvo com sucesso!");
            onSaved();
        } catch (err) {
            console.error(err);
            toast.error("Erro ao salvar fluxo do chatbot");
        } finally {
            setSaving(false);
        }
    };

    const handleLoadTemplate = () => {
        setFlow({ ...DEFAULT_RECEPTION_FLOW, enabled: true });
        toast.success("Modelo de Recepção (estilo do vídeo) carregado! Clique em 'Salvar Fluxo' para ativar.");
    };

    const updateStep = (idx: number, patch: Partial<FlowStep>) => {
        setFlow(prev => {
            const steps = [...prev.steps];
            steps[idx] = { ...steps[idx], ...patch };
            return { ...prev, steps };
        });
    };

    const addStep = () => {
        const newId = `step_${Date.now().toString(36)}`;
        const newStep: FlowStep = {
            id: newId,
            title: `Etapa ${flow.steps.length + 1}`,
            type: "message",
            messages: ["Nova mensagem..."],
            nextStepId: "",
        };
        setFlow(prev => ({ ...prev, steps: [...prev.steps, newStep] }));
    };

    const removeStep = (idx: number) => {
        setFlow(prev => {
            const steps = prev.steps.filter((_, i) => i !== idx);
            const startStepId = steps.some(s => s.id === prev.startStepId) ? prev.startStepId : (steps[0]?.id || "");
            return { ...prev, steps, startStepId };
        });
    };

    return (
        <div className="space-y-5">
            <Card className="border-primary/20">
                <CardHeader className="pb-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-1">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <GitBranch className="h-5 w-5 text-[#00a884]" />
                                Construtor de Fluxo do Chatbot (Atendimento em Etapas)
                            </CardTitle>
                            <CardDescription className="text-xs">
                                Monte conversas guiadas por etapas: pergunte o nome, envie menus (&quot;Escolher Opções&quot;) e encaminhe para um atendente humano.
                            </CardDescription>
                        </div>
                        <div className="flex flex-wrap items-center gap-2.5">
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border bg-muted/40">
                                <Switch
                                    id="flow-enabled-switch"
                                    checked={flow.enabled}
                                    onCheckedChange={(c) => setFlow(prev => ({ ...prev, enabled: c }))}
                                />
                                <Label htmlFor="flow-enabled-switch" className="text-xs font-semibold cursor-pointer">
                                    {flow.enabled ? "Fluxo Ativo" : "Fluxo Desativado"}
                                </Label>
                            </div>
                            <Button type="button" variant="outline" size="sm" onClick={handleLoadTemplate} className="text-xs">
                                <Sparkles className="h-3.5 w-3.5 mr-1.5 text-amber-500" />
                                Carregar Modelo do Vídeo
                            </Button>
                            <Button type="button" size="sm" onClick={handleSave} disabled={saving} className="bg-[#00a884] hover:bg-[#00a884]/90 text-white text-xs">
                                {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                                Salvar Fluxo
                            </Button>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-0 border-t border-border/40 mt-2 pt-4">
                    <div className="space-y-1">
                        <Label className="text-xs">Quando iniciar o fluxo?</Label>
                        <Select
                            value={flow.triggerMode}
                            onValueChange={(v: any) => setFlow(prev => ({ ...prev, triggerMode: v }))}
                        >
                            <SelectTrigger className="h-9 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALWAYS_WHEN_IDLE">Qualquer mensagem inicial</SelectItem>
                                <SelectItem value="KEYWORD">Por palavras-chave</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1">
                        <Label className="text-xs">Estilo dos Menus</Label>
                        <Select
                            value={flow.menuStyle}
                            onValueChange={(v: any) => setFlow(prev => ({ ...prev, menuStyle: v }))}
                        >
                            <SelectTrigger className="h-9 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="list">Lista Interativa (Escolher Opções)</SelectItem>
                                <SelectItem value="numbered">Menu Numérico (1, 2, 3...)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1">
                        <Label className="text-xs">Etapa Inicial</Label>
                        <Select
                            value={flow.startStepId}
                            onValueChange={(v) => setFlow(prev => ({ ...prev, startStepId: v }))}
                        >
                            <SelectTrigger className="h-9 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {flow.steps.map(s => (
                                    <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1">
                        <Label className="text-xs">Cooldown por cliente (horas)</Label>
                        <Input
                            type="number"
                            min={0}
                            max={720}
                            className="h-9 text-xs"
                            value={flow.cooldownHours}
                            onChange={(e) => setFlow(prev => ({ ...prev, cooldownHours: Number(e.target.value) || 0 }))}
                        />
                    </div>

                    {flow.triggerMode === "KEYWORD" && (
                        <div className="sm:col-span-2 lg:col-span-4 space-y-1">
                            <Label className="text-xs">Palavras-chave para iniciar (separadas por vírgula)</Label>
                            <Input
                                className="h-9 text-xs"
                                placeholder="oi, olá, bom dia, boa tarde, menu"
                                value={flow.triggerKeywords.join(", ")}
                                onChange={(e) =>
                                    setFlow(prev => ({
                                        ...prev,
                                        triggerKeywords: e.target.value.split(",").map(s => s.trim()).filter(Boolean),
                                    }))
                                }
                            />
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Step Cards */}
            <div className="space-y-4">
                {flow.steps.map((step, idx) => {
                    const meta = STEP_TYPE_META[step.type] || {
                        label: "Outro",
                        color: "bg-slate-500/10 text-slate-600 border-slate-500/30",
                        icon: MessageSquare,
                    };
                    const Icon = meta.icon;
                    return (
                        <Card key={step.id} className="border-border/60">
                            <CardHeader className="py-3 px-4 bg-muted/20 border-b border-border/40">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                                        <Badge variant="outline" className={`text-[11px] gap-1 ${meta.color}`}>
                                            <Icon className="h-3 w-3" />
                                            {meta.label}
                                        </Badge>
                                        <Input
                                            value={step.title}
                                            onChange={(e) => updateStep(idx, { title: e.target.value })}
                                            className="h-8 text-xs font-semibold max-w-xs"
                                        />
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <Select
                                            value={step.type}
                                            onValueChange={(v: FlowStepType) => updateStep(idx, {
                                                type: v,
                                                options: v === "menu" && !step.options?.length
                                                    ? [{ id: `opt_${Date.now()}`, title: "Opção 1", description: "", nextStepId: "" }]
                                                    : step.options,
                                            })}
                                        >
                                            <SelectTrigger className="h-8 text-xs w-[190px]">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="collect_input">Perguntar e Salvar Resposta</SelectItem>
                                                <SelectItem value="menu">Menu de Opções</SelectItem>
                                                <SelectItem value="message">Enviar Mensagem</SelectItem>
                                                <SelectItem value="handoff">Transferir p/ Atendente</SelectItem>
                                            </SelectContent>
                                        </Select>

                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => removeStep(idx)}
                                            className="h-8 w-8 text-destructive hover:bg-destructive/10"
                                            title="Remover etapa"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            </CardHeader>

                            <CardContent className="p-4 space-y-3">
                                {/* Messages */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-xs font-medium">
                                            Mensagens enviadas nesta etapa (variáveis: <code>{`{saudacao}`}</code>, <code>{`{empresa}`}</code>, <code>{`{nome_cliente}`}</code>, <code>{`{setor}`}</code>)
                                        </Label>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-7 text-[11px]"
                                            onClick={() => updateStep(idx, { messages: [...(step.messages || []), ""] })}
                                        >
                                            <Plus className="h-3 w-3 mr-1" />
                                            Adicionar balão
                                        </Button>
                                    </div>

                                    {(step.messages || [""]).map((mText, mIdx) => (
                                        <div key={mIdx} className="flex gap-2 items-start">
                                            <Textarea
                                                rows={2}
                                                className="text-xs"
                                                value={mText}
                                                onChange={(e) => {
                                                    const nextMsgs = [...(step.messages || [])];
                                                    nextMsgs[mIdx] = e.target.value;
                                                    updateStep(idx, { messages: nextMsgs });
                                                }}
                                            />
                                            {(step.messages?.length || 0) > 1 && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                                                    onClick={() => {
                                                        const nextMsgs = (step.messages || []).filter((_, i) => i !== mIdx);
                                                        updateStep(idx, { messages: nextMsgs });
                                                    }}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {/* Collect input / Message config */}
                                {(step.type === "collect_input" || step.type === "message") && (
                                    <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-border/30">
                                        {step.type === "collect_input" && (
                                            <div className="space-y-1">
                                                <Label className="text-xs">Salvar resposta na variável</Label>
                                                <Input
                                                    className="h-8 text-xs font-mono"
                                                    placeholder="nome_cliente"
                                                    value={step.saveToVar || ""}
                                                    onChange={(e) => updateStep(idx, { saveToVar: e.target.value.replace(/\s+/g, "_") })}
                                                />
                                            </div>
                                        )}
                                        <div className="space-y-1">
                                            <Label className="text-xs">Ir para próxima etapa</Label>
                                            <Select
                                                value={step.nextStepId || "__END__"}
                                                onValueChange={(v) => updateStep(idx, { nextStepId: v === "__END__" ? "" : v })}
                                            >
                                                <SelectTrigger className="h-8 text-xs">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__END__">(Encerrar fluxo)</SelectItem>
                                                    {flow.steps.filter(s => s.id !== step.id).map(s => (
                                                        <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                )}

                                {/* Menu Options */}
                                {step.type === "menu" && (
                                    <div className="space-y-2.5 pt-2 border-t border-border/30">
                                        <div className="grid sm:grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <Label className="text-xs">Texto do botão da lista</Label>
                                                <Input
                                                    className="h-8 text-xs"
                                                    value={step.menuButtonText || "Escolher Opções"}
                                                    onChange={(e) => updateStep(idx, { menuButtonText: e.target.value })}
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">Salvar escolha na variável (opcional)</Label>
                                                <Input
                                                    className="h-8 text-xs font-mono"
                                                    placeholder="setor"
                                                    value={step.saveToVar || ""}
                                                    onChange={(e) => updateStep(idx, { saveToVar: e.target.value.replace(/\s+/g, "_") })}
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-xs font-semibold">Opções do Menu</Label>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-7 text-[11px]"
                                                    onClick={() => updateStep(idx, {
                                                        options: [
                                                            ...(step.options || []),
                                                            { id: `opt_${Date.now().toString(36)}`, title: "Nova Opção", description: "", nextStepId: "" },
                                                        ],
                                                    })}
                                                >
                                                    <Plus className="h-3 w-3 mr-1" />
                                                    Nova Opção
                                                </Button>
                                            </div>

                                            {(step.options || []).map((opt, oIdx) => (
                                                <div key={opt.id} className={`flex flex-col sm:flex-row gap-2 items-stretch sm:items-center p-2 rounded-lg border transition-all ${opt.enabled === false ? 'bg-amber-500/5 border-amber-500/30 opacity-70' : 'bg-muted/20 border-border/30'}`}>
                                                    <div className="flex items-center gap-1.5 shrink-0 bg-background/80 px-2 py-1 rounded-md border border-border/40 shadow-sm" title={opt.enabled === false ? "Opção desativada / Atendente de Folga (não aparece no WhatsApp)" : "Opção ativa (visível no WhatsApp)"}>
                                                        <Switch
                                                            checked={opt.enabled !== false}
                                                            onCheckedChange={(checked) => {
                                                                const opts = [...(step.options || [])];
                                                                opts[oIdx] = { ...opts[oIdx], enabled: checked };
                                                                updateStep(idx, { options: opts });
                                                            }}
                                                        />
                                                        <span className={`text-[11px] font-semibold w-12 select-none ${opt.enabled === false ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                                            {opt.enabled === false ? "Folga" : "Ativo"}
                                                        </span>
                                                    </div>
                                                    <Input
                                                        className="flex-1 min-w-0 h-8 text-xs font-medium"
                                                        placeholder="Título da opção (máx 24 chars)"
                                                        value={opt.title}
                                                        onChange={(e) => {
                                                            const opts = [...(step.options || [])];
                                                            opts[oIdx] = { ...opts[oIdx], title: e.target.value };
                                                            updateStep(idx, { options: opts });
                                                        }}
                                                    />
                                                    <Input
                                                        className="flex-1 min-w-0 h-8 text-xs"
                                                        placeholder="Descrição curta (opcional)"
                                                        value={opt.description || ""}
                                                        onChange={(e) => {
                                                            const opts = [...(step.options || [])];
                                                            opts[oIdx] = { ...opts[oIdx], description: e.target.value };
                                                            updateStep(idx, { options: opts });
                                                        }}
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <Select
                                                            value={opt.nextStepId || "__END__"}
                                                            onValueChange={(v) => {
                                                                const opts = [...(step.options || [])];
                                                                opts[oIdx] = { ...opts[oIdx], nextStepId: v === "__END__" ? "" : v };
                                                                updateStep(idx, { options: opts });
                                                            }}
                                                        >
                                                            <SelectTrigger className="h-8 text-xs w-full overflow-hidden">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="__END__">(Encerrar)</SelectItem>
                                                                {flow.steps.filter(s => s.id !== step.id).map(s => (
                                                                    <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10 self-end sm:self-center"
                                                        onClick={() => {
                                                            const opts = (step.options || []).filter((_, i) => i !== oIdx);
                                                            updateStep(idx, { options: opts });
                                                        }}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Handoff config */}
                                {step.type === "handoff" && (
                                    <div className="pt-2 border-t border-border/30 flex items-center gap-3">
                                        <Label className="text-xs">Pausar robô após transferir (minutos):</Label>
                                        <Input
                                            type="number"
                                            min={5}
                                            max={1440}
                                            className="h-8 text-xs w-24"
                                            value={step.handoffPauseMinutes || 60}
                                            onChange={(e) => updateStep(idx, { handoffPauseMinutes: Number(e.target.value) || 60 })}
                                        />
                                    </div>
                                )}

                                {/* Optional Kanban CRM Stage Move */}
                                {kanbanLabels.length > 0 && (
                                    <div className="pt-2 border-t border-border/30 flex flex-wrap items-center gap-3">
                                        <Label className="text-xs text-muted-foreground">Mover no Kanban CRM ao entrar nesta etapa:</Label>
                                        <Select
                                            value={step.kanbanLabelName || "__NONE__"}
                                            onValueChange={(v) => updateStep(idx, { kanbanLabelName: v === "__NONE__" ? undefined : v })}
                                        >
                                            <SelectTrigger className="h-8 text-xs w-[240px]">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="__NONE__">(Não mover no Kanban)</SelectItem>
                                                {kanbanLabels.map(lbl => (
                                                    <SelectItem key={lbl.id} value={lbl.name}>{lbl.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}

                <Button type="button" variant="outline" onClick={addStep} className="w-full border-dashed h-10 text-xs">
                    <Plus className="h-4 w-4 mr-1.5" />
                    Adicionar Nova Etapa ao Fluxo
                </Button>
            </div>
        </div>
    );
}
