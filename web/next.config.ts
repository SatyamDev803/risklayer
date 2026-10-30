import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // web/ lives inside the API repo, which has its own lockfile: pin the root.
  turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) },
  agentRules: false,
};

export default nextConfig;
