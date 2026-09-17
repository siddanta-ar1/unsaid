# Frontend plan

What the product now claims — a vault nobody can read, reflection that never
decrypts to us, and an access record a stranger can check — needs four screens
that do not exist yet. This is the order to build them in, and what each one has
to say.

## What exists today

| Route | State |
|---|---|
| `/` landing | Built. Tells the old story: private vault, no audience |
| `/app` capture entry | Built. Talk / Write / I do not know |
| `/capture` | Built. Keep it privately / Let it go, with a bring-it-back path |
| `/vault` timeline | Built. Date, kind, time. No previews, deliberately |
| `/vault/[id]` memory | Built. Decrypts locally, Echo, delete, forget, anchor panel |
| `/privacy` centre | Built. How it actually works |
| `/settings` | Built. Export, phrase and kit, wallet, vault id |
| `/legal/privacy`, `/legal/terms` | Built |

Components: `UnlockGate`, `RecoveryKit`, `ReflectConsentSheet`, `AnchorPanel`,
`WalletConnect`, `VaultExport`, `VaultSecurity`, `SupportResources`,
`FeedbackButton`, `Shell`, `Logo`.

**Missing entirely:** anything a person who does not own the vault can look at,
any view of who touched what, any price, and every error boundary.

---

## Phase 1 — the screens that need no new backend

These can ship today against the deployed devnet program.

### 1.1 `/verify` — the public verifier ✅ built

The one screen that proves the architecture rather than describing it. A
stranger pastes an owner address and a memory id; the page derives the PDA,
reads the account from a public RPC, decodes it, and reports what the chain
says. **No backend of ours is involved, which is the entire point** — if our
API were lying, this page would still tell the truth.

- Optional ciphertext hash recomputes the commitment and checks it matches,
  which upgrades "a record exists" to "this exact encrypted memory existed".
- Query params (`?owner=&id=&hash=`) make a verification shareable as a link.
- States: idle, checking, verified, commitment mismatch, no record, RPC error.
- Says plainly what it does **not** prove: nothing about content, and nothing
  about who a wallet belongs to.

### 1.2 Error boundaries ✅ built

`not-found.tsx` and `error.tsx`. The app had neither, so a bad route or a thrown
render showed the framework's default — which on a privacy product reads as
though something leaked.

### 1.3 Installable PWA ✅ built

`app/manifest.ts`, maskable icons at 192/512. Someone in the middle of the night
opens a link; they should be able to keep it on the home screen without an app
store standing in the way.

### 1.4 Share a proof from the memory screen ✅ built

Once a memory is anchored, offer the verification link. A proof nobody can hand
to anyone is not a proof.

---

## Phase 2 — the consent ledger (blocked on the backend)

Build the UI against the contract below as soon as the receipts exist.

### 2.1 `/activity` — the access log

The screen that makes "we cannot misuse your data" checkable. Reverse
chronological, one row per access: what was done, to which memory, under which
version of the consent text, which enclave measurement, and a link to the chain
record.

Rules:
- Never render content, not even a preview. The log is metadata by construction.
- Every row links to `/verify` with its parameters filled in.
- Empty state is the good state: "Nothing has ever accessed a memory."
- A row whose on-chain record cannot be found is shown as **unconfirmed**, not
  hidden. Hiding a failure to record is the one thing this screen cannot do.

Expected API: `GET /v1/activity` → `{ items: [{ id, kind, thoughtId,
consentVersion, attestation, model, responseHash, signature, at }] }`.

### 2.2 Attestation on the reflection

When Echo answers, show which enclave produced it and let the user check the
attestation. Copy that survives a technical reader: *"This ran in a sealed
enclave. Here is the hardware's signed statement of what code ran."*

### 2.3 `ReflectConsentSheet` v2

The consent text changes when the compute model changes, so
`CURRENT_AI_CONSENT_VERSION` increments and everyone re-consents. New wording
must say: the memory leaves the device encrypted to the enclave's key, our
servers relay it without being able to open it, and a record of the access is
written publicly.

---

## Phase 3 — the commercial and first-run surfaces

### 3.1 `/pricing`

Free: unlimited text, limited voice, no Echo. Paid: voice storage, reflections,
anchoring. State the trade in one line — *we charge money because we cannot read
your data* — because the business model is part of the trust argument.

### 3.2 Upgrade flow

USDC or card. No wallet required for the card path; a wallet must never become a
precondition for paying.

### 3.3 First-run and empty states

The passphrase wall is the steepest drop in the funnel (worrying below 40%
conversion from landing). Needs: a reason to choose a phrase before being asked
for one, and a recovery-kit screen that survives being read at 2am.

### 3.4 Landing rewrite

Current copy sells the old story. The new one leads with the same human problem
and adds the check: *you do not have to trust us — look.*

---

## Phase 4 — polish before judging

- `opengraph-image` so a shared link looks deliberate.
- A `/demo` walkthrough for judges that needs no vault.
- Re-skin `docs/unsaid-deck.pdf` to the OMX palette.
- Accessibility pass: focus order through the gate, live regions on Echo,
  reduced motion honoured (already global).
- Loading states on every route that decrypts, so the pause reads as work
  rather than breakage.

---

## Rules that apply to every screen

1. **Never render content the server could not have produced.** If a screen
   shows a memory, it decrypted it locally.
2. **No preview text anywhere.** The absence of previews is the privacy model
   made visible; adding one would quietly require a readable column.
3. **State the limit next to the claim.** Every proof surface says what it does
   not prove. Overclaiming is what makes people stop believing the rest.
4. **A wallet is never required.** Every path works without one.
5. **Quiet by default.** No accent-coloured calls to action; coral appears in
   the mark and in `ember`, nowhere else.
