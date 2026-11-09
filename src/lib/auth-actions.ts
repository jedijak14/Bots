"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createSession, destroySession, signInWithPassword, signUpWithAccount } from "@/lib/auth";
import type { AuthFormState } from "@/components/AuthForm";

/**
 * Sign in / create an account.
 *
 * The whole exchange happens in one request: the form posts here, we check the
 * credentials, set the session cookie and redirect — so the app that renders
 * after the redirect already sees a valid session. No client side fetch, no
 * second navigation, and it still works with JavaScript turned off.
 */
export async function authenticateAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const mode = String(formData.get("intent") ?? "signin") === "signup" ? "signup" : "signin";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "");
  const ip = (await headers()).get("x-forwarded-for") ?? "local";

  let result;
  try {
    result =
      mode === "signup"
        ? await signUpWithAccount(email, password, name, ip)
        : await signInWithPassword(email, password, ip);
  } catch {
    return { error: "Something went wrong. Please try again.", mode };
  }
  if (!result.ok) return { error: result.error, mode };

  try {
    await createSession(result.userId);
  } catch {
    return { error: "We couldn't start your session. Please try again.", mode };
  }
  redirect("/");
}

/** Sign out: drop the session and send the user back to the sign-in page. */
export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
