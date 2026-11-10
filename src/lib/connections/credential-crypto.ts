import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

// Separate key domain and associated data prevent credentials being transplanted
// between users/services or confused with the app's other encrypted settings.
function key(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) throw new Error("A strong APP_SECRET is required for connections.");
  return createHmac("sha256", secret).update("bots:oauth-credentials:v1").digest();
}
function binding(userId: string, service: string): Buffer {
  return Buffer.from(JSON.stringify([userId, service]), "utf8");
}
export function encryptCredential(plain: string, userId: string, service: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(binding(userId, service));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
export function decryptCredential(payload: string, userId: string, service: string): string | null {
  try {
    const [version, iv, tag, data, extra] = payload.split(".");
    if (version !== "v1" || !iv || !tag || !data || extra) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAAD(binding(userId, service));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch { return null; }
}
