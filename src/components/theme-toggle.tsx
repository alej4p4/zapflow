"use client";

import React, { useState } from "react";
import { useTheme } from "./theme-provider";
import { Sun, Moon, Laptop } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
    variant?: "button" | "dropdown" | "compact";
    className?: string;
}

export function ThemeToggle({ variant = "dropdown", className }: ThemeToggleProps) {
    const { theme, setTheme, resolvedTheme, toggleTheme } = useTheme();
    const [isOpen, setIsOpen] = useState(false);

    if (variant === "compact") {
        return (
            <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                className={cn(
                    "h-8 w-8 rounded-full cursor-pointer transition-colors text-muted-foreground hover:text-foreground",
                    className
                )}
                title={resolvedTheme === "dark" ? "Alternar para modo Claro" : "Alternar para modo Escuro"}
            >
                {resolvedTheme === "dark" ? (
                    <Sun className="h-4 w-4 text-amber-400 transition-transform" />
                ) : (
                    <Moon className="h-4 w-4 text-slate-700 transition-transform" />
                )}
                <span className="sr-only">Alternar tema</span>
            </Button>
        );
    }

    if (variant === "button") {
        return (
            <Button
                variant="outline"
                size="sm"
                onClick={toggleTheme}
                className={cn(
                    "h-8 px-2.5 rounded-xl gap-1.5 text-xs font-medium cursor-pointer transition-all",
                    className
                )}
            >
                {resolvedTheme === "dark" ? (
                    <>
                        <Sun className="h-3.5 w-3.5 text-amber-400" />
                        <span>Modo Claro</span>
                    </>
                ) : (
                    <>
                        <Moon className="h-3.5 w-3.5 text-slate-700" />
                        <span>Modo Escuro</span>
                    </>
                )}
            </Button>
        );
    }

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                        "relative h-9 w-9 rounded-full cursor-pointer hover:bg-muted/50 transition-colors",
                        className
                    )}
                    title="Aparência: Claro / Escuro"
                >
                    {resolvedTheme === "dark" ? (
                        <Sun className="h-4 w-4 text-amber-400 transition-all" />
                    ) : (
                        <Moon className="h-4 w-4 text-slate-700 dark:text-slate-200 transition-all" />
                    )}
                    <span className="sr-only">Tema</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-36 rounded-2xl border border-border/40 shadow-xl p-1 z-50">
                <button
                    type="button"
                    onClick={() => { setTheme("light"); setIsOpen(false); }}
                    className={cn(
                        "w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-xl cursor-pointer hover:bg-muted/60 transition-colors text-left",
                        theme === "light" && "bg-primary/10 text-primary font-semibold"
                    )}
                >
                    <Sun className="h-3.5 w-3.5 text-amber-500" />
                    <span>Claro</span>
                </button>
                <button
                    type="button"
                    onClick={() => { setTheme("dark"); setIsOpen(false); }}
                    className={cn(
                        "w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-xl cursor-pointer hover:bg-muted/60 transition-colors text-left",
                        theme === "dark" && "bg-primary/10 text-primary font-semibold"
                    )}
                >
                    <Moon className="h-3.5 w-3.5 text-indigo-400" />
                    <span>Escuro</span>
                </button>
                <button
                    type="button"
                    onClick={() => { setTheme("system"); setIsOpen(false); }}
                    className={cn(
                        "w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-xl cursor-pointer hover:bg-muted/60 transition-colors text-left",
                        theme === "system" && "bg-primary/10 text-primary font-semibold"
                    )}
                >
                    <Laptop className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Automático</span>
                </button>
            </PopoverContent>
        </Popover>
    );
}
