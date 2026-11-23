"""Unit & integration tests for the Python PyFingerprint + SQLite Voting System."""

from __future__ import annotations

import os
import tempfile
import unittest

from python_voting_system.biometric_sensor import (
    BiometricConfig,
    FingerprintSensorManager,
    compute_template_similarity,
    generate_minutiae_template,
)
from python_voting_system.database import VotingDatabase


class TestBiometricVotingSystem(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db = VotingDatabase(db_path=self.tmp.name)
        self.sensor = FingerprintSensorManager(
            self.db, BiometricConfig(security_level=5, min_confidence_score=85)
        )

    def tearDown(self) -> None:
        if os.path.exists(self.tmp.name):
            os.unlink(self.tmp.name)

    def test_biometric_similarity_separates_distinct_fingers(self) -> None:
        tpl_alice_1 = generate_minutiae_template("alice-right-index", noise_level=0.0)
        tpl_alice_2 = generate_minutiae_template("alice-right-index", noise_level=0.03)
        tpl_bob = generate_minutiae_template("bob-left-thumb", noise_level=0.0)

        same_score = compute_template_similarity(tpl_alice_1, tpl_alice_2)
        diff_score = compute_template_similarity(tpl_alice_1, tpl_bob)

        self.assertGreaterEqual(same_score, 120)
        self.assertLess(diff_score, 50)

    def test_dual_pass_enrollment_rejects_mismatched_passes_and_duplicates(self) -> None:
        # Mismatched pass 1 vs pass 2 must fail
        mismatch = self.sensor.enroll_high_accuracy("finger-a", "finger-b")
        self.assertFalse(mismatch.ok)

        # Matching dual-pass enrollment succeeds
        enr = self.sensor.enroll_high_accuracy("alice-print-01", "alice-print-01")
        self.assertTrue(enr.ok)
        assert enr.template_position is not None
        assert enr.template_bytes is not None

        ok, _, _ = self.db.enroll_voter(
            national_id="NID-1001",
            full_name="Alice Rahman",
            template_position=enr.template_position,
            template_bytes=enr.template_bytes,
            enrollment_score=enr.consistency_score,
        )
        self.assertTrue(ok)

        # Duplicate biometric enrollment for another voter must be rejected
        dup = self.sensor.enroll_high_accuracy("alice-print-01", "alice-print-01")
        self.assertFalse(dup.ok)
        self.assertIn("Duplicate fingerprint", dup.message)

    def test_atomic_voting_one_person_one_vote_and_ballot_chain(self) -> None:
        self.db.add_candidate("Dr. Elena Vance", "Civic Reform", "ELV")
        self.db.add_candidate("Marcus Chen", "Techno-Civic", "MRC")

        enr1 = self.sensor.enroll_high_accuracy("voter-1-fp", "voter-1-fp")
        self.assertTrue(enr1.ok)
        ok_v1, _, _ = self.db.enroll_voter("V-01", "Voter One", enr1.template_position, enr1.template_bytes, enr1.consistency_score)  # type: ignore[arg-type]
        self.assertTrue(ok_v1)

        enr2 = self.sensor.enroll_high_accuracy("voter-2-fp", "voter-2-fp")
        self.assertTrue(enr2.ok)
        ok_v2, _, _ = self.db.enroll_voter("V-02", "Voter Two", enr2.template_position, enr2.template_bytes, enr2.consistency_score)  # type: ignore[arg-type]
        self.assertTrue(ok_v2)

        ok_start, _ = self.db.start_election()
        self.assertTrue(ok_start)

        # Unknown finger rejected
        bad_auth = self.sensor.verify_high_accuracy("stranger-fp")
        self.assertFalse(bad_auth.matched)

        # Voter 1 authenticates and votes
        auth1 = self.sensor.verify_high_accuracy("voter-1-fp")
        self.assertTrue(auth1.matched)
        voter1 = self.db.get_voter_by_position(auth1.template_position)  # type: ignore[arg-type]
        assert voter1 is not None

        ok_vote, _, receipt = self.db.cast_vote_atomic(voter1["id"], 1, auth1.confidence_score)
        self.assertTrue(ok_vote)
        self.assertIsNotNone(receipt)

        # Double vote attempt blocked
        dup_vote, msg, _ = self.db.cast_vote_atomic(voter1["id"], 2, auth1.confidence_score)
        self.assertFalse(dup_vote)
        self.assertIn("ALREADY voted", msg)

        # Below-threshold score blocked
        auth2 = self.sensor.verify_high_accuracy("voter-2-fp")
        self.assertTrue(auth2.matched)
        voter2 = self.db.get_voter_by_position(auth2.template_position)  # type: ignore[arg-type]
        assert voter2 is not None
        low_score_vote, _, _ = self.db.cast_vote_atomic(voter2["id"], 2, 40)
        self.assertFalse(low_score_vote)

        # Valid vote for voter 2
        ok_vote2, _, _ = self.db.cast_vote_atomic(voter2["id"], 2, auth2.confidence_score)
        self.assertTrue(ok_vote2)

        chain = self.db.verify_ballot_chain()
        self.assertTrue(chain["valid"])
        self.assertEqual(chain["ballot_count"], 2)

    def test_accuracy_presets_apply_to_database_config(self) -> None:
        from python_voting_system.config import ACCURACY_PRESETS

        preset = ACCURACY_PRESETS["maximum"]
        ok, _ = self.db.update_settings(
            title="Official Campus Election",
            security_level=preset.security_level,
            min_confidence_score=preset.min_confidence_score,
        )
        self.assertTrue(ok)
        cfg = self.db.get_config()
        self.assertEqual(cfg["security_level"], 5)
        self.assertEqual(cfg["min_confidence_score"], 85)
        self.assertEqual(cfg["title"], "Official Campus Election")


if __name__ == "__main__":
    unittest.main()
