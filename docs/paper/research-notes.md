# Paper research notes

Prepared 2026-09-17 for drafting an arXiv preprint in the next session.
Everything below is either (a) verified by a live source this session — marked
**[v]** with a URL, or (b) recalled and **[unverified]** — check before it goes
in a bibliography.

Suggested arXiv categories: **cs.CR** primary, **cs.HC** secondary.

---

## 1. What the paper claims

Three candidate framings. Recommended: **C1**.

**C1 — Verifiable consent for AI access to end-to-end encrypted personal data.**
> We show that per-use AI access to E2EE personal content can be made publicly
> auditable — binding a TEE attestation measurement, a consent version, and a
> response hash into a content-free on-chain receipt — so that a third party can
> verify *which code processed what, when, under which agreed terms*, without
> the operator, the AI provider, or the verifier learning anything about the
> content.

Why this one: it is the only part of the system that is not already in the
literature, and it is checkable rather than rhetorical.

**C2 — An enforced privacy invariant as an engineering method.** The CI-gated
schema check, wholesale log-body stripping, closed analytics union, and a
plaintext canary asserted against real Postgres/S3. Under-published as *method*;
weaker as a research result. Good as a secondary contribution or a workshop
paper (WPES).

**C3 — A usable-security result** from the pilot: do users believe a verifiable
privacy claim more than an asserted one, and can they operate a recovery kit?
Strongest *novelty per unit of work*, but requires pilot data that does not yet
exist. Target SOUPS.

**Recommendation:** write C1 now as the preprint, with C2 as a section; keep C3
as the follow-up paper once the pilot runs.

### What is explicitly NOT novel — state this in the paper

Saying so plainly is what stops a reviewer from saying it for you.

| Component | Status |
|---|---|
| Envelope encryption, per-object keys, KEK/DEK wrapping | Textbook |
| Recovery via a second wrapping of the vault key | Standard practice |
| Crypto-shredding (destroy key ⇒ ciphertext unreadable) | Known, in NIST guidance |
| Blockchain proof-of-existence / timestamping | Haber & Stornetta 1991; OpenTimestamps |
| Consent receipts | Kantara CR v1.1; ISO/IEC TS 27560:2023 |
| TEE-attested inference | Apple PCC; the confidential computing literature |
| **Binding attestation + consent version + content-free receipt, per access, on a public ledger, over E2EE personal data** | **The contribution** |

---

## 2. Motivation — the empirical hook

**[v]** Stanford (Oct 2025) survey of LLM chatbot users: **82% rated chatbot
conversations as sensitive or highly sensitive — more than email or social
media posts** — yet **nearly half discussed health topics** and **over a third
discussed personal finances** with ChatGPT.
https://news.stanford.edu/stories/2025/10/ai-chatbot-privacy-concerns-risks-research

That single pair of numbers is the paper's opening: the most sensitive channel
people have is also the one with the weakest structural protection.

**[v]** *A Survey of U.S. Users' Privacy Perceptions in LLM Chatbots*, NDSS USEC
2026 — users share preference-type data more readily than regulatory-defined
PII; lived privacy practice diverges from formal PII categories.
https://www.ndss-symposium.org/wp-content/uploads/usec26-5.pdf

**[v]** *Understanding Privacy Norms Around LLM-Based Chatbots: A Contextual
Integrity Perspective*, AAAI/ACM AIES.
https://ojs.aaai.org/index.php/AIES/article/view/36735
→ Use **contextual integrity** (Nissenbaum) as the theoretical frame: a consent
receipt is a machine-checkable record of the transmission principle.

**[v]** *Exploring User Security and Privacy Attitudes Toward General-Purpose
LLM Chatbots for Mental Health* — arXiv 2507.10695.

**[v]** *User Privacy Harms and Risks in Conversational AI: A Proposed
Framework* — arXiv 2402.09716.

### Why a private outlet has value at all (psychology grounding)

**[v]** Pennebaker's expressive-writing paradigm: 3–4 sessions, 15–20 min,
writing deepest thoughts about a stressful event; **theory of active inhibition
— concealing emotion is itself a stressor.**
https://journals.sagepub.com/doi/10.1177/1745691617707315

**[v]** Smyth meta-analysis, 13 studies, mean effect size **d = 0.47** on
health-related outcomes. **[unverified: exact year/citation — Smyth 1998,
J Consult Clin Psychol]**
https://sparq.stanford.edu/sites/g/files/sbiybj19021/files/media/file/baikie_wilhelm_2005_-_emotional_and_physical_health_benefits_of_expressive_writing.pdf

