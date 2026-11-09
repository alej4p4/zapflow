import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import { SYSTEM_TABS } from "@/lib/permissions";
import bcrypt from "bcryptjs";
import { z } from "zod";

const createUserSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
    role: z.enum(["SUPERADMIN", "OWNER", "STAFF"]).default("OWNER"),
    permissions: z.array(z.string()).optional().nullable(),
});

export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);

    // Only SUPERADMIN can list users
    if (!user || !isAdmin(user.role)) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 403 });
    }

    try {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                permissions: true,
                createdAt: true,
                _count: {
                    select: { sessions: true }
                }
            }
        });

        return NextResponse.json({ status: true, message: "Users fetched successfully", data: users });
    } catch (error) {
        return NextResponse.json({ status: false, message: "Failed to fetch users", error: "Failed to fetch users" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const user = await getAuthenticatedUser(request);

    // Only SUPERADMIN can create users
    if (!user || !isAdmin(user.role)) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 403 });
    }

    try {
        const body = await request.json();
        const parseResult = createUserSchema.safeParse(body);

        if (!parseResult.success) {
            return NextResponse.json({ status: false, message: "Validation error", error: parseResult.error.flatten() }, { status: 400 });
        }

        const { name, email, password, role, permissions } = parseResult.data;
        const normalizedEmail = email.toLowerCase().trim();

        // Check if email exists
        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) {
            return NextResponse.json({ status: false, message: "Email already exists", error: "E-mail já está cadastrado no sistema" }, { status: 400 });
        }

        // Validate and sanitize permissions against SYSTEM_TABS
        const validPaths = new Set(SYSTEM_TABS.map(t => t.path));
        let sanitizedPermissions: string[] | undefined = undefined;

        if (role === "SUPERADMIN") {
            sanitizedPermissions = SYSTEM_TABS.map(t => t.path);
        } else if (Array.isArray(permissions)) {
            sanitizedPermissions = permissions.filter(p => {
                if (!validPaths.has(p)) return false;
                const tab = SYSTEM_TABS.find(t => t.path === p);
                if (tab?.superadminOnly) return false;
                return true;
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await prisma.user.create({
            data: {
                name: name.trim(),
                email: normalizedEmail,
                password: hashedPassword,
                role: role as any,
                permissions: sanitizedPermissions ?? undefined
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                permissions: true,
                createdAt: true
            }
        });

        return NextResponse.json({ status: true, message: "User created successfully", data: newUser }, { status: 201 });

    } catch (error) {
        console.error("Create user error:", error);
        return NextResponse.json({ status: false, message: "Failed to create user", error: "Failed to create user" }, { status: 500 });
    }
}
