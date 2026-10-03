// Install root-owned outside the checkout. Load production env only on the server.
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseEnv } = require('node:util');
const node = '/opt/sendermaster-ops/runtime/bin/node';
const [action, directory] = process.argv.slice(2);
if (!['migrate', 'verify'].includes(action) || !directory?.startsWith('/var/sofi/sendermaster-ops/releases/')) process.exit(64);
const config = parseEnv(fs.readFileSync('/etc/sendermaster-ops/environment', 'utf8'));
const database = new URL(config.DATABASE_URL);
if (database.hostname !== '127.0.0.1' || database.pathname !== '/sendermaster_ops' || database.username !== 'sendermaster_ops') throw new Error('Unexpected independent database target');
const uid = Number(cp.execFileSync('id', ['-u', 'sendermaster-ops'], { encoding: 'utf8' }).trim());
const gid = Number(cp.execFileSync('id', ['-g', 'sendermaster-ops'], { encoding: 'utf8' }).trim());
const env = { PATH: '/opt/sendermaster-ops/runtime/bin:/usr/bin:/bin', NODE_ENV: 'production', HOME: '/var/lib/sendermaster-ops', ...config };
if (action === 'migrate') {
  const result = cp.spawnSync(node, [path.join(directory, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd: directory, env, uid, gid, stdio: 'inherit' });
  if (result.error) throw new Error('Could not start independent database migration');
  process.exit(result.status ?? 1);
}
(async () => {
  const pid = cp.execFileSync('systemctl', ['show', 'sendermaster-ops', '--property=MainPID', '--value'], { encoding: 'utf8' }).trim();
  const live = Object.fromEntries(fs.readFileSync('/proc/' + pid + '/environ', 'utf8').split('\0').filter(Boolean).map(s => { const i=s.indexOf('='); return [s.slice(0,i),s.slice(i+1)]; }));
  if (Object.keys(live).some(k => /^AWS_|^SES_/.test(k))) throw new Error('AWS configuration must not enter the independent ops service');
  if (fs.realpathSync('/proc/' + pid + '/cwd') !== fs.realpathSync(directory)) throw new Error('Running process uses the wrong release directory');
  const read = cp.spawnSync(node, ['-e', "const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();db.$queryRaw`SELECT 1`.then(()=>db.$disconnect()).catch(()=>process.exit(1));"], { cwd: directory, env, uid, gid, stdio: 'pipe' });
  if (read.status !== 0) throw new Error('Independent database health failed');
  const key = crypto.createPrivateKey(live.OPS_SIGNING_PRIVATE_KEY.replace(/\\n/g, '\n'));
  const claims = Buffer.from(JSON.stringify({ id:'deployment-readiness-check', role:'VIEWER', verifiedAt:0, nonce:crypto.randomUUID(), issuedAt:Date.now() })).toString('base64url');
  const endpoint='/v2/internal/ops/overview';
  const canonical=Buffer.from(['ops-v1','GET',endpoint,crypto.createHash('sha256').update('').digest('hex'),claims].join('\n'));
  const response=await fetch(new URL(endpoint, live.CORE_INTERNAL_URL), { headers: { 'x-ops-claims':claims, 'x-ops-signature':crypto.sign(null,canonical,key).toString('base64url') }, signal:AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Signed core health failed: HTTP ' + response.status);
  console.log('Independent database and signed core interface: healthy');
})().catch(error => { console.error(error.message); process.exitCode=1; });
