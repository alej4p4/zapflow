"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextType {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    resolvedTheme: "light" | "dark";
    toggleTheme: () => void;
}

const THEME_STORAGE_KEY = "zapflow_theme";

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = useState<Theme>("system");
    const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("dark");
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        try {
            const saved = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
            if (saved && (saved === "light" || saved === "dark" || saved === "system")) {
                setThemeState(saved);
            }
        } catch {}
    }, []);

    useEffect(() => {
        if (!mounted) return;

        const applyTheme = () => {
            const root = document.documentElement;
            let targetTheme: "light" | "dark" = "dark";

            if (theme === "system") {
                const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
                targetTheme = systemPrefersDark ? "dark" : "light";
            } else {
                targetTheme = theme;
            }

            setResolvedTheme(targetTheme);

            if (targetTheme === "dark") {
                root.classList.add("dark"); root.style.colorScheme = "dark"; if (typeof document !== "undefined" && document.body) document.body.style.colorScheme = "dark";
            } else {
                root.classList.remove("dark"); root.style.colorScheme = "light"; if (typeof document !== "undefined" && document.body) document.body.style.colorScheme = "light";
            }

            try {
                localStorage.setItem(THEME_STORAGE_KEY, theme);
            } catch {}

            window.dispatchEvent(new CustomEvent("zapflow:theme-change", { detail: { theme, resolvedTheme: targetTheme } }));
        };

        applyTheme();

        if (theme === "system") {
            const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
            const handler = () => applyTheme();
            mediaQuery.addEventListener("change", handler);
            return () => mediaQuery.removeEventListener("change", handler);
        }
    }, [theme, mounted]);

    const setTheme = (newTheme: Theme) => {
        setThemeState(newTheme);
    };

    const toggleTheme = () => {
        setThemeState(prev => {
            if (prev === "dark" || (prev === "system" && resolvedTheme === "dark")) {
                return "light";
            }
            return "dark";
        });
    };

    return (
        <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        // Fallback for SSR or non-wrapped components
        return {
            theme: "system" as Theme,
            setTheme: () => {},
            resolvedTheme: "dark" as const,
            toggleTheme: () => {}
        };
    }
    return context;
}
