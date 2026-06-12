// speed-to-lead
// -----------------------------------------------------------------------------
// Instant first-touch responder for new buyer leads.
//
// The single biggest lever on online-lead conversion is SPEED: texting a brand
// new lead within ~1 minute (and alerting the agent to call) dramatically lifts
// the contact rate, which is most of the gap between a 2% and a 4-5% funnel.
//
// SAFETY FIRST (important for Frank):
//   This function has THREE modes, controlled by the STL_MODE env var. It
//   defaults to the safest one so it can NEVER accidentally double-message the
//   real leads that Sierra is already working.
//
//     dry_run  (DEFAULT) -> sends nothing. Logs exactly what it *would* send.
//     test               -> sends only to STL_TEST_PHONE / STL_TEST_EMAIL
//                           (i.e. Frank's own phone) so you can feel the
//                           speed-to-lead on your own device, risk-free.
//     live               -> sends to the actual lead. Only flip this when you've
//                           decided the new CRM (not Sierra) owns first touch.
//
// It also hard-skips DNC / opted-out / already-contacted leads, so even in
// `live` mode a lead can only ever receive ONE first-touch.
// -----------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Twilio is reached through the same Lovable connector gateway the rest of the
// platform already uses (see isa-lead-alert), so this works the moment it's
// switched on — no new Twilio plumbing required.
const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

const ENV_MODE = (Deno.env.get("STL_MODE") ?? "dry_run").toLowerCase();
const ENV_TEST_PHONE = Deno.env.get("STL_TEST_PHONE") ?? "+19419623177"; // Frank's cell
const ENV_TEST_EMAIL = Deno.env.get("STL_TEST_EMAIL") ?? "";
const AGENT_CELL = Deno.env.get("STL_AGENT_CELL") ?? "+19419623177"; // alert goes here
const TWILIO_FROM = Deno.env.get("STL_TWILIO_FROM") ?? "+19413401004";
const BROKERAGE_NAME = Deno.env.get("STL_BROKERAGE_NAME") ?? "Coast 2 Coast Home Realty";
const AGENT_NAME = Deno.env.get("STL_AGENT_NAME") ?? "Frank Harris";

function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/[^0-9+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return digits.startsWith("+") ? digits : "+" + digits;
}

function firstNameOf(lead: Record<string, unknown>): string {
  const fn = (lead.first_name as string) ?? "";
  if (fn.trim()) return fn.trim().split(/\s+/)[0];
  const full = (lead.full_name as string) ?? "";
  if (full.trim()) return full.trim().split(/\s+/)[0];
  return "there";
}

function areaPhrase(lead: Record<string, unknown>): string {
  const area =
    (lead.target_city as string) ||
    (lead.community as string) ||
    (lead.area_of_interest as string) ||
    (lead.target_zip as string) ||
    "";
  return area ? ` in ${area}` : "";
}

// The buyer's first text. Warm, specific, asks ONE easy question to spark a
// reply, and is TCPA-compliant with a clear opt-out.
function buyerSms(lead: Record<string, unknown>): string {
  const name = firstNameOf(lead);
  const area = areaPhrase(lead);
  return (
    `Hi ${name}, it's ${AGENT_NAME} with ${BROKERAGE_NAME}. ` +
    `I saw you were looking at homes${area} — I'd love to help. ` +
    `Are you hoping to tour something soon, or just starting to look? ` +
    `(Reply STOP to opt out.)`
  );
}

// The agent alert. The point is to get the human to CALL within 5 minutes.
function agentAlertSms(lead: Record<string, unknown>): string {
  const name =
    `${(lead.first_name as string) ?? ""} ${(lead.last_name as string) ?? ""}`.trim() ||
    (lead.full_name as string) ||
    "New lead";
  const phone = normalizePhone(lead.phone as string);
  const area = areaPhrase(lead).replace(/^ in /, "");
  const src = (lead.source as string) || (lead.source_detail as string) || "web";
  return (
    `🚨 NEW LEAD — call within 5 min!\n\n` +
    `${name}\n` +
    `📞 ${lead.phone || "no phone"}\n` +
    (area ? `📍 ${area}\n` : "") +
    `🔗 source: ${src}\n` +
    (phone ? `\nTap to call: tel:${phone}` : "")
  );
}

// Buyer welcome email — reuses the platform's existing "buyer-follow-up"
// transactional template (enqueued + dispatched by process-email-queue).
function buyerEmail(lead: Record<string, unknown>) {
  const name = firstNameOf(lead);
  const area = areaPhrase(lead);
  const subject = area
    ? `Homes${area} — let's find the right one`
    : `Let's find you the right home`;
  const body =
    `Thanks for reaching out — I'd love to help you find the right home${area}.\n\n` +
    `I just sent you a quick text too. Whenever you're ready, tell me a little about ` +
    `what you're looking for (area, price range, must-haves) and I'll put together a ` +
    `short list of homes that fit.\n\n` +
    `Would a quick call this week work? Just reply with a good time.\n\n` +
    `Talk soon,\n${AGENT_NAME}\n${BROKERAGE_NAME}`;
  return { subject, body, agentName: AGENT_NAME, buyerName: name };
}

