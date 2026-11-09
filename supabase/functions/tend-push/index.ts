// Sends phone notifications for due reminders and scheduled medicines.
// Called every minute by pg_cron with the x-cron-secret header.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const H = 3600e3, WINDOW = 2 * H;

async function secrets() {
  const { data } = await admin.from("app_secrets").select("name,value").in("name", ["VAPID_PUBLIC", "VAPID_PRIVATE", "CRON_SECRET"]);
  return Object.fromEntries((data || []).map((r: any) => [r.name, r.value]));
}
async function docs(col: string) {
  const { data } = await admin.from("docs").select("id,data").eq("col", col);
  return (data || []).map((r: any) => ({ id: r.id, ...r.data }));
}
const patch = (col: string, id: string, p: Record<string, unknown>) => admin.rpc("doc_patch", { p_col: col, p_id: id, p_patch: p });

// minutes since midnight in a time zone, and the UTC instant of a local HH:MM today
function localParts(tz: string, d = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute };
}
function instantOf(tz: string, hh: number, mm: number) {
  const now = new Date(), lp = localParts(tz, now);
  const guess = Date.UTC(lp.y, lp.m - 1, lp.d, hh, mm);
  const back = localParts(tz, new Date(guess));
  const offset = Date.UTC(back.y, back.m - 1, back.d, back.h, back.min) - guess;
  return new Date(guess - offset);
}
function parseTime(t: string) {
  const m = String(t).trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null; let h = +m[1]; const mi = +(m[2] || 0);
  if (m[3] === "pm" && h < 12) h += 12; if (m[3] === "am" && h === 12) h = 0;
  return h < 24 && mi < 60 ? [h, mi] : null;
}

Deno.serve(async (req) => {
  const s = await secrets();
  if (!s.CRON_SECRET || req.headers.get("x-cron-secret") !== s.CRON_SECRET) return new Response("forbidden", { status: 403 });
  if (new URL(req.url).searchParams.get("check") === "ai") {
    // health check: is the Anthropic key working? (returns status only, never the key)
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") || "", "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 5, messages: [{ role: "user", content: "Say ok" }] }),
    });
    return new Response(JSON.stringify({ status: r.status, body: (await r.text()).slice(0, 300) }));
  }
  webpush.setVapidDetails("mailto:jason@texassecurelife.com", s.VAPID_PUBLIC, s.VAPID_PRIVATE);

  const { data: subs } = await admin.from("push_subs").select("endpoint,sub,tz");
  if (!subs?.length) return new Response("no subscribers");
  const tz = subs.find((x: any) => x.tz)?.tz || "America/Chicago";
  const now = Date.now();
  const [kids, reminders, meds, entries] = await Promise.all([docs("kids"), docs("reminders"), docs("meds"), docs("entries")]);
  const name = (k: string) => kids.find((x: any) => x.id === k)?.name || "";
  const out: { title: string; body: string; tag: string }[] = [];

  for (const r of reminders) {
    const at = Date.parse(r.at);
    if (r.done || r.pushedAt || !(at <= now && now - at < WINDOW)) continue;
    out.push({ title: "Tend", body: r.title, tag: "r-" + r.id });
    await patch("reminders", r.id, { pushedAt: new Date().toISOString() });
  }
  for (const m of meds) {
    if (m.asNeeded && !(m.times || []).length) continue;
    if (m.until && Date.parse(m.until + "T23:59:59") < now) continue;
    const doses = entries.filter((e: any) => e.type === "dose" && e.medId === m.id).map((e: any) => Date.parse(e.at)).sort((a: number, b: number) => b - a);
    let due: number | null = null;
    if ((m.times || []).length) {
      for (const t of m.times) { const p = parseTime(t); if (!p) continue; const at = +instantOf(tz, p[0], p[1]);
        if (at <= now && now - at < WINDOW && !doses.some((d: number) => d > at - 2 * H)) due = Math.max(due ?? 0, at); }
    } else if (m.everyH && doses.length) {
      const at = doses[0] + m.everyH * H; if (at <= now && now - at < WINDOW) due = at;
    }
    if (due == null) continue;
    const key = new Date(due).toISOString();
    if (m.pushedFor === key) continue;
    out.push({ title: "Tend", body: `💊 ${m.name}${m.dose ? " " + m.dose : ""} is due · ${name(m.kid)}`, tag: "m-" + m.id });
    await patch("meds", m.id, { pushedFor: key });
  }

  // alternating Tylenol/Motrin plan: push when the other medicine is due (built from the last logged dose)
  const FEVER: Record<string, { name: string; minH: number; max24: number }> = {
    ibuprofen: { name: "Motrin", minH: 6, max24: 4 }, acetaminophen: { name: "Tylenol", minH: 4, max24: 5 },
  };
  for (const k of kids) {
    if (!k.alternate) continue;
    const gap = +k.altGapH >= 1 && +k.altGapH <= 12 ? +k.altGapH : 3;
    const doses = entries.filter((e: any) => e.kid === k.id && e.type === "dose" && FEVER[e.med] && Date.parse(e.at) <= now)
      .map((e: any) => ({ med: e.med, t: Date.parse(e.at) })).sort((a: any, b: any) => b.t - a.t);
    if (!doses.length || now - doses[0].t > 12 * H) continue; // not in an active fever stretch
    const nextMed = doses[0].med === "ibuprofen" ? "acetaminophen" : "ibuprofen", m = FEVER[nextMed];
    const same = doses.filter((d: any) => d.med === nextMed);
    let due = Math.max(doses[0].t + gap * H, same[0] ? same[0].t + m.minH * H : 0);
    const ov = k.altNext; // a time the parent picked for this next dose
    if (ov?.at && ov.after === new Date(doses[0].t).toISOString()) due = Math.max(Date.parse(ov.at), same[0] ? same[0].t + m.minH * H : 0);
    const win = same.filter((d: any) => Math.max(now, due) - d.t < 24 * H);
    if (win.length >= m.max24) due = Math.max(due, win[win.length - 1].t + 24 * H);
    if (!(due <= now && now - due < WINDOW)) continue;
    const key = new Date(due).toISOString();
    if (k.altPushedFor === key) continue;
    // the app may already have made a reminder for this same dose
    if (reminders.some((r: any) => r.kid === k.id && Math.abs(Date.parse(r.at) - due) < 15 * 60e3)) { await patch("kids", k.id, { altPushedFor: key }); continue; }
    out.push({ title: "Tend", body: `💊 ${k.name}: ${m.name} is due (alternating plan)`, tag: "a-" + k.id });
    await patch("kids", k.id, { altPushedFor: key });
  }

  let sent = 0;
  for (const n of out) for (const sb of subs) {
    try { await webpush.sendNotification(sb.sub, JSON.stringify({ ...n, url: "./" }), { TTL: 3600, urgency: "high" }); sent++; }
    catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from("push_subs").delete().eq("endpoint", sb.endpoint); }
  }
  return new Response(JSON.stringify({ due: out.length, sent }), { headers: { "Content-Type": "application/json" } });
});
