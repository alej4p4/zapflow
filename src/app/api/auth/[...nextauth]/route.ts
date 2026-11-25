import { handlers } from "@/lib/auth";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const res = await handlers.GET(req);
    return res;
  } catch (error) {
    console.error("[NextAuth GET Handler Shield]:", error);
    if (req.nextUrl?.pathname?.endsWith("/session")) {
      return NextResponse.json(null, { status: 200 });
    }
    return NextResponse.json({ error: "AuthError" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const res = await handlers.POST(req);
    return res;
  } catch (error) {
    console.error("[NextAuth POST Handler Shield]:", error);
    return NextResponse.json({ error: "AuthError" }, { status: 500 });
  }
}
