'use client';

import React, { useEffect } from 'react';
import { RotateCcw, MessageSquare, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ChatErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Chat boundary caught error:', error);
    // If chunk load error or stale server action, auto reload once
    const msg = error?.message || '';
    if (
      msg.includes('ChunkLoadError') ||
      msg.includes('Loading chunk') ||
      msg.includes('Server Components render') ||
      msg.includes('Failed to find Server Action')
    ) {
      if (typeof window !== 'undefined') {
        const lastReload = Number(sessionStorage.getItem('zapflow_chat_reload_ts') || '0');
        if (Date.now() - lastReload > 10000) {
          sessionStorage.setItem('zapflow_chat_reload_ts', String(Date.now()));
          window.location.reload();
        }
      }
    }
  }, [error]);

  return (
    <div className="flex h-full w-full items-center justify-center p-6 bg-background select-none">
      <div className="max-w-md w-full p-6 rounded-2xl border border-border/40 bg-card/70 backdrop-blur-md shadow-xl flex flex-col items-center text-center gap-4">
        <div className="h-14 w-14 rounded-full bg-destructive/10 text-destructive flex items-center justify-center ring-8 ring-destructive/5">
          <AlertCircle className="h-7 w-7" />
        </div>
        <div className="space-y-1">
          <h3 className="font-semibold text-lg text-foreground">
            Erro ao carregar o chat
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Houve uma oscilação na sincronização das mensagens. Clique abaixo para reconectar a tela de conversas.
          </p>
        </div>
        <div className="flex items-center gap-3 w-full mt-2">
          <Button
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.reload();
              } else {
                reset();
              }
            }}
            variant="default"
            className="flex-1 gap-2 bg-[#00a884] hover:bg-[#00a884]/90 text-white rounded-xl h-10 text-xs font-semibold"
          >
            <RotateCcw className="h-4 w-4" />
            Recarregar chat
          </Button>
          <Button
            onClick={() => reset()}
            variant="outline"
            className="flex-1 gap-2 rounded-xl h-10 text-xs"
          >
            <MessageSquare className="h-4 w-4" />
            Tentar novamente
          </Button>
        </div>
      </div>
    </div>
  );
}
