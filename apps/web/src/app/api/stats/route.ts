import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET() {
  try {
    const { data: logs, error: logsError } = await supabase
      .from("usage_logs")
      .select("*, projects(name), api_keys(name)")
      .order("created_at", { ascending: false });

    if (logsError) throw logsError;

    const totalRequests = logs.length;
    const totalTokens = logs.reduce((acc, curr) => acc + (curr.total_tokens || 0), 0);
    const successful = logs.filter((l) => l.status_code >= 200 && l.status_code < 300).length;
    const successRate = totalRequests > 0 ? Math.round((successful / totalRequests) * 100) : 100;

    return NextResponse.json({
      totalRequests,
      totalTokens,
      successRate,
      recentLogs: logs.slice(0, 10)
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
