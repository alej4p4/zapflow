"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShieldAlert, ArrowRight } from "lucide-react";

export default function RegisterPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace('/auth/login');
    }, [router]);

    return (
        <div className="flex items-center justify-center min-h-screen bg-background p-4 text-center">
            <div className="max-w-md w-full p-8 glass-panel rounded-3xl space-y-5 shadow-2xl border border-border/50">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500">
                    <ShieldAlert className="h-7 w-7" />
                </div>
                <div className="space-y-2">
                    <h2 className="text-xl font-bold tracking-tight">Cadastro público restrito</h2>
                    <p className="text-sm text-muted-foreground">
                        Novos usuários são criados e gerenciados exclusivamente pelo Administrador Master no painel do sistema.
                    </p>
                </div>
                <div className="pt-2">
                    <Link
                        href="/auth/login"
                        className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-md hover:opacity-90 transition-all w-full"
                    >
                        Ir para o Login <ArrowRight className="h-4 w-4" />
                    </Link>
                </div>
            </div>
        </div>
    );
}
