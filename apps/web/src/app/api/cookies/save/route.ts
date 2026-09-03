import { NextRequest, NextResponse } from "next/server";

const gatewayUrl = () => process.env.GATEWAY_URL || "http://127.0.0.1:8081";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${gatewayUrl()}/api/cookies/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
