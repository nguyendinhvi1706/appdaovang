/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    return [{ source: '/uploads/:path*', destination: `${api}/uploads/:path*` }];
  },
};
export default nextConfig;
