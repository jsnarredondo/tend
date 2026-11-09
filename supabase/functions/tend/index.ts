// Tend server function: Tell Tend / Ask Tend (Claude) and inviting people.
// The Anthropic key lives only here, as the ANTHROPIC_API_KEY secret.
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const DAILY_AI_LIMIT = 150; // per person per day, protects the bill
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

function tempPassword() {
  const words = ["sun", "kite", "maple", "river", "otter", "cloud", "pebble", "honey", "tiger", "bloom", "comet", "lark"];
  const b = crypto.getRandomValues(new Uint32Array(3));
  return `${words[b[0] % words.length]}-${words[b[1] % words.length]}-${1000 + (b[2] % 9000)}`;
}

function extractJson(text: string) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const i = Math.min(...["{", "["].map((c) => { const k = t.indexOf(c); return k < 0 ? Infinity : k; }));
  const j = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (i !== Infinity && j > i) return JSON.parse(t.slice(i, j + 1));
  throw new Error("no json");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return json({ error: "signin" }, 401);
  const { data: member } = await admin.from("members").select("role,name").eq("user_id", u.user.id).maybeSingle();
  if (!member) return json({ error: "not_member" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }

  if (body.action === "ai") {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "no_key", message: "Tell Tend isn't set up yet." }, 503);
    const n = (await admin.rpc("ai_bump", { p_user: u.user.id, p_limit: DAILY_AI_LIMIT })).data ?? 0;
    if (n > DAILY_AI_LIMIT) return json({ error: "limit", message: "Tend's daily AI limit was reached. Try again tomorrow." }, 429);

    const prompt = String(body.prompt || "").slice(0, 60000);
    const images = (Array.isArray(body.images) ? body.images : []).slice(0, 4);
    const content: any[] = images
      .filter((im: any) => /^image\/(jpeg|png|gif|webp)$/.test(im?.type) && typeof im?.data === "string")
      .map((im: any) => ({ type: "image", source: { type: "base64", media_type: im.type, data: im.data } }));
    content.push({ type: "text", text: prompt + "\n\nReply with only valid JSON, no other text." });

    const client = new Anthropic({ apiKey: key });
    try {
      const msg: any = await client.beta.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        output_config: { effort: images.length ? "medium" : "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages: [{ role: "user", content }],
      } as any);
      if (msg.stop_reason === "refusal") return json({ error: "refused", message: "Tend couldn't answer that one." }, 422);
      const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      return json({ result: extractJson(text) });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return json({ error: "busy", message: "Tend is busy. Try again in a minute." }, 429);
      if (e instanceof Anthropic.AuthenticationError) return json({ error: "no_key", message: "The AI key isn't working. Check it in Supabase." }, 503);
      if (e instanceof Anthropic.APIError) return json({ error: "ai", message: "Tend couldn't reach the AI. Try again." }, 502);
      return json({ error: "parse", message: "Tend didn't understand the reply. Try again." }, 502);
    }
  }

  if (body.action === "invite") {
    if (member.role !== "owner") return json({ error: "forbidden" }, 403);
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim().slice(0, 60);
    const role = ["contributor", "viewer", "owner"].includes(body.role) ? body.role : "contributor";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) return json({ error: "bad_request", message: "Add a name and email." }, 400);
    const password = tempPassword();
    let uid: string | undefined;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
    if (created.error) {
      // already has an account: reset the password so the owner can share it
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const ex = list?.users.find((x) => (x.email || "").toLowerCase() === email);
      if (!ex) return json({ error: "invite", message: created.error.message }, 400);
      uid = ex.id;
      await admin.auth.admin.updateUserById(uid, { password });
    } else uid = created.data.user?.id;
    await admin.from("members").upsert({ user_id: uid, name, email, role });
    return json({ ok: true, email, password, role });
  }

  if (body.action === "remove") {
    if (member.role !== "owner") return json({ error: "forbidden" }, 403);
    if (body.user_id === u.user.id) return json({ error: "bad_request", message: "You can't remove yourself." }, 400);
    await admin.from("members").delete().eq("user_id", body.user_id);
    await admin.auth.admin.deleteUser(String(body.user_id)).catch(() => {});
    return json({ ok: true });
  }

  return json({ error: "unknown_action" }, 400);
});