**[v]** Pavlacic et al. 2019, meta-analysis on posttraumatic stress/growth/QoL.
https://journals.sagepub.com/doi/abs/10.1177/1089268019831645

Use this to justify *why* the system should let content persist rather than be
discarded — and to motivate the "keep / let go" fork as a design element.

---

## 3. Related work, by area

### 3.1 E2EE storage — and how badly it goes wrong in practice

**[v]** *End-to-End Encrypted Cloud Storage in the Wild: A Broken Ecosystem*,
ACM CCS 2024 — analysis of Sync, pCloud, Icedrive, Seafile, Tresorit; **severe
cryptographic flaws in four of five**; a malicious server can inject files,
tamper with data, and in some cases read content. Seafile: no authentication of
chunked files ⇒ chunk reorder/removal. pCloud: insecure Merkle-tree-of-HMACs.
https://eprint.iacr.org/2024/1616 · https://brokencloudstorage.info/

**[v]** *A Formal Treatment of End-to-End Encrypted Cloud Storage*, CRYPTO 2024
(Backendal et al.) — security definitions to cite for our threat model.
https://link.springer.com/chapter/10.1007/978-3-031-68379-4_2

**[unverified]** Prior attacks on MEGA (Backendal, Haller, Paterson, S&P 2023)
and Nextcloud — cited as the preceding line of work in the CCS'24 paper.

**Positioning:** these papers establish that *claiming* E2EE is cheap and
getting it right is rare. Our answer is mechanical enforcement (§C2) plus
publishing the canary methodology so the claim is falsifiable by a third party.
This is a genuinely strong framing — the literature says the ecosystem is
broken; we propose a test anyone can run.

### 3.2 Deletion, erasure, crypto-shredding

**[v]** EDPB Guidelines 05/2019: erasure must be **"verifiable and
irreversible."** The EDPB has **not** formally endorsed crypto-shredding as
Art. 17 erasure; some DPAs accept it where full erasure is disproportionate.
→ Do not claim GDPR compliance. Claim a *technical* property (the ciphertext
becomes undecryptable) and discuss the regulatory gap honestly.

**[v]** *Ghost Vectors: Soft-Deleted Embeddings Remain Reconstructible in HNSW
Vector Databases* — arXiv 2606.18497. Excellent contrast: deletion at the
application layer is not deletion at the storage layer.

**[v]** *Erasing Data from Blockchain Nodes* — arXiv 1904.08901. Needed for the
"why nothing personal goes on chain" argument.

### 3.3 Consent records and receipts

**[v]** **ISO/IEC TS 27560:2023** *Privacy technologies — Consent record
information structure*: machine-readable consent records, exchanged as
"receipts". https://www.iso.org/standard/80392.html

**[v]** Kantara Consent Receipt v1.1 → became an Annex of ISO/IEC 29184 (2020)
→ incorporated into 27560 (Aug 2023). Note the directional difference: in 27560
the **controller** generates records and issues receipts to the data subject;
in Kantara v1.1 the receipt goes from data subject to controller.
https://kantara.atlassian.net/wiki/spaces/WA/overview

**[v]** Pandit et al., *Implementing ISO/IEC TS 27560:2023 Consent Records and
Receipts for GDPR and DGA* — arXiv 2405.04528, and the DPV mapping guide:
https://w3c-cg.github.io/dpv/guides/consent-27560
→ **Align our receipt schema to 27560 fields where possible.** That converts
"we invented a JSON blob" into "we instantiate a standard, made verifiable."
This is a cheap, high-value move for reviewer credibility.

**[unverified]** Blockchain consent management in healthcare is a large prior
literature (MedRec, Ancile, and many surveys). Must be cited and distinguished:
those systems put consent for *access to records held by others* on chain,
generally without E2EE of the content and without attestation of the computation
that consumed the data. Search before drafting.

### 3.4 Confidential computing and attested inference

**[v]** Apple **Private Cloud Compute**: verifiable transparency — measurements
of all production code in an append-only, cryptographically tamper-proof
transparency log; devices only send data to nodes that attest to publicly
listed software; entire stack (firmware → guest OS → app) in the TCB; images
published for research; source at `apple/security-pcc`.
https://security.apple.com/blog/private-cloud-compute/ ·
https://security.apple.com/documentation/private-cloud-compute/verifiabletransparency

**[v]** *Unlocking Apple's Private Cloud Compute: An Analysis of
Privacy-Preserving Artificial Intelligence* — arXiv 2605.24239.

**[v]** NVIDIA CC mode (H100/H200/B200/GB200): remote attestation of hardware +
firmware state, **2–5% throughput overhead** for most LLM inference.
https://www.spheron.network/blog/confidential-gpu-computing-nvidia-tee-encrypted-vram/

