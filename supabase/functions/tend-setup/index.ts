// One-time setup: stores the Anthropic API key for Tell Tend.
// Accepts the key only with the setup token, and only if no key is stored yet.
import { createClient } from "npm:@supabase/supabase-js@2";
const TOKEN_SHA256 = "10ad5441db369c900cf627c5c8de62fc364142de396a1ee31caa16e186508617";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("no", { status: 405 });
  const tok = req.headers.get("x-setup-token") || "";
  if ((await sha256(tok)) !== TOKEN_SHA256) return new Response("forbidden", { status: 403 });
  const { data: existing } = await admin.from("app_secrets").select("name").eq("name", "ANTHROPIC_API_KEY").maybeSingle();
  if (existing) return new Response("already set", { status: 409 });
  const key = (await req.text()).trim();
  if (!/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(key)) return new Response("that doesn't look like an Anthropic key", { status: 400 });
  const { error } = await admin.from("app_secrets").insert({ name: "ANTHROPIC_API_KEY", value: key });
  return new Response(error ? "error" : "saved", { status: error ? 500 : 200 });
});
