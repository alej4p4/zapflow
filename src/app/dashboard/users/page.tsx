"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Trash2,
    Plus,
    Edit,
    User,
    Shield,
    ShieldAlert,
    ShieldCheck,
    Users as UsersIcon,
    Check,
    CheckSquare,
    Square,
    Sparkles,
    Eye,
    EyeOff,
    Layers,
    Lock
} from "lucide-react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
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
import { SYSTEM_TABS, PERMISSION_PRESETS, TabDefinition } from "@/lib/permissions";

interface UserProfile {
    id: string;
    name: string | null;
    email: string;
    role: "SUPERADMIN" | "OWNER" | "STAFF";
    permissions?: string[] | null;
    createdAt: string;
    _count?: {
        sessions: number;
    };
}

export default function UsersPage() {
    const { data: session } = useSession();
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingUser, setEditingUser] = useState<UserProfile | null>(null);

    // Form state
    const [formData, setFormData] = useState<{
        name: string;
        email: string;
        password: string;
        role: "SUPERADMIN" | "OWNER" | "STAFF";
        permissions: string[];
    }>({
        name: "",
        email: "",
        password: "",
        role: "STAFF",
        permissions: [
            "/dashboard/chat",
            "/dashboard/kanban",
            "/dashboard/contacts",
            "/dashboard/labels",
            "/dashboard/scheduler"
        ]
    });

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        try {
            const res = await fetch("/api/users");
            if (res.ok) {
                const responseData = await res.json();
                setUsers(responseData?.data || []);
            } else if (res.status === 403) {
                toast.error("Não autorizado. Somente Superadministradores podem gerenciar usuários.");
            }
        } catch (error) {
            console.error("Failed to fetch users", error);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenCreate = () => {
        setEditingUser(null);
        setFormData({
            name: "",
            email: "",
            password: "",
            role: "STAFF",
            permissions: [
                "/dashboard/chat",
                "/dashboard/kanban",
                "/dashboard/contacts",
                "/dashboard/labels",
                "/dashboard/scheduler"
            ]
        });
        setShowForm(true);
    };

    const handleOpenEdit = (user: UserProfile) => {
        setEditingUser(user);
        const existingPermissions = Array.isArray(user.permissions)
            ? user.permissions
            : user.role === "SUPERADMIN"
                ? SYSTEM_TABS.map(t => t.path)
                : [
                    "/dashboard/chat",
                    "/dashboard/kanban",
                    "/dashboard/contacts",
                    "/dashboard/labels",
                    "/dashboard/scheduler"
                ];

        setFormData({
            name: user.name || "",
            email: user.email,
            password: "",
            role: user.role,
            permissions: existingPermissions
        });
        setShowForm(true);
    };

    const togglePermission = (path: string) => {
        setFormData(prev => {
            const has = prev.permissions.includes(path);
            const updated = has
                ? prev.permissions.filter(p => p !== path)
                : [...prev.permissions, path];
            return { ...prev, permissions: updated };
        });
    };

    const applyPreset = (paths: string[]) => {
        setFormData(prev => ({
            ...prev,
            permissions: paths
        }));
        toast.info("Modelo de permissões aplicado!");
    };

    const selectAllPermissions = () => {
        setFormData(prev => ({
            ...prev,
            permissions: SYSTEM_TABS.map(t => t.path)
        }));
    };

    const clearAllPermissions = () => {
        setFormData(prev => ({
            ...prev,
            permissions: []
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        try {
            const url = editingUser ? `/api/users/${editingUser.id}` : "/api/users";
            const method = editingUser ? "PATCH" : "POST";

            const payload: any = {
                name: formData.name,
                email: formData.email,
                role: formData.role,
                permissions: formData.role === "SUPERADMIN" ? SYSTEM_TABS.map(t => t.path) : formData.permissions
            };

            if (formData.password) {
                payload.password = formData.password;
            }

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                toast.success(editingUser ? "Usuário e permissões atualizados com sucesso!" : "Novo usuário criado com sucesso!");
                setShowForm(false);
                setEditingUser(null);
                fetchUsers();
            } else {
                const error = await res.json();
                toast.error(error.error || "A operação falhou");
            }
        } catch (error) {
            toast.error("A operação falhou ao salvar usuário");
        }
    };

    const [deleteId, setDeleteId] = useState<string | null>(null);

    const handleDelete = async (id: string) => {
        try {
            const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
            if (res.ok) {
                toast.success("Usuário excluído com sucesso");
                fetchUsers();
            } else {
                const error = await res.json();
                toast.error(error.error || "Não foi possível excluir o usuário");
            }
        } catch (error) {
            toast.error("Erro ao excluir usuário");
        } finally {
            setDeleteId(null);
        }
    };

    const getRoleBadge = (role: string) => {
        switch (role) {
            case "SUPERADMIN":
                return (
                    <Badge variant="default" className="bg-red-500/10 text-red-600 hover:bg-red-500/20 border-red-200">
                        <ShieldAlert className="h-3 w-3 mr-1" /> Superadmin (Master)
                    </Badge>
                );
            case "OWNER":
                return (
                    <Badge variant="default" className="bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 border-blue-200">
                        <ShieldCheck className="h-3 w-3 mr-1" /> Responsável
                    </Badge>
                );
            default:
                return (
                    <Badge variant="outline" className="bg-muted/50 text-foreground border-border">
                        <User className="h-3 w-3 mr-1" /> Atendente
                    </Badge>
                );
        }
    };

    // Group tabs by category for the permissions UI
    const tabsByCategory = SYSTEM_TABS.reduce<Record<string, TabDefinition[]>>((acc, tab) => {
        if (!acc[tab.category]) acc[tab.category] = [];
        acc[tab.category].push(tab);
        return acc;
    }, {});

    if (loading) return <div className="p-12 text-center text-muted-foreground">Carregando usuários...</div>;

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                        <UsersIcon className="h-6 w-6 text-primary" /> Gerenciamento de usuários & perfis
                    </h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Cadastre atendentes e configure quais abas e recursos cada um pode visualizar e utilizar.
                    </p>
                </div>
                <Button size="sm" onClick={handleOpenCreate} className="gap-2 shadow-sm">
                    <Plus className="h-4 w-4" /> Novo usuário
                </Button>
            </div>

            {/* Formulário de Criação / Edição com Controle de Abas */}
            {showForm && (
                <Card className="border-2 border-primary/30 shadow-lg animate-in fade-in duration-200">
                    <CardHeader className="border-b border-border/50 pb-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-xl flex items-center gap-2">
                                    {editingUser ? <Edit className="h-5 w-5 text-primary" /> : <Plus className="h-5 w-5 text-primary" />}
                                    {editingUser ? `Editar Usuário: ${editingUser.name || editingUser.email}` : "Novo Usuário"}
                                </CardTitle>
                                <CardDescription className="mt-1">
                                    Preencha os dados de acesso e marque as abas liberadas para este perfil.
                                </CardDescription>
                            </div>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>
                                Fechar
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <form onSubmit={handleSubmit} className="space-y-6">
                            {/* Dados Básicos */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="user-name">Nome completo</Label>
                                    <Input
                                        id="user-name"
                                        placeholder="Ex: Carlos Atendente"
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="user-email">E-mail de login</Label>
                                    <Input
                                        id="user-email"
                                        type="email"
                                        placeholder="atendente@empresa.com"
                                        value={formData.email}
                                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="user-pass">
                                        {editingUser ? "Nova senha (em branco mantém a atual)" : "Senha de acesso"}
                                    </Label>
                                    <Input
                                        id="user-pass"
                                        type="password"
                                        placeholder="••••••••"
                                        value={formData.password}
                                        onChange={e => setFormData({ ...formData, password: e.target.value })}
                                        required={!editingUser}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="user-role">Nível de Função</Label>
                                    <Select
                                        value={formData.role}
                                        onValueChange={(v: "SUPERADMIN" | "OWNER" | "STAFF") => setFormData({ ...formData, role: v })}
                                    >
                                        <SelectTrigger id="user-role">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="STAFF">Atendente (Permissões granulares)</SelectItem>
                                            <SelectItem value="OWNER">Responsável / Operador</SelectItem>
                                            <SelectItem value="SUPERADMIN">Superadministrador (Acesso Total)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {/* Seção de Permissões de Abas */}
                            <div className="border border-border/80 rounded-2xl p-4 sm:p-5 bg-muted/20 space-y-4">
                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-border/50 pb-3">
                                    <div>
                                        <h3 className="font-semibold text-base flex items-center gap-2">
                                            <Layers className="h-5 w-5 text-primary" /> Permissões de Acesso por Abas
                                        </h3>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {formData.role === "SUPERADMIN"
                                                ? "Superadministradores têm acesso completo e irrestrito a todas as abas."
                                                : "Marque as abas que este usuário poderá visualizar e navegar. Abas desmarcadas não aparecem no menu."
                                            }
                                        </p>
                                    </div>

                                    {formData.role !== "SUPERADMIN" && (
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-xs font-medium text-muted-foreground">Modelos rápidos:</span>
                                            {PERMISSION_PRESETS.filter(p => p.id !== "all").map(preset => (
                                                <Button
                                                    key={preset.id}
                                                    type="button"
                                                    variant="secondary"
                                                    size="sm"
                                                    className="h-7 text-xs px-2.5 gap-1"
                                                    onClick={() => applyPreset(preset.paths)}
                                                >
                                                    <Sparkles className="h-3 w-3 text-primary" /> {preset.name}
                                                </Button>
                                            ))}
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-xs px-2"
                                                onClick={selectAllPermissions}
                                            >
                                                Marcar Todas
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 text-xs px-2 text-muted-foreground"
                                                onClick={clearAllPermissions}
                                            >
                                                Limpar
                                            </Button>
                                        </div>
                                    )}
                                </div>

                                {formData.role === "SUPERADMIN" ? (
                                    <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
                                        <ShieldAlert className="h-4 w-4 shrink-0" />
                                        <span>Como Superadministrador Master, este perfil terá acesso automático a todas as 20 abas e recursos do sistema.</span>
                                    </div>
                                ) : (
                                    <div className="space-y-5">
                                        {Object.entries(tabsByCategory).map(([category, tabs]) => (
                                            <div key={category} className="space-y-2">
                                                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                                    <span>{category}</span>
                                                    <span className="h-px bg-border flex-1" />
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                                                    {tabs.map(tab => {
                                                        const isChecked = formData.permissions.includes(tab.path);
                                                        return (
                                                            <div
                                                                key={tab.path}
                                                                onClick={() => togglePermission(tab.path)}
                                                                className={`p-3 rounded-xl border transition-all cursor-pointer flex items-start gap-3 select-none ${
                                                                    isChecked
                                                                        ? "bg-primary/5 border-primary/40 shadow-xs"
                                                                        : "bg-background/80 border-border/60 opacity-60 hover:opacity-100"
                                                                }`}
                                                            >
                                                                <Switch
                                                                    id={`tab-${tab.path}`}
                                                                    checked={isChecked}
                                                                    onCheckedChange={() => togglePermission(tab.path)}
                                                                    onClick={e => e.stopPropagation()}
                                                                    className="mt-0.5"
                                                                />
                                                                <div className="space-y-0.5 flex-1 min-w-0">
                                                                    <div className="flex items-center justify-between gap-1">
                                                                        <span className={`text-xs font-medium truncate ${isChecked ? "text-primary font-semibold" : "text-foreground"}`}>
                                                                            {tab.label}
                                                                        </span>
                                                                        {isChecked ? (
                                                                            <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-0.5">
                                                                                <Eye className="h-3 w-3" /> Visível
                                                                            </span>
                                                                        ) : (
                                                                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                                                                <EyeOff className="h-3 w-3" /> Oculto
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <p className="text-[11px] text-muted-foreground line-clamp-1 leading-tight">
                                                                        {tab.description}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="flex justify-end gap-3 pt-2">
                                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                                    Cancelar
                                </Button>
                                <Button type="submit" className="gap-2">
                                    <Check className="h-4 w-4" /> {editingUser ? "Salvar alterações" : "Criar usuário"}
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            )}

            {/* Listagem de Usuários */}
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {users.map(user => {
                    const isSuper = user.role === "SUPERADMIN";
                    const userPerms = Array.isArray(user.permissions) ? user.permissions : [];
                    const allowedCount = isSuper ? SYSTEM_TABS.length : userPerms.length;

                    return (
                        <Card key={user.id} className="overflow-hidden border hover:border-primary/40 transition-all flex flex-col justify-between shadow-xs">
                            <CardHeader className="pb-3">
                                <div className="flex justify-between items-start gap-2">
                                    <div className="flex items-center gap-2.5">
                                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                                            {user.name ? user.name.slice(0, 2).toUpperCase() : user.email.slice(0, 2).toUpperCase()}
                                        </div>
                                        <div>
                                            <CardTitle className="text-base font-semibold leading-tight">{user.name || "Sem nome"}</CardTitle>
                                            <p className="text-xs text-muted-foreground truncate max-w-[180px]">{user.email}</p>
                                        </div>
                                    </div>
                                    {getRoleBadge(user.role)}
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-3 pb-3 text-xs">
                                <div className="p-2.5 rounded-xl bg-muted/40 border border-border/50 space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground font-medium">Abas Liberadas:</span>
                                        <span className="font-semibold text-primary">
                                            {isSuper ? "Acesso Total (20 abas)" : `${allowedCount} de ${SYSTEM_TABS.length} abas`}
                                        </span>
                                    </div>
                                    {!isSuper && userPerms.length > 0 && (
                                        <div className="flex flex-wrap gap-1 pt-1">
                                            {userPerms.slice(0, 4).map(p => {
                                                const tab = SYSTEM_TABS.find(t => t.path === p);
                                                return (
                                                    <span key={p} className="text-[10px] px-1.5 py-0.5 rounded-md bg-background border border-border text-foreground">
                                                        {tab?.label || p.replace('/dashboard/', '')}
                                                    </span>
                                                );
                                            })}
                                            {userPerms.length > 4 && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-semibold">
                                                    +{userPerms.length - 4} mais
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                            <CardFooter className="pt-2 border-t border-border/40 flex justify-between gap-2">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="w-full gap-1.5"
                                    onClick={() => handleOpenEdit(user)}
                                >
                                    <Edit className="h-3.5 w-3.5" /> Editar permissões
                                </Button>
                                {user.id !== session?.user?.id && (
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="text-destructive hover:bg-destructive/10 px-2.5"
                                        onClick={() => setDeleteId(user.id)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                )}
                            </CardFooter>
                        </Card>
                    );
                })}
            </div>

            {/* Confirmação de Exclusão */}
            <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Tem certeza que deseja excluir este usuário?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta ação é permanente e removerá todas as permissões e acessos associados a esta conta.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => deleteId && handleDelete(deleteId)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Excluir usuário
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
