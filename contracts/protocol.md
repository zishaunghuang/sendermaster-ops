# Internal operations API v1

Authority: robot_store. Public proxies must deny `/v2/internal/ops`; the guard also requires a loopback socket and rejects Origin/cookies. No merchant session is accepted.

Use Ed25519, with separate private/public keys. Only sendermaster-ops has the private key; only robot_store needs the public key. Serialize claims as UTF-8 JSON then base64url:

```json
{"id":"platform-admin-id","role":"OWNER","verifiedAt":1790899200000,"nonce":"random-unique-request-id","issuedAt":1790899200000}
```

`issuedAt` is within ±60 seconds. `verifiedAt` is the time of actual MFA verification; writes require it within five minutes. Nonces are persisted, cannot repeat, and expire after the acceptance window. The exact string signed (LF delimiters, no trailing LF) is:

```text
ops-v1
POST
/v2/internal/ops/commands
sha256-of-exact-body-bytes-in-lowercase-hex
base64url-claims
```

Headers: `x-ops-claims`, `x-ops-signature` (base64url Ed25519 signature), Content-Type application/json. GET hashes an empty body. The path includes the exact query string. A transport retry MUST use a new nonce but reuse the SAME command operationId/body. After timeout GET operations/{operationId}; never guess whether a command ran.

Writes include operationId, organizationId, action, reason (5–1000 chars) and the tenant version read from detail. Versions prevent stale settings; idempotency also checks actor and body hash. Roles: VIEWER reads; OPERATOR policy/pause/alert-resolve; OWNER additionally resume/release/cancel. Platform account management lives only in ops.

Review POST freezes 1–100 explicit task IDs plus versions for 15 minutes, bound to the reviewing owner. Release/cancel consumes this batch atomically. SENT/SUBMITTING/UNKNOWN/REJECTED submissions cannot be released. Domain-resource changes require a new reviewed business task, never re-route a retry.

Business audit is OpsOperation in robot_store; authentication audit is AuthAudit in ops. Operation ID is the business request correlation ID; login/account audit stores its own request ID. Keys and cookies never go to the browser API for core. `openapi.json` is versioned with this protocol; breaking changes require an API version bump.
