"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
    Instagram,
    Plus,
    Trash2,
    Send,
    Clock,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Upload,
    Link2,
    Calendar,
    RefreshCw,
    HelpCircle,
} from "lucide-react";
import { toast } from "sonner";

interface IgAccount {
    id: string;
    username: string;
    igUserId: string;
    publicBaseUrl?: string | null;
    isActive: boolean;
    createdAt: string;
    _count?: { posts: number };
}

interface IgPost {
    id: string;
    accountId: string;
    mediaType: "IMAGE" | "REELS" | "STORIES";
    mediaUrl: string;
    caption: string | null;
    scheduledAt: string;
    repeatDaily: boolean;
    status: "PENDING" | "PUBLISHING" | "PUBLISHED" | "FAILED";
    igMediaId: string | null;
    error: string | null;
    publishedAt: string | null;
    account: {
        id: string;
        username: string;
        igUserId: string;
    };
}

export default function InstagramPostsPage() {
    const [accounts, setAccounts] = useState<IgAccount[]>([]);
    const [posts, setPosts] = useState<IgPost[]>([]);
    const [loading, setLoading] = useState(true);

    // Account form
    const [showAccountForm, setShowAccountForm] = useState(false);
    const [username, setUsername] = useState("");
    const [igUserId, setIgUserId] = useState("");
    const [accessToken, setAccessToken] = useState("");
    const [publicBaseUrl, setPublicBaseUrl] = useState("");
    const [savingAccount, setSavingAccount] = useState(false);

    // Post form
    const [selectedAccountId, setSelectedAccountId] = useState("");
    const [mediaType, setMediaType] = useState<"IMAGE" | "REELS" | "STORIES">("IMAGE");
    const [mediaFile, setMediaFile] = useState<File | null>(null);
    const [remoteUrl, setRemoteUrl] = useState("");
    const [caption, setCaption] = useState("");
    const [scheduledAt, setScheduledAt] = useState("");
    const [repeatDaily, setRepeatDaily] = useState(false);
    const [submittingPost, setSubmittingPost] = useState(false);

    useEffect(() => {
        if (typeof window !== "undefined" && !publicBaseUrl) {
            const origin = window.location.origin;
            if (origin.startsWith("https://")) {
                setPublicBaseUrl(origin);
            }
        }
    }, [publicBaseUrl]);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [accRes, postRes] = await Promise.all([
                fetch("/api/instagram/accounts"),
                fetch("/api/instagram/posts"),
            ]);
            const accJson = await accRes.json().catch(() => ({}));
            const postJson = await postRes.json().catch(() => ({}));
            if (accJson?.status && Array.isArray(accJson.data)) {
                setAccounts(accJson.data);
                if (accJson.data.length > 0 && !selectedAccountId) {
                    setSelectedAccountId(accJson.data[0].id);
                }
            }
            if (postJson?.status && Array.isArray(postJson.data)) {
                setPosts(postJson.data);
            }
        } catch {
            toast.error("Erro ao carregar dados do Instagram");
        } finally {
            setLoading(false);
        }
    }, [selectedAccountId]);

    useEffect(() => {
        void fetchData();
    }, [fetchData]);

    const handleSaveAccount = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!username.trim() || !igUserId.trim() || !accessToken.trim()) {
            toast.error("Preencha @usuário, Instagram Business ID e Access Token");
            return;
        }
        setSavingAccount(true);
        try {
            const res = await fetch("/api/instagram/accounts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    username: username.trim(),
                    igUserId: igUserId.trim(),
                    accessToken: accessToken.trim(),
                    publicBaseUrl: publicBaseUrl.trim() || null,
                }),
            });
            const json = await res.json();
            if (!res.ok || !json?.status) {
                toast.error(json?.message || "Falha ao validar conta na Meta");
                return;
            }
            toast.success(`Conta @${json.data.username} conectada com sucesso!`);
            setUsername("");
            setIgUserId("");
            setAccessToken("");
            setShowAccountForm(false);
            setSelectedAccountId(json.data.id);
            await fetchData();
        } catch {
            toast.error("Erro ao conectar conta do Instagram");
        } finally {
            setSavingAccount(false);
        }
    };

    const handleDeleteAccount = async (id: string) => {
        try {
            const res = await fetch(`/api/instagram/accounts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
            if (res.ok) {
                toast.success("Conta removida");
                await fetchData();
            }
        } catch {
            toast.error("Erro ao remover conta");
        }
    };

    const handleSchedulePost = async (publishNow: boolean) => {
        if (!selectedAccountId) {
            toast.error("Cadastre ou selecione uma conta do Instagram primeiro");
            return;
        }
        if (!mediaFile && !remoteUrl.trim()) {
            toast.error("Envie uma imagem/vídeo ou informe a URL HTTPS da mídia");
            return;
        }
        if (!publishNow && !scheduledAt) {
            toast.error("Escolha a data e hora do agendamento");
            return;
        }

        setSubmittingPost(true);
        try {
            const fd = new FormData();
            fd.append("accountId", selectedAccountId);
            fd.append("mediaType", mediaType);
            fd.append("caption", caption);
            fd.append("repeatDaily", String(repeatDaily));
            fd.append("publishNow", String(publishNow));
            if (scheduledAt) {
                fd.append("scheduledAt", new Date(scheduledAt).toISOString());
            }
            if (mediaFile) {
                fd.append("file", mediaFile);
            } else {
                fd.append("mediaUrl", remoteUrl.trim());
            }

            const res = await fetch("/api/instagram/posts", {
                method: "POST",
                body: fd,
            });
            const json = await res.json();
            if (!res.ok || !json?.status) {
                toast.error(json?.message || "Erro ao processar publicação");
                await fetchData();
                return;
            }
            toast.success(json.message || "Concluído!");
            setMediaFile(null);
            setRemoteUrl("");
            setCaption("");
            setScheduledAt("");
            setRepeatDaily(false);
            await fetchData();
        } catch {
            toast.error("Falha na comunicação com o servidor");
        } finally {
            setSubmittingPost(false);
        }
    };

    const handleDeletePost = async (id: string) => {
        try {
            const res = await fetch(`/api/instagram/posts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
            if (res.ok) {
                toast.success("Publicação removida");
                setPosts((prev) => prev.filter((p) => p.id !== id));
            }
        } catch {
            toast.error("Erro ao remover publicação");
        }
    };

    return (
        <div className="space-y-6 max-w-6xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
                        <span className="h-9 w-9 rounded-xl bg-gradient-to-tr from-amber-500 via-pink-500 to-purple-600 text-white flex items-center justify-center shadow-sm">
                            <Instagram className="h-5 w-5" />
                        </span>
                        Publicações Instagram
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Agende posts (Feed, Reels ou Stories) via API Oficial da Meta para suas contas cadastradas.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="gap-1.5 cursor-pointer">
                        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                        Atualizar
                    </Button>
                    <Button size="sm" onClick={() => setShowAccountForm((v) => !v)} className="gap-1.5 cursor-pointer">
                        <Plus className="h-4 w-4" />
                        {showAccountForm ? "Fechar" : "Conectar Conta Instagram"}
                    </Button>
                </div>
            </div>

            {showAccountForm && (
                <Card className="border-primary/20">
                    <CardHeader>
                        <CardTitle className="text-base">Conectar Conta Profissional do Instagram (API Oficial Meta)</CardTitle>
                        <CardDescription>
                            A conta precisa estar no modo Profissional vinculada a uma Página do Facebook e com app no Meta for Developers (`instagram_content_publish`).
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSaveAccount} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <Label>Usuário do Instagram (@)</Label>
                                <Input placeholder="ex: minhaloja" value={username} onChange={(e) => setUsername(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Instagram Business Account ID</Label>
                                <Input placeholder="ex: 1784140..." value={igUserId} onChange={(e) => setIgUserId(e.target.value)} />
                            </div>
                            <div className="space-y-1.5 md:col-span-2">
                                <Label>Access Token (Meta Graph API)</Label>
                                <Input
                                    type="password"
                                    placeholder="EAA..."
                                    value={accessToken}
                                    onChange={(e) => setAccessToken(e.target.value)}
                                />
                            </div>
                            <div className="space-y-1.5 md:col-span-2">
                                <Label className="flex items-center gap-1.5">
                                    URL Pública HTTPS do ZapFlow
                                    <span className="text-xs text-muted-foreground font-normal">
                                        (para a Meta baixar imagens/vídeos enviados aqui)
                                    </span>
                                </Label>
                                <Input
                                    placeholder="https://seu-dominio.com"
                                    value={publicBaseUrl}
                                    onChange={(e) => setPublicBaseUrl(e.target.value)}
                                />
                            </div>
                            <div className="md:col-span-2 flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => setShowAccountForm(false)}>
                                    Cancelar
                                </Button>
                                <Button type="submit" disabled={savingAccount} className="gap-1.5">
                                    {savingAccount && <Loader2 className="h-4 w-4 animate-spin" />}
                                    Validar e Salvar Conta
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left column: Accounts + New Post */}
                <div className="lg:col-span-1 space-y-6">
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Contas Conectadas ({accounts.length})</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {accounts.length === 0 ? (
                                <div className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/40 flex items-start gap-2">
                                    <HelpCircle className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                                    <span>Nenhuma conta conectada. Clique em &quot;Conectar Conta Instagram&quot; acima.</span>
                                </div>
                            ) : (
                                accounts.map((acc) => (
                                    <div
                                        key={acc.id}
                                        onClick={() => setSelectedAccountId(acc.id)}
                                        className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-colors ${
                                            selectedAccountId === acc.id
                                                ? "border-primary bg-primary/5"
                                                : "border-border/50 hover:bg-muted/40"
                                        }`}
                                    >
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold truncate">@{acc.username}</p>
                                            <p className="text-[11px] text-muted-foreground font-mono truncate">ID: {acc.igUserId}</p>
                                        </div>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-7 w-7 text-destructive hover:text-destructive"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                void handleDeleteAccount(acc.id);
                                            }}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                ))
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Nova Publicação</CardTitle>
                            <CardDescription className="text-xs">
                                Envie foto/vídeo para publicar agora ou agendar no horário desejado.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-1.5">
                                <Label>Formato</Label>
                                <div className="grid grid-cols-3 gap-2">
                                    {(["IMAGE", "REELS", "STORIES"] as const).map((t) => (
                                        <button
                                            key={t}
                                            type="button"
                                            onClick={() => setMediaType(t)}
                                            className={`py-1.5 px-2 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                                                mediaType === t
                                                    ? "bg-primary text-primary-foreground border-primary"
                                                    : "bg-background hover:bg-muted border-border"
                                            }`}
                                        >
                                            {t === "IMAGE" ? "Feed (Foto)" : t === "REELS" ? "Reels (Vídeo)" : "Stories"}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <Label className="flex items-center gap-1.5">
                                    <Upload className="h-3.5 w-3.5" /> Enviar Arquivo
                                    <span className="text-[11px] text-muted-foreground font-normal">
                                        {mediaType === "REELS" ? "(MP4)" : mediaType === "STORIES" ? "(JPEG ou MP4)" : "(Apenas JPEG .jpg/.jpeg)"}
                                    </span>
                                </Label>
                                <Input
                                    type="file"
                                    accept={
                                        mediaType === "REELS"
                                            ? "video/mp4,.mp4"
                                            : mediaType === "STORIES"
                                              ? ".jpg,.jpeg,image/jpeg,video/mp4,.mp4"
                                              : ".jpg,.jpeg,image/jpeg"
                                    }
                                    onChange={(e) => {
                                        const f = e.target.files?.[0] || null;
                                        if (!f) {
                                            setMediaFile(null);
                                            return;
                                        }
                                        const isJpeg =
                                            f.type === "image/jpeg" ||
                                            /\.(jpe?g)$/i.test(f.name || "");
                                        const isMp4 =
                                            f.type === "video/mp4" ||
                                            /\.mp4$/i.test(f.name || "");
                                        if (mediaType === "IMAGE" && !isJpeg) {
                                            toast.error("A API do Instagram aceita apenas imagens JPEG (.jpg / .jpeg).");
                                            e.target.value = "";
                                            setMediaFile(null);
                                            return;
                                        }
                                        if (mediaType === "STORIES" && !isJpeg && !isMp4) {
                                            toast.error("Stories aceita apenas imagem JPEG (.jpg/.jpeg) ou vídeo MP4.");
                                            e.target.value = "";
                                            setMediaFile(null);
                                            return;
                                        }
                                        if (mediaType === "REELS" && !isMp4) {
                                            toast.error("Reels aceita apenas vídeo MP4.");
                                            e.target.value = "";
                                            setMediaFile(null);
                                            return;
                                        }
                                        setMediaFile(f);
                                    }}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <Link2 className="h-3.5 w-3.5" /> Ou URL pública HTTPS da mídia
                                </Label>
                                <Input
                                    placeholder="https://..."
                                    value={remoteUrl}
                                    onChange={(e) => setRemoteUrl(e.target.value)}
                                    disabled={Boolean(mediaFile)}
                                />
                            </div>

                            {mediaType !== "STORIES" && (
                                <div className="space-y-1.5">
                                    <Label>Legenda</Label>
                                    <Textarea
                                        rows={4}
                                        placeholder="Escreva a legenda e hashtags da publicação..."
                                        value={caption}
                                        onChange={(e) => setCaption(e.target.value)}
                                    />
                                </div>
                            )}

                            <div className="space-y-1.5">
                                <Label className="flex items-center gap-1.5">
                                    <Calendar className="h-3.5 w-3.5" /> Data e Hora (Agendamento)
                                </Label>
                                <Input
                                    type="datetime-local"
                                    value={scheduledAt}
                                    onChange={(e) => setScheduledAt(e.target.value)}
                                />
                            </div>

                            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={repeatDaily}
                                    onChange={(e) => setRepeatDaily(e.target.checked)}
                                    className="h-4 w-4 accent-primary"
                                />
                                <span>Repetir todos os dias nesse horário</span>
                            </label>

                            <div className="grid grid-cols-2 gap-2 pt-1">
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={submittingPost}
                                    onClick={() => handleSchedulePost(true)}
                                    className="gap-1.5 cursor-pointer"
                                >
                                    {submittingPost ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                    Postar Agora
                                </Button>
                                <Button
                                    type="button"
                                    disabled={submittingPost}
                                    onClick={() => handleSchedulePost(false)}
                                    className="gap-1.5 cursor-pointer"
                                >
                                    {submittingPost ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
                                    Agendar
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Right column: Scheduled & Published Posts */}
                <div className="lg:col-span-2">
                    <Card className="h-full">
                        <CardHeader>
                            <CardTitle className="text-base">Fila e Histórico de Publicações ({posts.length})</CardTitle>
                            <CardDescription>
                                O agendador do servidor verifica e publica automaticamente a cada 30 segundos.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {posts.length === 0 ? (
                                <div className="text-center py-12 text-sm text-muted-foreground">
                                    Nenhuma publicação agendada ou enviada ainda.
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {posts.map((post) => (
                                        <div
                                            key={post.id}
                                            className="p-3.5 rounded-xl border border-border/50 bg-card/60 flex items-start justify-between gap-3"
                                        >
                                            <div className="space-y-1.5 min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <Badge variant="outline" className="text-[11px]">
                                                        @{post.account.username}
                                                    </Badge>
                                                    <Badge variant="secondary" className="text-[11px]">
                                                        {post.mediaType}
                                                    </Badge>
                                                    {post.status === "PUBLISHED" && (
                                                        <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 gap-1 text-[11px]">
                                                            <CheckCircle2 className="h-3 w-3" /> Publicado
                                                        </Badge>
                                                    )}
                                                    {post.status === "PENDING" && (
                                                        <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30 gap-1 text-[11px]">
                                                            <Clock className="h-3 w-3" /> Agendado
                                                        </Badge>
                                                    )}
                                                    {post.status === "PUBLISHING" && (
                                                        <Badge className="bg-blue-500/15 text-blue-600 border-blue-500/30 gap-1 text-[11px]">
                                                            <Loader2 className="h-3 w-3 animate-spin" /> Publicando
                                                        </Badge>
                                                    )}
                                                    {post.status === "FAILED" && (
                                                        <Badge variant="destructive" className="gap-1 text-[11px]">
                                                            <AlertCircle className="h-3 w-3" /> Falhou
                                                        </Badge>
                                                    )}
                                                    {post.repeatDaily && (
                                                        <Badge variant="outline" className="text-[10px]">
                                                            Diário
                                                        </Badge>
                                                    )}
                                                </div>

                                                {post.caption && (
                                                    <p className="text-xs text-foreground/90 line-clamp-2 whitespace-pre-wrap">
                                                        {post.caption}
                                                    </p>
                                                )}

                                                <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                                                    <span>
                                                        Programado: {new Date(post.scheduledAt).toLocaleString("pt-BR")}
                                                    </span>
                                                    {post.igMediaId && <span>IG Media ID: {post.igMediaId}</span>}
                                                </div>

                                                {post.error && (
                                                    <p className="text-xs text-destructive bg-destructive/10 px-2.5 py-1.5 rounded-md">
                                                        {post.error}
                                                    </p>
                                                )}
                                            </div>

                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                                                onClick={() => handleDeletePost(post.id)}
                                                title="Excluir"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
