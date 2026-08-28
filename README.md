# Umbra

**Grade the work. Not the name.**

Umbra is a blind-evaluation protocol on [Midnight](https://midnight.network): submissions are
scored against an anonymous id, and a submitter can only prove "this decision is mine" — and
claim it — *after* the decision is already final and immutable. Built for the
[Midnight Buildathon](https://akindo.io) on AKINDO, Wave 1.

The pitch, the research behind it, and where this generalizes beyond a single use case are in
the deck (not checked into this repo — ask if you want it linked).

## Why this needs a blockchain, not just a database

"Blind grading" already exists as a *policy* in plenty of institutions — strip the name,
assign an anonymous ID, hope everyone in the pipeline complies. What's missing is a
*mechanism*: nothing stops one export, one admin, one peek from breaking the whole scheme, and
there's no way to prove after the fact that a decision was locked in before anyone knew who it
belonged to.

Umbra makes that provable instead of assumed, using Midnight's dual-ledger model:

- **Public ledger** — submission commitments, a nullifier set (prevents double-submission
  without revealing who submitted), and grade commitments. Fully auditable, contains zero
  identity information.
- **Private state** — a submitter's secret key and the actual work + salt behind their
  commitment. Never leaves their control until they choose to reveal.

## Protocol: Submit → Grade → Reveal

1. **`submit()`** — the submitter posts a commitment (hash of their work + a salt) and a
   nullifier derived from a private key, under a fresh numeric id. No name, wallet, or index
   position is recorded — the ledger only ever sees opaque hashes.
2. **`grade()`** — the authorized grader scores that numeric id. The grader never learns, and
   the ledger never records, who the id belongs to.
3. **`reveal()`** — after grading, the submitter proves they hold the secret key matching the
   stored owner key for that id *and* the original work + salt matching the stored commitment.
   Only then is an identity ever linked to a decision — and by then the decision can no longer
   change.

See [`pkgs/contract/src/umbra.compact`](pkgs/contract/src/umbra.compact) for the full contract.

## Repo structure

```
pkgs/
  contract/
    src/umbra.compact          # the Compact contract (ledger + 3 circuits)
    src/umbra-witnesses.ts     # TypeScript witness implementations (private state)
    src/test/                  # Vitest simulator tests
    src/managed/                # compiler output (zkIR, keys, compiled JS) — gitignored, regenerate below
  cli/
    src/api.ts                 # wallet/provider bootstrap + deploy/submit/grade/reveal calls
    src/smoke-test.ts          # end-to-end real-network run: deploy -> submit -> grade -> reveal
```

A browser frontend (`pkgs/app`) is next.

## Real-network smoke test

Beyond the simulator, `pkgs/cli` deploys the actual compiled contract to a running Midnight
network and calls `submit()` / `grade()` / `reveal()` for real — real ZK proof generation via
the proof server, real transactions, real block confirmations. Verified end-to-end against the
local network described in [`../midnight-local-dev`](https://github.com/midnightntwrk/midnight-local-dev):

```bash
# terminal 1 — bring up the local network (see midnight-local-dev's README)
cd midnight-local-dev && docker compose -f standalone.yml up -d

# terminal 2 — run the smoke test; it prints an address and waits for funds
cd umbra && npm run smoke-test --workspace=@umbra/cli

# terminal 1 (or a genesis-funded script) — send the printed address some tNight,
# e.g. via midnight-local-dev's funding tool, then the smoke test continues on its own
```

One funded wallet plays both roles (grader and submitter) across the run — see the comment on
`setUmbraIdentity()` in `pkgs/cli/src/api.ts` for why that's safe: the contract only ever sees
a derived key from whichever logical secret key is active in private state when a circuit
runs, never the underlying wallet identity. A real run produces output like:

```
Deployed Umbra contract at: b7dd65c92e33367bdf2aa7d891ae33deec5b777d2a02273bfdb4b83793d88020
Submit TX ... added in block 9042 -- submission_count=1
Grade TX  ... added in block 9045 -- graded_ids has 0 = true, grade = 85
Reveal TX ... added in block 9048 -- revealed_ids has 0 = true
```

## Setup

Requires Node.js ≥ 22, and the [`compact` CLI](https://docs.midnight.network) with compactc
pinned to a version matching the pragma in `umbra.compact` (currently developed and verified
against **compactc 0.30.0**):

```bash
compact update 0.30.0
```

```bash
npm install
npm run contract:compile   # compiles umbra.compact -> pkgs/contract/src/managed/umbra
npm run contract:test      # runs the Vitest simulator suite (13 tests)
```

Both commands are also runnable directly inside `pkgs/contract` (`npm run compact`,
`npm run test`).

## How to evaluate this submission

1. `npm install && npm run contract:compile` — confirms the Compact contract compiles
   (this is the hackathon's technical gate: at least one contract must compile successfully).
2. `npm run contract:test` — runs the simulator test suite, which exercises the actual
   privacy/security properties, not just happy-path behavior:
   - a second submission from the same secret key is rejected (nullifier reuse)
   - grading from anyone other than the authorized grader is rejected
   - a submission can't be graded twice, or graded before it exists
   - reveal is rejected before grading, from the wrong owner, and with mismatched work/salt
   - the true owner can claim a graded submission exactly once
   - an end-to-end scenario with two independent submitters shows grading stays blind to
     identity throughout, and each submitter can only ever claim their own grade

## Status

- [x] Local Midnight dev network verified (node, indexer, proof server)
- [x] Compact toolchain installed and pinned (compactc 0.30.0)
- [x] `submit()` / `grade()` / `reveal()` circuits compile and pass a real test suite
- [x] Real-network deployment verified: `submit()` → `grade()` → `reveal()` run against the
      local network with real ZK proofs and real block confirmations (`pkgs/cli`)
- [ ] Browser frontend (`pkgs/app`)
- [ ] Cardano / Andamio credential-mint bridge (Wave 2+, see the deck)

## License

The Midnight-related code in this repository — the Compact contract and everything needed to
evaluate it — is licensed under [Apache 2.0](LICENSE). See [NOTICE](NOTICE) for attribution.
