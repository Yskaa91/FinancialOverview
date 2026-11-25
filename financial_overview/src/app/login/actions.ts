"use server";

import { redirect } from "next/navigation";
import { endSession, sleep, startSession } from "@/lib/auth";

/**
 * The only unauthenticated action in the app. A wrong password costs a fixed
 * delay: there is one account, so a lockout table would be more machinery than
 * the threat deserves, but the delay makes guessing across the LAN pointless.
 */
export async function login(formData: FormData): Promise<void> {
  const password = formData.get("password");
  const accepted = await startSession(typeof password === "string" ? password : "");

  if (!accepted) {
    await sleep(600);
    redirect("/login?error=1");
  }
  redirect("/");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/login");
}
