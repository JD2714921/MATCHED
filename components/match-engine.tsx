"use client";

import { useCallback, useEffect, useState } from "react";
import type { SerializedHedge, SerializedLiquidity, SerializedMatch } from "@/lib/serialize";
import { Badge, DelayBadge, IndicativeBadge, Money, Note, Panel } from "./ui";
import { SettlementPanel } from "./settlement-panel";

export interface MarketRow {
  eventId: string;
  eventName: string;
  competition: string | null;
  eventStartsAt: string;
  marketId: string;
  marketName: string;
  selectionId: string;
  selectionName: string;
  indicativeBackPrice: string;
  bestLayPrice: string;
  isMarketDataDelayed: boolean;
  tradedVolumeAvailable: boolean;
  totalMatched: string | null;
  liquidity: SerializedLiquidity;
  layLadder: Array<{ price: string; size: string }>;
  calculation: SerializedHedge;
}

export interface OfferOption {
  promotionId: string;
  operatorName: string;
  title: string;
  betType: "QUALIFYING" | "FREE_BET_SNR" | "FREE_BET_SR";
  freeBetType: string;
  stake: string;
  minOdds: string | null;
  stage: "QUALIFYING" | "CONVERSION";
  termsConfidence: number;
}

interface CalculationResponse {
  ok: boolean;
  calculation?: SerializedHedge;
  warnings?: Array<{ code: string; message: string }>;
  liquidity?: SerializedLiquidity | null;
  partialMatch?: SerializedMatch | null;
  priceBasis?: string;
  priceBasisNote?: string;
  errors?: Array<{ code: string; field: string; message: string }>;
}

const ROUNDING_OPTIONS = [
  ["NEAREST_PENNY", "Nearest penny"],
  ["NEAREST_10P", "Nearest 10p"],
  ["NEAREST_50P", "Nearest 50p"],
  ["DOWN_PENNY", "Round down (under-lay)"],
  ["UP_PENNY", "Round up (over-lay)"],
] as const;

/**
 * The match engine.
 *
 * The flow it enforces is the honest one: find a market on exchange data,
 * see the exchange's INDICATIVE back price, then enter what YOUR bookmaker is
 * actually showing for THAT selection before anything is treated as real. The
 * entered price is cleared whenever the selection changes, because a
 * bookmaker's price for one selection says nothing about another.
 */
