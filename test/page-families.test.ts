// The page colours liquidations by price family from a symbol table of its own
// (public/families.js); it must say exactly what src/chain.ts RESERVES says.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FAMILY } from "../public/families.js";
import { RESERVES } from "../src/chain.js";

test("the page's symbol → family table equals RESERVES", () => {
  const fromChain = Object.fromEntries(Object.values(RESERVES).map((r) => [r.symbol, r.family]));
  assert.deepEqual(FAMILY, fromChain);
});
