import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray lockfile in a parent directory makes Next infer the wrong workspace
  // root. Pin it to this project so module resolution and file watching behave.
  turbopack: {
    root: __dirname,
  },
  // Lets a phone on the same WiFi load the dev server via its LAN IP — without
  // this, Next.js blocks cross-origin dev requests (HMR, etc.) by default.
  // Wildcarded to the whole home-network range instead of one exact IP, so
  // it doesn't need updating every time the machine's address changes (a
  // DHCP renewal, switching WiFi, etc. — same problem PARTYKIT_HOST used to
  // have, see lib/room.ts's getPartykitHost()).
  allowedDevOrigins: ["192.168.1.*"],
};

export default nextConfig;
