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
    // pdf-parse dynamically loads a worker module relative to its own package
    // directory; letting webpack bundle it breaks that relative path. Keeping
    // it external makes Next.js load it via plain `require` instead.
    serverComponentsExternalPackages: ['pdf-parse'],
  },
  webpack: (config, { isServer }) => {
    // Disable webpack caching to reduce filesystem contention in the build sandbox.
    config.cache = false;
    return config;
  },
};

module.exports = nextConfig;
