// speed-to-lead  (dev2.0 / c2c-crm-dev)
// -----------------------------------------------------------------------------
// Instant first-touch responder for new website buyer leads (table:
// public.buyer_inquiries — the PPC / organic / social funnel).
//
// On a new inquiry it (1) texts the buyer a warm, TCPA-compliant first message
// and (2) alerts the agent to call within 5 minutes. Speed is the biggest lever
// on online-lead conversion, and contact rate is most of the gap between a 2%
// and a 4-5% funnel.
//
// SAFETY (STL_MODE env, default = safest):
//   dry_run (DEFAULT) -> sends nothing; logs exactly what it WOULD send.
//   test              -> sends only to STL_TEST_PHONE (your own cell).
//   live              -> texts the actual lead.
// The request body may downgrade to dry_run/test but can NEVER escalate to live
// (that needs STL_MODE=live). Hard-skips already-followed-up / no-phone / opted
// out, and a UNIQUE(inquiry_id) audit row means a lead can only ever get ONE
// automated first touch — so it cannot double-message.
//
// SMS goes through Twilio DIRECTLY (Account SID + Auth Token), matching this
// project's buyer_outbound_messages.twilio_message_sid design.
// -----------------------------------------------------------------------------

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ENV_MODE = (Deno.env.get("STL_MODE") ?? "dry_run").toLowerCase();
const ENV_TEST_PHONE = Deno.env.get("STL_TEST_PHONE") ?? "+19419623177"; // Frank's cell
const AGENT_CELL = Deno.env.get("STL_AGENT_CELL") ?? "+19419623177";
const TWILIO_FROM = Deno.env.get("TWILIO_FROM") ?? "+19413401004";
const BROKERAGE_NAME = Deno.env.get("STL_BROKERAGE_NAME") ?? "Coast 2 Coast Home Realty";
const AGENT_NAME = Deno.env.get("STL_AGENT_NAME") ?? "Frank Harris";
const BOOKING_URL = Deno.env.get("STL_BOOKING_URL") ?? ""; // optional "book a time" link

function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/[^0-9+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return "+" + digits;
}

function firstNameOf(inq: Record<string, unknown>): string {
  const fn = (inq.first_name as string) ?? "";
  if (fn.trim()) return fn.trim().split(/\s+/)[0];
  const full = (inq.name as string) ?? "";
  if (full.trim()) return full.trim().split(/\s+/)[0];
  return "there";
}

// A short, human reference to what they inquired about.
function propertyPhrase(inq: Record<string, unknown>): string {
  const addr = (inq.listing_address as string) ?? "";
  if (addr.trim()) {
    // Use just the street line to keep the text tight.
    return addr.split(",")[0].trim();
  }
  return "";
}

function buyerSms(inq: Record<string, unknown>): string {
  const name = firstNameOf(inq);
  const prop = propertyPhrase(inq);
  const opener = prop
    ? `thanks for your interest in ${prop}`
    : `thanks for reaching out`;
  const ask = prop
    ? `Want me to set up a private showing, or send you a few similar homes?`
    : `Are you hoping to tour something soon, or just starting to look?`;
  const book = BOOKING_URL ? ` You can also grab a time here: ${BOOKING_URL}` : "";
  return (
    `Hi ${name}, it's ${AGENT_NAME} with ${BROKERAGE_NAME} — ${opener}. ` +
    `${ask}${book} (Reply STOP to opt out.)`
  );
}

function agentAlertSms(inq: Record<string, unknown>): string {
  const name =
    `${(inq.first_name as string) ?? ""} ${(inq.last_name as string) ?? ""}`.trim() ||
    (inq.name as string) || "New lead";
  const phone = normalizePhone(inq.phone as string);
  const prop = propertyPhrase(inq);
  const src = (inq.lead_source as string) || (inq.cta_source as string) || "website";
  const when = inq.preferred_showing_at ? `\n🗓️ wants: ${inq.preferred_showing_at}` : "";
  return (
    `🚨 NEW LEAD — call within 5 min!\n\n` +
    `${name}\n📞 ${inq.phone || "no phone"}\n` +
    (prop ? `🏠 ${prop}\n` : "") +
    `🔗 source: ${src}` + when + `\n` +
    (phone ? `\nTap to call: tel:${phone}` : "")
  );
}

