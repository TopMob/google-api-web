import { NextResponse } from "next/server";

export async function GET() {
  try {
    const gatewayUrl = process.env.GATEWAY_URL || "http://127.0.0.1:8081";
    const response = await fetch(`${gatewayUrl}/v1/models`);
    if (!response.ok) {
      return NextResponse.json({ error: "Failed to fetch models" }, { status: 502 });
    }
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
