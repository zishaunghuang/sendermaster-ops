import { randomBytes, randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import { db } from '../lib/db';
import { digest } from '../lib/crypto';
async function main() {
 const [email,reason]=process.argv.slice(2);
 if(!email||!reason||reason.length<5||!process.env.OPS_ORIGIN)throw new Error('Usage: admin:recover EMAIL "incident reference / reason"');
 const token=randomBytes(32).toString('base64url');
 await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ops-admin-management'))`;
  const admin=await tx.admin.findUniqueOrThrow({where:{email:email.toLowerCase()}});
  await tx.admin.update({where:{id:admin.id},data:{passwordHash:null,totpSecret:null,lastTotpCounter:-1,recoveryHashes:[],setupHash:digest(token),setupExpiresAt:new Date(Date.now()+86400000)}});
  await tx.session.deleteMany({where:{adminId:admin.id}});
  await tx.authAudit.create({data:{actorId:`server:${userInfo().username}`,targetId:admin.id,action:'SERVER_ACCOUNT_RECOVERY',reason,requestId:randomUUID()}});
 });
 console.log(`一次性恢复链接（24 小时有效）：${process.env.OPS_ORIGIN}/?setup=${token}`);
}
main().catch(()=>{console.error('恢复失败：核对已存在的账号、原因和环境配置。');process.exitCode=1}).finally(()=>db.$disconnect());
