import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { TOTP } from "otpauth";
import { db } from "../lib/db";
import { digest } from "../lib/crypto";
const enabled = process.env.RUN_OPS_HTTP_TESTS === "1";
test(
  "real HTTP enrollment, MFA replay, independent roles and session revocation",
  { skip: !enabled },
  async () => {
    if (
      !new URL(process.env.DATABASE_URL!).pathname.startsWith(
        "/sendermaster_ops_test_",
      )
    )
      throw new Error("isolated ops database required");
    const base = "http://127.0.0.1:3010";
    const origin = process.env.OPS_ORIGIN!;
    let cookie = "";
    const ids: string[] = [];
    async function request(
      path: string,
      body?: unknown,
      customCookie = cookie,
      customOrigin = origin,
    ) {
      const r = await fetch(base + "/api/" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          ...(body === undefined ? {} : { origin: customOrigin }),
          ...(customCookie ? { cookie: customCookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await r.json();
      return { r, data, cookie: r.headers.get("set-cookie")?.split(";")[0] };
    }
    try {
      assert.equal((await request("admins")).r.status, 401);
      assert.equal(
        (
          await request(
            "auth",
            {
              action: "login",
              email: "merchant@example.com",
              password: "not-a-platform-password",
              code: "000000",
            },
            "",
            "https://evil.example",
          )
        ).r.status,
        403,
      );
      const token = randomBytes(32).toString("base64url");
      const suffix = randomBytes(6).toString("hex");
      const owner = await db.admin.create({
        data: {
          email: `owner-${suffix}@example.test`,
          role: "OWNER",
          setupHash: digest(token),
          setupExpiresAt: new Date(Date.now() + 600000),
        },
      });
      ids.push(owner.id);
      const start = await request("auth", { action: "enroll", token });
      assert.equal(start.r.status, 200);
      assert(start.data.qr.startsWith("data:image/png"));
      const code = new TOTP({ secret: start.data.secret }).generate();
      const activated = await request("auth", {
        action: "activate",
        token,
        password: "test-owned-password-long-enough",
        code,
      });
      assert.equal(activated.r.status, 200);
      assert.equal(activated.data.recoveryCodes.length, 10);
      cookie = activated.cookie!;
      assert.equal((await request("auth")).data.role, "OWNER");
      assert.equal(
        (await request("auth", { action: "reauth", code })).r.status,
        401,
      );
      assert.equal(
        (
          await request("admins", {
            action: "disable",
            id: owner.id,
            reason: "test last owner protection",
          })
        ).r.status,
        409,
      );
      const created = await request("admins", {
        action: "create",
        email: `viewer-${suffix}@example.test`,
        role: "VIEWER",
        reason: "test independent role enforcement",
      });
      assert.equal(created.r.status, 200);
      const viewer = await db.admin.findUniqueOrThrow({
        where: { email: `viewer-${suffix}@example.test` },
      });
      ids.push(viewer.id);
      const vt = new URL(created.data.setupUrl).searchParams.get("setup");
      const enroll = await request("auth", { action: "enroll", token: vt });
      const va = await request("auth", {
        action: "activate",
        token: vt,
        password: "another-long-testing-password",
        code: new TOTP({ secret: enroll.data.secret }).generate(),
      });
      assert.equal(va.r.status, 200);
      const viewerCookie = va.cookie!;
      assert.equal(
        (await request("admins", undefined, viewerCookie)).r.status,
        403,
      );
      assert.equal(
        (await request("core/commands", { action: "pause" }, viewerCookie)).r
          .status,
        403,
      );
      const oldCookie = cookie;
      const recovered = await request("auth", {
        action: "login",
        email: owner.email,
        password: "test-owned-password-long-enough",
        code: activated.data.recoveryCodes[0],
        recovery: true,
      });
      assert.equal(recovered.r.status, 200);
      cookie = recovered.cookie!;
      assert.equal((await request("auth", undefined, oldCookie)).r.status, 401);
      assert.equal(
        (
          await request("auth", {
            action: "login",
            email: owner.email,
            password: "test-owned-password-long-enough",
            code: activated.data.recoveryCodes[0],
            recovery: true,
          })
        ).r.status,
        401,
      );
      assert.equal(
        (
          await request("admins", {
            action: "disable",
            id: viewer.id,
            reason: "test revoking active sessions",
          })
        ).r.status,
        200,
      );
      assert.equal(
        (await request("auth", undefined, viewerCookie)).r.status,
        401,
      );
    } finally {
      await db.authAudit.deleteMany({
        where: { OR: [{ actorId: { in: ids } }, { targetId: { in: ids } }] },
      });
      await db.admin.deleteMany({ where: { id: { in: ids } } });
      await db.$disconnect();
    }
  },
);
