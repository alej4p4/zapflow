import fs from "node:fs";
import path from "node:path";
import { mediaDir } from "@/lib/paths";
import { logger } from "@/lib/logger";

/**
 * Apaga arquivos de mídia antigos para o disco não crescer sem limite.
 * No ambiente Railway (volume de 500MB), mantém o diretório de mídia controlado (máx 200MB)
 * para garantir que mensagens com fotos e prints sempre tenham espaço para escrita.
 */
const RETENTION_DAYS = Number(process.env.MEDIA_RETENTION_DAYS || 14);
const MAX_MEDIA_BYTES = Number(process.env.MAX_MEDIA_STORAGE_MB || 220) * 1024 * 1024;
const TARGET_MEDIA_BYTES = 120 * 1024 * 1024; // Libera espaço até 120MB se estourar
const INTERVAL_MS = 30 * 60 * 1000; // A cada 30 minutos

export function cleanupMedia(days = RETENTION_DAYS): number {
    if (!fs.existsSync(mediaDir)) return 0;

    let removed = 0;
    const cutoff = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;

    // 1. Limpeza por data (arquivos mais velhos que 'days')
    if (cutoff > 0) {
        for (const name of fs.readdirSync(mediaDir)) {
            const file = path.join(mediaDir, name);
            try {
                const stat = fs.statSync(file);
                if (stat.isFile() && stat.mtimeMs < cutoff) {
                    fs.unlinkSync(file);
                    removed++;
                }
            } catch { /* arquivo em uso ou já removido */ }
        }
    }

    // 2. Limpeza por quota de tamanho (evita ENOSPC no volume)
    removed += enforceMediaQuota();

    if (removed > 0) {
        logger.info("Cleanup", `${removed} arquivo(s) de mídia removidos para liberar espaço`);
    }
    return removed;
}

export function enforceMediaQuota(): number {
    if (!fs.existsSync(mediaDir)) return 0;

    let removed = 0;
    try {
        const files: Array<{ path: string; size: number; mtime: number; ext: string }> = [];
        let totalSize = 0;

        for (const name of fs.readdirSync(mediaDir)) {
            const fPath = path.join(mediaDir, name);
            try {
                const stat = fs.statSync(fPath);
                if (stat.isFile()) {
                    totalSize += stat.size;
                    files.push({
                        path: fPath,
                        size: stat.size,
                        mtime: stat.mtimeMs,
                        ext: path.extname(name).toLowerCase()
                    });
                }
            } catch { /* ignore */ }
        }

        if (totalSize > MAX_MEDIA_BYTES) {
            logger.warn("Cleanup", `Diretório de mídia com ${(totalSize / 1024 / 1024).toFixed(1)}MB ultrapassou o limite de ${(MAX_MEDIA_BYTES / 1024 / 1024)}MB. Purgando arquivos mais pesados/antigos...`);

            // Ordena: arquivos pesados de vídeo/bin primeiro, depois os mais antigos
            files.sort((a, b) => {
                const isHeavyA = a.ext === '.mp4' || a.ext === '.bin' || a.size > 2 * 1024 * 1024;
                const isHeavyB = b.ext === '.mp4' || b.ext === '.bin' || b.size > 2 * 1024 * 1024;
                if (isHeavyA && !isHeavyB) return -1;
                if (!isHeavyA && isHeavyB) return 1;
                return a.mtime - b.mtime; // Mais antigos primeiro
            });

            for (const f of files) {
                if (totalSize <= TARGET_MEDIA_BYTES) break;
                try {
                    fs.unlinkSync(f.path);
                    totalSize -= f.size;
                    removed++;
                } catch { /* ignore */ }
            }
        }
    } catch (e) {
        logger.error("Cleanup", "Erro ao executar enforceMediaQuota:", e);
    }

    return removed;
}

export function startCleanup() {
    const run = () => {
        try { cleanupMedia(); } catch (e) { logger.error("Cleanup", "Falha na limpeza de mídia", e); }
    };
    run();
    setInterval(run, INTERVAL_MS);
}
