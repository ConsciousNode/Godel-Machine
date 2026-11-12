#!/usr/bin/env node
'use strict';
// Audit (Kehai, 2026-11-12): our own forged-certificate corpus, built by mutating real accepted certificates.
// Every forgery must be rejected by BOTH GM-1's checker and the independent checker.
const { loadGM1 } = require('../tests/load-gm1');
const IC = require('./indep-checker');
const { GM1 } = loadGM1();
const B = BigInt;
function realCerts() {
  const out = [];
  for (const s of [undefined, ...Object.values(GM1.PRESET_SOLVERS)]) {
    const m = new GM1.Machine({ solverProg: s });
    for (let e = 0; e < 2; e++) {
      const snap = { solver: m.solverProg.map(i => i.map(B)), searcher: m.searcherProg.map(i => i.map(B)), workload: m.workload, exam: m.exam };
      const fresh = new GM1.Machine({ solverProg: s }); fresh.solverProg = snap.solver.map(i => i.slice()); fresh.searcherProg = snap.searcher.map(i => i.slice());
      const tgt = m.epoch % 2; const r = m.runEpoch();
      if (r.accepted) out.push({ words: m.lastProposal.rawWords.map(B), tgt, snap, fresh });
    }
  }
  return out;
}
const certs = realCerts();
let rng = 12345; const rnd = (n) => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
const forgeries = [];
for (const c of certs) {
  const w = c.words, N = Number(w[3]), S = Number(w[4 + 4 * N]), st = (k) => 5 + 4 * N + 5 * k;
  const add = (kind, words, tgt = c.tgt) => forgeries.push({ kind, words, c, tgt });
  for (let k = 0; k < S; k++) {
    let x = w.slice(); x[st(k)] = [0n, 15n, 99n, 100n, -1n][rnd(5)]; add('wrong_rule', x);
    x = w.slice(); x[st(k) + 1] = (w[st(k) + 1] + 1n + B(rnd(3))) % B(N); add('wrong_location', x);
    x = w.slice(); x[st(k) + 1] = B(N + 5); add('location_out_of_bounds', x);
    x = w.slice(); x[st(k) + 2] = (w[st(k) + 2] + 1n) % B(N);
    // Rule 4 (SUB_SELF) has no witness, so changing its w1 leaves a still-valid proof: filed separately, not as a forgery.
    add(w[st(k)] === 4n ? 'unused_witness_changed (still a valid proof)' : 'wrong_witness', x);
    x = w.slice(); x[st(k) + 4] = w[st(k) + 4] - 1n; add('false_cost_claim_bigger', x);
    x = w.slice(); x[st(k) + 4] = 0n; add('false_cost_claim_zero', x);
  }
  for (let t = 0; t < 6; t++) { const x = w.slice(); const i = 4 + rnd(4 * N); x[i] = x[i] + 1n + B(rnd(5)); add('replacement_word_changed', x); }
  { const x = w.slice(); x[2] = (x[2] + 1n) % 1000000007n; add('stale_hash', x); }
  { const x = w.slice(); x[0] = x[0] + 1n; add('bad_magic', x); }
  { const x = w.slice(); x[1] = 1n - x[1]; add('other_component', x, c.tgt); }
  { const x = w.slice(); x[1] = 2n; add('component_2', x); }
  for (let cut = 1; cut <= 3; cut++) add('truncated', w.slice(0, w.length - cut * 2));
  { const x = w.slice(0, w.length - 5); x[4 + 4 * N] = B(S - 1); if (S > 1) add('dropped_last_step_but_kept_replacement', x); }
  { const x = w.slice(); x[4 + 4 * N] = B(S + 1); add('step_count_lies', x); }
  { add('wrong_epoch_target', w.slice(), 1 - c.tgt); }
  add('empty', []);
}
let theirsBad = 0, mineBad = 0; const byKind = {};
const notForgery = (k) => k.startsWith('unused_witness');
for (const f of forgeries) {
  const m = f.c.fresh;
  const theirs = GM1.checkCertificate(f.words, m, { expectedTargetComponent: f.tgt });
  const mine = IC.check(f.words, f.c.snap, f.tgt);
  byKind[f.kind] = byKind[f.kind] || { n: 0, theirsAccepted: 0, mineAccepted: 0 };
  byKind[f.kind].n++;
  if (theirs.accepted) { if (!notForgery(f.kind)) theirsBad++; byKind[f.kind].theirsAccepted++; }
  if (mine.ok) { if (!notForgery(f.kind)) mineBad++; byKind[f.kind].mineAccepted++; }
}
console.log(`real certificates mutated: ${certs.length}; forgeries: ${forgeries.filter(f => !notForgery(f.kind)).length}`);
console.table(byKind);
console.log(theirsBad + mineBad === 0 ? 'ALL forgeries rejected by both checkers' : `ACCEPTED forgeries: theirs=${theirsBad} mine=${mineBad}`);
