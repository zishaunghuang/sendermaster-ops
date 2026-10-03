import { randomBytes } from "node:crypto";
import { db } from "../lib/db";
import { digest } from "../lib/crypto";
async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !process.env.OPS_ORIGIN
  )
    throw new Error(
      "Usage: npm run owner:init -- owner@example.com (set OPS_ORIGIN and DATABASE_URL)",
    );
  const token = randomBytes(32).toString("base64url");
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ops-admin-management'))`;
    if (await tx.admin.count())
      throw new Error(
        "Owner initialization is allowed only on an empty database",
      );
    await tx.admin.create({
      data: {
        email,
        role: "OWNER",
        setupHash: digest(token),
        setupExpiresAt: new Date(Date.now() + 86400000),
      },
    });
  });
  console.log(
    `一次性初始化链接（24 小时有效，请安全传递）：${process.env.OPS_ORIGIN}/?setup=${token}`,
  );
}
main()
  .finally(() => db.$disconnect())
  .catch(() => {
    console.error("初始化未完成；请检查空数据库、邮箱和环境变量");
    process.exitCode = 1;
  });
