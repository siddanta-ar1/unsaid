# Measured results

Run 9 October 2026. Every number here came out of a script in this repository,
and the scripts are listed so each one can be re-run and disagreed with.

| Harness | Covers |
|---|---|
| `scripts/bench-client.mjs` | Key derivation, envelope cost, storage overhead, account budget |
| `scripts/bench-chain.mjs` | Receipt cost and confirmation time on devnet |
| `backend/api/scripts/canary-sweep.ts` | The privacy invariant, and end-to-end save latency |

Hardware matters for the client figures and it is deliberately unflattering:
an **Intel Core i5-5250U at 1.60 GHz** — a two-core laptop part from 2015. A
modern phone is faster than this. Numbers measured on a fast workstation would
have made the unlock wall look better than any user will experience.

## 1. The unlock wall

PBKDF2-SHA256 at 600,000 iterations, the OWASP floor. n=20.

| Operation | Median | p95 |
|---|---|---|
| Key derivation | 382 ms | 439 ms |
| Full unlock (derive + unwrap the vault key) | 396 ms | 440 ms |
| Vault creation (two derivations: passphrase + recovery kit) | 777 ms | 784 ms |

Unwrapping costs 14 ms on top of derivation. The wall is the KDF, as designed —
it is the thing that makes a stolen database useless.

## 2. Envelope cost

AES-GCM-256 per memory, content key wrapped with AES-KW. Median of 20 runs
below 1 MB, 5 at and above it.

| Payload | Seal | Open | Seal MB/s | Open MB/s |
|---|---|---|---|---|
| 1 KB | 0.5 ms | 0.3 ms | 2 | 4 |
| 10 KB | 0.5 ms | 0.3 ms | 19 | 38 |
| 100 KB | 0.9 ms | 0.4 ms | 104 | 227 |
| 1 MB | 6.3 ms | 2.9 ms | 160 | 339 |
| 10 MB | 83.4 ms | 37.9 ms | 120 | 264 |

Encryption is not the cost of this design. A 10 MB voice memo seals in 83 ms on
a 2015 laptop; a typed thought is half a millisecond.

## 3. Storage overhead

**+218 bytes per memory, constant** — the 96-bit IV, the 128-bit GCM tag, the
wrapped 256-bit content key, and the JSON naming the algorithms. It does not
scale with content.

On a 1 KB thought that is 21.3%. On a 10 MB recording it is 0.0021%.

## 4. End-to-end save latency

Client seals → ciphertext PUT straight to object storage → metadata registered
with the API. n=30, local infrastructure, so this is the floor rather than a
field measurement.

| | Median | p95 |
|---|---|---|
| Full save | 171 ms | 203 ms |
| of which sealing | 1.6 ms | — |

Sealing is **under 1%** of a save. The remaining 169 ms is network and
database, which is to say: the privacy property is not what makes this slow.

## 5. Consent receipts on chain

Devnet, program `7nRKgRMiHfXg3fUXPRFdNX97BWfSKhNqvBaXZM5BLcHZ`,
N=100 written one at a time and each confirmed before the next.

| | Value |
|---|---|
| Confirmed | **98 / 100** |
| Median confirmation | 1,132 ms |
| p95 | 2,823 ms |
| Range | 685 – 4,623 ms |
| Cost per receipt | **0.0017322 SOL** (rent + fee) |
| Account size | 212 bytes, read back from the cluster |
| Receipts read back and field-matched | 10 |

The two failures were both `WebSocket failed to connect` — the free public
endpoint's confirmation subscription dropping, not the program rejecting
anything. A paid RPC removes this class of failure; it is reported rather than
retried away because it is what the free endpoint actually does.

### What it costs to run

Cost is dominated by **rent**, not fees: 0.00172 SOL of the 0.0017322 is the
rent-exempt minimum for a 212-byte account, and the design has no close
instruction, so receipts are permanent by construction and the rent is never
reclaimed.

| Reflection rate | SOL / user / month | At $73.85/SOL |
|---|---|---|
| 5 / month | 0.00866 | $0.64 |
| 20 / month | 0.03465 | $2.56 |
| 60 / month | 0.10395 | $7.68 |

The SOL price is the most recent dated quote found (22 June 2026) and is not a
live figure; treat the dollar column as an order of magnitude.

**This is the one measurement that threatens the business model.** At 20
reflections a month, a receipt per access consumes roughly a third of an
$8 subscription. Named paths out, cheapest first:

1. **Batch into a periodic root.** One account per user per period holding a
   Merkle root over that period's accesses; each access keeps an inclusion
   proof. ~20× cheaper at 20 reflections/month, and a receipt remains
   individually provable.
2. **State compression.** Concurrent Merkle trees put the cost per leaf into
   the fractions of a cent, at the price of depending on an indexer to serve
   proofs.
3. **Receipt on export only.** Record the accesses a user asks to prove rather
   than all of them. Cheapest, and weakest.

Option 1 is the honest answer and is not yet built. Per-receipt accounts were
the right thing to ship first because they are the simplest thing that is
verifiable by a stranger with no infrastructure.

## 6. Account budget against the transaction limit

Field by field, from `programs/unsaid/src/lib.rs`. These are computed from the
layout and they match what the cluster returned, which is the check that the
encoder and the program agree.

| Bytes | Field |
|---|---|
| 8 | Anchor discriminator |
| 32 | `recorder` |
| 32 | `receipt_id` |
| 32 | `subject` — digest of the vault, never a wallet |
| 32 | `thought_id` — domain-separated digest |
| 32 | `attestation` — enclave measurement |
| 32 | `result_hash` |
| 2 | `consent_version` |
| 1 | `purpose` |
| 8 | `created_at` |
| 1 | `bump` |
| **212** | **Consent receipt — 17.2% of the 1,232-byte limit** |
| **124** | **Thought record — 10.1%** |

Nothing in either account is content, so neither grows with what the user
wrote. The budget is fixed, not a function of usage.

## 7. The privacy invariant, as a protocol

`backend/api/scripts/canary-sweep.ts` writes N uniquely marked memories through
the real client path, then looks for those markers in every place they could
have leaked. Last run, N=30:

| Sweep | Searched | Markers found |
|---|---|---|
| The whole database | 244 KB of `pg_dump` — every table | **0** |
| Object storage | 806 objects, 46 KB of bytes | **0** |
| API logs for the run | 34 KB of captured output | **0** |

Two details make this a protocol rather than an assertion:

- **The control.** The run decrypts memory 1 back and asserts the marker is
  there. A sweep that finds nothing because nothing was saved would otherwise
  pass while proving the opposite of the claim.
- **The dump is whole.** `pg_dump` of the entire database, not a hand-listed
  set of tables, so a column added next month is covered without anyone
  remembering to add it here. The run id is searched for too, so even a
  truncated marker would show up.

The first version of the storage sweep piped output through `sed` inside the
`minio/mc` container, which has no `sed`. It read zero bytes and reported
clean. The object count is now asserted against N for that reason.

## 8. Not measured

| Missing | Why |
|---|---|
| Attested-inference round trip, and the delta against an unattested baseline | The Phala account balance is zero. Code and the gated live test are written and run on credit |
| Attestation verification time on the client | Same blocker |
| Mobile key derivation | No device harness. The desktop figure above is from 2015 hardware, which is the conservative stand-in, not a substitute |
| Anything from real users | The pilot has not run |
