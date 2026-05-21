# Kiron ⇄ Node Integration Spec

Version: 1.0 · Owner: Kiron platform team

This document defines the HTTP contract between **Kiron** (Lovable Cloud app) and the
**external Node.js service** your team builds and hosts. Implement against this spec; nothing
else in Kiron needs to change.

---

## 1. Endpoints

### 1.1 Kiron → Node (you implement)

Base URL: configured in Kiron as the `NODE_BASE_URL` secret.

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/echo` | Smoke test. Echo the request body back. |
| POST | `/v1/events/task.completed` | Fired when a task moves to `done`. |
| POST | `/v1/events/leave.approved` | Fired when HR approves a leave request. |
| POST | `/v1/sync/employees` | Nightly batch push of all active employees. |

All requests carry:

```
Authorization: Bearer <KIRON_TO_NODE_API_KEY>
Content-Type: application/json
X-Kiron-User: <uuid of the user that triggered the call, when applicable>
```

Reject any request whose `Authorization` header does not match `KIRON_TO_NODE_API_KEY`
with HTTP 401.

### 1.2 Node → Kiron (we already implemented)

Endpoint:

```
POST https://lbpfdzpyixpvxdwshycn.supabase.co/functions/v1/kiron-inbound-webhook
```

Required headers:

```
Authorization: Bearer <NODE_TO_KIRON_API_KEY>
X-Kiron-Signature: sha256=<hex HMAC-SHA256 of raw body using WEBHOOK_SIGNING_SECRET>
Content-Type: application/json
```

Body shape:

```json
{
  "event": "employee.created",
  "data": { "...": "any JSON payload for this event" },
  "idempotency_key": "stable-unique-string-per-event"
}
```

Responses:

| Status | Meaning |
|---|---|
| 200 `{ ok: true, id }` | Accepted and dispatched. |
| 200 `{ ok: true, deduplicated: true }` | Same `idempotency_key` already received — safe to ignore. |
| 401 | Bad bearer token or bad signature. |
| 400 | Missing `event` or `idempotency_key`. |
| 500 | Internal error — safe to retry. |

---

## 2. Signing algorithm

```
signature = HMAC-SHA256(secret = WEBHOOK_SIGNING_SECRET, message = rawRequestBody)
header    = "X-Kiron-Signature: sha256=" + lowercase_hex(signature)
```

Use the **raw** body string — do not re-stringify after parsing. Encoding is UTF-8.

### Node example (sender side)

```ts
import crypto from "node:crypto";

function sign(body: string, secret: string) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

const body = JSON.stringify({
  event: "employee.created",
  data: { id: "abc", name: "Jane" },
  idempotency_key: `employee.created:abc:${Date.now()}`,
});

await fetch("https://lbpfdzpyixpvxdwshycn.supabase.co/functions/v1/kiron-inbound-webhook", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.NODE_TO_KIRON_API_KEY}`,
    "X-Kiron-Signature": sign(body, process.env.WEBHOOK_SIGNING_SECRET!),
    "Content-Type": "application/json",
  },
  body,
});
```

---

## 3. Idempotency rules

- Every webhook **must** include a stable `idempotency_key`.
- Suggested format: `<event>:<entity_id>:<timestamp_or_version>`.
- Kiron stores the key in a unique index. Duplicates return `200 { deduplicated: true }`.
- This makes retry-on-failure safe — just resend the same payload.

---

## 4. curl smoke tests

### Verify Kiron can reach Node (run from your Node machine)

```bash
curl -i -X POST "$NODE_BASE_URL/v1/echo" \
  -H "Authorization: Bearer $KIRON_TO_NODE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"hello":"world"}'
```

### Verify Node can post a webhook to Kiron

```bash
BODY='{"event":"smoke.test","data":{"hello":"world"},"idempotency_key":"smoke-1"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SIGNING_SECRET" -hex | awk '{print $2}')

curl -i -X POST "https://lbpfdzpyixpvxdwshycn.supabase.co/functions/v1/kiron-inbound-webhook" \
  -H "Authorization: Bearer $NODE_TO_KIRON_API_KEY" \
  -H "X-Kiron-Signature: sha256=$SIG" \
  -H "Content-Type: application/json" \
  -d "$BODY"
```

Re-run the second command — second call should return `{ ok: true, deduplicated: true }`.

---

## 5. Secrets the Node team needs

Provided by the Kiron team (out-of-band, not in source control):

| Name | Used for |
|---|---|
| `KIRON_TO_NODE_API_KEY` | Validate inbound calls from Kiron. |
| `NODE_TO_KIRON_API_KEY` | Bearer token for outbound calls to Kiron. |
| `WEBHOOK_SIGNING_SECRET` | HMAC secret for signing outbound webhook bodies. |

The same three values are stored in Lovable Cloud secrets on the Kiron side.

---

## 6. Suggested event names

Adopt this naming so both sides agree:

| Direction | Event |
|---|---|
| Kiron → Node | `task.completed`, `task.assigned`, `leave.approved`, `employee.sync` |
| Node → Kiron | `employee.created`, `employee.updated`, `payroll.run.completed`, `external.task.update` |

Add new events freely — just keep the `<domain>.<action>` shape.

---

## Mail Module

Kiron Mail uses a hybrid IMAP/SMTP runtime:

- **Edge Functions** (Supabase) handle user-initiated actions: `test-mail-connection`, `save-mail-account`, `fetch-message-detail`, `sync-mail-folder`, `save-draft`, `send-mail`, `summarize-email`, `send-task-update-email`.
- **Node service** owns background IMAP polling, IDLE, and bulk attachment download. It fetches credentials via the `get-mail-credentials` edge function (service-to-service, signed with `KIRON_TO_NODE_API_KEY` / `NODE_TO_KIRON_API_KEY`).
- **Credentials** are stored in the private `email_account_credentials` table (service-role only, RLS denies all). The application never reads passwords.
- **Summarization** uses Lovable AI (`google/gemini-2.5-flash`) and writes to `email_summaries`.
- **First sync scope**: last 30 days, INBOX + Sent only. Additional folders are fetched on demand.
- **Task ↔ Email links**: rows in `email_links` connect a `message_id` to a `task`, `project`, `company`, or `person`. The "Create task from email" flow opens `/tasks?from_email=1&message_id=…&title=…&description=…`.
- **Outbound task updates**: `send-task-update-email` is invoked after task activity and sends templated HTML via the project owner's default mailbox (`profiles.email_default_account_id`).
