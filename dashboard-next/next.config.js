/** @type {import('next').NextConfig} */
const nextConfig = {
  // Mark native + Node-only modules as external so Next doesn't try to bundle them
  serverExternalPackages: ['better-sqlite3'],

  // Serve the legacy vanilla HTML/JS frontend from /public at the matching URLs.
  // The HTML files in public/ are accessible as /index.html and /pr.html; rewrite
  // root and /pr to those static assets for visual parity with the old dashboard.
  async rewrites() {
    return [
      { source: '/', destination: '/index.html' },
      { source: '/pr', destination: '/pr.html' },
    ];
  },
};

module.exports = nextConfig;
