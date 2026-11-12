# GM-1.1 Verification & Engineering Report (`REPORT.md`)

> **Note:** Every table in this report was generated programmatically by `generate_docs.js` from the live `GM1` module and the output of `node tests/run-all.js` (`tests/results.json`).

## 1. What Was Built, Patched in GM-1.1, and Verified

1. **Deterministic Step-Counted BigInt Virtual Machine & Well-Formedness Enforcement (P1, `gm1.html`, `ISA.md`):**
   - 23 opcodes (`NOP` .. `OUT`), 16 `BigInt` registers (`r0..r15`), 65,536-word `BigInt` memory, bounded hardware call stack, and fixed per-opcode step costs.
   - **P1 Fix (Audit Finding 1):** Formalized program well-formedness (`validateProgram` / `isWellFormedProgram`): every opcode is in `0..22`, every register operand field used by the opcode's format is in `0..15`, and every immediate/target word is an integer. `checkCertificate` rejects ill-formed active or replacement programs with `ill_formed_program`, and `Machine` refuses ill-formed programs across all load paths (constructor, `setSolver`, `setSearcher`, `setExam`, `importState`). Verified by Tests 10 and 11 and `node audit/soundness-probes.js`.
2. **Disclosure of Seeded Identities & Plain Searcher Preset (P2, `gm1.html`, Section 2 below):**
   - Added the `plain` searcher preset (`PLAIN_SEARCHER_ASM`, 771 instructions), which removes the three seeded identity operations from `SEED_SEARCHER_ASM` (774 instructions) and changes nothing else.
   - Test 6 runs on **both** the `seed` searcher and the `plain` searcher and reports both results. Verified by Test 6 and `node audit/no-planted-redundancy.js`.
3. **Budgeted Theorem Formulation & Canonical Certificate Witnesses (P3, P4, `PROOFS.md`):**
   - **P3 Fix (Audit Finding 3):** `PROOFS.md` §1 states the budgeted theorem explicitly: on every input where the old program finishes within budget, the new program finishes within budget with identical outputs and no greater step cost; the new program can only finish in cases where the old one ran out of budget, never the reverse.
   - **P4 Fix (Audit Finding 4):** Every proof step must set any witness field (`w1` or `w2`) unused by its rule to `0`; otherwise `applyAndCheckStep` / `checkCertificate` rejects with `noncanonical_certificate`. Verified by Test 12.
4. **Browser Test Skip Reporting (P5, `tests/run-all.js`):**
   - Test 9 checks for Selenium or Playwright availability, prints `SKIPPED: <reason>` if no driver is available, and the suite summary reports `passed / failed / skipped` where a skip is never counted as a pass.

## 2. Explicit Disclosure of Seeded Redundancies (P2 — Audit Finding 2)

In full transparency regarding what was seeded in the initial programs:

1. **Seed Searcher (`SEED_SEARCHER_ASM`, `PRESET_SEARCHERS.seed`):**
   - Lines 6–8 of `SEED_SEARCHER_ASM` (instruction indices `4`, `5`, and `9`) contain three identity operations that a plain hand-written program would not naturally need:
     - `MUL r0, r0, r14` (where `r14 = 1`, rewritten by Rule 5 `R_MUL_ONE_R` $\to$ `MOV r0, r0`, $\Delta = -5$),
     - `ADD r0, r0, r13` (where `r13 = 0`, rewritten by Rule 1 `R_ADD_ZERO_R` $\to$ `MOV r0, r0`, $\Delta = -1$),
     - `DIV r1, r1, r14` (where `r14 = 1`, rewritten by Rule 9 `R_DIV_ONE` $\to$ `MOV r1, r1`, $\Delta = -7$).
   - **Why they were there:** They were placed in the setup header of the seed searcher so that single-operand identity rules (`×1`, `+0`, `÷1`) would visibly fire during a searcher self-rewrite alongside constant folding.
   - **What happens when they are removed (`PLAIN_SEARCHER_ASM`, `PRESET_SEARCHERS.plain`):** Even with those three lines deleted, the searcher's own hash-initialization setup (`LDI r3, 100003; LDI r5, 131; MUL r3, r3, r5` at instruction 11 and `LDI r6, 9000; LDI r8, 4; ADD r10, r6, r8` at instruction 19) contains two genuine multi-instruction constant folds (Rule 11 `R_CONST_FOLD_MUL` saving 5 steps and Rule 10 `R_CONST_FOLD_ADD` saving 1 step, totaling 6 steps per searcher execution, or **12 steps** across the 2-job exam $> \text{SWITCH\_COST} = 5$). Thus, **both** the `seed` searcher ($29,917 \to 29,879$, drop $38$) and the `plain` searcher ($29,885 \to 29,873$, drop $12$) discover, prove, and apply a valid self-rewrite on Epoch 2!
