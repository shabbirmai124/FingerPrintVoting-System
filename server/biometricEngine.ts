import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const GENESIS_HASH = '0'.repeat(64);

export interface ElectionConfig {
  id: number;
  title: string;
  status: 'setup' | 'active' | 'closed';
  securityLevel: number;
  minConfidenceScore: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface CandidateRecord {
  id: number;
  name: string;
  party: string;
  symbolCode: string;
  voteCount: number;
  createdAt: string;
}

export interface VoterRecord {
  id: number;
  nationalId: string;
  fullName: string;
  templatePosition: number;
  templateHash: string;
  enrollmentScore: number;
  hasVoted: boolean;
  votedAt: string | null;
  enrolledAt: string;
}

export interface AuditLogRecord {
  id: number;
  eventType: string;
  actor: string;
  matchScore: number | null;
  outcome: 'SUCCESS' | 'REJECTED' | 'INFO';
  details: string;
  createdAt: string;
}

export interface ChainVerification {
  valid: boolean;
  ballotCount: number;
  headHash: string;
  reason: string;
}

export function utcNowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function generateMinutiaeTemplate(ridgeSeed: string, noiseLevel = 0): Buffer {
  const cleanSeed = ridgeSeed.trim();
  if (!cleanSeed) {
    throw new Error('Biometric ridge seed cannot be empty.');
  }
  const blocks: Buffer[] = [];
  for (let blockIdx = 0; blockIdx < 16; blockIdx += 1) {
    const digest = crypto
      .createHash('sha256')
      .update(`${cleanSeed}|block=${blockIdx}`, 'utf8')
      .digest();
    blocks.push(digest);
  }
  const raw = Buffer.concat(blocks);
  if (noiseLevel > 0) {
    const stride = Math.max(2, Math.round(1 / Math.min(noiseLevel, 0.25)));
    for (let i = 0; i < raw.length; i += stride) {
      raw[i] = (raw[i] + 3) % 256;
    }
  }
  return raw;
}

export function computeTemplateHash(templateBytes: Buffer, salt = 'fp-voting-v1'): string {
  return crypto
    .createHash('sha256')
    .update(Buffer.concat([Buffer.from(`${salt}:`, 'utf8'), templateBytes]))
    .digest('hex');
}

export function computeTemplateSimilarity(tplA: Buffer, tplB: Buffer): number {
  if (!tplA.length || !tplB.length || tplA.length !== tplB.length) {
    return 0;
  }
  const n = tplA.length;
  let closeBytes = 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < n; i += 1) {
    const a = tplA[i];
    const b = tplB[i];
    if (Math.abs(a - b) <= 6) {
      closeBytes += 1;
    }
    const ca = a - 127.5;
    const cb = b - 127.5;
    dot += ca * cb;
    magA += ca * ca;
    magB += cb * cb;
  }

  const cosine = magA > 0 && magB > 0 ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
  const exactRatio = closeBytes / n;
  const rawScore = (0.55 * Math.max(0, cosine) + 0.45 * exactRatio) * 200;
  return Math.max(0, Math.min(200, Math.round(rawScore)));
}

export function computeImageQuality(tpl: Buffer): number {
  if (!tpl.length) return 0;
  const unique = new Set<number>();
  let sum = 0;
  for (let i = 0; i < tpl.length; i += 1) {
    unique.add(tpl[i]);
    sum += tpl[i];
  }
  const mean = sum / tpl.length;
  let variance = 0;
  for (let i = 0; i < tpl.length; i += 1) {
    const d = tpl[i] - mean;
    variance += d * d;
  }
  variance /= tpl.length;
  const score = Math.round((unique.size / 220) * 60 + Math.min(40, variance / 120));
  return Math.max(40, Math.min(100, score));
}

