# Gödel Machine: preregistration

**Written:** 2026-11-12, before the spec was sent and before any build exists. Kehai Interim, with Kham.
The commit timestamp is the proof. These criteria do not move. If one turns out to be wrong, we report results under both the old rule and the new one.

## What we are trying to find out

Can a working machine in one HTML file meet Schmidhuber's acceptance rule, at toy scale, for real? The rule (2003): the machine rewrites a part of itself only after it holds a formal proof that the rewrite improves its utility.

**Prior art, as of this date:**
- No full Gödel Machine implementation exists (Wikipedia; Nivel et al. 2013, "Bounded Recursive Self-Improvement").
- Steunebrink & Schmidhuber published "A Family of Gödel Machine Implementations" (AGI 2011) and "Towards an Actual Gödel Machine Implementation" (2012). We found no finished, running system from that line.
- The Darwin Gödel Machine (Zhang et al., 2025) and the Huxley-Gödel Machine (Wang et al., 2025) replace proof with empirical scores. They are not Gödel Machines under the acceptance rule.

So the claim we would be allowed to make, if the criteria below are met, is narrow: **a toy-scale machine whose every self-rewrite is gated on a machine-checked proof, including rewrites of its own proof searcher.** Not general intelligence, not optimality, not "the first" until a deeper literature search is done.

## Primary criteria (all must hold for "works")

1. **Soundness of the gate.**
   - Every accepted rewrite in every run carries a certificate that **our own independent checker** accepts. We write that checker after delivery, from the certificate format in the spec, without reading Argon's checker.
   - Zero accepted rewrites fail our recheck.
2. **Rejection of bad proofs.** Our adversarial corpus of forged certificates is rejected by both checkers, 100%. We write the corpus after delivery. It covers a wrong rule, a violated side condition, a false cost claim, a changed output, a stale target and a truncated proof.
3. **Real improvement on code the builder never saw.** On at least 3 of 5 seed programs that *we* write after delivery (held out), the machine finds, proves and applies at least one rewrite. The proof searcher runs inside the machine, and the applied rewrite lowers measured utility.
4. **Self-reference.** In at least one run, the machine accepts a proven rewrite of **its own proof searcher**, and the searcher's measured cost on its fixed exam then drops.
5. **Behavior preserved.** For every accepted rewrite, the old and new component agree on 10,000 random inputs that we generate (a differential check outside the proof system).

## Secondary (reported, not required)

- How many rewrites are accepted per run, and how utility changes over time.
- Whether any rewrite of the searcher later enables a solver rewrite that the old searcher did not find within the same budget.
- Proof sizes, checker time, and the share of searcher time spent on proposals that fail to prove.

## Outcomes

- **Works:** all five primary criteria hold.
- **Partial:** 1, 2 and 5 hold, but 3 or 4 fails. The gate is real, but the machine is weak.
- **Broken:** 1, 2 or 5 fails. An unsound gate is a failure, however impressive the rest looks.
- Any sign that the search runs on the host instead of inside the machine, or that the checker can be bypassed, makes the result **Broken** until it is fixed and rerun.
