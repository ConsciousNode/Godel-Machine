'use strict';
// Independent GM-1 checker + VM (Kehai Interim, 2026-11-12).
// Written from ISA.md and PROOFS.md only, before reading checkCertificate / applyAndCheckStep /
// verifyConstantAt in gm1.html. Where the docs leave a detail open, the choice is marked DOC-GAP.

const M = 1000000007n, SEED = 100003n, MULT = 131n, MAGIC = 1196241153n, SWITCH = 5n;
const COST = { 0: 1n, 1: 1n, 2: 1n, 3: 1n, 4: 2n, 5: 2n, 6: 6n, 7: 8n, 8: 8n, 9: 2n, 10: 2n, 11: 2n, 12: 2n,
  13: 2n, 14: 2n, 15: 2n, 16: 3n, 17: 3n, 18: 4n, 19: 4n, 20: 1n, 21: 2n, 22: 2n };
const B = (x) => BigInt(x);

function hash(prog) {
  let h = (SEED * MULT + B(prog.length)) % M;
  for (const inst of prog) for (let k = 0; k < 4; k++) {
    const v = ((B(inst[k]) % M) + M) % M;
    h = (h * MULT + v + B(k + 1)) % M;
  }
  return h;
}

// ---- VM (ISA.md §1, §3) ----
// DOC-GAP: ISA.md does not say what happens with a register index outside 0..15. We stop with status 'invalid_register'.
function run(prog, inputs, budget = 200000n, mem0 = null) {
  const R = new Array(16).fill(0n), mem = new Map(mem0 || []), out = [], stack = [];
  let pc = 0, steps = 0n, status = 'fell_off';
  const reg = (i) => { const n = Number(i); if (!(n >= 0 && n < 16)) throw 'invalid_register'; return n; };
  const inp = inputs.map(B);
  try {
    while (pc >= 0 && pc < prog.length) {
      const [op, a, b, c] = prog[pc].map(B); const o = Number(op);
      if (COST[o] === undefined) { status = 'invalid_opcode'; break; }
      if (steps + COST[o] > budget) { status = 'budget_exceeded'; break; }
      steps += COST[o];
      let next = pc + 1;
      switch (o) {
        case 0: break;
        case 1: status = 'halted'; next = -1; break;
        case 2: R[reg(a)] = b; break;
        case 3: R[reg(a)] = R[reg(b)]; break;
        case 4: R[reg(a)] = R[reg(b)] + R[reg(c)]; break;
        case 5: R[reg(a)] = R[reg(b)] - R[reg(c)]; break;
        case 6: R[reg(a)] = R[reg(b)] * R[reg(c)]; break;
        case 7: { const d = R[reg(c)]; R[reg(a)] = d === 0n ? 0n : R[reg(b)] / d; break; }
        case 8: { const d = R[reg(c)]; R[reg(a)] = d === 0n ? 0n : R[reg(b)] % d; break; }
        case 9: R[reg(a)] = -R[reg(b)]; break;
        case 10: R[reg(a)] = R[reg(b)] === R[reg(c)] ? 1n : 0n; break;
        case 11: R[reg(a)] = R[reg(b)] < R[reg(c)] ? 1n : 0n; break;
        case 12: R[reg(a)] = R[reg(b)] <= R[reg(c)] ? 1n : 0n; break;
        case 13: next = Number(c); break;
        case 14: if (R[reg(a)] === 0n) next = Number(c); break;
        case 15: if (R[reg(a)] !== 0n) next = Number(c); break;
        case 16: if (stack.length >= 1024) throw 'stack_overflow'; stack.push(pc + 1); next = Number(c); break;
        case 17: if (stack.length === 0) { status = 'halted'; next = -1; } else next = stack.pop(); break;
        case 18: { const ad = R[reg(b)]; R[reg(a)] = (ad >= 0n && ad < 65536n) ? (mem.get(ad) ?? 0n) : 0n; break; }
        case 19: { const ad = R[reg(b)]; if (ad >= 0n && ad < 65536n) mem.set(ad, R[reg(c)]); break; }
        case 20: R[reg(a)] = B(inp.length); break;
        case 21: { const i = R[reg(b)]; R[reg(a)] = (i >= 0n && i < B(inp.length)) ? inp[Number(i)] : 0n; break; }
        case 22: out.push(R[reg(a)]); break;
      }
      if (next === -1) break;
      pc = next;
    }
  } catch (e) { status = String(e); }
  if (status === 'fell_off') status = 'halted'; // ISA.md: leaving [0, N-1] halts cleanly
  return { status, steps, out };
}

