import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Note, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirectTo?: string }>;
}) {
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect("/");

  const params = await searchParams;

  return (
    <div className="mx-auto max-w-[420px] py-10">
      <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-ink">Sign in</h1>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
        MATCHED holds no funds and places no bets. This account is for your own records only.
      </p>

      <Panel className="mt-5">
        <form action="/api/auth/login" method="post" className="space-y-4 p-5">
          {params.error && (
            <div role="alert">
              <Note tone="caution">{params.error}</Note>
            </div>
          )}

          <input type="hidden" name="redirectTo" value={params.redirectTo ?? "/"} />

          <div>
            <label htmlFor="email" className="block text-[12px] font-medium text-ink">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              className="mt-1 w-full rounded-[4px] border border-line-strong bg-surface px-3 py-2 text-[13px] outline-none focus:border-accent"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-[12px] font-medium text-ink">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1 w-full rounded-[4px] border border-line-strong bg-surface px-3 py-2 text-[13px] outline-none focus:border-accent"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-[4px] bg-accent px-3 py-2 text-[13px] font-medium text-white hover:bg-accent-ink"
          >
            Sign in
          </button>
        </form>
      </Panel>

      <div className="mt-4">
        <Note>
          <span className="font-medium text-ink">Demonstration accounts.</span> Customer{" "}
          <code className="text-ink">demo@matched.test</code> /{" "}
          <code className="text-ink">matched-demo-2026</code>. Administrator{" "}
          <code className="text-ink">admin@matched.test</code> /{" "}
          <code className="text-ink">matched-admin-2026</code>.
        </Note>
      </div>
    </div>
  );
}
