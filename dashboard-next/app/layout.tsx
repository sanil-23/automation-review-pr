import './globals.css';
import type { Metadata } from 'next';
import { SetupWizard } from '@/components/SetupWizard';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { reviewRepo } = require('@/lib/repo');

export const metadata: Metadata = {
  title: 'PR Review Dashboard',
  description: 'PR review automation',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const repo = reviewRepo();
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <div className="mx-auto max-w-[1600px] px-6 py-3 flex items-center justify-between">
            <h1 className="text-lg font-semibold">
              PR Review Dashboard
              <span className="ml-2 text-[var(--color-text-muted)] text-sm font-normal">{repo}</span>
            </h1>
            {/* Global — first-run modal + ⚙ settings on every route */}
            <SetupWizard />
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
