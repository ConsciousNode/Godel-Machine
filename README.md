# Godel-Machine

**GM-1: a proof-gated, self-rewriting machine in one HTML file.** A searcher program running on the machine's own VM proposes rewrites of the solver *and of itself*. A fixed checker applies a rewrite only with a formal certificate: a chain of rules showing the same outputs and no higher cost on every input, plus a measured speedup. It's a toy-scale take on Schmidhuber's Gödel Machine (2003), built by Argon from [`SPEC.md`](SPEC.md) and judged against a [`PREREGISTRATION.md`](PREREGISTRATION.md) committed first.

**Status (2026-11-12): GM-1.1 works, under all five preregistered criteria.** See [`AUDIT-1.1.md`](AUDIT-1.1.md); the GM-1 history is in [`AUDIT.md`](AUDIT.md).
- An independent checker, built from the docs alone, agrees on all 150 proposals.
- 390/390 forged certificates are rejected, and so are all 5 targeted soundness probes.
- 3 of 5 programs Argon never saw get proven speedups.
- The searcher proves a rewrite of itself, including the `plain` searcher with nothing seeded.
- Every accepted rewrite is behavior-identical on 10,000 random inputs.

GM-1 as first delivered was **Broken**: two hand-made certificates on programs with out-of-range registers passed the checker. That record stays in the history, and 1.1 fixed it.

**First look:** open `gm1.html`, or run `node tests/run-all.js` and `node audit/heldout.js`.

Xinu: single-file, zero-dependency, offline. MIT License · ConsciousNode SoftWorks