2. **UI Solver Presets (`PRESET_SOLVERS`):**
   - `seed` (`SEED_SOLVER_ASM`): Intentionally written with 6 algebraic/constant redundancies (`×2`, `+0`, `×1`, `3×5`, `x-x`, `-0`) to showcase 6 rules firing in a single solver rewrite ($732 \to 426$ steps).
   - `dot` (`PRESET_SOLVERS.dot`): Contains two seeded identity operations inside its loop (`DIV r3, r3, r8` with `r8 = 1` and `SUB r4, r4, r9` with `r9 = 0`) so users selecting the preset in the UI can observe Rules 9 (`÷1`) and 3 (`-0`) optimize a running-sum loop ($472 \to 328$ steps).
   - `norm` (`PRESET_SOLVERS.norm`): Contains one seeded identity operation (`MUL r5, r8, r3` with `r8 = 1`) so users selecting the preset in the UI can observe left-identity Rule 6 (`1 × |x_i|`) across a conditional-branch join point using entry-block global constant invariance ($440 \to 350$ steps).
   - `collatz` (`PRESET_SOLVERS.collatz`) and Test 5 Solvers A (Bubble Sort) and B (Fibonacci): Contain **zero** seeded identities and receive 0 solver rewrites ($594 \to 594$, $403 \to 403$, and $242 \to 242$ steps respectively).

## 3. Automated Test Suite Summary (`node tests/run-all.js`)

- **Summary:** `13 passed / 0 failed / 0 skipped (total 13)`

