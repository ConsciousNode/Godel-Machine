# GM-1: a proof-gated self-rewriting machine in one HTML file

Studio rules: Xinu (single file `gm1.html`, zero dependencies, offline, strict CSP, no network or storage APIs). Inline everything and label every inline: any code copied from elsewhere carries a provenance comment naming its source.

## What this is

Build a small, complete machine in the spirit of Schmidhuber's Gödel Machine (2003). It has three parts:
- a **solver** program that does work;
- a **searcher** program that looks for rewrites of the solver *and of itself*;
- a fixed **checker** that applies a rewrite only if the searcher hands it a **certificate**: a formal proof that the rewrite preserves behavior and lowers a defined cost.

The solver and the searcher are both programs **running on the machine's own VM**. The checker, the VM and the axioms are the fixed "hardware". Nothing else can change the programs.

Build the instrument only. Do not predict, summarize or rank what the machine will find, anywhere in code, docs or UI.

## Attached

Nothing. Write everything from this spec.

## What to build

### 1. The VM

- A small, deterministic, step-counted virtual machine. Integers are arbitrary-precision (BigInt), so no overflow semantics leak into proofs.
- You choose the ISA, but document it fully in `ISA.md`. It must include:
  - arithmetic, comparison, conditional and unconditional branches, calls and returns;
  - loads and stores to a data memory;
  - instructions to read inputs and write outputs.
- **Cost model:** every executed instruction costs a documented, fixed number of steps (it may vary by opcode). Cost is part of the axioms.
- **Programs are data in the machine's memory.** The searcher can read both programs (its own included) as data, to inspect them and propose rewrites.

### 2. The components

- **Solver:** a program that takes an input vector and produces an output vector. Ship one seed solver, written plainly, for a small numeric task you choose and document (e.g. a polynomial evaluator, a checksum, a small sort). The machine must also accept **any** user-loaded solver program in the ISA. It will be tested on solver programs you never see.
- **Searcher:** a VM program that reads a target program (the solver or itself), proposes a rewrite, and writes out a **certificate** for it. The searcher's own work is step-counted like any other VM program.
- **Exam:** a fixed, documented list of searcher jobs (each job: a target program plus a step budget). It defines the searcher's own cost. It is part of the axioms.
- **Workload:** a fixed, documented list of solver inputs, defining the solver's measured cost. It is part of the axioms, and the user can replace it.

### 3. The proof system (axioms + checker)

**Certificate format** (document it exactly in `PROOFS.md`; we will write an independent checker from your document alone):
- the target component and its exact hash;
- the full replacement program;
- a sequence of proof steps. Each step applies one rule from a **fixed rule set** at a stated location, with its side conditions discharged in the certificate.

**Rule set:**
- Program-equivalence rules that are sound for **all** inputs, not just the workload. Examples: algebraic identities, constant folding, dead-code elimination, removing redundant loads and stores, strength reduction, safe reordering, loop-invariant motion with stated conditions.
- Each rule carries a **cost lemma**: a per-execution step change that is ≤ 0 on every path.
- Every rule, its side conditions and its cost lemma are listed in `PROOFS.md`, with a short soundness argument for each.

**Theorem the checker accepts:**
> new component ≡ old component on every input, **and** cost(new, x) ≤ cost(old, x) for every input x,

**plus** a strict drop in measured cost on the component's fixed workload (for the solver) or exam (for the searcher), larger than the documented switch cost.

**Checker:**
- Small, plain and fixed. It recomputes everything it needs: hashes, rule matches, side conditions and the measured drop. It trusts nothing the searcher asserts.
- Acceptance is the **only** path by which either program can change.
- The checker, the rule set and the axioms cannot be rewritten by the machine.

### 4. The loop

The machine runs epochs:
1. The searcher runs on the VM within a step budget.
2. Any certificate it emits goes to the checker.
3. If the checker accepts, the target is swapped (the switch cost is charged), and the event goes into an append-only log: old hash, new hash, certificate, measured costs before and after.

**Self-rewrites of the searcher are allowed and are the point.** After a searcher self-rewrite, the *new* searcher runs from the next epoch on.

### 5. UI (single page)

- Both programs, with a disassembly view.
- The current proposal and its certificate.
- The checker verdict, with the reason for each rejection.
- The accepted-rewrite log as a lineage, with searcher self-rewrites marked.
- Cost curves for the solver workload and the searcher exam.
- Load and replace the solver, the workload and the exam. Export and import the full machine state.

### 6. CLI / headless

Everything runs headless under Node from the same file, the way Triton's tests load `triton.html`. Export `GM1` with the VM, assembler, checker and machine loop.

## Forbidden

- **No host-side search.** The JS host runs the VM and the checker. It never generates rewrites, candidate programs or proofs. All proposals come out of the searcher program, through the VM's output.
- No acceptance without a checked certificate. No "trusted" or debug path that applies rewrites.
- Rules may not be justified only by the workload. Every rule is sound for all inputs.
- No branching on program hashes, file names or test inputs anywhere in the machine.
- No precomputed rewrites, embedded certificates or "known good" proof tables.
- If a requirement can't be met, or conflicts with another, say so in `REPORT.md` and leave it failing. Never change accessors, harnesses or tests to make a check pass.

## Tests (`tests/`, run with `node tests/run-all.js`)

1. **Checker rejects forgeries.** A corpus of at least 200 invalid certificates is generated programmatically and every one is rejected, each for the right reason. It covers:
   - wrong rule, and a rule applied at the wrong location;
   - a violated side condition;
   - a false cost claim;
   - a replacement that changes outputs;
   - a stale target hash;
   - a truncated proof;
   - a proof for the other component.
2. **Soundness by differential testing.** For every rule, on random programs where it applies: old and new agree on 10,000 random inputs, and the per-input cost of the new program is ≤ that of the old.
3. **Unsound-rule positive control.** A machine option, `unsoundRule: true`, adds one deliberately wrong rule to the rule set. With it on, the machine must accept a rewrite that breaks behavior, and test 2 must catch it. With it off, that rewrite must be rejected.
4. **The search really runs on the VM.** Perturbation:
   - change the searcher program (e.g. swap two of its proposal heuristics, or disable one), and the sequence of proposals must change;
   - replace the searcher with a program that outputs nothing, and no rewrite is ever accepted.
5. **End-to-end.** Several epochs on the seed solver, then on at least three other solver programs you write that are not tuned to your rules. Report what was accepted and rejected. Do not require any particular outcome.
6. **Searcher self-rewrite.** If the machine accepts a searcher self-rewrite in any run, a test replays it and checks that the new searcher's exam cost is lower and its proposals are identical on the exam. If it never happens, report that plainly; don't force it.
7. **Determinism and state export.** Two runs are bit-identical. A state exported mid-run and resumed finishes identically.
8. **Static scan.** Strict CSP, no network or storage APIs, every inline labeled.
9. **Real browser.** If you can run a headless browser, load `gm1.html`, run some epochs and report page errors. If you can't, say so plainly.

## Report (`REPORT.md`)

- What was built, and how each part was verified.
- Every table generated by a script, never typed.
- The rule set, with each rule's soundness argument (or a pointer to `PROOFS.md`).
- **Everything not built, everything that fails, and every requirement found impossible or contradictory**, each with the reason.
- Describe nothing as working unless a test exercises it.
