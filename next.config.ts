import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module (loads a .node binary at runtime).
  // It must stay external to Next's server bundler, or server-side DB access
  // fails to load the addon at runtime.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
