# GM-1 Verification & Engineering Report (`REPORT.md`)

> **Note:** Every table in this report was generated programmatically by `generate_docs.js` from the live `GM1` module and the output of `node tests/run-all.js` (`tests/results.json`).

## 1. What Was Built & How Each Part Was Verified

1. **Deterministic Step-Counted BigInt Virtual Machine (`gm1.html`, documented in `ISA.md`):**
   - 23 opcodes (`NOP`, `HALT`, `LDI`, `MOV`, `ADD`, `SUB`, `MUL`, `DIV`, `MOD`, `NEG`, `CMPEQ`, `CMPLT`, `CMPLE`, `JMP`, `JZ`, `JNZ`, `CALL`, `RET`, `LOAD`, `STORE`, `INLEN`, `IN`, `OUT`), 16 `BigInt` registers (`r0..r15`), 65,536-word `BigInt` memory, bounded hardware call stack, and fixed per-opcode step costs.
   - Programs reside as 4-word tuples `[op, a, b, c]` in VM data memory (`1000` for Solver, `5000` for Searcher) so the Searcher reads both programs as ordinary data.
   - Verified by Tests 1–9 in `tests/run-all.js`.
2. **Seed Solver, Additional Solvers & VM-Resident Searcher (`gm1.html`):**
   - The Seed Solver evaluates a polynomial/affine expression over an input vector. Three additional non-tuned solvers (3-element window Bubble Sort pass, Fibonacci sequence generator, and Running Prefix Accumulator) are tested in Test 5.
   - The Searcher is a 561-instruction GM-1 VM assembly program that computes the target's rolling hash, identifies entry-block single-assignment global constants and local basic-block constants, searches for sound cost-reducing rewrites across Rules 1–14, constructs the replacement program in VM memory, and emits the flat certificate word stream via `OUT`.
   - Verified by Test 4 (VM perturbation), Test 5 (end-to-end epochs), and Test 6 (Searcher self-rewrite).
3. **Formal Proof System & Fixed Checker (`gm1.html`, documented in `PROOFS.md`):**
   - 14 sound program-equivalence rules (`R_ADD_ZERO_R` through `R_DEAD_LOAD`), each with a per-execution cost lemma $\Delta < 0$ on every path and machine-checked side conditions (`verifyConstantAt` supporting both local basic-block dominance and entry-block global single-assignment invariance).
   - The checker trusts nothing asserted by the Searcher: it recomputes program hashes, verifies each rule match and witness side condition, checks that the proof steps derive the exact replacement program word-for-word, and measures workload/exam cost drop against `SWITCH_COST = 5n`.
   - Verified by Test 1 (240 programmatic forgeries), Test 2 (140,000 random differential runs), and Test 3 (unsound rule positive control).
4. **Single-Page Offline UI & Headless Node Export (`gm1.html`):**
   - Self-contained HTML file with strict CSP, zero external dependencies, disassembly views for both programs, live certificate & proof-step inspector, checker verdict log with rejection codes, append-only lineage table marking searcher self-rewrites, SVG cost curves, solver/workload/exam replacement controls, and deterministic state export/import.
   - Verified by Test 7 (determinism & mid-run state export/import), Test 8 (static scan), and Test 9 (headless Chromium execution).

## 2. Automated Test Suite Summary (`node tests/run-all.js`)

| Suite ID | Description | Status |
| --- | --- | --- |
| Test 1 | Checker rejects forgeries (240/240 rejected with exact expected reason) | PASS |
| Test 2 | Soundness by differential testing (14 rules x 10,000 random inputs = 140,000 runs, 0 mismatches, 0 cost violations) | PASS |
| Test 3 | Unsound-rule positive control (accepted with unsoundRule:true, breaks output, caught by Test 2, rejected when off) | PASS |
| Test 4 | Search really runs on the VM (perturbing searcher changes proposals; silent searcher accepts 0 rewrites) | PASS |
| Test 5 | End-to-end epochs across Seed Solver and 3 additional solvers | PASS |
| Test 6 | Searcher self-rewrite replay (exam cost 29917 -> 29879, proposals bit-identical) | PASS |
| Test 7 | Determinism and mid-run state export/import (bit-identical JSON states) | PASS |
| Test 8 | Static scan (Strict CSP, 0 network/storage APIs, all inline blocks labeled with provenance) | PASS |
| Test 9 | Real headless browser (Chromium loaded gm1.html, ran 4 epochs, 0 page/console errors) | PASS |

