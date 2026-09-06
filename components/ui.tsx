import type { ReactNode } from "react";

/**
 * The shared vocabulary of the interface.
 *
 * Two of these carry weight beyond styling and are used everywhere the thing
 * they describe appears: `IndicativeBadge` (this is an exchange price, not a
 * bookmaker price) and `DelayBadge` (this price is snapshot-delayed).
 */

export function Panel({
  title,
  subtitle,
  right,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[6px] border border-line bg-surface ${className}`}
    >
      {(title || right) && (
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
          <div>
            {title && <h2 className="text-[13px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[12px] text-ink-faint">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "positive" | "negative" | "caution";
}) {
  const toneClass =
    tone === "positive"
      ? "text-positive"
      : tone === "negative"
        ? "text-negative"
        : tone === "caution"
          ? "text-caution"
          : "text-ink";
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
        {label}
      </div>
      <div className={`figure mt-1.5 text-[26px] font-semibold leading-none ${toneClass}`}>
        {value}
      </div>
      {hint && <div className="mt-1.5 text-[12px] leading-snug text-ink-faint">{hint}</div>}
    </div>
  );
}

type BadgeTone = "neutral" | "accent" | "positive" | "negative" | "caution";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-sunken text-ink-muted border-line-strong",
  accent: "bg-accent-soft text-accent-ink border-accent/20",
  positive: "bg-positive-soft text-positive border-positive/20",
  negative: "bg-negative-soft text-negative border-negative/20",
  caution: "bg-caution-soft text-caution border-caution/25",
};

export function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[4px] border px-1.5 py-0.5 text-[11px] font-medium leading-[1.4] ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * Marks a price as an EXCHANGE price being used as a starting point, not a
 * bookmaker price. There is no bookmaker odds feed in this product, and
 * presenting an exchange price as a bookmaker's would be a fabricated
 * integration in all but name.
 */
export function IndicativeBadge() {
  return (
    <Badge
      tone="caution"
      title="This is the exchange's own back price, shown as a starting point. It is NOT your bookmaker's price. Enter the price your bookmaker is showing before treating any figure as real."
    >
      Indicative
    </Badge>
  );
}

/** Carried from the exchange's own delay flag — never inferred. */
export function DelayBadge({ delayed }: { delayed: boolean }) {
  if (!delayed) return null;
  return (
    <Badge
      tone="caution"
      title="The exchange reports this market's data as delayed. The true price may have moved."
    >
      Delayed
    </Badge>
  );
}

export function Money({
  value,
  signed = false,
  size = "base",
  className = "",
}: {
  value: string;
  signed?: boolean;
  size?: "sm" | "base" | "lg";
  className?: string;
}) {
  const negative = value.startsWith("-");
  const bare = negative ? value.slice(1) : value;
  const sizeClass = size === "lg" ? "text-[20px]" : size === "sm" ? "text-[12px]" : "text-[13px]";
  const tone = negative ? "text-negative" : signed ? "text-positive" : "text-ink";
  return (
    <span className={`figure ${sizeClass} ${tone} ${className}`}>
      {negative ? "−" : signed ? "+" : ""}£{bare}
    </span>
  );
}

export function Odds({ value }: { value: string }) {
  return <span className="figure text-[13px]">{value}</span>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-[13px] font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-[12px] leading-relaxed text-ink-faint">{body}</p>
    </div>
  );
}

export function Note({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "caution" | "accent";
}) {
  const toneClass =
    tone === "caution"
      ? "border-caution/30 bg-caution-soft text-caution"
      : tone === "accent"
        ? "border-accent/20 bg-accent-soft text-accent-ink"
        : "border-line bg-surface-sunken text-ink-muted";
  return (
    <div className={`rounded-[5px] border px-3.5 py-2.5 text-[12px] leading-relaxed ${toneClass}`}>
      {children}
    </div>
  );
}

export function ScoreBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
        />
      </div>
      <span className="figure w-10 shrink-0 text-right text-[12px] tabular-nums text-ink-muted">
        {value.toFixed(0)}
      </span>
    </div>
  );
}

export function PageHeader({
  title,
  lede,
  right,
}: {
  title: string;
  lede?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-6">
      <div>
        <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-ink">{title}</h1>
        {lede && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-muted">{lede}</p>}
      </div>
      {right}
    </div>
  );
}
