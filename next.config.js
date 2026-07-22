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
    // This Next.js version (13.5.1) only accepts a boolean here — the
    // {bodySizeLimit} object form isn't supported until a later version, and
    // silently invalidates this whole block if used. APK/AAB/IPA uploads are
    // therefore capped by Next's built-in 1MB server action body limit.
    serverActions: true,
    // pdf-parse dynamically loads a worker module relative to its own package
    // directory; letting webpack bundle it breaks that relative path. Keeping
    // it external makes Next.js load it via plain `require` instead.
    serverComponentsExternalPackages: ['pdf-parse', 'app-info-parser'],
  },
  webpack: (config, { isServer }) => {
    // Disable webpack caching to reduce filesystem contention in the build sandbox.
    config.cache = false;
    return config;
  },
};

module.exports = nextConfig;
