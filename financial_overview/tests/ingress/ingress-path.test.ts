import { describe, expect, it } from "vitest";
import {
  appendVary,
  INGRESS_MARKER,
  resolvePrefix,
  rewriteLocation,
  rewriteSetCookie,
  rewriteUrls,
  upstreamPath,
} from "../../scripts/ingress-path.mjs";

const PREFIX = "/api/hassio_ingress/abc123";

describe("resolvePrefix", () => {
  it("reads the header Home Assistant sends", () => {
    expect(resolvePrefix({ "x-ingress-path": `${PREFIX}/` }, "/")).toBe(PREFIX);
  });

  it("falls back to the request URL, for a request whose prefix was not stripped", () => {
    expect(resolvePrefix({}, `${PREFIX}/accounts?x=1`)).toBe(PREFIX);
  });

  it("returns nothing for a direct request", () => {
    expect(resolvePrefix({}, "/accounts")).toBe("");
  });
});

describe("upstreamPath", () => {
  it("moves the root under the marker, without a trailing slash", () => {
    expect(upstreamPath(PREFIX, "/")).toBe(INGRESS_MARKER);
  });

  // A dashboard period link is "/?p=2026-09&c=off". With a trailing slash Next
  // answers 308 back to the slashless root, which the rewrite turns into a loop.
  it("keeps a root query string without adding a slash", () => {
    expect(upstreamPath("", "/?p=2026-09&c=off")).toBe(`${INGRESS_MARKER}?p=2026-09&c=off`);
    expect(upstreamPath(PREFIX, "/?p=2026-09&c=off")).toBe(`${INGRESS_MARKER}?p=2026-09&c=off`);
  });

  it("keeps the query string", () => {
    expect(upstreamPath("", "/transactions?review=1")).toBe(`${INGRESS_MARKER}/transactions?review=1`);
  });

  it("strips a prefix that is still in the URL", () => {
    expect(upstreamPath(PREFIX, `${PREFIX}/accounts`)).toBe(`${INGRESS_MARKER}/accounts`);
  });
});

describe("rewriteUrls", () => {
  it("puts asset URLs under the prefix", () => {
    const html = `<script src="${INGRESS_MARKER}/_next/static/chunks/main.js"></script>`;
    expect(rewriteUrls(html, PREFIX)).toBe(
      `<script src="${PREFIX}/_next/static/chunks/main.js"></script>`,
    );
  });

  it("rewrites links, including the ones repeated in flight data", () => {
    const html = `<a href="${INGRESS_MARKER}/accounts">Accounts</a>`;
    expect(rewriteUrls(html, PREFIX)).toContain(`href="${PREFIX}/accounts"`);
  });

  it("turns the bare marker into the prefix, not into a trailing slash", () => {
    expect(rewriteUrls(`href="${INGRESS_MARKER}"`, PREFIX)).toBe(`href="${PREFIX}"`);
  });

  it("removes the marker for direct access", () => {
    expect(rewriteUrls(`href="${INGRESS_MARKER}/accounts"`, "")).toBe('href="/accounts"');
    expect(rewriteUrls(`href="${INGRESS_MARKER}"`, "")).toBe('href="/"');
  });

  // The bug this guards: rewriting the bare marker to "/" in the client bundle
  // made Next's basePath "/", so addPathPrefix("/portfolio", "/") produced
  // "//portfolio" and the browser went to http://portfolio.
  it("empties the bare marker inside JavaScript", () => {
    const chunk = `let n="${INGRESS_MARKER}";addPathPrefix("/portfolio",n)`;
    expect(rewriteUrls(chunk, "", false)).toBe('let n="";addPathPrefix("/portfolio",n)');
    expect(rewriteUrls(chunk, PREFIX, false)).toBe(`let n="${PREFIX}";addPathPrefix("/portfolio",n)`);
  });

  it("keeps asset prefixes intact inside JavaScript", () => {
    expect(rewriteUrls(`p="${INGRESS_MARKER}/_next/"`, "", false)).toBe('p="/_next/"');
  });

  it("leaves content without the marker alone", () => {
    const body = "no urls here, just a merchant name";
    expect(rewriteUrls(body, PREFIX)).toBe(body);
  });

  it("rewrites a redirect target", () => {
    expect(rewriteUrls(`${INGRESS_MARKER}/login?error=1`, PREFIX)).toBe(`${PREFIX}/login?error=1`);
  });
});

describe("appendVary", () => {
  it("keeps what the app already varies on", () => {
    expect(appendVary("Accept-Encoding", "X-Ingress-Path")).toBe("Accept-Encoding, X-Ingress-Path");
  });

  it("does not duplicate a name it already has", () => {
    expect(appendVary("accept-encoding, x-ingress-path", "X-Ingress-Path")).toBe(
      "accept-encoding, x-ingress-path",
    );
  });

  it("starts the list when there is none", () => {
    expect(appendVary(undefined, "X-Ingress-Path")).toBe("X-Ingress-Path");
  });
});

describe("rewriteLocation", () => {
  it("prefixes a page redirect that carries the marker", () => {
    expect(rewriteLocation(`${INGRESS_MARKER}/login`, PREFIX)).toBe(`${PREFIX}/login`);
  });

  it("prefixes a Server Action redirect, which comes back bare", () => {
    expect(rewriteLocation("/login", PREFIX)).toBe(`${PREFIX}/login`);
  });

  it("leaves an absolute URL alone", () => {
    expect(rewriteLocation("https://example.com/x", PREFIX)).toBe("https://example.com/x");
  });

  it("does not touch redirects for direct access", () => {
    expect(rewriteLocation(`${INGRESS_MARKER}/login`, "")).toBe("/login");
    expect(rewriteLocation(`${INGRESS_MARKER}?p=2026-09`, "")).toBe("/?p=2026-09");
  });

  // Root redirects carry a query and used to get the prefix twice.
  it("prefixes a root redirect with a query exactly once", () => {
    expect(rewriteLocation(`${INGRESS_MARKER}?p=2026-09&c=off`, PREFIX)).toBe(`${PREFIX}?p=2026-09&c=off`);
  });
});

describe("rewriteSetCookie", () => {
  const cookie = "fo_session=abc; Path=/; HttpOnly; SameSite=Lax";

  it("scopes the cookie to the ingress path", () => {
    expect(rewriteSetCookie(cookie, PREFIX)).toBe(
      `fo_session=abc; Path=${PREFIX}/; HttpOnly; SameSite=Lax`,
    );
  });

  it("keeps the root path for direct access", () => {
    expect(rewriteSetCookie(cookie, "")).toBe(cookie);
  });

  it("does not invent a path", () => {
    expect(rewriteSetCookie("foo=bar; HttpOnly", PREFIX)).toBe("foo=bar; HttpOnly");
  });
});
