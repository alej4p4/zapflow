"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ShieldAlert, ArrowLeft, Home, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isRouteAllowed, SYSTEM_TABS } from "@/lib/permissions";

export function RouteGuard({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { data: session, status } = useSession();

    if (status === "loading") {
        return <>{children}</>;
    }

    const userRole = (session?.user as any)?.role;
    const userPermissions = (session?.user as any)?.permissions;

    // SuperAdmin has full access
    if (userRole === "SUPERADMIN") {
        return <>{children}</>;
    }

    const allowed = isRouteAllowed(pathname, userRole, userPermissions);

    if (!allowed) {
        const tabDef = SYSTEM_TABS.find(
            t => t.path === pathname || (t.path !== "/dashboard" && pathname.startsWith(t.path))
        );
        const tabName = tabDef?.label || "este módulo";

        // Find first allowed path for the user to navigate to
        const defaultFallback = Array.isArray(userPermissions) && userPermissions.length > 0
            ? userPermissions[0]
            : "/dashboard/chat";

        return (
            <div className="flex items-center justify-center min-h-[60vh] p-4">
                <Card className="max-w-md w-full border-2 border-amber-500/20 shadow-xl bg-card">
                    <CardContent className="pt-8 pb-6 px-6 text-center space-y-4">
                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500">
                            <ShieldAlert className="h-8 w-8" />
                        </div>
                        <div className="space-y-1.5">
                            <h2 className="text-xl font-bold tracking-tight text-foreground">
                                Acesso Restrito
                            </h2>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                Seu perfil de usuário não possui permissão para acessar a aba <strong className="text-foreground font-semibold">{tabName}</strong>.
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Caso precise de acesso a este recurso, solicite ao Administrador Master da plataforma.
                            </p>
                        </div>
                        <div className="pt-2 flex flex-col sm:flex-row gap-2 justify-center">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => router.back()}
                                className="gap-1.5"
                            >
                                <ArrowLeft className="h-4 w-4" /> Voltar
                            </Button>
                            <Button
                                size="sm"
                                asChild
                                className="gap-1.5"
                            >
                                <Link href={defaultFallback}>
                                    <MessageSquare className="h-4 w-4" /> Minha área
                                </Link>
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return <>{children}</>;
}
