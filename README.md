# Coast 2 Coast — Lead Funnel: Speed-to-Lead (dev2.0)

Instant first-touch responder for new website buyer leads — the highest-leverage
change for moving online-lead conversion from ~2% toward 4–5%.

**Target project:** `c2c-crm-dev` (dev2.0). **Lead table:** `public.buyer_inquiries`
(your PPC / organic / social funnel). **SMS:** Twilio direct.

## Why speed-to-lead

| Stage | What moves it |
|---|---|
| Visitor → Lead | landing page / form / offer |
| **Lead → Conversation (contact rate)** | **SPEED-TO-LEAD ← biggest, fastest lever** |
| Conversation → Appointment | scripts, value, calendar |
| Appointment → Active buyer | pre-approval, buyer agreement |
| Active → **Closed (the "2%")** | nurture + service |

A typical online lead closes at **1–3%**; top teams hit **4–5%+**. The difference
is overwhelmingly *contact rate*, driven by how fast you reach a fresh lead.

## What's here

- `supabase/functions/speed-to-lead/index.ts` — on a new `buyer_inquiries` row it
  (1) texts the buyer a warm, compliant first message, and (2) alerts the agent
  to call within 5 minutes. Twilio direct.
- `supabase/migrations/0001_speed_to_lead_log.sql` — audit + idempotency table
  (`UNIQUE(inquiry_id)` → a lead can only ever get **one** first touch).

Additive only: no existing tables or functions are modified.

## Safety: it cannot double-message

`STL_MODE` controls behaviour, **defaulting to the safest setting**:

| `STL_MODE` | Behaviour |
|---|---|
| `dry_run` *(default)* | Sends nothing. Logs exactly what it *would* send. |
| `test` | Sends only to `STL_TEST_PHONE` (your own cell). |
| `live` | Sends to the actual lead. |

The request body may downgrade to `dry_run`/`test`, but can never escalate to
`live`. Also hard-skips already-followed-up / opted-out / no-phone leads.

## Required secrets (dev2.0 Supabase → Edge Functions → Secrets)

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — your Twilio account.
- `TWILIO_FROM` *(optional)* — defaults to `+19413401004`.
- `STL_MODE` — set to `live` only when you've decided this CRM owns first touch.
- Optional: `STL_TEST_PHONE`, `STL_AGENT_CELL`, `STL_BOOKING_URL`,
  `STL_BROKERAGE_NAME`, `STL_AGENT_NAME`.

## Going live

1. Add the Twilio secrets above.
2. Confirm A2P 10DLC registration on the sending number.
3. `STL_MODE=test` → fire on a test inquiry, watch your phone.
4. Wire the trigger (DB trigger / webhook on `buyer_inquiries` insert).
5. Set `STL_MODE=live`.
