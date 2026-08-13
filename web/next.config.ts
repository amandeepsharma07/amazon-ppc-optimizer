import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The analyser runs in the browser; ad reports are never sent to the server.
  experimental: { serverActions: { bodySizeLimit: "1mb" } },
  // The extension archive is read from disk at request time, so nothing in the
  // build can infer that the file is needed. Without this it is left out of the
  // deployed function and the download 404s in production while working
  // perfectly on a laptop.
  outputFileTracingIncludes: {
    "/api/extension/download": ["./assets/**"],
  },
};

export default nextConfig;
