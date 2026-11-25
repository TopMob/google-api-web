import { NextResponse } from "next/server";

const gatewayUrl = () => process.env.GATEWAY_URL || "http://127.0.0.1:8081";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get("refresh");
    const suffix = refresh ? `?refresh=${encodeURIComponent(refresh)}` : "";
    const res = await fetch(`${gatewayUrl()}/api/accounts${suffix}`, {
      signal: AbortSignal.timeout(20000)
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ activeAuthUser: "0", accounts: [], error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { authUser?: unknown };
    const res = await fetch(`${gatewayUrl()}/api/accounts/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authUser: body?.authUser }),
      signal: AbortSignal.timeout(20000)
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
