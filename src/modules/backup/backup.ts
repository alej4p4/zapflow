import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { dataDir } from "@/lib/paths";
import { logger } from "@/lib/logger";

/**
 * Backup automático do banco (uma cópia por dia, mantém as 7 últimas).
 * Usa VACUUM INTO: gera um arquivo consistente mesmo com o banco aberto.
 * A pasta de mídia NÃO entra no backup (1,9 GB+) — copie manualmente se precisar.
 */
const KEEP = 7;
const INTERVAL_MS = 6 * 60 * 60 * 1000;
export const backupDir = path.join(dataDir, "backups");

let timer: ReturnType<typeof setInterval> | null = null;

export async function backupOnce(): Promise<string | null> {
    const dbUrl = process.env.DATABASE_URL || "";
    // VACUUM INTO é exclusivo para SQLite local; na nuvem (Neon/Postgres), o próprio Neon gerencia backups contínuos.
    if (!dbUrl.startsWith("file:") && !dbUrl.includes("sqlite")) {
        return null;
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const file = path.join(backupDir, `wa-akg-${stamp}.sqlite`);

    if (fs.existsSync(file)) return null; // já feito hoje

    fs.mkdirSync(backupDir, { recursive: true });
    await prisma.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`);

    const files = fs.readdirSync(backupDir).filter(f => f.endsWith(".sqlite")).sort();
    while (files.length > KEEP) {
        fs.unlinkSync(path.join(backupDir, files.shift()!));
    }

    logger.success("Backup", `Banco salvo em ${file}`);
    return file;
}

export function startBackups() {
    if (timer) return;
    const run = async () => {
        try {
            await backupOnce();
        } catch (e) {
            logger.error("Backup", "Falha ao gerar backup do banco", e);
        }
    };
    run();
    timer = setInterval(run, INTERVAL_MS);
}
