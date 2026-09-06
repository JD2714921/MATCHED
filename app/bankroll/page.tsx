import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma, Prisma } from "@/lib/db";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { D, bankrollRequirement, calculateHedge, DEFAULT_ROUNDING } from "@/lib/math";
import { asMoney } from "@/lib/serialize";
import { Badge, Money, Note, PageHeader, Panel, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

async function updateBalance(formData: FormData): Promise<void> {
  "use server";
  const user = await requireUser();
  const id = String(formData.get("accountId") ?? "");
  const raw = String(formData.get("balance") ?? "").trim().replace(/^£/, "").replace(/,/g, "");

  let balance: Prisma.Decimal;
  try {
    balance = new Prisma.Decimal(raw);
    if (balance.isNaN()) return;
  } catch {
    return;
  }

  await prisma.bankrollAccount.updateMany({
    where: { id, userId: user.id },
    data: { balance },
  });
  revalidatePath("/bankroll");
  revalidatePath("/");
}

export default async function BankrollPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect("/login?redirectTo=%2Fbankroll");

  const accounts = await prisma.bankrollAccount.findMany({
    where: { userId: user.id },
    orderBy: [{ kind: "asc" }, { label: "asc" }],
  });

  const exchange = accounts
    .filter((a) => a.kind === "EXCHANGE")
    .reduce((sum, a) => sum.plus(a.balance.toString()), new D(0));
  const bookmaker = accounts
    .filter((a) => a.kind === "BOOKMAKER")
    .reduce((sum, a) => sum.plus(a.balance.toString()), new D(0));

  const openLiability = await prisma.betLeg.aggregate({
    where: { betPlan: { userId: user.id, status: { notIn: ["COMPLETED", "ABANDONED"] } }, side: "LAY" },
    _sum: { liability: true },
  });

  const committed = openLiability._sum.liability
    ? new D(openLiability._sum.liability.toString())
    : new D(0);

  // A worked illustration of the sequential-versus-concurrent question, run
  // through the real engine rather than described in prose.
  const tokenLeg = calculateHedge({
    betType: "FREE_BET_SNR",
    backStake: new D("10"),
    backOdds: new D("3.20"),
    layOdds: new D("3.25"),
    commission: new D("0.05"),
    rounding: DEFAULT_ROUNDING,
  });
  const legs = tokenLeg.ok ? [tokenLeg.value, tokenLeg.value, tokenLeg.value] : [];
  const sequential = legs.length > 0 ? bankrollRequirement(legs, "SEQUENTIAL") : null;
  const concurrent = legs.length > 0 ? bankrollRequirement(legs, "CONCURRENT") : null;

  return (
    <>
      <PageHeader
        title="Bankroll"
        lede="What you hold, what is committed, and what you would need for the positions you are considering."
      />

      <Panel className="mb-4">
        <div className="grid grid-cols-2 gap-x-8 gap-y-6 px-6 py-5 md:grid-cols-4">
          <Stat label="At the exchange" value={`£${asMoney(exchange)}`} />
          <Stat label="At bookmakers" value={`£${asMoney(bookmaker)}`} />
          <Stat
            label="Committed as liability"
            value={`£${asMoney(committed)}`}
            hint="held against open lay bets"
            tone={committed.greaterThan(exchange) ? "negative" : "default"}
          />
          <Stat
            label="Free at the exchange"
            value={`£${asMoney(exchange.minus(committed))}`}
            hint="what is left to lay with"
            tone={exchange.minus(committed).isNegative() ? "negative" : "default"}
          />
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Your balances" subtitle="Kept by you, for your own records">
          <table className="data-table">
            <thead>
              <tr>
                <th className="pl-5">Account</th>
                <th className="num">Balance</th>
                <th className="pr-5"></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td className="pl-5">
                    <div className="text-[13px] text-ink">{account.label}</div>
                    <Badge>{account.kind.toLowerCase()}</Badge>
                  </td>
                  <td className="num">
                    <Money value={asMoney(new D(account.balance.toString()))} />
                  </td>
                  <td className="pr-5">
                    <form action={updateBalance} className="flex justify-end gap-2">
                      <input type="hidden" name="accountId" value={account.id} />
                      <input
                        name="balance"
                        inputMode="decimal"
                        defaultValue={account.balance.toFixed(2)}
                        aria-label={`New balance for ${account.label}`}
                        className="figure w-24 rounded-[4px] border border-line-strong px-2 py-1 text-[12px] outline-none focus:border-accent"
                      />
                      <button
                        type="submit"
                        className="rounded-[4px] border border-line-strong px-2.5 py-1 text-[12px] text-ink hover:bg-surface-sunken"
                      >
                        Update
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-line p-5">
            <Note>
              MATCHED holds no funds. These are figures you keep for your own planning, and nothing
              here can move money anywhere.
            </Note>
          </div>
        </Panel>

        <Panel
          title="How much you need"
          subtitle="Three £10 tokens at 3.20 / 3.25, 5% commission"
        >
          {sequential && concurrent ? (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="pl-5">Worked</th>
                    <th className="num">At the exchange</th>
                    <th className="num pr-5">With a 20% buffer</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="pl-5">
                      <div className="text-[13px] text-ink">One at a time</div>
                      <div className="text-[11px] text-ink-faint">
                        Each lay settles before the next is placed
                      </div>
                    </td>
                    <td className="num">
                      <Money value={sequential.exchangeBalance.toFixed(2)} />
                    </td>
                    <td className="num pr-5">
                      <Money value={sequential.recommendedTotal.toFixed(2)} size="sm" />
                    </td>
                  </tr>
                  <tr>
                    <td className="pl-5">
                      <div className="text-[13px] text-ink">All at once</div>
                      <div className="text-[11px] text-ink-faint">
                        Three simultaneous fixtures
                      </div>
                    </td>
                    <td className="num">
                      <Money value={concurrent.exchangeBalance.toFixed(2)} />
                    </td>
                    <td className="num pr-5">
                      <Money value={concurrent.recommendedTotal.toFixed(2)} size="sm" />
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="border-t border-line p-5">
                <Note>
                  The return is identical either way — only the capital differs. Worked one at a
                  time you need the largest single liability; placed together you need every one at
                  once. The buffer is there because lays fill worse than the screen showed, and an
                  exchange that runs out mid-sequence leaves you holding an unhedged back bet.
                </Note>
              </div>
            </>
          ) : (
            <div className="p-5 text-[12px] text-ink-faint">Could not compute the illustration.</div>
          )}
        </Panel>
      </div>
    </>
  );
}
