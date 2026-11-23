import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BiometricVotingStore,
  computeTemplateSimilarity,
  generateMinutiaeTemplate,
} from './biometricEngine';

function makeTempDbPath() {
  return path.join(os.tmpdir(), `voting-test-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

test('biometric template similarity separates matching fingers from impostors', () => {
  const tplA1 = generateMinutiaeTemplate('alice-index', 0);
  const tplA2 = generateMinutiaeTemplate('alice-index', 0.03);
  const tplB = generateMinutiaeTemplate('bob-thumb', 0);

  const sameScore = computeTemplateSimilarity(tplA1, tplA2);
  const diffScore = computeTemplateSimilarity(tplA1, tplB);

  assert.ok(sameScore >= 120, `Expected same finger >= 120, got ${sameScore}`);
  assert.ok(diffScore < 50, `Expected different finger < 50, got ${diffScore}`);
});

test('dual-pass enrollment rejects mismatched passes and duplicate fingerprints', () => {
  const dbPath = makeTempDbPath();
  const store = new BiometricVotingStore(dbPath, false);
  try {
    const mismatch = store.enrollVoterDualPass('NID-1', 'Alice', 'finger-one', 'finger-two');
    assert.equal(mismatch.ok, false);

    const enrolled = store.enrollVoterDualPass('NID-1', 'Alice', 'finger-one', 'finger-one');
    assert.equal(enrolled.ok, true);

    const dup = store.enrollVoterDualPass('NID-2', 'Bob', 'finger-one', 'finger-one');
    assert.equal(dup.ok, false);
    assert.match(dup.message, /Duplicate fingerprint/i);
  } finally {
    store.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
});

test('atomic voting enforces one-person one-vote and maintains valid hash chain', () => {
  const dbPath = makeTempDbPath();
  const store = new BiometricVotingStore(dbPath, false);
  try {
    const c1 = store.addCandidate('Dr. Elena Vance', 'Civic Reform', 'CRA');
    const c2 = store.addCandidate('Marcus Chen', 'Digital Coalition', 'DIC');
    assert.equal(c1.ok && c2.ok, true);

    assert.equal(store.enrollVoterDualPass('V-1', 'Nadia', 'nadia-fp', 'nadia-fp').ok, true);
    assert.equal(store.enrollVoterDualPass('V-2', 'Tariq', 'tariq-fp', 'tariq-fp').ok, true);
    assert.equal(store.startElection().ok, true);

    const unknown = store.authenticateBiometric('unknown-fp');
    assert.equal(unknown.ok, false);

    const cast1 = store.castVoteAtomic('nadia-fp', c1.candidate!.id);
    assert.equal(cast1.ok, true);
    assert.ok(cast1.receiptHash);

    const doubleVote = store.castVoteAtomic('nadia-fp', c2.candidate!.id);
    assert.equal(doubleVote.ok, false);
    assert.match(doubleVote.message, /ALREADY voted/i);

    const cast2 = store.castVoteAtomic('tariq-fp', c2.candidate!.id);
    assert.equal(cast2.ok, true);

    const chain = store.verifyBallotChain();
    assert.equal(chain.valid, true);
    assert.equal(chain.ballotCount, 2);
  } finally {
    store.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
});
