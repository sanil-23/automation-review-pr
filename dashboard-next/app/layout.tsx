// Root layout exists only because App Router requires one. The real frontend
// is served as static HTML from public/ via rewrites in next.config.js.
export const metadata = { title: 'PR Review Dashboard' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
