import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function hashPassword(password: string) {
  if (password.length < 14 || password.length > 128)
    throw new Error("密码需要 14–128 个字符");
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 }).toString("hex")}`;
}
export function verifyPassword(password: string, encoded: string | null) {
  const [salt, key] = (
    encoded ?? "00000000000000000000000000000000:" + "0".repeat(128)
  ).split(":");
  const result = scryptSync(password.slice(0, 128), salt, 64, {
    N: 32768,
    maxmem: 64 * 1024 * 1024,
  });
  const expected = Buffer.from(key, "hex");
  return (
    expected.length === result.length &&
    timingSafeEqual(result, expected) &&
    !!encoded
  );
}
function encryptionKey() {
  const key = process.env.MFA_ENCRYPTION_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw new Error("MFA encryption key missing");
  return Buffer.from(key, "hex");
}
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(value), cipher.final()]);
  return [iv, cipher.getAuthTag(), body]
    .map((v) => v.toString("base64url"))
    .join(".");
}
export function decrypt(value: string) {
  const [iv, tag, body] = value
    .split(".")
    .map((v) => Buffer.from(v, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(body), cipher.final()]).toString();
}
