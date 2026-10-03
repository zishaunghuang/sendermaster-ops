import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../../../lib/db";
import {
  assertOrigin,
  errorResponse,
  HttpError,
  session,
} from "../../../lib/auth";
import { digest } from "../../../lib/crypto";
export async function GET() {
  try {
    await session(true);
    return Response.json({
      admins: await db.admin.findMany({
        select: {
          id: true,
          email: true,
          role: true,
          active: true,
          createdAt: true,
        },
      }),
      audit: await db.authAudit.findMany({
        take: 100,
        orderBy: { createdAt: "desc" },
      }),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(req: Request) {
  try {
    assertOrigin(req);
    const s = await session(true, true);
    const body = z
      .object({
        action: z.enum(["create", "disable", "role", "revoke", "reset"]),
        email: z.email().optional(),
        id: z.string().optional(),
        role: z.enum(["OWNER", "OPERATOR", "VIEWER"]).optional(),
        reason: z.string().min(5).max(1000),
      })
      .parse(await req.json());
    const token = randomBytes(32).toString("base64url");
    const setup = {
      setupHash: digest(token),
      setupExpiresAt: new Date(Date.now() + 86400000),
    };
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ops-admin-management'))`;
      const caller = await tx.admin.findUniqueOrThrow({
        where: { id: s.adminId },
      });
      if (!caller.active || caller.role !== "OWNER")
        throw new HttpError(403, "无操作权限");
      let targetId = body.id;
      if (body.action === "create") {
        if (!body.email || !body.role)
          throw new HttpError(400, "请填写邮箱和角色");
        targetId = (
          await tx.admin.create({
            data: {
              email: body.email.toLowerCase(),
              role: body.role,
              ...setup,
            },
          })
        ).id;
      } else {
        const target = await tx.admin.findUniqueOrThrow({
          where: { id: body.id },
        });
        if (
          target.role === "OWNER" &&
          ["disable", "reset", "role"].includes(body.action) &&
          (await tx.admin.count({
            where: {
              active: true,
              role: "OWNER",
              passwordHash: { not: null },
              id: { not: target.id },
            },
          })) === 0
        )
          throw new HttpError(409, "必须保留一名已激活的平台所有者");
        if (body.action === "disable")
          await tx.admin.update({
            where: { id: target.id },
            data: { active: false },
          });
        if (body.action === "role") {
          if (!body.role) throw new HttpError(400, "请选择角色");
          await tx.admin.update({
            where: { id: target.id },
            data: { role: body.role },
          });
        }
        if (body.action === "reset")
          await tx.admin.update({
            where: { id: target.id },
            data: {
              ...setup,
              passwordHash: null,
              totpSecret: null,
              lastTotpCounter: -1,
              recoveryHashes: [],
            },
          });
        await tx.session.deleteMany({ where: { adminId: target.id } });
      }
      await tx.authAudit.create({
        data: {
          actorId: s.adminId,
          targetId,
          action: `ADMIN_${body.action.toUpperCase()}`,
          reason: body.reason,
          requestId: randomUUID(),
        },
      });
    });
    return Response.json({
      ok: true,
      ...(["create", "reset"].includes(body.action)
        ? { setupUrl: `${process.env.OPS_ORIGIN}/?setup=${token}` }
        : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
