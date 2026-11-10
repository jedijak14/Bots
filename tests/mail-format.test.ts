import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mimeMessage, validRecipient, validateDraft } from "../src/lib/connections/mail-format";

test("accepts one address and rejects headers or multiple recipients", () => {
  assert.equal(validRecipient("person+tag@example.com"), true);
  for (const input of ["user@example.com,other@example.com", "user@example.com\r\nBcc: bad@example.com", "name <user@example.com>", "", "a@b"]) assert.equal(validRecipient(input), false);
});

test("rejects header injection, empty content and oversized drafts", () => {
  assert.ok(validateDraft("a@example.com", "hello\r\nBcc: b@example.com", "Body"));
  assert.ok(validateDraft("a@example.com", "Hi", " "));
  assert.ok(validateDraft("a@example.com", "Hi", "x".repeat(20001)));
  assert.equal(validateDraft("a@example.com", "Hi", "Text"), null);
});

test("encodes Unicode subjects and body without adding headers", () => {
  const subject = "Hello 🌎 ".repeat(20);
  const body = "First line\nBcc: this is body text\nこんにちは";
  const mime = Buffer.from(mimeMessage("person@example.com", subject, body), "base64url").toString("utf8");
  assert.ok(mime.startsWith("To: person@example.com\r\nSubject: =?UTF-8?B?"));
  assert.ok(!mime.includes("\r\nBcc:"));
  const [headers, payload] = mime.split("\r\n\r\n");
  const encoded = [...headers.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map((m) => Buffer.from(m[1], "base64").toString("utf8")).join("");
  assert.equal(encoded, subject);
  assert.equal(Buffer.from(payload.replace(/\s/g, ""), "base64").toString("utf8"), body);
});
