import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents/partialPrefetching (on by default in this scaffold) would
  // force every DB read into a Suspense boundary. Turned off until the pages
  // settle; revisit in phase 6 when the dashboard starts streaming.
  cacheComponents: false,
  partialPrefetching: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
