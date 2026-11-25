// One shared-password session, no user table. The cookie is an HMAC of a fixed
// context string keyed by the password, so it is stateless (nothing to store,
// nothing to expire server-side) and changing the password invalidates every
// existing session by construction.
//
// Enabled only when ACCESS_PASSWORD is set: development and the "just for me on
// my own laptop" case keep working with no login screen, while the Home
// Assistant add-on can turn it on through an option.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const SESSION_COOKIE = "fo_session";
const SESSION_CONTEXT = "financial-overview-session-v1";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/** The configured password, or null when the guard is off. */
export function accessPassword(): string | null {
  const value = process.env.ACCESS_PASSWORD?.trim();
  return value ? value : null;
}

export function isAuthEnabled(): boolean {
  return accessPassword() !== null;
}

/** Bearer token for a password. Deterministic, so it needs no session store. */
export function sessionToken(password: string): string {
  return createHmac("sha256", password).update(SESSION_CONTEXT).digest("hex");
}

/**
 * Constant-time compare that also hides the length: both sides are hashed first,
 * so `timingSafeEqual` never sees buffers of different sizes.
 */
function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export async function isAuthenticated(): Promise<boolean> {
  const password = accessPassword();
  if (!password) return true;
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return false;
  return safeEqual(cookie, sessionToken(password));
}

/**
 * Every page and every exported server action calls this first. Server Actions
 * are individually addressable endpoints, so the page guard alone would leave all
 * of them writable.
 */
export async function requireSession(): Promise<void> {
  if (await isAuthenticated()) return;
  redirect("/login");
}

/** Returns false on a wrong password; the caller decides how to report it. */
export async function startSession(candidate: string): Promise<boolean> {
  const password = accessPassword();
  if (!password) return true;
  if (!safeEqual(candidate, password)) return false;

  const store = await cookies();
  store.set(SESSION_COOKIE, sessionToken(password), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    // The add-on is reached over plain HTTP on a LAN, so a secure-only cookie
    // would simply never be sent back.
    secure: false,
  });
  return true;
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Used by the login action: no session, no data, but no hang either. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
