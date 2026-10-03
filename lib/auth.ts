import { ZodError } from 'zod';
import { cookies } from "next/headers";
import { randomBytes, randomUUID } from "node:crypto";
import { TOTP } from "otpauth";
import { db } from "./db";
import { decrypt, digest } from "./crypto";
export const cookieName =
  process.env.NODE_ENV === "production" ? "__Host-sm-ops" : "sm-ops-local";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assertOrigin(req: Request) {
  if (req.headers.get("origin") !== process.env.OPS_ORIGIN)
    throw new HttpError(403, "请求来源无效");
}
export async function session(owner = false, recent = false) {
  const token = (await cookies()).get(cookieName)?.value;
  const row = token
    ? await db.session.findUnique({
        where: { tokenHash: digest(token) },
        include: { admin: true },
      })
    : null;
  if (
    !row ||
    row.expiresAt < new Date() ||
    !row.admin.active ||
    !row.admin.passwordHash ||
    !row.admin.totpSecret
  )
    throw new HttpError(401, "请登录平台账号");
  if (owner && row.admin.role !== "OWNER")
    throw new HttpError(403, "仅平台所有者可执行");
  if (recent && Date.now() - row.verifiedAt.getTime() > 300000)
    throw new HttpError(403, "请先完成再次验证");
  return row;
}
export async function verifyMfa(
  adminId: string,
  code: string,
  recovery = false,
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${adminId}))`;
    const admin = await tx.admin.findUniqueOrThrow({ where: { id: adminId } });
    if (!admin.active || !admin.totpSecret) return false;
    if (recovery) {
      const hashed = digest(code);
      if (!admin.recoveryHashes.includes(hashed)) return false;
      await tx.admin.update({
        where: { id: adminId },
        data: {
          recoveryHashes: admin.recoveryHashes.filter((x) => x !== hashed),
        },
      });
      await tx.session.deleteMany({ where: { adminId } });
      await tx.authAudit.create({
        data: {
          actorId: adminId,
          action: "RECOVERY_CODE_USED",
          requestId: randomUUID(),
        },
      });
      return true;
    }
    const totp = new TOTP({
      secret: decrypt(admin.totpSecret),
      digits: 6,
      period: 30,
    });
    const delta = totp.validate({ token: code, window: 1 });
    const counter = Math.floor(Date.now() / 30000) + (delta ?? 0);
    if (delta === null || counter <= admin.lastTotpCounter) return false;
    await tx.admin.update({
      where: { id: adminId },
      data: { lastTotpCounter: counter },
    });
    return true;
  });
}
export async function budget(key: string) {
  const id = digest(key.toLowerCase());
  const now = new Date();
  const result = await db.$queryRaw<
    Array<{ count: number }>
  >`INSERT INTO "LoginBudget" (id,count,"resetAt") VALUES (${id},1,${new Date(Date.now() + 900000)}) ON CONFLICT (id) DO UPDATE SET count = CASE WHEN "LoginBudget"."resetAt" < ${now} THEN 1 ELSE "LoginBudget".count+1 END, "resetAt" = CASE WHEN "LoginBudget"."resetAt" < ${now} THEN ${new Date(Date.now() + 900000)} ELSE "LoginBudget"."resetAt" END RETURNING count`;
  if (result[0].count > 10)
    throw new HttpError(429, "尝试次数过多，请十五分钟后重试");
}
export async function createSession(adminId: string) {
  const token = randomBytes(32).toString("base64url");
  await db.session.create({
    data: {
      tokenHash: digest(token),
      adminId,
      expiresAt: new Date(Date.now() + 8 * 3600000),
      verifiedAt: new Date(),
    },
  });
  (await cookies()).set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 8 * 3600,
  });
}
export function errorResponse(error: unknown) {
  if (error instanceof ZodError) return Response.json({ error: "输入内容不符合要求，请检查后重试" }, { status: 400 });
  return Response.json(
    {
      error:
        error instanceof HttpError
          ? error.message
          : "操作未完成，请检查服务状态后重试",
    },
    { status: error instanceof HttpError ? error.status : 500 },
  );
}
