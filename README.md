<div align="center">

<img src="apps/web/public/icon-512.png" alt="UNSAID" width="88" />

# UNSAID

**A private journal with an AI that can't read your secrets —<br/>and a public receipt on Solana every time anything touches them.**

[![CI](https://github.com/siddanta-ar1/unsaid/actions/workflows/ci.yml/badge.svg)](https://github.com/siddanta-ar1/unsaid/actions/workflows/ci.yml)
[![Live](https://img.shields.io/badge/live-myunsaid.tech-e8590c)](https://myunsaid.tech)
[![Solana devnet](https://img.shields.io/badge/Solana-devnet-9945FF?logo=solana&logoColor=white)](https://explorer.solana.com/address/7nRKgRMiHfXg3fUXPRFdNX97BWfSKhNqvBaXZM5BLcHZ?cluster=devnet)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[Live app](https://myunsaid.tech) · [Verify a receipt](https://www.myunsaid.tech/verify) · [Pitch](https://www.myunsaid.tech/pitch) · [Technical demo](https://www.myunsaid.tech/pitch/tech) · [Research](https://www.myunsaid.tech/research)

</div>

---

Type something into almost any app and it lands in a database, readable.
Engineers can query it, logs copy it, backups keep it, a breach publishes it.
The more personal the app, the worse that is — and people now confide in AI at
scale.

UNSAID is a place for the things you can't say out loud. Write or speak a
memory, reflect on it with an AI, or let it go. **We don't ask you to trust
us; we built it so you can check us.**

| | What it does |
|---|---|
| 🔒 **The vault** | Every memory is encrypted on your device before it leaves — AES-256-GCM, one key per memory. Our server only ever holds ciphertext. *Forget* destroys the key, so even a surviving backup is noise. |
| 🧠 **Echo** | AI reflection you consent to, one memory at a time. With the attested provider the model runs inside an Intel TDX enclave, which signs a measurement of the exact code that read your words. |
| 🧾 **Consent receipts** | Every time anything reads a memory, a content-free receipt is written to Solana: which memory (hashed), which consent wording, which enclave, which model, a hash of the answer. |
| ✅ **The verifier** | [`/verify`](https://www.myunsaid.tech/verify) derives the receipt address in your browser and reads a public RPC. Our API is not in that path — if we lied, the page would still tell the truth. |

No token. A wallet is never required, and every feature works without one.

## For judges

| | |
|---|---|
| **Live app** | https://myunsaid.tech |
| **Pitch deck (3 min)** | [`/pitch`](https://www.myunsaid.tech/pitch) — `T` starts the clock, `N` shows notes |
| **Technical demo deck** | [`/pitch/tech`](https://www.myunsaid.tech/pitch/tech) |
| **Verify a receipt, without us** | [`/verify`](https://www.myunsaid.tech/verify) |
| **Research, measured** | [`/research`](https://www.myunsaid.tech/research) · [`docs/paper/benchmarks.md`](docs/paper/benchmarks.md) |
| **Solana program (devnet)** | [`7nRKgRMiHfXg3fUXPRFdNX97BWfSKhNqvBaXZM5BLcHZ`](https://explorer.solana.com/address/7nRKgRMiHfXg3fUXPRFdNX97BWfSKhNqvBaXZM5BLcHZ?cluster=devnet) — source in [`programs/unsaid`](programs/unsaid) |
| **Why it is built this way** | [`docs/decisions.md`](docs/decisions.md) |
| **Video scripts and checklist** | [`docs/submission.md`](docs/submission.md) |

## Measured, not asserted

Every figure comes from a script in this repository and can be re-run —
see [`docs/paper/benchmarks.md`](docs/paper/benchmarks.md). Client numbers are
from a 2015 dual-core laptop, on purpose.

| | Result |
|---|---|
| Secrets found after planting 30 and searching the whole database, 806 stored objects and every log | **0** |
| Share of save time spent on encryption | **<1%** — 1.6 ms of 171 ms |
| Unlocking a vault (PBKDF2, 600k rounds) | **0.4 s** |
| Storage overhead per memory, any size | **+218 bytes** |
| Consent receipts confirmed on a free devnet RPC | **98 / 100**, median 1.1 s |
| Cost of one receipt | **0.0017 SOL** — 212 bytes, 17% of a transaction |
| Automated tests | **240**, against real Postgres and S3, not mocks |

Not yet measured, and said so: the live attested-inference round trip, which
is built and tested but waiting on inference credit (`benchmarks.md` §8).

## The invariant

One rule shapes every architectural decision here:

> **Plaintext emotional content never crosses the backend boundary.**

Content is encrypted on the device before it is sent. The API receives
ciphertext, wrapped keys and byte counts. There is no column in the database
that can hold a thought, and no log statement that can print one. The single
exception is Echo, where the user explicitly consents to send one specific
memory, once, having first read what that means.

That claim is enforced, not just asserted:

| Enforcement | Where |
|---|---|
| No content-shaped column exists | `backend/api/src/db/schema.ts`, gated in CI |
| Log serializers strip bodies wholesale | `backend/api/src/lib/logger.ts` |
| Analytics events are a closed, strict union | `packages/types/src/events.ts` |
| A canary is searched for across DB, storage and logs | `backend/api/tests/flow.test.ts` |
| Ownership is enforced in the query, not the UI | `backend/api/src/routes/thoughts.ts` |
| Error reports are scrubbed before any vendor sees them | `backend/api/src/lib/observability.ts` |
| Secrets cannot enter git history | `scripts/scan-secrets.mjs`, pre-commit + CI |

## How it works

```
 your device                     our servers                   public
┌─────────────────────┐        ┌────────────────────────┐    ┌──────────────────┐
│ write / speak       │        │ API: ciphertext,       │    │ Solana           │
│   │                 │  only  │ wrapped keys, sizes    │    │  ownership proof │
│   ▼                 │ cipher │                        │    │  consent receipt │
│ AES-256-GCM seal ───┼──text─▶│ Postgres · S3 storage  │    └────────▲─────────┘
│ (key never leaves)  │        │                        │             │
└─────────┬───────────┘        └───────────┬────────────┘             │
          │ consent to reflect             │ one memory, sealed       │
          ▼                                ▼                          │
     ┌──────────────────────────────────────────────┐   receipt with │
     │ Echo inside an Intel TDX enclave             │── measurement ──┘
     │ signs which code ran · reply returns sealed  │
     └──────────────────────────────────────────────┘
```

Plaintext exists in two places only: your browser, and inside the chip for
one reply.

## What is on Solana

Proof and consent — **never content**. The Anchor program has five
instructions: `create_record`, `update_record`, `revoke_record`,
`close_record`, `record_consent`.

| Account | Holds | Size · cost |
|---|---|---|
| **Thought record** | `SHA-256(thought_id ‖ ciphertext_hash)`, owner key, timestamp — proves an encrypted memory existed and who owned it | 124 B · 0.00128 SOL · ~550 ms |
| **Consent receipt** | memory digest, consent version, enclave measurement, model, result hash, timestamp — field names aligned to ISO/IEC TS 27560:2023 | 212 B · 0.0017 SOL · ~1.1 s |

```
program   7nRKgRMiHfXg3fUXPRFdNX97BWfSKhNqvBaXZM5BLcHZ   (devnet)
```

A claim only a stranger can check is worth writing to a chain; one only we can
check is not. Anchoring is optional: a user who never connects a wallet has a
fully working vault and no on-chain presence at all.

Next: batch each period's receipts into one Merkle root — projected ~20×
cheaper, with every receipt still individually provable.

```bash
node scripts/anchor-devnet.mjs      # anchors a memory, reads it back, prints the cost
```

## The encryption model

```
passphrase ──PBKDF2-SHA256 (600k)──▶ KEK  (non-extractable, never persisted)
                                      │
                                      │ AES-KW wraps
                                      ▼
                                  vault key ──wraps──▶ content keys
                                      ▲
recovery code ──PBKDF2──▶ KEK ──AES-KW┘

thought ──AES-GCM-256 with a fresh CEK──▶ ciphertext ──▶ object storage
                                      │
                                   wrapped CEK ──▶ Postgres
```

- One content key per thought, never reused; a fresh 96-bit nonce each time.
- The KEK is derived on unlock and held in memory for the tab's lifetime only.
- **Delete** removes the object and the record. **Forget** destroys the wrapped
  key first, so a surviving backup copy of the ciphertext is undecryptable.
- **Recovery:** the vault key is wrapped once per way in — the passphrase and a
  recovery kit. A forgotten passphrase costs a re-lock, not a vault. Changing
  it re-wraps one key; ciphertext is never rewritten.
- Envelope formats are versioned from the first commit; old versions must stay
  readable forever.

## Stack

| Layer | Technology |
|---|---|
| Web | Next.js 16, React 19, Tailwind CSS 4, Web Crypto API, installable PWA |
| API | Fastify 5, Zod 4 contracts shared with the client, JWT sessions (jose) |
| Data | PostgreSQL via Drizzle ORM, S3-compatible object storage (MinIO locally) |
| AI | Phala / RedPill in an Intel TDX enclave (attested); Anthropic or OpenAI-compatible providers, recorded on the receipt as unattested |
| Chain | Anchor 0.31 program in Rust, `@solana/kit` client |
| Tooling | pnpm workspaces, Turborepo, Vitest, Docker Compose, GitHub Actions |

```
unsaid/
├── apps/web/            Next.js app — capture, vault, privacy centre, verifier
├── packages/
│   ├── crypto/          Encryption envelope, key wrapping, rotation
│   ├── types/           Zod domain contracts shared by client and server
│   ├── solana/          @solana/kit client for the program
│   └── config/          Shared TypeScript configuration
├── backend/api/         Fastify API — metadata, storage, consent, Echo
├── programs/unsaid/     Anchor program — proof and consent only
└── infra/               Local Postgres + MinIO
```

## Running it

Requires Node 20.9+, pnpm 10, and Docker.

```bash
pnpm install
pnpm infra:up                        # Postgres + MinIO (private bucket)
cp .env.example .env
cp .env.example backend/api/.env
pnpm --filter @unsaid/api db:migrate

pnpm --filter @unsaid/api dev        # API  → http://localhost:3011
pnpm --filter @unsaid/web dev        # Web  → http://localhost:3010
```

Ports avoid the 3000/3001 and 54322 defaults because those commonly collide with
other local projects. Echo runs a no-network stub by default; set
`AI_PROVIDER` in `.env` to use a real model (see the comments there).

Health: `GET /health` is liveness; `GET /ready` reaches Postgres and object
storage and returns 503 naming the failing dependency.

## Testing

```bash
pnpm test               # 240 tests: crypto, API, components, Solana client (2 need a live enclave key)
cargo check -p unsaid   # the Anchor program
./scripts/restore-drill.sh   # prove a backup actually restores
node scripts/scan-secrets.mjs --all   # also runs on every commit
```

The integration suite runs against the real Postgres and MinIO from
`infra/docker-compose.yml` rather than mocks — that is what lets it assert the
privacy invariant against actual stored bytes.

| Suite | What it holds |
|---|---|
| `packages/crypto/src/vault.test.ts` | A forgotten passphrase is survivable |
| `backend/api/tests/flow.test.ts` | A canary reaches neither DB, storage nor logs |
| `backend/api/tests/consent-ledger.test.ts` | Every reflection leaves a receipt, and the receipt holds no content |
| `backend/api/tests/signals.test.ts` | Measuring cannot become surveillance |
| `backend/api/tests/rate-limits.test.ts` | The budgets actually trip, with a 429 |
| `components/RecoveryKit.test.tsx` | The one screen whose failure is unrecoverable |
| `lib/zip.test.ts` | Exports open in tools that are not ours |

## Status

| | State |
|---|---|
| Vault, recovery, forgetting, export | Built and tested |
| Echo with consent per memory and per wording | Built and tested |
| Attested inference (Intel TDX, measurement on the receipt) | Built and tested; live round trip not yet measured |
| Ownership proofs and consent receipts | Live on devnet |
| Access log and public verifier | Live |
| Merkle-batched receipts, security audit, mainnet | Next — see [`docs/ROADMAP.md`](docs/ROADMAP.md) |

## What this is not

Not a therapy platform, a crisis service, or a diagnostic tool. Not a public
social network. Not a diary on a blockchain: your words never go on chain, only
a hash proving they existed. Not a web3 app either — there is no token, a
wallet is never required, and every feature works without one. And not
unbreakable — a device that is already compromised can read what you type
before it is ever encrypted. What it does promise is that a leak of the
database or the object store does not expose what anyone wrote.

## Docs

- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what is being built, in what order, and what is settled.
- [`docs/decisions.md`](docs/decisions.md) — judgement calls, and what is still open.
- [`docs/paper/benchmarks.md`](docs/paper/benchmarks.md) — every measured number and how to re-run it.
- [`docs/paper/research-notes.md`](docs/paper/research-notes.md) — what is novel, what is textbook, and the prior art.
- [`docs/deployment.md`](docs/deployment.md) — every step, with the ones needing an account marked.
- [`docs/pilot-runbook.md`](docs/pilot-runbook.md) — how to run the first cohort so it yields an answer.
- [`docs/frontend-plan.md`](docs/frontend-plan.md) — the screens the claim requires, and their rules.
- [`docs/brand.md`](docs/brand.md) — the mark, the palette, and the Tailwind trap not to fall in.

## Team

Built in Nepal by **Siddanta Sodari** (full stack), **Rabin Poudel** (design)
and **Sachin Rijal** (backend), at [O.M.X Lab](https://github.com/omxdigitals).
Follow the build at [x.com/unsaid_privacy](https://x.com/unsaid_privacy).

## License

[MIT](LICENSE) © 2026 Siddanta Sodari
