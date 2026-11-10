import { test } from "node:test";
import { strict as assert } from "node:assert";
import { decryptCredential, encryptCredential } from "../src/lib/connections/credential-crypto";

test("credentials encrypt randomly and are bound to user and service", () => {
  process.env.APP_SECRET = "a long test secret that is at least thirty two characters";
  const token = "sensitive refresh token";
  const encrypted = encryptCredential(token, "user-a", "gmail");
  assert.notEqual(encrypted, encryptCredential(token, "user-a", "gmail"));
  assert.equal(encrypted.includes(token), false);
  assert.equal(decryptCredential(encrypted, "user-a", "gmail"), token);
  assert.equal(decryptCredential(encrypted, "user-b", "gmail"), null);
  assert.equal(decryptCredential(encrypted, "user-a", "youtube"), null);
  const parts = encrypted.split(".");
  const bytes = Buffer.from(parts[3], "base64url");
  bytes[0] ^= 1;
  parts[3] = bytes.toString("base64url");
  assert.equal(decryptCredential(parts.join("."), "user-a", "gmail"), null);
  process.env.APP_SECRET = "another test secret that is at least thirty two characters";
  assert.equal(decryptCredential(encrypted, "user-a", "gmail"), null);
});
