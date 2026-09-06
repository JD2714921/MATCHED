import type { PromotionReading, ReadingField } from "@/lib/ai/types";
import { FIELD_WEIGHTS } from "@/lib/ai/types";
import { Badge } from "./ui";

const FIELD_LABELS: Record<ReadingField, string> = {
  kind: "Kind of promotion",
  qualifyingStake: "Qualifying stake",
  minQualifyingOdds: "Minimum qualifying odds",
  maxQualifyingOdds: "Maximum qualifying odds",
  rewardTotalValue: "Total reward",
  rewardTokenCount: "Number of tokens",
  rewardTokenValue: "Value per token",
  freeBetType: "Free-bet type",
  freeBetExpiryDays: "Expires after (days)",
  minRewardOdds: "Minimum odds on the token",
  maxRewardOdds: "Maximum odds on the token",
  eligibleSports: "Eligible sports",
  wageringRequirement: "Wagering requirement",
};

const FIELD_ORDER: ReadingField[] = [
  "freeBetType",
  "qualifyingStake",
  "rewardTotalValue",
  "rewardTokenCount",
  "rewardTokenValue",
  "minQualifyingOdds",
  "maxQualifyingOdds",
  "minRewardOdds",
  "maxRewardOdds",
  "freeBetExpiryDays",
  "eligibleSports",
  "wageringRequirement",
  "kind",
];

/**
 * The operator's own words beside the reading of them.
 *
 * A reviewer's job is to check one against the other, so they are put side by
 * side and every value carries the exact phrase it was read from. Fields the
 * terms were silent on are shown as prominently as the ones that were read —
 * a gap is the thing most worth noticing.
 */
export function ReadingDiff({
  rawTitle,
  rawText,
  reading,
}: {
  rawTitle: string | null;
  rawText: string;
  reading: PromotionReading;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
          As published, verbatim
        </div>
        <div className="rounded-[5px] border border-line bg-surface-sunken p-4">
          {rawTitle && <div className="mb-2 text-[13px] font-medium text-ink">{rawTitle}</div>}
          <pre className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-ink-muted">
            {rawText}
          </pre>
        </div>
      </div>

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
          How it was read
        </div>
        <div className="overflow-hidden rounded-[5px] border border-line">
          <table className="data-table">
            <tbody>
              {FIELD_ORDER.map((field) => {
                const entry = reading[field];
                const unread = entry.value === null;
                return (
                  <tr key={field} className={unread ? "bg-caution-soft/40" : undefined}>
                    <td className="w-[45%] pl-4 align-top">
                      <div className="text-[12px] text-ink">{FIELD_LABELS[field]}</div>
                      {FIELD_WEIGHTS[field] >= 0.1 && (
                        <div className="mt-0.5 text-[10px] text-ink-faint">
                          weight {FIELD_WEIGHTS[field].toFixed(2)}
                        </div>
                      )}
                    </td>
                    <td className="pr-4 align-top">
                      {unread ? (
                        <>
                          <Badge tone="caution">not stated</Badge>
                          {entry.note && (
                            <div className="mt-1 text-[11px] leading-snug text-ink-faint">
                              {entry.note}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="figure text-[12px] font-medium text-ink">
                            {formatValue(entry.value)}
                          </div>
                          {entry.sourcePhrase && (
                            <div className="mt-0.5 text-[11px] leading-snug text-ink-faint">
                              read from &ldquo;
                              <span className="text-ink-muted">{entry.sourcePhrase}</span>&rdquo;
                            </div>
                          )}
                          <div className="mt-0.5 text-[10px] text-ink-faint">
                            {Math.round(entry.confidence * 100)}% confident
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === "SNR") return "SNR — stake not returned";
  if (value === "SR") return "SR — stake returned";
  return String(value);
}
