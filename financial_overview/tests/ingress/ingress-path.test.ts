import { describe, expect, it } from "vitest";
import {
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

  it("leaves content without the marker alone", () => {
    const body = "no urls here, just a merchant name";
    expect(rewriteUrls(body, PREFIX)).toBe(body);
  });

  it("rewrites a redirect target", () => {
    expect(rewriteUrls(`${INGRESS_MARKER}/login?error=1`, PREFIX)).toBe(`${PREFIX}/login?error=1`);
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
