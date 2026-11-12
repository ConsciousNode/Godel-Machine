#!/usr/bin/env node
'use strict';
// Audit (Kehai, 2026-11-12): hand-made certificates aimed at gaps in the rule side conditions.
// A probe "breaks soundness" if the checker ACCEPTS it and the new program behaves differently from the old one.
const { loadGM1 } = require('../tests/load-gm1');
const IC = require('./indep-checker');
const { GM1 } = loadGM1();
const B = BigInt;
const mk = (prog, steps, comp = 0) => {
  const h = IC.hash(prog);
  let p = prog.map(i => i.map(B));
  for (const s of steps) { const r = IC.applyStep(p, s.map(B), {}); if (r.err) return { words: null, err: r.err }; p = r.prog; }
  const w = [IC.MAGIC, B(comp), h, B(p.length), ...p.flat(), B(steps.length), ...steps.flat().map(B)];
  return { words: w, newProg: p };
};
function probe(name, prog, steps, inputsThatDiffer, workload) {
  const m = new GM1.Machine({ solverProg: GM1.disassemble ? undefined : undefined });
  m.solverProg = prog.map(i => i.map(B));
  if (workload) m.workload = workload.map(v => v.map(B));
  const { words, newProg, err } = mk(prog, steps);
  if (!words) { console.log(`${name}: (independent checker refuses to even build it: ${err})`); return; }
  const theirs = GM1.checkCertificate(words, m, { expectedTargetComponent: 0 });
  const mine = IC.check(words, { solver: m.solverProg, searcher: m.searcherProg, workload: m.workload, exam: m.exam }, 0);
  const strict = IC.check(words, { solver: m.solverProg, searcher: m.searcherProg, workload: m.workload, exam: m.exam }, 0, { strictRegisters: true });
  const runT = (p, x) => { try { const r = GM1.runVM(p, x, 200000n); return { status: r.status, out: r.outputs.map(String) }; } catch (e) { return { status: 'THREW ' + e.constructor.name, out: [] }; } };
  const diffs = inputsThatDiffer.map(x => ({ input: x, old: runT(m.solverProg, x.map(B)), new: runT(newProg, x.map(B)) }));
  const changed = diffs.some(d => JSON.stringify(d.old) !== JSON.stringify(d.new));
  console.log(`${theirs.accepted && changed ? 'UNSOUND' : 'ok     '} ${name}: theirs=${theirs.code} mine=${mine.code} mineWithFix=${strict.code} behaviorChanged=${changed}`);
  for (const d of diffs) console.log('        ', JSON.stringify(d));
}
// Shared shape: a legitimate rule-8 strength reduction on the hot path pays for the measured cost drop,
// and a second step rewrites an instruction on a branch the workload never takes.
const hot = (bad) => [
  [20, 1, 0, 0],      // 0 INLEN r1
  [2, 2, 2, 0],       // 1 LDI r2, 2
  [14, 1, 0, 8],      // 2 JZ r1, 8   (empty input -> cold branch)
  [2, 0, 0, 0],       // 3 LDI r0, 0
  [21, 3, 0, 0],      // 4 IN r3, r0
  [6, 4, 3, 2],       // 5 MUL r4, r3, r2
  [22, 4, 0, 0],      // 6 OUT r4
  [1, 0, 0, 0],       // 7 HALT
  ...bad,             // 8.. cold branch
];
probe('R4 SUB_SELF on an invalid register (r99)',
  hot([[5, 5, 99, 99], [22, 5, 0, 0], [1, 0, 0, 0]]),
  [[8, 5, 1, 0, -4], [4, 8, 0, 0, -1]], [[], [7]]);
probe('R14 DEAD_LOAD whose address register is invalid (r99)',
  hot([[18, 5, 99, 0], [2, 5, 7, 0], [22, 5, 0, 0], [1, 0, 0, 0]]),
  [[8, 5, 1, 0, -4], [14, 8, 9, 0, -3]], [[], [7]]);
probe('R14 DEAD_LOAD followed by IN rd, rd (next instruction reads rd)',
  hot([[18, 5, 0, 0], [21, 5, 5, 0], [22, 5, 0, 0], [1, 0, 0, 0]]),
  [[8, 5, 1, 0, -4], [14, 8, 9, 0, -3]], [[]]);
probe('R13 REDUNDANT_LOAD at an out-of-range constant address',
  hot([[2, 6, 70000, 0], [2, 7, 5, 0], [19, 0, 6, 7], [18, 5, 6, 0], [22, 5, 0, 0], [1, 0, 0, 0]]),
  [[8, 5, 1, 0, -4], [13, 11, 10, 8, -3]], [[]]);
probe('R1 ADD_ZERO with witness behind a CALL return (Mode A)',
  [[20, 1, 0, 0], [2, 2, 2, 0], [2, 9, 0, 0], [16, 0, 0, 7], [4, 4, 4, 9], [22, 4, 0, 0], [1, 0, 0, 0], [2, 9, 3, 0], [17, 0, 0, 0]],
  [[1, 4, 2, 0, -1]], [[1], []], [[1], [2], [3]]);

// The three probes above that the independent checker refuses to build: force-build them by hand and offer them to
// GM-1's checker directly, to see whether it also refuses.
function forced(name, prog, steps, newProgEdits, inputs, workload) {
  const m = new GM1.Machine();
  m.solverProg = prog.map(i => i.map(B));
  if (workload) m.workload = workload.map(v => v.map(B));
  const p = prog.map(i => i.map(B)); for (const [i, ins] of newProgEdits) p[i] = ins.map(B);
  const words = [IC.MAGIC, 0n, IC.hash(prog), B(p.length), ...p.flat(), B(steps.length), ...steps.flat().map(B)];
  const theirs = GM1.checkCertificate(words, m, { expectedTargetComponent: 0 });
  console.log(`${theirs.accepted ? 'ACCEPTED' : 'rejected'} (forced) ${name}: theirs=${theirs.code}`);
}
const H = (bad) => hot(bad);
forced('R14 DEAD_LOAD followed by IN rd, rd', H([[18, 5, 0, 0], [21, 5, 5, 0], [22, 5, 0, 0], [1, 0, 0, 0]]),
  [[8, 5, 1, 0, -4], [14, 8, 9, 0, -3]], [[5, [4, 4, 3, 3]], [8, [0, 0, 0, 0]]]);
forced('R13 REDUNDANT_LOAD at address 70000', H([[2, 6, 70000, 0], [2, 7, 5, 0], [19, 0, 6, 7], [18, 5, 6, 0], [22, 5, 0, 0], [1, 0, 0, 0]]),
  [[8, 5, 1, 0, -4], [13, 11, 10, 8, -3]], [[5, [4, 4, 3, 3]], [11, [3, 5, 7, 0]]]);
forced('R1 ADD_ZERO, witness LDI before a CALL whose subroutine rewrites the register',
  [[20, 1, 0, 0], [2, 9, 0, 0], [16, 0, 0, 6], [4, 4, 1, 9], [22, 4, 0, 0], [1, 0, 0, 0], [2, 9, 3, 0], [17, 0, 0, 0]],
  [[1, 3, 1, 0, -1]], [[3, [3, 4, 1, 0]]], null, [[1], [2], [3], [4], [5], [6]]);
