#!/usr/bin/env node
'use strict';
// Recheck every proposal GM-1 makes with the independent checker (Kehai, 2026-11-12).
const { loadGM1 } = require('../tests/load-gm1');
const IC = require('./indep-checker');
const { GM1 } = loadGM1();
const clone = (p) => p.map(i => i.map(BigInt));
function snapshot(m) { return { solver: clone(m.solverProg), searcher: clone(m.searcherProg), workload: m.workload.map(v => v.map(BigInt)), exam: m.exam.map(j => ({ targetComponent: j.targetComponent, prog: clone(j.prog), budget: j.budget })) }; }
function drive(label, m, epochs) {
  const stats = { label, epochs, accepted: 0, selfRewrites: 0, agree: 0, disagree: [], indepRejectsAccepted: 0 };
  for (let e = 0; e < epochs; e++) {
    const st = snapshot(m);
    const target = m.epoch % 2;
    const rec = m.runEpoch();
    const words = m.lastProposal.rawWords;
    const mine = IC.check(words, st, target, { unsoundRule: m.options.unsoundRule });
    if (rec.accepted) { stats.accepted++; if (target === 1) stats.selfRewrites++; if (!mine.ok) stats.indepRejectsAccepted++; }
    const same = (mine.ok === rec.accepted) && (mine.ok || mine.code === rec.code);
    if (same) stats.agree++; else stats.disagree.push({ epoch: m.epoch, target, theirs: rec.code, mine: mine.code, before: String(mine.before), after: String(mine.after) });
  }
  return stats;
}
const out = [];
out.push(drive('seed', new GM1.Machine(), 30));
for (const [name, src] of Object.entries(GM1.PRESET_SOLVERS || {})) out.push(drive('preset:' + name, new GM1.Machine({ solverProg: src }), 30));
for (const s of out) console.log(JSON.stringify(s));
const bad = out.reduce((a, s) => a + s.indepRejectsAccepted, 0);
console.log(bad ? `FAIL: ${bad} accepted rewrite(s) rejected by the independent checker` : 'every accepted rewrite passes the independent checker');
