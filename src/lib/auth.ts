import "server-only";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, userSettings } from "@/db/schema";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

const COOKIE = "bot_session";
const SESSION_DAYS = 30;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [alg, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Result of a sign-in / sign-up attempt, shared by the API routes and the auth form. */
export type AuthResult = { ok: true; userId: string } | { ok: false; error: string; status: number };

let dummyHash: string | null = null;

/**
 * Verify credentials and return the user id.
 * Never tells the caller which half was wrong, and always burns the same
 * amount of time whether or not the account exists.
 */
export async function signInWithPassword(email: string, password: string, ip: string): Promise<AuthResult> {
  const key = `login:${ip}:${email}`;
  if (!throttle(key)) {
    return { ok: false, error: "Too many attempts. Try again in a few minutes.", status: 429 };
  }
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (!user) {
    // keep timing similar whether or not the account exists
    dummyHash ??= await hashPassword("dummy-password");
    await verifyPassword(password, dummyHash);
    return { ok: false, error: "Incorrect email or password.", status: 401 };
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    return { ok: false, error: "Incorrect email or password.", status: 401 };
  }
  clearThrottle(key);
  return { ok: true, userId: user.id };
}

/** Create an account (plus its settings row) and return the new user id. */
export async function signUpWithAccount(
  email: string,
  password: string,
  name: string,
  ip: string,
): Promise<AuthResult> {
  if (!EMAIL.test(email) || email.length > 200) {
    return { ok: false, error: "Enter a valid email address.", status: 400 };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters.", status: 400 };
  }
  if (password.length > 200) {
    return { ok: false, error: "Password is too long.", status: 400 };
  }
  if (!throttle(`signup:${ip}`, 20)) {
    return { ok: false, error: "Too many attempts. Try again in a few minutes.", status: 429 };
  }
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) {
    return { ok: false, error: "An account with this email already exists. Try signing in.", status: 409 };
  }
  const local = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  const displayName = name.trim().slice(0, 40) || local.charAt(0).toUpperCase() + local.slice(1) || "You";
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword(password), displayName })
    .returning({ id: users.id });
  await db.insert(userSettings).values({ userId: user.id }).onConflictDoNothing();
  return { ok: true, userId: user.id };
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.insert(sessions).values({ id: sha(token), userId, expiresAt });
  const h = await headers();
  const secure = h.get("x-forwarded-proto") === "https";
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, sha(token)));
  jar.delete(COOKIE);
}

export type SessionUser = { id: string; email: string; displayName: string };

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
});

export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) throw new HttpError(401, "Please sign in.");
  return u;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Tiny in-memory throttle for auth attempts.
const attempts = new Map<string, { n: number; reset: number }>();
export function throttle(key: string, max = 8, windowMs = 10 * 60_000): boolean {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || rec.reset < now) {
    attempts.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  rec.n += 1;
  return rec.n <= max;
}
export function clearThrottle(key: string) {
  attempts.delete(key);
}

export function handleError(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}
