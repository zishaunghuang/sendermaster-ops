import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  encrypt,
  decrypt,
  digest,
} from "../lib/crypto";
process.env.MFA_ENCRYPTION_KEY = "a".repeat(64);
test("password verification and length limits", () => {
  const encoded = hashPassword("correct horse stable orchard");
  assert(verifyPassword("correct horse stable orchard", encoded));
  assert(!verifyPassword("wrong", encoded));
  assert(!verifyPassword("wrong", null));
  assert.throws(() => hashPassword("short"));
});
test("MFA secrets are authenticated ciphertext with random IVs", () => {
  const a = encrypt("TOPSECRET"),
    b = encrypt("TOPSECRET");
  assert.notEqual(a, b);
  assert.equal(decrypt(a), "TOPSECRET");
  const parts = a.split(".");
  parts[2] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => decrypt(parts.join(".")));
  assert(!a.includes("TOPSECRET"));
});
test("tokens and recovery codes are stored only as digests", () => {
  assert.equal(digest("hello").length, 64);
  assert.notEqual(digest("a"), digest("b"));
});