// Twilio direct (Basic auth with Account SID + Auth Token).
async function sendSms(to: string, body: string) {
  const SID = Deno.env.get("TWILIO_ACCOUNT_SID");
  const TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!SID || !TOKEN) {
    return { ok: false, error: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not configured", sid: null };
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${SID}:${TOKEN}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, error: res.ok ? null : (data.message || `HTTP ${res.status}`), sid: data.sid ?? null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const inquiryId = body.inquiryId ?? body.inquiry_id ?? body.record?.id;
    if (!inquiryId) throw new Error("inquiryId required");

    const reqMode = String(body.mode ?? "").toLowerCase();
    const MODE = reqMode === "test" || reqMode === "dry_run" ? reqMode : ENV_MODE;
    const TEST_PHONE = body.testPhone ?? ENV_TEST_PHONE;

    const { data: inq, error: inqErr } = await supabase
      .from("buyer_inquiries").select("*").eq("id", inquiryId).single();
    if (inqErr || !inq) throw new Error("Inquiry not found");

    // ---- Guards: one first-touch only --------------------------------------
    const skipReasons: string[] = [];
    if (inq.first_follow_up_sent_at) skipReasons.push("already_followed_up");
    if (["opted_out", "unsubscribed", "dnc"].includes(String(inq.follow_up_status ?? "").toLowerCase()))
      skipReasons.push("opted_out");
    if (!normalizePhone(inq.phone)) skipReasons.push("no_phone");

    const { data: prior } = await supabase
      .from("speed_to_lead_log").select("id").eq("inquiry_id", inquiryId).maybeSingle();
    if (prior) skipReasons.push("already_processed");

    const buyerTo = normalizePhone(inq.phone);
    const buyerBody = buyerSms(inq);
    const agentBody = agentAlertSms(inq);

    const plan = {
      mode: MODE,
      inquiry_id: inquiryId,
      lead_name: `${inq.first_name ?? ""} ${inq.last_name ?? ""}`.trim() || inq.name || null,
      buyer_sms: { to: buyerTo, body: buyerBody },
      agent_alert: { to: AGENT_CELL, body: agentBody },
      skip_reasons: skipReasons,
    };

    if (skipReasons.length > 0) {
      await supabase.from("speed_to_lead_log").insert({
        inquiry_id: inquiryId, mode: MODE, action: "skipped", skip_reasons: skipReasons, plan,
      });
      return new Response(JSON.stringify({ status: "skipped", plan }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- Send per mode ------------------------------------------------------
    let buyerSmsResult: Record<string, unknown> = { ok: null, note: "not_sent" };
    let agentSmsResult: Record<string, unknown> = { ok: null, note: "not_sent" };

    if (MODE === "test") {
      const tp = normalizePhone(TEST_PHONE);
      buyerSmsResult = await sendSms(tp, `[TEST→buyer] ${buyerBody}`);
      agentSmsResult = await sendSms(tp, `[TEST→agent] ${agentBody}`);
    } else if (MODE === "live") {
      buyerSmsResult = await sendSms(buyerTo, buyerBody);
      agentSmsResult = await sendSms(normalizePhone(AGENT_CELL), agentBody);
    }

    await supabase.from("speed_to_lead_log").insert({
      inquiry_id: inquiryId, mode: MODE, action: "processed", plan,
      result: { buyer_sms: buyerSmsResult, agent_sms: agentSmsResult },
    });

    // Only advance the real inquiry when we actually texted THEM.
    if (MODE === "live" && buyerSmsResult.ok) {
      const now = new Date().toISOString();
      await supabase.from("buyer_inquiries").update({
        first_follow_up_sent_at: now,
        last_contacted_at: now,
        last_activity_at: now,
        follow_up_status: "first_sent",
        lead_status: inq.lead_status ?? "contacted",
        contact_attempts: (inq.contact_attempts ?? 0) + 1,
      }).eq("id", inquiryId);
    }

    return new Response(
      JSON.stringify({ status: "ok", mode: MODE, plan,
        result: { buyer_sms: buyerSmsResult, agent_sms: agentSmsResult } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("speed-to-lead error:", e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
