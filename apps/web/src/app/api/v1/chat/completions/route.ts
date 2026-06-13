import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const gatewayUrl = process.env.GATEWAY_URL || "http://127.0.0.1:8081";

    const authHeader = req.headers.get("authorization") || "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (authHeader) {
      headers["authorization"] = authHeader;
    }

    const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json({ error: errText }, { status: response.status });
    }

    if (body.stream) {
      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body?.getReader();
          if (!reader) {
            controller.close();
            return;
          }
          const decoder = new TextDecoder();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
          } catch (e) {
            controller.error(e);
          } finally {
            controller.close();
          }
        }
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