async function sendEmail(recipient: string, lead: Record<string, unknown>, leadId: string) {
  try {
    const e = buyerEmail(lead);
    const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const res = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-transactional-email`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SRK}`,
          apikey: SRK,
        },
        body: JSON.stringify({
          templateName: "buyer-follow-up",
          recipientEmail: recipient,
          idempotencyKey: `stl-${leadId}`,
          templateData: e,
        }),
      },
    );
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, to: recipient, subject: e.subject, error: res.ok ? null : JSON.stringify(data) };
  } catch (err) {
    return { ok: false, to: recipient, error: String((err as Error).message ?? err) };
  }
}

async function sendSms(to: string, body: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
  if (!LOVABLE_API_KEY || !TWILIO_API_KEY) {
    return { ok: false, error: "Twilio gateway keys not configured", sid: null };
  }
  const res = await fetch(`${GATEWAY_URL}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TWILIO_API_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, error: res.ok ? null : JSON.stringify(data), sid: data.sid ?? null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const leadId = body.leadId ?? body.lead_id ?? body.record?.id;
    if (!leadId) throw new Error("leadId required");

    // Resolve mode. The request body may downgrade to dry_run/test for safe
    // testing, but it can NEVER escalate to "live" — going live requires the
    // STL_MODE=live env var. This keeps the "no double-message" guarantee.
    const reqMode = String(body.mode ?? "").toLowerCase();
    const MODE = reqMode === "test" || reqMode === "dry_run" ? reqMode : ENV_MODE;
    const TEST_PHONE = body.testPhone ?? ENV_TEST_PHONE;
    const TEST_EMAIL = body.testEmail ?? ENV_TEST_EMAIL;

    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();
    if (leadErr || !lead) throw new Error("Lead not found");

    // ---- Guards: a lead can only ever get ONE first touch -------------------
    const skipReasons: string[] = [];
    if (lead.dnc) skipReasons.push("dnc");
    if (lead.sms_opted_out) skipReasons.push("sms_opted_out");
    if (lead.contacted || lead.sms_first_message_sent) skipReasons.push("already_contacted");
    if (!normalizePhone(lead.phone)) skipReasons.push("no_phone");

    // Idempotency: have we already logged a first-touch for this lead?
    const { data: prior } = await supabase
      .from("speed_to_lead_log")
      .select("id")
      .eq("lead_id", leadId)
      .maybeSingle();
    if (prior) skipReasons.push("already_processed");

    const buyerTo = normalizePhone(lead.phone);
    const buyerBody = buyerSms(lead);
    const agentBody = agentAlertSms(lead);
    const emailPreview = buyerEmail(lead);

    const plan = {
      mode: MODE,
      lead_id: leadId,
      lead_name:
        `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() ||
        lead.full_name ||
        null,
      buyer_sms: { to: buyerTo, body: buyerBody },
      buyer_email: { to: lead.email ?? null, subject: emailPreview.subject, body: emailPreview.body },
      agent_alert: { to: AGENT_CELL, body: agentBody },
      skip_reasons: skipReasons,
    };

    // If skipped, log and return WITHOUT sending.
    if (skipReasons.length > 0) {
      await supabase.from("speed_to_lead_log").insert({
        lead_id: leadId,
        mode: MODE,
        action: "skipped",
        skip_reasons: skipReasons,
        plan,
      });
      return new Response(JSON.stringify({ status: "skipped", plan }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- Decide actual recipients based on mode -----------------------------
    let buyerSmsResult: Record<string, unknown> = { ok: null, note: "not_sent" };
    let agentSmsResult: Record<string, unknown> = { ok: null, note: "not_sent" };
    let buyerEmailResult: Record<string, unknown> = { ok: null, note: "not_sent" };

    if (MODE === "dry_run") {
      // Send nothing. The plan above is the deliverable.
    } else if (MODE === "test") {
      const tp = normalizePhone(TEST_PHONE);
      buyerSmsResult = await sendSms(tp, `[TEST→buyer] ${buyerBody}`);
      agentSmsResult = await sendSms(tp, `[TEST→agent] ${agentBody}`);
      if (TEST_EMAIL) buyerEmailResult = await sendEmail(TEST_EMAIL, lead, leadId);
    } else if (MODE === "live") {
      buyerSmsResult = await sendSms(buyerTo, buyerBody);
      agentSmsResult = await sendSms(normalizePhone(AGENT_CELL), agentBody);
      if (lead.email && !lead.do_not_email) {
        buyerEmailResult = await sendEmail(lead.email as string, lead, leadId);
      }
    }

    // ---- Persist results ----------------------------------------------------
    await supabase.from("speed_to_lead_log").insert({
      lead_id: leadId,
      mode: MODE,
      action: "processed",
      plan,
      result: { buyer_sms: buyerSmsResult, agent_sms: agentSmsResult, buyer_email: buyerEmailResult },
    });

    // Only mark the real lead as contacted when we actually messaged THEM.
    if (MODE === "live" && buyerSmsResult.ok) {
      const now = new Date().toISOString();
      await supabase
        .from("leads")
        .update({
          contacted: true,
          contacted_at: now,
          last_contacted_at: now,
          sms_first_message_sent: true,
          isa_alert_sent_at: now,
          touch_count: (lead.touch_count ?? 0) + 1,
          last_touch_channel: "sms",
          last_touch_at: now,
          contact_status: "auto_first_touch",
        })
        .eq("id", leadId);
    }

    return new Response(
      JSON.stringify({ status: "ok", mode: MODE, plan, result: {
        buyer_sms: buyerSmsResult, agent_sms: agentSmsResult, buyer_email: buyerEmailResult,
      } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("speed-to-lead error:", e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
