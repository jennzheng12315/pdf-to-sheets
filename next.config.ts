import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
    };
    // Ensure native canvas modules are not bundled on server
    if (isServer) {
      config.externals.push("@napi-rs/canvas", "canvas");
    }
    return config;
  },
};

export default nextConfig;