**[v]** *Privacy-Preserving LLM Inference in Practice* — eprint 2026/105.
**[v]** Red Hat on mutual attestation (provider verifies TEE before releasing
model-weight keys). https://next.redhat.com/2025/10/23/enhancing-ai-inference-security-with-confidential-computing-a-path-to-private-data-inference-with-proprietary-llms/

**[unverified but important]** TEE attacks must be cited for an honest threat
model: Foreshadow/L1TF, SGAxe, ÆPIC Leak, Plundervolt, and the general class of
microarchitectural side channels. Also: attestation only proves *what code was
loaded*, not that the code is correct.

### 3.5 Why not ZK, why not MPC/FHE — the design-justification section

**[v]** *A Survey of Zero-Knowledge Proof Based Verifiable Machine Learning*
(arXiv 2502.18535; Springer AI Review 2026): even optimized ZKML scales only to
**small/medium networks, GPT-2-class**; bottlenecks are circuit expressiveness,
proving cost, deployment complexity.

**[v] Arcium MXE limits (primary source, docs):**
- Callback output shares Solana's **1,232-byte** transaction limit.
- `Vec`, `String`, `HashMap` **not supported** — fixed-size arrays/structs only.
- `while`/`loop` unsupported; only `for` with fixed bounds; no `break`,
  `continue`, or early return; single exit path.
- **"The circuit shape must be known at compile time."**
https://docs.arcium.com/developers/limitations.md

⇒ Together these give a citable, quantitative argument that **TEE attestation is
the only deployable option at LLM scale today**, with MPC reserved for small
fixed-shape computations (private aggregate statistics) and ZK for future work.
This is a real contribution in itself: most papers assert the choice; we can
justify it with numbers.

