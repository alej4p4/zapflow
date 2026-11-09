import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import { waManager } from "@/modules/whatsapp/manager";
import { SYSTEM_TABS } from "@/lib/permissions";
import bcrypt from "bcryptjs";
import { z } from "zod";

const updateUserSchema = z.object({
    name: z.string().min(2).optional(),
    email: z.string().email().optional(),
    password: z.string().min(6).optional(),
    role: z.enum(["SUPERADMIN", "OWNER", "STAFF"]).optional(),
    permissions: z.array(z.string()).optional().nullable(),
});

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getAuthenticatedUser(request);

    // Only SUPERADMIN can update users
    if (!user || !isAdmin(user.role)) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 403 });
    }

    const { id } = await params;

    try {
        const body = await request.json();
        const parseResult = updateUserSchema.safeParse(body);

        if (!parseResult.success) {
            return NextResponse.json({ status: false, message: "Validation error", error: parseResult.error.flatten() }, { status: 400 });
        }

        const { name, email, password, role, permissions } = parseResult.data;

        // Check if target user exists
        const targetUser = await prisma.user.findUnique({ where: { id } });
        if (!targetUser) {
            return NextResponse.json({ status: false, message: "User not found", error: "User not found" }, { status: 404 });
        }

        // Email uniqueness validation
        if (email && email.toLowerCase() !== targetUser.email.toLowerCase()) {
            const emailInUse = await prisma.user.findFirst({
                where: {
                    email: email.toLowerCase(),
                    id: { not: id }
                }
            });
            if (emailInUse) {
                return NextResponse.json({ status: false, message: "Email already exists", error: "E-mail já está em uso por outro usuário" }, { status: 400 });
            }
        }

        // Prevent demoting the last SUPERADMIN
        if (targetUser.role === "SUPERADMIN" && role && role !== "SUPERADMIN") {
            const superadminCount = await prisma.user.count({ where: { role: "SUPERADMIN" } });
            if (superadminCount <= 1) {
                return NextResponse.json({
                    status: false,
                    message: "Cannot demote the last SUPERADMIN",
                    error: "Não é possível rebaixar o único Super Administrador do sistema."
                }, { status: 400 });
            }
        }

        // Validate and sanitize permissions against SYSTEM_TABS
        const validPaths = new Set(SYSTEM_TABS.map(t => t.path));
        const effectiveRole = role || targetUser.role;

        let sanitizedPermissions: string[] | undefined = undefined;
        if (permissions !== undefined) {
            if (permissions === null || effectiveRole === "SUPERADMIN") {
                sanitizedPermissions = SYSTEM_TABS.map(t => t.path);
            } else {
                sanitizedPermissions = permissions.filter(p => {
                    if (!validPaths.has(p)) return false;
                    const tab = SYSTEM_TABS.find(t => t.path === p);
                    if (tab?.superadminOnly) return false;
                    return true;
                });
            }
        }

        const updateData: any = {};
        if (name !== undefined) updateData.name = name;
        if (email !== undefined) updateData.email = email.toLowerCase();
        if (role !== undefined) updateData.role = role;
        if (sanitizedPermissions !== undefined) updateData.permissions = sanitizedPermissions;
        if (password) {
            updateData.password = await bcrypt.hash(password, 10);
        }

        const updatedUser = await prisma.user.update({
            where: { id },
            data: updateData,
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                permissions: true,
                updatedAt: true
            }
        });

        return NextResponse.json({ status: true, message: "User updated successfully", data: updatedUser });

    } catch (error) {
        console.error("Update user error:", error);
        return NextResponse.json({ status: false, message: "Failed to update user", error: "Failed to update user" }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getAuthenticatedUser(request);

    // Only SUPERADMIN can delete users
    if (!user || !isAdmin(user.role)) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 403 });
    }

    const { id } = await params;

    if (id === user.id) {
        return NextResponse.json({ status: false, message: "Cannot delete yourself", error: "Você não pode excluir sua própria conta" }, { status: 400 });
    }

    try {
        const targetUser = await prisma.user.findUnique({
            where: { id },
            include: { sessions: true }
        });

        if (!targetUser) {
            return NextResponse.json({ status: false, message: "User not found", error: "User not found" }, { status: 404 });
        }

        // Prevent deleting the last SUPERADMIN
        if (targetUser.role === "SUPERADMIN") {
            const superadminCount = await prisma.user.count({ where: { role: "SUPERADMIN" } });
            if (superadminCount <= 1) {
                return NextResponse.json({
                    status: false,
                    message: "Cannot delete the last SUPERADMIN",
                    error: "Não é possível excluir o único Super Administrador do sistema."
                }, { status: 400 });
            }
        }

        // Clean up any active WhatsApp sessions in memory & socket manager before deleting user
        if (targetUser.sessions && targetUser.sessions.length > 0) {
            for (const sess of targetUser.sessions) {
                try {
                    await waManager.deleteSession(sess.sessionId);
                } catch (cleanupErr) {
                    console.warn(`[User Delete] Could not cleanup waManager session ${sess.sessionId}:`, cleanupErr);
                }
            }
        }

        await prisma.user.delete({ where: { id } });
        return NextResponse.json({ status: true, message: "User deleted successfully" });
    } catch (error) {
        console.error("Delete user error:", error);
        return NextResponse.json({ status: false, message: "Failed to delete user", error: "Failed to delete user" }, { status: 500 });
    }
}
