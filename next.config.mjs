// NOTE: this file is intentionally `.mjs`, not `.ts`.
// Next 15.5 fails to load a TypeScript config in this environment with
// "Cannot read properties of undefined (reading 'fileExists')".

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "pino", "pg-boss"],
};

export default nextConfig;
