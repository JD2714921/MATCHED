import { D, type Decimal } from "./decimal";
import type { HedgeResult, RepriceResult } from "./types";
import { calculateHedge } from "./hedge";
import { type EngineResult } from "./errors";

/**
 * Exchange prices move between the moment a calculation is shown and the moment
 * a customer places the lay. Recalculating is trivial; the judgement is whether
 * the move matters enough to interrupt them.
 */
export interface RepriceThresholds {
  /** Absolute change in the lay stake that counts as material. */
  stake: Decimal;
  /** Absolute change in the guaranteed net that counts as material. */
  net: Decimal;
}

export const DEFAULT_REPRICE_THRESHOLDS: RepriceThresholds = {
  stake: new D("0.10"),
  net: new D("0.10"),
};

export function reprice(
  previous: HedgeResult,
  newLayOdds: Decimal,
  thresholds: RepriceThresholds = DEFAULT_REPRICE_THRESHOLDS,
): EngineResult<RepriceResult> {
  const recalculated = calculateHedge({ ...previous.input, layOdds: newLayOdds });
  if (!recalculated.ok) return recalculated;

  const current = recalculated.value;
  const layStakeDelta = current.layStake.minus(previous.layStake);
  const guaranteedNetDelta = current.guaranteedNet.minus(previous.guaranteedNet);
  const liabilityDelta = current.liability.minus(previous.liability);

  const stakeMoved = layStakeDelta.abs().greaterThanOrEqualTo(thresholds.stake);
  const netMoved = guaranteedNetDelta.abs().greaterThanOrEqualTo(thresholds.net);
  const materialChange = stakeMoved || netMoved;

  let reason: string;
  if (!materialChange) {
    reason = "The price moved, but not enough to change what you should place.";
  } else if (guaranteedNetDelta.isNegative()) {
    reason = `The lay price moved against you. The calculated return is ${guaranteedNetDelta.abs().toFixed(2)} lower and the stake has changed by ${layStakeDelta.toFixed(2)}.`;
  } else if (guaranteedNetDelta.isPositive()) {
    reason = `The lay price moved in your favour. The calculated return is ${guaranteedNetDelta.toFixed(2)} higher.`;
  } else {
    reason = `The lay stake has changed by ${layStakeDelta.toFixed(2)}.`;
  }

  return {
    ok: true,
    warnings: recalculated.warnings,
    value: {
      previous,
      current,
      layStakeDelta,
      guaranteedNetDelta,
      liabilityDelta,
      materialChange,
      reason,
    },
  };
}
