import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The analyser runs in the browser; ad reports are never sent to the server.
  experimental: { serverActions: { bodySizeLimit: "1mb" } },
};

export default nextConfig;
