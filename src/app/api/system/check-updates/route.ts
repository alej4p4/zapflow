import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import pkg from "../../../../../package.json";

/**
 * Informa a versão instalada do WA-AKG.
 * Não consulta repositório externo (evita depender do projeto original)
 * nem dispara atualização automática. Se quiser atualizações automáticas,
 * avise que é necessário definir de onde baixar o instalador.
 */
export async function POST(req: NextRequest) {
    const user = await getAuthenticatedUser(req);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });

    try {
        return NextResponse.json({
            status: true,
            message: "Versão instalada",
            data: {
                version: pkg.version,
                updateAvailable: false,
                note: "Atualizações automáticas desativadas. Baixe o instalador no link da sua instalação."
            }
        });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ status: false, message: "Error checking updates", error: "Error checking updates" }, { status: 500 });
    }
}