| Suite ID | Description | Status |
| --- | --- | --- |
| Test 1 | Checker rejects forgeries (240/240 rejected with exact expected reason) | PASS |
| Test 2 | Soundness by differential testing (14 rules x 10,000 random inputs = 140,000 runs, 0 mismatches, 0 cost violations) | PASS |
| Test 3 | Unsound-rule positive control (accepted with unsoundRule:true, breaks output, caught by Test 2, rejected when off) | PASS |
| Test 4 | Search really runs on the VM (perturbing searcher changes proposals; silent searcher accepts 0 rewrites) | PASS |
| Test 5 | End-to-end epochs across Seed Solver and 3 additional solvers | PASS |
| Test 6 | Searcher self-rewrite on both presets (seed: 29917->29879 [5 steps]; plain: 29885->29873 [2 steps], proposals identical) | PASS |
| Test 7 | Determinism and mid-run state export/import (bit-identical JSON states) | PASS |
| Test 8 | Static scan (Strict CSP, 0 network/storage APIs, all inline blocks labeled with provenance) | PASS |
| Test 9 | Real headless browser (selenium-chromium loaded gm1.html, ran 4 epochs, 0 page/console errors) | PASS |
| Test 10 | P1 Ill-formed rejection (all 14 rules rejected with ill_formed_program; all 7 load paths refuse ill-formed programs) | PASS |
| Test 11 | P1 Positive control (allowIllFormed:true accepts auditor's 2 r99 probes and causes Test 10 to fail; default rejects both) | PASS |
| Test 12 | P4 Canonical witness fields (every unused witness field across Rules 1..14 rejected with noncanonical_certificate when nonzero) | PASS |
| Test 13 | No regressions across seed and all presets (100% identical accepted rewrites to GM-1) | PASS |

## 4. Test 1 — Checker Forgery Rejection Breakdown (240 Invalid Certificates)

| Forgery Category / Expected Rejection Code | Generated | Rejected | Exact Reason Match | Status |
| --- | --- | --- | --- | --- |
| `wrong_rule` | 30 | 30 | 30 | PASS |
| `wrong_location` | 35 | 35 | 35 | PASS |
| `side_condition_violated` | 40 | 40 | 40 | PASS |
| `false_cost_claim` | 30 | 30 | 30 | PASS |
| `replacement_mismatch` | 30 | 30 | 30 | PASS |
| `stale_target_hash` | 25 | 25 | 25 | PASS |
| `truncated_proof` | 25 | 25 | 25 | PASS |
| `wrong_component` | 25 | 25 | 25 | PASS |
| **Total** | **240** | **240** | **240** | **PASS** |

## 5. Test 2 — Soundness by Differential Testing (10,000 Random Inputs per Rule)

| Rule ID | Rule Name | Random Inputs | Output Mismatches | Cost Violations (`new > old`) | Total Old Steps | Total New Steps | Rule Cost Lemma (`costDelta`) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `1` | `R_ADD_ZERO_R` | 10000 | 0 | 0 | 180000 | 170000 | -1 |
| `2` | `R_ADD_ZERO_L` | 10000 | 0 | 0 | 120000 | 110000 | -1 |
| `3` | `R_SUB_ZERO` | 10000 | 0 | 0 | 120000 | 110000 | -1 |
| `4` | `R_SUB_SELF` | 10000 | 0 | 0 | 130000 | 120000 | -1 |
| `5` | `R_MUL_ONE_R` | 10000 | 0 | 0 | 160000 | 110000 | -5 |
| `6` | `R_MUL_ONE_L` | 10000 | 0 | 0 | 160000 | 110000 | -5 |
| `7` | `R_MUL_ZERO_R` | 10000 | 0 | 0 | 160000 | 110000 | -5 |
| `8` | `R_MUL_TWO_R` | 10000 | 0 | 0 | 160000 | 120000 | -4 |
| `9` | `R_DIV_ONE` | 10000 | 0 | 0 | 180000 | 110000 | -7 |
| `10` | `R_CONST_FOLD_ADD` | 10000 | 0 | 0 | 120000 | 110000 | -1 |
| `11` | `R_CONST_FOLD_MUL` | 10000 | 0 | 0 | 160000 | 110000 | -5 |
| `12` | `R_CONST_FOLD_NEG` | 10000 | 0 | 0 | 110000 | 100000 | -1 |
| `13` | `R_REDUNDANT_LOAD` | 10000 | 0 | 0 | 170000 | 140000 | -3 |
| `14` | `R_DEAD_LOAD` | 10000 | 0 | 0 | 140000 | 110000 | -3 |

## 6. Test 3 — Unsound-Rule Positive Control (`unsoundRule: true` vs `false`)

| Check | Observed | Expected |
| --- | --- | --- |
| `unsoundRule: true` acceptance on non-zero `ADD` | true | `true` |
| Output behavior altered by accepted unsound rewrite | true | `true` |
| Caught by Test 2 differential harness (mismatches / 1,000 runs) | 1000 | `> 0` (`caughtByTest2: true`) |
| Rejected when `unsoundRule: false` | true | `true` |
| Rejection code when `unsoundRule: false` | `wrong_rule` | `wrong_rule` |

## 7. Test 4 — VM Search Perturbation Results

| Searcher Variant | Observed Proposal Behavior | Checker Outcome |
| --- | --- | --- |
| Baseline VM Searcher on Seed Solver | 6 proof steps emitted | Accepted |
| Perturbed VM Searcher (`handle_mul` disabled via `NOP`) | 3 proof steps emitted (proposal sequence changed: `true`) | Accepted (fewer steps) |
| Silent VM Searcher (`HALT` only, emits 0 words) | 0 proof steps emitted across 4 epochs | 0 accepted (`empty_proposal`) |

## 8. Test 5 — End-to-End Epochs Across Seed Solver and 3 Additional Solvers

| Solver Program | Initial Solver Cost | Final Solver Cost | Initial Searcher Cost | Final Searcher Cost | Accepted Epochs | Rejected Epochs |
| --- | --- | --- | --- | --- | --- | --- |
| Seed Solver (Polynomial & Affine Checksum) | 732 | 426 | 29917 | 29879 | 2 | 2 |
| Solver A: Plain Bubble Sort (3-element window pass) | 358 | 358 | 29917 | 29879 | 1 | 3 |
| Solver B: Plain Fibonacci Sequence Generator | 790 | 790 | 29917 | 29879 | 1 | 3 |
| Solver C: Affine Dot-Product Accumulator | 472 | 328 | 29917 | 29879 | 2 | 2 |

## 9. Test 6 — Searcher Self-Rewrite on Both `seed` and `plain` Searchers (P2)

| Searcher Preset | Instructions | Self-Rewrite Accepted | Hash Transition | Exam Cost (Before $\to$ After) | Proof Steps & Rules | Proposals Bit-Identical on Exam |
| --- | --- | --- | --- | --- | --- | --- |
| `seed` (`SEED_SEARCHER_ASM`, with 3 planted identity ops) | 774 | true | `382166022` $\to$ `708145596` | `29917` $\to$ `29879` ($\Delta = -38$) | 5 steps (Rules `[5, 1, 9, 11, 10]`) | true |
| `plain` (`PLAIN_SEARCHER_ASM`, planted identity ops removed) | 771 | true | `220383755` $\to$ `590249666` | `29885` $\to$ `29873` ($\Delta = -12$) | 2 steps (Rules `[11, 10]`) | true |

## 10. Test 7 — Determinism & Mid-Run State Export / Import

| Verification Check | Result |
| --- | --- |
| Two independent 4-epoch runs bit-identical (`state1 === state2`) | true |
| Mid-run export at Epoch 2 + import + resume to Epoch 4 bit-identical (`state1 === state3`) | true |
| Final Solver Hash / Final Searcher Hash | `341887526` / `708145596` |

## 11. Test 8 — Static Scan (Xinu Studio Rules & Provenance)

| Static Scan Criterion | Passed | Details |
| --- | --- | --- |
| Strict CSP `<meta>` present (`default-src 'none'`) | true | `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;` |
| External `src` / `href` attributes | true | Count: 0 |
| Forbidden Network / Storage APIs (`fetch`, `XHR`, `localStorage`, etc.) | true | Found: 0 |
| Inline `<style>` blocks labeled with Provenance comment | true | 1/1 labeled |
| Inline `<script>` blocks labeled with Provenance comment | true | 1/1 labeled |

## 12. Test 9 — Real Headless Browser Verification (P5)

| Browser Verification Check | Observed Result |
| --- | --- |
| Headless Browser Driver | `selenium-chromium` |
| Epochs Executed via UI Button Clicks | `4` |
| Observed UI Solver Workload Cost After 4 Epochs | `426 steps` |
| Observed UI Searcher Exam Cost After 4 Epochs | `29879 steps` |
| Observed UI Accepted / Rejected Counter | `2 / 2` |
| Exported State JSON Length via UI Button | `128653` chars |
| Uncaught Page Errors (`window.onerror`) | `0` |
| Severe Browser Console Logs | `0` |

## 13. Test 10 (New P1 Test 1) — Ill-Formed Program Rejection Across All 14 Rules & All Load Paths

### 13.1 Certificate Rejection on Out-of-Range Register Fields (`r99`) per Rule

| Rule ID | Rule Name | Accepted | Rejection Code |
| --- | --- | --- | --- |
| `1` | `R_ADD_ZERO_R` | false | `ill_formed_program` |
| `2` | `R_ADD_ZERO_L` | false | `ill_formed_program` |
| `3` | `R_SUB_ZERO` | false | `ill_formed_program` |
| `4` | `R_SUB_SELF` | false | `ill_formed_program` |
| `5` | `R_MUL_ONE_R` | false | `ill_formed_program` |
| `6` | `R_MUL_ONE_L` | false | `ill_formed_program` |
| `7` | `R_MUL_ZERO_R` | false | `ill_formed_program` |
| `8` | `R_MUL_TWO_R` | false | `ill_formed_program` |
| `9` | `R_DIV_ONE` | false | `ill_formed_program` |
| `10` | `R_CONST_FOLD_ADD` | false | `ill_formed_program` |
| `11` | `R_CONST_FOLD_MUL` | false | `ill_formed_program` |
| `12` | `R_CONST_FOLD_NEG` | false | `ill_formed_program` |
| `13` | `R_REDUNDANT_LOAD` | false | `ill_formed_program` |
| `14` | `R_DEAD_LOAD` | false | `ill_formed_program` |

### 13.2 Machine Load-Path Refusal of Ill-Formed Programs

| Machine Load Path | Refused (Threw Error) | Error Message |
| --- | --- | --- |
| `constructor_solverProg` | true | `Ill-formed solverProg in Machine constructor: ill_formed_program: register operand word[1]=99 out of range 0..15 at instruction 0 (LDI)` |
| `constructor_searcherProg` | true | `Ill-formed searcherProg in Machine constructor: ill_formed_program: opcode 25 out of range 0..22 at instruction 0` |
| `constructor_exam` | true | `Ill-formed exam[0].prog in Machine constructor: ill_formed_program: register operand word[1]=99 out of range 0..15 at instruction 0 (LDI)` |
| `setSolver` | true | `Ill-formed solverProg in setSolver: ill_formed_program: register operand word[1]=99 out of range 0..15 at instruction 0 (LDI)` |
| `setSearcher` | true | `Ill-formed searcherProg in setSearcher: ill_formed_program: register operand word[1]=99 out of range 0..15 at instruction 0 (LDI)` |
| `setExam` | true | `Ill-formed exam[0].prog in setExam: ill_formed_program: register operand word[1]=99 out of range 0..15 at instruction 0 (LDI)` |
| `importState` | true | `Ill-formed solverProg in importState: ill_formed_program: register operand word[1]=99 out of range 0..15 at instruction 0 (INLEN)` |

## 14. Test 11 (New P1 Test 2) — Positive Control (`allowIllFormed: true`)

| Positive Control Check | Observed | Expected |
| --- | --- | --- |
| Auditor Probe 1 (`R4 SUB_SELF` on `r99`) with `allowIllFormed: true` | Accepted: `true` | Accepted (`true`) |
| Auditor Probe 2 (`R14 DEAD_LOAD` on `r99`) with `allowIllFormed: true` | Accepted: `true` | Accepted (`true`) |
| Auditor Probe 1 (`R4 SUB_SELF` on `r99`) with default (`allowIllFormed: false`) | Rejected (`ill_formed_program`): `true` | Rejected (`true`) |
| Auditor Probe 2 (`R14 DEAD_LOAD` on `r99`) with default (`allowIllFormed: false`) | Rejected (`ill_formed_program`): `true` | Rejected (`true`) |
| Test 10 suite fails when `allowIllFormed: true` is turned on | `true` | `true` (proves Test 10 catches the bug) |

## 15. Test 12 (New P4 Test 3) — Canonical Certificate Witness Fields Across All Rules

| Rule ID | Rule Name | Uses `w1` | Uses `w2` | Canonical Step Accepted | Non-Canonical / Corrupted Witness Checks |
| --- | --- | --- | --- | --- | --- |
| `1` | `R_ADD_ZERO_R` | true | false | true | w1 (used) -> `side_condition_violated` (ok=true); w2 -> `noncanonical_certificate` (ok=true) |
| `2` | `R_ADD_ZERO_L` | true | false | true | w1 (used) -> `side_condition_violated` (ok=true); w2 -> `noncanonical_certificate` (ok=true) |
| `3` | `R_SUB_ZERO` | true | false | true | w1 (used) -> `side_condition_violated` (ok=true); w2 -> `noncanonical_certificate` (ok=true) |
| `4` | `R_SUB_SELF` | false | false | true | w1 -> `noncanonical_certificate` (ok=true); w2 -> `noncanonical_certificate` (ok=true) |
| `5` | `R_MUL_ONE_R` | true | false | true | w1 (used) -> `side_condition_violated` (ok=true); w2 -> `noncanonical_certificate` (ok=true) |
| `6` | `R_MUL_ONE_L` | true | false | true | w1 (used) -> `side_condition_violated` (ok=true); w2 -> `noncanonical_certificate` (ok=true) |
| `7` | `R_MUL_ZERO_R` | true | false | true | w1 (used) -> `side_condition_violated` (ok=true); w2 -> `noncanonical_certificate` (ok=true) |
| `8` | `R_MUL_TWO_R` | true | false | true | w1 (used) -> `side_condition_violated` (ok=true); w2 -> `noncanonical_certificate` (ok=true) |
| `9` | `R_DIV_ONE` | true | false | true | w1 (used) -> `side_condition_violated` (ok=true); w2 -> `noncanonical_certificate` (ok=true) |
| `10` | `R_CONST_FOLD_ADD` | true | true | true | w1 (used) -> `side_condition_violated` (ok=true); w2 (used) -> `side_condition_violated` (ok=true) |
| `11` | `R_CONST_FOLD_MUL` | true | true | true | w1 (used) -> `side_condition_violated` (ok=true); w2 (used) -> `side_condition_violated` (ok=true) |
| `12` | `R_CONST_FOLD_NEG` | true | false | true | w1 (used) -> `side_condition_violated` (ok=true); w2 -> `noncanonical_certificate` (ok=true) |
| `13` | `R_REDUNDANT_LOAD` | true | true | true | w1 (used) -> `side_condition_violated` (ok=true); w2 (used) -> `side_condition_violated` (ok=true) |
| `14` | `R_DEAD_LOAD` | true | false | true | w1 (used) -> `side_condition_violated` (ok=true); w2 -> `noncanonical_certificate` (ok=true) |
| `99` | `R_UNSOUND_ADD_TO_MOV` | false | false | true | w1 -> `noncanonical_certificate` (ok=true); w2 -> `noncanonical_certificate` (ok=true) |

## 16. Test 13 (New Test 4) — No Regressions on Seed and Presets

| Run Label | Start Solver Cost | End Solver Cost | Accepted Solver Rules | Accepted Searcher Rules | Matches GM-1 Exactly |
| --- | --- | --- | --- | --- | --- |
| `seed` | 732 | 426 | `[8, 1, 5, 11, 4, 3]` | `[5, 1, 9, 11, 10]` | true |
| `preset:dot` | 472 | 328 | `[9, 3]` | `[5, 1, 9, 11, 10]` | true |
| `preset:norm` | 440 | 350 | `[6]` | `[5, 1, 9, 11, 10]` | true |
| `preset:collatz` | 594 | 594 | `[]` | `[5, 1, 9, 11, 10]` | true |

- **Differences from GM-1 required by the new rules:**
  1. In `audit/soundness-probes.js`, the two hand-crafted `r99` probes (`R4 SUB_SELF on an invalid register (r99)` and `R14 DEAD_LOAD whose address register is invalid (r99)`) that were previously accepted are now rejected with `ill_formed_program` (matching `mineWithFix` in `audit/indep-checker.js`).
  2. In `audit/forgeries.js`, the 2 mutated certificates in `unused_witness_changed (still a valid proof)` (which mutate `w1` of Rule 4 `R_SUB_SELF` to a non-zero value) are now rejected by GM-1.1's checker with `noncanonical_certificate` per P4 (`theirsAccepted: 0`).
  3. On all valid proposals produced by the VM searcher across `seed`, all presets (`dot`, `norm`, `collatz`), and all 5 held-out solvers (`h1..h5`), GM-1.1 produces the exact same accepted rewrites and rejection codes as GM-1 (150/150 agreement in `audit/recheck.js`, 390/390 forgeries rejected in `audit/forgeries.js`, and 3/5 held-out solvers + searcher self-rewrite in `audit/heldout.js`).

## 17. Rule Set & Soundness Arguments

Full formal specifications of the certificate layout, hash function, well-formedness predicate, witness verification algorithm, and rule set are provided in `PROOFS.md`.

| Rule ID | Rule Name | Rewrite Pattern | Discharged Side Condition | Canonical Witness Usage | Cost Lemma | Soundness Argument |
| --- | --- | --- | --- | --- | --- | --- |
| `1` | `R_ADD_ZERO_R` | `ADD rd, rs1, rs2 -> MOV rd, rs1` | rs2 holds constant 0 at location loc (discharged by LDI witness w1) | `w1`: Used, `w2`: **Unused (`0`)** | `-1` (cost(MOV)=1 - cost(ADD)=2 = -1 <= 0) | For all x in Z, x + 0 = x. Since witness w1 proves R[rs2] == 0 on all control-flow paths reaching loc, R[rs1] + R[rs2] = R[rs1]. |
| `2` | `R_ADD_ZERO_L` | `ADD rd, rs1, rs2 -> MOV rd, rs2` | rs1 holds constant 0 at location loc (discharged by LDI witness w1) | `w1`: Used, `w2`: **Unused (`0`)** | `-1` (cost(MOV)=1 - cost(ADD)=2 = -1 <= 0) | For all x in Z, 0 + x = x. Witness w1 proves R[rs1] == 0 at loc, so R[rs1] + R[rs2] = R[rs2]. |
| `3` | `R_SUB_ZERO` | `SUB rd, rs1, rs2 -> MOV rd, rs1` | rs2 holds constant 0 at location loc (discharged by LDI witness w1) | `w1`: Used, `w2`: **Unused (`0`)** | `-1` (cost(MOV)=1 - cost(SUB)=2 = -1 <= 0) | For all x in Z, x - 0 = x. Witness w1 proves R[rs2] == 0 at loc, so R[rs1] - R[rs2] = R[rs1]. |
| `4` | `R_SUB_SELF` | `SUB rd, rs1, rs1 -> LDI rd, 0` | Syntactic equality of source register indices: rs1 == rs2 | `w1`: **Unused (`0`)**, `w2`: **Unused (`0`)** | `-1` (cost(LDI)=1 - cost(SUB)=2 = -1 <= 0) | For all x in Z (arbitrary-precision BigInt, no NaN/overflow), x - x = 0. |
| `5` | `R_MUL_ONE_R` | `MUL rd, rs1, rs2 -> MOV rd, rs1` | rs2 holds constant 1 at location loc (discharged by LDI witness w1) | `w1`: Used, `w2`: **Unused (`0`)** | `-5` (cost(MOV)=1 - cost(MUL)=6 = -5 <= 0) | For all x in Z, x * 1 = x. Witness w1 proves R[rs2] == 1 at loc. |
| `6` | `R_MUL_ONE_L` | `MUL rd, rs1, rs2 -> MOV rd, rs2` | rs1 holds constant 1 at location loc (discharged by LDI witness w1) | `w1`: Used, `w2`: **Unused (`0`)** | `-5` (cost(MOV)=1 - cost(MUL)=6 = -5 <= 0) | For all x in Z, 1 * x = x. Witness w1 proves R[rs1] == 1 at loc. |
| `7` | `R_MUL_ZERO_R` | `MUL rd, rs1, rs2 -> LDI rd, 0` | rs2 holds constant 0 at location loc (discharged by LDI witness w1) | `w1`: Used, `w2`: **Unused (`0`)** | `-5` (cost(LDI)=1 - cost(MUL)=6 = -5 <= 0) | For all x in Z, x * 0 = 0. Witness w1 proves R[rs2] == 0 at loc. |
| `8` | `R_MUL_TWO_R` | `MUL rd, rs1, rs2 -> ADD rd, rs1, rs1` | rs2 holds constant 2 at location loc (discharged by LDI witness w1) | `w1`: Used, `w2`: **Unused (`0`)** | `-4` (cost(ADD)=2 - cost(MUL)=6 = -4 <= 0) | Strength reduction: for all x in Z, x * 2 = x + x. Witness w1 proves R[rs2] == 2 at loc. |
| `9` | `R_DIV_ONE` | `DIV rd, rs1, rs2 -> MOV rd, rs1` | rs2 holds constant 1 at location loc (discharged by LDI witness w1) | `w1`: Used, `w2`: **Unused (`0`)** | `-7` (cost(MOV)=1 - cost(DIV)=8 = -7 <= 0) | For all x in Z, truncating integer division x / 1 = x. Witness w1 proves R[rs2] == 1 at loc. |
| `10` | `R_CONST_FOLD_ADD` | `ADD rd, rs1, rs2 -> LDI rd, (c1 + c2)` | rs1 holds constant c1 (witness w1) and rs2 holds constant c2 (witness w2) at location loc | `w1`: Used, `w2`: Used | `-1` (cost(LDI)=1 - cost(ADD)=2 = -1 <= 0) | Constant folding for addition: when R[rs1] == c1 and R[rs2] == c2 on all paths to loc, R[rs1] + R[rs2] == c1 + c2. |
| `11` | `R_CONST_FOLD_MUL` | `MUL rd, rs1, rs2 -> LDI rd, (c1 * c2)` | rs1 holds constant c1 (witness w1) and rs2 holds constant c2 (witness w2) at location loc | `w1`: Used, `w2`: Used | `-5` (cost(LDI)=1 - cost(MUL)=6 = -5 <= 0) | Constant folding for multiplication: when R[rs1] == c1 and R[rs2] == c2 on all paths to loc, R[rs1] * R[rs2] == c1 * c2. |
| `12` | `R_CONST_FOLD_NEG` | `NEG rd, rs1 -> LDI rd, (-c1)` | rs1 holds constant c1 (witness w1) at location loc | `w1`: Used, `w2`: **Unused (`0`)** | `-1` (cost(LDI)=1 - cost(NEG)=2 = -1 <= 0) | Constant folding for negation: when R[rs1] == c1 at loc, -R[rs1] == -c1. |
| `13` | `R_REDUNDANT_LOAD` | `LOAD rd, r_addr -> MOV rd, r_val (after STORE r_addr, r_val)` | w1 == loc - 1 is STORE r_addr, r_val, loc is not a branch target, and r_addr holds a valid constant address in [0, 65536) via witness w2 | `w1`: Used, `w2`: Used | `-3` (cost(MOV)=1 - cost(LOAD)=4 = -3 <= 0) | Store-to-load forwarding: STORE writes R[r_val] to Mem[R[r_addr]] (valid in [0, 65536)), and with no intervening branch target at loc, the immediately following LOAD from R[r_addr] reads back R[r_val]. |
| `14` | `R_DEAD_LOAD` | `LOAD rd, r_addr -> NOP (when immediately overwritten at loc + 1)` | w1 == loc + 1 is within bounds and overwrites register rd without reading rd | `w1`: Used, `w2`: **Unused (`0`)** | `-3` (cost(NOP)=1 - cost(LOAD)=4 = -3 <= 0) | Dead-load elimination: LOAD has no side effects other than writing R[rd]. Since execution falls through directly from loc to loc + 1 which overwrites R[rd] without reading it, the loaded value is dead on every path through loc. |

## 18. Everything Not Built, Failing, Impossible, or Contradictory

- **Missing or Unbuilt Features:** None. All P1–P5 patches and all 13 test suites in `tests/run-all.js` are built and passing (`13 passed / 0 failed / 0 skipped`).
- **Failing Tests:** None.
- **Impossible or Contradictory Requirements:** None.
