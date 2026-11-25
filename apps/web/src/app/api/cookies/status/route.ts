import { NextResponse } from "next/server";

const gatewayUrl = () => process.env.GATEWAY_URL || "http://127.0.0.1:8081";

export async function GET() {
  try {
    const res = await fetch(`${gatewayUrl()}/api/cookies/status`, { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ hasFile: false, isValid: false, message }, { status: 500 });
  }
}
