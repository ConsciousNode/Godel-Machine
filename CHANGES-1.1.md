# GM-1.1 Patch Changelog (`CHANGES-1.1.md`)

This document records every change made in **GM-1.1** relative to the delivered **GM-1** bundle in response to `AUDIT.md` Findings 1–5. No files in `audit/` were modified.

## Summary of Audit Script Verification After Patch

- `node audit/soundness-probes.js`: Every probe is now rejected by GM-1.1's checker (`ok` on all 5 probes and `rejected` on all 3 forced probes), including the two `r99` probes previously marked `UNSOUND` (now rejected with `ill_formed_program`, matching `mineWithFix`).
- `node audit/recheck.js`: Full agreement (`30/30` epochs across `seed` and all 4 presets = `150/150` proposals, `0` disagreements, `every accepted rewrite passes the independent checker`).
- `node audit/forgeries.js`: `ALL forgeries rejected by both checkers` (`390/390` forgeries rejected; in addition, the 2 `unused_witness_changed` mutations on Rule 4 are now rejected by GM-1.1 with `noncanonical_certificate` per P4).
- `node audit/heldout.js`: Full agreement (`criterion1_allRechecked: true`, `criterion3_programsWithProvenSolverRewrite: "3/5"`, `criterion4_searcherSelfRewrite: true`, `criterion5_differentialClean: true`).
- `node audit/no-planted-redundancy.js`: `{ selfRewritesAsDelivered: 5, selfRewritesWithPlantedLinesRemoved: 5 }`.

## Detailed Changes by Requirement

### P1. Well-Formed Programs Only (Audit Finding 1)

1. **`ISA.md` (§1.1, §1.2, §3):**
   - Defined **well-formed program** formally: a non-empty array of 4-word integer tuples `[op, a, b, c]` where every opcode `op` is in `0..22`, every register operand field used by `op` (`REG_FIELDS_BY_OP[op]`) is in `0..15`, and every immediate (`b` in `LDI`) or branch/call target (`c` in `JMP`, `JZ`, `JNZ`, `CALL`) is an integer.
   - Documented exact `runVM` behavior if an ill-formed program is passed directly to `runVM`: out-of-range opcode stops immediately before charging step cost with `status: 'invalid_opcode'`; out-of-range register operand in any register field of `op` stops immediately after charging step cost (without mutating state) with `status: 'invalid_register'`.
2. **`gm1.html` (`validateProgram`, `isWellFormedProgram`, `ensureWellFormedProgram`, `runVM`, `checkCertificate`, `Machine`):**
   - Added `REG_FIELDS_BY_OP`, `validateProgram(prog)`, and `isWellFormedProgram(prog)`.
   - Tightened `runVM`'s runtime register check to validate all register operand fields in `REG_FIELDS_BY_OP[opId]` (including word 3 `c` on 3-register opcodes and `STORE`).
   - Updated `checkCertificate` to validate both `activeProg` and `replacementProg` and reject with `code: 'ill_formed_program'` if either is not well-formed (unless `allowIllFormed: true` is set for positive-control testing).
   - Updated `Machine` to refuse ill-formed programs with a clear `Error` across **every** load path: `new Machine({ solverProg, searcherProg, exam })`, `setSolver`, `setSearcher`, `setExam`, and `importState`.
   - Added machine option `allowIllFormed: true` (default `false`) for the P1 positive-control test (Test 11).
3. **`PROOFS.md` (§1, §6):**
   - Updated the theorem in §1 to quantify over well-formed programs and added `ill_formed_program` to the rejection table in §6.

### P2. Disclose the Seeding & Add `plain` Searcher Preset (Audit Finding 2)

1. **`gm1.html` (`PLAIN_SEARCHER_ASM`, `PRESET_SEARCHERS`):**
   - Added `PLAIN_SEARCHER_ASM` (771 instructions), constructed by removing the three seeded identity instructions (`MUL r0, r0, r14`; `ADD r0, r0, r13`; `DIV r1, r1, r14`) from `SEED_SEARCHER_ASM` (774 instructions) with nothing else changed.
   - Exported `PLAIN_SEARCHER_ASM` and `PRESET_SEARCHERS = { seed: SEED_SEARCHER_ASM, plain: PLAIN_SEARCHER_ASM }` on `GM1`, and added a searcher preset selector (`#ui-preset-searcher`) in the UI.
2. **`REPORT.md` (§2, §9) & `tests/run-all.js` (Test 6):**
   - Added Section 2 in `REPORT.md` explicitly disclosing the three identity instructions in `SEED_SEARCHER_ASM` and the `÷1` / `-0` / `1×` identities in UI presets `dot` and `norm`, explaining why they were included.
   - Updated Test 6 in `tests/run-all.js` to run on **both** `PRESET_SEARCHERS.seed` ($29,917 \to 29,879$, 5 proof steps) and `PRESET_SEARCHERS.plain` ($29,885 \to 29,873$, 2 proof steps folding hash/buffer setup constants), verifying that both lower exam cost by more than `SWITCH_COST` and produce bit-identical proposals on the exam.

### P3. Budgets in the Theorem (Audit Finding 3)

1. **`PROOFS.md` (§1):**
   - Explicitly stated the budgeted form of the theorem: for any finite step budget $B$, on every input $x$ where $P_{\text{old}}$ finishes within budget $B$, $P_{\text{new}}$ finishes within budget $B$ with the exact same outputs and at no greater step cost ($\text{Cost}(P_{\text{new}}, x) \le \text{Cost}(P_{\text{old}}, x) \le B$). Because per-instruction step cost is non-increasing along every path, $P_{\text{new}}$ can only finish in cases where $P_{\text{old}}$ ran out of budget, never the reverse.

### P4. Canonical Certificates (Audit Finding 4)

1. **`gm1.html` (`RULE_WITNESS_USAGE`, `applyAndCheckStep`):**
   - Added `RULE_WITNESS_USAGE` documenting which witness fields (`w1`, `w2`) each rule uses.
   - Updated `applyAndCheckStep` so that after discharging a rule's side conditions, any witness field unused by that rule must equal `0n`; otherwise the step is rejected with `code: 'noncanonical_certificate'`.
2. **`PROOFS.md` (§3.1, §3.2, §5, §6):**
   - Documented which witness fields each rule uses, the canonical `0n` requirement for unused witness fields and unused replacement instruction words, and the `noncanonical_certificate` rejection code.

### P5. Browser Test Skip Handling & New Tests (Tests 10–13)

1. **`tests/run-all.js` (Test 9 & Summary):**
   - Updated Test 9 to probe for Selenium or Playwright, print `SKIPPED: <reason>` if no browser driver is available, and report `passed / failed / skipped` in the summary where a skip is never counted as a pass.
2. **`tests/run-all.js` (Tests 10, 11, 12, 13):**
   - **Test 10 (Ill-formed rejection):** Verifies that for each of the 14 rules, a certificate on a program with an out-of-range register field (`r99`) is rejected with `ill_formed_program`, and verifies that all 7 load entry points on `Machine` refuse ill-formed programs.
   - **Test 11 (Positive control):** Verifies that `allowIllFormed: true` causes the auditor's two `r99` probes (Rules 4 and 14) to be accepted again and causes Test 10's check suite to fail.
   - **Test 12 (Canonical fields):** Verifies for every rule that non-zero unused witness fields are rejected with `noncanonical_certificate`.
   - **Test 13 (No regressions):** Verifies that `seed` and all presets produce the exact same accepted rewrites as GM-1 and lists all differences required by the new rules.
