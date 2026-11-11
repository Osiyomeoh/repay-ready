// Proves the person checking a loan controls the address that owes it. Kite
// repays whatever address is entered, so a typo or a pasted lookalike would
// spend the user's USDC on a stranger's loan. viem's verifyMessage covers
// plain wallets (EOA), smart wallets (ERC-1271) and undeployed ones (ERC-6492).
import { getAddress, isAddress, type Address, type Hex } from "viem";
import type { BaseClient } from "./chain.js";

export const MAX_AGE_S = 15 * 60;

export function ownershipMessage(address: Address, issuedAt: Date): string {
  return [
    "Repay Ready: I control this address and want to check an auto-repay on its Aave loan.",
    `Address: ${getAddress(address)}`,
    "Chain: Base (8453)",
    `Issued: ${issuedAt.toISOString()}`,
  ].join("\n");
}

/**
 * `retry`: the message itself is stale or not the one we issued, so it proves
 * nothing either way; the person should sign a fresh one. Without `retry` the
 * signature is evidence the address is not theirs.
 */
export type OwnershipResult = { ok: true } | { ok: false; retry: boolean; reason: string };

export async function verifyOwnership(client: BaseClient, address: Address, message: string, signature: Hex, now = new Date()): Promise<OwnershipResult> {
  const lines = message.split("\n");
  const addr = lines.find((l) => l.startsWith("Address: "))?.slice(9) ?? "";
  const issued = Date.parse(lines.find((l) => l.startsWith("Issued: "))?.slice(8) ?? "");
  if (!isAddress(addr) || getAddress(addr) !== getAddress(address)) return { ok: false, retry: false, reason: "The signed message names a different address" };
  if (!Number.isFinite(issued)) return { ok: false, retry: true, reason: "The signed message has no issue time" };
  const age = (now.getTime() - issued) / 1000;
  if (age > MAX_AGE_S) return { ok: false, retry: true, reason: "The signed message is more than 15 minutes old" };
  if (age < -60) return { ok: false, retry: true, reason: "The signed message is dated in the future" };
  if (message !== ownershipMessage(address, new Date(issued))) return { ok: false, retry: true, reason: "The signed message text was changed" };
  const valid = await client.verifyMessage({ address, message, signature }).catch(() => false);
  return valid ? { ok: true } : { ok: false, retry: false, reason: "The signature does not match this address" };
}
