# GM-1 Instruction Set Architecture (`ISA.md`)

## 1. Machine State & Execution Model

GM-1 is a deterministic, step-counted register virtual machine whose data words and registers are arbitrary-precision signed integers (`BigInt` in $\mathbb{Z}$). Because integers have unbounded precision, arithmetic never overflows or wraps, eliminating modular overflow side conditions from equivalence proofs.

- **Registers:** 16 general-purpose arbitrary-precision integer registers `r0` through `r15` (`R[0] .. R[15]`), initialized to `0n` at the start of every program execution.
- **Program Counter (`PC`):** Integer instruction index initialized to `0`. Execution halts cleanly when `HALT` is executed, `RET` is executed with an empty call stack, or `PC` steps outside `[0, N - 1]` where $N$ is the program's instruction count.
- **Call Stack:** Bounded hardware return-address stack (capacity 1,024 frames) storing return instruction indices `PC + 1` pushed by `CALL` and popped by `RET`.
- **Data Memory (`Mem`):** Word-addressed linear memory over indices `[0, 65535]` (`MEMORY_SIZE = 65536`), where each address holds an arbitrary-precision `BigInt` (defaulting to `0n` if unwritten). Out-of-bounds `LOAD` returns `0n`; out-of-bounds `STORE` is a no-op.
- **Input / Output Streams:**
  - `Input`: Read-only vector of `BigInt` values passed into a run. Queried via `INLEN` (length) and `IN` (indexed read; returns `0n` if index is out of bounds).
  - `Output`: Append-only vector of `BigInt` values emitted during execution via `OUT`.
- **Instruction Encoding:** Every instruction is a 4-tuple of `BigInt` words:
  $$\text{inst}[i] = [\text{op}, a, b, c]$$
  where `op` is the opcode ID (`0 .. 22`), and `a, b, c` are register indices (`0 .. 15`), immediate constants ($`b \in \mathbb{Z}`$), or branch target instruction indices ($`c \in \mathbb{Z}`$).

## 2. Programs as Data in Memory

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

When the Searcher runs in an epoch, `Input[0]` specifies `targetComponent` (`0` for Solver at base address `1000`, `1` for Searcher at base address `5000`).

## 3. Opcodes, Semantics, and Fixed Step Costs (Axioms)

Every executed instruction adds its fixed step cost to the run's step counter before executing. If executing the next instruction would cause `steps + cost(op) > budget`, execution halts immediately with status `budget_exceeded`.

| Opcode ID | Mnemonic | Assembly Operands | Step Cost | Formal Semantics |
| --- | --- | --- | --- | --- |
| `0` | `NOP` | `(none)` | `1` | No operation |
| `1` | `HALT` | `(none)` | `1` | Terminate execution cleanly |
| `2` | `LDI` | `rA, imm` | `1` | Load signed BigInt immediate b into R[a] |
| `3` | `MOV` | `rA, rB` | `1` | Copy R[b] into R[a] |
| `4` | `ADD` | `rA, rB, rC` | `2` | R[a] = R[b] + R[c] |
| `5` | `SUB` | `rA, rB, rC` | `2` | R[a] = R[b] - R[c] |
| `6` | `MUL` | `rA, rB, rC` | `6` | R[a] = R[b] * R[c] |
| `7` | `DIV` | `rA, rB, rC` | `8` | R[a] = (R[c] === 0n) ? 0n : (R[b] / R[c]) (truncating toward 0) |
| `8` | `MOD` | `rA, rB, rC` | `8` | R[a] = (R[c] === 0n) ? 0n : (R[b] % R[c]) |
| `9` | `NEG` | `rA, rB` | `2` | R[a] = -R[b] |
| `10` | `CMPEQ` | `rA, rB, rC` | `2` | R[a] = (R[b] === R[c]) ? 1n : 0n |
| `11` | `CMPLT` | `rA, rB, rC` | `2` | R[a] = (R[b] < R[c]) ? 1n : 0n |
| `12` | `CMPLE` | `rA, rB, rC` | `2` | R[a] = (R[b] <= R[c]) ? 1n : 0n |
| `13` | `JMP` | `target` (`c`) | `2` | Unconditional jump to PC = c |
| `14` | `JZ` | `rA, target` (`c`) | `2` | If R[a] === 0n, jump to PC = c |
| `15` | `JNZ` | `rA, target` (`c`) | `2` | If R[a] !== 0n, jump to PC = c |
| `16` | `CALL` | `target` (`c`) | `3` | Push PC + 1 to call stack and jump to PC = c |
| `17` | `RET` | `(none)` | `3` | Pop PC from call stack (or HALT if call stack is empty) |
| `18` | `LOAD` | `rA, rB` | `4` | R[a] = Mem[R[b]] (0n if uninitialized or out of [0, 65536)) |
| `19` | `STORE` | `rB, rC` (`Mem[R[b]] = R[c]`) | `4` | Mem[R[b]] = R[c] (no-op if R[b] out of [0, 65536)) |
| `20` | `INLEN` | `rA` | `1` | R[a] = length of input vector |
| `21` | `IN` | `rA, rB` | `2` | R[a] = Input[R[b]] (0n if R[b] out of bounds) |
| `22` | `OUT` | `rA` | `2` | Append R[a] to output vector |

### Division and Modulo Conventions

For `DIV rA, rB, rC` and `MOD rA, rB, rC`:
- If `R[c] === 0n`, the result written to `R[a]` is defined as `0n` (total function without traps).
- Otherwise, `DIV` computes native `BigInt` quotient `R[b] / R[c]` (truncating toward zero), and `MOD` computes `R[b] % R[c]` satisfying `(R[b] / R[c]) * R[c] + (R[b] % R[c]) === R[b]`.

## 4. Seed Solver & Workload Specification

- **Seed Solver Task:** Given an input vector $X = [x_0, x_1, \dots, x_{m-1}]$, for each element $x_i$ the seed solver computes:
  $$y_i = ((x_i \cdot 2) + 0) \cdot 1 + (3 \cdot 5) - (x_i - x_i)$$
  and emits $y_i$ via `OUT`.
- **Measured Solver Workload Cost:** The sum of VM execution steps across all input vectors in the active `workload`.
- **Measured Searcher Exam Cost:** The sum of VM execution steps across all jobs in the active `exam` (each job specifies a target component, target program, and step budget).
- **Switch Cost Axiom:** `SWITCH_COST = 5n` steps. A rewrite is accepted only if the measured cost drop on the component's workload (for Solver) or exam (for Searcher) is strictly greater than `5` steps.
