import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const gatewayUrl = process.env.GATEWAY_URL || "http://127.0.0.1:8081";
    const res = await fetch(gatewayUrl, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      return NextResponse.json({ status: "online", gatewayUrl });
    }
    return NextResponse.json({ status: "offline", gatewayUrl });
  } catch {
    return NextResponse.json({ status: "offline", gatewayUrl: process.env.GATEWAY_URL || "http://127.0.0.1:8081" });
  }
}
