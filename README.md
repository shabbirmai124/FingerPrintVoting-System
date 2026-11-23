# FingerPrintVoting-System

High-accuracy biometric electronic voting system built for **PC and Raspberry Pi** using **Python, PyFingerprint, Tkinter, and SQLite**, alongside a synchronized SQLite-backed interactive web console.

## Python / Raspberry Pi Architecture (`python_voting_system/` + `main.py`)

- **PyFingerprint Driver (`python_voting_system/biometric_sensor.py`)**:
  - Supports optical/capacitive sensors (`R307`, `AS608`, `ZFM-20`, `R305`) over USB-TTL (`/dev/ttyUSB0`, `COM*`) or Raspberry Pi UART (`/dev/ttyAMA0`, `/dev/serial0`).
  - Calibrates sensor hardware to **Security Level 5** (`setSystemParameter(5, 5)`, lowest False Acceptance Rate) and enforces a configurable confidence score threshold (default `>= 85`).
  - **Dual-Pass Enrollment**: Captures Pass 1, executes an immediate **1:N duplicate check** against all stored templates, captures Pass 2, verifies **1:1 template consistency** (`compareCharacteristics()`), and fuses the composite template (`createTemplate()`).
  - **1:N + 1:1 Verification**: Searches sensor flash (`searchTemplate()`) and performs a secondary 1:1 cross-check (`loadTemplate()` + `compareCharacteristics()`). Automatically falls back to a deterministic 512-byte minutiae simulator when hardware is disconnected.
- **SQLite WAL Atomic Ledger (`python_voting_system/database.py`)**:
  - Uses `PRAGMA journal_mode=WAL`, `PRAGMA synchronous=FULL`, and `BEGIN IMMEDIATE` atomic transactions.
  - Enforces **secret ballots**: `voters.has_voted` prevents double voting while `ballots` stores only `candidate_id`, `match_score`, `nonce`, `prev_hash`, and `receipt_hash` (no `voter_id` on ballots).
  - Independent `verify_ballot_chain()` checks SHA-256 chain links and 1:1 parity between voter flags, ballots, and candidate counts.
- **Tkinter GUI (`python_voting_system/gui_app.py`)**:
  - Full desktop & Raspberry Pi touchscreen UI with tabs for Voting Booth, Biometric Enrollment, Candidates & Election Control, Results & Audit Chain, and Sensor Calibration.

### Quick Start (Python on PC / Raspberry Pi)

```bash
pip install -r python_voting_system/requirements.txt
# On Raspberry Pi / Debian if Tkinter is not yet installed:
sudo apt install python3-tk

# Run unit & integration tests:
python3 -m unittest discover -s python_voting_system -p "test_*.py" -v

# Launch Tkinter GUI (auto-falls back to CLI if no display):
python3 main.py
```

## Web Console (`server.ts` + `src/`)

```bash
npm install
npm run dev
```
