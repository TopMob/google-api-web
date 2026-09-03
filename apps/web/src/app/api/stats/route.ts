import { NextResponse } from "next/server";

const gatewayUrl = () => process.env.GATEWAY_URL || "http://127.0.0.1:8081";

export async function GET() {
  try {
    const res = await fetch(`${gatewayUrl()}/api/stats`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Gateway error: ${res.status}`);
    return NextResponse.json(await res.json());
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
