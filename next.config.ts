import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray lockfile in a parent directory makes Next infer the wrong workspace
  // root. Pin it to this project so module resolution and file watching behave.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
