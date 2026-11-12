# GM-1 Instruction Set Architecture (`ISA.md`)

## 1. Machine State, Well-Formedness & Execution Model

GM-1 is a deterministic, step-counted register virtual machine whose data words and registers are arbitrary-precision signed integers (`BigInt` in $\mathbb{Z}$). Because integers have unbounded precision, arithmetic never overflows or wraps, eliminating modular overflow side conditions from equivalence proofs.

- **Registers:** 16 general-purpose arbitrary-precision integer registers `r0` through `r15` (`R[0] .. R[15]`), initialized to `0n` at the start of every program execution.
- **Program Counter (`PC`):** Integer instruction index initialized to `0`. Execution halts cleanly when `HALT` is executed (`status: 'halted'`), `RET` is executed with an empty call stack (`status: 'halted'`), or `PC` steps outside `[0, N - 1]` where $N$ is the program's instruction count (`status: 'halted_eof'`).
- **Call Stack:** Bounded hardware return-address stack (capacity 1,024 frames) storing return instruction indices `PC + 1` pushed by `CALL` and popped by `RET`. Exceeding 1,024 frames halts immediately with `status: 'stack_overflow'`.
- **Data Memory (`Mem`):** Word-addressed linear memory over indices `[0, 65535]` (`MEMORY_SIZE = 65536`), where each address holds an arbitrary-precision `BigInt` (defaulting to `0n` if unwritten). Out-of-bounds `LOAD` returns `0n`; out-of-bounds `STORE` is a no-op.
- **Input / Output Streams:**
  - `Input`: Read-only vector of `BigInt` values passed into a run. Queried via `INLEN` (length) and `IN` (indexed read; returns `0n` if index is out of bounds).
  - `Output`: Append-only vector of `BigInt` values emitted during execution via `OUT`.
- **Instruction Encoding:** Every instruction is a 4-tuple of `BigInt` words:
  $$\text{inst}[i] = [\text{op}, a, b, c]$$
  where `op` is the opcode ID (`0 .. 22`), and `a, b, c` are register indices (`0 .. 15`), immediate constants ($`b \in \mathbb{Z}`$), or branch/call target instruction indices ($`c \in \mathbb{Z}`$).

### 1.1 Formal Definition of a Well-Formed Program (P1)

A program $P = [\text{inst}[0], \dots, \text{inst}[N-1]]$ is **well-formed** (`validateProgram(P).ok === true`) if and only if:
1. $P$ is a non-empty array of 4-element instruction tuples ($N \ge 1$), where every word $\text{op}, a, b, c$ is an exact integer (`BigInt` in $\mathbb{Z}$).
2. For every instruction $\text{inst}[i] = [\text{op}, a, b, c]$:
   - **Valid Opcode:** $\text{op} \in \{0, 1, \dots, 22\}$.
   - **Valid Register Operand Fields:** Every operand word used as a register index by $\text{op}$'s format (listed in the **Register Operand Fields** column of Section 3 below) satisfies $0 \le r \le 15$:
     - Opcodes `0 (NOP)`, `1 (HALT)`, `13 (JMP)`, `16 (CALL)`, `17 (RET)`: no register operand fields.
     - Opcodes `2 (LDI)`, `14 (JZ)`, `15 (JNZ)`, `20 (INLEN)`, `22 (OUT)`: word 1 (`a`) is in `0..15`.
     - Opcodes `3 (MOV)`, `9 (NEG)`, `18 (LOAD)`, `21 (IN)`: words 1 and 2 (`a, b`) are in `0..15`.
     - Opcode `19 (STORE)`: words 2 and 3 (`b, c`) are in `0..15`.
     - Opcodes `4..8 (ADD, SUB, MUL, DIV, MOD)` and `10..12 (CMPEQ, CMPLT, CMPLE)`: words 1, 2, and 3 (`a, b, c`) are in `0..15`.
   - **Integer Immediate & Branch/Call Target Fields:** Every immediate operand (`b` in `LDI`) and every branch or call target (`c` in `JMP`, `JZ`, `JNZ`, `CALL`) is an integer in $\mathbb{Z}$.

### 1.2 Load-Time Enforcement and Direct VM Behavior on Ill-Formed Programs

