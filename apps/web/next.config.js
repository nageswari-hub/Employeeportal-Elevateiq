/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone', // slim production image (Stage 9)
  skipTrailingSlashRedirect: true, // required: engine.io needs /socket.io/?... intact
  async rewrites() {
    // Same-origin in dev: browser calls /backend/*, Next proxies to NestJS.
    // Cookies stay first-party (no CORS issues). Prod: Nginx does the same.
    const api = process.env.BACKEND_URL ?? 'http://localhost:4001';
    return [
      { source: '/backend/:path*', destination: `${api}/api/:path*` },
      { source: '/socket.io', destination: `${api}/socket.io/` },
      { source: '/socket.io/:path*', destination: `${api}/socket.io/:path*` },
    ];
  },
};
module.exports = nextConfig;
