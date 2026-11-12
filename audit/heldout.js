#!/usr/bin/env node
'use strict';
// Audit (Kehai, 2026-11-12): preregistered criteria 3, 4 and 5 on five solver programs Argon never saw.
const fs = require('fs'), path = require('path');
const { loadGM1 } = require('../tests/load-gm1');
const IC = require('./indep-checker');
const { GM1 } = loadGM1();
const B = BigInt;
let rng = 987654321; const rnd = (n) => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
const randVec = () => { const n = rnd(8); const v = []; for (let i = 0; i < n; i++) v.push(B(rnd(2001) - 1000) * (rnd(10) === 0 ? 1000000007n : 1n)); return v; };
const same = (a, b) => a.status === b.status && a.out.length === b.out.length && a.out.every((x, i) => x === b.out[i]);
function diffSolver(oldP, newP, n = 10000) {
  let bad = 0, costUp = 0;
  for (let i = 0; i < n; i++) { const x = randVec(); const a = IC.run(oldP, x), b = IC.run(newP, x); if (!same(a, b)) bad++; if (b.steps > a.steps) costUp++; }
  return { inputs: n, mismatches: bad, costIncreases: costUp };
}
function diffSearcher(oldS, newS, solverPool, n = 150) {
  let bad = 0, costUp = 0;
  for (let i = 0; i < n; i++) {
    const tgt = solverPool[rnd(solverPool.length)];
    const mem = IC.layout(tgt, null); // the searcher's own copy differs between old and new, so compare on solver jobs
    const a = IC.run(oldS, [0n, 0n], 800000n, IC.layout(tgt, oldS)), b = IC.run(newS, [0n, 0n], 800000n, IC.layout(tgt, newS));
    if (!same(a, b)) bad++; if (b.steps > a.steps) costUp++;
  }
  return { jobs: n, mismatches: bad, costIncreases: costUp };
}
const dir = path.join(__dirname, 'heldout');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.asm')).sort();
const pool = files.map(f => GM1.assemble(fs.readFileSync(path.join(dir, f), 'utf8')));
const summary = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const m = new GM1.Machine({ solverProg: src });
  const startCost = m.getSolverCost();
  const rec = { program: f, startSolverCost: String(startCost), accepted: [] };
  for (let e = 0; e < 20; e++) {
    const st = { solver: m.solverProg.map(i => i.map(B)), searcher: m.searcherProg.map(i => i.map(B)), workload: m.workload, exam: m.exam };
    const tgt = m.epoch % 2; const r = m.runEpoch();
    if (!r.accepted) continue;
    const L = m.lineageLog.at(-1);
    const indep = IC.check(m.lastProposal.rawWords, st, tgt);
    const newP = L.certificate.replacementProg.map(i => i.map(B));
    const diff = tgt === 0 ? diffSolver(st.solver, newP) : diffSearcher(st.searcher, newP, pool);
    rec.accepted.push({ epoch: m.epoch, target: tgt === 0 ? 'solver' : 'searcher', costBefore: String(r.costBefore), costAfter: String(r.costAfter), rules: L.certificate.steps.map(s => Number(s.ruleId)), indepChecker: indep.ok, differential: diff });
  }
  rec.endSolverCost = String(m.getSolverCost());
  summary.push(rec);
  console.log(JSON.stringify(rec));
}
const c3 = summary.filter(r => r.accepted.some(a => a.target === 'solver')).length;
const c4 = summary.some(r => r.accepted.some(a => a.target === 'searcher'));
const c5 = summary.every(r => r.accepted.every(a => a.differential.mismatches === 0 && a.differential.costIncreases === 0));
const c1 = summary.every(r => r.accepted.every(a => a.indepChecker));
console.log(JSON.stringify({ criterion1_allRechecked: c1, criterion3_programsWithProvenSolverRewrite: `${c3}/5`, criterion4_searcherSelfRewrite: c4, criterion5_differentialClean: c5 }));
fs.writeFileSync(path.join(__dirname, 'heldout-results.json'), JSON.stringify(summary, null, 1));
