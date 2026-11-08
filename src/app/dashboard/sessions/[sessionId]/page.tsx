"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, Play, Square, RotateCcw, LogOut, Power, Trash2, QrCode, Activity, HardDrive, Wifi, MemoryStick, Copy, Check, MessageSquare } from "lucide-react";
import { setCookie } from "@/lib/client-cookie";
import { useSession } from "@/components/dashboard/session-provider";
import Link from "next/link";
import { io, Socket } from "socket.io-client";
import { QRCodeSVG } from "qrcode.react";
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

type SessionDetail = {
    id: string;
    name: string;
    sessionId: string;
    status: string;
    userId: string;
    uptime: number; // in seconds
    me?: {
        id: string;
        name: string;
    };
    hasInstance: boolean;
};

export default function SessionDetailPage() {
    const params = useParams();
    const router = useRouter();
    const rawSessionId = params?.sessionId;
    const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : (rawSessionId ?? "");

    const [session, setSession] = useState<SessionDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [socket, setSocket] = useState<Socket | null>(null);
    const [uptime, setUptime] = useState(0);
    const [systemMetrics, setSystemMetrics] = useState<any>(null);
    const [phoneNumber, setPhoneNumber] = useState("");
    const [pairingCode, setPairingCode] = useState<string | null>(null);
    const [isPairing, setIsPairing] = useState(false);

    const fetchSession = async () => {
        try {
            const res = await fetch(`/api/sessions/${sessionId}`);
            if (!res.ok) {
                if (res.status === 404) {
                    toast.error("Sessão não encontrada");
                    router.push("/dashboard/sessions");
                    return;
                }
                throw new Error("Não foi possível carregar os dados");
            }
            const responseData = await res.json();
            const data = responseData?.data;
            if (!data) throw new Error("O servidor não retornou os dados da sessão");
            setSession(data);
            setQrCode(data.qr || null);
            setPairingCode(data.pairingCode || null);
            setUptime(data.uptime || 0);
        } catch (error) {
            console.error(error);
            toast.error("Não foi possível carregar os detalhes da sessão");
        } finally {
            setLoading(false);
        }
    };

    const fetchMetrics = async () => {
        try {
            const res = await fetch(`/api/system/monitor/${sessionId}`);
            const result = await res.json();
            if (result.status) {
                setSystemMetrics(result.data);
            }
        } catch (e) {
            // silent ignore
        }
    };

    useEffect(() => {
        fetchSession();

        const socketInstance = io({
            path: "/api/socket/io",
            addTrailingSlash: false,
        });

        socketInstance.on("connect", () => {
            console.log("Connected to socket");
            socketInstance.emit("join-session", sessionId);
        });

        socketInstance.on("connection.update", (data: { status: string, qr: string, pairingCode?: string }) => {
            console.log("Socket update:", data);
            setSession(prev => prev ? { ...prev, status: data.status } : null);
            setQrCode(data.qr || null);
            if (data.pairingCode) setPairingCode(data.pairingCode);

            // Re-fetch full details on major status change (like connection) to get 'me' info
            if (data.status === 'CONNECTED') {
                fetchSession();
                setCookie("sessionId", sessionId);
                toast.success("WhatsApp conectado com sucesso! Abrindo conversas e grupos...", {
                    icon: "💬",
                    duration: 3000,
                });
                setTimeout(() => {
                    router.push(`/dashboard/chat?session=${sessionId}`);
                }, 1200);
            }
        });

        setSocket(socketInstance);

        // Uptime counter
        const interval = setInterval(() => {
            setUptime(prev => prev + 1);
        }, 1000);

        // Fetch metrics periodically
        fetchMetrics();
        const metricsInterval = setInterval(fetchMetrics, 3000);

        return () => {
            socketInstance.disconnect();
            clearInterval(interval);
            clearInterval(metricsInterval);
        };
    }, [sessionId]);

    const performAction = async (action: string, payload: any = {}) => {
        const actionNames: Record<string, string> = { start: "inicialização", stop: "parada", restart: "reinicialização", logout: "desconexão", pair: "conexão" };
        const actionSuccess: Record<string, string> = { start: "Sessão iniciada", stop: "Sessão parada", restart: "Sessão reiniciada", logout: "WhatsApp desconectado", pair: "Código de conexão gerado" };
        const loadingToast = toast.loading(`Executando ${actionNames[action] || "ação"}...`);
        try {
            const res = await fetch(`/api/sessions/${sessionId}/${action}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (!res.ok) throw new Error(data.message || data.error || "Não foi possível executar a ação");

            toast.success(actionSuccess[action] || data.message || "Ação concluída");

            // Refresh logic
            if (action === 'logout') {
                setQrCode(null);
                setPairingCode(null);
            }
            if (action === 'pair' && data.data?.pairingCode) {
                setPairingCode(data.data.pairingCode);
            }
            fetchSession();

        } catch (error: any) {
            toast.error(error.message);
        } finally {
            toast.dismiss(loadingToast);
        }
    };

    const handlePairingRequest = async () => {
        if (!phoneNumber) {
            toast.error("Digite o número de telefone");
            return;
        }
        setIsPairing(true);
        await performAction('pair', { phoneNumber });
        setIsPairing(false);
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success("Copiado para a área de transferência");
    };

    const deleteSession = async () => {
        try {
            const res = await fetch(`/api/sessions/${sessionId}/settings`, { method: 'DELETE' });
            if (res.ok) {
                toast.success("Sessão excluída");
                router.push("/dashboard/sessions");
            } else {
                toast.error("Não foi possível excluir a sessão");
            }
        } catch (e) {
            toast.error("Erro ao excluir a sessão");
        }
    };

    const formatUptime = (seconds: number) => {
        if (!session?.status || session.status !== "CONNECTED") return "Desconectada";
        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor((seconds % (3600 * 24)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${d}d ${h}h ${m}min ${s}s`;
    };

    if (loading) return <div className="p-8">Carregando...</div>;
    if (!session) return <div className="p-8">Sessão não encontrada</div>;

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
                <Button variant="ghost" asChild className="self-start">
                        <Link href="/dashboard/sessions">
                        <ArrowLeft className="mr-2 h-4 w-4" /> Voltar para sessões
                    </Link>
                </Button>
                <div className="flex-1 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 min-w-0">
                    <h1 className="text-xl sm:text-2xl font-bold truncate">
                        {session.name} <span className="text-muted-foreground font-normal text-xs sm:text-sm block sm:inline mt-1 sm:mt-0">({session.sessionId})</span>
                    </h1>
                    {session.status === 'CONNECTED' && (
                        <Button
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-2 shadow-md shrink-0 cursor-pointer self-start sm:self-auto"
                            onClick={() => {
                                setCookie("sessionId", session.sessionId);
                                router.push("/dashboard/chat");
                            }}
                        >
                            <MessageSquare className="h-4 w-4" /> Abrir Conversas e Grupos
                        </Button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Status Card */}
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle className="flex items-center justify-between">
                            Status da sessão
                            <div className={`px-3 py-1 rounded-full text-xs font-bold ${session.status === 'CONNECTED' ? 'bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400 border border-green-200 dark:border-green-800' :
                                session.status === 'STOPPED' ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400 border border-red-200 dark:border-red-800' :
                                    'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800'
                                }`}>
                                {({ CONNECTED: "Conectada", CONNECTING: "Conectando...", DISCONNECTED: "Desconectada", SCAN_QR: "Aguardando QR Code", STOPPED: "Parada", LOGGED_OUT: "Desconectada" } as Record<string, string>)[session.status] || session.status}
                            </div>
                        </CardTitle>
                        <CardDescription>Status da conexão e tempo ativo em tempo real.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 bg-muted/40 dark:bg-muted/20 border border-border/50 rounded-xl">
                                <span className="text-sm text-muted-foreground block">Tempo ativa</span>
                                <span className="text-xl font-mono font-medium text-foreground">{formatUptime(uptime)}</span>
                            </div>
                            <div className="p-4 bg-muted/40 dark:bg-muted/20 border border-border/50 rounded-xl">
                                <span className="text-sm text-muted-foreground block">Conectada como</span>
                                <span className="text-lg font-medium text-foreground truncate">{session.me?.name || session.me?.id || "-"}</span>
                            </div>
                        </div>

                        {/* System Resource Extension */}
                        {session.status === 'CONNECTED' && systemMetrics && (
                            <div className="mt-4 pt-4 border-t border-border/40">
                                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2 text-foreground"><Activity className="h-4 w-4 text-emerald-500" /> Estado do sistema</h4>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    <div className="bg-muted/40 dark:bg-muted/20 p-3 rounded-xl border border-border/50 text-center relative overflow-hidden">
                                        <Wifi className="h-4 w-4 text-emerald-500 absolute top-2 right-2" />
                                        <div className="text-xs text-muted-foreground">Ping</div>
                                        <div className="font-bold text-emerald-600 dark:text-emerald-400 mt-1 flex items-center justify-center gap-1.5">
                                            <span className="relative flex h-2 w-2">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                            </span>
                                            {systemMetrics.ping && systemMetrics.ping !== "Unknown" ? systemMetrics.ping : "Online"}
                                        </div>
                                    </div>
                                    <div className="bg-muted/40 dark:bg-muted/20 p-3 rounded-xl border border-border/50 text-center">
                                        <div className="text-xs text-muted-foreground">Contatos</div>
                                        <div className="font-bold text-foreground mt-1">{systemMetrics.store?.contacts || 0}</div>
                                    </div>
                                    <div className="bg-muted/40 dark:bg-muted/20 p-3 rounded-xl border border-border/50 text-center">
                                        <div className="text-xs text-muted-foreground">Conversas</div>
                                        <div className="font-bold text-foreground mt-1">{systemMetrics.store?.chats || 0}</div>
                                    </div>
                                    <div className="bg-muted/40 dark:bg-muted/20 p-3 rounded-xl border border-border/50 text-center relative">
                                        <MemoryStick className="h-4 w-4 text-muted-foreground/50 absolute top-2 right-2" />
                                        <div className="text-xs text-muted-foreground">Mensagens</div>
                                        <div className="font-bold text-foreground mt-1">{systemMetrics.store?.messages || 0}</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {qrCode && (
                            <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl bg-card border-border/60 relative group">
                                <div className="p-4 bg-white rounded-2xl shadow-lg border border-border/20">
                                    <QRCodeSVG value={qrCode} size={240} />
                                </div>
                                <p className="mt-4 text-sm text-muted-foreground animate-pulse">Escaneie com o WhatsApp para conectar</p>

                                <div className="mt-6 pt-6 border-t w-full">
                                    <div className="flex flex-col items-center gap-3">
                                        <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Ou conecte usando seu número de telefone</div>
                                        <div className="flex flex-col w-full max-w-sm gap-2 mt-1">
                                            <div className="flex gap-2">
                                                <Input
                                                    placeholder="628123456789"
                                                    value={phoneNumber}
                                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhoneNumber(e.target.value)}
                                                    className="font-mono"
                                                />
                                                <Button onClick={handlePairingRequest} disabled={isPairing || !phoneNumber}>
                                                    Conectar
                                                </Button>
                                            </div>
                                            <p className="text-[10px] text-muted-foreground text-center">Inclua o código do país, sem + nem espaços (ex.: 5511999999999)</p>
                                        </div>
                                        {pairingCode && (
                                            <div className="mt-4 p-4 bg-slate-900 rounded-lg w-full max-w-[320px] text-center border-2 border-slate-700 shadow-xl relative group/code">
                                                <div className="text-[10px] text-slate-400 uppercase tracking-[0.2em] mb-2 font-semibold">Seu código de conexão</div>
                                                <div
                                                    className="text-3xl font-mono font-bold text-white tracking-[0.3em] flex justify-center cursor-pointer hover:text-blue-400 transition-colors py-2"
                                                    onClick={() => copyToClipboard(pairingCode)}
                                                    title="Clique para copiar"
                                                >
                                                    {pairingCode.toUpperCase().replace('-', '').split('').map((char, i) => (
                                                        <span key={i} className="flex items-center">
                                                            {char}
                                                            {i === 3 && <span className="mx-2 text-slate-600 opacity-50">-</span>}
                                                        </span>
                                                    ))}
                                                </div>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="absolute top-2 right-2 h-7 w-7 text-slate-500 hover:text-white"
                                                    onClick={() => copyToClipboard(pairingCode)}
                                                >
                                                    <Copy className="h-3.5 w-3.5" />
                                                </Button>
                                                <div className="text-[9px] text-slate-500 mt-2 italic">Digite este código no seu celular</div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Actions Panel */}
                <Card>
                    <CardHeader>
                        <CardTitle>Controles</CardTitle>
                        <CardDescription>Gerencie esta sessão.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <Button
                            variant="outline"
                            className="w-full justify-start text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30"
                            onClick={() => performAction('start')}
                                disabled={session.status === 'CONNECTED' || session.status === 'CONNECTING' || session.status === 'SCAN_QR'}
                        >
                            <Play className="mr-2 h-4 w-4" /> Iniciar sessão
                        </Button>

                        <Button
                            variant="outline"
                            className="w-full justify-start text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/30"
                            onClick={() => performAction('restart')}
                            disabled={!session.hasInstance && session.status !== 'CONNECTED'}
                        >
                            <RotateCcw className="mr-2 h-4 w-4" /> Reiniciar sessão
                        </Button>

                        <Button
                            variant="outline"
                            className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                            onClick={() => performAction('stop')}
                            disabled={session.status === 'STOPPED'}
                        >
                            <Square className="mr-2 h-4 w-4" /> Parar sessão
                        </Button>

                        <div className="border-t my-4 pt-4 space-y-3">
                            <Button
                                variant="outline"
                                className="w-full justify-start"
                                onClick={() => performAction('logout')}
                                disabled={session.status !== 'CONNECTED'}
                            >
                                <LogOut className="mr-2 h-4 w-4" /> Desconectar
                            </Button>

                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button
                                        variant="destructive"
                                        className="w-full justify-start"
                                    >
                                        <Trash2 className="mr-2 h-4 w-4" /> Excluir sessão
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            Esta ação não pode ser desfeita. A sessão e os dados de conexão serão excluídos permanentemente.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                        <AlertDialogAction onClick={deleteSession} className="bg-red-600 hover:bg-red-700">
                                            Excluir
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
