"use client";

import "@/lib/auth-fetch-shield";
import { SessionProvider } from "next-auth/react";
import { SocketProvider } from "@/components/chat/socket-context";
import { ThemeProvider } from "@/components/theme-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SessionProvider refetchOnWindowFocus={false} refetchWhenOffline={false}>
        <SocketProvider>
          {children}
        </SocketProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
