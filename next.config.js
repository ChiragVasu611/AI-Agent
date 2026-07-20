/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: { unoptimized: true },
  experimental: {
    serverActions: true,
  },
  webpack: (config, { isServer }) => {
    // Disable webpack caching to reduce filesystem contention in the build sandbox.
    config.cache = false;
    return config;
  },
};

module.exports = nextConfig;
