"""
Entry point for the High-Accuracy PyFingerprint + Tkinter + SQLite Voting System.

Run:
  python3 main.py           # Launches Tkinter desktop / Raspberry Pi GUI (falls back to CLI if headless)
  python3 main.py --cli     # Launches interactive terminal mode
  python3 main.py --gui     # Forces Tkinter GUI mode
"""

from __future__ import annotations

import argparse
import sys

from python_voting_system.biometric_sensor import BiometricConfig, FingerprintSensorManager
from python_voting_system.database import VotingDatabase


def run_cli(db_path: str = "voting_system.db") -> None:
    db = VotingDatabase(db_path=db_path)
    cfg = db.get_config()
    sensor = FingerprintSensorManager(
        db,
        BiometricConfig(
            security_level=int(cfg.get("security_level", 5)),
            min_confidence_score=int(cfg.get("min_confidence_score", 85)),
        ),
    )
    ok_hw, hw_msg = sensor.connect()
    print(f"\n[Sensor] {hw_msg}")

    while True:
        cfg = db.get_config()
        print("\n===== High-Accuracy Biometric Voting System (SQLite + PyFingerprint) =====")
        print(f"Election: {cfg['title']} | Status: {cfg['status'].upper()} | Security Level: {cfg['security_level']}")
        print("1. Add Candidate")
        print("2. Enroll Voter (Dual-Pass Biometric)")
        print("3. Start Election")
        print("4. Authenticate & Cast Secret Ballot")
        print("5. Stop Election")
        print("6. Display Live Results & Verify Hash Chain")
        print("7. Display Voter Roll")
        print("8. Connect Hardware Sensor Port")
        print("9. Exit")

        choice = input("Select option (1-9): ").strip()
        if choice == "1":
            name = input("Candidate full name: ")
            party = input("Party / affiliation [Independent]: ") or "Independent"
            symbol = input("Symbol code [CAN]: ") or "CAN"
            _, msg, _ = db.add_candidate(name, party, symbol)
            print(msg)
        elif choice == "2":
            nid = input("National / Voter ID: ")
            name = input("Voter full name: ")
            seed1 = None if ok_hw else input("Biometric Pass 1 ridge seed: ")
            seed2 = None if ok_hw else (input("Biometric Pass 2 ridge seed [same]: ") or seed1)
            enr = sensor.enroll_high_accuracy(seed1, seed2)
            if not enr.ok or enr.template_position is None or enr.template_bytes is None:
                print(enr.message)
                continue
            _, msg, _ = db.enroll_voter(nid, name, enr.template_position, enr.template_bytes, enr.consistency_score)
            print(msg)
        elif choice == "3":
            _, msg = db.start_election()
            print(msg)
        elif choice == "4":
            seed = None if ok_hw else input("Scan fingerprint (ridge seed): ")
            match = sensor.verify_high_accuracy(seed)
            print(match.message)
            if not match.matched or match.template_position is None:
                continue
            voter = db.get_voter_by_position(match.template_position)
            if not voter:
                print("Voter record not found in SQLite.")
                continue
            if voter["has_voted"]:
                print(f"Blocked: {voter['full_name']} has already voted.")
                continue
            cands = db.list_candidates()
            for c in cands:
                print(f"  {c['id']}. [{c['symbol_code']}] {c['name']} ({c['party']})")
            try:
                cid = int(input("Enter Candidate ID: "))
            except ValueError:
                print("Invalid candidate ID.")
                continue
            _, msg, receipt = db.cast_vote_atomic(voter["id"], cid, match.confidence_score)
            print(msg)
            if receipt:
                print(f"Receipt Hash: {receipt}")
        elif choice == "5":
            _, msg = db.stop_election()
            print(msg)
        elif choice == "6":
            cands = sorted(db.list_candidates(), key=lambda x: x["vote_count"], reverse=True)
            total = sum(c["vote_count"] for c in cands)
            print(f"\nTotal Ballots: {total}")
            for c in cands:
                pct = (c["vote_count"] / total * 100.0) if total > 0 else 0.0
                print(f" - {c['name']} ({c['party']}): {c['vote_count']} ({pct:.1f}%)")
            chain = db.verify_ballot_chain()
            print(f"Chain Integrity: {chain['valid']} ({chain['reason']})")
        elif choice == "7":
            for v in db.list_voters():
                st = "Voted" if v["has_voted"] else "Eligible"
                print(f" - [{v['national_id']}] {v['full_name']} | Slot #{v['template_position']} | {st}")
        elif choice == "8":
            print("Detected ports:", ", ".join(sensor.discover_ports()))
            port = input(f"Serial port [{sensor.config.port}]: ").strip() or sensor.config.port
            ok_hw, msg = sensor.connect(port=port)
            print(msg)
        elif choice == "9":
            break


def main() -> None:
    parser = argparse.ArgumentParser(description="High-Accuracy Fingerprint Voting System")
    parser.add_argument("--cli", action="store_true", help="Run in terminal CLI mode")
    parser.add_argument("--gui", action="store_true", help="Force Tkinter GUI mode")
    parser.add_argument("--db", default="voting_system.db", help="SQLite database path")
    args = parser.parse_args()

    if args.cli:
        run_cli(db_path=args.db)
        return

    try:
        from python_voting_system.gui_app import launch_gui
        launch_gui(db_path=args.db)
    except Exception as exc:
        if args.gui:
            print(f"Unable to launch Tkinter GUI: {exc}", file=sys.stderr)
            sys.exit(1)
        print(f"Display unavailable ({exc}); launching CLI mode...")
        run_cli(db_path=args.db)


if __name__ == "__main__":
    main()
