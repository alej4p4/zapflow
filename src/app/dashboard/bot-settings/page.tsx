"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useSession as useSessionProvider } from "@/components/dashboard/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    RefreshCw,
    Save,
    AlertCircle,
    Bot,
    X,
    Plus,
    ShieldCheck,
    Zap,
    UserCheck,
    MessageSquarePlus,
    Building2,
    Sparkles,
    ShieldAlert,
    Smile,
    Lock,
    Eye,
    Check,
    CheckCheck,
    Smartphone,
    Info,
    Clock,
    Send,
    Flame,
    RotateCcw
} from "lucide-react";
import { toast } from "sonner";
import { SessionGuard } from "@/components/dashboard/session-guard";

// ─── Ready-made Presets ──────────────────────────────────────────
interface PresetProfile {
    id: string;
    title: string;
    badge: string;
    badgeColor: string;
    description: string;
    icon: typeof Building2;
    recommendedFor: string;
    config: {
        botName: string;
        prefix: string;
        enableSticker: boolean;
        enableVideoSticker: boolean;
        enablePing: boolean;
        enableUptime: boolean;
        botMode: "ALL" | "OWNER" | "SPECIFIC" | "BLACKLIST";
        autoReplyMode: "ALL" | "OWNER" | "SPECIFIC" | "BLACKLIST";
        antiSpamEnabled: boolean;
        spamLimit: number;
        spamInterval: number;
        spamDelayMin: number;
        spamDelayMax: number;
        welcomeMessage: string;
        autoRead: boolean;
        alwaysOnline: boolean;
    };
    privacy: {
        ghostMode: boolean;
        antiDelete: boolean;
        readReceipts: boolean;
    };
}

const PRESET_PROFILES: PresetProfile[] = [
    {
        id: "comercial",
        title: "Atendimento Comercial (SAC)",
        badge: "Recomendado",
        badgeColor: "bg-[#00a884] text-white",
        description: "Foco total em atendimento profissional, SAC e CRM. Evita brincadeiras e garante proteção anti-spam para não ter o número bloqueado.",
        icon: Building2,
        recommendedFor: "Lojas, empresas, escritórios e equipes de vendas.",
        config: {
            botName: "BarraSoftware Atendimento",
            prefix: "#",
            enableSticker: false,
            enableVideoSticker: false,
            enablePing: false,
            enableUptime: false,
            botMode: "OWNER",
            autoReplyMode: "ALL",
            antiSpamEnabled: true,
            spamLimit: 5,
            spamInterval: 10,
            spamDelayMin: 1500,
            spamDelayMax: 3500,
            welcomeMessage: "Olá {nome}! 👋 Boas-vindas ao nosso canal de atendimento oficial da {empresa}.\n\nComo podemos te ajudar hoje? Em instantes um de nossos operadores irá te atender.",
            autoRead: true,
            alwaysOnline: false,
        },
        privacy: {
            ghostMode: false,
            antiDelete: true,
            readReceipts: true,
        }
    },
    {
        id: "autoatendimento",
        title: "Autoatendimento 24h",
        badge: "Robô Ativo",
        badgeColor: "bg-blue-600 text-white",
        description: "Mantém a sessão sempre online com menu numérico de opções (1 a 4) e leitura imediata das mensagens para resposta instantânea.",
        icon: Bot,
        recommendedFor: "Triagem de clientes, suporte nível 1 e consultas automáticas.",
        config: {
            botName: "BarraSoftware Bot 24h",
            prefix: "#",
            enableSticker: false,
            enableVideoSticker: false,
            enablePing: true,
            enableUptime: true,
            botMode: "ALL",
            autoReplyMode: "ALL",
            antiSpamEnabled: true,
            spamLimit: 8,
            spamInterval: 10,
            spamDelayMin: 800,
            spamDelayMax: 2000,
            welcomeMessage: "Olá {nome}! 👋 Bem-vindo(a) à {empresa}.\n\nPor favor, digite o número da opção desejada:\n\n1️⃣ - Conhecer planos e produtos\n2️⃣ - Suporte e atendimento técnico\n3️⃣ - Financeiro (2ª via de boleto / chave PIX)\n4️⃣ - Falar com atendente humano",
            autoRead: true,
            alwaysOnline: true,
        },
        privacy: {
            ghostMode: false,
            antiDelete: true,
            readReceipts: true,
        }
    },
    {
        id: "antiban",
        title: "Proteção Máxima Anti-Ban",
        badge: "Ultra Seguro",
        badgeColor: "bg-emerald-600 text-white",
        description: "Atrasos reforçados entre mensagens (3s a 7s), modo silencioso e lote reduzido. A melhor escolha para quem realiza disparos ou campanhas em massa.",
        icon: ShieldCheck,
        recommendedFor: "Campanhas de marketing, disparos em massa e prospecção ativa.",
        config: {
            botName: "BarraSoftware CRM Seguro",
            prefix: "#",
            enableSticker: false,
            enableVideoSticker: false,
            enablePing: false,
            enableUptime: false,
            botMode: "OWNER",
            autoReplyMode: "ALL",
            antiSpamEnabled: true,
            spamLimit: 3,
            spamInterval: 15,
            spamDelayMin: 3000,
            spamDelayMax: 7000,
            welcomeMessage: "Olá! Recebemos sua mensagem e entraremos em contato em breve.",
            autoRead: false,
            alwaysOnline: false,
        },
        privacy: {
            ghostMode: true,
            antiDelete: true,
            readReceipts: false,
        }
    },
    {
        id: "interativo",
        title: "Completo & Figurinhas",
        badge: "Interativo",
        badgeColor: "bg-purple-600 text-white",
        description: "Habilita conversão automática de fotos e vídeos curtos em figurinhas, comandos #ping e #uptime para grupos de amigos e comunidades.",
        icon: Sparkles,
        recommendedFor: "Grupos do WhatsApp, comunidades e entretenimento.",
        config: {
            botName: "BarraSoftware Figurinhas",
            prefix: "#",
            enableSticker: true,
            enableVideoSticker: true,
            enablePing: true,
            enableUptime: true,
            botMode: "ALL",
            autoReplyMode: "ALL",
            antiSpamEnabled: false,
            spamLimit: 10,
            spamInterval: 10,
            spamDelayMin: 500,
            spamDelayMax: 1500,
            welcomeMessage: "Olá! 🎨 Envie uma imagem ou vídeo curto de até 10s para receber sua figurinha do WhatsApp!",
            autoRead: true,
            alwaysOnline: true,
        },
        privacy: {
            ghostMode: false,
            antiDelete: true,
            readReceipts: true,
        }
    }
];

