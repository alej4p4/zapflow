'use client';

import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import QRCode from 'qrcode';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card";
import { useRouter } from 'next/navigation';
import { toast } from "sonner";
import { Label } from '@/components/ui/label';
import { Smartphone, Plus, Trash2, Settings, RefreshCw, Power, UserPlus, MessageSquare, ExternalLink } from 'lucide-react';
import { setCookie } from '@/lib/client-cookie';
import { useSession } from './session-provider';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

type Session = {
    id: string;
    name: string;
    sessionId: string;
    status: string;
    qr?: string | null;
    user?: {
        name: string | null;
        email: string;
    } | null;
};

let globalSessionListCache: Session[] | null = null;

export function SessionManager({ user }: { user: any }) {
    const [sessions, setSessions] = useState<Session[]>(() => globalSessionListCache || []);
    const [newSessionName, setNewSessionName] = useState("");
    const [newSessionId, setNewSessionId] = useState("");
    const [loading, setLoading] = useState(false);
    const [socket, setSocket] = useState<Socket | null>(null);
    const router = useRouter();

    useEffect(() => {
        fetchSessions();

        // Init Socket
        const socketInstance = io({
            path: "/api/socket/io",
            addTrailingSlash: false,
        });

        socketInstance.on('connect', () => {
            console.log('Socket connected');
        });

        socketInstance.on('connection.update', (data: { sessionId: string, status: string, qr: string }) => {
            // Update specific session status if match
            setSessions(prev => prev.map(s => {
                if (s.sessionId === data.sessionId) {
                    return { ...s, status: data.status, qr: data.qr };
                }
                return s;
            }));

            if (data.status === 'CONNECTED') {
                fetchSessions(); // Refresh purely to get updated state from DB if needed
                setCookie("sessionId", data.sessionId);
                toast.success("WhatsApp conectado com sucesso! Abrindo conversas e grupos...", {
                    icon: "💬",
                    duration: 3000,
                });
                setTimeout(() => {
                    router.push(`/dashboard/chat?session=${data.sessionId}`);
                }, 1200);
            }
        });

        setSocket(socketInstance);

        return () => {
            socketInstance.disconnect();
        };
    }, []);

    const fetchSessions = () => {
        fetch('/api/sessions').then(res => res.json()).then(responseData => {
            const data = responseData?.data || [];
            if (Array.isArray(data)) {
                globalSessionListCache = data;
                setSessions(data);
            }
        });
    };

    const createSession = async () => {
        if (!newSessionName) {
            toast.error("O nome da sessão é obrigatório");
            return;
        }

        // If ID matches existing
        if (newSessionId && sessions.some(s => s.sessionId === newSessionId)) {
            toast.error("Este ID de sessão já existe");
            return;
        }

        setLoading(true);
        try {
            const res = await fetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user.id,
                    name: newSessionName,
                    sessionId: newSessionId || undefined // Optional, backend will generate if empty
                })
            });
            const responseData = await res.json();
            const session = responseData?.data;

            if (!res.ok || !session) throw new Error(responseData.error || responseData.message || "Não foi possível criar a sessão");

            setSessions([...sessions, session]);
            setNewSessionName("");
            setNewSessionId("");
            const start = await fetch(`/api/sessions/${session.sessionId}/start`, { method: "POST" });
            router.push(`/dashboard/sessions/${session.sessionId}`);
            if (start.ok) toast.success("Sessão criada. Escaneie o QR Code para conectar o WhatsApp.");
            else toast.error("Sessão criada, mas não foi possível iniciá-la. Tente novamente na tela da sessão.");
        } catch (e: any) {
            console.error(e);
            toast.error(e.message || "Não foi possível criar a sessão");
        } finally {
            setLoading(false);
        }
    };

    const handleManageSession = (sessionId: string) => {
        router.push(`/dashboard/sessions/${sessionId}`);
    }

    return (
        <div className="space-y-8">
            {/* Create New Session Card */}
            <Card className="bg-[#f0f2f5] dark:bg-[#202c33] border-dashed border-2 border-border/60 dark:border-[#2a3942] rounded-2xl shadow-xs">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2 text-foreground dark:text-[#e9edef]">
                        <Plus className="h-5 w-5 text-[#00a884]" /> Criar nova sessão
                    </CardTitle>
                    <CardDescription className="text-muted-foreground dark:text-[#8696a0]">
                        Adicione uma conta do WhatsApp para gerenciá-la.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                        <div className="space-y-2">
                            <Label htmlFor="session-name" className="text-foreground dark:text-[#e9edef] font-medium">Nome da sessão</Label>
                            <Input
                                id="session-name"
                                value={newSessionName}
                                onChange={e => setNewSessionName(e.target.value)}
                                placeholder="WhatsApp da empresa" className="bg-white dark:bg-[#111b21] border-border/80 dark:border-[#2a3942] text-foreground dark:text-[#e9edef] rounded-xl focus:border-[#00a884]" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="session-id" className="text-foreground dark:text-[#e9edef] font-medium">ID personalizado (opcional)</Label>
                            <Input
                                id="session-id"
                                value={newSessionId}
                                onChange={e => setNewSessionId(e.target.value.replace(/[^a-zA-Z0-9-_]/g, ''))}
                                placeholder="unique-id-123" className="bg-white dark:bg-[#111b21] border-border/80 dark:border-[#2a3942] text-foreground dark:text-[#e9edef] rounded-xl focus:border-[#00a884]" />
                            <p className="text-[10px] text-muted-foreground">Use apenas letras, números e hífens.</p>
                        </div>
                        <Button onClick={createSession} disabled={loading} className="bg-[#00a884] hover:bg-[#00a884]/90 text-white font-medium rounded-xl h-10 shadow-xs cursor-pointer">
                            {loading ? 'Criando...' : 'Criar sessão'}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Sessions Table Card */}
            <div>
                {sessions.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground bg-slate-50 dark:bg-slate-900 rounded-lg border border-border/50">
                        Nenhuma sessão encontrada. Crie uma acima para começar.
                    </div>
                ) : (
                    <Card className="glass-panel border-border/50 shadow-sm overflow-hidden">
                        <CardHeader className="pb-3 pt-5 px-5">
                            <CardTitle className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                Sessões cadastradas ({sessions.length})
                            </CardTitle>
                            <CardDescription>
                                Lista de sessões do WhatsApp e o status atual da conexão.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-0 overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="px-5 text-xs uppercase tracking-wider font-semibold">Sessão / aparelho</TableHead>
                                        <TableHead className="text-xs uppercase tracking-wider font-semibold">Status</TableHead>
                                        <TableHead className="text-xs uppercase tracking-wider font-semibold">Responsável</TableHead>
                                        <TableHead className="text-right px-5 text-xs uppercase tracking-wider font-semibold">Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sessions.map(session => (
                                        <TableRow key={session.id} className="hover:bg-muted/20 dark:hover:bg-muted/5 transition-colors">
                                            <TableCell className="px-5 py-3 font-medium">
                                                <div className="font-semibold text-slate-800 dark:text-slate-200 text-sm">{session.name}</div>
                                                <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{session.sessionId}</div>
                                            </TableCell>
                                            <TableCell className="py-3">
                                                <Badge 
                                                    variant={session.status === 'CONNECTED' ? 'default' : 'secondary'}
                                                    className={`text-[10px] font-semibold transition-all px-2 py-0.5 shrink-0 inline-flex items-center ${
                                                        session.status === 'CONNECTED' 
                                                            ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 hover:bg-emerald-500/20' 
                                                            : 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 hover:bg-slate-100'
                                                    }`}
                                                >
                                                    <span className={`h-1.5 w-1.5 rounded-full mr-1.5 ${
                                                        session.status === 'CONNECTED' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                                                    }`} />
                                                    {({ CONNECTED: "Conectada", CONNECTING: "Conectando...", DISCONNECTED: "Desconectada", SCAN_QR: "Aguardando QR Code", STOPPED: "Parada", LOGGED_OUT: "Desconectada" } as Record<string, string>)[session.status] || session.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="py-3">
                                                {session.user ? (
                                                    <div className="leading-tight">
                                                            <div className="font-semibold text-slate-700 dark:text-slate-300 text-xs">{session.user.name || "Sem nome"}</div>
                                                        <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{session.user.email}</div>
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground/50">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="py-3 text-right px-5">
                                                <div className="flex items-center justify-end gap-2">
                                                    {session.status === 'CONNECTED' && (
                                                        <Button 
                                                            size="sm" 
                                                            className="h-8 px-2.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-colors gap-1.5 shadow-xs cursor-pointer"
                                                            onClick={() => {
                                                                setCookie("sessionId", session.sessionId);
                                                                router.push("/dashboard/chat");
                                                            }}
                                                        >
                                                            <MessageSquare className="h-3.5 w-3.5" /> Abrir Conversas
                                                        </Button>
                                                    )}
                                                    <Button 
                                                        variant="outline" 
                                                        size="sm" 
                                                        className="h-8 px-2.5 text-xs rounded-lg hover:bg-primary/5 transition-colors border-border/50"
                                                        onClick={() => router.push(`/dashboard/sessions/access?session=${session.sessionId}`)}
                                                    >
                                                        <UserPlus className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" /> Compartilhar
                                                    </Button>
                                                    <Button 
                                                        variant="outline" 
                                                        size="sm" 
                                                        className="h-8 px-2.5 text-xs rounded-lg hover:bg-primary/5 transition-colors border-border/50"
                                                        onClick={() => handleManageSession(session.sessionId)}
                                                    >
                                                        <Settings className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" /> Gerenciar
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}
