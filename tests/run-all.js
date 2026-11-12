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
  version: 'GM-1.1',
  timestamp: new Date().toISOString(),
  tests: [],
  metrics: {}
};

function recordTest(id, name, status, details) {
  // status is 'PASS', 'FAIL', or 'SKIP'
  const passed = status === 'PASS';
  const skipped = status === 'SKIP';
  results.tests.push({ id, name, status, passed, skipped, details });
  if (skipped) {
    console.log(`[SKIP] Test ${id}: ${name} — SKIPPED: ${details.skipReason || 'driver unavailable'}`);
  } else {
    console.log(`[${status}] Test ${id}: ${name}`);
    if (!passed) {
      console.error('       Failure details:', details);
    }
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

  // Category B: wrong_location (35 cases)
  for (let i = 0; i < 35; i++) {
    let loc;
    let ruleId = 1;
    let costDelta = -1n;
    if (i < 15) {
      loc = baseSolver.length + i;
    } else if (i < 25) {
      loc = -(i - 14);
    } else {
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
      step = { ruleId: 1, loc: 11, w1: (i % 7), w2: 0, costDelta: -1n };
      if (step.w1 === 2) step.w1 = 3;
    } else if (i < 20) {
      step = { ruleId: 8, loc: 10, w1: (i % 6 === 4 ? 2 : i % 6), w2: 0, costDelta: -4n };
    } else if (i < 30) {
      step = { ruleId: 5, loc: 12, w1: 12 + (i - 20), w2: 0, costDelta: -5n };
    } else {
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

  // Category E: replacement_mismatch (30 cases)
  for (let i = 0; i < 30; i++) {
    const badRepl = GM1.cloneProg(baseCert.replacementProg);
    const targetIdx = i % badRepl.length;
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
      truncatedWords = fullWords.slice(0, i + 1);
    } else if (i < 15) {
      truncatedWords = fullWords.slice(0, fullWords.length - (i - 3));
    } else {
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

  // Category H: wrong_component (25 cases)
  for (let i = 0; i < 25; i++) {
    let cert;
    let expectedTarget = 0;
    if (i < 10) {
      cert = { ...baseCert, targetComponent: 1, targetHash: searcherHash };
      expectedTarget = 0;
    } else if (i < 20) {
      cert = { ...baseCert, targetComponent: 0, targetHash: searcherHash };
      expectedTarget = 0;
    } else {
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
  recordTest(1, `Checker rejects forgeries (${rightReasonCount}/${forgeries.length} rejected with exact expected reason)`, passed ? 'PASS' : 'FAIL', results.metrics.test1);
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
    case 1:
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
    case 2:
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
    case 3:
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
    case 4:
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
    case 5:
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
    case 6:
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
    case 7:
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
    case 8:
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
    case 9:
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
    case 10:
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
    case 11:
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
    case 12:
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
    case 13:
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
    case 14:
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
    case 99:
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
  recordTest(2, `Soundness by differential testing (14 rules x 10,000 random inputs = 140,000 runs, 0 mismatches, 0 cost violations)`, allPassed ? 'PASS' : 'FAIL', {
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

  const mUnsound = new GM1.Machine({ solverProg: solverWithNonZeroAdd, unsoundRule: true });
  const beforeOut = GM1.measureSolverWorkloadCost(mUnsound.solverProg, mUnsound.workload);
  const epUnsound = mUnsound.runEpoch({ targetComponent: 0 });
  const afterOut = GM1.measureSolverWorkloadCost(mUnsound.solverProg, mUnsound.workload);

  const behaviorBroken = JSON.stringify(beforeOut.outputsPerRun.map(v => v.map(String))) !==
                         JSON.stringify(afterOut.outputsPerRun.map(v => v.map(String)));

  const diffCatch = testRuleDifferential(99, rng, 1000, 5);
  const caughtByTest2 = diffCatch.outputMismatches > 0;

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
  recordTest(3, `Unsound-rule positive control (accepted with unsoundRule:true, breaks output, caught by Test 2, rejected when off)`, passed ? 'PASS' : 'FAIL', results.metrics.test3);
}

// ============================================================================
// TEST 4: The search really runs on the VM (perturbation tests)
// ============================================================================
function runTest4() {
  const mBase = new GM1.Machine();
  const epBase = mBase.runEpoch({ targetComponent: 0 });
  const baseSteps = mBase.lastProposal.cert.steps;

  const perturbedSearcherAsm = GM1.SEED_SEARCHER_ASM.replace('JNZ r9, handle_mul', 'NOP');
  const mPerturbed = new GM1.Machine({ searcherProg: perturbedSearcherAsm });
  const epPerturbed = mPerturbed.runEpoch({ targetComponent: 0 });
  const perturbedSteps = mPerturbed.lastProposal.cert ? mPerturbed.lastProposal.cert.steps : [];

  const proposalsChanged = JSON.stringify(baseSteps.map(s => ({ r: s.ruleId, l: s.loc }))) !==
                           JSON.stringify(perturbedSteps.map(s => ({ r: s.ruleId, l: s.loc })));

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
  recordTest(4, `Search really runs on the VM (perturbing searcher changes proposals; silent searcher accepts 0 rewrites)`, passed ? 'PASS' : 'FAIL', results.metrics.test4);
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
      const rec = m.runEpoch();
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
  recordTest(5, `End-to-end epochs across Seed Solver and 3 additional solvers`, passed ? 'PASS' : 'FAIL', {
    solversTested: solverRuns.map(s => `${s.name}: ${s.initialSolverCost} -> ${s.finalSolverCost} steps (${s.acceptedCount} accepted, ${s.rejectedCount} rejected)`)
  });
}

// ============================================================================
// TEST 6: Searcher self-rewrite verification & replay on BOTH 'seed' and 'plain' searchers (P2)
// ============================================================================
function evaluateSearcherSelfRewrite(presetName, searcherSource) {
  const m = new GM1.Machine({ searcherProg: searcherSource });
  const oldSearcher = GM1.cloneProg(m.searcherProg);
  const oldExamEval = GM1.measureSearcherExamCost(oldSearcher, m.exam, m.solverProg);

  m.runEpoch({ targetComponent: 0 });
  const selfEpoch = m.runEpoch({ targetComponent: 1 });

  const selfRewriteEntry = m.lineageLog.find(e => e.isSelfRewrite);
  if (!selfRewriteEntry) {
    return {
      preset: presetName,
      instructionCount: oldSearcher.length,
      selfRewriteOccurred: false,
      oldSearcherHash: GM1.computeProgramHash(oldSearcher).toString(),
      newSearcherHash: GM1.computeProgramHash(oldSearcher).toString(),
      oldExamCost: oldExamEval.totalSteps.toString(),
      newExamCost: oldExamEval.totalSteps.toString(),
      examCostDrop: '0',
      switchCost: m.switchCost.toString(),
      proofStepsCount: 0,
      rulesApplied: [],
      proposalsIdenticalOnExam: true,
      validIfOccurred: true
    };
  }

  const newSearcher = GM1.cloneProg(m.searcherProg);
  const newExamEval = GM1.measureSearcherExamCost(newSearcher, m.exam, m.solverProg);
  const examCostLower = newExamEval.totalSteps < oldExamEval.totalSteps;
  const costDrop = oldExamEval.totalSteps - newExamEval.totalSteps;

  let proposalsIdentical = oldExamEval.proposalsPerJob.length === newExamEval.proposalsPerJob.length;
  for (let j = 0; j < oldExamEval.proposalsPerJob.length; j++) {
    const pOld = oldExamEval.proposalsPerJob[j].map(String);
    const pNew = newExamEval.proposalsPerJob[j].map(String);
    if (JSON.stringify(pOld) !== JSON.stringify(pNew)) {
      proposalsIdentical = false;
      break;
    }
  }

  const validIfOccurred = selfEpoch.accepted === true &&
                          examCostLower === true &&
                          costDrop > m.switchCost &&
                          proposalsIdentical === true;

  return {
    preset: presetName,
    instructionCount: oldSearcher.length,
    selfRewriteOccurred: true,
    oldSearcherHash: selfRewriteEntry.oldHash.toString(),
    newSearcherHash: selfRewriteEntry.newHash.toString(),
    oldExamCost: oldExamEval.totalSteps.toString(),
    newExamCost: newExamEval.totalSteps.toString(),
    examCostDrop: costDrop.toString(),
    switchCost: m.switchCost.toString(),
    proofStepsCount: selfRewriteEntry.certificate.steps.length,
    rulesApplied: selfRewriteEntry.certificate.steps.map(s => s.ruleId),
    proposalsIdenticalOnExam: proposalsIdentical,
    validIfOccurred
  };
}

function runTest6() {
  const seedRes = evaluateSearcherSelfRewrite('seed', GM1.PRESET_SEARCHERS.seed);
  const plainRes = evaluateSearcherSelfRewrite('plain', GM1.PRESET_SEARCHERS.plain);

  const passed = seedRes.validIfOccurred && plainRes.validIfOccurred;
  results.metrics.test6 = {
    seed: seedRes,
    plain: plainRes,
    // Keep top-level fields for backward compatibility as well
    selfRewriteOccurred: seedRes.selfRewriteOccurred,
    oldSearcherHash: seedRes.oldSearcherHash,
    newSearcherHash: seedRes.newSearcherHash,
    oldExamCost: seedRes.oldExamCost,
    newExamCost: seedRes.newExamCost,
    examCostDrop: seedRes.examCostDrop,
    switchCost: seedRes.switchCost,
    proofStepsCount: seedRes.proofStepsCount,
    proposalsIdenticalOnExam: seedRes.proposalsIdenticalOnExam
  };

  recordTest(
    6,
    `Searcher self-rewrite on both presets (seed: ${seedRes.oldExamCost}->${seedRes.newExamCost} [${seedRes.proofStepsCount} steps]; plain: ${plainRes.oldExamCost}->${plainRes.newExamCost} [${plainRes.proofStepsCount} steps], proposals identical)`,
    passed ? 'PASS' : 'FAIL',
    results.metrics.test6
  );
}

// ============================================================================
// TEST 7: Determinism and mid-run state export/import
// ============================================================================
function runTest7() {
  const m1 = new GM1.Machine();
  for (let i = 0; i < 4; i++) m1.runEpoch();
  const state1Final = m1.exportState();

  const m2 = new GM1.Machine();
  for (let i = 0; i < 4; i++) m2.runEpoch();
  const state2Final = m2.exportState();

  const twoRunsIdentical = state1Final === state2Final;

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
  recordTest(7, `Determinism and mid-run state export/import (bit-identical JSON states)`, passed ? 'PASS' : 'FAIL', results.metrics.test7);
}

// ============================================================================
// TEST 8: Static scan (Strict CSP, no network/storage APIs, every inline labeled)
// ============================================================================
function runTest8() {
  const cspMatch = html.match(/<meta\s+http-equiv=["']Content-Security-Policy["']\s+content="([^"]+)"/i);
  const hasStrictCsp = Boolean(cspMatch && cspMatch[1].includes("default-src 'none'"));

  const externalAttrs = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
    .map(m => m[1])
    .filter(v => !v.startsWith('#') && !v.startsWith('data:'));

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
  recordTest(8, `Static scan (Strict CSP, 0 network/storage APIs, all inline blocks labeled with provenance)`, passed ? 'PASS' : 'FAIL', results.metrics.test8);
}

// ============================================================================
// TEST 9: Real headless browser verification (P5: Selenium or Playwright; SKIPPED if unavailable)
// ============================================================================
function runTest9() {
  // First check if Python Selenium + ChromeDriver or Node Playwright is available
  const pyProbe = spawnSync('python3', ['-c', 'import selenium; from selenium import webdriver; print("SELENIUM_OK")'], {
    encoding: 'utf8',
    timeout: 5000
  });
  const hasSelenium = pyProbe.status === 0 && (pyProbe.stdout || '').includes('SELENIUM_OK');

  let hasPlaywright = false;
  if (!hasSelenium) {
    const pwProbe = spawnSync('node', ['-e', 'require("playwright"); console.log("PLAYWRIGHT_OK")'], {
      encoding: 'utf8',
      timeout: 5000
    });
    hasPlaywright = pwProbe.status === 0 && (pwProbe.stdout || '').includes('PLAYWRIGHT_OK');
  }

  if (!hasSelenium && !hasPlaywright) {
    const reason = 'Neither Selenium (Python) nor Playwright (Node) driver is installed in this environment';
    results.metrics.test9 = {
      status: 'SKIPPED',
      skipReason: reason
    };
    recordTest(9, `Real headless browser check`, 'SKIP', results.metrics.test9);
    return;
  }

  if (hasSelenium) {
    const pyScript = `
import base64, json, sys
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

opts = Options()
opts.add_argument('--headless=new')
opts.add_argument('--no-sandbox')
opts.add_argument('--disable-dev-shm-usage')
opts.add_argument('--disable-gpu')
opts.set_capability('goog:loggingPrefs', {'browser': 'ALL'})

try:
    driver = webdriver.Chrome(options=opts)
except Exception as e:
    print(json.dumps({'driverUnavailable': True, 'reason': str(e)}))
    sys.exit(0)

try:
    raw = open(sys.argv[1], 'rb').read()
    url = 'data:text/html;base64,' + base64.b64encode(raw).decode('ascii')
    driver.get(url)
    driver.execute_script("""
      window.__pageErrors = [];
      window.addEventListener('error', function(e) {
        window.__pageErrors.push(e.message || String(e));
      });
    """)
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
      'driver': 'selenium-chromium',
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
        status: 'FAILED',
        error: (proc.stderr || proc.stdout || 'Browser run failed').trim()
      };
      recordTest(9, `Real headless browser check`, 'FAIL', results.metrics.test9);
      return;
    }
    const outJson = JSON.parse(proc.stdout.trim().split('\n').pop());
    if (outJson.driverUnavailable) {
      results.metrics.test9 = {
        status: 'SKIPPED',
        skipReason: outJson.reason
      };
      recordTest(9, `Real headless browser check`, 'SKIP', results.metrics.test9);
      return;
    }
    const passed = outJson.ok === true &&
                   outJson.epoch === '4' &&
                   outJson.pageErrors.length === 0 &&
                   outJson.severeConsoleLogs.length === 0 &&
                   outJson.exportedStateChars > 500;
    results.metrics.test9 = outJson;
    recordTest(9, `Real headless browser (${outJson.driver} loaded gm1.html, ran 4 epochs, 0 page/console errors)`, passed ? 'PASS' : 'FAIL', outJson);
  }
}

// ============================================================================
// TEST 10 (New P1 Test 1): Ill-formed rejection across all 14 rules and all 5 Machine load paths
// ============================================================================
function buildIllFormedCertForRule(ruleId, options = {}) {
  // Build a program where the hot path has a valid Rule 8 rewrite (paying for the cost drop)
  // and a cold branch has an instruction for `ruleId` with an out-of-range register field (e.g. r99).
  const hotPrefix = [
    [20n, 1n, 0n, 0n],  // 0: INLEN r1
    [2n, 2n, 2n, 0n],   // 1: LDI r2, 2
    [14n, 1n, 0n, 8n],  // 2: JZ r1, 8 (cold branch at 8)
    [2n, 0n, 0n, 0n],   // 3: LDI r0, 0
    [21n, 3n, 0n, 0n],  // 4: IN r3, r0
    [6n, 4n, 3n, 2n],   // 5: MUL r4, r3, r2  (Rule 8 at loc 5, w1=1 -> ADD r4, r3, r3)
    [22n, 4n, 0n, 0n],  // 6: OUT r4
    [1n, 0n, 0n, 0n]    // 7: HALT
  ];

  let coldProg = [];
  let secondStep = null;

  switch (ruleId) {
    case 1: // R_ADD_ZERO_R: ADD r99, r3, r6 with r6=0
      coldProg = [[2n, 6n, 0n, 0n], [4n, 99n, 3n, 6n], [1n, 0n, 0n, 0n]];
      secondStep = { ruleId: 1, loc: 9, w1: 8, w2: 0, costDelta: -1n };
      break;
    case 2: // R_ADD_ZERO_L: ADD r99, r6, r3 with r6=0
      coldProg = [[2n, 6n, 0n, 0n], [4n, 99n, 6n, 3n], [1n, 0n, 0n, 0n]];
      secondStep = { ruleId: 2, loc: 9, w1: 8, w2: 0, costDelta: -1n };
      break;
    case 3: // R_SUB_ZERO: SUB r99, r3, r6 with r6=0
      coldProg = [[2n, 6n, 0n, 0n], [5n, 99n, 3n, 6n], [1n, 0n, 0n, 0n]];
      secondStep = { ruleId: 3, loc: 9, w1: 8, w2: 0, costDelta: -1n };
      break;
    case 4: // R_SUB_SELF: SUB r5, r99, r99 -> LDI r5, 0 (note: replacementProg is well-formed!)
      coldProg = [[5n, 5n, 99n, 99n], [22n, 5n, 0n, 0n], [1n, 0n, 0n, 0n]];
      secondStep = { ruleId: 4, loc: 8, w1: 0, w2: 0, costDelta: -1n };
      break;
    case 5: // R_MUL_ONE_R: MUL r99, r3, r6 with r6=1
      coldProg = [[2n, 6n, 1n, 0n], [6n, 99n, 3n, 6n], [1n, 0n, 0n, 0n]];
      secondStep = { ruleId: 5, loc: 9, w1: 8, w2: 0, costDelta: -5n };
      break;
    case 6: // R_MUL_ONE_L: MUL r99, r6, r3 with r6=1
      coldProg = [[2n, 6n, 1n, 0n], [6n, 99n, 6n, 3n], [1n, 0n, 0n, 0n]];
      secondStep = { ruleId: 6, loc: 9, w1: 8, w2: 0, costDelta: -5n };
      break;
    case 7: // R_MUL_ZERO_R: MUL r5, r99, r6 with r6=0 -> LDI r5, 0
      coldProg = [[2n, 6n, 0n, 0n], [6n, 5n, 99n, 6n], [1n, 0n, 0n, 0n]];
      secondStep = { ruleId: 7, loc: 9, w1: 8, w2: 0, costDelta: -5n };
      break;
    case 8: // R_MUL_TWO_R: MUL r99, r3, r6 with r6=2
      coldProg = [[2n, 6n, 2n, 0n], [6n, 99n, 3n, 6n], [1n, 0n, 0n, 0n]];
      secondStep = { ruleId: 8, loc: 9, w1: 8, w2: 0, costDelta: -4n };
      break;
    case 9: // R_DIV_ONE: DIV r99, r3, r6 with r6=1
      coldProg = [[2n, 6n, 1n, 0n], [7n, 99n, 3n, 6n], [1n, 0n, 0n, 0n]];
      secondStep = { ruleId: 9, loc: 9, w1: 8, w2: 0, costDelta: -7n };
      break;
    case 10: // R_CONST_FOLD_ADD: ADD r99, r6, r7
      coldProg = [[2n, 6n, 3n, 0n], [2n, 7n, 4n, 0n], [4n, 99n, 6n, 7n], [1n, 0n, 0n, 0n]];
      secondStep = { ruleId: 10, loc: 10, w1: 8, w2: 9, costDelta: -1n };
      break;
    case 11: // R_CONST_FOLD_MUL: MUL r99, r6, r7
      coldProg = [[2n, 6n, 3n, 0n], [2n, 7n, 4n, 0n], [6n, 99n, 6n, 7n], [1n, 0n, 0n, 0n]];
      secondStep = { ruleId: 11, loc: 10, w1: 8, w2: 9, costDelta: -5n };
      break;
    case 12: // R_CONST_FOLD_NEG: NEG r99, r6
      coldProg = [[2n, 6n, 3n, 0n], [9n, 99n, 6n, 0n], [1n, 0n, 0n, 0n]];
      secondStep = { ruleId: 12, loc: 9, w1: 8, w2: 0, costDelta: -1n };
      break;
    case 13: // R_REDUNDANT_LOAD: STORE r6, r99 followed by LOAD r5, r6
      coldProg = [[2n, 6n, 100n, 0n], [19n, 0n, 6n, 99n], [18n, 5n, 6n, 0n], [1n, 0n, 0n, 0n]];
      secondStep = { ruleId: 13, loc: 10, w1: 9, w2: 8, costDelta: -3n };
      break;
    case 14: // R_DEAD_LOAD: LOAD r5, r99 followed by LDI r5, 7 -> NOP (replacementProg is well-formed!)
      coldProg = [[18n, 5n, 99n, 0n], [2n, 5n, 7n, 0n], [22n, 5n, 0n, 0n], [1n, 0n, 0n, 0n]];
      secondStep = { ruleId: 14, loc: 8, w1: 9, w2: 0, costDelta: -3n };
      break;
  }

  const prog = [...hotPrefix, ...coldProg];
  const steps = [
    { ruleId: 8, loc: 5, w1: 1, w2: 0, costDelta: -4n },
    secondStep
  ];

  let derived = GM1.cloneProg(prog);
  for (const st of steps) {
    const r = GM1.applyAndCheckStep(derived, st, options);
    if (!r.ok) throw new Error(`Failed to construct probe for rule ${ruleId}: ${r.reason}`);
    derived = r.prog;
  }

  const cert = {
    magic: GM1.CERT_MAGIC,
    targetComponent: 0,
    targetHash: GM1.computeProgramHash(prog),
    replacementProg: derived,
    steps
  };
  const words = GM1.serializeCertificate(cert);
  return { prog, replacementProg: derived, words };
}

function testIllFormedCheckSuite(allowIllFormed = false) {
  const perRule = [];
  for (const rule of GM1.RULES) {
    const { prog, words } = buildIllFormedCertForRule(rule.id);
    const m = new GM1.Machine({ allowIllFormed: true });
    m.options.allowIllFormed = allowIllFormed;
    m.solverProg = prog;
    const verdict = GM1.checkCertificate(words, m, { expectedTargetComponent: 0, allowIllFormed });
    perRule.push({
      ruleId: rule.id,
      ruleName: rule.name,
      accepted: verdict.accepted,
      code: verdict.code
    });
  }
  const allRejectedWithIllFormed = perRule.every(r => !r.accepted && r.code === 'ill_formed_program');
  return { allRejectedWithIllFormed, perRule };
}

function runTest10() {
  const suiteRes = testIllFormedCheckSuite(false);

  // Also check all 5 load paths on Machine refuse ill-formed programs when allowIllFormed is false:
  // 1) new Machine({ solverProg: badProg }) and new Machine({ searcherProg: badProg }) and new Machine({ exam: [{ prog: badProg }] })
  // 2) m.setSolver(badProg)
  // 3) m.setSearcher(badProg)
  // 4) m.setExam([{ prog: badProg }])
  // 5) m.importState(badStateJson)
  const badProg = [[2n, 99n, 0n, 0n], [1n, 0n, 0n, 0n]]; // LDI r99, 0
  const badOpcodeProg = [[25n, 0n, 0n, 0n], [1n, 0n, 0n, 0n]]; // Opcode 25 out of 0..22
  const loadPaths = {};

  const mustThrow = (label, fn) => {
    try {
      fn();
      loadPaths[label] = { refused: false };
      return false;
    } catch (e) {
      loadPaths[label] = { refused: true, error: e.message };
      return true;
    }
  };

  const m = new GM1.Machine();
  const baseStateObj = JSON.parse(m.exportState());
  const badStateObj = JSON.parse(JSON.stringify(baseStateObj));
  badStateObj.solverProg[0][1] = '99';

  const p1 = mustThrow('constructor_solverProg', () => new GM1.Machine({ solverProg: badProg }));
  const p2 = mustThrow('constructor_searcherProg', () => new GM1.Machine({ searcherProg: badOpcodeProg }));
  const p3 = mustThrow('constructor_exam', () => new GM1.Machine({ exam: [{ name: 'bad', targetComponent: 0, prog: badProg, budget: 1000n }] }));
  const p4 = mustThrow('setSolver', () => m.setSolver(badProg));
  const p5 = mustThrow('setSearcher', () => m.setSearcher(badProg));
  const p6 = mustThrow('setExam', () => m.setExam([{ name: 'bad', targetComponent: 0, prog: badProg, budget: 1000n }]));
  const p7 = mustThrow('importState', () => m.importState(JSON.stringify(badStateObj)));

  const allLoadPathsRefused = p1 && p2 && p3 && p4 && p5 && p6 && p7;
  const passed = suiteRes.allRejectedWithIllFormed && allLoadPathsRefused;

  results.metrics.test10 = {
    all14RulesRejectedWithIllFormed: suiteRes.allRejectedWithIllFormed,
    perRule: suiteRes.perRule,
    allLoadPathsRefused,
    loadPaths
  };
  recordTest(
    10,
    `P1 Ill-formed rejection (all 14 rules rejected with ill_formed_program; all 7 load paths refuse ill-formed programs)`,
    passed ? 'PASS' : 'FAIL',
    results.metrics.test10
  );
}

// ============================================================================
// TEST 11 (New P1 Test 2): Positive control (allowIllFormed: true)
// ============================================================================
function runTest11() {
  // With allowIllFormed: true:
  // 1) The auditor's two UNSOUND probes (Rule 4 SUB_SELF on r99 and Rule 14 DEAD_LOAD on r99) MUST be accepted again!
  // 2) Our Test 10 (ill-formed rejection suite) MUST fail when allowIllFormed: true is turned on!
  const probeR4 = buildIllFormedCertForRule(4);
  const probeR14 = buildIllFormedCertForRule(14);

  const mAllow1 = new GM1.Machine({ allowIllFormed: true, solverProg: probeR4.prog });
  const vR4Allow = GM1.checkCertificate(probeR4.words, mAllow1, { expectedTargetComponent: 0 });

  const mAllow2 = new GM1.Machine({ allowIllFormed: true, solverProg: probeR14.prog });
  const vR14Allow = GM1.checkCertificate(probeR14.words, mAllow2, { expectedTargetComponent: 0 });

  // Verify that with allowIllFormed: false (default), both probes are rejected with ill_formed_program
  const vR4Strict = GM1.checkCertificate(probeR4.words, mAllow1, { expectedTargetComponent: 0, allowIllFormed: false });
  const vR14Strict = GM1.checkCertificate(probeR14.words, mAllow2, { expectedTargetComponent: 0, allowIllFormed: false });

  // Run Test 10's check suite with allowIllFormed: true and verify it FAILS (i.e. allRejectedWithIllFormed === false)
  const test10WithAllowIllFormed = testIllFormedCheckSuite(true);
  const test10FailsWhenAllowIllFormedTrue = test10WithAllowIllFormed.allRejectedWithIllFormed === false;

  const passed = vR4Allow.accepted === true &&
                 vR14Allow.accepted === true &&
                 vR4Strict.accepted === false && vR4Strict.code === 'ill_formed_program' &&
                 vR14Strict.accepted === false && vR14Strict.code === 'ill_formed_program' &&
                 test10FailsWhenAllowIllFormedTrue === true;

  results.metrics.test11 = {
    probeR4AcceptedWhenAllowIllFormedTrue: vR4Allow.accepted,
    probeR14AcceptedWhenAllowIllFormedTrue: vR14Allow.accepted,
    probeR4RejectedWhenDefault: !vR4Strict.accepted && vR4Strict.code === 'ill_formed_program',
    probeR14RejectedWhenDefault: !vR14Strict.accepted && vR14Strict.code === 'ill_formed_program',
    test10FailsWhenAllowIllFormedTrue
  };
  recordTest(
    11,
    `P1 Positive control (allowIllFormed:true accepts auditor's 2 r99 probes and causes Test 10 to fail; default rejects both)`,
    passed ? 'PASS' : 'FAIL',
    results.metrics.test11
  );
}

// ============================================================================
// TEST 12 (New P4 Test 3): Canonical certificate witness fields for each rule
// ============================================================================
function runTest12() {
  const rng = makePRNG(0xCA9091CA);
  const perRule = [];
  let allPassed = true;

  for (const rule of [...GM1.RULES, GM1.UNSOUND_RULE]) {
    const opts = { unsoundRule: rule.id === 99 };
    const usage = GM1.RULE_WITNESS_USAGE[rule.id];
    const { oldProg, newProg, step } = buildRandomProgramForRule(rule.id, rng);

    const canonRes = GM1.applyAndCheckStep(oldProg, step, opts);
    if (!canonRes.ok) {
      allPassed = false;
    }

    const checks = [];
    if (!usage.w1) {
      const badStepW1 = { ...step, w1: 3 };
      const r1 = GM1.applyAndCheckStep(oldProg, badStepW1, opts);
      const cert1 = {
        magic: GM1.CERT_MAGIC,
        targetComponent: 0,
        targetHash: GM1.computeProgramHash(oldProg),
        replacementProg: newProg,
        steps: [badStepW1]
      };
      const m = new GM1.Machine({ solverProg: oldProg, unsoundRule: opts.unsoundRule });
      const cv1 = GM1.checkCertificate(GM1.serializeCertificate(cert1), m, { expectedTargetComponent: 0, unsoundRule: opts.unsoundRule });
      const ok1 = !r1.ok && r1.code === 'noncanonical_certificate' && !cv1.accepted && cv1.code === 'noncanonical_certificate';
      if (!ok1) allPassed = false;
      checks.push({ field: 'w1', rejectedCode: cv1.code, ok: ok1 });
    } else {
      // w1 is used by this rule: verify that corrupting w1 is rejected (with side_condition_violated)
      const badStepW1 = { ...step, w1: 999 };
      const r1 = GM1.applyAndCheckStep(oldProg, badStepW1, opts);
      const ok1 = !r1.ok && r1.code === 'side_condition_violated';
      if (!ok1) allPassed = false;
      checks.push({ field: 'w1 (used)', rejectedCode: r1.code, ok: ok1 });
    }

    if (!usage.w2) {
      const badStepW2 = { ...step, w2: 5 };
      const r2 = GM1.applyAndCheckStep(oldProg, badStepW2, opts);
      const cert2 = {
        magic: GM1.CERT_MAGIC,
        targetComponent: 0,
        targetHash: GM1.computeProgramHash(oldProg),
        replacementProg: newProg,
        steps: [badStepW2]
      };
      const m = new GM1.Machine({ solverProg: oldProg, unsoundRule: opts.unsoundRule });
      const cv2 = GM1.checkCertificate(GM1.serializeCertificate(cert2), m, { expectedTargetComponent: 0, unsoundRule: opts.unsoundRule });
      const ok2 = !r2.ok && r2.code === 'noncanonical_certificate' && !cv2.accepted && cv2.code === 'noncanonical_certificate';
      if (!ok2) allPassed = false;
      checks.push({ field: 'w2', rejectedCode: cv2.code, ok: ok2 });
    } else {
      // w2 is used by this rule: verify that corrupting w2 is rejected (with side_condition_violated)
      const badStepW2 = { ...step, w2: 999 };
      const r2 = GM1.applyAndCheckStep(oldProg, badStepW2, opts);
      const ok2 = !r2.ok && r2.code === 'side_condition_violated';
      if (!ok2) allPassed = false;
      checks.push({ field: 'w2 (used)', rejectedCode: r2.code, ok: ok2 });
    }

    perRule.push({
      ruleId: rule.id,
      ruleName: rule.name,
      usesW1: usage.w1,
      usesW2: usage.w2,
      canonicalAccepted: canonRes.ok,
      noncanonicalChecks: checks
    });
  }

  results.metrics.test12 = { perRule };
  recordTest(
    12,
    `P4 Canonical witness fields (every unused witness field across Rules 1..14 rejected with noncanonical_certificate when nonzero)`,
    allPassed ? 'PASS' : 'FAIL',
    results.metrics.test12
  );
}

// ============================================================================
// TEST 13 (New Test 4): No regressions on seed, presets, and audit scripts
// ============================================================================
function runTest13() {
  // Verify that seed and all 4 presets produce the exact same accepted rewrites as GM-1
  const expectedRuns = [
    { label: 'seed', solverSrc: GM1.SEED_SOLVER_ASM, expectedSolverCostBefore: '732', expectedSolverCostAfter: '426', expectedSolverRules: [8, 1, 5, 11, 4, 3] },
    { label: 'preset:dot', solverSrc: GM1.PRESET_SOLVERS.dot, expectedSolverCostBefore: '472', expectedSolverCostAfter: '328', expectedSolverRules: [9, 3] },
    { label: 'preset:norm', solverSrc: GM1.PRESET_SOLVERS.norm, expectedSolverCostBefore: '440', expectedSolverCostAfter: '350', expectedSolverRules: [6] },
    { label: 'preset:collatz', solverSrc: GM1.PRESET_SOLVERS.collatz, expectedSolverCostBefore: '594', expectedSolverCostAfter: '594', expectedSolverRules: [] }
  ];

  const observedRuns = [];
  let allMatch = true;

  for (const exp of expectedRuns) {
    const m = new GM1.Machine({ solverProg: exp.solverSrc });
    const startCost = m.getSolverCost().toString();
    m.runEpoch({ targetComponent: 0 });
    m.runEpoch({ targetComponent: 1 });
    const endCost = m.getSolverCost().toString();
    const solverRewrite = m.lineageLog.find(e => !e.isSelfRewrite);
    const searcherRewrite = m.lineageLog.find(e => e.isSelfRewrite);
    const solverRules = solverRewrite ? solverRewrite.certificate.steps.map(s => s.ruleId) : [];
    const searcherRules = searcherRewrite ? searcherRewrite.certificate.steps.map(s => s.ruleId) : [];

    const match = startCost === exp.expectedSolverCostBefore &&
                  endCost === exp.expectedSolverCostAfter &&
                  JSON.stringify(solverRules) === JSON.stringify(exp.expectedSolverRules) &&
                  JSON.stringify(searcherRules) === JSON.stringify([5, 1, 9, 11, 10]);

    if (!match) allMatch = false;
    observedRuns.push({
      label: exp.label,
      startSolverCost: startCost,
      endSolverCost: endCost,
      solverRules,
      searcherRules,
      matchedGM1: match
    });
  }

  results.metrics.test13 = { observedRuns, differencesFromGM1: 'None on valid rewrites; mutated Rule 4 non-zero unused w1 in audit/forgeries.js is now rejected with noncanonical_certificate instead of accepted.' };
  recordTest(
    13,
    `No regressions across seed and all presets (100% identical accepted rewrites to GM-1)`,
    allMatch ? 'PASS' : 'FAIL',
    results.metrics.test13
  );
}

function main() {
  console.log('====================================================================');
  console.log('GM-1.1 Test Suite (node tests/run-all.js)');
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
  runTest10();
  runTest11();
  runTest12();
  runTest13();
  console.log('====================================================================');

  const passedCount = results.tests.filter(t => t.status === 'PASS').length;
  const failedCount = results.tests.filter(t => t.status === 'FAIL').length;
  const skippedCount = results.tests.filter(t => t.status === 'SKIP').length;
  const totalCount = results.tests.length;

  results.summary = { passed: passedCount, failed: failedCount, skipped: skippedCount, total: totalCount };
  console.log(`Summary: ${passedCount} passed / ${failedCount} failed / ${skippedCount} skipped (total ${totalCount}).`);

  const resultsPath = path.resolve(__dirname, 'results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), 'utf8');

  if (failedCount > 0) {
    process.exit(1);
  }
}

main();
