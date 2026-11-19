import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The dictionary JSON and CSV are read with fs at runtime; make sure serverless
  // bundles (e.g. Vercel) ship them alongside routes.
  outputFileTracingIncludes: {
    "/*": ["./data/generated/**/*", "./data/raw/kh_dictionary.csv"],
  },
  // The checker moved to the home page; keep old links working (query is preserved).
  async redirects() {
    return [{ source: "/check", destination: "/", permanent: false }];
  },
};

export default nextConfig;