# GM-1.1 audit: preregistration rerun

**Auditor:** Kehai Interim · **Date:** 2026-11-12
**Delivery:** commit `4921d2e` (Argon's bundle, as delivered).
**Spec:** [`SPEC-1.1.md`](SPEC-1.1.md). **Previous audit:** [`AUDIT.md`](AUDIT.md) (GM-1: Broken on criterion 2).
**Judged against:** [`PREREGISTRATION.md`](PREREGISTRATION.md), unchanged since before GM-1 was built.

## Verdict: **Works.** All five primary criteria hold.

The gap that broke GM-1 is closed. The checker now rejects any certificate whose active or replacement program is not well-formed, and every load path refuses ill-formed programs. Argon touched nothing in `audit/`, and every one of my scripts runs unmodified against the patched machine.

I updated my **independent checker** to the GM-1.1 documents, again from `ISA.md` §1.1 and `PROOFS.md` §3.1 alone: well-formedness and canonical witness fields are now on by default, and `{ gm10: true }` gives the old rules. Under those documents, it agrees with GM-1.1 everywhere.

| # | Criterion | Result |
|---|---|---|
| 1 | Every accepted rewrite passes our checker | **Holds.** It agrees with GM-1.1's checker on all 150 proposals across the seed and 4 presets (5 of 5 runs with zero disagreements), and on every held-out rewrite. |
| 2 | Our forged corpus is rejected 100% | **Holds.** The 390 mutation forgeries are rejected by both checkers. All 5 targeted soundness probes are rejected by GM-1.1's checker, including the two r99 probes that broke GM-1 (now `ill_formed_program` from both checkers). The two "unused witness changed" certificates, previously harmless but non-canonical, are now rejected by both with `noncanonical_certificate`. |
| 3 | A proven rewrite on ≥ 3 of 5 held-out solvers | **Holds: 3/5.** The rewrites and costs are identical to GM-1's: h:m:s 316→296, quadratic 656→584, double-and-clamp 585→459. |
| 4 | The searcher proves a rewrite of itself | **Holds**, on both searchers. The seeded searcher (774 instructions) goes 29,917 → 29,879. The new `plain` preset (771 instructions, with the three seeded identities removed) goes 29,885 → 29,873. This matches my GM-1 measurement exactly. |
| 5 | Old and new agree on 10,000 random inputs | **Holds.** Every accepted solver rewrite: 0 mismatches and 0 cost increases on 10,000 inputs. Every self-rewrite: 0 mismatches on 150 solver jobs. |

## The fixes

- **P1, well-formed programs:** defined in `ISA.md` §1.1, enforced by the checker (`ill_formed_program`) and by all load paths. There's a positive control: `allowIllFormed: true` brings my r99 probes back.
- **P2, disclosure:** `REPORT.md` now names the seeded identities in the searcher and the presets, and the `plain` searcher is reported alongside the seed one.
- **P3, budgeted theorem:** `PROOFS.md` §1 states the honest budgeted form.
- **P4, canonical certificates:** each rule's witness usage is documented, and nonzero unused fields are rejected.
- **No regressions:** Argon's Test 13 shows identical accepted rewrites to GM-1 on the seed and all presets, and my reruns agree.

## Finding

1. **Test 9 disappears when Playwright is installed** (severity: low; honest-reporting bug).
   - The runner checks for Selenium, then Playwright. If Selenium is missing but Playwright is present, as in this audit environment, it has no Playwright branch, so it records **nothing**. The summary reads "12 passed / 0 failed / 0 skipped (total 12)", with Test 9 silently missing.
   - P5 asked that a skip never be reported as a pass. This isn't a pass, but a missing test shouldn't vanish from the count either.
   - My own Playwright run substitutes: `gm1.html` in headless Chromium, 5 epochs plus the forgery button, **0 page or console errors** (`audit/gm1.1-browser.png`).
   - Small fix for later: add the Playwright branch, or count an unrun test as SKIPPED.

## What this result does and doesn't claim

As in the preregistration: a toy-scale machine whose every self-rewrite, including rewrites of its own proof searcher, is gated on a machine-checked proof, re-verified by a checker built independently from the documents.

It does **not** claim:
- general intelligence;
- Schmidhuber's global optimality (proving that switching now beats searching longer);
- "first ever", until a proper literature search is done.

The rule set is 14 local, peephole-sized rewrites, and the searcher saturates after one or two rewrites per program.

## Files changed by this audit

- `audit/indep-checker.js`, updated to the GM-1.1 docs (the GM-1.0 rules stay available as `{ gm10: true }`);
- `audit/gm1.1-browser.png`;
- this file.
