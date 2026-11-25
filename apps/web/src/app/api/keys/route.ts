import { NextRequest, NextResponse } from "next/server";

const gatewayUrl = () => process.env.GATEWAY_URL || "http://127.0.0.1:8081";

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET() {
  try {
    const res = await fetch(`${gatewayUrl()}/api/keys`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Gateway error: ${res.status}`);
    return NextResponse.json(await res.json());
  } catch (error: unknown) {
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${gatewayUrl()}/api/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) throw new Error(`Gateway error: ${res.status}`);
    return NextResponse.json(await res.json());
  } catch (error: unknown) {
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${gatewayUrl()}/api/keys`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) throw new Error(`Gateway error: ${res.status}`);
    return NextResponse.json(await res.json());
  } catch (error: unknown) {
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const res = await fetch(`${gatewayUrl()}/api/keys/${encodeURIComponent(id)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) throw new Error(`Gateway error: ${res.status}`);
    return NextResponse.json(await res.json());
  } catch (error: unknown) {
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}
