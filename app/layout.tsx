import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "MATCHED — matched-betting intelligence",
  description:
    "Finds bookmaker promotional offers, reads their terms and calculates the hedge across every outcome. You place every bet yourself.",
};

const NAV = [
  { href: "/", label: "Today" },
  { href: "/offers", label: "Offers" },
  { href: "/match", label: "Match Finder" },
  { href: "/bets", label: "My Bets" },
  { href: "/bankroll", label: "Bankroll" },
  { href: "/profit", label: "Profit" },
  { href: "/learn", label: "Learn" },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null);

  return (
    <html lang="en-GB">
      <body>
        <div className="flex min-h-screen">
          <nav className="flex w-[208px] shrink-0 flex-col border-r border-line bg-surface">
            <div className="border-b border-line px-5 py-4">
              <Link href="/" className="block">
                <div className="text-[15px] font-semibold tracking-[0.14em] text-ink">MATCHED</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                  Betting intelligence
                </div>
              </Link>
            </div>

            <div className="flex-1 px-2.5 py-3">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded-[4px] px-2.5 py-[7px] text-[13px] text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
                >
                  {item.label}
                </Link>
              ))}

              {user?.role === "ADMIN" && (
                <>
                  <div className="mt-4 mb-1 px-2.5 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint">
                    Administration
                  </div>
                  <Link
                    href="/admin"
                    className="block rounded-[4px] px-2.5 py-[7px] text-[13px] text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
                  >
                    Admin
                  </Link>
                </>
              )}
            </div>

            <div className="border-t border-line px-5 py-3.5">
              {user ? (
                <>
                  <div className="truncate text-[12px] text-ink">{user.displayName ?? user.email}</div>
                  <form action="/api/auth/logout" method="post">
                    <button
                      type="submit"
                      className="mt-1 text-[11px] text-ink-faint underline underline-offset-2 hover:text-ink"
                    >
                      Sign out
                    </button>
                  </form>
                </>
              ) : (
                <Link href="/login" className="text-[12px] text-accent underline underline-offset-2">
                  Sign in
                </Link>
              )}
            </div>
          </nav>

          <main className="min-w-0 flex-1">
            <div className="mx-auto max-w-[1180px] px-8 py-7">{children}</div>
            <footer className="mx-auto max-w-[1180px] px-8 pb-8">
              <p className="border-t border-line pt-4 text-[11px] leading-relaxed text-ink-faint">
                MATCHED is not a bookmaker and not a betting exchange. It holds no funds and places
                no bets. You open your own accounts and place every bet yourself. Figures are
                calculations from the prices shown, not predictions, and every outcome is stated.
                Gambling can be harmful — support is available at{" "}
                <span className="text-ink-muted">begambleaware.org</span>.
              </p>
            </footer>
          </main>
        </div>
      </body>
    </html>
  );
}