function layout(solver, searcher) { // ISA.md §2
  const mem = new Map();
  const put = (base, p) => { mem.set(B(base), B(p.length)); p.forEach((ins, i) => ins.forEach((w, k) => mem.set(B(base + 4 + 4 * i + k), B(w)))); };
  if (solver) put(1000, solver); if (searcher) put(5000, searcher);
  return mem;
}

// ---- proof rules (PROOFS.md §4–5) ----
const CTRL = new Set([1, 13, 14, 15, 16, 17]), BRANCH = new Set([13, 14, 15, 16]);
const WRITES_A = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 20, 21]);
function writes(ins, r) { return WRITES_A.has(Number(ins[0])) && B(ins[1]) === r; }
function reads(ins, r) {
  const o = Number(ins[0]), a = B(ins[1]), b = B(ins[2]), c = B(ins[3]);
  if ([3, 9, 18, 21].includes(o)) return b === r;
  if ([4, 5, 6, 7, 8, 10, 11, 12].includes(o)) return b === r || c === r;
  if (o === 19) return b === r || c === r;
  if ([14, 15, 22].includes(o)) return a === r;
  return false;
}
function targetIn(prog, lo, hi) { // any branch/call target t with lo < t <= hi
  return prog.some(ins => BRANCH.has(Number(ins[0])) && B(ins[3]) > B(lo) && B(ins[3]) <= B(hi));
}
function constAt(prog, loc, w, r) {
  w = Number(w); loc = Number(loc);
  if (!(w >= 0 && w < loc && loc < prog.length)) return null;
  const W = prog[w]; if (Number(W[0]) !== 2 || B(W[1]) !== B(r)) return null;
  const val = B(W[2]);
  // Mode A
  let okA = !targetIn(prog, w, loc);
  for (let j = w + 1; okA && j < loc; j++) if (CTRL.has(Number(prog[j][0])) || writes(prog[j], B(r))) okA = false;
  if (okA) return val;
  // Mode B
  let okB = !targetIn(prog, 0, w);
  for (let j = 0; okB && j < w; j++) if (CTRL.has(Number(prog[j][0]))) okB = false;
  for (let j = 0; okB && j < prog.length; j++) if (j !== w && writes(prog[j], B(r))) okB = false;
  return okB ? val : null;
}

