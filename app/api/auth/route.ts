import { randomBytes, randomUUID } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";
import { z } from "zod";
import { cookies } from "next/headers";
import { db } from "../../../lib/db";
import {
  assertOrigin,
  budget,
  cookieName,
  createSession,
  errorResponse,
  HttpError,
  session,
  verifyMfa,
} from "../../../lib/auth";
import {
  digest,
  encrypt,
  decrypt,
  hashPassword,
  verifyPassword,
} from "../../../lib/crypto";
export const runtime = "nodejs";
export async function GET() {
  try {
    const s = await session();
    return Response.json({
      id: s.admin.id,
      email: s.admin.email,
      role: s.admin.role,
      verifiedAt: s.verifiedAt,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(req: Request) {
  try {
    assertOrigin(req);
    const body = z
      .object({
        action: z.enum(["login", "enroll", "activate", "reauth", "logout"]),
        email: z.string().max(254).optional(),
        password: z.string().max(128).optional(),
        code: z.string().max(80).optional(),
        token: z.string().max(100).optional(),
        recovery: z.boolean().optional(),
      })
      .parse(await req.json());
    const requestId = randomUUID();
    if (body.action === "logout") {
      const s = await session();
      await db.session.delete({ where: { tokenHash: s.tokenHash } });
      (await cookies()).delete(cookieName);
      return Response.json({ ok: true });
    }
    if (body.action === "reauth") {
      const s = await session();
      await budget(`mfa:${s.adminId}`);
      if (!(await verifyMfa(s.adminId, body.code ?? "")))
        throw new HttpError(401, "验证码无效或已使用");
      await db.session.update({
        where: { tokenHash: s.tokenHash },
        data: { verifiedAt: new Date() },
      });
      await db.authAudit.create({
        data: { actorId: s.adminId, action: "REAUTH", requestId },
      });
      return Response.json({ ok: true });
    }
    if (body.action === "enroll" || body.action === "activate") {
      await budget(`setup:${digest(body.token ?? "")}`);
      const admin = await db.admin.findUnique({
        where: { setupHash: digest(body.token ?? "") },
      });
      if (
        !admin?.active ||
        !admin.setupExpiresAt ||
        admin.setupExpiresAt < new Date()
      )
        throw new HttpError(401, "初始化链接无效或已过期");
      if (body.action === "enroll") {
        const secret = admin.totpSecret
          ? decrypt(admin.totpSecret)
          : new Secret({ size: 20 }).base32;
        if (!admin.totpSecret) {
          const set = await db.admin.updateMany({
            where: { id: admin.id, totpSecret: null },
            data: { totpSecret: encrypt(secret) },
          });
          if (!set.count) throw new HttpError(409, "请重新加载初始化页面");
        }
        const uri = new TOTP({
          issuer: "SenderMaster Ops",
          label: admin.email,
          secret,
        }).toString();
        return Response.json({ secret, qr: await QRCode.toDataURL(uri) });
      }
      const passwordHash = hashPassword(body.password ?? "");
      if (!(await verifyMfa(admin.id, body.code ?? "")))
        throw new HttpError(401, "验证码无效或已使用");
      const codes = Array.from({ length: 10 }, () =>
        randomBytes(12).toString("hex"),
      );
      await db.$transaction(async (tx) => {
        const updated = await tx.admin.updateMany({
          where: { id: admin.id, setupHash: digest(body.token ?? "") },
          data: {
            passwordHash,
            recoveryHashes: codes.map(digest),
            setupHash: null,
            setupExpiresAt: null,
          },
        });
        if (!updated.count) throw new HttpError(409, "初始化已完成");
        await tx.session.deleteMany({ where: { adminId: admin.id } });
        await tx.authAudit.create({
          data: { actorId: admin.id, action: "ACTIVATED", requestId },
        });
      });
      await createSession(admin.id);
      return Response.json({ recoveryCodes: codes });
    }
    await budget(`login:${body.email ?? ""}`);
    const admin = await db.admin.findUnique({
      where: { email: body.email?.trim().toLowerCase() ?? "" },
    });
    const valid = verifyPassword(
      body.password ?? "",
      admin?.passwordHash ?? null,
    );
    if (
      !admin?.active ||
      !valid ||
      !(await verifyMfa(admin.id, body.code ?? "", body.recovery))
    ) {
      await db.authAudit.create({
        data: { actorId: admin?.id, action: "LOGIN_FAILED", requestId },
      });
      throw new HttpError(401, "账号、密码或验证码无效");
    }
    await createSession(admin.id);
    await db.authAudit.create({
      data: { actorId: admin.id, action: "LOGIN", requestId },
    });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
