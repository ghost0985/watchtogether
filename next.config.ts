import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray lockfile in a parent directory makes Next infer the wrong workspace
  // root. Pin it to this project so module resolution and file watching behave.
  turbopack: {
    root: __dirname,
  },
  // Lets a phone on the same WiFi load the dev server via its LAN IP — without
  // this, Next.js blocks cross-origin dev requests (HMR, etc.) by default.
  allowedDevOrigins: ["172.20.10.10"],
};

export default nextConfig;