// ─── Welcome Message Ready-to-Use Templates ───────────────────────
const WELCOME_TEMPLATES = [
    {
        label: "🏢 Atendimento Geral",
        text: "Olá {nome}! 👋 Boas-vindas ao nosso canal oficial de atendimento da {empresa}.\n\nEm instantes um de nossos operadores irá te atender. Como podemos te ajudar hoje?"
    },
    {
        label: "🤖 Menu 1 a 4",
        text: "Olá {nome}! 👋 Bem-vindo(a) à {empresa}.\n\nDigite o número da opção desejada:\n\n1️⃣ - Conhecer planos e produtos\n2️⃣ - Suporte e atendimento técnico\n3️⃣ - Financeiro (2ª via de boleto / PIX)\n4️⃣ - Falar com atendente humano"
    },
    {
        label: "🛒 Vendas & Catálogo",
        text: "Olá {nome}! 🛍️ Seja bem-vindo(a) ao setor de vendas da {empresa}!\n\nPara agilizar seu orçamento, por favor nos informe qual produto ou serviço tem interesse e sua cidade!"
    },
    {
        label: "🛠️ Suporte Técnico",
        text: "Olá {nome}! 🛠️ Canal de Suporte Técnico da {empresa}.\n\nPor favor, descreva em poucas palavras o que está acontecendo e, se possível, envie uma foto ou print da tela para agilizarmos a solução!"
    },
    {
        label: "🌙 Fora do Horário",
        text: "{saudacao}, {nome}! Nosso horário de atendimento é de Segunda a Sexta, das 08h às 18h.\n\nSua mensagem já foi registrada e responderemos com prioridade assim que iniciarmos o expediente!"
    }
];

