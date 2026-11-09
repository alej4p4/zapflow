"use client";

import pkg from "../../../../package.json";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from "@/components/ui/dialog";
import {
    RefreshCw,
    Save,
    AlertCircle,
    Sliders,
    Users,
    Activity,
    QrCode,
    Clock,
    Globe,
    ExternalLink,
    CheckCircle2,
    ShieldCheck
} from "lucide-react";
import { toast } from "sonner";

export default function SettingsPage() {
    const { data: authSession } = useSession();
    const router = useRouter();
    const isSuperAdmin = (authSession?.user as any)?.role === "SUPERADMIN";

    const [systemConfig, setSystemConfig] = useState({
        appName: "BarraSoftware",
        logoUrl: "",
        faviconUrl: "/favicon.ico",
        timezone: "America/Sao_Paulo"
    });
    const [systemLoading, setSystemLoading] = useState(false);
    const [timezones, setTimezones] = useState<string[]>(["UTC", "America/Sao_Paulo", "America/Manaus", "America/Fortaleza"]);
    const [isAppConfigOpen, setIsAppConfigOpen] = useState(false);

    useEffect(() => {
        try {
            if (typeof Intl !== "undefined" && Intl.supportedValuesOf) {
                const list = Intl.supportedValuesOf("timeZone");
                if (!list.includes("UTC")) {
                    list.push("UTC");
                }
                list.sort();
                setTimezones(list);
            }
        } catch (e) {
            console.error("Failed to load timezones dynamically", e);
        }
    }, []);

    useEffect(() => {
        fetch('/api/settings/system')
            .then(r => { if (!r.ok) throw new Error(); return r.json(); })
            .then(responseData => {
                const data = responseData?.data;
                if (data && !responseData.error) {
                    setSystemConfig({
                        appName: data.appName || "BarraSoftware",
                        logoUrl: data.logoUrl || "",
                        faviconUrl: data.faviconUrl || "/favicon.ico",
                        timezone: data.timezone || "America/Sao_Paulo"
                    });
                }
            })
            .catch(() => { });
    }, []);

    const handleSaveSystem = async () => {
        setSystemLoading(true);
        try {
            const res = await fetch('/api/settings/system', {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(systemConfig)
            });

            if (res.ok) {
                toast.success("Configurações do aplicativo salvas com sucesso! Recarregue a página para aplicar o novo nome.");
                setIsAppConfigOpen(false);
            } else {
                toast.error("Não foi possível atualizar as configurações do sistema");
            }
        } catch (e) {
            console.error(e);
            toast.error("Erro ao salvar as configurações do sistema");
        } finally {
            setSystemLoading(false);
        }
    };

    const inputClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Configurações</h2>
                <p className="text-muted-foreground text-sm mt-1">
                    Central de configurações modulares da plataforma. Clique em cada card para abrir o formulário correspondente.
                </p>
            </div>

            {!isSuperAdmin && (
                <Card className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-900/50">
                    <CardContent className="pt-6">
                        <div className="flex items-start gap-3">
                            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 mt-0.5" />
                            <div>
                                <p className="text-sm font-medium text-yellow-900 dark:text-yellow-200">Modo somente leitura</p>
                                <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-1">
                                    Somente superadministradores podem alterar as configurações do sistema. Você pode visualizá-las, mas não modificá-las.
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Grid de Cards de Configuração */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {/* 1. Card: Configuração do Aplicativo */}
                <Card
                    onClick={() => setIsAppConfigOpen(true)}
                    className="border-2 hover:border-primary/50 transition-all cursor-pointer group shadow-sm hover:shadow-md flex flex-col justify-between"
                >
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div className="p-2.5 rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                                <Sliders className="h-6 w-6" />
                            </div>
                            <Badge variant="outline" className="text-xs bg-primary/5 border-primary/20 text-primary">
                                Identidade Visual
                            </Badge>
                        </div>
                        <CardTitle className="text-lg mt-3 group-hover:text-primary transition-colors">
                            Configuração do aplicativo
                        </CardTitle>
                        <CardDescription>
                            Nome do sistema, fuso horário dos agendamentos, logotipo e favicon da plataforma.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs text-muted-foreground">
                        <div className="flex items-center justify-between p-2 rounded-lg bg-muted/40">
                            <span className="font-medium text-foreground">Nome:</span>
                            <span className="font-semibold text-primary">{systemConfig.appName || "BarraSoftware"}</span>
                        </div>
                        <div className="flex items-center justify-between p-2 rounded-lg bg-muted/40">
                            <span className="font-medium text-foreground">Fuso Horário:</span>
                            <span className="truncate max-w-[140px]">{systemConfig.timezone}</span>
                        </div>
                        <div className="flex items-center justify-between p-2 rounded-lg bg-muted/40">
                            <span className="font-medium text-foreground">Cadastro público:</span>
                            <span className="text-amber-600 dark:text-amber-400 font-medium">Restrito ao Admin</span>
                        </div>
                    </CardContent>
                    <CardFooter className="pt-2 border-t border-border/50">
                        <Button
                            variant="secondary"
                            size="sm"
                            className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-all"
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsAppConfigOpen(true);
                            }}
                        >
                            Abrir formulário de configuração
                        </Button>
                    </CardFooter>
                </Card>

                {/* 2. Card: Perfis & Permissões de Usuários */}
                <Card 
                    className="cursor-pointer border hover:border-primary/50 transition-all shadow-sm hover:shadow-md flex flex-col justify-between group"
                    onClick={() => router.push("/dashboard/users")}
                >
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 group-hover:scale-105 transition-transform">
                                <ShieldCheck className="h-6 w-6" />
                            </div>
                            <Badge variant="outline" className="text-xs bg-blue-500/5 border-blue-500/20 text-blue-600 dark:text-blue-400">
                                Controle de Acesso
                            </Badge>
                        </div>
                        <CardTitle className="text-lg mt-3 group-hover:text-primary transition-colors">
                            Perfis e seletores de abas
                        </CardTitle>
                        <CardDescription>
                            Configure com seletores (interruptores) exatamente quais abas cada atendente pode ver e acessar.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs text-muted-foreground">
                        <div className="p-2.5 rounded-lg bg-muted/40 space-y-1.5">
                            <p className="font-medium text-foreground flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" /> Seletores Granulares de Abas:
                            </p>
                            <p>
                                <strong>Marcado:</strong> o usuário visualiza a aba no menu e navega normalmente.<br />
                                <strong>Desmarcado:</strong> a aba é totalmente ocultada e o acesso bloqueado.
                            </p>
                        </div>
                    </CardContent>
                    <CardFooter className="pt-2 border-t border-border/50">
                        <Button 
                            variant="secondary" 
                            size="sm" 
                            className="w-full gap-2 group-hover:bg-primary group-hover:text-primary-foreground transition-all"
                            onClick={(e) => {
                                e.stopPropagation();
                                router.push("/dashboard/users");
                            }}
                        >
                            <Users className="h-4 w-4" /> Gerenciar perfis e seletores
                        </Button>
                    </CardFooter>
                </Card>

                {/* 3. Card: Atualizações do Sistema */}
                <Card className="border hover:border-primary/50 transition-all shadow-sm hover:shadow-md flex flex-col justify-between">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                <RefreshCw className="h-6 w-6" />
                            </div>
                            <Badge variant="outline" className="text-xs bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                                v{pkg.version}
                            </Badge>
                        </div>
                        <CardTitle className="text-lg mt-3">
                            Atualizações do sistema
                        </CardTitle>
                        <CardDescription>
                            Verifique a sincronização de código e atualizações da plataforma via GitHub.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs text-muted-foreground">
                        <div className="flex items-center justify-between p-2 rounded-lg bg-muted/40">
                            <span className="font-medium text-foreground">Versão instalada:</span>
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">v{pkg.version}</span>
                        </div>
                        <div className="flex items-center justify-between p-2 rounded-lg bg-muted/40">
                            <span className="font-medium text-foreground">Status do Banco:</span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-medium">PostgreSQL Online</span>
                        </div>
                    </CardContent>
                    <CardFooter className="pt-2 border-t border-border/50">
                        <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={async () => {
                                setSystemLoading(true);
                                try {
                                    const res = await fetch("/api/system/check-updates", { method: "POST" });
                                    const data = await res.json();
                                    if (data.status) {
                                        toast.success(data.message || "Sistema verificado e atualizado!");
                                    } else {
                                        toast.error(data.message || "Não foi possível verificar atualizações");
                                    }
                                } catch (e) {
                                    toast.error("Erro ao verificar atualizações");
                                } finally {
                                    setSystemLoading(false);
                                }
                            }}
                            disabled={systemLoading}
                        >
                            <RefreshCw className={`mr-2 h-4 w-4 ${systemLoading ? 'animate-spin' : ''}`} />
                            Verificar atualizações
                        </Button>
                    </CardFooter>
                </Card>

                {/* 4. Card: Monitor & Diagnóstico do Sistema */}
                <Card className="border hover:border-primary/50 transition-all shadow-sm hover:shadow-md flex flex-col justify-between">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
                                <Activity className="h-6 w-6" />
                            </div>
                            <Badge variant="outline" className="text-xs bg-purple-500/5 border-purple-500/20 text-purple-600 dark:text-purple-400">
                                Diagnóstico
                            </Badge>
                        </div>
                        <CardTitle className="text-lg mt-3">
                            Monitor do sistema
                        </CardTitle>
                        <CardDescription>
                            Acompanhe uso de CPU, memória RAM do servidor, tempo de atividade e métricas do Node.js.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs text-muted-foreground">
                        <div className="p-2 rounded-lg bg-muted/40 space-y-1">
                            <p className="font-medium text-foreground">Saúde do Servidor:</p>
                            <p>Diagnóstico de recursos em tempo real e monitor de sockets conectados.</p>
                        </div>
                    </CardContent>
                    <CardFooter className="pt-2 border-t border-border/50">
                        <Button variant="outline" size="sm" className="w-full gap-2" asChild>
                            <Link href="/dashboard/system-monitor">
                                <Activity className="h-4 w-4" /> Abrir monitor do sistema
                            </Link>
                        </Button>
                    </CardFooter>
                </Card>

                {/* 5. Card: Sessões e Conexões WhatsApp */}
                <Card className="border hover:border-primary/50 transition-all shadow-sm hover:shadow-md flex flex-col justify-between">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                <QrCode className="h-6 w-6" />
                            </div>
                            <Badge variant="outline" className="text-xs bg-amber-500/5 border-amber-500/20 text-amber-600 dark:text-amber-400">
                                WhatsApp Multi-Device
                            </Badge>
                        </div>
                        <CardTitle className="text-lg mt-3">
                            Instâncias e QR Codes
                        </CardTitle>
                        <CardDescription>
                            Gerencie os números do WhatsApp conectados via Baileys e delegação de sessões para a equipe.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs text-muted-foreground">
                        <div className="p-2 rounded-lg bg-muted/40 space-y-1">
                            <p className="font-medium text-foreground">Conexão WebSocket:</p>
                            <p>Autenticação com persistência em PostgreSQL e reconexão automática.</p>
                        </div>
                    </CardContent>
                    <CardFooter className="pt-2 border-t border-border/50">
                        <Button variant="outline" size="sm" className="w-full gap-2" asChild>
                            <Link href="/dashboard/sessions">
                                <QrCode className="h-4 w-4" /> Gerenciar sessões / QR
                            </Link>
                        </Button>
                    </CardFooter>
                </Card>
            </div>

            {/* Modal / Dialog com Formulário de Configuração do Aplicativo */}
            <Dialog open={isAppConfigOpen} onOpenChange={setIsAppConfigOpen}>
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-xl">
                            <Sliders className="h-5 w-5 text-primary" /> Configuração do aplicativo
                        </DialogTitle>
                        <DialogDescription>
                            Ajuste os dados de identidade visual e fuso horário do sistema. As alterações têm efeito imediato.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="app-name">Nome do aplicativo</Label>
                                <input
                                    id="app-name"
                                    className={inputClass}
                                    placeholder="BarraSoftware"
                                    value={systemConfig.appName}
                                    onChange={(e) => setSystemConfig(prev => ({ ...prev, appName: e.target.value }))}
                                    disabled={!isSuperAdmin}
                                />
                                <p className="text-xs text-muted-foreground">Exibido na barra lateral e aba do navegador.</p>
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="app-tz">Fuso horário</Label>
                                <select
                                    id="app-tz"
                                    className={inputClass}
                                    value={systemConfig.timezone}
                                    onChange={(e) => setSystemConfig(prev => ({ ...prev, timezone: e.target.value }))}
                                    disabled={!isSuperAdmin}
                                >
                                    {timezones.map((tz) => (
                                        <option key={tz} value={tz}>
                                            {tz}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-xs text-muted-foreground">Utilizado nos agendamentos e logs.</p>
                            </div>
                        </div>

                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="logo-url">URL do logotipo</Label>
                                <input
                                    id="logo-url"
                                    className={inputClass}
                                    placeholder="https://exemplo.com/logo.png"
                                    value={systemConfig.logoUrl}
                                    onChange={(e) => setSystemConfig(prev => ({ ...prev, logoUrl: e.target.value }))}
                                    disabled={!isSuperAdmin}
                                />
                                <p className="text-xs text-muted-foreground">Logo personalizado no topo da barra lateral.</p>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="favicon-url">URL do favicon</Label>
                                <input
                                    id="favicon-url"
                                    className={inputClass}
                                    placeholder="/favicon.ico"
                                    value={systemConfig.faviconUrl || ""}
                                    onChange={(e) => setSystemConfig(prev => ({ ...prev, faviconUrl: e.target.value }))}
                                    disabled={!isSuperAdmin}
                                />
                                <p className="text-xs text-muted-foreground">Ícone na aba do navegador.</p>
                            </div>
                        </div>

                        <div className="p-3 rounded-xl bg-muted/50 border border-border/50 text-xs text-muted-foreground flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                            <span>Cadastro público desativado por padrão para garantir que apenas administradores criem acessos.</span>
                        </div>
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            variant="outline"
                            onClick={() => setIsAppConfigOpen(false)}
                            disabled={systemLoading}
                        >
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleSaveSystem}
                            disabled={systemLoading || !isSuperAdmin}
                        >
                            {systemLoading ? (
                                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Salvar configurações
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
