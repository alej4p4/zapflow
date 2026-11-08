import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });
        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found" }, { status: 404 });
        }

        const { searchParams } = new URL(req.url);
        const jid = searchParams.get("jid");
        if (!jid) {
            return NextResponse.json({ status: false, message: "jid is required" }, { status: 400 });
        }

        const contact = await prisma.contact.findFirst({
            where: { sessionId: session.id, jid },
            select: { data: true }
        });

        const note = (contact?.data as Record<string, any>)?.internalNote || "";

        return NextResponse.json({ status: true, note });
    } catch (e: any) {
        return NextResponse.json({ status: false, message: e.message }, { status: 500 });
    }
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });
        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found" }, { status: 404 });
        }

        const body = await req.json();
        const { jid, note = "" } = body;
        if (!jid) {
            return NextResponse.json({ status: false, message: "jid is required" }, { status: 400 });
        }

        // Upsert contact or update data
        const existing = await prisma.contact.findFirst({
            where: { sessionId: session.id, jid }
        });

        const currentData = (existing?.data as Record<string, any>) || {};
        const updatedData = { ...currentData, internalNote: note.trim() };

        if (existing) {
            await prisma.contact.update({
                where: { id: existing.id },
                data: { data: updatedData }
            });
        } else {
            await prisma.contact.create({
                data: {
                    sessionId: session.id,
                    jid,
                    data: updatedData
                }
            });
        }

        return NextResponse.json({ status: true, note: note.trim() });
    } catch (e: any) {
        return NextResponse.json({ status: false, message: e.message }, { status: 500 });
    }
}