**[v]** *Optimistic TEE-Rollups: A Hybrid Architecture for Scalable and
Verifiable Generative AI Inference on Blockchain* — arXiv 2512.20176. Closest
architectural neighbour; distinguish carefully (they verify inference
correctness for on-chain consumers; we bind consent + attestation for the data
subject's benefit, with the content never leaving E2EE).

### 3.6 Usable security — for the discussion section and the follow-up paper

**[unverified]** Abu-Salma et al., *Obstacles to the Adoption of Secure
Communication Tools* (IEEE S&P 2017) and *Exploring User Mental Models of E2EE
Communication Tools*.
**[v]** *Peeking Into the Black Box: Towards Understanding User Understanding of
E2EE*, EuroUSEC 2021. https://dl.acm.org/doi/10.1145/3481357.3481521
**[v]** *Improving Non-Experts' Understanding of End-to-End Encryption: An
Exploratory Study* (2020) — **metaphors work; stating what E2EE cannot protect
improves mental models.** Directly supports our "state the limits" design rule.
**[v]** *The Motivated Can Encrypt (Even with PGP)* — arXiv 2104.04478.

---

## 4. Threat model (draft — tighten in drafting session)

**Assets:** memory content; the fact that a particular person wrote at a
particular time; the vault key.

**Adversaries:**
1. **Honest-but-curious operator** (us). Sees ciphertext, wrapped keys, byte
   counts, timing. Cannot decrypt. *This is the one we defeat.*
2. **Malicious operator.** Can serve malicious client code (see §5 — code
   integrity), can lie about what it ran. Defeated only in part: on-chain
   receipts + published build hashes make misbehaviour *detectable after the
   fact*, not preventable.
3. **Storage/DB compromise.** Gets ciphertext only. Defeated.
4. **AI provider.** Sees one anonymous item, briefly, inside an enclave.
   Reduced to a hardware trust assumption + attestation.
5. **Chain observer.** Sees that an address anchored *something*, and when.
   Mitigated by domain-separated seeds; **not** eliminated — timing/frequency
   metadata is a real residual leak and must be stated.
6. **Compromised client device.** Reads plaintext before encryption. **Not
   defeated. Say so.**

**Explicit non-goals:** anonymity of the act of writing; protection against a
compromised endpoint; protection against a user who loses both secrets.

---

## 5. The client code-integrity problem (do not skip this)

Browser-delivered E2EE re-ships the trusted code on every load, so a malicious
or compromised server can exfiltrate the passphrase. This is the standard
critique and reviewers will raise it.

**Our answer:** publish the hash of each web build to the chain; the client
verifies the running build against the published measurement. This mirrors PCC's
transparency-log design, at a much smaller scale, and gives a third
load-bearing use of the ledger. **[unverified]** Prior art to find and cite:
Binary Transparency, Certificate Transparency (RFC 6962), Signal's/WhatsApp's
Code Verify, and "Web Application Transparency" proposals.

---

## 6. Evaluation plan — the numbers to produce

None of these exist yet; all are a week's work at most. Without them the paper
is a design document.

| Measurement | Method | Why a reviewer needs it |
|---|---|---|
| Key derivation latency (PBKDF2, 600k) | Desktop, mid-range Android, low-end Android; 20 runs, report median/p95 | The unlock wall is the product's main UX cost |
| Encrypt/decrypt overhead vs payload size | 1 KB text → 10 MB audio; throughput MB/s | Shows envelope cost is negligible |
| End-to-end save latency | Client encrypt → upload → metadata commit | System viability |
| Attested-inference round trip | Attested endpoint vs non-attested baseline, same model/prompt; report the delta | Quantifies the price of the privacy property |
| Attestation verification time on the client | Cold and warm | Must be tolerable or nobody verifies |
| On-chain receipt cost + confirmation time | Devnet, N=100 receipts; lamports and seconds | Whether per-access receipts are affordable at scale |
| Receipt size vs the 1,232-byte limit | Field-by-field budget | Shows the design fits the constraint |
| Canary experiment | Write N canaries through the real client; grep full `pg_dump`, object store bytes, API logs, web logs | **The falsifiable claim. Report as a reproducible protocol, not an assertion** |
| Storage overhead | Ciphertext + wrapped key + metadata vs plaintext size | Honest accounting |

Also report: **cost per user per month** at a stated reflection rate — this is
rare in papers and makes the deployability argument concrete.

---

## 7. Paper outline (target ~10–12 pages, two-column)

1. **Introduction** — open with the Stanford 82% / half-discuss-health pair;
   the structural gap; contributions as three bullets.
2. **Background & motivation** — expressive writing and inhibition; disclosure
   to LLMs; contextual integrity.
3. **Threat model** (§4), with non-goals stated up front.
4. **Design** — the three layers: vault, attested reflection, consent ledger.
   Include the key hierarchy figure and the receipt schema (27560-aligned).
5. **Why not ZK / why not MPC** — the quantitative design justification (§3.5).
   This section is unusually strong; give it space.
6. **Enforcing the invariant** — schema gate, log serializers, closed event
   union, canary protocol. Frame as a *method others can adopt*, against the
   CCS'24 "broken ecosystem" backdrop.
7. **Implementation** — 17k LOC TypeScript, Rust/Anchor program, 161 tests,
   what is deployed where.
8. **Evaluation** (§6).
9. **Discussion & limitations** — device compromise; hardware trust; metadata
   leakage; regulatory status of crypto-shredding; the residual "trust us not
   to ship bad client code" and what the build-hash log does about it.
10. **Related work** (§3).
11. **Conclusion.**

Artifacts: repo, program ID on explorer, the canary protocol as a runnable
script. Say "available at" — arXiv readers check.

---

## 8. Venues and dates

| Venue | Date | Notes |
|---|---|---|
| **arXiv preprint** | Anytime | Do this first. Timestamps the architecture; citable by the hackathon submission and grant applications |
| **PoPETs / PETS 2027** | Rolling, **4 cycles/year**, ~2 months to decision; conference Delft, 2027-07-19; a cycle deadline noted at 2027-02-28 | Best systems fit |
| **SOUPS 2027** | Typically ~Feb | Best fit for the pilot/user-study paper (C3) |
| **WPES @ CCS** | Autumn | Short-paper home for C2 |
| **USENIX Security '27** | Cycle 2 registration 2027-01-19, submission 2027-01-26 | Bar too high as it stands |

Sources: https://securityinsight.nl/event/call-for-papers-pets-2027-2026-07-19 ·
https://www.usenix.org/conference/usenixsecurity27/call-for-papers ·
https://usec-deadlines.github.io/

---

## 9. Before drafting — open items

1. **Verify the blockchain-consent-management prior art** (healthcare) and write
   two sentences distinguishing us. This is the likeliest "this exists already"
   reviewer objection.
2. **Verify the TEE side-channel citations** (Foreshadow, SGAxe, ÆPIC) — needed
   for an honest limitations section.
3. **Find binary/web transparency prior art** for §5.
4. **Pin the Smyth meta-analysis citation** (year, journal, exact d).
5. **Decide the receipt schema** and map each field to ISO/IEC 27560.
6. **Run the benchmarks in §6** — the paper cannot be submitted without them.
7. Confirm whether the attested-inference provider's attestation can be verified
   **client-side**; if only server-side, the trust argument weakens and the
   paper must say so.
8. Decide authorship, affiliation (OMX Lab), and whether the pilot will need
   ethics review for the follow-up SOUPS paper — **start that process early if
   the answer is yes**.
