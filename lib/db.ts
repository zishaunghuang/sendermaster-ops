import { PrismaClient } from "@prisma/client";
const globalDb = globalThis as unknown as { opsDb?: PrismaClient };
export const db = globalDb.opsDb ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalDb.opsDb = db;
