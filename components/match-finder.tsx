"use client";

import { useState } from "react";
import { Badge, Panel } from "./ui";
import { MatchEngine, type OfferOption } from "./match-engine";

/**
 * The two-panel Match Finder: the offer feed on the left, the engine on the
 * right. Choosing an offer on the left resets everything on the right, because
 * nothing calculated for one offer means anything for another.
 */
export function MatchFinder({
  offers,
  initialOfferKey,
}: {
  offers: OfferOption[];
  initialOfferKey: string | null;
}) {
  const keyOf = (offer: OfferOption) => `${offer.promotionId}:${offer.stage}`;

  const [selectedKey, setSelectedKey] = useState<string | null>(
    initialOfferKey ?? (offers[0] ? keyOf(offers[0]) : null),
  );

  const selected = offers.find((offer) => keyOf(offer) === selectedKey) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Panel title="Offers" subtitle="Verified and published" className="self-start">
        {offers.length === 0 ? (
          <div className="px-5 py-8 text-center text-[12px] leading-relaxed text-ink-faint">
            Nothing is published yet. An administrator verifies how each offer&rsquo;s terms were
            read before it appears here.
          </div>
        ) : (
          <ul className="max-h-[720px] overflow-y-auto">
            {offers.map((offer) => {
              const key = keyOf(offer);
              const isSelected = key === selectedKey;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => setSelectedKey(key)}
                    data-testid="offer-option"
                    data-offer-key={key}
                    className={`block w-full border-b border-line px-4 py-3 text-left transition-colors last:border-b-0 ${
                      isSelected ? "bg-accent-soft" : "hover:bg-surface-sunken"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-medium text-ink">
                          {offer.operatorName}
                        </div>
                        <div className="mt-0.5 text-[12px] leading-snug text-ink-muted">
                          {offer.title}
                        </div>
                      </div>
                      <Badge tone={offer.stage === "QUALIFYING" ? "neutral" : "accent"}>
                        {offer.stage === "QUALIFYING" ? "Qualify" : "Convert"}
                      </Badge>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-faint">
                      <span className="figure">£{offer.stake}</span>
                      {offer.minOdds && <span className="figure">min {offer.minOdds}</span>}
                      <span>{Math.round(offer.termsConfidence * 100)}% read</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <MatchEngine offer={selected} />
    </div>
  );
}
