import { NextResponse } from "next/server";
import { getApiDocs } from "@/lib/swagger";

export async function GET() {
  try {
    const spec = getApiDocs();
    return NextResponse.json(spec);
  } catch (error) {
    console.error("Swagger docs error:", error);
    return NextResponse.json(
      { status: false, message: "Failed to load API documentation", error: String(error) },
      { status: 500 }
    );
  }
}

