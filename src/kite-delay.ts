// Kite's fire delay: seconds from the health factor crossing the trigger to the
// repay landing on-chain. Kite does not document it, so it comes only from a
// measured kill test (CLAIMS.md). While it is null, the room check is
// "unknown" for any trigger the record would liquidate, and the verdict is
// REFUSE: we do not claim Kite acts in time without evidence.
import type { FireDelay } from "./checks.js";

export const KITE_FIRE_DELAY: FireDelay | null = null;
