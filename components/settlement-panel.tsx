import type { SerializedHedge, SerializedOutcome } from "@/lib/serialize";
import { Money } from "./ui";

/**
 * The settlement matrix.
 *
 * This is the proof of the number, not a restatement of it. Every line is
 * already rounded to pence and the column adds up by hand to the net beneath
 * it — a customer who does not believe the figure can check it with a pencil.
 */
export function SettlementPanel({ calculation }: { calculation: SerializedHedge }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <OutcomeColumn outcome={calculation.backWins} />
      <OutcomeColumn outcome={calculation.backLoses} />
    </div>
  );
}

function OutcomeColumn({ outcome }: { outcome: SerializedOutcome }) {
  const negative = outcome.net.startsWith("-");
  return (
    <div className="rounded-[6px] border border-line bg-surface">
      <div className="border-b border-line px-4 py-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
          If this happens
        </div>
        <div className="mt-0.5 text-[12px] font-medium leading-snug text-ink">{outcome.label}</div>
      </div>

      <table className="data-table">
        <tbody>
          {outcome.lines.map((line, index) => (
            <tr key={`${line.label}-${index}`}>
              <td className="pl-4">
                <div className="text-[12px] text-ink">{line.label}</div>
                {line.note && (
                  <div className="mt-0.5 text-[11px] leading-snug text-ink-faint">{line.note}</div>
                )}
              </td>
              <td className="num w-[92px] pr-4 align-top">
                <Money value={line.amount} size="sm" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-baseline justify-between border-t-2 border-line-strong px-4 py-2.5">
        <span className="text-[12px] font-medium text-ink">
          {negative ? "Net cost" : "Net return"}
        </span>
        <Money value={outcome.net} size="lg" signed={!negative} />
      </div>
    </div>
  );
}
