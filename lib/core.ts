import { db } from './db';
import type { components } from "./api-types";
import { createHash, randomUUID, sign } from "node:crypto";
import { session, HttpError } from "./auth";
export async function core(path: string, method = "GET", value?: unknown) {
  const s = await session(false, method !== "GET");
  if (method !== "GET" && s.admin.role === "VIEWER")
    throw new HttpError(403, "只读账号不可修改");
  const base = new URL(
    process.env.CORE_INTERNAL_URL ?? "http://127.0.0.1:3000",
  );
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
    base.protocol !== "http:"
  )
    throw new Error("Core internal URL must use loopback HTTP");
  const body = value === undefined ? "" : JSON.stringify(value);
  const claims = Buffer.from(
    JSON.stringify({
      id: s.admin.id,
      role: s.admin.role,
      verifiedAt: s.verifiedAt.getTime(),
      nonce: randomUUID(),
      issuedAt: Date.now(),
    }),
  ).toString("base64url");
  const canonical = Buffer.from(
    [
      "ops-v1",
      method,
      path,
      createHash("sha256").update(body).digest("hex"),
      claims,
    ].join("\n"),
  );
  const signature = sign(
    null,
    canonical,
    (process.env.OPS_SIGNING_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  ).toString("base64url");
  if (method === 'POST' && path === '/v2/internal/ops/commands' && value && typeof value === 'object' && 'operationId' in value && typeof value.operationId === 'string') {
    await db.authAudit.create({ data: { actorId: s.admin.id, action: 'CORE_COMMAND', requestId: value.operationId, targetId: 'organizationId' in value && typeof value.organizationId === 'string' ? value.organizationId : undefined } });
  }
  const result = await fetch(new URL(path, base), {
    method,
    headers: {
      "content-type": "application/json",
      "x-ops-claims": claims,
      "x-ops-signature": signature,
    },
    ...(body ? { body } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const data = await result.json();
  if (!result.ok)
    throw new HttpError(
      result.status,
      typeof data.message === "string" ? data.message : "业务系统拒绝该操作",
    );
  return data;
}

export function submitCommand(input: components["schemas"]["Command"]) {
  return core("/v2/internal/ops/commands", "POST", input);
}
export function createReview(input: components["schemas"]["Review"]) {
  return core("/v2/internal/ops/reviews", "POST", input);
}
