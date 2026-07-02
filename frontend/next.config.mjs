/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  async rewrites() {
    const backend = process.env.BACKEND_INTERNAL_URL ?? "http://backend:8000";
    return [
      { source: "/api/v1/:path*", destination: `${backend}/api/v1/:path*` },
      { source: "/media/:path*", destination: `${backend}/media/:path*` },
    ];
  },
};
export default nextConfig;
