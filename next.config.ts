import type { NextConfig } from 'next';

/**
 * The data layer reads the generated CSVs from `data/` at runtime on the server.
 * On Vercel the serverless bundle must include them, otherwise the files are
 * absent and every tool fails. `outputFileTracingIncludes` makes Next copy them
 * into the function bundle.
 */
const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/chat': ['./data/**/*.csv'],
    '/api/automations/run': ['./data/**/*.csv'],
    '/': ['./data/**/*.csv'],
  },
};

export default nextConfig;