export default function BotSettingsPage() {
    const { sessionId } = useSessionProvider();

    const [botConfig, setBotConfig] = useState({
        botName: "BarraSoftware Bot",
        prefix: "#",
        enableSticker: true,
        enableVideoSticker: true,
        maxStickerDuration: 10,
        enablePing: true,
        enableUptime: true,
        removeBgApiKey: "",
        botMode: "OWNER" as "ALL" | "OWNER" | "SPECIFIC" | "BLACKLIST",
        autoReplyMode: "ALL" as "ALL" | "OWNER" | "SPECIFIC" | "BLACKLIST",
        antiSpamEnabled: true,
        spamLimit: 5,
        spamInterval: 10,
        spamDelayMin: 1500,
        spamDelayMax: 3500,

        // Welcome & Presence
        welcomeMessage: "",
        autoRead: true,
        alwaysOnline: false,
        botAllowedJids: [] as string[],
        botBlockedJids: [] as string[],
        autoReplyAllowedJids: [] as string[],
        autoReplyBlockedJids: [] as string[],
    });

    const [privacyConfig, setPrivacyConfig] = useState({
        ghostMode: false,
        antiDelete: true,
        readReceipts: true,
    });

    const [loadingInitial, setLoadingInitial] = useState(true);
    const [saving, setSaving] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [activeTab, setActiveTab] = useState("presets");
    const [newJid, setNewJid] = useState("");

    // Original state for dirty tracking / restore
    const originalConfigRef = useRef<{ bot: any; privacy: any } | null>(null);

    useEffect(() => {
        if (!sessionId) return;
        setLoadingInitial(true);

        Promise.all([
            fetch(`/api/sessions/${sessionId}/bot-config`).then(r => r.ok ? r.json() : null),
            fetch(`/api/sessions/${sessionId}/settings`).then(r => r.ok ? r.json() : null)
        ]).then(([botRes, privRes]) => {
            const bData = botRes?.data;
            const pData = privRes?.data?.config;

            const loadedBot = {
                botName: bData?.botName || "BarraSoftware Bot",
                prefix: bData?.prefix || "#",
                enableSticker: bData?.enableSticker ?? true,
                enableVideoSticker: bData?.enableVideoSticker ?? true,
                maxStickerDuration: bData?.maxStickerDuration || 10,
                enablePing: bData?.enablePing ?? true,
                enableUptime: bData?.enableUptime ?? true,
                removeBgApiKey: bData?.removeBgApiKey || "",
                botMode: bData?.botMode || "OWNER",
                autoReplyMode: bData?.autoReplyMode || "ALL",
                antiSpamEnabled: bData?.antiSpamEnabled ?? true,
                spamLimit: bData?.spamLimit || 5,
                spamInterval: bData?.spamInterval || 10,
                spamDelayMin: bData?.spamDelayMin || 1500,
                spamDelayMax: bData?.spamDelayMax || 3500,
                welcomeMessage: bData?.welcomeMessage || "",
                autoRead: bData?.autoRead ?? true,
                alwaysOnline: bData?.alwaysOnline ?? false,
                botAllowedJids: bData?.botAllowedJids || [],
                botBlockedJids: bData?.botBlockedJids || [],
                autoReplyAllowedJids: bData?.autoReplyAllowedJids || [],
                autoReplyBlockedJids: bData?.autoReplyBlockedJids || [],
            };

            const loadedPrivacy = {
                ghostMode: pData?.ghostMode || false,
                antiDelete: pData?.antiDelete ?? true,
                readReceipts: pData?.readReceipts ?? true
            };

            setBotConfig(loadedBot);
            setPrivacyConfig(loadedPrivacy);
            originalConfigRef.current = { bot: loadedBot, privacy: loadedPrivacy };
            setHasUnsavedChanges(false);
        }).catch(err => {
            console.error(err);
            toast.error("Erro ao carregar configurações");
        }).finally(() => {
            setLoadingInitial(false);
        });
    }, [sessionId]);

    // Unified Save Function (Saves BotConfig + Privacy in parallel)
    const handleSaveAll = async () => {
        if (!sessionId) return;
        setSaving(true);
        try {
            const [resBot, resPrivacy] = await Promise.all([
                fetch(`/api/sessions/${sessionId}/bot-config`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(botConfig)
                }),
                fetch(`/api/sessions/${sessionId}/settings`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        config: {
                            ghostMode: privacyConfig.ghostMode,
                            antiDelete: privacyConfig.antiDelete,
                            readReceipts: privacyConfig.readReceipts
                        }
                    })
                })
            ]);

            if (resBot.ok && resPrivacy.ok) {
                toast.success("Configurações salvas e aplicadas com sucesso!");
                originalConfigRef.current = { bot: botConfig, privacy: privacyConfig };
                setHasUnsavedChanges(false);
            } else {
                toast.error("Ocorreu um erro ao salvar algumas configurações.");
            }
        } catch (e) {
            console.error(e);
            toast.error("Erro de conexão ao salvar configurações.");
        } finally {
            setSaving(false);
        }
    };

    // Apply Preset Profile
    const handleApplyPreset = (preset: PresetProfile) => {
        setBotConfig(prev => ({
            ...prev,
            ...preset.config
        }));
        setPrivacyConfig(prev => ({
            ...prev,
            ...preset.privacy
        }));
        setHasUnsavedChanges(true);
        toast.success(`Perfil "${preset.title}" carregado! Clique em "Salvar Todas as Configurações" para confirmar.`);
    };

    // Restore original settings
    const handleRestore = () => {
        if (!originalConfigRef.current) return;
        setBotConfig(originalConfigRef.current.bot);
        setPrivacyConfig(originalConfigRef.current.privacy);
        setHasUnsavedChanges(false);
        toast.info("Configurações restauradas para o estado salvo.");
    };

    // Insert Tag into Welcome Message
    const handleInsertTag = (tag: string) => {
        setBotConfig(prev => ({
            ...prev,
            welcomeMessage: (prev.welcomeMessage ? prev.welcomeMessage + " " : "") + tag
        }));
        setHasUnsavedChanges(true);
    };

    // Add phone/JID to list
    const addJid = (listName: 'botAllowedJids' | 'botBlockedJids' | 'autoReplyAllowedJids' | 'autoReplyBlockedJids') => {
        if (!newJid || !newJid.trim()) return;
        let formatted = newJid.trim().replace(/\D/g, "");
        if (formatted.length >= 10 && !formatted.startsWith("55")) {
            formatted = "55" + formatted;
        }
        const fullJid = formatted.includes("@") ? formatted : `${formatted}@s.whatsapp.net`;

        if (!botConfig[listName].includes(fullJid)) {
            setBotConfig(prev => ({
                ...prev,
                [listName]: [...prev[listName], fullJid]
            }));
            setHasUnsavedChanges(true);
        }
        setNewJid("");
    };

    const removeJid = (listName: 'botAllowedJids' | 'botBlockedJids' | 'autoReplyAllowedJids' | 'autoReplyBlockedJids', jid: string) => {
        setBotConfig(prev => ({
            ...prev,
            [listName]: prev[listName].filter(item => item !== jid)
        }));
        setHasUnsavedChanges(true);
    };

    // Real-time Preview Text for WhatsApp Simulator
    const simulatedPreviewText = useMemo(() => {
        const text = botConfig.welcomeMessage || "Olá {nome}! Boas-vindas ao nosso canal de atendimento.";
        const hour = new Date().getHours();
        const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
        return text
            .replace(/\{nome\}/gi, "Carlos")
            .replace(/\{primeiro_nome\}/gi, "Carlos")
            .replace(/\{saudacao\}/gi, greeting)
            .replace(/\{empresa\}/gi, botConfig.botName || "BarraSoftware");
    }, [botConfig.welcomeMessage, botConfig.botName]);

    // Anti-Spam Safety Level Gauge
    const antiSpamSafety = useMemo(() => {
        if (!botConfig.antiSpamEnabled) {
            return {
                level: "desativado",
                label: "Desativado (Risco em Disparos)",
                color: "text-amber-600 bg-amber-500/10 border-amber-500/30",
                description: "Mensagens são enviadas imediatamente sem intervalo. Recomendado apenas para poucos chats por dia."
            };
        }
        if (botConfig.spamDelayMin >= 2000 && botConfig.spamLimit <= 5) {
            return {
                level: "alto",
                label: "Segurança Alta (Ultra Seguro)",
                color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
                description: "Intervalos longos e comportamento humano. Quase zero risco de bloqueio, ideal para campanhas e SAC corporativo."
            };
        }
        if (botConfig.spamDelayMin >= 1000) {
            return {
                level: "balanceado",
                label: "Segurança Balanceada (Recomendado)",
                color: "text-blue-600 bg-blue-500/10 border-blue-500/30",
                description: "Excelente equilíbrio entre velocidade de entrega e proteção das políticas do WhatsApp."
            };
        }
        return {
            level: "acelerado",
            label: "Acelerado (Atenção)",
            color: "text-orange-600 bg-orange-500/10 border-orange-500/30",
            description: "Envios rápidos com intervalo curto. Use com cautela em números novos ou não aquecidos."
        };
    }, [botConfig.antiSpamEnabled, botConfig.spamDelayMin, botConfig.spamLimit]);

    return (
        <SessionGuard>
            <div className="space-y-6 max-w-6xl mx-auto pb-16">
                
                {/* ─── Unified Sticky Header ───────────────────────── */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#111b21] border border-border/40 shadow-xs sticky top-0 z-20 backdrop-blur-md">
                    <div>
                        <div className="flex items-center gap-2.5">
                            <div className="h-9 w-9 rounded-xl bg-[#00a884]/15 flex items-center justify-center text-[#00a884]">
                                <Bot className="h-5 w-5" />
                            </div>
                            <div>
                                <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Configurações do Bot</h1>
                                <p className="text-xs text-muted-foreground flex items-center gap-2">
                                    <span>Sessão ativa: <strong className="text-foreground">{sessionId}</strong></span>
                                    {hasUnsavedChanges && (
                                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 animate-pulse">
                                            ● Alterações pendentes não salvas
                                        </span>
                                    )}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2.5 w-full sm:w-auto">
                        {hasUnsavedChanges && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleRestore}
                                disabled={saving}
                                className="text-xs text-muted-foreground hover:text-foreground h-9"
                            >
                                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                                Desfazer
                            </Button>
                        )}
                        <Button
                            onClick={handleSaveAll}
                            disabled={saving || !sessionId || loadingInitial}
                            className="bg-[#00a884] hover:bg-[#00a884]/90 text-white font-medium shadow-sm h-9 px-4 text-xs sm:text-sm flex-1 sm:flex-none cursor-pointer"
                        >
                            {saving ? (
                                <>
                                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                    Salvando tudo...
                                </>
                            ) : (
                                <>
                                    <Save className="mr-2 h-4 w-4" />
                                    Salvar Todas as Configurações
                                </>
                            )}
                        </Button>
                    </div>
                </div>

                {/* ─── Main Tabs Navigation ────────────────────────── */}
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                    <TabsList className="grid grid-cols-2 md:grid-cols-6 h-auto p-1.5 bg-muted/60 dark:bg-[#1a2329] rounded-xl gap-1">
                        <TabsTrigger value="presets" className="text-xs py-2 data-[state=active]:bg-[#00a884] data-[state=active]:text-white">
                            ⚡ Perfis Prontos
                        </TabsTrigger>
                        <TabsTrigger value="welcome" className="text-xs py-2 data-[state=active]:bg-[#00a884] data-[state=active]:text-white">
                            💬 Boas-Vindas
                        </TabsTrigger>
                        <TabsTrigger value="antiban" className="text-xs py-2 data-[state=active]:bg-[#00a884] data-[state=active]:text-white">
                            🛡️ Proteção Anti-Ban
                        </TabsTrigger>
                        <TabsTrigger value="automation" className="text-xs py-2 data-[state=active]:bg-[#00a884] data-[state=active]:text-white">
                            ⚡ Presença & Acesso
                        </TabsTrigger>
                        <TabsTrigger value="stickers" className="text-xs py-2 data-[state=active]:bg-[#00a884] data-[state=active]:text-white">
                            🎨 Figurinhas & Mídia
                        </TabsTrigger>
                        <TabsTrigger value="privacy" className="text-xs py-2 data-[state=active]:bg-[#00a884] data-[state=active]:text-white">
                            🔒 Privacidade
                        </TabsTrigger>
                    </TabsList>

                    {/* ════ TAB 1: PRESETS ════ */}
                    <TabsContent value="presets" className="space-y-6 animate-in fade-in duration-200">
                        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 flex items-start gap-3">
                            <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                            <div className="text-xs space-y-1">
                                <p className="font-semibold text-blue-900 dark:text-blue-300">
                                    Escolha um perfil pré-configurado com 1 clique
                                </p>
                                <p className="text-muted-foreground leading-relaxed">
                                    Cada perfil ajusta automaticamente todas as opções técnicas (anti-spam, boas-vindas, sempre online e permissões) para atender ao seu objetivo com máxima estabilidade. Você pode personalizar qualquer item nas abas seguintes antes de salvar.
                                </p>
                            </div>
                        </div>

                        <div className="grid md:grid-cols-2 gap-4">
                            {PRESET_PROFILES.map((preset) => {
                                const Icon = preset.icon;
                                return (
                                    <Card key={preset.id} className="relative overflow-hidden hover:border-[#00a884]/40 transition-all hover:shadow-md flex flex-col justify-between">
                                        <CardHeader className="pb-3">
                                            <div className="flex items-center justify-between gap-2 mb-1">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                                                        <Icon className="h-4 w-4" />
                                                    </div>
                                                    <CardTitle className="text-base font-semibold">
                                                        {preset.title}
                                                    </CardTitle>
                                                </div>
                                                <Badge className={preset.badgeColor}>
                                                    {preset.badge}
                                                </Badge>
                                            </div>
                                            <CardDescription className="text-xs text-muted-foreground leading-relaxed">
                                                {preset.description}
                                            </CardDescription>
                                        </CardHeader>
                                        <CardContent className="space-y-3 pt-0">
                                            <div className="text-[11px] bg-muted/50 p-2.5 rounded-lg text-muted-foreground">
                                                <strong>Indicado para:</strong> {preset.recommendedFor}
                                            </div>
                                            <Button
                                                onClick={() => handleApplyPreset(preset)}
                                                variant="outline"
                                                size="sm"
                                                className="w-full text-xs font-medium hover:bg-[#00a884] hover:text-white hover:border-[#00a884] transition-colors cursor-pointer"
                                            >
                                                <Check className="h-3.5 w-3.5 mr-1.5 text-[#00a884] group-hover:text-white" />
                                                Aplicar este Perfil
                                            </Button>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    </TabsContent>

                    {/* ════ TAB 2: BOAS-VINDAS & IDENTIDADE ════ */}
                    <TabsContent value="welcome" className="space-y-6 animate-in fade-in duration-200">
                        <div className="grid lg:grid-cols-12 gap-6">
                            {/* Left Column: Form */}
                            <div className="lg:col-span-7 space-y-6">
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <Bot className="h-4 w-4 text-[#00a884]" />
                                            Identidade do Bot
                                        </CardTitle>
                                        <CardDescription className="text-xs">
                                            Nome público e caractere de chamada usado nos comandos.
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="grid sm:grid-cols-3 gap-3">
                                            <div className="sm:col-span-2 space-y-1.5">
                                                <Label className="text-xs font-medium">Nome do Bot</Label>
                                                <Input
                                                    placeholder="BarraSoftware Bot"
                                                    value={botConfig.botName}
                                                    onChange={e => {
                                                        setBotConfig(prev => ({ ...prev, botName: e.target.value }));
                                                        setHasUnsavedChanges(true);
                                                    }}
                                                    className="h-9 text-xs"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-xs font-medium">Prefixo</Label>
                                                <Input
                                                    placeholder="#"
                                                    maxLength={3}
                                                    value={botConfig.prefix}
                                                    onChange={e => {
                                                        setBotConfig(prev => ({ ...prev, prefix: e.target.value }));
                                                        setHasUnsavedChanges(true);
                                                    }}
                                                    className="h-9 text-xs font-mono"
                                                />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <MessageSquarePlus className="h-4 w-4 text-[#00a884]" />
                                            Mensagem de Boas-Vindas Automática
                                        </CardTitle>
                                        <CardDescription className="text-xs">
                                            Enviada no primeiro contato de um novo cliente ou conversa.
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        {/* Ready-to-use Template Chips */}
                                        <div className="space-y-1.5">
                                            <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                                                Modelos Prontos (Clique para Carregar):
                                            </Label>
                                            <div className="flex flex-wrap gap-1.5">
                                                {WELCOME_TEMPLATES.map((tmpl, idx) => (
                                                    <button
                                                        key={idx}
                                                        type="button"
                                                        onClick={() => {
                                                            setBotConfig(prev => ({ ...prev, welcomeMessage: tmpl.text }));
                                                            setHasUnsavedChanges(true);
                                                            toast.success(`Modelo "${tmpl.label}" aplicado!`);
                                                        }}
                                                        className="text-[11px] px-2.5 py-1 rounded-md bg-muted/80 hover:bg-[#00a884] hover:text-white transition-colors cursor-pointer border border-border/30"
                                                    >
                                                        {tmpl.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Textarea */}
                                        <div className="space-y-1.5">
                                            <Textarea
                                                placeholder="Digite aqui a mensagem que o cliente receberá ao iniciar uma conversa..."
                                                rows={6}
                                                value={botConfig.welcomeMessage}
                                                onChange={e => {
                                                    setBotConfig(prev => ({ ...prev, welcomeMessage: e.target.value }));
                                                    setHasUnsavedChanges(true);
                                                }}
                                                className="text-xs leading-relaxed font-sans"
                                            />
                                        </div>

                                        {/* Dynamic Tag Chips */}
                                        <div className="space-y-1.5 pt-1">
                                            <Label className="text-[11px] text-muted-foreground font-medium">
                                                Inserir variáveis dinâmicas:
                                            </Label>
                                            <div className="flex flex-wrap gap-1.5">
                                                {[
                                                    { tag: "{nome}", desc: "Primeiro nome do contato" },
                                                    { tag: "{saudacao}", desc: "Bom dia / Boa tarde / Boa noite" },
                                                    { tag: "{empresa}", desc: "Nome da empresa / bot" },
                                                ].map((item, idx) => (
                                                    <button
                                                        key={idx}
                                                        type="button"
                                                        onClick={() => handleInsertTag(item.tag)}
                                                        className="text-[11px] font-mono px-2 py-0.5 rounded bg-muted/60 hover:bg-muted text-primary border border-border/20 cursor-pointer"
                                                        title={item.desc}
                                                    >
                                                        + {item.tag}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Right Column: Real-time WhatsApp Mockup */}
                            <div className="lg:col-span-5 space-y-3">
                                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                                    <Smartphone className="h-3.5 w-3.5 text-[#00a884]" />
                                    Simulador Visual no WhatsApp
                                </Label>
                                
                                <div className="rounded-2xl border border-border/40 overflow-hidden shadow-sm bg-[#efeae2] dark:bg-[#0c1317]">
                                    {/* Mockup Chat Header */}
                                    <div className="bg-[#008069] text-white p-3 flex items-center gap-2.5 shadow-xs">
                                        <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center font-bold text-xs">
                                            🤖
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs font-semibold truncate leading-tight">
                                                {botConfig.botName || "BarraSoftware Bot"}
                                            </p>
                                            <p className="text-[10px] text-white/80 leading-tight">
                                                online
                                            </p>
                                        </div>
                                    </div>

                                    {/* Mockup Messages Area */}
                                    <div className="p-4 space-y-3 min-h-[260px] flex flex-col justify-end">
                                        {/* Customer message */}
                                        <div className="self-start max-w-[85%] bg-white dark:bg-[#202c33] rounded-lg rounded-tl-none p-2.5 shadow-2xs border border-black/5 dark:border-white/5 text-xs text-foreground">
                                            <p>Olá, bom dia!</p>
                                            <span className="text-[9px] text-muted-foreground float-right mt-1 ml-2">
                                                10:30
                                            </span>
                                        </div>

                                        {/* Bot response */}
                                        <div className="self-end max-w-[90%] bg-[#d9fdd3] dark:bg-[#005c4b] rounded-lg rounded-tr-none p-2.5 shadow-2xs border border-emerald-600/10 text-xs text-foreground">
                                            <p className="whitespace-pre-wrap leading-relaxed">
                                                {simulatedPreviewText}
                                            </p>
                                            <div className="flex items-center justify-end gap-1 mt-1 text-[9px] text-[#667781] dark:text-[#8696a0]">
                                                <span>10:30</span>
                                                <CheckCheck className="h-3 w-3 text-[#53bdeb]" />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Mockup Footer */}
                                    <div className="bg-white/80 dark:bg-[#202c33]/80 p-2 text-center text-[10px] text-muted-foreground border-t border-border/10">
                                        Prévia em tempo real com variáveis substituídas
                                    </div>
                                </div>
                            </div>
                        </div>
                    </TabsContent>

                    {/* ════ TAB 3: PROTEÇÃO ANTI-BAN ════ */}
                    <TabsContent value="antiban" className="space-y-6 animate-in fade-in duration-200">
                        {/* Safety Status Banner */}
                        <div className={`p-4 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${antiSpamSafety.color}`}>
                            <div className="flex items-center gap-3">
                                <ShieldCheck className="h-6 w-6 shrink-0" />
                                <div>
                                    <p className="font-semibold text-sm">
                                        Status de Proteção: {antiSpamSafety.label}
                                    </p>
                                    <p className="text-xs opacity-90 leading-relaxed mt-0.5">
                                        {antiSpamSafety.description}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Label htmlFor="anti-spam-toggle" className="text-xs font-semibold cursor-pointer">
                                    Ativar Intervalo Anti-Spam
                                </Label>
                                <Switch
                                    id="anti-spam-toggle"
                                    checked={botConfig.antiSpamEnabled}
                                    onCheckedChange={c => {
                                        setBotConfig(prev => ({ ...prev, antiSpamEnabled: c }));
                                        setHasUnsavedChanges(true);
                                    }}
                                />
                            </div>
                        </div>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Clock className="h-4 w-4 text-primary" />
                                    Ajuste de Frequência e Atrasos
                                </CardTitle>
                                <CardDescription className="text-xs">
                                    Controla o ritmo de envio para simular a digitação de um ser humano real.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="grid sm:grid-cols-2 gap-5">
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-xs font-medium">Limite de mensagens por lote</Label>
                                            <span className="text-xs font-mono font-bold text-primary">{botConfig.spamLimit} msgs</span>
                                        </div>
                                        <Slider
                                            value={[botConfig.spamLimit]}
                                            min={1}
                                            max={20}
                                            step={1}
                                            onValueChange={([val]) => {
                                                setBotConfig(prev => ({ ...prev, spamLimit: val }));
                                                setHasUnsavedChanges(true);
                                            }}
                                        />
                                        <p className="text-[11px] text-muted-foreground">
                                            Quantidade de mensagens enviadas na velocidade normal antes de acionar a pausa.
                                        </p>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-xs font-medium">Período de contagem</Label>
                                            <span className="text-xs font-mono font-bold text-primary">{botConfig.spamInterval} segundos</span>
                                        </div>
                                        <Slider
                                            value={[botConfig.spamInterval]}
                                            min={5}
                                            max={60}
                                            step={5}
                                            onValueChange={([val]) => {
                                                setBotConfig(prev => ({ ...prev, spamInterval: val }));
                                                setHasUnsavedChanges(true);
                                            }}
                                        />
                                        <p className="text-[11px] text-muted-foreground">
                                            Tempo em que o contador de mensagens é zerado para o próximo lote.
                                        </p>
                                    </div>
                                </div>

                                <div className="grid sm:grid-cols-2 gap-5 pt-3 border-t border-border/30">
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-xs font-medium">Atraso Mínimo entre mensagens</Label>
                                            <span className="text-xs font-mono font-bold text-primary">{(botConfig.spamDelayMin / 1000).toFixed(1)}s</span>
                                        </div>
                                        <Slider
                                            value={[botConfig.spamDelayMin]}
                                            min={500}
                                            max={10000}
                                            step={250}
                                            onValueChange={([val]) => {
                                                setBotConfig(prev => ({ ...prev, spamDelayMin: val }));
                                                setHasUnsavedChanges(true);
                                            }}
                                        />
                                        <p className="text-[11px] text-muted-foreground">
                                            Menor tempo aleatório de pausa entre cada envio.
                                        </p>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-xs font-medium">Atraso Máximo entre mensagens</Label>
                                            <span className="text-xs font-mono font-bold text-primary">{(botConfig.spamDelayMax / 1000).toFixed(1)}s</span>
                                        </div>
                                        <Slider
                                            value={[botConfig.spamDelayMax]}
                                            min={1000}
                                            max={15000}
                                            step={250}
                                            onValueChange={([val]) => {
                                                setBotConfig(prev => ({ ...prev, spamDelayMax: val }));
                                                setHasUnsavedChanges(true);
                                            }}
                                        />
                                        <p className="text-[11px] text-muted-foreground">
                                            Maior tempo aleatório de pausa entre cada envio.
                                        </p>
                                    </div>
                                </div>

                                <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground flex items-center gap-2">
                                    <Info className="h-4 w-4 text-primary shrink-0" />
                                    <span>
                                        <strong>Dica de ouro:</strong> Intervalos entre <strong>1.5s e 3.5s</strong> mantêm sua conta segura no WhatsApp sem deixar os clientes esperando.
                                    </span>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* ════ TAB 4: AUTOMAÇÃO & PRESENÇA ════ */}
                    <TabsContent value="automation" className="space-y-6 animate-in fade-in duration-200">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Zap className="h-4 w-4 text-amber-500" />
                                    Presença e Confirmação de Leitura
                                </CardTitle>
                                <CardDescription className="text-xs">
                                    Ajuste o comportamento do WhatsApp enquanto a sessão estiver ligada.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid sm:grid-cols-2 gap-4">
                                    <div className="flex items-center justify-between p-3.5 rounded-xl border border-border/40 hover:bg-muted/30 transition-colors">
                                        <div className="space-y-0.5">
                                            <Label htmlFor="always-online" className="text-xs font-semibold cursor-pointer">
                                                Sempre Online
                                            </Label>
                                            <p className="text-[11px] text-muted-foreground">
                                                Mantém o status "Online" no WhatsApp mesmo sem abrir o app.
                                            </p>
                                        </div>
                                        <Switch
                                            id="always-online"
                                            checked={botConfig.alwaysOnline}
                                            onCheckedChange={c => {
                                                setBotConfig(prev => ({ ...prev, alwaysOnline: c }));
                                                setHasUnsavedChanges(true);
                                            }}
                                        />
                                    </div>

                                    <div className="flex items-center justify-between p-3.5 rounded-xl border border-border/40 hover:bg-muted/30 transition-colors">
                                        <div className="space-y-0.5">
                                            <Label htmlFor="auto-read" className="text-xs font-semibold cursor-pointer">
                                                Leitura Automática (Tiques Azuis)
                                            </Label>
                                            <p className="text-[11px] text-muted-foreground">
                                                Marca as mensagens como lidas automaticamente ao receber.
                                            </p>
                                        </div>
                                        <Switch
                                            id="auto-read"
                                            checked={botConfig.autoRead}
                                            onCheckedChange={c => {
                                                setBotConfig(prev => ({ ...prev, autoRead: c }));
                                                setHasUnsavedChanges(true);
                                            }}
                                        />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <UserCheck className="h-4 w-4 text-primary" />
                                    Controle de Acesso ao Bot
                                </CardTitle>
                                <CardDescription className="text-xs">
                                    Defina quais pessoas ou números têm autorização para interagir com os comandos.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="max-w-md space-y-1.5">
                                    <Label className="text-xs font-medium">Quem pode usar os comandos do Bot?</Label>
                                    <Select
                                        value={botConfig.botMode}
                                        onValueChange={(val: any) => {
                                            setBotConfig(prev => ({ ...prev, botMode: val }));
                                            setHasUnsavedChanges(true);
                                        }}
                                    >
                                        <SelectTrigger className="h-9 text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="ALL">Público (Todos os clientes)</SelectItem>
                                            <SelectItem value="OWNER">Privado (Apenas Administrador)</SelectItem>
                                            <SelectItem value="SPECIFIC">Lista de Autorizados (Apenas números escolhidos)</SelectItem>
                                            <SelectItem value="BLACKLIST">Lista de Bloqueio (Bloquear números específicos)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {(botConfig.botMode === 'SPECIFIC' || botConfig.botMode === 'BLACKLIST') && (
                                    <div className="space-y-3 pt-3 border-t border-border/40">
                                        <Label className="text-xs font-semibold">
                                            {botConfig.botMode === 'SPECIFIC' ? "Números Autorizados (DDD + Telefone)" : "Números Bloqueados (DDD + Telefone)"}
                                        </Label>
                                        <div className="flex gap-2 max-w-md">
                                            <Input
                                                placeholder="ex: 11999999999"
                                                value={newJid}
                                                onChange={e => setNewJid(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && addJid(botConfig.botMode === 'SPECIFIC' ? 'botAllowedJids' : 'botBlockedJids')}
                                                className="h-9 text-xs"
                                            />
                                            <Button
                                                size="sm"
                                                onClick={() => addJid(botConfig.botMode === 'SPECIFIC' ? 'botAllowedJids' : 'botBlockedJids')}
                                                className="h-9 text-xs"
                                            >
                                                <Plus className="h-3.5 w-3.5 mr-1" />
                                                Adicionar
                                            </Button>
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {(botConfig.botMode === 'SPECIFIC' ? botConfig.botAllowedJids : botConfig.botBlockedJids).map(jid => (
                                                <Badge key={jid} variant="secondary" className="gap-1.5 text-xs py-1">
                                                    <span>{jid.replace("@s.whatsapp.net", "")}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeJid(botConfig.botMode === 'SPECIFIC' ? 'botAllowedJids' : 'botBlockedJids', jid)}
                                                        className="hover:text-destructive cursor-pointer"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </Badge>
                                            ))}
                                            {(botConfig.botMode === 'SPECIFIC' ? botConfig.botAllowedJids : botConfig.botBlockedJids).length === 0 && (
                                                <p className="text-xs text-muted-foreground italic">Nenhum número cadastrado na lista.</p>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* ════ TAB 5: FIGURINHAS & MÍDIA ════ */}
                    <TabsContent value="stickers" className="space-y-6 animate-in fade-in duration-200">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Smile className="h-4 w-4 text-purple-500" />
                                    Criador de Figurinhas Automático
                                </CardTitle>
                                <CardDescription className="text-xs">
                                    Converte fotos e vídeos curtos enviados ao WhatsApp em figurinhas prontas.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                <div className="grid sm:grid-cols-2 gap-4">
                                    <div className="flex items-center justify-between p-3.5 rounded-xl border border-border/40">
                                        <div className="space-y-0.5">
                                            <Label htmlFor="enable-sticker" className="text-xs font-semibold cursor-pointer">
                                                Imagem para Figurinha
                                            </Label>
                                            <p className="text-[11px] text-muted-foreground">
                                                Converte fotos enviadas em figurinhas estáticas.
                                            </p>
                                        </div>
                                        <Switch
                                            id="enable-sticker"
                                            checked={botConfig.enableSticker}
                                            onCheckedChange={c => {
                                                setBotConfig(prev => ({ ...prev, enableSticker: c }));
                                                setHasUnsavedChanges(true);
                                            }}
                                        />
                                    </div>

                                    <div className="flex items-center justify-between p-3.5 rounded-xl border border-border/40">
                                        <div className="space-y-0.5">
                                            <Label htmlFor="enable-video-sticker" className="text-xs font-semibold cursor-pointer">
                                                Vídeo para Figurinha Animada
                                            </Label>
                                            <p className="text-[11px] text-muted-foreground">
                                                Converte vídeos e GIFs curtos em figurinhas animadas.
                                            </p>
                                        </div>
                                        <Switch
                                            id="enable-video-sticker"
                                            checked={botConfig.enableVideoSticker}
                                            onCheckedChange={c => {
                                                setBotConfig(prev => ({ ...prev, enableVideoSticker: c }));
                                                setHasUnsavedChanges(true);
                                            }}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2 pt-2 border-t border-border/30">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-xs font-medium">Duração máxima de vídeo para figurinha</Label>
                                        <span className="text-xs font-mono font-bold text-primary">{botConfig.maxStickerDuration}s</span>
                                    </div>
                                    <Slider
                                        value={[botConfig.maxStickerDuration]}
                                        min={3}
                                        max={30}
                                        step={1}
                                        onValueChange={([val]) => {
                                            setBotConfig(prev => ({ ...prev, maxStickerDuration: val }));
                                            setHasUnsavedChanges(true);
                                        }}
                                    />
                                </div>

                                <div className="space-y-2 pt-2 border-t border-border/30 max-w-md">
                                    <Label className="text-xs font-medium">Chave da API Remove.bg (Opcional)</Label>
                                    <Input
                                        type="password"
                                        placeholder="Cole sua chave da remove.bg aqui..."
                                        value={botConfig.removeBgApiKey || ""}
                                        onChange={e => {
                                            setBotConfig(prev => ({ ...prev, removeBgApiKey: e.target.value }));
                                            setHasUnsavedChanges(true);
                                        }}
                                        className="h-9 text-xs"
                                    />
                                    <p className="text-[11px] text-muted-foreground">
                                        Permite remover o fundo das figurinhas automaticamente usando a legenda <code className="bg-muted px-1 rounded">nobg</code>.
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* ════ TAB 6: PRIVACIDADE ════ */}
                    <TabsContent value="privacy" className="space-y-6 animate-in fade-in duration-200">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Lock className="h-4 w-4 text-primary" />
                                    Privacidade da Sessão do WhatsApp
                                </CardTitle>
                                <CardDescription className="text-xs">
                                    Recursos especiais de visualização e segurança para seus operadores.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between p-3.5 rounded-xl border border-border/40 hover:bg-muted/30 transition-colors">
                                        <div className="space-y-0.5">
                                            <Label htmlFor="ghost-mode" className="text-xs font-semibold cursor-pointer flex items-center gap-1.5">
                                                <Eye className="h-3.5 w-3.5 text-primary" />
                                                Modo Invisível (Ghost Mode)
                                            </Label>
                                            <p className="text-[11px] text-muted-foreground">
                                                Visualize mensagens e status dos contatos sem disparar a confirmação de visualização para eles.
                                            </p>
                                        </div>
                                        <Switch
                                            id="ghost-mode"
                                            checked={privacyConfig.ghostMode}
                                            onCheckedChange={c => {
                                                setPrivacyConfig(prev => ({ ...prev, ghostMode: c }));
                                                setHasUnsavedChanges(true);
                                            }}
                                        />
                                    </div>

                                    <div className="flex items-center justify-between p-3.5 rounded-xl border border-border/40 hover:bg-muted/30 transition-colors">
                                        <div className="space-y-0.5">
                                            <Label htmlFor="anti-delete" className="text-xs font-semibold cursor-pointer flex items-center gap-1.5">
                                                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                                                Anti-Exclusão de Mensagens
                                            </Label>
                                            <p className="text-[11px] text-muted-foreground">
                                                Mantém a mensagem salva no seu histórico mesmo que o contato clique em "Apagar para todos".
                                            </p>
                                        </div>
                                        <Switch
                                            id="anti-delete"
                                            checked={privacyConfig.antiDelete}
                                            onCheckedChange={c => {
                                                setPrivacyConfig(prev => ({ ...prev, antiDelete: c }));
                                                setHasUnsavedChanges(true);
                                            }}
                                        />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </SessionGuard>
    );
}
