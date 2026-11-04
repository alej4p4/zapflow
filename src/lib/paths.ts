import path from "node:path";

/** Pasta gravável de dados. No app desktop aponta para %APPDATA%\wa-akg\data. */
export const dataDir = process.env.WA_AKG_DATA_DIR || path.join(process.cwd(), "data");
export const mediaDir = path.join(dataDir, "media");
