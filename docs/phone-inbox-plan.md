# Phone Inbox — One Number for Text + Voicemail

Status: **PLANNED** · 2026-07-05

## Goal

One phone number staff can text or call. Messages become writes in this system —
feeding logs, day-trip notes/returns, handoff notes, general dog notes — with a
confirmation text back. Voicemails are transcribed and handled exactly like texts.

## Decisions (Camilla, 2026-07-05)

- **Scope: everything** — care logs (fed / didn't eat), day-trip notes + returns,
  shift-handoff notes, general dog notes.
- **Access: staff allowlist** — only phone numbers registered on user profiles can
  write; unknown numbers get a polite rejection and nothing is stored.
- **Voice: voicemail-style** — greeting → message → transcript → same pipeline as SMS.
  No interactive prompts in v1.
- **Provider: undecided** — design is provider-agnostic; the adapter (webhook format,
  signature check, reply format) is one thin file. Twilio is the default assumption
  (~$1–2/mo + usage) unless a different provider is chosen at P2.

## Safety rails

- Phone writes are **additive only**: logs and notes. Never status changes
  (adoption, archive, isolation), never edits or deletes.
- If the parser isn't confident (unknown dog name, ambiguous action), the message
  lands in a **review queue** instead of guessing. Nothing is silently dropped:
  every accepted message either becomes a write or a review item.
- Every write is attributed to the matched staff profile and marked
  `source: 'phone'`.
- Webhook requests are signature-verified (same pattern as the Slack route);
  unsigned/invalid requests are rejected.

## Architecture

Reuses what exists:

- **Server writes**: `getAdminDb()` (`$lib/firebase/admin`) — same as the Slack
  playgroups webhook.
- **AI**: the existing `OPENAI_API_KEY` (already used by intake vision) for
  message parsing (structured extraction) and voicemail transcription (Whisper),
  server-side only.
- **Hosting**: provider webhooks are SvelteKit API routes on Vercel.

New, under `src/lib/server/phoneInbox/`:

| Module | Job |
|---|---|
| `types.ts` | `InboundMessage` (from, channel sms/voice, text, receivedAt, providerId) and `ParsedAction` union |
| `allowlist.ts` | match sender number → user profile (E.164-normalized `phoneNumber` field on profiles) |
| `parse.ts` | AI structured extraction: message + current dog-name roster → actions with confidence; low confidence → `needs_review` |
| `apply.ts` | apply actions via Admin SDK (feeding log, didn't-eat, trip log/note, handoff note, dog note) |
| `confirm.ts` | build the reply text ("Logged: Buddy didn't eat (PM). ✓") |
| `pipeline.ts` | glue: allowlist → parse → apply → confirmation; unparseable → `phoneInbox` review collection |

Routes: `/api/phone/inbound` (SMS webhook) and `/api/phone/voice` (voicemail:
answer + record, then recording-ready callback → transcribe → pipeline).

## Build phases

- [ ] **P0 — staff phone numbers.** Add `phoneNumber` to user profiles; editable in
      the admin Users panel. This is the allowlist source.
- [ ] **P1 — core pipeline (provider-free).** All of `src/lib/server/phoneInbox/`
      with unit tests (AI mocked). Testable end-to-end from a script before any
      phone number exists.
- [ ] **P2 — provider adapter + SMS.** Choose provider (default Twilio), buy number,
      wire `/api/phone/inbound` with signature verification, env vars, reply SMS.
- [ ] **P3 — voicemail.** Greeting + record + transcription (Whisper) → pipeline;
      confirmation goes back by SMS to the caller.
- [ ] **P4 — review queue UI.** Admin (or dashboard) list of `needs_review`
      messages with one-tap "apply as…" actions.

## Open questions

- Which greeting voice/text for the voicemail line?
- Should the confirmation SMS include an undo hint (e.g. "reply UNDO")? (v2)
