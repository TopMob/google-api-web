import { NextRequest, NextResponse } from "next/server";

const gatewayUrl = () => process.env.GATEWAY_URL || "http://127.0.0.1:8081";

export async function GET(req: NextRequest) {
  try {
    const limitParam = req.nextUrl.searchParams.get("limit") || "100";
    const res = await fetch(`${gatewayUrl()}/api/stats?limit=${encodeURIComponent(limitParam)}`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) throw new Error(`Gateway error: ${res.status}`);
    return NextResponse.json(await res.json());
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
