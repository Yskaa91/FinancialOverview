import { INGRESS_MARKER } from "./scripts/ingress-path.mjs";

/** @type {import("next").NextConfig} */
const nextConfig = {
  // Home Assistant opens the add-on in an iframe under a path it owns, and that
  // path is only known at runtime. The build therefore fixes a placeholder that
  // scripts/ingress-proxy.mjs replaces with the real prefix (or removes, for
  // direct access). Links, assets, chunks and redirects all pick it up from here.
  basePath: INGRESS_MARKER,
  // cacheComponents/partialPrefetching (on by default in this scaffold) would
  // force every DB read into a Suspense boundary. Turned off until the pages
  // settle; revisit in phase 6 when the dashboard starts streaming.
  cacheComponents: false,
  partialPrefetching: false,
  // pdfjs loads its own worker and feature-detects DOM globals, which a bundler
  // breaks. Keep it as a plain Node import; it only runs in the import action.
  serverExternalPackages: ["unpdf"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },

  experimental: {
    serverActions: {
      // The framework default is 1 MB, which rejects real statements before the
      // app's own 5 MB check ever runs (a 2 MB ASN export failed with a bare 413).
      // Raised to match the app's cap plus multipart overhead.
      bodySizeLimit: "12mb",
    },
  },

  async headers() {
    // No nonces: a nonce needs middleware, and middleware cannot verify the
    // session cookie here (see docs/ARCHITECTURE.md). 'unsafe-inline' for scripts
    // is the price of that; it still blocks external script origins, framing and
    // base-uri tricks, which is what a LAN tool needs.
    // Development only: React's debugging features (callstack reconstruction,
    // Fast Refresh) call eval(). Production never does, so it stays blocked.
    const scripts =
      process.env.NODE_ENV === "production"
        ? "'self' 'unsafe-inline'"
        : "'self' 'unsafe-inline' 'unsafe-eval'";
    const csp = [
      "default-src 'self'",
      `script-src ${scripts}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
      // Same-origin framing only. Home Assistant's ingress iframe is served from
      // the Home Assistant origin, so it is same-origin; a foreign site still
      // cannot frame the app, which is the point of both this and the header.
      "frame-ancestors 'self'",
      "base-uri 'none'",
      "object-src 'none'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          // Clickjacking: the app has destructive buttons one click away.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
