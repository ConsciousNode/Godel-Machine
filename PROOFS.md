# GM-1 Proof System & Certificate Specification (`PROOFS.md`)

This document specifies the GM-1 certificate format, program hash function, side-condition discharge algorithm, equivalence rule set, and checker verification procedure so that an independent checker can be implemented from this specification alone.

## 1. Theorem Accepted by the Checker

Let $P_{\text{old}}$ be the currently active program for component $C \in \{0, 1\}$ and $P_{\text{new}}$ be the proposed replacement program. The checker accepts a certificate if and only if:

1. **Syntactic & Hash Integrity:** The certificate header is well-formed, targets component $C$, and states $\text{targetHash} = \text{Hash}(P_{\text{old}})$.
2. **Formal Stepwise Equivalence & Non-Increasing Path Cost:** Starting from $P_0 = P_{\text{old}}$, each proof step $k \in \{0, \dots, S-1\}$ applies a rule $r_k$ from the fixed rule set at instruction index $\text{loc}_k$ with all side conditions discharged on $P_k$, yielding $P_{k+1}$ such that:
   $$\forall x,\; \text{Outputs}(P_{k+1}, x) = \text{Outputs}(P_k, x) \quad\text{and}\quad \text{Cost}(P_{k+1}, x) \le \text{Cost}(P_k, x)$$
   and after $S$ steps, $P_S = P_{\text{new}}$ word-for-word.
3. **Strict Measured Cost Drop Exceeding Switch Cost:** On the component's fixed benchmark ($\text{Workload}$ for Solver $C=0$, or $\text{Exam}$ for Searcher $C=1$):
   $$\text{MeasuredCost}(P_{\text{old}}) - \text{MeasuredCost}(P_{\text{new}}) > \text{SWITCH\_COST} \; (5\text{ steps}).$$

## 2. Exact Program Hash Function

Given a program $P$ of $N$ instructions where $\text{inst}[i] = [w_{i,0}, w_{i,1}, w_{i,2}, w_{i,3}] \in \mathbb{Z}^4$, the exact hash $\text{Hash}(P) \in [0, 1000000006]$ is computed over `BigInt` as:
- Constants: $\text{SEED} = 100003$, $\text{MULT} = 131$, $M = 1000000007$.
- Initialization:
  $$h_0 = (\text{SEED} \cdot \text{MULT} + N) \bmod M$$
- For $i = 0, \dots, N-1$ and $k = 0, 1, 2, 3$:
  $$v = ((w_{i,k} \bmod M) + M) \bmod M$$
  $$h \leftarrow (h \cdot \text{MULT} + v + (k + 1)) \bmod M$$

## 3. Flat Word-Stream Certificate Format

The Searcher emits a certificate through the VM's `OUT` instruction as a flat sequence of $4 + 4N + 1 + 5S$ `BigInt` words:

| Word Offset | Field Name | Exact Specification |
| --- | --- | --- |
| `0` | `magic` | `1196241153n` (`0x474D3101`, ASCII `"GM1\x01"`) |
| `1` | `targetComponent` | `0n` for Solver, `1n` for Searcher |
| `2` | `targetHash` | Exact polynomial rolling hash of the active target program prior to rewrite |
| `3` | `N` (`replacementLength`) | Number of 4-word instructions in the replacement program ($N \ge 1$) |
| `4 .. 4 + 4*N - 1` | `replacementProg` | $4N$ words encoding replacement instructions `[op_0, a_0, b_0, c_0, ..., op_{N-1}, a_{N-1}, b_{N-1}, c_{N-1}]` |
| `4 + 4*N` | `S` (`stepCount`) | Number of sequential proof steps ($S \ge 1$) |
| `4 + 4*N + 1 .. 4 + 4*N + 5*S` | `steps` | $5S$ words encoding proof steps `[ruleId_k, loc_k, w1_k, w2_k, costDelta_k]` for $0 \le k < S$ |

Each proof step $k \in \{0, \dots, S-1\}$ consists of 5 consecutive `BigInt` words:
$$[\text{ruleId}_k,\; \text{loc}_k,\; w_{1,k},\; w_{2,k},\; \text{costDelta}_k]$$
where:
- $\text{ruleId}_k \in \{1, \dots, 14\}$ (or $99$ when `unsoundRule: true`),
- $\text{loc}_k \in \{0, \dots, N-1\}$ is the instruction index in $P_k$ rewritten by step $k$,
- $w_{1,k}, w_{2,k} \in \{0, \dots, N-1\}$ are witness instruction indices discharging the rule's side conditions,
- $\text{costDelta}_k < 0$ is the exact per-execution step change of rule $\text{ruleId}_k$.

## 4. Side-Condition Discharge: Constant Witness Verification (`verifyConstantAt`)

