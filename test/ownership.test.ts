import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseClient } from "../src/chain.js";
import { ownershipMessage, verifyOwnership } from "../src/ownership.js";

describe("ownership signature (live RPC for verifyMessage)", () => {
  const me = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  const now = new Date();
  const msg = ownershipMessage(me.address, now);
  const client = baseClient();

  it("accepts the owner's signature", async () => {
    assert.deepEqual(await verifyOwnership(client, me.address, msg, await me.signMessage({ message: msg }), now), { ok: true });
  });
  it("rejects someone else's signature", async () => {
    const r = await verifyOwnership(client, me.address, msg, await other.signMessage({ message: msg }), now);
    assert.deepEqual(r, { ok: false, retry: false, reason: "The signature does not match this address" });
  });
  it("rejects a message signed for another address", async () => {
    const m2 = ownershipMessage(other.address, now);
    const r = await verifyOwnership(client, me.address, m2, await me.signMessage({ message: m2 }), now);
    assert.deepEqual(r, { ok: false, retry: false, reason: "The signed message names a different address" });
  });
  it("rejects an old message", async () => {
    const old = new Date(now.getTime() - 16 * 60_000);
    const m3 = ownershipMessage(me.address, old);
    const r = await verifyOwnership(client, me.address, m3, await me.signMessage({ message: m3 }), now);
    assert.deepEqual(r, { ok: false, retry: true, reason: "The signed message is more than 15 minutes old" });
  });
  it("asks for a fresh signature when the message is dated in the future", async () => {
    const ahead = new Date(now.getTime() + 5 * 60_000);
    const m4 = ownershipMessage(me.address, ahead);
    const r = await verifyOwnership(client, me.address, m4, await me.signMessage({ message: m4 }), now);
    assert.deepEqual(r, { ok: false, retry: true, reason: "The signed message is dated in the future" });
  });
  it("rejects edited text", async () => {
    const edited = msg.replace("Repay Ready", "Repay Ready!");
    const r = await verifyOwnership(client, me.address, edited, await me.signMessage({ message: edited }), now);
    assert.deepEqual(r, { ok: false, retry: true, reason: "The signed message text was changed" });
  });
});