const DELTA = { 1: -1n, 2: -1n, 3: -1n, 4: -1n, 5: -5n, 6: -5n, 7: -5n, 8: -4n, 9: -7n, 10: -1n, 11: -5n, 12: -1n, 13: -3n, 14: -3n };
// DOC-GAP: the unused fields of replacement instructions (e.g. c of MOV, b/c of LDI 0, all of NOP) are not documented;
// we take them as 0, following the [3, a, b, 0] form PROOFS.md gives for rule 99.
function applyStep(prog, [rule, loc, w1, w2, delta], opts = {}) {
  rule = Number(rule); loc = Number(loc);
  const ok = DELTA[rule] !== undefined || (opts.unsoundRule && rule === 99);
  if (!ok) return { err: 'wrong_rule' };
  if (!(loc >= 0 && loc < prog.length)) return { err: 'wrong_location' };
  const [op, a, b, c] = prog[loc].map(B), o = Number(op);
  const want = { 1: 4, 2: 4, 3: 5, 4: 5, 5: 6, 6: 6, 7: 6, 8: 6, 9: 7, 10: 4, 11: 6, 12: 9, 13: 18, 14: 18, 99: 4 }[rule];
  if (o !== want) return { err: 'wrong_location' };
  const k = (reg, val) => { const v = constAt(prog, loc, w1, reg); return v !== null && (val === undefined || v === val) ? v : null; };
  let rep;
  switch (rule) {
    case 1: if (k(c, 0n) === null) return { err: 'side_condition_violated' }; rep = [3n, a, b, 0n]; break;
    case 2: if (k(b, 0n) === null) return { err: 'side_condition_violated' }; rep = [3n, a, c, 0n]; break;
    case 3: if (k(c, 0n) === null) return { err: 'side_condition_violated' }; rep = [3n, a, b, 0n]; break;
    case 4: if (b !== c) return { err: 'side_condition_violated' }; rep = [2n, a, 0n, 0n]; break;
    case 5: if (k(c, 1n) === null) return { err: 'side_condition_violated' }; rep = [3n, a, b, 0n]; break;
    case 6: if (k(b, 1n) === null) return { err: 'side_condition_violated' }; rep = [3n, a, c, 0n]; break;
    case 7: if (k(c, 0n) === null) return { err: 'side_condition_violated' }; rep = [2n, a, 0n, 0n]; break;
    case 8: if (k(c, 2n) === null) return { err: 'side_condition_violated' }; rep = [4n, a, b, b]; break;
    case 9: if (k(c, 1n) === null) return { err: 'side_condition_violated' }; rep = [3n, a, b, 0n]; break;
    case 10: case 11: {
      const c1 = constAt(prog, loc, w1, b), c2 = constAt(prog, loc, w2, c);
      if (c1 === null || c2 === null) return { err: 'side_condition_violated' };
      rep = [2n, a, rule === 10 ? c1 + c2 : c1 * c2, 0n]; break;
    }
    case 12: { const c1 = constAt(prog, loc, w1, b); if (c1 === null) return { err: 'side_condition_violated' }; rep = [2n, a, -c1, 0n]; break; }
    case 13: {
      const s = prog[loc - 1];
      if (Number(w1) !== loc - 1 || !s || Number(s[0]) !== 19 || B(s[2]) !== b) return { err: 'side_condition_violated' };
      if (targetIn(prog, loc - 1, loc)) return { err: 'side_condition_violated' };
      const ad = constAt(prog, loc, w2, b); if (ad === null || ad < 0n || ad >= 65536n) return { err: 'side_condition_violated' };
      rep = [3n, a, B(s[3]), 0n]; break;
    }
    case 14: {
      const nx = prog[loc + 1];
      if (Number(w1) !== loc + 1 || !nx || !writes(nx, a) || reads(nx, a)) return { err: 'side_condition_violated' };
      rep = [0n, 0n, 0n, 0n]; break;
    }
    case 99: rep = [3n, a, b, 0n]; break;
  }
  if (B(delta) !== (rule === 99 ? -1n : DELTA[rule])) return { err: 'false_cost_claim' };
  const p2 = prog.map(i => i.map(B)); p2[loc] = rep; return { prog: p2 };
}

function parse(words) {
  words = words.map(B);
  if (words.length === 0) return { err: 'empty_proposal' };
  if (words.length < 5) return { err: 'truncated_proof' };
  if (words[0] !== MAGIC) return { err: 'invalid_magic' };
  const N = Number(words[3]); if (!(N >= 1) || words.length < 4 + 4 * N + 1) return { err: 'truncated_proof' };
  const S = Number(words[4 + 4 * N]); if (!(S >= 1) || words.length !== 4 + 4 * N + 1 + 5 * S) return { err: 'truncated_proof' };
  const repl = []; for (let i = 0; i < N; i++) repl.push(words.slice(4 + 4 * i, 8 + 4 * i));
  const steps = []; for (let k = 0; k < S; k++) steps.push(words.slice(5 + 4 * N + 5 * k, 10 + 4 * N + 5 * k));
  return { comp: words[1], hash: words[2], repl, steps };
}

