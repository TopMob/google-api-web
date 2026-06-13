import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("api_keys")
      .select("*, projects(name)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, project_id, allowed_models, daily_requests_limit, daily_tokens_limit, rate_limit_rpm, expires_at } =
      body;
    if (!name || !project_id) {
      return NextResponse.json({ error: "Name and project_id are required" }, { status: 400 });
    }
    const secureKey = `sk-personal-gw-${crypto.randomBytes(24).toString("hex")}`;
    const { data, error } = await supabase
      .from("api_keys")
      .insert({
        name,
        project_id,
        key: secureKey,
        allowed_models: allowed_models || null,
        daily_requests_limit: daily_requests_limit ? parseInt(daily_requests_limit, 10) : null,
        daily_tokens_limit: daily_tokens_limit ? parseInt(daily_tokens_limit, 10) : null,
        rate_limit_rpm: rate_limit_rpm ? parseInt(rate_limit_rpm, 10) : null,
        expires_at: expires_at || null
      })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, active } = body;
    if (!id || typeof active !== "boolean") {
      return NextResponse.json({ error: "id and active state are required" }, { status: 400 });
    }
    const { data, error } = await supabase.from("api_keys").update({ active }).eq("id", id).select().single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