export function computeBallotHash(
  prevHash: string,
  candidateId: number,
  matchScore: number,
  castAt: string,
  nonce: string
): string {
  const payload = `${prevHash}|${candidateId}|${matchScore}|${castAt}|${nonce}`;
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

export class BiometricVotingStore {
  private db: DatabaseSync;

  constructor(dbPath = 'web_voting_system.db', seedIfEmpty = true) {
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
    if (seedIfEmpty) {
      this.seedInitialDemoDataIfEmpty();
    }
  }

  private initSchema(): void {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;

      CREATE TABLE IF NOT EXISTS election_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        title TEXT NOT NULL DEFAULT 'Municipal Biometric General Election',
        status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'active', 'closed')),
        security_level INTEGER NOT NULL DEFAULT 5 CHECK (security_level BETWEEN 1 AND 5),
        min_confidence_score INTEGER NOT NULL DEFAULT 85 CHECK (min_confidence_score BETWEEN 30 AND 200),
        created_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT
      );

      CREATE TABLE IF NOT EXISTS candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        party TEXT NOT NULL DEFAULT 'Independent',
        symbol_code TEXT NOT NULL DEFAULT 'CAN',
        vote_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS voters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        national_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
        full_name TEXT NOT NULL,
        template_position INTEGER NOT NULL UNIQUE,
        template_hash TEXT NOT NULL UNIQUE,
        template_blob BLOB NOT NULL,
        enrollment_score INTEGER NOT NULL,
        has_voted INTEGER NOT NULL DEFAULT 0 CHECK (has_voted IN (0, 1)),
        voted_at TEXT,
        enrolled_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ballots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE RESTRICT,
        match_score INTEGER NOT NULL,
        nonce TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        receipt_hash TEXT NOT NULL UNIQUE,
        cast_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        actor TEXT NOT NULL,
        match_score INTEGER,
        outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'REJECTED', 'INFO')),
        details TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    const existing = this.db.prepare('SELECT id FROM election_config WHERE id = 1').get();
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO election_config (id, title, status, security_level, min_confidence_score, created_at)
           VALUES (1, 'Municipal Biometric General Election', 'setup', 5, 85, ?)`
        )
        .run(utcNowIso());
    }
  }

  private seedInitialDemoDataIfEmpty(): void {
    const candCount = (this.db.prepare('SELECT COUNT(*) AS c FROM candidates').get() as { c: number }).c;
    const voterCount = (this.db.prepare('SELECT COUNT(*) AS c FROM voters').get() as { c: number }).c;
    const logCount = (this.db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get() as { c: number }).c;
    if (candCount === 0 && voterCount === 0 && logCount === 0) {
      this.addCandidate('Dr. Elena Vance', 'Civic Reform Alliance', 'CRA');
      this.addCandidate('Marcus Chen', 'Digital Infrastructure Coalition', 'DIC');
      this.addCandidate('Amina Patel', 'Independent Community Slate', 'ICS');

      this.enrollVoterDualPass('NID-2026-01', 'Nadia Rahman', 'nadia-right-index-01', 'nadia-right-index-01');
      this.enrollVoterDualPass('NID-2026-02', 'Tariq Hossain', 'tariq-right-thumb-02', 'tariq-right-thumb-02');
      this.enrollVoterDualPass('NID-2026-03', 'Clara Okafor', 'clara-left-index-03', 'clara-left-index-03');
    }
  }

  private logEvent(
    eventType: string,
    actor: string,
    outcome: 'SUCCESS' | 'REJECTED' | 'INFO',
    details: string,
    matchScore: number | null = null
  ): void {
    this.db
      .prepare(
        `INSERT INTO audit_logs (event_type, actor, match_score, outcome, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(eventType, actor, matchScore, outcome, details, utcNowIso());
  }

  getConfig(): ElectionConfig {
    const row = this.db.prepare('SELECT * FROM election_config WHERE id = 1').get() as Record<string, unknown>;
    return {
      id: Number(row.id),
      title: String(row.title),
      status: row.status as 'setup' | 'active' | 'closed',
      securityLevel: Number(row.security_level),
      minConfidenceScore: Number(row.min_confidence_score),
      createdAt: String(row.created_at),
      startedAt: row.started_at ? String(row.started_at) : null,
      endedAt: row.ended_at ? String(row.ended_at) : null,
    };
  }

  updateSettings(input: {
    title?: string;
    securityLevel?: number;
    minConfidenceScore?: number;
  }): { ok: boolean; message: string } {
    const cfg = this.getConfig();
    if (cfg.status === 'active') {
      return { ok: false, message: 'Cannot change security calibration while the election is active.' };
    }
    const title = input.title?.trim() || cfg.title;
    const securityLevel = input.securityLevel !== undefined ? Number(input.securityLevel) : cfg.securityLevel;
    const minConfidenceScore =
      input.minConfidenceScore !== undefined ? Number(input.minConfidenceScore) : cfg.minConfidenceScore;

    if (!Number.isInteger(securityLevel) || securityLevel < 1 || securityLevel > 5) {
      return { ok: false, message: 'Security level must be an integer between 1 and 5.' };
    }
    if (!Number.isInteger(minConfidenceScore) || minConfidenceScore < 30 || minConfidenceScore > 200) {
      return { ok: false, message: 'Minimum confidence score must be between 30 and 200.' };
    }

    this.db
      .prepare(
        `UPDATE election_config SET title = ?, security_level = ?, min_confidence_score = ? WHERE id = 1`
      )
      .run(title, securityLevel, minConfidenceScore);
    this.logEvent(
      'CALIBRATION',
      'Admin',
      'INFO',
      `Updated calibration: Security Level ${securityLevel}, Min Confidence ${minConfidenceScore}`
    );
    return { ok: true, message: 'Election calibration updated.' };
  }

  addCandidate(rawName: string, rawParty = 'Independent', rawSymbol = ''): {
    ok: boolean;
    message: string;
    candidate?: CandidateRecord;
  } {
    const cfg = this.getConfig();
    if (cfg.status === 'active') {
      return { ok: false, message: 'Cannot add candidates while the election is active.' };
    }
    const name = rawName.trim();
    const party = rawParty.trim() || 'Independent';
    const symbolCode = (rawSymbol.trim() || name.slice(0, 3)).toUpperCase().slice(0, 6);
    if (!name) {
      return { ok: false, message: 'Candidate name cannot be empty.' };
    }

    const existing = this.db
      .prepare('SELECT id FROM candidates WHERE name = ? COLLATE NOCASE')
      .get(name);
    if (existing) {
      return { ok: false, message: `Candidate '${name}' is already registered.` };
    }

    const now = utcNowIso();
    const info = this.db
      .prepare(
        `INSERT INTO candidates (name, party, symbol_code, vote_count, created_at)
         VALUES (?, ?, ?, 0, ?)`
      )
      .run(name, party, symbolCode, now);

    const row = this.db
      .prepare('SELECT * FROM candidates WHERE id = ?')
      .get(Number(info.lastInsertRowid)) as Record<string, unknown>;

    this.logEvent('CANDIDATE_ADD', 'Admin', 'SUCCESS', `Registered candidate '${name}' (${party})`);
    return {
      ok: true,
      message: `Candidate '${name}' added successfully.`,
      candidate: {
        id: Number(row.id),
        name: String(row.name),
        party: String(row.party),
        symbolCode: String(row.symbol_code),
        voteCount: Number(row.vote_count),
        createdAt: String(row.created_at),
      },
    };
  }

  removeCandidate(candidateId: number): { ok: boolean; message: string } {
    const cfg = this.getConfig();
    if (cfg.status === 'active') {
      return { ok: false, message: 'Cannot remove candidates while the election is active.' };
    }
    const ballots = (
      this.db.prepare('SELECT COUNT(*) AS c FROM ballots WHERE candidate_id = ?').get(candidateId) as { c: number }
    ).c;
    if (ballots > 0) {
      return { ok: false, message: 'Cannot remove a candidate with cast ballots.' };
    }
    const info = this.db.prepare('DELETE FROM candidates WHERE id = ?').run(candidateId);
    if (info.changes === 0) {
      return { ok: false, message: 'Candidate not found.' };
    }
    this.logEvent('CANDIDATE_REMOVE', 'Admin', 'INFO', `Removed candidate #${candidateId}`);
    return { ok: true, message: 'Candidate removed.' };
  }

  private nextFreeTemplatePosition(maxCapacity = 1000): number {
    const rows = this.db.prepare('SELECT template_position FROM voters').all() as { template_position: number }[];
    const used = new Set(rows.map((r) => Number(r.template_position)));
    for (let pos = 0; pos < maxCapacity; pos += 1) {
      if (!used.has(pos)) return pos;
    }
    throw new Error('Sensor flash template capacity full.');
  }

  enrollVoterDualPass(
    rawNationalId: string,
    rawFullName: string,
    rawSeedPass1: string,
    rawSeedPass2: string
  ): {
    ok: boolean;
    message: string;
    consistencyScore?: number;
    qualityScore?: number;
    voter?: VoterRecord;
  } {
    const cfg = this.getConfig();
    if (cfg.status === 'active') {
      return { ok: false, message: 'Cannot enroll new voters while the election is active.' };
    }
    const nationalId = rawNationalId.trim();
    const fullName = rawFullName.trim();
    const seed1 = rawSeedPass1.trim();
    const seed2 = (rawSeedPass2 || rawSeedPass1).trim();

    if (!nationalId || !fullName) {
      return { ok: false, message: 'National ID and full legal name are required.' };
    }
    if (!seed1) {
      return { ok: false, message: 'Fingerprint scan Pass 1 cannot be empty.' };
    }

    const dupNid = this.db
      .prepare('SELECT full_name FROM voters WHERE national_id = ? COLLATE NOCASE')
      .get(nationalId) as { full_name: string } | undefined;
    if (dupNid) {
      return { ok: false, message: `National ID '${nationalId}' is already enrolled to ${dupNid.full_name}.` };
    }

    const tpl1 = generateMinutiaeTemplate(seed1, 0);
    const qualityScore = computeImageQuality(tpl1);

    // 1:N duplicate biometric guard
    const existingVoters = this.db
      .prepare('SELECT id, national_id, full_name, template_blob FROM voters')
      .all() as { id: number; national_id: string; full_name: string; template_blob: Uint8Array }[];

    for (const v of existingVoters) {
      const score = computeTemplateSimilarity(tpl1, Buffer.from(v.template_blob));
      if (score >= cfg.minConfidenceScore) {
        this.logEvent(
          'ENROLL_DUPLICATE',
          nationalId,
          'REJECTED',
          `Duplicate fingerprint rejected (matches ${v.full_name}, score ${score})`,
          score
        );
        return {
          ok: false,
          message: `Duplicate fingerprint detected! Matches ${v.full_name} (${v.national_id}, Confidence: ${score}).`,
          consistencyScore: score,
          qualityScore,
        };
      }
    }

    // Pass 2 cross-check
    const tpl2 = generateMinutiaeTemplate(seed2, 0.03);
    const consistencyScore = computeTemplateSimilarity(tpl1, tpl2);
    if (consistencyScore < cfg.minConfidenceScore) {
      this.logEvent(
        'ENROLL_MISMATCH',
        nationalId,
        'REJECTED',
        `Pass 1 vs Pass 2 consistency ${consistencyScore} < threshold ${cfg.minConfidenceScore}`,
        consistencyScore
      );
      return {
        ok: false,
        message: `Dual-pass mismatch: Consistency ${consistencyScore} is below threshold ${cfg.minConfidenceScore}. Scan the same finger on both passes.`,
        consistencyScore,
        qualityScore,
      };
    }

    const templatePosition = this.nextFreeTemplatePosition();
    const templateHash = computeTemplateHash(tpl1);
    const now = utcNowIso();

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const info = this.db
        .prepare(
          `INSERT INTO voters (
            national_id, full_name, template_position, template_hash, template_blob,
            enrollment_score, has_voted, enrolled_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
        )
        .run(nationalId, fullName, templatePosition, templateHash, tpl1, consistencyScore, now);

      this.logEvent(
        'ENROLL_VOTER',
        nationalId,
        'SUCCESS',
        `Enrolled '${fullName}' at Flash Slot #${templatePosition} (Quality ${qualityScore}%)`,
        consistencyScore
      );
      this.db.exec('COMMIT');

      return {
        ok: true,
        message: `Enrolled '${fullName}' at Slot #${templatePosition} (Consistency: ${consistencyScore}/200).`,
        consistencyScore,
        qualityScore,
        voter: {
          id: Number(info.lastInsertRowid),
          nationalId,
          fullName,
          templatePosition,
          templateHash,
          enrollmentScore: consistencyScore,
          hasVoted: false,
          votedAt: null,
          enrolledAt: now,
        },
      };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  startElection(): { ok: boolean; message: string } {
    const cands = (this.db.prepare('SELECT COUNT(*) AS c FROM candidates').get() as { c: number }).c;
    const voters = (this.db.prepare('SELECT COUNT(*) AS c FROM voters').get() as { c: number }).c;
    if (cands < 1) {
      return { ok: false, message: 'Cannot start election: Add at least 1 candidate first.' };
    }
    if (voters < 1) {
      return { ok: false, message: 'Cannot start election: Enroll at least 1 biometric voter first.' };
    }
    const now = utcNowIso();
    this.db
      .prepare("UPDATE election_config SET status = 'active', started_at = ?, ended_at = NULL WHERE id = 1")
      .run(now);
    this.logEvent('ELECTION_START', 'Admin', 'INFO', `Election opened (${cands} candidates, ${voters} voters)`);
    return { ok: true, message: 'Election started. Biometric voting booth is now open.' };
  }

  stopElection(): { ok: boolean; message: string } {
    const now = utcNowIso();
    this.db
      .prepare("UPDATE election_config SET status = 'closed', ended_at = ? WHERE id = 1")
      .run(now);
    this.logEvent('ELECTION_STOP', 'Admin', 'INFO', 'Election closed and sealed by administrator');
    return { ok: true, message: 'Election stopped and sealed.' };
  }

  authenticateBiometric(rawSeed: string): {
    ok: boolean;
    message: string;
    confidenceScore: number;
    qualityScore: number;
    voter?: VoterRecord;
  } {
    const cfg = this.getConfig();
    if (cfg.status !== 'active') {
      return {
        ok: false,
        message: 'Election is not active. Start the election in Overview & Control first.',
        confidenceScore: 0,
        qualityScore: 0,
      };
    }

    const seed = rawSeed.trim();
    if (!seed) {
      return {
        ok: false,
        message: 'Provide a fingerprint scan or ridge seed to authenticate.',
        confidenceScore: 0,
        qualityScore: 0,
      };
    }

    const liveTpl = generateMinutiaeTemplate(seed, 0.02);
    const qualityScore = computeImageQuality(liveTpl);

    const rows = this.db.prepare('SELECT * FROM voters ORDER BY id ASC').all() as Record<string, unknown>[];
    let bestRow: Record<string, unknown> | null = null;
    let bestScore = 0;

    for (const r of rows) {
      const blob = Buffer.from(r.template_blob as Uint8Array);
      const score = computeTemplateSimilarity(liveTpl, blob);
      if (score > bestScore) {
        bestScore = score;
        bestRow = r;
      }
    }

    if (!bestRow || bestScore < cfg.minConfidenceScore) {
      this.logEvent(
        'AUTH_REJECTED',
        'Unknown',
        'REJECTED',
        `Score ${bestScore} below threshold ${cfg.minConfidenceScore}`,
        bestScore
      );
      return {
        ok: false,
        message: `Authentication rejected: Best biometric match (${bestScore}) is below Security Level ${cfg.securityLevel} threshold (${cfg.minConfidenceScore}).`,
        confidenceScore: bestScore,
        qualityScore,
      };
    }

    const voter: VoterRecord = {
      id: Number(bestRow.id),
      nationalId: String(bestRow.national_id),
      fullName: String(bestRow.full_name),
      templatePosition: Number(bestRow.template_position),
      templateHash: String(bestRow.template_hash),
      enrollmentScore: Number(bestRow.enrollment_score),
      hasVoted: Boolean(bestRow.has_voted),
      votedAt: bestRow.voted_at ? String(bestRow.voted_at) : null,
      enrolledAt: String(bestRow.enrolled_at),
    };

    if (voter.hasVoted) {
      this.logEvent(
        'DOUBLE_VOTE_BLOCKED',
        voter.nationalId,
        'REJECTED',
        `Blocked duplicate authentication for ${voter.fullName}`,
        bestScore
      );
      return {
        ok: false,
        message: `Blocked: ${voter.fullName} (${voter.nationalId}) has ALREADY voted. One-person, one-vote enforced.`,
        confidenceScore: bestScore,
        qualityScore,
      };
    }

    return {
      ok: true,
      message: `Biometric verified: ${voter.fullName} (Confidence ${bestScore}/200, Quality ${qualityScore}%).`,
      confidenceScore: bestScore,
      qualityScore,
      voter,
    };
  }

  castVoteAtomic(rawSeed: string, candidateId: number): {
    ok: boolean;
    message: string;
    receiptHash?: string;
    confidenceScore?: number;
  } {
    const auth = this.authenticateBiometric(rawSeed);
    if (!auth.ok || !auth.voter) {
      return { ok: false, message: auth.message, confidenceScore: auth.confidenceScore };
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const freshVoter = this.db
        .prepare('SELECT id, national_id, full_name, has_voted FROM voters WHERE id = ?')
        .get(auth.voter.id) as { id: number; national_id: string; full_name: string; has_voted: number } | undefined;

      if (!freshVoter || freshVoter.has_voted) {
        this.db.exec('ROLLBACK');
        return { ok: false, message: 'Voter has already cast a ballot.' };
      }

      const candidate = this.db
        .prepare('SELECT id, name FROM candidates WHERE id = ?')
        .get(Number(candidateId)) as { id: number; name: string } | undefined;
      if (!candidate) {
        this.db.exec('ROLLBACK');
        return { ok: false, message: 'Selected candidate does not exist.' };
      }

      const lastBallot = this.db
        .prepare('SELECT receipt_hash FROM ballots ORDER BY id DESC LIMIT 1')
        .get() as { receipt_hash: string } | undefined;
      const prevHash = lastBallot ? lastBallot.receipt_hash : GENESIS_HASH;
      const castAt = utcNowIso();
      const nonce = crypto.randomBytes(8).toString('hex');
      const receiptHash = computeBallotHash(prevHash, candidate.id, auth.confidenceScore, castAt, nonce);

      this.db
        .prepare('UPDATE voters SET has_voted = 1, voted_at = ? WHERE id = ? AND has_voted = 0')
        .run(castAt, freshVoter.id);
      this.db
        .prepare('UPDATE candidates SET vote_count = vote_count + 1 WHERE id = ?')
        .run(candidate.id);
      this.db
        .prepare(
          `INSERT INTO ballots (candidate_id, match_score, nonce, prev_hash, receipt_hash, cast_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(candidate.id, auth.confidenceScore, nonce, prevHash, receiptHash, castAt);

      this.logEvent(
        'BALLOT_CAST',
        freshVoter.national_id,
        'SUCCESS',
        `Secret ballot recorded; receipt ${receiptHash.slice(0, 16)}...`,
        auth.confidenceScore
      );
      this.db.exec('COMMIT');

      return {
        ok: true,
        message: `Secret ballot recorded for ${candidate.name}.`,
        receiptHash,
        confidenceScore: auth.confidenceScore,
      };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  verifyBallotChain(): ChainVerification {
    const ballots = this.db.prepare('SELECT * FROM ballots ORDER BY id ASC').all() as Record<string, unknown>[];
    let expectedPrev = GENESIS_HASH;

    for (const b of ballots) {
      if (String(b.prev_hash) !== expectedPrev) {
        return {
          valid: false,
          ballotCount: ballots.length,
          headHash: expectedPrev,
          reason: `Broken chain link at ballot #${b.id}`,
        };
      }
      const recomputed = computeBallotHash(
        String(b.prev_hash),
        Number(b.candidate_id),
        Number(b.match_score),
        String(b.cast_at),
        String(b.nonce)
      );
      if (recomputed !== String(b.receipt_hash)) {
        return {
          valid: false,
          ballotCount: ballots.length,
          headHash: expectedPrev,
          reason: `Tampered receipt hash at ballot #${b.id}`,
        };
      }
      expectedPrev = String(b.receipt_hash);
    }

    const tallySum = (
      this.db.prepare('SELECT COALESCE(SUM(vote_count), 0) AS s FROM candidates').get() as { s: number }
    ).s;
    const votedSum = (
      this.db.prepare('SELECT COUNT(*) AS c FROM voters WHERE has_voted = 1').get() as { c: number }
    ).c;

    if (tallySum !== ballots.length || votedSum !== ballots.length) {
      return {
        valid: false,
        ballotCount: ballots.length,
        headHash: expectedPrev,
        reason: `Parity mismatch (ballots=${ballots.length}, tally=${tallySum}, voters=${votedSum})`,
      };
    }

    return {
      valid: true,
      ballotCount: ballots.length,
      headHash: expectedPrev,
      reason: 'Cryptographic ballot chain and voter-to-tally parity verified.',
    };
  }

  resetAll(): { ok: boolean; message: string } {
    this.db.exec(`
      DELETE FROM ballots;
      DELETE FROM voters;
      DELETE FROM candidates;
      DELETE FROM audit_logs;
      UPDATE election_config SET status = 'setup', started_at = NULL, ended_at = NULL WHERE id = 1;
    `);
    this.logEvent('SYSTEM_RESET', 'Admin', 'INFO', 'Cleared all candidates, voters, and ballots');
    return { ok: true, message: 'Voting machine reset to clean setup state.' };
  }

  getState() {
    const config = this.getConfig();
    const candidates = (
      this.db.prepare('SELECT * FROM candidates ORDER BY id ASC').all() as Record<string, unknown>[]
    ).map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      party: String(r.party),
      symbolCode: String(r.symbol_code),
      voteCount: Number(r.vote_count),
      createdAt: String(r.created_at),
    }));

    const results = [...candidates].sort((a, b) => b.voteCount - a.voteCount);
    const totalVotes = candidates.reduce((acc, c) => acc + c.voteCount, 0);

    const voters = (
      this.db
        .prepare(
          `SELECT id, national_id, full_name, template_position, template_hash,
                  enrollment_score, has_voted, voted_at, enrolled_at
           FROM voters ORDER BY id ASC`
        )
        .all() as Record<string, unknown>[]
    ).map((r) => ({
      id: Number(r.id),
      nationalId: String(r.national_id),
      fullName: String(r.full_name),
      templatePosition: Number(r.template_position),
      templateHashPreview: `${String(r.template_hash).slice(0, 14)}...`,
      enrollmentScore: Number(r.enrollment_score),
      hasVoted: Boolean(r.has_voted),
      votedAt: r.voted_at ? String(r.voted_at) : null,
      enrolledAt: String(r.enrolled_at),
    }));

    const auditLogs: AuditLogRecord[] = (
      this.db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 40').all() as Record<string, unknown>[]
    ).map((r) => ({
      id: Number(r.id),
      eventType: String(r.event_type),
      actor: String(r.actor),
      matchScore: r.match_score !== null ? Number(r.match_score) : null,
      outcome: r.outcome as 'SUCCESS' | 'REJECTED' | 'INFO',
      details: String(r.details),
      createdAt: String(r.created_at),
    }));

    const chain = this.verifyBallotChain();

    return {
      config,
      totalVotes,
      candidates,
      results,
      voters,
      auditLogs,
      chain,
    };
  }

  close(): void {
    this.db.close();
  }
}