Rules that depend on a register $r$ holding a known constant $c_{\text{val}}$ at instruction index $\text{loc}$ in program $P_k$ supply a witness instruction index $w$. The checker independently verifies `verifyConstantAt(P_k, loc, w, r)` as follows:

1. **Bounds & LDI Check:** Verify $0 \le w < \text{loc} < N$ and that $P_k[w]$ is `[2n, r, c_val, _]` (`LDI r, c_val`). If not, reject with `side_condition_violated`.
2. **Dominance & Non-Modification Check (Either Mode A or Mode B must hold):**
   - **Mode A (Local Basic-Block Dominance):**
     - No branch or call instruction (`JMP`, `JZ`, `JNZ`, `CALL`) anywhere in $P_k$ has target $t \in (w, \text{loc}]$.
     - For every instruction index $j \in (w, \text{loc})$, $P_k[j]$ is not a control-transfer instruction (`HALT`, `JMP`, `JZ`, `JNZ`, `CALL`, `RET`) and does not write to register $r$.
     - *Soundness of Mode A:* Because no branch targets $(w, \text{loc}]$ and no control transfer exits $(w, \text{loc})$, any execution reaching $\text{loc}$ must have entered the straight-line segment at or before $w$, executed $P_k[w]$ (`LDI r, c_val`), and reached $\text{loc}$ without $r$ being overwritten.
   - **Mode B (Entry-Block Single-Assignment Invariance):**
     - No branch or call instruction in $P_k$ has target $t \in (0, w]$.
     - For every instruction index $j \in [0, w)$, $P_k[j]$ is not a control-transfer instruction (`HALT`, `JMP`, `JZ`, `JNZ`, `CALL`, `RET`).
     - Across the entire program $P_k[0 \dots N-1]$, no instruction at any index $j \ne w$ writes to register $r$.
     - *Soundness of Mode B:* Execution begins at $\text{PC} = 0$ and unconditionally executes the straight-line prefix $0 \dots w$ before reaching any instruction at index $> w$. At index $w$, $r$ is set to $c_{\text{val}}$, and because no other instruction in $P_k$ writes to $r$, $R[r] = c_{\text{val}}$ is a global program invariant at every execution of $\text{loc} > w$.

## 5. Fixed Equivalence Rule Set, Side Conditions, Cost Lemmas & Soundness Arguments

| Rule ID | Rule Name | Rewrite Pattern at `loc` | Side Conditions Discharged by Checker | Cost Lemma ($\Delta$ Steps) | Soundness Argument (All Inputs) |
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

### Positive-Control Unsound Rule (Option `unsoundRule: true` Only)

- **Rule `99` (`R_UNSOUND_ADD_TO_MOV`):** Rewrites `ADD rd, rs1, rs2` (`[4, a, b, c]`) to `MOV rd, rs1` (`[3, a, b, 0]`) with `costDelta = -1n` **without** checking whether `R[rs2] == 0`.
- Disabled by default (`unsoundRule: false`). When enabled via `new GM1.Machine({ unsoundRule: true })`, the checker accepts rewrites using Rule `99` that alter program outputs whenever $R[\text{rs2}] \ne 0$, which Test 2's differential testing immediately catches.

## 6. Independent Checker Verification Procedure & Rejection Codes

Given a candidate word array `words` and machine state, `checkCertificate` executes the following deterministic checks in order, rejecting on the first failure:

| Rejection Code | Condition Triggering Rejection |
| --- | --- |
| `empty_proposal` | Searcher output stream is empty (`0` words emitted) |
| `truncated_proof` | Word stream is shorter than header, `N <= 0`, `S <= 0`, or word count $\ne 4 + 4N + 1 + 5S$ |
| `invalid_magic` | Word `0` does not equal `1196241153n` (`0x474D3101`) |
| `wrong_component` | `targetComponent` is not `0` or `1`, does not match the active job target, or `targetHash` belongs to the other component |
| `stale_target_hash` | `targetHash` does not equal `computeProgramHash(activeProg)` |
| `wrong_rule` | `ruleId` is not in the fixed rule set (`1 .. 14`, or `99` when `unsoundRule: true`) |
| `wrong_location` | `loc` is out of bounds `[0, N - 1]` or the opcode at `prog[loc]` does not match the rule pattern |
| `side_condition_violated` | The rule side condition or constant witness `verifyConstantAt(prog, loc, w, reg)` fails verification |
| `false_cost_claim` | Step `costDelta` does not equal the rule's fixed `costDelta` |
| `replacement_mismatch` | The program derived by sequentially applying the $S$ proof steps to `activeProg` does not match `replacementProg` word-for-word |
| `insufficient_cost_drop` | Measured cost drop `costBefore - costAfter <= SWITCH_COST` (`5` steps) |
