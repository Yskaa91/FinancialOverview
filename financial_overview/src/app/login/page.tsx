import { Card } from "@/components/ui";
import { isAuthEnabled } from "@/lib/auth";
import { login } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // With no password configured the guard is off; there is nothing to log in to.
  if (!isAuthEnabled()) {
    return (
      <Card title="Access">
        <p className="text-sm">
          No password is configured, so this installation is open to anything that can
          reach it. Set <code className="font-mono text-xs">ACCESS_PASSWORD</code> in{" "}
          <code className="font-mono text-xs">.env.local</code> — or the{" "}
          <em>Access password</em> add-on option — to require a login.
        </p>
      </Card>
    );
  }

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Financial Overview</h1>
      <p className="mb-4 text-xs text-muted">Enter the access password to continue.</p>

      <Card>
        <form action={login} className="grid gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-muted">Password</span>
            <input
              type="password"
              name="password"
              required
              autoFocus
              autoComplete="current-password"
              className="w-full rounded-md border border-border bg-background px-3 py-2"
            />
          </label>

          {error && (
            <p role="alert" className="text-xs text-negative">
              Wrong password.
            </p>
          )}

          <button
            type="submit"
            className="justify-self-start rounded-md bg-accent px-3 py-2 text-sm font-medium text-white"
          >
            Sign in
          </button>
        </form>
      </Card>

      <p className="mt-3 text-[11px] text-muted">
        One password, one session cookie, no accounts. It travels over plain HTTP on
        your local network, so keep this on the LAN.
      </p>
    </div>
  );
}
