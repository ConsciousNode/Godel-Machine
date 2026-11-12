# Godel-Machine

**GM-1: a proof-gated, self-rewriting machine in one HTML file.** A searcher program running on the machine's own VM proposes rewrites of the solver *and of itself*. A fixed checker applies a rewrite only with a formal certificate: a chain of rules showing the same outputs and no higher cost on every input, plus a measured speedup. It's a toy-scale take on Schmidhuber's Gödel Machine (2003), built by Argon from [`SPEC.md`](SPEC.md) and judged against a [`PREREGISTRATION.md`](PREREGISTRATION.md) committed first.

**Status (2026-11-12): Broken as delivered, by one narrow gap.** See [`AUDIT.md`](AUDIT.md).
- An independent checker agrees with GM-1's on all 150 proposals.
- 390/390 mutated forgeries are rejected.
- 3 of 5 programs Argon never saw get proven speedups.
- The searcher proves a rewrite of itself, even with its planted redundancies removed.
- ⚠️ No rule checks that register fields are in r0–r15, so 2 hand-made certificates on ill-formed programs pass both checkers and change behavior. A one-line check fixes it; a 1.1 patch and a rerun come next.

**First look:** open `gm1.html`, or run `node tests/run-all.js` and `node audit/heldout.js`.

Xinu: single-file, zero-dependency, offline. MIT License · ConsciousNode SoftWorks