- **Machine Load-Time Refusal:** `GM1.Machine` refuses to load any ill-formed program across **every** entry path: `new GM1.Machine({ solverProg, searcherProg, exam })`, `machine.setSolver(p)`, `machine.setSearcher(p)`, `machine.setExam(exam)`, and `machine.importState(json)`, throwing an `Error` citing `ill_formed_program` (unless the positive-control test option `allowIllFormed: true` is explicitly set).
- **Checker Refusal:** `GM1.checkCertificate` checks `validateProgram(activeProg)` and `validateProgram(replacementProg)` and rejects with code `ill_formed_program` if either program is not well-formed.
- **Direct `runVM` Execution on an Ill-Formed Program:** If an ill-formed program is passed directly to `GM1.runVM(prog, inputs, budget, initMem)`:
  1. When `PC` reaches an instruction whose opcode `op` is outside `0..22`, the VM stops immediately **before** charging that instruction's step cost and returns `status: 'invalid_opcode'`.
  2. When `PC` reaches an instruction with a valid opcode `0..22` whose budget check `steps + cost(op) <= budget` succeeds, the step cost `cost(op)` is added to `steps`, and the VM then validates that all register operand fields required by `op` (`REG_FIELDS_BY_OP[op]`) are in `0..15`. If any required register field is outside `0..15`, execution stops immediately without mutating registers, memory, or outputs, returning `status: 'invalid_register'`.

## 2. Programs as Data in Memory & Searcher Input Convention

Both the **Solver** (Component `0`) and the **Searcher** (Component `1`) are represented as flat arrays of 4-word instructions in the VM's data memory whenever the Searcher executes. This allows the Searcher to inspect the Solver's code and its own code as ordinary data.

| Address Range (Word Index) | Contents |
| --- | --- |
| `0 .. 999` | General scratchpad data memory (initialized to `0n`) |
| `1000` (`SOLVER_MEM_BASE`) | Solver instruction count $N_{\text{solver}}$ |
| `1004 .. 1004 + 4*N_solver - 1` | Solver instruction words `[op, a, b, c]` at `1004 + 4*i .. 1004 + 4*i + 3` |
| `5000` (`SEARCHER_MEM_BASE`) | Searcher instruction count $N_{\text{searcher}}$ |
| `5004 .. 5004 + 4*N_searcher - 1` | Searcher instruction words `[op, a, b, c]` at `5004 + 4*i .. 5004 + 4*i + 3` |
| `8990 .. 19000` | Searcher working memory (candidate copy at `9000`, constant tables at `13500..13755`, proof step buffer at `14004`, branch target bitmap at `18000`) |
| `19001 .. 65535` | Additional general data memory (total address space `MEMORY_SIZE = 65536` words) |

- **Searcher Input Convention (`Input[0]`, `Input[1]`):**
  - `Input[0]` specifies `targetComponent`: `0n` to inspect and propose rewrites for the Solver at `1000`, or `1n` to inspect and propose rewrites for the Searcher at `5000`.
  - `Input[1]` specifies the unsound-rule positive-control trigger: `0n` in normal operation (including all exam jobs), or `99n` when `machine.options.unsoundRule === true`.

## 3. Opcodes, Register Fields, Canonical Unused Fields, and Fixed Step Costs (Axioms)

Every executed instruction adds its fixed step cost to the run's step counter before executing. If executing the next instruction would cause `steps + cost(op) > budget`, execution halts immediately with status `budget_exceeded`. When the assembler or a proof rule constructs an instruction, unused tuple words are canonically set to `0n` as shown in the **Canonical Unused Words** column.