export function MatchEngine({
  offer,
  onPlanCreated,
}: {
  offer: OfferOption | null;
  onPlanCreated?: (planId: string) => void;
}) {
  const [rows, setRows] = useState<MarketRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [providerNote, setProviderNote] = useState<string | null>(null);
  const [providerLive, setProviderLive] = useState<boolean>(false);

  const [selected, setSelected] = useState<MarketRow | null>(null);
  const [bookmakerPrice, setBookmakerPrice] = useState("");
  const [appliedTo, setAppliedTo] = useState<string | null>(null);
  const [commission, setCommission] = useState("0.05");
  const [rounding, setRounding] = useState<string>("NEAREST_PENNY");
  const [result, setResult] = useState<CalculationResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedPlanId, setSavedPlanId] = useState<string | null>(null);

  // Changing offer resets everything downstream of it.
  useEffect(() => {
    setRows([]);
    setSearched(false);
    setSelected(null);
    setBookmakerPrice("");
    setAppliedTo(null);
    setResult(null);
    setSavedPlanId(null);
  }, [offer?.promotionId, offer?.stage]);

  const search = useCallback(async () => {
    if (!offer) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        betType: offer.betType,
        stake: offer.stake,
        commission,
      });
      if (offer.minOdds) params.set("minOdds", offer.minOdds);
      const response = await fetch(`/api/markets?${params.toString()}`);
      const data = (await response.json()) as {
        rows: MarketRow[];
        live: boolean;
        providerMessage: string;
      };
      setRows(data.rows ?? []);
      setProviderLive(data.live);
      setProviderNote(data.providerMessage);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }, [offer, commission]);

  const calculate = useCallback(
    async (row: MarketRow, backOdds: string, fromBookmaker: boolean) => {
      if (!offer) return;
      const response = await fetch("/api/calculate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          betType: offer.betType,
          backStake: offer.stake,
          backOdds,
          layOdds: row.bestLayPrice,
          commission,
          rounding,
          backOddsFromBookmaker: fromBookmaker,
          ladder: row.layLadder,
        }),
      });
      setResult((await response.json()) as CalculationResponse);
    },
    [offer, commission, rounding],
  );

  const selectRow = useCallback(
    async (row: MarketRow) => {
      setSelected(row);
      // A price entered for a different selection tells us nothing about this
      // one, so it is discarded rather than carried across.
      setBookmakerPrice("");
      setAppliedTo(null);
      setSavedPlanId(null);
      await calculate(row, row.indicativeBackPrice, false);
    },
    [calculate],
  );

  const applyBookmakerPrice = useCallback(async () => {
    if (!selected || !bookmakerPrice.trim()) return;
    setAppliedTo(selected.selectionId);
    await calculate(selected, bookmakerPrice.trim(), true);
  }, [selected, bookmakerPrice, calculate]);

  // Re-run whenever a calculation input the customer controls changes.
  useEffect(() => {
    if (!selected) return;
    const usingBookmaker = appliedTo === selected.selectionId && bookmakerPrice.trim() !== "";
    void calculate(
      selected,
      usingBookmaker ? bookmakerPrice.trim() : selected.indicativeBackPrice,
      usingBookmaker,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commission, rounding]);

  const savePlan = useCallback(async () => {
    if (!offer || !selected || !result?.calculation) return;
    setSaving(true);
    try {
      const response = await fetch("/api/bet-plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          promotionId: offer.promotionId,
          stage: offer.stage,
          eventName: selected.eventName,
          marketName: selected.marketName,
          selectionName: selected.selectionName,
          eventStartsAt: selected.eventStartsAt,
          betType: offer.betType,
          backStake: result.calculation.backStake,
          backOdds: result.calculation.backOdds,
          layStake: result.calculation.layStake,
          layOdds: result.calculation.layOdds,
          commission: result.calculation.commission,
          liability: result.calculation.liability,
          plannedNet: result.calculation.guaranteedNet,
          plannedRating: result.calculation.rating,
        }),
      });
      const data = (await response.json()) as { id?: string; error?: string };
      if (data.id) {
        setSavedPlanId(data.id);
        onPlanCreated?.(data.id);
      }
    } finally {
      setSaving(false);
    }
  }, [offer, selected, result, onPlanCreated]);

  if (!offer) {
    return (
      <Panel title="Match engine">
        <div className="px-5 py-10 text-center">
          <p className="text-[13px] font-medium text-ink">Choose an offer to begin</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[12px] leading-relaxed text-ink-faint">
            Pick one from the list and the engine will look for exchange markets that meet its
            terms.
          </p>
        </div>
      </Panel>
    );
  }

  const usingBookmakerPrice = appliedTo === selected?.selectionId;

  return (
    <div className="space-y-4">
      <Panel
        title="Find a market"
        subtitle={`${offer.title} — ${offer.stage === "QUALIFYING" ? "qualifying bet" : "token conversion"} of £${offer.stake}`}
        right={
          <button
            type="button"
            onClick={search}
            disabled={loading}
            data-testid="search-markets"
            className="shrink-0 rounded-[4px] bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-ink disabled:opacity-50"
          >
            {loading ? "Searching…" : "Search exchange markets"}
          </button>
        }
      >
        {!searched ? (
          <div className="px-5 py-8 text-center text-[12px] text-ink-faint">
            {offer.minOdds
              ? `Will look for selections at ${offer.minOdds} or longer, as the terms require.`
              : "Will look across the sports available on the exchange."}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-8 text-center text-[12px] text-ink-faint">
            No market currently meets this offer&rsquo;s terms.
          </div>
        ) : (
          <>
            <div className="border-b border-line px-5 py-2.5">
              <Note tone={providerLive ? "neutral" : "caution"}>
                <span className="font-medium">
                  {providerLive ? "Live exchange data." : "Sample data, not a live exchange."}
                </span>{" "}
                {providerNote}
              </Note>
            </div>
            <div className="max-h-[340px] overflow-y-auto">
              <table className="data-table" data-testid="market-results">
                <thead className="sticky top-0 bg-surface">
                  <tr>
                    <th className="pl-5">Selection</th>
                    <th className="num">
                      Back
                      <div className="font-normal normal-case tracking-normal text-caution">
                        indicative
                      </div>
                    </th>
                    <th className="num">Lay</th>
                    <th>Liquidity</th>
                    <th className="num pr-5">Calculated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isSelected = selected?.selectionId === row.selectionId;
                    return (
                      <tr
                        key={`${row.marketId}-${row.selectionId}`}
                        onClick={() => void selectRow(row)}
                        data-testid="market-row"
                        className={`cursor-pointer transition-colors ${
                          isSelected ? "bg-accent-soft" : "hover:bg-surface-sunken"
                        }`}
                      >
                        <td className="pl-5">
                          <div className="text-[13px] text-ink">{row.selectionName}</div>
                          <div className="mt-0.5 text-[11px] text-ink-faint">
                            {row.eventName} · {row.marketName}
                          </div>
                        </td>
                        <td className="num">
                          <span className="figure text-[13px] text-ink-muted">
                            {row.indicativeBackPrice}
                          </span>
                        </td>
                        <td className="num">
                          <span className="figure text-[13px] text-ink">{row.bestLayPrice}</span>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <Badge tone={liquidityTone(row.liquidity.level)}>
                              {row.liquidity.level.toLowerCase()}
                            </Badge>
                            <span className="figure text-[11px] text-ink-faint">
                              £{row.liquidity.depthAtOrBetter}
                            </span>
                          </div>
                        </td>
                        <td className="num pr-5">
                          <Money value={row.calculation.guaranteedNet} signed />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      {selected && (
        <Panel
          title="Your bookmaker's price"
          subtitle={`For ${selected.selectionName} — and only for this selection`}
        >
          <div className="space-y-3 p-5">
            <Note tone={usingBookmakerPrice ? "accent" : "caution"}>
              {usingBookmakerPrice ? (
                <>
                  Calculated from the price <span className="font-medium">you entered</span> for
                  this selection.
                </>
              ) : (
                <>
                  <span className="font-medium">
                    The back price below is the exchange&rsquo;s, not your bookmaker&rsquo;s.
                  </span>{" "}
                  There is no bookmaker odds feed here. Open your bookmaker, find{" "}
                  <span className="font-medium">{selected.selectionName}</span>, and enter the
                  price it is showing before treating any figure as real.
                </>
              )}
            </Note>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label
                  htmlFor="bookmaker-price"
                  className="block text-[11px] font-medium text-ink"
                >
                  Bookmaker back price
                </label>
                <input
                  id="bookmaker-price"
                  data-testid="bookmaker-price"
                  inputMode="decimal"
                  value={bookmakerPrice}
                  onChange={(event) => setBookmakerPrice(event.target.value)}
                  placeholder={selected.indicativeBackPrice}
                  className="figure mt-1 w-28 rounded-[4px] border border-line-strong px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                />
              </div>

              <button
                type="button"
                onClick={() => void applyBookmakerPrice()}
                data-testid="apply-bookmaker-price"
                className="rounded-[4px] bg-accent px-3 py-[7px] text-[12px] font-medium text-white hover:bg-accent-ink"
              >
                Use this price
              </button>

              <div>
                <label htmlFor="commission" className="block text-[11px] font-medium text-ink">
                  Your commission
                </label>
                <input
                  id="commission"
                  data-testid="commission"
                  inputMode="decimal"
                  value={commission}
                  onChange={(event) => setCommission(event.target.value)}
                  className="figure mt-1 w-24 rounded-[4px] border border-line-strong px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
                />
              </div>

              <div>
                <label htmlFor="rounding" className="block text-[11px] font-medium text-ink">
                  Round the lay to
                </label>
                <select
                  id="rounding"
                  data-testid="rounding"
                  value={rounding}
                  onChange={(event) => setRounding(event.target.value)}
                  className="mt-1 rounded-[4px] border border-line-strong bg-surface px-2.5 py-[7px] text-[12px] outline-none focus:border-accent"
                >
                  {ROUNDING_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {result?.errors && (
        <Panel title="That will not calculate">
          <ul className="space-y-1.5 p-5">
            {result.errors.map((error) => (
              <li key={error.code} className="text-[12px] text-negative">
                {error.message}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {result?.ok && result.calculation && selected && (
        <>
          <Panel
            title="What to place"
            right={
              <div className="flex items-center gap-1.5">
                {!usingBookmakerPrice && <IndicativeBadge />}
                <DelayBadge delayed={selected.isMarketDataDelayed} />
              </div>
            }
          >
            <div className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <Instruction
                label="Back at the bookmaker"
                primary={`£${result.calculation.backStake}`}
                secondary={`at ${result.calculation.backOdds}`}
                note={
                  usingBookmakerPrice
                    ? "The price you entered."
                    : "Exchange price — indicative only."
                }
              />
              <Instruction
                label="Lay on the exchange"
                primary={`£${result.calculation.layStake}`}
                secondary={`at ${result.calculation.layOdds}`}
                note={`Ideal was £${result.calculation.idealLayStake} before rounding.`}
                testId="lay-stake"
              />
              <Instruction
                label="Liability"
                primary={`£${result.calculation.liability}`}
                secondary="held by the exchange"
                note={
                  result.liquidity
                    ? result.liquidity.reason
                    : "Liquidity was not assessed for this price."
                }
              />
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
                  Calculated return
                </div>
                <div className="mt-1" data-testid="guaranteed-net">
                  <Money value={result.calculation.guaranteedNet} size="lg" signed />
                </div>
                <div className="mt-1.5 text-[11px] leading-snug text-ink-faint">
                  {result.calculation.rating}% of face value. Best case £
                  {result.calculation.bestCaseNet}, spread £{result.calculation.outcomeSpread}.
                </div>
              </div>
            </div>

            {result.warnings && result.warnings.length > 0 && (
              <div className="space-y-2 border-t border-line px-5 py-4">
                {result.warnings.map((warning) => (
                  <Note key={warning.code} tone="caution">
                    {warning.message}
                  </Note>
                ))}
              </div>
            )}

            {result.partialMatch && !result.partialMatch.fullyMatched && (
              <div className="border-t border-line px-5 py-4">
                <Note tone="caution">
                  Only £{result.partialMatch.matched} of your £{result.calculation.layStake} lay
                  would match at {result.calculation.layOdds} or better. £
                  {result.partialMatch.unmatched} would sit unmatched, leaving that part of your
                  back bet unhedged.
                </Note>
              </div>
            )}
          </Panel>

          <Panel
            title="Every outcome"
            subtitle="Each column adds up to the figure beneath it — check it by hand if you like"
          >
            <div className="p-5" data-testid="settlement">
              <SettlementPanel calculation={result.calculation} />
            </div>
          </Panel>

          <Panel title="Track this position">
            <div className="flex flex-wrap items-center justify-between gap-4 p-5">
              <p className="max-w-lg text-[12px] leading-relaxed text-ink-muted">
                Recording this stores what was calculated. When you have placed both bets you edit
                the figures to what you actually got, and the profit record is computed from those.
              </p>
              {savedPlanId ? (
                <a
                  href={`/bets/${savedPlanId}`}
                  data-testid="view-plan"
                  className="shrink-0 rounded-[4px] border border-accent px-3 py-1.5 text-[12px] font-medium text-accent"
                >
                  Open the record
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => void savePlan()}
                  disabled={saving}
                  data-testid="track-position"
                  className="shrink-0 rounded-[4px] bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-ink disabled:opacity-50"
                >
                  {saving ? "Recording…" : "Record this position"}
                </button>
              )}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function Instruction({
  label,
  primary,
  secondary,
  note,
  testId,
}: {
  label: string;
  primary: string;
  secondary: string;
  note: string;
  testId?: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
        {label}
      </div>
      <div className="figure mt-1 text-[20px] font-semibold leading-none text-ink" data-testid={testId}>
        {primary}
      </div>
      <div className="figure mt-1 text-[12px] text-ink-muted">{secondary}</div>
      <div className="mt-1.5 text-[11px] leading-snug text-ink-faint">{note}</div>
    </div>
  );
}

function liquidityTone(level: string): "positive" | "neutral" | "caution" | "negative" {
  switch (level) {
    case "AMPLE":
      return "positive";
    case "SUFFICIENT":
      return "neutral";
    case "THIN":
      return "caution";
    default:
      return "negative";
  }
}