## 3. Test 1 — Checker Forgery Rejection Breakdown (240 Invalid Certificates)

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

## 4. Test 2 — Soundness by Differential Testing (10,000 Random Inputs per Rule)

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

## 5. Test 3 — Unsound-Rule Positive Control (`unsoundRule: true` vs `false`)

| Check | Observed | Expected |
| --- | --- | --- |
| `unsoundRule: true` acceptance on non-zero `ADD` | true | `true` |
| Output behavior altered by accepted unsound rewrite | true | `true` |
| Caught by Test 2 differential harness (mismatches / 1,000 runs) | 1000 | `> 0` (`caughtByTest2: true`) |
| Rejected when `unsoundRule: false` | true | `true` |
| Rejection code when `unsoundRule: false` | `wrong_rule` | `wrong_rule` |

## 6. Test 4 — VM Search Perturbation Results

| Searcher Variant | Observed Proposal Behavior | Checker Outcome |
| --- | --- | --- |
| Baseline VM Searcher on Seed Solver | 6 proof steps emitted | Accepted |
| Perturbed VM Searcher (`handle_mul` disabled via `NOP`) | 3 proof steps emitted (proposal sequence changed: `true`) | Accepted (fewer steps) |
| Silent VM Searcher (`HALT` only, emits 0 words) | 0 proof steps emitted across 4 epochs | 0 accepted (`empty_proposal`) |

## 7. Test 5 — End-to-End Epochs Across Seed Solver and 3 Additional Solvers

| Solver Program | Initial Solver Cost | Final Solver Cost | Initial Searcher Cost | Final Searcher Cost | Accepted Epochs | Rejected Epochs |
| --- | --- | --- | --- | --- | --- | --- |
| Seed Solver (Polynomial & Affine Checksum) | 732 | 426 | 29917 | 29879 | 2 | 2 |
| Solver A: Plain Bubble Sort (3-element window pass) | 358 | 358 | 29917 | 29879 | 1 | 3 |
| Solver B: Plain Fibonacci Sequence Generator | 790 | 790 | 29917 | 29879 | 1 | 3 |
| Solver C: Affine Dot-Product Accumulator | 472 | 328 | 29917 | 29879 | 2 | 2 |

## 8. Test 6 — Searcher Self-Rewrite Verification & Replay

| Metric | Observed Value |
| --- | --- |
| Self-rewrite accepted during run | true |
| Old Searcher Hash $\to$ New Searcher Hash | `382166022` $\to$ `708145596` |
| Searcher Exam Cost Before $\to$ After | `29917` $\to$ `29879` steps |
| Measured Exam Cost Drop vs. Switch Cost | `38` steps drop (Switch Cost = `5` steps) |
| Proof Steps in Self-Rewrite Certificate | `5` steps |
| Proposals on Exam Bit-Identical Before and After | true |

## 9. Test 7 — Determinism & Mid-Run State Export / Import

| Verification Check | Result |
| --- | --- |
| Two independent 4-epoch runs bit-identical (`state1 === state2`) | true |
| Mid-run export at Epoch 2 + import + resume to Epoch 4 bit-identical (`state1 === state3`) | true |
| Final Solver Hash / Final Searcher Hash | `341887526` / `708145596` |

## 10. Test 8 — Static Scan (Xinu Studio Rules & Provenance)

| Static Scan Criterion | Passed | Details |
| --- | --- | --- |
| Strict CSP `<meta>` present (`default-src 'none'`) | true | `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;` |
| External `src` / `href` attributes | true | Count: 0 |
| Forbidden Network / Storage APIs (`fetch`, `XHR`, `localStorage`, etc.) | true | Found: 0 |
| Inline `<style>` blocks labeled with Provenance comment | true | 1/1 labeled |
| Inline `<script>` blocks labeled with Provenance comment | true | 1/1 labeled |

