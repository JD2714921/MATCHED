import { D, DEFAULT_ROUNDING, calculateHedge } from "@/lib/math";
import { serializeHedge } from "@/lib/serialize";
import { Note, PageHeader, Panel } from "@/components/ui";
import { SettlementPanel } from "@/components/settlement-panel";

export const dynamic = "force-static";

/**
 * Learn.
 *
 * The worked examples on this page are computed by the real engine at render
 * time rather than typed in as prose. If the engine ever changed, this page
 * would change with it — a documentation page that can go stale is worse than
 * none.
 */
export default function LearnPage() {
  const qualifying = calculateHedge({
    betType: "QUALIFYING",
    backStake: new D("10"),
    backOdds: new D("3.20"),
    layOdds: new D("3.25"),
    commission: new D("0.05"),
    rounding: DEFAULT_ROUNDING,
  });

  const snr = calculateHedge({
    betType: "FREE_BET_SNR",
    backStake: new D("30"),
    backOdds: new D("5.00"),
    layOdds: new D("5.20"),
    commission: new D("0.05"),
    rounding: DEFAULT_ROUNDING,
  });

  const sr = calculateHedge({
    betType: "FREE_BET_SR",
    backStake: new D("30"),
    backOdds: new D("5.00"),
    layOdds: new D("5.20"),
    commission: new D("0.05"),
    rounding: DEFAULT_ROUNDING,
  });

  return (
    <>
      <PageHeader
        title="Learn"
        lede="How the calculations work, and what the figures on the other screens actually mean."
      />

      <div className="space-y-4">
        <Panel title="What this is">
          <div className="space-y-3 p-5 text-[13px] leading-relaxed text-ink-muted">
            <p>
              A bookmaker offers you something — typically a token to bet with — if you first place
              a bet of your own. Matched betting is the practice of covering that bet on a betting
              exchange, so that the same amount comes back to you however the event turns out, and
              the value of the token is what remains.
            </p>
            <p>
              MATCHED does three things: it finds those offers, it reads their terms, and it
              calculates the hedge across every outcome. It is not a bookmaker and not an exchange.
              It holds no funds and places no bets. You open your own accounts and place every bet
              yourself.
            </p>
            <Note tone="accent">
              <span className="font-medium">The governing rule.</span> A language model interprets
              text. Code calculates every figure. Market data comes from the exchange&rsquo;s own
              API. You execute. No model is ever the source of a stake, a liability or a return.
            </Note>
          </div>
        </Panel>

        <Panel title="The qualifying bet" subtitle="Your own money, and it usually costs a little">
          <div className="space-y-4 p-5">
            <p className="text-[13px] leading-relaxed text-ink-muted">
              You back a selection at the bookmaker and lay the same selection on the exchange. The
              exchange price is always a little worse than the bookmaker&rsquo;s, and the exchange
              charges commission, so the two do not cancel exactly. What is left over is the
              qualifying loss — the price of unlocking the token.
            </p>

            <div className="rounded-[5px] border border-line bg-surface-sunken p-4">
              <div className="mb-2 text-[12px] font-medium text-ink">
                Back £10 at 3.20, lay at 3.25, 5% commission
              </div>
              <code className="figure block text-[12px] text-ink-muted">
                lay stake = back stake × back odds ÷ (lay odds − commission)
                <br />
                {"          "}= 10 × 3.20 ÷ (3.25 − 0.05) = £
                {qualifying.ok ? qualifying.value.layStake.toFixed(2) : "—"}
              </code>
            </div>

            {qualifying.ok && <SettlementPanel calculation={serializeHedge(qualifying.value)} />}

            <Note>
              Both columns come to the same figure. That is the point: you know what it cost before
              the event has started, and nothing about the result changes it.
            </Note>
          </div>
        </Panel>

        <Panel
          title="The two kinds of free bet"
          subtitle="The single most valuable line in a set of terms"
        >
          <div className="space-y-4 p-5">
            <p className="text-[13px] leading-relaxed text-ink-muted">
              A free bet either returns its face value along with any winnings, or it does not. The
              terms will say <em>stake not returned</em> (SNR) or <em>stake returned</em> (SR), and
              the difference is large. Here is the same £30 token at the same prices, read both
              ways.
            </p>

            <div className="grid gap-3 md:grid-cols-2">
              <TokenExample
                title="Stake not returned (SNR)"
                subtitle="The bookmaker pays winnings only"
                calculation={snr.ok ? serializeHedge(snr.value) : null}
              />
              <TokenExample
                title="Stake returned (SR)"
                subtitle="The face value comes back too"
                calculation={sr.ok ? serializeHedge(sr.value) : null}
              />
            </div>

            <Note tone="caution">
              Reading one as the other misstates the token by roughly a quarter of its face value.
              That is why the terms parser refuses to assume it: where the wording does not say, the
              offer is routed to a person rather than guessed at.
            </Note>
          </div>
        </Panel>

        <Panel title="Why the figures move once you place them">
          <div className="space-y-3 p-5 text-[13px] leading-relaxed text-ink-muted">
            <p>
              <span className="font-medium text-ink">Rounding.</span> You cannot place a fraction of
              a penny, so the lay stake is rounded and both outcomes are then recalculated from the
              rounded figure. The two outcomes end up a penny or two apart. Rounding down leaves you
              slightly exposed to the back bet losing; rounding up, to it winning.
            </p>
            <p>
              <span className="font-medium text-ink">Partial matching.</span> A lay only fills as far
              as there is money on the other side. If the book is thin, part of your lay sits
              unmatched and that part of your back bet is not covered.
            </p>
            <p>
              <span className="font-medium text-ink">The price you actually get.</span> Exchange
              prices move. A lay that fills at 3.35 rather than 3.25 is a worse position, and the
              profit record on this site is computed from what you actually got rather than from
              what was suggested.
            </p>
            <p>
              <span className="font-medium text-ink">There is no bookmaker odds feed here.</span>{" "}
              Back prices shown beside a market are the exchange&rsquo;s own, used to find a workable
              selection. They are marked indicative until you enter what your bookmaker is quoting
              for that exact selection — and that price applies only to that selection, never to
              another.
            </p>
          </div>
        </Panel>

        <Panel title="Before you start">
          <div className="space-y-3 p-5 text-[13px] leading-relaxed text-ink-muted">
            <p>
              Every calculation here assumes both bets are placed as described and both settle
              normally. Events are voided, markets are suspended, terms are applied differently than
              they read, and accounts are restricted at operators&rsquo; discretion. Read the
              operator&rsquo;s own terms before acting on anything on this site — the reading shown
              beside an offer is a reading, not the terms themselves.
            </p>
            <p>
              You must be 18 or over and it must be lawful for you to bet where you are. Gambling
              can be harmful. Free, confidential support is available from GamCare on 0808 8020 133
              and at begambleaware.org.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}

function TokenExample({
  title,
  subtitle,
  calculation,
}: {
  title: string;
  subtitle: string;
  calculation: ReturnType<typeof serializeHedge> | null;
}) {
  if (!calculation) return null;
  return (
    <div className="rounded-[6px] border border-line bg-surface p-4">
      <div className="text-[12px] font-medium text-ink">{title}</div>
      <div className="mt-0.5 text-[11px] text-ink-faint">{subtitle}</div>
      <dl className="mt-3 space-y-1.5 border-t border-line pt-3">
        <Row label="Lay stake" value={`£${calculation.layStake}`} />
        <Row label="Liability" value={`£${calculation.liability}`} />
        <Row label="Calculated return" value={`£${calculation.guaranteedNet}`} strong />
        <Row label="Of face value" value={`${calculation.rating}%`} strong />
      </dl>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-[12px] text-ink-faint">{label}</dt>
      <dd className={`figure text-[13px] ${strong ? "font-semibold text-ink" : "text-ink-muted"}`}>
        {value}
      </dd>
    </div>
  );
}
