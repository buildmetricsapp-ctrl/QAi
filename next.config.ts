import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['canvas', 'pdfjs-dist', 'jszip'],
};

export default nextConfig;