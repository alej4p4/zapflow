import { prisma } from "@/lib/prisma";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
    Plus,
    Wifi,
    WifiOff,
    MessageSquare,
    Bot,
    Send,
    Settings,
    QrCode,
    ArrowRight,
    Activity,
    Zap,
    Users,
    UserCheck,
    Columns3,
    Megaphone,
    Clock,
    Tag,
    TrendingUp,
    TrendingDown,
    Flame
} from "lucide-react";

import { auth } from "@/lib/auth";
import { getAccessibleSessions } from "@/lib/api-auth";
import { redirect } from "next/navigation";

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
    const session = await auth();
    if (!session?.user) {
        redirect("/auth/login");
    }

    const sessions = await getAccessibleSessions(session.user.id!, session.user.role || "OWNER");
    const sessionIds = sessions.map(s => s.sessionId);
    const dbSessionIds = sessions.map(s => s.id);

    const totalSessions = sessions.length;
    const connectedSessions = sessions.filter(s => s.status === 'CONNECTED').length;
    const disconnectedSessions = totalSessions - connectedSessions;

    // Messages metrics
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    let totalMessages = 0;
    let messagesToday = 0;
    let messagesSentToday = 0;
    let messagesRecvToday = 0;
    let totalContacts = 0;
    let totalGroups = 0;
    let autoReplyCount = 0;
    let hourlyStats: Array<{ hour: number; count: number }> = [];
    let topLabels: Array<{ id: string; name: string; colorHex: string; count: number }> = [];

    try {
        const [
            msgsCount,
            todayCount,
            sentTodayCount,
            contactsCount,
            groupsCount,
            autoReplies,
            hourlyRaw,
            labelsRaw
        ] = await Promise.all([
            prisma.message.count(),
            prisma.message.count({ where: { timestamp: { gte: todayStart } } }),
            prisma.message.count({ where: { timestamp: { gte: todayStart }, fromMe: true } }),
            prisma.contact.count(),
            prisma.group.count(),
            sessionIds.length > 0 ? prisma.autoReply.count({ where: { sessionId: { in: sessionIds } } }) : 0,
            prisma.$queryRaw<Array<{ hour: number; count: number }>>`
                SELECT EXTRACT(HOUR FROM timestamp)::int as hour, count(*)::int as count
                FROM "Message"
                WHERE timestamp >= NOW() - INTERVAL '7 days'
                GROUP BY hour
                ORDER BY hour ASC
            `,
            prisma.label.findMany({
                where: dbSessionIds.length > 0 ? { sessionId: { in: dbSessionIds } } : undefined,
                select: {
                    id: true,
                    name: true,
                    colorHex: true,
                    chatLabels: { select: { id: true } }
                },
                take: 8
            })
        ]);

        totalMessages = msgsCount;
        messagesToday = todayCount;
        messagesSentToday = sentTodayCount;
        messagesRecvToday = todayCount - sentTodayCount;
        totalContacts = contactsCount;
        totalGroups = groupsCount;
        autoReplyCount = autoReplies;
        hourlyStats = hourlyRaw || [];
        topLabels = labelsRaw
            .map(l => ({
                id: l.id,
                name: l.name,
                colorHex: l.colorHex,
                count: l.chatLabels.length
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
    } catch (err) {
        console.error("Dashboard metrics error:", err);
    }

    // Build 24h chart data
    const hourMap = new Map<number, number>();
    for (const h of hourlyStats) {
        hourMap.set(h.hour, Number(h.count));
    }
    const fullDayHours = Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        label: `${i.toString().padStart(2, '0')}h`,
        count: hourMap.get(i) || 0
    }));

    const maxHourCount = Math.max(...fullDayHours.map(h => h.count), 1);
    const peakHour = fullDayHours.reduce((prev, curr) => (curr.count > prev.count ? curr : prev), fullDayHours[0]);

    const stats = [
        {
            title: "Total de Mensagens",
            value: totalMessages.toLocaleString("pt-BR"),
            icon: MessageSquare,
            description: `+${messagesToday.toLocaleString("pt-BR")} mensagens hoje`,
            badge: messagesToday > 0 ? `${messagesToday} hoje` : null,
            color: "text-[#00a884]",
            bg: "bg-[#00a884]/10",
        },
        {
            title: "Contatos Salvos",
            value: totalContacts.toLocaleString("pt-BR"),
            icon: UserCheck,
            description: `${totalGroups} grupos no catálogo`,
            badge: "CRM",
            color: "text-blue-600",
            bg: "bg-blue-500/10",
        },
        {
            title: "Sessões WhatsApp",
            value: `${connectedSessions}/${totalSessions}`,
            icon: Wifi,
            description: connectedSessions > 0 ? "Aparelho conectado e online" : "Nenhum aparelho conectado",
            badge: connectedSessions > 0 ? "Online" : "Atenção",
            color: connectedSessions > 0 ? "text-emerald-600" : "text-amber-500",
            bg: connectedSessions > 0 ? "bg-emerald-500/10" : "bg-amber-500/10",
        },
        {
            title: "Automações & Robô",
            value: autoReplyCount,
            icon: Zap,
            description: "Regras ativas no sistema",
            badge: "Ativo",
            color: "text-amber-600",
            bg: "bg-amber-500/10",
        },
    ];

    const quickActions = [
        {
            href: "/dashboard/kanban",
            label: "Pipeline & Kanban CRM",
            icon: Columns3,
            description: "Gerencie etapas do funil de vendas",
            color: "text-[#00a884]",
            badge: "Novo"
        },
        {
            href: "/dashboard/chat",
            label: "Conversas no Chat",
            icon: MessageSquare,
            description: "Atendimento em tempo real",
            color: "text-blue-600"
        },
        {
            href: "/dashboard/broadcast",
            label: "Disparo em Massa",
            icon: Megaphone,
            description: "Campanhas e avisos para listas",
            color: "text-purple-600"
        },
        {
            href: "/dashboard/labels",
            label: "Etiquetas & Segmentação",
            icon: Tag,
            description: "Organize seus contatos",
            color: "text-emerald-600"
        },
        {
            href: "/dashboard/sessions",
            label: "Sessões / QR Code",
            icon: QrCode,
            description: "Conecte novos números WhatsApp",
            color: "text-amber-600"
        },
        {
            href: "/dashboard/bot-settings",
            label: "Configurações do Robô",
            icon: Bot,
            description: "Inteligência e auto-respostas",
            color: "text-rose-600"
        },
    ];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                <div>
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        Painel Geral
                        <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#00a884]/15 text-[#00a884] font-medium border border-[#00a884]/20">
                            PostgreSQL Dedicado
                        </span>
                    </h2>
                    <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                        Visão executiva em tempo real do seu gateway e atendimento BarraSoftware.
                    </p>
                </div>
                <div className="flex items-center gap-2.5">
                    <Link href="/dashboard/kanban">
                        <Button variant="outline" size="sm" className="gap-1.5 rounded-xl cursor-pointer">
                            <Columns3 className="h-4 w-4 text-[#00a884]" />
                            <span>Abrir Kanban</span>
                        </Button>
                    </Link>
                    <Link href="/dashboard/sessions">
                        <Button size="sm" className="gap-1.5 rounded-xl bg-[#00a884] hover:bg-[#00a884]/90 text-white cursor-pointer shadow-sm">
                            <Plus className="h-4 w-4" />
                            <span>Adicionar Sessão</span>
                        </Button>
                    </Link>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                {stats.map((stat) => {
                    const Icon = stat.icon;
                    return (
                        <Card key={stat.title} className="rounded-2xl border-border/40 shadow-sm hover:shadow-md transition-all duration-200">
                            <CardContent className="p-4 sm:p-5">
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1">
                                        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{stat.title}</p>
                                        <p className="text-2xl sm:text-3xl font-extrabold text-foreground">{stat.value}</p>
                                        <p className="text-xs text-muted-foreground/80">{stat.description}</p>
                                    </div>
                                    <div className={`${stat.bg} p-2.5 rounded-xl border border-white/10 shadow-sm`}>
                                        <Icon className={`h-5 w-5 ${stat.color}`} />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {/* Peak Hours & Funnel Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* 24h Peak Activity Chart */}
                <Card className="lg:col-span-2 rounded-2xl border-border/40 shadow-sm">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <CardTitle className="text-sm font-bold flex items-center gap-2">
                                    <Flame className="h-4 w-4 text-amber-500" />
                                    Horários de Pico de Mensagens (Últimos 7 dias)
                                </CardTitle>
                                <CardDescription className="text-xs">
                                    Distribuição do tráfego hora a hora no WhatsApp.
                                </CardDescription>
                            </div>
                            {peakHour && peakHour.count > 0 && (
                                <Badge variant="secondary" className="text-[11px] font-medium gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                    <Clock className="h-3 w-3" />
                                    Pico: {peakHour.label} ({peakHour.count} msgs)
                                </Badge>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="pt-2">
                        {/* 24-Bar Histogram */}
                        <div className="h-44 flex items-end gap-1.5 pt-6 pb-2 px-1">
                            {fullDayHours.map((h) => {
                                const heightPercent = Math.max(Math.round((h.count / maxHourCount) * 100), 4);
                                const isPeak = h.count >= maxHourCount * 0.7 && h.count > 10;
                                return (
                                    <div
                                        key={h.hour}
                                        className="flex-1 flex flex-col items-center h-full justify-end group relative"
                                    >
                                        {/* Hover Tooltip */}
                                        <div className="absolute -top-8 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-black/90 text-white text-[10px] px-2 py-0.5 rounded-md whitespace-nowrap z-20 shadow-md">
                                            {h.label}: {h.count} msgs
                                        </div>

                                        {/* Bar */}
                                        <div
                                            style={{ height: `${heightPercent}%` }}
                                            className={`w-full rounded-t-md transition-all duration-300 ${
                                                isPeak
                                                    ? "bg-[#00a884] shadow-sm shadow-[#00a884]/30"
                                                    : h.count > 0
                                                        ? "bg-[#00a884]/40 hover:bg-[#00a884]/70"
                                                        : "bg-muted/40"
                                            }`}
                                        />

                                        {/* Hour label on specific intervals */}
                                        <span className="text-[9px] text-muted-foreground mt-1 tabular-nums">
                                            {h.hour % 3 === 0 ? h.hour : ""}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/20 pt-2.5 mt-2">
                            <span>00h (Madrugada)</span>
                            <span>12h (Almoço)</span>
                            <span>18h (Fim de expediente)</span>
                            <span>23h (Noite)</span>
                        </div>
                    </CardContent>
                </Card>

                {/* Funnel & Labels Overview */}
                <Card className="rounded-2xl border-border/40 shadow-sm flex flex-col justify-between">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-sm font-bold flex items-center gap-2">
                                <Tag className="h-4 w-4 text-[#00a884]" />
                                Etapas do Funil (Etiquetas)
                            </CardTitle>
                            <Link href="/dashboard/kanban" className="text-xs text-[#00a884] hover:underline font-medium">
                                Ver Kanban
                            </Link>
                        </div>
                        <CardDescription className="text-xs">
                            Volume de contatos distribuídos por fase.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3.5 flex-1">
                        {topLabels.length === 0 ? (
                            <div className="h-40 flex flex-col items-center justify-center text-center text-muted-foreground">
                                <Tag className="h-8 w-8 mb-2 opacity-30" />
                                <span className="text-xs">Nenhuma etiqueta cadastrada</span>
                                <Link href="/dashboard/labels" className="text-xs text-[#00a884] underline mt-1">
                                    Criar etiquetas
                                </Link>
                            </div>
                        ) : (
                            topLabels.map((l) => {
                                const percent = totalContacts > 0 ? Math.min(100, Math.round((l.count / totalContacts) * 100)) : 0;
                                return (
                                    <div key={l.id} className="space-y-1">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="flex items-center gap-2 font-medium text-foreground">
                                                <span
                                                    className="h-2.5 w-2.5 rounded-full shrink-0"
                                                    style={{ backgroundColor: l.colorHex }}
                                                />
                                                {l.name}
                                            </span>
                                            <span className="text-muted-foreground font-semibold tabular-nums">
                                                {l.count} contatos
                                            </span>
                                        </div>
                                        <div className="h-1.5 w-full bg-muted/40 rounded-full overflow-hidden">
                                            <div
                                                className="h-full rounded-full transition-all duration-500"
                                                style={{ width: `${Math.max(percent, 4)}%`, backgroundColor: l.colorHex }}
                                            />
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Quick Actions */}
            <div>
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">Ações Rápidas do Sistema</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    {quickActions.map((action) => {
                        const Icon = action.icon;
                        return (
                            <Link key={action.href} href={action.href}>
                                <Card className="rounded-2xl border-border/40 shadow-sm hover:shadow-md hover:border-[#00a884]/40 hover:-translate-y-0.5 transition-all duration-200 group cursor-pointer h-full">
                                    <CardContent className="p-3.5 flex flex-col justify-between h-full">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="p-2 rounded-xl bg-muted/50 group-hover:bg-[#00a884]/10 transition-colors">
                                                <Icon className={`h-4.5 w-4.5 ${action.color}`} />
                                            </div>
                                            {action.badge && (
                                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-[#00a884] text-white">
                                                    {action.badge}
                                                </span>
                                            )}
                                        </div>
                                        <div>
                                            <p className="text-xs font-bold text-foreground truncate">{action.label}</p>
                                            <p className="text-[11px] text-muted-foreground line-clamp-1">{action.description}</p>
                                        </div>
                                    </CardContent>
                                </Card>
                            </Link>
                        );
                    })}
                </div>
            </div>

            {/* Sessions List */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Sessões Conectadas</h3>
                    <Link href="/dashboard/sessions" className="text-xs text-[#00a884] hover:underline font-medium flex items-center gap-1 transition-colors">
                        Gerenciar sessões <ArrowRight className="h-3 w-3" />
                    </Link>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {sessions.map((s) => (
                        <Card key={s.id} className="rounded-2xl border-border/40 shadow-sm">
                            <CardContent className="p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2.5 rounded-xl ${s.status === 'CONNECTED' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-500'}`}>
                                        {s.status === 'CONNECTED' ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-foreground">{s.name}</p>
                                        <p className="text-xs text-muted-foreground font-mono">ID: {s.sessionId}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Badge variant={s.status === 'CONNECTED' ? 'default' : 'destructive'} className="rounded-lg text-xs font-medium">
                                        {s.status === 'CONNECTED' ? 'Online' : 'Desconectado'}
                                    </Badge>
                                    <Link href="/dashboard/chat">
                                        <Button size="sm" variant="ghost" className="h-8 rounded-lg text-xs text-[#00a884] hover:bg-[#00a884]/10 cursor-pointer">
                                            Abrir Chat
                                        </Button>
                                    </Link>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        </div>
    );
}
