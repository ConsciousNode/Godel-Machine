#!/usr/bin/env node
'use strict';
// Audit (Kehai, 2026-11-12): the seed searcher opens with three identity operations no plain program would contain
// (MUL r0,r0,r14 with r14=1; ADD r0,r0,r13 with r13=0; DIV r1,r1,r14). They are exactly what the searcher's first
// self-rewrite removes. Here we delete those three lines and ask: does the machine still find a self-rewrite?
const { loadGM1 } = require('../tests/load-gm1');
const IC = require('./indep-checker');
const { GM1, html } = loadGM1();
const m0 = /const SEED_SEARCHER_ASM = `([\s\S]*?)`;/.exec(html)[1];
const planted = ['  MUL r0, r0, r14\n', '  ADD r0, r0, r13\n', '  DIV r1, r1, r14\n'];
let clean = m0; for (const p of planted) { if (!clean.includes(p)) throw new Error('missing ' + p); clean = clean.replace(p, ''); }
function trial(label, searcherSrc, solverSrc, epochs = 20) {
  const m = new GM1.Machine({ searcherProg: searcherSrc, solverProg: solverSrc });
  const log = [];
  for (let e = 0; e < epochs; e++) {
    const st = { solver: m.solverProg.map(i => i.map(BigInt)), searcher: m.searcherProg.map(i => i.map(BigInt)), workload: m.workload, exam: m.exam };
    const tgt = m.epoch % 2; const r = m.runEpoch();
    if (r.accepted) {
      const mine = IC.check(m.lastProposal.rawWords, st, tgt, {});
      log.push({ epoch: m.epoch, target: tgt, before: String(r.costBefore), after: String(r.costAfter), rules: m.lineageLog.at(-1).certificate.steps.map(s => Number(s.ruleId)), indep: mine.ok });
    }
  }
  console.log(label, JSON.stringify(log));
  return log;
}
const solvers = [undefined, ...Object.values(GM1.PRESET_SOLVERS)];
let selfPlanted = 0, selfClean = 0;
for (const s of solvers) {
  selfPlanted += trial('as-delivered', m0, s).filter(x => x.target === 1).length;
  selfClean += trial('planted-removed', clean, s).filter(x => x.target === 1).length;
}
console.log({ selfRewritesAsDelivered: selfPlanted, selfRewritesWithPlantedLinesRemoved: selfClean });
