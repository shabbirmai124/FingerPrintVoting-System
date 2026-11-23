"""Atomic SQLite persistence & cryptographic secret-ballot ledger for biometric voting."""

from __future__ import annotations

import csv
import hashlib
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple


GENESIS_HASH = "0" * 64


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def compute_template_hash(template_bytes: bytes, salt: str = "fp-voting-v1") -> str:
    return hashlib.sha256(f"{salt}:".encode("utf-8") + template_bytes).hexdigest()


def compute_ballot_hash(
    prev_hash: str,
    candidate_id: int,
    match_score: int,
    cast_at: str,
    nonce: str,
) -> str:
    payload = f"{prev_hash}|{candidate_id}|{match_score}|{cast_at}|{nonce}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class VotingDatabase:
    """Thread-safe, WAL-enabled SQLite database with atomic vote transactions."""

    def __init__(self, db_path: str | Path = "voting_system.db") -> None:
        self.db_path = str(db_path)
        self._init_schema()

    @contextmanager
    def _connect(self, immediate: bool = False) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path, timeout=15.0, isolation_level=None)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA foreign_keys = ON;")
            conn.execute("PRAGMA journal_mode = WAL;")
            conn.execute("PRAGMA synchronous = FULL;")
            if immediate:
                conn.execute("BEGIN IMMEDIATE;")
            yield conn
            if immediate and conn.in_transaction:
                conn.execute("COMMIT;")
        except Exception:
            if immediate and conn.in_transaction:
                try:
                    conn.execute("ROLLBACK;")
                except sqlite3.Error:
                    pass
            raise
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with self._connect(immediate=False) as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS election_config (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    title TEXT NOT NULL DEFAULT 'General Election 2026',
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
                    backup_position INTEGER UNIQUE,
                    template_hash TEXT NOT NULL UNIQUE,
                    template_blob BLOB,
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
                """
            )
            row = conn.execute("SELECT id FROM election_config WHERE id = 1").fetchone()
            if row is None:
                conn.execute(
                    """
                    INSERT INTO election_config (id, title, status, security_level, min_confidence_score, created_at)
                    VALUES (1, 'General Biometric Election', 'setup', 5, 85, ?)
                    """,
                    (utc_now_iso(),),
                )

    def log_event(
        self,
        event_type: str,
        actor: str,
        outcome: str,
        details: str,
        match_score: Optional[int] = None,
    ) -> None:
        with self._connect(immediate=True) as conn:
            conn.execute(
                """
                INSERT INTO audit_logs (event_type, actor, match_score, outcome, details, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (event_type, actor, match_score, outcome, details, utc_now_iso()),
            )

    def get_config(self) -> Dict[str, Any]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM election_config WHERE id = 1").fetchone()
            return dict(row) if row else {}

    def update_settings(
        self,
        title: Optional[str] = None,
        security_level: Optional[int] = None,
        min_confidence_score: Optional[int] = None,
    ) -> Tuple[bool, str]:
        with self._connect(immediate=True) as conn:
            cfg = conn.execute("SELECT * FROM election_config WHERE id = 1").fetchone()
            if cfg["status"] == "active":
                return False, "Cannot alter security calibration while an election is active."
            new_title = title.strip() if title and title.strip() else cfg["title"]
            new_level = int(security_level) if security_level is not None else cfg["security_level"]
            new_score = int(min_confidence_score) if min_confidence_score is not None else cfg["min_confidence_score"]
            if not (1 <= new_level <= 5):
                return False, "Security level must be between 1 and 5."
            if not (30 <= new_score <= 200):
                return False, "Minimum confidence score must be between 30 and 200."
            conn.execute(
                """
                UPDATE election_config
                SET title = ?, security_level = ?, min_confidence_score = ?
                WHERE id = 1
                """,
                (new_title, new_level, new_score),
            )
            conn.execute(
                """
                INSERT INTO audit_logs (event_type, actor, match_score, outcome, details, created_at)
                VALUES ('CALIBRATION', 'Admin', NULL, 'INFO', ?, ?)
                """,
                (
                    f"Updated title='{new_title}', security_level={new_level}, min_confidence={new_score}",
                    utc_now_iso(),
                ),
            )
            return True, "Election and biometric security settings updated."

    def add_candidate(
        self,
        name: str,
        party: str = "Independent",
        symbol_code: str = "CAN",
    ) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        clean_name = name.strip()
        clean_party = party.strip() or "Independent"
        clean_symbol = (symbol_code.strip() or clean_name[:3]).upper()[:6]
        if not clean_name:
            return False, "Candidate name cannot be empty.", None

        with self._connect(immediate=True) as conn:
            cfg = conn.execute("SELECT status FROM election_config WHERE id = 1").fetchone()
            if cfg["status"] == "active":
                return False, "Cannot add candidates while the election is active.", None
            existing = conn.execute(
                "SELECT id FROM candidates WHERE name = ? COLLATE NOCASE",
                (clean_name,),
            ).fetchone()
            if existing:
                return False, f"Candidate '{clean_name}' already exists.", None

            now = utc_now_iso()
            cur = conn.execute(
                """
                INSERT INTO candidates (name, party, symbol_code, vote_count, created_at)
                VALUES (?, ?, ?, 0, ?)
                """,
                (clean_name, clean_party, clean_symbol, now),
            )
            candidate_row = conn.execute(
                "SELECT * FROM candidates WHERE id = ?", (cur.lastrowid,)
            ).fetchone()
            conn.execute(
                """
                INSERT INTO audit_logs (event_type, actor, match_score, outcome, details, created_at)
                VALUES ('CANDIDATE_ADD', 'Admin', NULL, 'SUCCESS', ?, ?)
                """,
                (f"Added candidate '{clean_name}' ({clean_party})", now),
            )
            return True, f"Candidate '{clean_name}' registered.", dict(candidate_row)

    def remove_candidate(self, candidate_id: int) -> Tuple[bool, str]:
        with self._connect(immediate=True) as conn:
            cfg = conn.execute("SELECT status FROM election_config WHERE id = 1").fetchone()
            if cfg["status"] == "active":
                return False, "Cannot remove candidates while the election is active."
            ballots_count = conn.execute(
                "SELECT COUNT(*) AS cnt FROM ballots WHERE candidate_id = ?",
                (candidate_id,),
            ).fetchone()["cnt"]
            if ballots_count > 0:
                return False, "Cannot remove a candidate who already has recorded ballots."
            cur = conn.execute("DELETE FROM candidates WHERE id = ?", (candidate_id,))
            if cur.rowcount == 0:
                return False, "Candidate not found."
            return True, "Candidate removed."

    def next_free_template_position(self, max_capacity: int = 1000) -> int:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT template_position, backup_position FROM voters"
            ).fetchall()
            used = set()
            for r in rows:
                used.add(int(r["template_position"]))
                if r["backup_position"] is not None:
                    used.add(int(r["backup_position"]))
            for pos in range(0, max_capacity):
                if pos not in used:
                    return pos
            raise RuntimeError("Fingerprint sensor flash capacity reached.")

    def enroll_voter(
        self,
        national_id: str,
        full_name: str,
        template_position: int,
        template_bytes: bytes,
        enrollment_score: int,
        backup_position: Optional[int] = None,
    ) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        clean_nid = national_id.strip()
        clean_name = full_name.strip()
        if not clean_nid or not clean_name:
            return False, "National ID and full name are required.", None
        if not template_bytes:
            return False, "Biometric template data cannot be empty.", None

        template_hash = compute_template_hash(template_bytes)
        with self._connect(immediate=True) as conn:
            cfg = conn.execute("SELECT status FROM election_config WHERE id = 1").fetchone()
            if cfg["status"] == "active":
                return False, "Cannot enroll voters while the election is active.", None

            dup_nid = conn.execute(
                "SELECT full_name FROM voters WHERE national_id = ? COLLATE NOCASE",
                (clean_nid,),
            ).fetchone()
            if dup_nid:
                return False, f"National ID '{clean_nid}' is already registered to {dup_nid['full_name']}.", None

            dup_fp = conn.execute(
                "SELECT full_name, national_id FROM voters WHERE template_hash = ? OR template_position = ?",
                (template_hash, template_position),
            ).fetchone()
            if dup_fp:
                conn.execute(
                    """
                    INSERT INTO audit_logs (event_type, actor, match_score, outcome, details, created_at)
                    VALUES ('ENROLL_DUPLICATE', ?, ?, 'REJECTED', ?, ?)
                    """,
                    (
                        clean_nid,
                        enrollment_score,
                        f"Duplicate biometric rejected (matches {dup_fp['full_name']})",
                        utc_now_iso(),
                    ),
                )
                return (
                    False,
                    f"Duplicate fingerprint rejected: already enrolled for {dup_fp['full_name']} ({dup_fp['national_id']}).",
                    None,
                )

            now = utc_now_iso()
            cur = conn.execute(
                """
                INSERT INTO voters (
                    national_id, full_name, template_position, backup_position,
                    template_hash, template_blob, enrollment_score, has_voted, enrolled_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    clean_nid,
                    clean_name,
                    int(template_position),
                    int(backup_position) if backup_position is not None else None,
                    template_hash,
                    sqlite3.Binary(template_bytes),
                    int(enrollment_score),
                    now,
                ),
            )
            voter_row = conn.execute(
                "SELECT id, national_id, full_name, template_position, backup_position, template_hash, enrollment_score, has_voted, voted_at, enrolled_at FROM voters WHERE id = ?",
                (cur.lastrowid,),
            ).fetchone()
            conn.execute(
                """
                INSERT INTO audit_logs (event_type, actor, match_score, outcome, details, created_at)
                VALUES ('ENROLL_VOTER', ?, ?, 'SUCCESS', ?, ?)
                """,
                (
                    clean_nid,
                    int(enrollment_score),
                    f"Enrolled '{clean_name}' at flash slot #{template_position}",
                    now,
                ),
            )
            return True, f"Voter '{clean_name}' enrolled (Slot #{template_position}, Consistency {enrollment_score}).", dict(voter_row)

    def get_voter_by_position(self, position: int) -> Optional[Dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, national_id, full_name, template_position, backup_position,
                       template_hash, template_blob, enrollment_score, has_voted, voted_at, enrolled_at
                FROM voters
                WHERE template_position = ? OR backup_position = ?
                """,
                (int(position), int(position)),
            ).fetchone()
            return dict(row) if row else None

    def get_all_voter_templates(self) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, national_id, full_name, template_position, template_hash, template_blob, has_voted
                FROM voters
                ORDER BY id ASC
                """
            ).fetchall()
            return [dict(r) for r in rows]

    def list_candidates(self) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, name, party, symbol_code, vote_count, created_at FROM candidates ORDER BY id ASC"
            ).fetchall()
            return [dict(r) for r in rows]

    def list_voters(self) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, national_id, full_name, template_position, backup_position,
                       template_hash, enrollment_score, has_voted, voted_at, enrolled_at
                FROM voters
                ORDER BY id ASC
                """
            ).fetchall()
            return [dict(r) for r in rows]

    def list_audit_logs(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?",
                (int(limit),),
            ).fetchall()
            return [dict(r) for r in rows]

    def start_election(self) -> Tuple[bool, str]:
        with self._connect(immediate=True) as conn:
            cand_cnt = conn.execute("SELECT COUNT(*) AS c FROM candidates").fetchone()["c"]
            voter_cnt = conn.execute("SELECT COUNT(*) AS c FROM voters").fetchone()["c"]
            if cand_cnt < 1:
                return False, "Cannot start election: Register at least 1 candidate first."
            if voter_cnt < 1:
                return False, "Cannot start election: Enroll at least 1 biometric voter first."
            now = utc_now_iso()
            conn.execute(
                "UPDATE election_config SET status = 'active', started_at = ?, ended_at = NULL WHERE id = 1",
                (now,),
            )
            conn.execute(
                """
                INSERT INTO audit_logs (event_type, actor, match_score, outcome, details, created_at)
                VALUES ('ELECTION_START', 'Admin', NULL, 'INFO', ?, ?)
                """,
                (f"Election opened with {cand_cnt} candidates and {voter_cnt} enrolled voters", now),
            )
            return True, "Election is now ACTIVE. Biometric voting booth unlocked."

    def stop_election(self) -> Tuple[bool, str]:
        with self._connect(immediate=True) as conn:
            now = utc_now_iso()
            conn.execute(
                "UPDATE election_config SET status = 'closed', ended_at = ? WHERE id = 1",
                (now,),
            )
            conn.execute(
                """
                INSERT INTO audit_logs (event_type, actor, match_score, outcome, details, created_at)
                VALUES ('ELECTION_STOP', 'Admin', NULL, 'INFO', 'Election closed by administrator', ?)
                """,
                (now,),
            )
            return True, "Election stopped and sealed."

    def cast_vote_atomic(
        self,
        voter_id: int,
        candidate_id: int,
        match_score: int,
    ) -> Tuple[bool, str, Optional[str]]:
        """Atomically validates eligibility, marks voter, tallies vote, and seals chained ballot."""
        with self._connect(immediate=True) as conn:
            cfg = conn.execute("SELECT status, min_confidence_score FROM election_config WHERE id = 1").fetchone()
            if cfg["status"] != "active":
                return False, "Voting is closed. Start the election first.", None

            if int(match_score) < int(cfg["min_confidence_score"]):
                conn.execute(
                    """
                    INSERT INTO audit_logs (event_type, actor, match_score, outcome, details, created_at)
                    VALUES ('VOTE_REJECTED', ?, ?, 'REJECTED', ?, ?)
                    """,
                    (
                        f"Voter#{voter_id}",
                        int(match_score),
                        f"Confidence {match_score} below threshold {cfg['min_confidence_score']}",
                        utc_now_iso(),
                    ),
                )
                return (
                    False,
                    f"Biometric match score ({match_score}) below required accuracy threshold ({cfg['min_confidence_score']}).",
                    None,
                )

            voter = conn.execute(
                "SELECT id, national_id, full_name, has_voted FROM voters WHERE id = ?",
                (int(voter_id),),
            ).fetchone()
            if not voter:
                return False, "Voter record not found.", None
            if voter["has_voted"]:
                conn.execute(
                    """
                    INSERT INTO audit_logs (event_type, actor, match_score, outcome, details, created_at)
                    VALUES ('DOUBLE_VOTE_BLOCKED', ?, ?, 'REJECTED', ?, ?)
                    """,
                    (
                        voter["national_id"],
                        int(match_score),
                        f"Blocked duplicate vote attempt by {voter['full_name']}",
                        utc_now_iso(),
                    ),
                )
                return False, f"Voter {voter['full_name']} has ALREADY voted. One-person, one-vote enforced.", None

            candidate = conn.execute(
                "SELECT id, name FROM candidates WHERE id = ?",
                (int(candidate_id),),
            ).fetchone()
            if not candidate:
                return False, "Selected candidate does not exist.", None

            last_ballot = conn.execute(
                "SELECT receipt_hash FROM ballots ORDER BY id DESC LIMIT 1"
            ).fetchone()
            prev_hash = last_ballot["receipt_hash"] if last_ballot else GENESIS_HASH
            cast_at = utc_now_iso()
            nonce = secrets.token_hex(8)
            receipt_hash = compute_ballot_hash(
                prev_hash=prev_hash,
                candidate_id=int(candidate_id),
                match_score=int(match_score),
                cast_at=cast_at,
                nonce=nonce,
            )

            conn.execute(
                "UPDATE voters SET has_voted = 1, voted_at = ? WHERE id = ? AND has_voted = 0",
                (cast_at, int(voter_id)),
            )
            conn.execute(
                "UPDATE candidates SET vote_count = vote_count + 1 WHERE id = ?",
                (int(candidate_id),),
            )
            conn.execute(
                """
                INSERT INTO ballots (candidate_id, match_score, nonce, prev_hash, receipt_hash, cast_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (int(candidate_id), int(match_score), nonce, prev_hash, receipt_hash, cast_at),
            )
            conn.execute(
                """
                INSERT INTO audit_logs (event_type, actor, match_score, outcome, details, created_at)
                VALUES ('BALLOT_CAST', ?, ?, 'SUCCESS', ?, ?)
                """,
                (
                    voter["national_id"],
                    int(match_score),
                    f"Secret ballot cast; receipt {receipt_hash[:16]}...",
                    cast_at,
                ),
            )
            return True, f"Vote cast for {candidate['name']}. Receipt: {receipt_hash[:16]}...", receipt_hash

    def verify_ballot_chain(self) -> Dict[str, Any]:
        """Independently verifies ballot hash-chain and 1:1 parity with voters & candidates."""
        with self._connect() as conn:
            ballots = conn.execute("SELECT * FROM ballots ORDER BY id ASC").fetchall()
            expected_prev = GENESIS_HASH
            for b in ballots:
                if b["prev_hash"] != expected_prev:
                    return {
                        "valid": False,
                        "ballot_count": len(ballots),
                        "reason": f"Broken chain link at ballot #{b['id']}",
                    }
                recomputed = compute_ballot_hash(
                    b["prev_hash"], b["candidate_id"], b["match_score"], b["cast_at"], b["nonce"]
                )
                if recomputed != b["receipt_hash"]:
                    return {
                        "valid": False,
                        "ballot_count": len(ballots),
                        "reason": f"Tampered receipt hash at ballot #{b['id']}",
                    }
                expected_prev = b["receipt_hash"]

            tally_sum = conn.execute("SELECT COALESCE(SUM(vote_count), 0) AS s FROM candidates").fetchone()["s"]
            voted_sum = conn.execute("SELECT COUNT(*) AS c FROM voters WHERE has_voted = 1").fetchone()["c"]
            if tally_sum != len(ballots) or voted_sum != len(ballots):
                return {
                    "valid": False,
                    "ballot_count": len(ballots),
                    "reason": f"Parity mismatch (ballots={len(ballots)}, tally={tally_sum}, voters_marked={voted_sum})",
                }
            return {
                "valid": True,
                "ballot_count": len(ballots),
                "head_hash": expected_prev,
                "reason": "Cryptographic hash chain and voter-to-ballot parity verified.",
            }

    def reset_all(self) -> Tuple[bool, str]:
        with self._connect(immediate=False) as conn:
            conn.executescript(
                """
                DELETE FROM ballots;
                DELETE FROM voters;
                DELETE FROM candidates;
                DELETE FROM audit_logs;
                UPDATE election_config
                SET status = 'setup', started_at = NULL, ended_at = NULL
                WHERE id = 1;
                """
            )
            conn.execute(
                """
                INSERT INTO audit_logs (event_type, actor, match_score, outcome, details, created_at)
                VALUES ('SYSTEM_RESET', 'Admin', NULL, 'INFO', 'All ballots, voters, and candidates cleared', ?)
                """,
                (utc_now_iso(),),
            )
        return True, "Database reset to clean setup state."

    def export_results_csv(self, output_path: str | Path) -> str:
        candidates = self.list_candidates()
        total = sum(c["vote_count"] for c in candidates)
        chain = self.verify_ballot_chain()
        path = Path(output_path)
        with path.open("w", newline="", encoding="utf-8") as fp:
            writer = csv.writer(fp)
            writer.writerow(["Candidate ID", "Name", "Party", "Symbol", "Votes", "Share (%)"])
            for c in sorted(candidates, key=lambda x: x["vote_count"], reverse=True):
                pct = round((c["vote_count"] / total) * 100, 2) if total > 0 else 0.0
                writer.writerow([c["id"], c["name"], c["party"], c["symbol_code"], c["vote_count"], pct])
            writer.writerow([])
            writer.writerow(["Total Ballots", total])
            writer.writerow(["Chain Verified", chain["valid"]])
            writer.writerow(["Chain Head Hash", chain.get("head_hash", GENESIS_HASH)])
        return str(path.resolve())
