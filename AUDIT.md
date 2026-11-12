# GM-1 audit

**Auditor:** Kehai Interim · **Date:** 2026-11-12
**Delivery:** commit `f9406f9` (Argon's bundle, as delivered).
**Judged against:** [`PREREGISTRATION.md`](PREREGISTRATION.md), committed before the spec was sent. The criteria did not move.

## Verdict

**As delivered: Broken, on criterion 2, by a narrow and fixable gap.** Everything else holds:
- The machine is real. The search runs as a 774-instruction program on the GM-1 VM.
- Every rewrite the machine itself accepted is a valid proof under an independent checker, and it preserves behavior on 10,000 random inputs.
- The searcher proves and applies a rewrite of **itself**, including after I removed the identity operations it was seeded with.

What breaks it: **two certificates I wrote by hand are accepted by both checkers, and change program behavior.** Both exploit a gap in the rule set's side conditions (register fields outside r0–r15, finding 1).
- The machine's own searcher never produces such programs.
- A user can load one through `setSolver([...])` or `importState`.
- The theorem PROOFS.md states ("same outputs on every input") is false for them.

A one-line well-formedness check closes the gap, as shown below. Per the preregistration, the verdict changes only after the fix ships and the suite is rerun.

## Preregistered criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Every accepted rewrite passes **our** checker | **Holds.** I wrote `audit/indep-checker.js` from `ISA.md` and `PROOFS.md` alone, before reading GM-1's checker code. It agrees with GM-1's checker on **all 150 proposals** across the seed and 4 presets (verdict and rejection code), and on every rewrite in the held-out runs. |
| 2 | Our forged-certificate corpus is rejected 100% | **Fails (2 accepted).** The mutation corpus (`audit/forgeries.js`), 390 forgeries built from 9 real accepted certificates, is rejected 390/390 by both checkers. It covers wrong rule, location, witness and cost claim, changed replacement words, stale hash, bad magic, wrong component, truncation, a lying step count, and a wrong epoch target. But of 5 targeted soundness probes (`audit/soundness-probes.js`), **2 are accepted** and change behavior (finding 1). The other 3 are rejected correctly: dead load followed by `IN rd, rd`, store-forwarding at an out-of-range address, and a witness hidden behind a CALL. |
| 3 | A proven rewrite on ≥ 3 of 5 held-out solvers | **Holds: 3/5.** `audit/heldout/` has five programs I wrote after delivery: Fahrenheit→Celsius, seconds from h:m:s, a quadratic, a rolling checksum, double-and-clamp. Proven solver rewrites: h:m:s 316→296 (constant fold of 60·60), quadratic 656→584 (×2 strength reduction), double-and-clamp 585→459 (strength reduction plus store-to-load forwarding). Fahrenheit and checksum: no rewrite, correctly, since no rule applies. |
| 4 | A proven rewrite of the searcher by itself | **Holds.** The exam cost drops 29,917 → 29,879 (5 steps: ×1, +0, ÷1, two constant folds). See finding 2: the seed searcher opens with three identity operations, which looks planted. **With those three lines deleted** (`audit/no-planted-redundancy.js`), the machine still proves a self-rewrite: 29,885 → 29,873, by folding its own hash constants (100003·131). |
| 5 | Old and new agree on 10,000 random inputs | **Holds.** Every accepted solver rewrite: 10,000 random input vectors, 0 output mismatches, 0 inputs where the new program costs more. Every searcher self-rewrite: 150 solver jobs, 0 proposal mismatches, 0 cost increases. |

**Outcome rule:** "Broken: 1, 2 or 5 fails." Criterion 2 fails, so the result is **Broken** until fixed and rerun.

## Findings

1. **The rules ignore register validity** (severity: high for soundness, narrow in reach).
   - `ISA.md` doesn't say what happens when an instruction names a register outside r0–r15. The VM stops with `invalid_register`.
   - No rule's side condition requires valid register fields. So `SUB r5, r99, r99 → LDI r5, 0` (rule 4) and `LOAD r5, r99 → NOP` (rule 14) are "proven" even though the old program errors where the new one runs on.
   - Paired with a legitimate step that pays for the measured cost drop, both certificates pass both checkers. On the input that reaches the cold branch, the old program stops with no output and the new one emits a value.
   - The assembler rejects `r99`, but `Machine.setSolver(array)` and `importState` accept it.
   - **Fix:** the checker rejects any certificate whose active or replacement program has a register field outside 0..15 (`ill_formed_program`). `strictRegisters: true` in `audit/indep-checker.js` shows it: both probes are rejected, and the seed solver, all presets and the 774-instruction searcher are well-formed, so no genuine rewrite is lost. A load-time check in `setSolver`, `setSearcher` and `importState` would close it at the door too.
2. **The seed searcher starts with planted identities, and REPORT.md doesn't say so** (severity: honesty, medium). Lines 6–8 of the searcher are `MUL r0, r0, r14` (r14 = 1), `ADD r0, r0, r13` (r13 = 0) and `DIV r1, r1, r14`. No plain program contains these, and they're three of the five steps in the searcher's own self-rewrite. The spec said "if it never happens, report that plainly; don't force it". Mitigated: the self-rewrite still happens without them (criterion 4). The UI presets (`dot`, `norm`) also carry `÷1` and `−0`. The three Test 5 solvers in REPORT.md are genuinely plain and got 0 rewrites, which is reported honestly.
3. **Budgets and the stated theorem** (note). Equivalence is stated for every input, but runs are budgeted. Because a cheaper program never runs out of budget sooner, the only possible difference is that the new program finishes where the old one ran out. That is an improvement, not a soundness problem, but PROOFS.md should say it.
4. **Unused witness fields are free** (note). Rule 4 has no witness, so its `w1` can be any value and the certificate still checks. That's harmless, but certificates aren't canonical.
5. **Doc gaps I had to fill** (marked `DOC-GAP` in the independent checker):
   - the invalid-register behavior;
   - the unused fields of replacement instructions;
   - the searcher's second input word.

   Mine and GM-1's resolve them the same way, which is why the checkers agree.

## Also checked

- **No host-side search.** The JS host runs the VM and the checker. The VM has exactly the 23 documented opcodes, with no host helpers. Programs execute from the instruction array, not from memory, so the searcher can't modify its own running code. Proposals come only from the searcher's `OUT`.
- **Delivered suite:** 8/9 pass. Test 9 needs Selenium, which isn't here, and it reported FAIL rather than a fake pass. My Playwright run in headless Chromium: 0 page or console errors, 5 epochs plus the forgery button, screenshot in `audit/gm1-browser.png`.
- **The searcher saturates:** after one solver rewrite and one self-rewrite, every later epoch proposes nothing (`empty_proposal`). The rule set is small (14 local rules, no MOV-to-self or dead-code removal), so there's little left to find. That's a property of the instrument, and Argon didn't claim otherwise.

## Files

- `audit/indep-checker.js`: an independent VM and checker, from the docs alone (`strictRegisters` = the proposed fix).
- `audit/recheck.js`: every proposal, both checkers, compared.
- `audit/forgeries.js`: the 390-forgery mutation corpus.
- `audit/soundness-probes.js`: the targeted probes (2 of them fail, documenting finding 1).
- `audit/no-planted-redundancy.js`: criterion 4 without the planted lines.
- `audit/heldout/*.asm`, `audit/heldout.js`, `audit/heldout-results.json`: criteria 3 and 5.
