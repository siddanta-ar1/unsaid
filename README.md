# UNSAID

A private place for the things you cannot say out loud. Speak, write, reflect,
or let it go — your memories stay under your control.

This repository implements the MVP described in the product and technical
blueprint: voice and text capture, a client-side-encrypted vault, consent-gated
AI reflection ("Echo"), and an optional Solana ownership layer.

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

## Layout

```
unsaid/
├── apps/web/            Next.js app — capture, vault, privacy centre
├── packages/
│   ├── crypto/          Encryption envelope, key wrapping, rotation
│   ├── types/           Zod domain contracts shared by client and server
│   ├── solana/          @solana/kit client for the ownership program
│   └── config/          Shared TypeScript configuration
├── backend/api/         Fastify API — metadata, storage, consent, Echo
├── programs/unsaid/     Anchor program — proof and ownership only
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
other local projects.

## Recovery

A forgotten passphrase is survivable. Content keys are wrapped under a single
vault key, and that vault key is wrapped once per way in — the passphrase and a
recovery kit. Losing the phrase costs a re-lock, not a vault.

```
passphrase ──PBKDF2──▶ KEK ──AES-KW wraps──┐
                                            ├──▶ vault key ──wraps──▶ content keys
recovery code ──PBKDF2──▶ KEK ──AES-KW wraps┘
```

Changing a passphrase re-wraps one key. Ciphertext is never rewritten, nothing
is re-uploaded, and an existing recovery kit keeps working.

## Health

- `GET /health` — liveness. Is the process up.
- `GET /ready` — reaches Postgres and object storage, and returns 503 with the
  failing dependency named. A check that cannot fail reports nothing.

## Testing

```bash
pnpm test               # 161 tests: crypto, API, components, Solana client
cargo check -p unsaid   # the Anchor program
./scripts/restore-drill.sh   # prove a backup actually restores
node scripts/scan-secrets.mjs --all   # also runs on every commit
```

The integration suite runs against the real Postgres and MinIO from
`infra/docker-compose.yml` rather than mocks — that is what lets it assert the
privacy invariant against actual stored bytes.

A few suites are worth knowing about:

| Suite | What it holds |
|---|---|
| `packages/crypto/src/vault.test.ts` | A forgotten passphrase is survivable |
| `backend/api/tests/flow.test.ts` | A canary reaches neither DB, storage nor logs |
| `backend/api/tests/signals.test.ts` | Measuring cannot become surveillance |
| `backend/api/tests/rate-limits.test.ts` | The budgets actually trip, with a 429 |
| `components/RecoveryKit.test.tsx` | The one screen whose failure is unrecoverable |
| `lib/zip.test.ts` | Exports open in tools that are not ours |

## The encryption model

```
passphrase ──PBKDF2-SHA256 (600k)──▶ KEK  (non-extractable, never persisted)
                                      │
                                      │ AES-KW wraps
                                      ▼
thought ──AES-GCM-256 with a fresh CEK──▶ ciphertext ──▶ object storage
                                      │
                                   wrapped CEK ──▶ Postgres
```

- One content key per thought, never reused; a fresh 96-bit nonce each time.
- The KEK is derived on unlock and held in memory for the tab's lifetime only.
- **Delete** removes the object and the record. **Forget** destroys the wrapped
  key first, so a surviving backup copy of the ciphertext is undecryptable.
- Envelope formats are versioned from the first commit; old versions must stay
  readable forever.

## What is on Solana

A commitment — `SHA-256(thought_id ‖ ciphertext_hash)` — plus an owner key and a
timestamp. That proves an encrypted memory existed at a point in time and who
owned it, while revealing nothing about its content and being irreversible.

Anchoring is optional. A user who never connects a wallet has a fully working
vault and no on-chain presence at all.

## Shipping

- `docs/deployment.md` — every step, with the ones needing an account marked.
- `docs/pilot-runbook.md` — how to run the first cohort so it yields an answer.
- `docs/decisions.md` — judgement calls, and what is still open.

## What this is not

Not a therapy platform, a crisis service, or a diagnostic tool. Not a public
social network. Not a diary on a blockchain. And not unbreakable — a device that
is already compromised can read what you type before it is ever encrypted. What
it does promise is that a leak of the database or the object store does not
expose what anyone wrote.
