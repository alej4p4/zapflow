import fs from "node:fs";
import path from "node:path";
import { mediaDir } from "@/lib/paths";
import { logger } from "@/lib/logger";

/**
 * Apaga arquivos de mídia antigos para o disco não crescer sem limite.
 * padrão: 180 dias (MEDIA_RETENTION_DAYS=0 desativa).
 * ponytail: corte só por data de modificação; se mídia antiga precisar ficar, aumente o prazo no .env.
 */
const RETENTION_DAYS = Number(process.env.MEDIA_RETENTION_DAYS || 180);
const INTERVAL_MS = 24 * 60 * 60 * 1000;

export function cleanupMedia(days = RETENTION_DAYS): number {
    if (!days || days <= 0 || !fs.existsSync(mediaDir)) return 0;

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    let removed = 0;

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

    if (removed > 0) {
        logger.info("Cleanup", `${removed} arquivo(s) de mídia com mais de ${days} dias removidos`);
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
