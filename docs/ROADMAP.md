# Roadmap

One build, three outputs. The benchmarks the paper needs are the demo the
hackathon needs; the pilot that decides go/stop is the dataset the second paper
needs. Nothing here is a detour from anything else here.

| Output | When | Extra effort beyond the build |
|---|---|---|
| Colosseum submission | **12 Oct 2026** | Demo video, deck |
| arXiv preprint | Late Oct | ~1 week of writing |
| Peer-reviewed paper | Feb 2027 | Pilot data, revision |

## Where this stands (17 Sep 2026)

**Research: 4/10.** The claim is defensible and the prior art is mapped
(`docs/paper/research-notes.md`). There are no measurements at all, and no user
data. That is most of the missing six points, and it is a week of work rather
than a research programme.

**Hackathon: 5/10.** The product works and the engineering is well above the
median entry — 161 tests, an invariant enforced in CI. Against that: the chain
was decorative until today, there is no demo video, and there are no users.

Both numbers move to roughly 7 and 8 if the plan below is executed.

## Now → 12 Oct: the submission

**Days 1–3 — unblock**
- [x] Deploy the Anchor program to devnet —
      `7nRKgRMiHfXg3fUXPRFdNX97BWfSKhNqvBaXZM5BLcHZ` (17 Sep 2026)
- [ ] Call it for real: `create_record` from a script, read the account back,
      decode it. The program exists on chain; nothing has executed yet
- [ ] Exercise the wallet path once against a real extension
- [ ] Register the team and claim the Solana track

**Days 4–12 — the two new layers**
- [ ] Consent receipts on chain: memory-id hash, consent version, enclave
      measurement, model id, response hash, timestamp. Align field names to
      ISO/IEC TS 27560:2023 — it costs nothing and removes a reviewer objection
- [ ] Attested inference behind the existing `AI_PROVIDER` switch. Phala first
      (OpenAI-compatible, returns an attestation report and response hash);
      evaluate Chutes for the client-encrypted variant, where the relay is
      genuinely blind
- [ ] Public verifier page — a stranger pastes a proof, the page checks the
      chain, no backend of ours involved

**Days 13–20 — make it real**
- [ ] The access-log screen: everything that ever touched a memory, with the
      chain record beside it
- [ ] USDC subscription, one working flow
- [ ] **Run the benchmarks** (`docs/paper/research-notes.md` §6). This is the
      overlap — measured once, used by both the demo and the paper
- [ ] Ten real users, even friends

**Days 21–25 — win the judging**
- [ ] Demo video, 2–3 minutes, opening on the canary: write something, then
      grep the database, the object store and the logs, live, for zero hits
- [ ] Deck — the six slides exist; replace the competitor slide with the
      consent-layer story
- [ ] **Submit two days early.** Deadline-day submission is how good projects die

## 13 Oct → 15 Nov: the preprint

Draft from `docs/paper/research-notes.md`. The evaluation section already
exists, because it was run in week three. Post to arXiv (cs.CR primary, cs.HC
secondary) and cite it in grant and accelerator applications.

## Nov → Dec: the pilot

`docs/pilot-runbook.md`, unchanged. 20–30 people, three waves of ten, the four
numbers with their kill thresholds, ten interviews including at least three
people who stopped. Produces the go/iterate/stop decision **and** the dataset
for the usability paper.

Launch gates still apply and are not hackathon blockers, but are pilot
blockers: crisis numbers dialled by a human, a restore drill against
production, a Nepal-qualified privacy review, rollback documented with someone
on call.

## Jan → Feb 2027: the papers

- **PoPETs** — rolling, four cycles a year, ~2 months to decision. The system.
- **SOUPS** — deadline typically ~February. The usability result.

## Settled — stop reopening these

- **Not a web3 app.** A normal application that uses a chain for consent and
  proof, because those are the two things a chain is actually good at.
- **Expression is the product; privacy is the mechanism.** The north star is
  weekly meaningful releases per retained user, not bytes protected.
- **No token.** Subscription and per-use fees.
- **OMX Lab is the company, Unsaid is the first product.** The consent layer
  becomes sellable infrastructure only once the app proves someone wants it.

## Not on the list, deliberately

Mobile apps. Mainnet. The anonymous social layer. Anything that trades the
thesis for hackathon points — a token, wallet-gated features, or content on
chain.
