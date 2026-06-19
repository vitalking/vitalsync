import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // El paquete del workspace se distribuye como TypeScript: Next lo transpila.
  transpilePackages: ['@vitalsync/shared'],
};

export default nextConfig;
