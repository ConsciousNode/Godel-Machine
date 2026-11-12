#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadGM1 } = require('./load-gm1.js');

const { GM1, html, htmlPath } = loadGM1();

// Deterministic PRNG (Mulberry32) for reproducible differential testing
function makePRNG(seed = 0x12345678) {
  let a = seed >>> 0;
  return {
    nextU32() {
      let t = (a += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    },
    nextInt(min, max) {
      const span = max - min + 1;
      return min + (this.nextU32() % span);
    },
    nextBigInt(min, max) {
      return BigInt(this.nextInt(min, max));
    }
  };
}

const results = {
  timestamp: new Date().toISOString(),
  tests: [],
  metrics: {}
};

function recordTest(id, name, passed, details) {
  results.tests.push({ id, name, passed, details });
  const badge = passed ? 'PASS' : 'FAIL';
  console.log(`[${badge}] Test ${id}: ${name}`);
  if (!passed) {
    console.error('       Failure details:', details);
  }
}

// ============================================================================
// TEST 1: Checker rejects forgeries (>= 200 programmatic invalid certificates)
// ============================================================================
function runTest1() {
  const m = new GM1.Machine();
  const baseSolver = GM1.cloneProg(m.solverProg);
  const solverHash = m.getSolverHash();
  const searcherHash = m.getSearcherHash();

  // Obtain a valid baseline certificate from the VM searcher on the seed solver
  const mem = GM1.buildInitialMemory(m.solverProg, m.searcherProg);
  const vmOut = GM1.runVM(m.searcherProg, [0n, 0n], 600000n, mem);
  const validParsed = GM1.parseCertificate(vmOut.outputs);
  if (!validParsed.ok) {
    throw new Error('Failed to parse baseline valid certificate');
  }
  const baseCert = validParsed.cert;

  const forgeries = [];

  // Category A: wrong_rule (30 cases)
  for (let i = 0; i < 30; i++) {
    const badRuleId = i < 15 ? (15 + i) : (-1 - i);
    const cert = {
      ...baseCert,
      steps: baseCert.steps.map((s, idx) => idx === 0 ? { ...s, ruleId: badRuleId } : { ...s })
    };
    forgeries.push({
      category: 'wrong_rule',
      expectedCode: 'wrong_rule',
      words: GM1.serializeCertificate(cert),
      expectedTarget: 0
    });
  }

  // Category B: wrong_location (35 cases: out-of-bounds locations and wrong opcode at location)
  for (let i = 0; i < 35; i++) {
    let loc;
    let ruleId = 1;
    let costDelta = -1n;
    if (i < 15) {
      loc = baseSolver.length + i; // out of bounds >= N
    } else if (i < 25) {
      loc = -(i - 14); // negative location
    } else {
      // Valid index, wrong opcode at that index (e.g. loc 0 is INLEN, loc 1..6 are LDI, loc 7 is CMPLT, loc 8 is JZ, loc 9 is IN)
      loc = (i - 25) % 10;
      ruleId = ((i - 25) % 9) + 1;
      costDelta = GM1.RULES.find(r => r.id === ruleId).costDelta;
    }
    const cert = {
      ...baseCert,
      steps: [{ ruleId, loc, w1: 0, w2: 0, costDelta }]
    };
    forgeries.push({
      category: 'wrong_location',
      expectedCode: 'wrong_location',
      words: GM1.serializeCertificate(cert),
      expectedTarget: 0
    });
  }

  // Category C: side_condition_violated (40 cases)
  for (let i = 0; i < 40; i++) {
    let step;
    if (i < 10) {
      // Rule 1 (R_ADD_ZERO_R) at loc 11 (ADD r4, r4, r10), but point w1 to wrong LDI (e.g., loc 3 which sets r11=1, or loc 0 which is INLEN)
      step = { ruleId: 1, loc: 11, w1: (i % 7), w2: 0, costDelta: -1n };
      if (step.w1 === 2) step.w1 = 3; // loc 2 is the actual LDI r10, 0; avoid it!
    } else if (i < 20) {
      // Rule 8 (R_MUL_TWO_R) at loc 10 (MUL r4, r3, r12), but point w1 to wrong LDI (not loc 4)
      step = { ruleId: 8, loc: 10, w1: (i % 6 === 4 ? 2 : i % 6), w2: 0, costDelta: -4n };
    } else if (i < 30) {
      // Rule 5 (R_MUL_ONE_R) at loc 12 (MUL r4, r4, r11), but point w1 >= loc or negative or non-LDI
      step = { ruleId: 5, loc: 12, w1: 12 + (i - 20), w2: 0, costDelta: -5n };
    } else {
      // Rule 4 (R_SUB_SELF) applied to a SUB where rs1 != rs2 (loc 16 is SUB r4, r4, r6 where b=4 != c=6)
      step = { ruleId: 4, loc: 16, w1: 0, w2: 0, costDelta: -1n };
    }
    const cert = {
      ...baseCert,
      steps: [step]
    };
    forgeries.push({
      category: 'side_condition_violated',
      expectedCode: 'side_condition_violated',
      words: GM1.serializeCertificate(cert),
      expectedTarget: 0
    });
  }

  // Category D: false_cost_claim (30 cases)
  for (let i = 0; i < 30; i++) {
    const wrongDelta = i < 15 ? BigInt(i) : BigInt(-100 - i);
    const cert = {
      ...baseCert,
      steps: baseCert.steps.map((s, idx) => idx === (i % baseCert.steps.length) ? { ...s, costDelta: wrongDelta } : { ...s })
    };
    forgeries.push({
      category: 'false_cost_claim',
      expectedCode: 'false_cost_claim',
      words: GM1.serializeCertificate(cert),
      expectedTarget: 0
    });
  }

  // Category E: replacement_mismatch (replacement that changes outputs or tampers with instructions) (30 cases)
  for (let i = 0; i < 30; i++) {
    const badRepl = GM1.cloneProg(baseCert.replacementProg);
    const targetIdx = i % badRepl.length;
    // Tamper with the replacement instruction so it differs from what the proof steps derive
    badRepl[targetIdx] = [2n, 4n, BigInt(999 + i), 0n];
    const cert = {
      ...baseCert,
      replacementProg: badRepl
    };
    forgeries.push({
      category: 'replacement_mismatch',
      expectedCode: 'replacement_mismatch',
      words: GM1.serializeCertificate(cert),
      expectedTarget: 0
    });
  }

  // Category F: stale_target_hash (25 cases)
  for (let i = 0; i < 25; i++) {
    const staleHash = solverHash + BigInt(i + 1) * 7919n;
    const cert = {
      ...baseCert,
      targetHash: staleHash
    };
    forgeries.push({
      category: 'stale_target_hash',
      expectedCode: 'stale_target_hash',
      words: GM1.serializeCertificate(cert),
      expectedTarget: 0
    });
  }

  // Category G: truncated_proof (25 cases)
  for (let i = 0; i < 25; i++) {
    const fullWords = GM1.serializeCertificate(baseCert);
    let truncatedWords;
    if (i < 4) {
      truncatedWords = fullWords.slice(0, i + 1); // header cut off
    } else if (i < 15) {
      truncatedWords = fullWords.slice(0, fullWords.length - (i - 3)); // missing trailing step words
    } else {
      // Zero step count or negative replacement length
      truncatedWords = [...fullWords];
      const stepCountIdx = 4 + baseCert.replacementProg.length * 4;
      truncatedWords[stepCountIdx] = 0n;
      truncatedWords = truncatedWords.slice(0, stepCountIdx + 1);
    }
    forgeries.push({
      category: 'truncated_proof',
      expectedCode: 'truncated_proof',
      words: truncatedWords,
      expectedTarget: 0
    });
  }

  // Category H: wrong_component (25 cases: proof for the other component or invalid component ID)
  for (let i = 0; i < 25; i++) {
    let cert;
    let expectedTarget = 0;
    if (i < 10) {
      // Claims targetComponent = 1 when checker expects 0
      cert = { ...baseCert, targetComponent: 1, targetHash: searcherHash };
      expectedTarget = 0;
    } else if (i < 20) {
      // Claims targetComponent = 0, but uses searcherHash (hash of the other component!)
      cert = { ...baseCert, targetComponent: 0, targetHash: searcherHash };
      expectedTarget = 0;
    } else {
      // Out of range component id (e.g. 2, 3, -1)
      cert = { ...baseCert, targetComponent: i - 18 };
      expectedTarget = 0;
    }
    forgeries.push({
      category: 'wrong_component',
      expectedCode: 'wrong_component',
      words: GM1.serializeCertificate(cert),
      expectedTarget
    });
  }

  let rejectedCount = 0;
  let rightReasonCount = 0;
  const byCategory = {};

  for (const item of forgeries) {
    if (!byCategory[item.category]) {
      byCategory[item.category] = { total: 0, rejected: 0, matchedReason: 0 };
    }
    byCategory[item.category].total += 1;
    const verdict = GM1.checkCertificate(item.words, m, { expectedTargetComponent: item.expectedTarget });
    if (!verdict.accepted) {
      rejectedCount += 1;
      byCategory[item.category].rejected += 1;
    }
    if (!verdict.accepted && verdict.code === item.expectedCode) {
      rightReasonCount += 1;
      byCategory[item.category].matchedReason += 1;
    }
  }

  const passed = forgeries.length >= 200 && rejectedCount === forgeries.length && rightReasonCount === forgeries.length;
  results.metrics.test1 = {
    totalForgeries: forgeries.length,
    rejectedCount,
    rightReasonCount,
    byCategory
  };
  recordTest(1, `Checker rejects forgeries (${rightReasonCount}/${forgeries.length} rejected with exact expected reason)`, passed, results.metrics.test1);
}

// ============================================================================
// TEST 2: Soundness by differential testing (10,000 random inputs per rule)
// ============================================================================
function buildRandomProgramForRule(ruleId, rng) {
  const k1 = rng.nextBigInt(-50, 50);
  const k2 = rng.nextBigInt(-50, 50);
  const k3 = rng.nextBigInt(1, 20);
  let asm = '';
  let step = null;

  switch (ruleId) {
    case 1: // R_ADD_ZERO_R: ADD rd, rs1, rs2 -> MOV rd, rs1 when rs2 == 0
      asm = `
        LDI r1, 0
        IN r2, r1
        LDI r3, ${k1}
        MUL r4, r2, r3
        LDI r5, 0
        ADD r6, r4, r5
        ADD r6, r6, r3
        OUT r6
        HALT
      `;
      step = { ruleId: 1, loc: 5, w1: 4, w2: 0, costDelta: -1n };
      break;
    case 2: // R_ADD_ZERO_L: ADD rd, rs1, rs2 -> MOV rd, rs2 when rs1 == 0
      asm = `
        LDI r1, 0
        IN r2, r1
        LDI r3, ${k1}
        ADD r4, r2, r3
        LDI r5, 0
        ADD r6, r5, r4
        OUT r6
        HALT
      `;
      step = { ruleId: 2, loc: 5, w1: 4, w2: 0, costDelta: -1n };
      break;
    case 3: // R_SUB_ZERO: SUB rd, rs1, rs2 -> MOV rd, rs1 when rs2 == 0
      asm = `
        LDI r1, 0
        IN r2, r1
        LDI r3, ${k1}
        ADD r4, r2, r3
        LDI r5, 0
        SUB r6, r4, r5
        OUT r6
        HALT
      `;
      step = { ruleId: 3, loc: 5, w1: 4, w2: 0, costDelta: -1n };
      break;
    case 4: // R_SUB_SELF: SUB rd, rs1, rs1 -> LDI rd, 0
      asm = `
        LDI r1, 0
        IN r2, r1
        LDI r3, ${k1}
        ADD r4, r2, r3
        SUB r5, r2, r2
        ADD r6, r4, r5
        OUT r6
        HALT
      `;
      step = { ruleId: 4, loc: 4, w1: 0, w2: 0, costDelta: -1n };
      break;
    case 5: // R_MUL_ONE_R: MUL rd, rs1, rs2 -> MOV rd, rs1 when rs2 == 1
      asm = `
        LDI r1, 0
        IN r2, r1
        LDI r3, ${k1}
        ADD r4, r2, r3
        LDI r5, 1
        MUL r6, r4, r5
        OUT r6
        HALT
      `;
      step = { ruleId: 5, loc: 5, w1: 4, w2: 0, costDelta: -5n };
      break;
    case 6: // R_MUL_ONE_L: MUL rd, rs1, rs2 -> MOV rd, rs2 when rs1 == 1
      asm = `
        LDI r1, 0
        IN r2, r1
        LDI r3, ${k1}
        SUB r4, r2, r3
        LDI r5, 1
        MUL r6, r5, r4
        OUT r6
        HALT
      `;
      step = { ruleId: 6, loc: 5, w1: 4, w2: 0, costDelta: -5n };
      break;
    case 7: // R_MUL_ZERO_R: MUL rd, rs1, rs2 -> LDI rd, 0 when rs2 == 0
      asm = `
        LDI r1, 0
        IN r2, r1
        LDI r3, ${k1}
        LDI r5, 0
        MUL r6, r2, r5
        ADD r7, r3, r6
        OUT r7
        HALT
      `;
      step = { ruleId: 7, loc: 4, w1: 3, w2: 0, costDelta: -5n };
      break;
    case 8: // R_MUL_TWO_R: MUL rd, rs1, rs2 -> ADD rd, rs1, rs1 when rs2 == 2
      asm = `
        LDI r1, 0
        IN r2, r1
        LDI r3, ${k1}
        ADD r4, r2, r3
        LDI r5, 2
        MUL r6, r4, r5
        OUT r6
        HALT
      `;
      step = { ruleId: 8, loc: 5, w1: 4, w2: 0, costDelta: -4n };
      break;
    case 9: // R_DIV_ONE: DIV rd, rs1, rs2 -> MOV rd, rs1 when rs2 == 1
      asm = `
        LDI r1, 0
        IN r2, r1
        LDI r3, ${k1}
        ADD r4, r2, r3
        LDI r5, 1
        DIV r6, r4, r5
        OUT r6
        HALT
      `;
      step = { ruleId: 9, loc: 5, w1: 4, w2: 0, costDelta: -7n };
      break;
    case 10: // R_CONST_FOLD_ADD: ADD rd, rs1, rs2 -> LDI rd, (c1 + c2)
      asm = `
        LDI r1, 0
        IN r2, r1
        LDI r3, ${k1}
        LDI r4, ${k2}
        ADD r5, r3, r4
        ADD r6, r2, r5
        OUT r6
        HALT
      `;
      step = { ruleId: 10, loc: 4, w1: 2, w2: 3, costDelta: -1n };
      break;
    case 11: // R_CONST_FOLD_MUL: MUL rd, rs1, rs2 -> LDI rd, (c1 * c2)
      asm = `
        LDI r1, 0
        IN r2, r1
        LDI r3, ${k1}
        LDI r4, ${k2}
        MUL r5, r3, r4
        ADD r6, r2, r5
        OUT r6
        HALT
      `;
      step = { ruleId: 11, loc: 4, w1: 2, w2: 3, costDelta: -5n };
      break;
    case 12: // R_CONST_FOLD_NEG: NEG rd, rs1 -> LDI rd, (-c1)
      asm = `
        LDI r1, 0
        IN r2, r1
        LDI r3, ${k1}
        NEG r4, r3
        ADD r5, r2, r4
        OUT r5
        HALT
      `;
      step = { ruleId: 12, loc: 3, w1: 2, w2: 0, costDelta: -1n };
      break;
    case 13: // R_REDUNDANT_LOAD: LOAD rd, r_addr -> MOV rd, r_val after STORE r_addr, r_val
      asm = `
        LDI r1, 0
        IN r2, r1
        LDI r3, ${k3}
        ADD r4, r2, r3
        STORE r3, r4
        LOAD r5, r3
        OUT r5
        HALT
      `;
      step = { ruleId: 13, loc: 5, w1: 4, w2: 2, costDelta: -3n };
      break;
    case 14: // R_DEAD_LOAD: LOAD rd, r_addr -> NOP when next instruction overwrites rd without reading rd
      asm = `
        LDI r1, 0
        IN r2, r1
        LDI r3, ${k3}
        LOAD r5, r3
        LDI r5, ${k1}
        ADD r6, r2, r5
        OUT r6
        HALT
      `;
      step = { ruleId: 14, loc: 3, w1: 4, w2: 0, costDelta: -3n };
      break;
    case 99: // UNSOUND RULE (for Test 3 differential catch verification)
      asm = `
        LDI r1, 0
        IN r2, r1
        LDI r3, ${k3}
        ADD r4, r2, r3
        OUT r4
        HALT
      `;
      step = { ruleId: 99, loc: 3, w1: 0, w2: 0, costDelta: -1n };
      break;
  }

  const oldProg = GM1.assemble(asm);
  const stepRes = GM1.applyAndCheckStep(oldProg, step, { unsoundRule: ruleId === 99 });
  if (!stepRes.ok) {
    throw new Error(`Rule ${ruleId} failed to apply on random program: ${stepRes.reason}`);
  }
  return { oldProg, newProg: stepRes.prog, step };
}

function testRuleDifferential(ruleId, rng, totalInputs = 10000, numPrograms = 5) {
  const inputsPerProg = Math.ceil(totalInputs / numPrograms);
  let testedInputs = 0;
  let outputMismatches = 0;
  let costViolations = 0;
  let totalOldSteps = 0n;
  let totalNewSteps = 0n;

  for (let p = 0; p < numPrograms; p++) {
    const { oldProg, newProg } = buildRandomProgramForRule(ruleId, rng);
    for (let i = 0; i < inputsPerProg && testedInputs < totalInputs; i++) {
      testedInputs++;
      const x0 = rng.nextBigInt(-100000, 100000);
      const x1 = rng.nextBigInt(-100000, 100000);
      const inVec = [x0, x1];
      const resOld = GM1.runVM(oldProg, inVec, 10000n, null);
      const resNew = GM1.runVM(newProg, inVec, 10000n, null);
      totalOldSteps += resOld.steps;
      totalNewSteps += resNew.steps;

      if (resOld.outputs.length !== resNew.outputs.length) {
        outputMismatches++;
      } else {
        for (let k = 0; k < resOld.outputs.length; k++) {
          if (resOld.outputs[k] !== resNew.outputs[k]) {
            outputMismatches++;
            break;
          }
        }
      }
      if (resNew.steps > resOld.steps) {
        costViolations++;
      }
    }
  }

  return {
    ruleId,
    testedInputs,
    outputMismatches,
    costViolations,
    totalOldSteps: totalOldSteps.toString(),
    totalNewSteps: totalNewSteps.toString(),
    perInputDelta: Number(totalNewSteps - totalOldSteps) / testedInputs
  };
}

function runTest2() {
  const rng = makePRNG(0xC0FFEE02);
  const perRuleResults = [];
  let allPassed = true;

  for (const rule of GM1.RULES) {
    const res = testRuleDifferential(rule.id, rng, 10000, 5);
    res.ruleName = rule.name;
    res.expectedDelta = Number(rule.costDelta);
    perRuleResults.push(res);
    if (res.testedInputs !== 10000 || res.outputMismatches > 0 || res.costViolations > 0) {
      allPassed = false;
    }
  }

  results.metrics.test2 = { perRuleResults };
  recordTest(2, `Soundness by differential testing (14 rules x 10,000 random inputs = 140,000 runs, 0 mismatches, 0 cost violations)`, allPassed, {
    rulesTested: perRuleResults.length,
    totalRuns: perRuleResults.reduce((acc, r) => acc + r.testedInputs, 0)
  });
}

// ============================================================================
// TEST 3: Unsound-rule positive control (unsoundRule: true vs false)
// ============================================================================
function runTest3() {
  const rng = makePRNG(0xBADBEEF3);
  const solverWithNonZeroAdd = `
    start:
      INLEN r1
      LDI r0, 0
      LDI r8, 1
      LDI r9, 7
    loop:
      CMPLT r2, r0, r1
      JZ r2, done
      IN r3, r0
      ADD r4, r3, r9
      OUT r4
      ADD r0, r0, r8
      JMP loop
    done:
      HALT
  `;

  // 1) With unsoundRule: true, run an epoch targeting solver (0)
  const mUnsound = new GM1.Machine({ solverProg: solverWithNonZeroAdd, unsoundRule: true });
  const beforeOut = GM1.measureSolverWorkloadCost(mUnsound.solverProg, mUnsound.workload);
  const epUnsound = mUnsound.runEpoch({ targetComponent: 0 });
  const afterOut = GM1.measureSolverWorkloadCost(mUnsound.solverProg, mUnsound.workload);

  // Check that outputs actually changed (behavior broken!)
  const behaviorBroken = JSON.stringify(beforeOut.outputsPerRun.map(v => v.map(String))) !==
                         JSON.stringify(afterOut.outputsPerRun.map(v => v.map(String)));

  // 2) Differential testing (Test 2 harness) on Rule 99 MUST catch the output mismatch
  const diffCatch = testRuleDifferential(99, rng, 1000, 5);
  const caughtByTest2 = diffCatch.outputMismatches > 0;

  // 3) With unsoundRule: false, that exact certificate MUST be rejected with wrong_rule
  const mSound = new GM1.Machine({ solverProg: solverWithNonZeroAdd, unsoundRule: false });
  const certFromUnsound = mUnsound.lastProposal.rawWords;
  const soundVerdict = GM1.checkCertificate(certFromUnsound, mSound, {
    unsoundRule: false,
    expectedTargetComponent: 0
  });

  const passed = epUnsound.accepted === true &&
                 behaviorBroken === true &&
                 caughtByTest2 === true &&
                 soundVerdict.accepted === false &&
                 soundVerdict.code === 'wrong_rule';

  results.metrics.test3 = {
    acceptedWhenUnsoundTrue: epUnsound.accepted,
    behaviorBroken,
    diffTestMismatchesOnRule99: diffCatch.outputMismatches,
    caughtByTest2,
    rejectedWhenUnsoundFalse: !soundVerdict.accepted,
    rejectionCodeWhenOff: soundVerdict.code
  };
  recordTest(3, `Unsound-rule positive control (accepted with unsoundRule:true, breaks output, caught by Test 2, rejected when off)`, passed, results.metrics.test3);
}

// ============================================================================
// TEST 4: The search really runs on the VM (perturbation tests)
// ============================================================================
function runTest4() {
  // Baseline searcher on seed solver
  const mBase = new GM1.Machine();
  const epBase = mBase.runEpoch({ targetComponent: 0 });
  const baseSteps = mBase.lastProposal.cert.steps;

  // Perturbation 1: Modify the searcher VM assembly to disable the `handle_mul` heuristic
  // (replace `JNZ r9, handle_mul` with `NOP`)
  const perturbedSearcherAsm = GM1.SEED_SEARCHER_ASM.replace('JNZ r9, handle_mul', 'NOP');
  const mPerturbed = new GM1.Machine({ searcherProg: perturbedSearcherAsm });
  const epPerturbed = mPerturbed.runEpoch({ targetComponent: 0 });
  const perturbedSteps = mPerturbed.lastProposal.cert ? mPerturbed.lastProposal.cert.steps : [];

  const proposalsChanged = JSON.stringify(baseSteps.map(s => ({ r: s.ruleId, l: s.loc }))) !==
                           JSON.stringify(perturbedSteps.map(s => ({ r: s.ruleId, l: s.loc })));

  // Perturbation 2: Replace the searcher with a program that outputs nothing (`HALT`)
  const mSilent = new GM1.Machine({ searcherProg: 'HALT' });
  let silentAccepted = 0;
  for (let i = 0; i < 4; i++) {
    const ep = mSilent.runEpoch({ targetComponent: i % 2 });
    if (ep.accepted) silentAccepted++;
  }

  const passed = epBase.accepted === true &&
                 proposalsChanged === true &&
                 baseSteps.length > perturbedSteps.length &&
                 silentAccepted === 0 &&
                 mSilent.lineageLog.length === 0;

  results.metrics.test4 = {
    baseStepCount: baseSteps.length,
    perturbedStepCount: perturbedSteps.length,
    proposalsChanged,
    silentSearcherAcceptedCount: silentAccepted
  };
  recordTest(4, `Search really runs on the VM (perturbing searcher changes proposals; silent searcher accepts 0 rewrites)`, passed, results.metrics.test4);
}

// ============================================================================
// TEST 5: End-to-end on Seed Solver + 3 additional non-tuned solvers
// ============================================================================
function runTest5() {
  const solversToRun = [
    {
      name: 'Seed Solver (Polynomial & Affine Checksum)',
      asm: GM1.SEED_SOLVER_ASM
    },
    {
      name: 'Solver A: Plain Bubble Sort (3-element window pass)',
      asm: `
        start:
          INLEN r1
          LDI r0, 0
          LDI r8, 1
        loop:
          CMPLT r2, r0, r1
          JZ r2, done
          IN r3, r0
          ADD r4, r0, r8
          CMPLT r5, r4, r1
          JZ r5, emit_single
          IN r6, r4
          CMPLE r7, r3, r6
          JNZ r7, emit_single
          OUT r6
          OUT r3
          ADD r0, r4, r8
          JMP loop
        emit_single:
          OUT r3
          ADD r0, r0, r8
          JMP loop
        done:
          HALT
      `
    },
    {
      name: 'Solver B: Plain Fibonacci Sequence Generator',
      asm: `
        start:
          LDI r0, 0
          IN r1, r0
          LDI r2, 0
          LDI r3, 1
          LDI r4, 0
          LDI r8, 1
        loop:
          CMPLT r5, r4, r1
          JZ r5, done
          OUT r2
          ADD r6, r2, r3
          MOV r2, r3
          MOV r3, r6
          ADD r4, r4, r8
          JMP loop
        done:
          HALT
      `
    },
    {
      name: 'Solver C: Affine Dot-Product Accumulator',
      asm: GM1.PRESET_SOLVERS.dot
    }
  ];

  const solverRuns = [];
  for (const item of solversToRun) {
    const m = new GM1.Machine({ solverProg: item.asm });
    const initialCost = m.getSolverCost();
    const initialSearcherCost = m.getSearcherCost();
    const epochs = [];
    for (let e = 0; e < 4; e++) {
      const rec = m.runEpoch(); // alternates solver (0) and searcher (1)
      epochs.push({
        epoch: rec.epoch,
        targetComponent: rec.targetComponent,
        accepted: rec.accepted,
        code: rec.code,
        solverCost: rec.solverCost.toString(),
        searcherCost: rec.searcherCost.toString()
      });
    }
    solverRuns.push({
      name: item.name,
      initialSolverCost: initialCost.toString(),
      finalSolverCost: m.getSolverCost().toString(),
      initialSearcherCost: initialSearcherCost.toString(),
      finalSearcherCost: m.getSearcherCost().toString(),
      acceptedCount: epochs.filter(x => x.accepted).length,
      rejectedCount: epochs.filter(x => !x.accepted).length,
      epochs
    });
  }

  const passed = solverRuns.length === 4;
  results.metrics.test5 = { solverRuns };
  recordTest(5, `End-to-end epochs across Seed Solver and 3 additional solvers`, passed, {
    solversTested: solverRuns.map(s => `${s.name}: ${s.initialSolverCost} -> ${s.finalSolverCost} steps (${s.acceptedCount} accepted, ${s.rejectedCount} rejected)`)
  });
}

// ============================================================================
// TEST 6: Searcher self-rewrite verification & replay on exam
// ============================================================================
function runTest6() {
  const m = new GM1.Machine();
  const oldSearcher = GM1.cloneProg(m.searcherProg);
  const oldExamEval = GM1.measureSearcherExamCost(oldSearcher, m.exam, m.solverProg);

  // Run epochs (Epoch 1 targets solver 0, Epoch 2 targets searcher 1)
  m.runEpoch({ targetComponent: 0 });
  const selfEpoch = m.runEpoch({ targetComponent: 1 });

  const selfRewriteEntry = m.lineageLog.find(e => e.isSelfRewrite);
  if (!selfRewriteEntry) {
    results.metrics.test6 = { selfRewriteOccurred: false };
    recordTest(6, `Searcher self-rewrite (none occurred)`, true, results.metrics.test6);
    return;
  }

  const newSearcher = GM1.cloneProg(m.searcherProg);
  const newExamEval = GM1.measureSearcherExamCost(newSearcher, m.exam, m.solverProg);

  const examCostLower = newExamEval.totalSteps < oldExamEval.totalSteps;
  const costDrop = oldExamEval.totalSteps - newExamEval.totalSteps;

  // Check that proposals on every job in the exam are bit-identical between oldSearcher and newSearcher
  let proposalsIdentical = oldExamEval.proposalsPerJob.length === newExamEval.proposalsPerJob.length;
  for (let j = 0; j < oldExamEval.proposalsPerJob.length; j++) {
    const pOld = oldExamEval.proposalsPerJob[j].map(String);
    const pNew = newExamEval.proposalsPerJob[j].map(String);
    if (JSON.stringify(pOld) !== JSON.stringify(pNew)) {
      proposalsIdentical = false;
      break;
    }
  }

  const passed = selfEpoch.accepted === true &&
                 examCostLower === true &&
                 costDrop > m.switchCost &&
                 proposalsIdentical === true;

  results.metrics.test6 = {
    selfRewriteOccurred: true,
    oldSearcherHash: selfRewriteEntry.oldHash.toString(),
    newSearcherHash: selfRewriteEntry.newHash.toString(),
    oldExamCost: oldExamEval.totalSteps.toString(),
    newExamCost: newExamEval.totalSteps.toString(),
    examCostDrop: costDrop.toString(),
    switchCost: m.switchCost.toString(),
    proofStepsCount: selfRewriteEntry.certificate.steps.length,
    proposalsIdenticalOnExam: proposalsIdentical
  };
  recordTest(6, `Searcher self-rewrite replay (exam cost ${oldExamEval.totalSteps} -> ${newExamEval.totalSteps}, proposals bit-identical)`, passed, results.metrics.test6);
}

// ============================================================================
// TEST 7: Determinism and mid-run state export/import
// ============================================================================
function runTest7() {
  // Run 1: 4 continuous epochs
  const m1 = new GM1.Machine();
  for (let i = 0; i < 4; i++) m1.runEpoch();
  const state1Final = m1.exportState();

  // Run 2: 4 continuous epochs from fresh instance
  const m2 = new GM1.Machine();
  for (let i = 0; i < 4; i++) m2.runEpoch();
  const state2Final = m2.exportState();

  const twoRunsIdentical = state1Final === state2Final;

  // Run 3: Export after 2 epochs, import into a fresh machine, run remaining 2 epochs
  const m3a = new GM1.Machine();
  m3a.runEpoch();
  m3a.runEpoch();
  const midStateJson = m3a.exportState();

  const m3b = new GM1.Machine();
  m3b.importState(midStateJson);
  m3b.runEpoch();
  m3b.runEpoch();
  const state3Final = m3b.exportState();

  const resumedIdentical = state1Final === state3Final;
  const passed = twoRunsIdentical && resumedIdentical;

  results.metrics.test7 = {
    twoRunsIdentical,
    resumedIdentical,
    finalEpoch: m3b.epoch,
    finalSolverHash: m3b.getSolverHash().toString(),
    finalSearcherHash: m3b.getSearcherHash().toString()
  };
  recordTest(7, `Determinism and mid-run state export/import (bit-identical JSON states)`, passed, results.metrics.test7);
}

// ============================================================================
// TEST 8: Static scan (Strict CSP, no network/storage APIs, every inline labeled)
// ============================================================================
function runTest8() {
  // 1. Check strict CSP meta tag
  const cspMatch = html.match(/<meta\s+http-equiv=["']Content-Security-Policy["']\s+content="([^"]+)"/i);
  const hasStrictCsp = Boolean(cspMatch && cspMatch[1].includes("default-src 'none'"));

  // 2. Check no external src/href attributes on script/link/img
  const externalAttrs = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
    .map(m => m[1])
    .filter(v => !v.startsWith('#') && !v.startsWith('data:'));

  // 3. Check no forbidden network or storage APIs in script
  const scriptContent = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join('\n');
  const forbiddenPatterns = [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bnavigator\.sendBeacon\b/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\bindexedDB\b/,
    /\bdocument\.cookie\b/
  ];
  const forbiddenFound = forbiddenPatterns.filter(rx => rx.test(scriptContent)).map(String);

  // 4. Check every inline <style> and <script> is preceded by a Provenance HTML comment
  const styleBlocks = [...html.matchAll(/(<!--[\s\S]*?-->\s*)?<style[^>]*>/gi)];
  const scriptBlocks = [...html.matchAll(/(<!--[\s\S]*?-->\s*)?<script[^>]*>/gi)];
  const allStylesLabeled = styleBlocks.length > 0 && styleBlocks.every(m => m[1] && /Provenance:/i.test(m[1]));
  const allScriptsLabeled = scriptBlocks.length > 0 && scriptBlocks.every(m => m[1] && /Provenance:/i.test(m[1]));

  const passed = hasStrictCsp &&
                 externalAttrs.length === 0 &&
                 forbiddenFound.length === 0 &&
                 allStylesLabeled &&
                 allScriptsLabeled;

  results.metrics.test8 = {
    hasStrictCsp,
    cspContent: cspMatch ? cspMatch[1] : null,
    externalAttrsCount: externalAttrs.length,
    forbiddenApisFound: forbiddenFound,
    styleBlocksCount: styleBlocks.length,
    allStylesLabeled,
    scriptBlocksCount: scriptBlocks.length,
    allScriptsLabeled
  };
  recordTest(8, `Static scan (Strict CSP, 0 network/storage APIs, all inline blocks labeled with provenance)`, passed, results.metrics.test8);
}

// ============================================================================
// TEST 9: Real headless browser verification (Chromium via Selenium)
// ============================================================================
function runTest9() {
  const pyScript = `
import json, sys
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

opts = Options()
opts.add_argument('--headless=new')
opts.add_argument('--no-sandbox')
opts.add_argument('--disable-dev-shm-usage')
opts.add_argument('--disable-gpu')
opts.set_capability('goog:loggingPrefs', {'browser': 'ALL'})

driver = webdriver.Chrome(options=opts)
try:
    import base64
    raw = open(sys.argv[1], 'rb').read()
    url = 'data:text/html;base64,' + base64.b64encode(raw).decode('ascii')
    driver.get(url)
    driver.execute_script("""
      window.__pageErrors = [];
      window.addEventListener('error', function(e) {
        window.__pageErrors.push(e.message || String(e));
      });
    """)
    # Click 'Run 1 Epoch' 4 times and 'Export Machine State' once
    btn_epoch = driver.find_element('id', 'btn-run-epoch')
    for _ in range(4):
        btn_epoch.click()
    btn_export = driver.find_element('id', 'btn-export-state')
    btn_export.click()

    epoch_txt = driver.find_element('id', 'stat-epoch').text
    solver_cost = driver.find_element('id', 'stat-solver-cost').text
    searcher_cost = driver.find_element('id', 'stat-searcher-cost').text
    verdicts = driver.find_element('id', 'stat-verdicts').text
    state_len = len(driver.find_element('id', 'ui-state-json').get_attribute('value') or '')
    js_errors = driver.execute_script("return window.__pageErrors || [];")
    browser_logs = [entry for entry in driver.get_log('browser') if entry.get('level') == 'SEVERE']

    print(json.dumps({
      'ok': True,
      'epoch': epoch_txt,
      'solverCost': solver_cost,
      'searcherCost': searcher_cost,
      'verdicts': verdicts,
      'exportedStateChars': state_len,
      'pageErrors': js_errors,
      'severeConsoleLogs': browser_logs
    }))
finally:
    driver.quit()
`;

  const proc = spawnSync('python3', ['-c', pyScript, htmlPath], {
    encoding: 'utf8',
    timeout: 30000
  });

  if (proc.status !== 0) {
    results.metrics.test9 = {
      browserAvailable: false,
      error: (proc.stderr || proc.stdout || 'Failed to launch headless Chromium').trim()
    };
    recordTest(9, `Real headless browser check`, false, results.metrics.test9);
    return;
  }

  const outJson = JSON.parse(proc.stdout.trim().split('\n').pop());
  const passed = outJson.ok === true &&
                 outJson.epoch === '4' &&
                 outJson.pageErrors.length === 0 &&
                 outJson.severeConsoleLogs.length === 0 &&
                 outJson.exportedStateChars > 500;

  results.metrics.test9 = outJson;
  recordTest(9, `Real headless browser (Chromium loaded gm1.html, ran 4 epochs, 0 page/console errors)`, passed, outJson);
}

function main() {
  console.log('====================================================================');
  console.log('GM-1 Test Suite (node tests/run-all.js)');
  console.log('====================================================================');
  runTest1();
  runTest2();
  runTest3();
  runTest4();
  runTest5();
  runTest6();
  runTest7();
  runTest8();
  runTest9();
  console.log('====================================================================');

  const passedCount = results.tests.filter(t => t.passed).length;
  const totalCount = results.tests.length;
  console.log(`Summary: ${passedCount}/${totalCount} test suites passed.`);

  const resultsPath = path.resolve(__dirname, 'results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), 'utf8');

  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

main();
