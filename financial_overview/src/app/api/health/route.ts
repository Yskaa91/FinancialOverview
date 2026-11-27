// Liveness probe for the Supervisor's add-on watchdog.
//
// The watchdog polls one URL and treats only 200 and 302 as alive. `/` is not
// usable: with an access password set it is a 307 to /login, so the watchdog
// killed and restarted a perfectly healthy app every two minutes. This route is
// unauthenticated on purpose and answers 200 without touching the database.

export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok\n", {
    headers: { "content-type": "text/plain", "cache-control": "no-store" },
  });
}