## 11. Test 9 — Real Headless Browser Verification (Chromium + Selenium)

| Browser Verification Check | Observed Result |
| --- | --- |
| Headless Browser Engine | Chromium via Selenium WebDriver (`--headless=new`) |
| Epochs Executed via UI Button Clicks | `4` |
| Observed UI Solver Workload Cost After 4 Epochs | `426 steps` |
| Observed UI Searcher Exam Cost After 4 Epochs | `29879 steps` |
| Observed UI Accepted / Rejected Counter | `2 / 2` |
| Exported State JSON Length via UI Button | `128624` chars |
| Uncaught Page Errors (`window.onerror`) | `0` |
| Severe Browser Console Logs | `0` |

## 12. Rule Set & Soundness Arguments

Full formal specifications of the certificate layout, hash function, witness verification algorithm, and rule set are provided in `PROOFS.md`. Below is the summary table of all 14 sound rules:

| Rule ID | Rule Name | Rewrite Pattern | Discharged Side Condition | Cost Lemma | Soundness Argument |
| --- | --- | --- | --- | --- | --- |
| `1` | `R_ADD_ZERO_R` | `ADD rd, rs1, rs2 -> MOV rd, rs1` | rs2 holds constant 0 at location loc (discharged by LDI witness w1) | `-1` (cost(MOV)=1 - cost(ADD)=2 = -1 <= 0) | For all x in Z, x + 0 = x. Since witness w1 proves R[rs2] == 0 on all control-flow paths reaching loc, R[rs1] + R[rs2] = R[rs1]. |
| `2` | `R_ADD_ZERO_L` | `ADD rd, rs1, rs2 -> MOV rd, rs2` | rs1 holds constant 0 at location loc (discharged by LDI witness w1) | `-1` (cost(MOV)=1 - cost(ADD)=2 = -1 <= 0) | For all x in Z, 0 + x = x. Witness w1 proves R[rs1] == 0 at loc, so R[rs1] + R[rs2] = R[rs2]. |
| `3` | `R_SUB_ZERO` | `SUB rd, rs1, rs2 -> MOV rd, rs1` | rs2 holds constant 0 at location loc (discharged by LDI witness w1) | `-1` (cost(MOV)=1 - cost(SUB)=2 = -1 <= 0) | For all x in Z, x - 0 = x. Witness w1 proves R[rs2] == 0 at loc, so R[rs1] - R[rs2] = R[rs1]. |
| `4` | `R_SUB_SELF` | `SUB rd, rs1, rs1 -> LDI rd, 0` | Syntactic equality of source register indices: rs1 == rs2 | `-1` (cost(LDI)=1 - cost(SUB)=2 = -1 <= 0) | For all x in Z (arbitrary-precision BigInt, no NaN/overflow), x - x = 0. |
| `5` | `R_MUL_ONE_R` | `MUL rd, rs1, rs2 -> MOV rd, rs1` | rs2 holds constant 1 at location loc (discharged by LDI witness w1) | `-5` (cost(MOV)=1 - cost(MUL)=6 = -5 <= 0) | For all x in Z, x * 1 = x. Witness w1 proves R[rs2] == 1 at loc. |
| `6` | `R_MUL_ONE_L` | `MUL rd, rs1, rs2 -> MOV rd, rs2` | rs1 holds constant 1 at location loc (discharged by LDI witness w1) | `-5` (cost(MOV)=1 - cost(MUL)=6 = -5 <= 0) | For all x in Z, 1 * x = x. Witness w1 proves R[rs1] == 1 at loc. |
| `7` | `R_MUL_ZERO_R` | `MUL rd, rs1, rs2 -> LDI rd, 0` | rs2 holds constant 0 at location loc (discharged by LDI witness w1) | `-5` (cost(LDI)=1 - cost(MUL)=6 = -5 <= 0) | For all x in Z, x * 0 = 0. Witness w1 proves R[rs2] == 0 at loc. |
| `8` | `R_MUL_TWO_R` | `MUL rd, rs1, rs2 -> ADD rd, rs1, rs1` | rs2 holds constant 2 at location loc (discharged by LDI witness w1) | `-4` (cost(ADD)=2 - cost(MUL)=6 = -4 <= 0) | Strength reduction: for all x in Z, x * 2 = x + x. Witness w1 proves R[rs2] == 2 at loc. |
| `9` | `R_DIV_ONE` | `DIV rd, rs1, rs2 -> MOV rd, rs1` | rs2 holds constant 1 at location loc (discharged by LDI witness w1) | `-7` (cost(MOV)=1 - cost(DIV)=8 = -7 <= 0) | For all x in Z, truncating integer division x / 1 = x. Witness w1 proves R[rs2] == 1 at loc. |
| `10` | `R_CONST_FOLD_ADD` | `ADD rd, rs1, rs2 -> LDI rd, (c1 + c2)` | rs1 holds constant c1 (witness w1) and rs2 holds constant c2 (witness w2) at location loc | `-1` (cost(LDI)=1 - cost(ADD)=2 = -1 <= 0) | Constant folding for addition: when R[rs1] == c1 and R[rs2] == c2 on all paths to loc, R[rs1] + R[rs2] == c1 + c2. |
| `11` | `R_CONST_FOLD_MUL` | `MUL rd, rs1, rs2 -> LDI rd, (c1 * c2)` | rs1 holds constant c1 (witness w1) and rs2 holds constant c2 (witness w2) at location loc | `-5` (cost(LDI)=1 - cost(MUL)=6 = -5 <= 0) | Constant folding for multiplication: when R[rs1] == c1 and R[rs2] == c2 on all paths to loc, R[rs1] * R[rs2] == c1 * c2. |
| `12` | `R_CONST_FOLD_NEG` | `NEG rd, rs1 -> LDI rd, (-c1)` | rs1 holds constant c1 (witness w1) at location loc | `-1` (cost(LDI)=1 - cost(NEG)=2 = -1 <= 0) | Constant folding for negation: when R[rs1] == c1 at loc, -R[rs1] == -c1. |
| `13` | `R_REDUNDANT_LOAD` | `LOAD rd, r_addr -> MOV rd, r_val (after STORE r_addr, r_val)` | w1 == loc - 1 is STORE r_addr, r_val, loc is not a branch target, and r_addr holds a valid constant address in [0, 65536) via witness w2 | `-3` (cost(MOV)=1 - cost(LOAD)=4 = -3 <= 0) | Store-to-load forwarding: STORE writes R[r_val] to Mem[R[r_addr]] (valid in [0, 65536)), and with no intervening branch target at loc, the immediately following LOAD from R[r_addr] reads back R[r_val]. |
| `14` | `R_DEAD_LOAD` | `LOAD rd, r_addr -> NOP (when immediately overwritten at loc + 1)` | w1 == loc + 1 is within bounds and overwrites register rd without reading rd | `-3` (cost(NOP)=1 - cost(LOAD)=4 = -3 <= 0) | Dead-load elimination: LOAD has no side effects other than writing R[rd]. Since execution falls through directly from loc to loc + 1 which overwrites R[rd] without reading it, the loaded value is dead on every path through loc. |

## 13. Everything Not Built, Failing, Impossible, or Contradictory

- **Missing or Unbuilt Features:** None. All 6 architectural sections (VM, Components, Proof System, Epoch Loop, Single-Page UI, and Headless Node CLI) and all 9 test suites in `tests/run-all.js` are built and passing (9/9).
- **Failing Tests:** None (0 failing tests in `node tests/run-all.js`).
- **Impossible or Contradictory Requirements:** None found in the specification.
  - *Environment Note on Test 9 (Headless Browser):* In this Linux container, the system `/usr/bin/chromium` binary is a snap-wrapper script that sandboxes local `file://` paths outside standard home directories; loading `gm1.html` into headless Chromium via a `data:text/html;base64,...` URI renders the exact `gm1.html` byte stream under its strict `Content-Security-Policy`, executes 4 epochs and state export via DOM clicks, and verifies 0 page or console errors.
