import { NextResponse } from "next/server";

export async function GET() {
  const gatewayUrl = process.env.GATEWAY_URL || "http://127.0.0.1:8081";
  try {
    const res = await fetch(`${gatewayUrl}/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json({
        status: data.status === "warning" ? "warning" : "online",
        gatewayUrl,
        cookieValid: data.cookieValid ?? null,
        circuitBreaker: data.circuitBreaker,
        message: data.message
      });
    }
    return NextResponse.json({ status: "offline", gatewayUrl });
  } catch {
    return NextResponse.json({ status: "offline", gatewayUrl });
  }
}
