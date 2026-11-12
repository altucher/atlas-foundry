import type { NextConfig } from "next";

// Set NEXT_PUBLIC_BASE_PATH (e.g. /explodeanything) at build time to serve under a sub-path.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
};

export default nextConfig;