// GM-1.1 (ISA.md §1.1): programs must be well-formed. On by default since 1.1; pass { gm10: true } for the GM-1.0 rules.
const REG_FIELDS = { 2: 'a', 3: 'ab', 4: 'abc', 5: 'abc', 6: 'abc', 7: 'abc', 8: 'abc', 9: 'ab', 10: 'abc', 11: 'abc', 12: 'abc',
  14: 'a', 15: 'a', 18: 'ab', 19: 'bc', 20: 'a', 21: 'ab', 22: 'a' };
function wellFormed(prog) {
  if (!Array.isArray(prog) || prog.length === 0) return false;
  return prog.every(ins => Array.isArray(ins) && ins.length === 4 && Number(ins[0]) >= 0 && Number(ins[0]) <= 22 && [...(REG_FIELDS[Number(ins[0])] || '')].every(f => { const v = B(ins['abc'.indexOf(f) + 1]); return v >= 0n && v < 16n; }));
}
// state: { solver, searcher, workload, exam:[{targetComponent, prog, budget}] }, expected: component the epoch asked for
function check(words, state, expected, opts = {}) {
  const c = parse(words); if (c.err) return { ok: false, code: c.err };
  if (c.comp !== 0n && c.comp !== 1n) return { ok: false, code: 'wrong_component' };
  if (Number(c.comp) !== expected) return { ok: false, code: 'wrong_component' };
  const active = expected === 0 ? state.solver : state.searcher;
  if (c.hash !== hash(active)) return { ok: false, code: 'stale_target_hash' };
  const strict = opts.strictRegisters !== undefined ? opts.strictRegisters : !opts.gm10;
  if (strict && !wellFormed(active)) return { ok: false, code: 'ill_formed_program' };
  const USES = { 1: 'w1', 2: 'w1', 3: 'w1', 4: '', 5: 'w1', 6: 'w1', 7: 'w1', 8: 'w1', 9: 'w1', 10: 'w1w2', 11: 'w1w2', 12: 'w1', 13: 'w1w2', 14: 'w1' };
  if (!opts.gm10) for (const st of c.steps) { const u = USES[Number(st[0])]; if (u === undefined) continue; if ((!u.includes('w1') && B(st[2]) !== 0n) || (!u.includes('w2') && B(st[3]) !== 0n)) return { ok: false, code: 'noncanonical_certificate' }; }
  let p = active.map(i => i.map(B));
  for (const st of c.steps) { const r = applyStep(p, st, opts); if (r.err) return { ok: false, code: r.err }; p = r.prog; }
  if (strict && !wellFormed(c.repl)) return { ok: false, code: 'ill_formed_program' };
  if (p.length !== c.repl.length || p.some((ins, i) => ins.some((w, k) => w !== c.repl[i][k]))) return { ok: false, code: 'replacement_mismatch' };
  const before = cost(active, expected, state), after = cost(p, expected, state);
  if (before === null || after === null || before - after <= SWITCH) return { ok: false, code: 'insufficient_cost_drop', before, after };
  return { ok: true, code: 'accepted', before, after, newProg: p };
}

function cost(prog, comp, state) {
  let t = 0n;
  if (comp === 0) {
    for (const x of state.workload) { const r = run(prog, x, 200000n); if (r.status !== 'halted') return null; t += r.steps; }
  } else {
    for (const j of state.exam) {
      const tc = Number(j.targetComponent || 0);
      // DOC-GAP: ISA.md §2 gives the layout; the searcher's inputs [targetComponent, 0] are taken from the epoch convention.
      const mem = tc === 0 ? layout(j.prog, prog) : layout(state.solver, j.prog);
      const r = run(prog, [B(tc), 0n], B(j.budget || 200000n), mem); if (r.status !== 'halted') return null; t += r.steps;
    }
  }
  return t;
}

module.exports = { wellFormed, hash, run, layout, constAt, applyStep, parse, check, cost, MAGIC };
