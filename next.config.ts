import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * StrictMode's dev-only double-mount races @codesandbox/sandpack-client's
   * async bundler registration: the stale client wins the race and squats in
   * the registry with a dead message channel, so preview hot-updates are
   * silently dropped. Verified 2026-09-02: updates broken in `next dev`,
   * working in `next start`, with the identical build. Turning StrictMode
   * off trades dev-only double-render warnings for a working preview.
   */
  reactStrictMode: false,
};

export default nextConfig;
