import type { NextConfig } from "next";

const core = "./HSB_Contract/packages/hisaab-core/src";
const api = (process.env.HISAAB_API_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

const config: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  turbopack: {
    root: process.cwd(),
    resolveAlias: {
      "@hisaab/core": `${core}/index.ts`,
      "@hisaab/core/relay": `${core}/relay.ts`,
      viem: "./node_modules/viem",
      "viem/*": "./node_modules/viem/*",
    },
  },
  async rewrites() {
    return [
      { source: "/hisaab-api/:path*", destination: `${api}/api/v1/hisaab/:path*` },
      { source: "/ens-api/:path*", destination: `${api}/api/v1/ens/:path*` },
    ];
  },
};

export default config;
