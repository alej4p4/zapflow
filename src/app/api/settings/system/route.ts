import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { invalidateSystemConfigCache } from "@/lib/system-config-cache";

export async function GET(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        // @ts-ignore
        const config = await prisma.systemConfig.findUnique({
            where: { id: "default" }
        });

        return NextResponse.json({
            status: true,
            message: "System config fetched",
            data: config || { appName: "WA-AKG", faviconUrl: "/favicon.ico", enableRegistration: false }
        });
    } catch (error) {
        return NextResponse.json({ status: false, message: "Failed to fetch settings", error: "Failed to fetch settings" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        // @ts-ignore
        const user = await getAuthenticatedUser(req);
        if (!user || user.role !== "SUPERADMIN") {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { appName, logoUrl, faviconUrl, timezone, enableRegistration } = body;

        // @ts-ignore
        const existing = await prisma.systemConfig.findUnique({ where: { id: "default" } });

        // @ts-ignore
        const config = await prisma.systemConfig.upsert({
            where: { id: "default" },
            update: {
                ...(appName !== undefined ? { appName } : {}),
                ...(logoUrl !== undefined ? { logoUrl } : {}),
                ...(faviconUrl !== undefined ? { faviconUrl } : {}),
                ...(timezone !== undefined ? { timezone } : {}),
                enableRegistration: enableRegistration ?? existing?.enableRegistration ?? false,
            },
            create: {
                id: "default",
                appName: appName || "WA-AKG",
                logoUrl: logoUrl || "",
                faviconUrl: faviconUrl || "/favicon.ico",
                timezone: timezone || "America/Sao_Paulo",
                enableRegistration: enableRegistration ?? false,
            }
        });

        invalidateSystemConfigCache();

        return NextResponse.json({ status: true, message: "System settings updated", data: config });
    } catch (error) {
        return NextResponse.json({ status: false, message: "Failed to update settings", error: "Failed to update settings" }, { status: 500 });
    }
}
