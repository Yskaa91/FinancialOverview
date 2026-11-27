// Home Assistant shows an add-on inside an iframe at a path it owns:
//
//   https://<home-assistant>/api/hassio_ingress/<token>/
//
// The Supervisor strips that prefix before the request reaches the container, so
// the app sees "/accounts" while the browser needs
// "/api/hassio_ingress/<token>/accounts" for every URL the app hands it. Next.js
// bakes its base path at build time and the token does not exist then, so the
// build uses the placeholder below and scripts/ingress-proxy.mjs swaps it for the
// real prefix on the way out. Direct access on port 3000 has no prefix and the
// same swap removes the placeholder instead, which is why both cases share one
// function.
export const INGRESS_MARKER = "/__ingress";

// Characters that end a URL inside HTML, JSON, flight data or CSS. A marker in
// the app root is followed by one of these instead of by "/", and has to become
// the prefix itself rather than "prefix + /".
const TERMINATORS = ['"', "'", "?", "#", "&", ")", ",", "`"];

/**
 * The prefix this request arrived under, or "" for a direct request.
 *
 * Home Assistant sends `X-Ingress-Path`. The URL is checked as well, so an
 * ingress request still works if the header is ever absent (or if the prefix is
 * not stripped).
 */
export function resolvePrefix(headers, url) {
  const header = headers["x-ingress-path"];
  if (typeof header === "string" && header.startsWith("/")) {
    return header.replace(/\/+$/, "");
  }
  const match = /^\/api\/hassio_ingress\/[^/?#]+/.exec(url ?? "");
  return match ? match[0] : "";
}

/** The path the Next server expects: always under the marker. */
export function upstreamPath(prefix, url) {
  let path = url ?? "/";
  if (prefix && path.startsWith(prefix)) path = path.slice(prefix.length);
  if (!path.startsWith("/")) path = `/${path}`;
  // No trailing slash on the root: Next's canonical form for a base path is
  // "/__ingress", and asking for "/__ingress/" earns a 308 back to it, which the
  // rewrite below would turn into a redirect loop for direct access.
  return path === "/" ? INGRESS_MARKER : `${INGRESS_MARKER}${path}`;
}

/**
 * Replace the marker with `prefix` (or with nothing, for direct access).
 *
 * Everything Next emits carries the marker: asset and chunk URLs, `<a href>`,
 * the flight data that repeats those hrefs after hydration, the webpack runtime's
 * public path, and Next's own redirects. One literal swap therefore moves the
 * whole app under the real prefix without parsing anything.
 */
export function rewriteUrls(text, prefix) {
  // "/__ingress" on its own means the app root: "" would make `href=""`, which
  // reloads the current page instead of going home.
  const bare = prefix || "/";
  let out = text.replaceAll(`${INGRESS_MARKER}/`, `${prefix}/`);
  for (const terminator of TERMINATORS) {
    out = out.replaceAll(INGRESS_MARKER + terminator, bare + terminator);
  }
  if (out.endsWith(INGRESS_MARKER)) out = out.slice(0, -INGRESS_MARKER.length) + bare;
  return out;
}

/**
 * A redirect target, placed under the prefix.
 *
 * Most redirects Next emits carry the marker (page-level ones do). A Server
 * Action's redirect after a no-JS form POST does not — it comes back as a bare
 * "/login" — so an absolute path gets the prefix explicitly.
 */
export function rewriteLocation(value, prefix) {
  const rewritten = rewriteUrls(value, prefix);
  if (!prefix) return rewritten;
  if (rewritten === prefix || rewritten.startsWith(`${prefix}/`)) return rewritten;
  return rewritten.startsWith("/") ? `${prefix}${rewritten}` : rewritten;
}

/**
 * Scope the session cookie to the ingress path. The cookie's origin is Home
 * Assistant, so a `Path=/` cookie would be sent with every Home Assistant
 * request, not just this app's.
 */
export function rewriteSetCookie(value, prefix) {
  if (!prefix) return value;
  return value.replace(/;\s*path=\/(?=;|$)/i, `; Path=${prefix}/`);
}
