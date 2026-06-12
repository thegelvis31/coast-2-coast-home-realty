# Coast 2 Coast — Lead Funnel: Speed-to-Lead

This branch adds an **instant first-touch responder** ("speed-to-lead") for new
buyer leads — the highest-leverage change for moving online-lead conversion from
~2% toward 4–5%.

## Why speed-to-lead

Across online real-estate leads (PPC, organic, social, portals), the funnel is:

| Stage | What moves it |
|---|---|
| Visitor → Lead | landing page / form / offer |
| **Lead → Conversation (contact rate)** | **SPEED-TO-LEAD ← biggest, fastest lever** |
| Conversation → Appointment | scripts, value, calendar |
| Appointment → Active buyer | pre-approval, buyer agreement |
| Active → **Closed (the "2%")** | nurture + service |

A typical online lead converts to a closed deal at **1–3%**; top teams hit
**4–5%+**. The difference is overwhelmingly *contact rate* — and contact rate is
driven by how fast you reach a brand-new lead. Texting within ~1 minute and
getting the agent on the phone within 5 is the whole game.

## What's here

- `supabase/functions/speed-to-lead/index.ts` — the responder. On a new lead it
  (1) texts the buyer a warm, compliant first message, and (2) alerts the agent
  to call within 5 minutes.
- `supabase/migrations/0001_speed_to_lead_log.sql` — audit + idempotency table.
  A `UNIQUE(lead_id)` index guarantees a lead can only ever get **one** first
  touch.

## Safety: it cannot double-message Sierra's leads

`STL_MODE` controls behaviour and **defaults to the safest setting**:

| `STL_MODE` | Behaviour |
|---|---|
| `dry_run` *(default)* | Sends nothing. Logs exactly what it *would* send. |
| `test` | Sends only to `STL_TEST_PHONE` (your own cell) so you can feel it. |
| `live` | Sends to the actual lead. |

It also hard-skips any lead that is DNC, opted-out, or already contacted.

## Going live (deliberate, when ready)

1. Decide **one** system owns first touch (Sierra **or** this CRM) so there's no
   overlap. Easiest no-overlap start: point a single new PPC/social campaign at
   the CRM and let this own only those leads.
2. Confirm A2P 10DLC registration on the Twilio sending number.
3. Set `STL_MODE=test`, invoke on a couple of test leads, watch your phone.
4. Wire the trigger (DB trigger on `leads` insert, or the lead-intake webhook).
5. Flip `STL_MODE=live`.

### Env vars

`STL_MODE`, `STL_TEST_PHONE`, `STL_TEST_EMAIL`, `STL_AGENT_CELL`,
`STL_TWILIO_FROM`, `STL_BROKERAGE_NAME`, `STL_AGENT_NAME`, plus the existing
`LOVABLE_API_KEY` / `TWILIO_API_KEY` gateway keys.
