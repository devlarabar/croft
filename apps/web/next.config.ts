import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: process.cwd() + "/../..",
  serverExternalPackages: ["@croft/core"],
  skipTrailingSlashRedirect: true,
  poweredByHeader: false,
  compress: false,
  // Next otherwise truncates cloned webhook/form bodies at 10 MB.
  experimental: { proxyClientMaxBodySize: Number.MAX_SAFE_INTEGER },
};

export default config;