| Opcode ID | Mnemonic | Assembly Operands | Register Operand Fields (Must be in `0..15`) | Canonical Unused Words | Step Cost | Formal Semantics |
| --- | --- | --- | --- | --- | --- | --- |
| `0` | `NOP` | `(none)` | None | `a=0, b=0, c=0` | `1` | No operation |
| `1` | `HALT` | `(none)` | None | `a=0, b=0, c=0` | `1` | Terminate execution cleanly |
| `2` | `LDI` | `rA, imm` (`b`) | word[1] (`a`) | `c=0` | `1` | Load signed BigInt immediate b into R[a] |
| `3` | `MOV` | `rA, rB` | word[1] (`a`), word[2] (`b`) | `c=0` | `1` | Copy R[b] into R[a] |
| `4` | `ADD` | `rA, rB, rC` | word[1] (`a`), word[2] (`b`), word[3] (`c`) | None | `2` | R[a] = R[b] + R[c] |
| `5` | `SUB` | `rA, rB, rC` | word[1] (`a`), word[2] (`b`), word[3] (`c`) | None | `2` | R[a] = R[b] - R[c] |
| `6` | `MUL` | `rA, rB, rC` | word[1] (`a`), word[2] (`b`), word[3] (`c`) | None | `6` | R[a] = R[b] * R[c] |
| `7` | `DIV` | `rA, rB, rC` | word[1] (`a`), word[2] (`b`), word[3] (`c`) | None | `8` | R[a] = (R[c] === 0n) ? 0n : (R[b] / R[c]) (truncating toward 0) |
| `8` | `MOD` | `rA, rB, rC` | word[1] (`a`), word[2] (`b`), word[3] (`c`) | None | `8` | R[a] = (R[c] === 0n) ? 0n : (R[b] % R[c]) |
| `9` | `NEG` | `rA, rB` | word[1] (`a`), word[2] (`b`) | `c=0` | `2` | R[a] = -R[b] |
| `10` | `CMPEQ` | `rA, rB, rC` | word[1] (`a`), word[2] (`b`), word[3] (`c`) | None | `2` | R[a] = (R[b] === R[c]) ? 1n : 0n |
| `11` | `CMPLT` | `rA, rB, rC` | word[1] (`a`), word[2] (`b`), word[3] (`c`) | None | `2` | R[a] = (R[b] < R[c]) ? 1n : 0n |
| `12` | `CMPLE` | `rA, rB, rC` | word[1] (`a`), word[2] (`b`), word[3] (`c`) | None | `2` | R[a] = (R[b] <= R[c]) ? 1n : 0n |
| `13` | `JMP` | `target` (`c`) | None | `a=0, b=0` | `2` | Unconditional jump to PC = c |
| `14` | `JZ` | `rA, target` (`c`) | word[1] (`a`) | `b=0` | `2` | If R[a] === 0n, jump to PC = c |
| `15` | `JNZ` | `rA, target` (`c`) | word[1] (`a`) | `b=0` | `2` | If R[a] !== 0n, jump to PC = c |
| `16` | `CALL` | `target` (`c`) | None | `a=0, b=0` | `3` | Push PC + 1 to call stack and jump to PC = c |
| `17` | `RET` | `(none)` | None | `a=0, b=0, c=0` | `3` | Pop PC from call stack (or HALT if call stack is empty) |
| `18` | `LOAD` | `rA, rB` | word[1] (`a`), word[2] (`b`) | `c=0` | `4` | R[a] = Mem[R[b]] (0n if uninitialized or out of [0, 65536)) |
| `19` | `STORE` | `rB, rC` (`Mem[R[b]] = R[c]`) | word[2] (`b`), word[3] (`c`) | `a=0` | `4` | Mem[R[b]] = R[c] (no-op if R[b] out of [0, 65536)) |
| `20` | `INLEN` | `rA` | word[1] (`a`) | `b=0, c=0` | `1` | R[a] = length of input vector |
| `21` | `IN` | `rA, rB` | word[1] (`a`), word[2] (`b`) | `c=0` | `2` | R[a] = Input[R[b]] (0n if R[b] out of bounds) |
| `22` | `OUT` | `rA` | word[1] (`a`) | `b=0, c=0` | `2` | Append R[a] to output vector |

### Division and Modulo Conventions

For `DIV rA, rB, rC` and `MOD rA, rB, rC`:
- If `R[c] === 0n`, the result written to `R[a]` is defined as `0n` (total function without traps).
- Otherwise, `DIV` computes native `BigInt` quotient `R[b] / R[c]` (truncating toward zero), and `MOD` computes `R[b] % R[c]` satisfying `(R[b] / R[c]) * R[c] + (R[b] % R[c]) === R[b]`.

## 4. Seed Solver, Searcher Presets, Workload & Exam Specification

- **Seed Solver Task:** Given an input vector $X = [x_0, x_1, \dots, x_{m-1}]$, for each element $x_i$ the seed solver computes:
  $$y_i = ((x_i \cdot 2) + 0) \cdot 1 + (3 \cdot 5) - (x_i - x_i)$$
  and emits $y_i$ via `OUT`.
- **Searcher Presets (`PRESET_SEARCHERS`):**
  - `seed` (`SEED_SEARCHER_ASM`, 774 instructions): The default searcher, which includes three seeded identity instructions (`MUL r0, r0, r14`; `ADD r0, r0, r13`; `DIV r1, r1, r14`) in its setup header alongside its natural hash setup constants.
  - `plain` (`PLAIN_SEARCHER_ASM`, 771 instructions): The exact same searcher with those three identity instructions removed and nothing else changed.
- **Measured Solver Workload Cost:** The sum of VM execution steps across all input vectors in the active `workload`.
- **Measured Searcher Exam Cost:** The sum of VM execution steps across all jobs in the active `exam` (each job runs the searcher with `inputs = [targetComponent, 0n]` and the job's step `budget`).
- **Switch Cost Axiom:** `SWITCH_COST = 5n` steps. A rewrite is accepted only if the measured cost drop on the component's workload (for Solver) or exam (for Searcher) is strictly greater than `5` steps.
