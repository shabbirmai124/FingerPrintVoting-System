"""
Tkinter Desktop & Raspberry Pi Touchscreen UI for High-Accuracy Fingerprint Voting.

Features:
- Voting Booth (1:N + 1:1 biometric verification, confidence meter, secret ballot casting)
- Biometric Enrollment (Dual-pass template fusion, duplicate detection, SQLite persistence)
- Candidate & Election Control (Security Level 1-5 calibration, confidence threshold)
- Results & Audit Integrity (Live tally, cryptographic ballot hash-chain verification, CSV export)
- Hardware Sensor Setup (Auto-detect /dev/ttyUSB*, /dev/ttyAMA*, COM*, live connect/fallback)
"""

from __future__ import annotations

import math
import hashlib
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from typing import Dict, Optional

from .biometric_sensor import BiometricConfig, FingerprintSensorManager
from .config import ACCURACY_PRESETS, SUPPORTED_BAUD_RATES
from .database import VotingDatabase


class FingerprintVotingGUI(tk.Tk):
    def __init__(self, db_path: str = "voting_system.db") -> None:
        super().__init__()
        self.title("Biometric Fingerprint Voting System — PyFingerprint + SQLite")
        self.geometry("1160x760")
        self.minsize(980, 680)
        self.configure(bg="#F8FAFC")

        self.db = VotingDatabase(db_path=db_path)
        cfg = self.db.get_config()
        self.sensor = FingerprintSensorManager(
            self.db,
            BiometricConfig(
                security_level=int(cfg.get("security_level", 5)),
                min_confidence_score=int(cfg.get("min_confidence_score", 85)),
            ),
        )
        self.sensor.connect()

        self.authenticated_voter: Optional[Dict[str, object]] = None
        self.authenticated_score: int = 0
        self.selected_candidate_var = tk.IntVar(value=0)

        self._configure_styles()
        self._build_layout()
        self.refresh_all()

    def _configure_styles(self) -> None:
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("TFrame", background="#F8FAFC")
        style.configure("Card.TFrame", background="#FFFFFF", relief="solid", borderwidth=1)
        style.configure("TLabel", background="#F8FAFC", foreground="#0F172A", font=("Segoe UI", 10))
        style.configure("Header.TLabel", background="#FFFFFF", foreground="#0F172A", font=("Segoe UI", 15, "bold"))
        style.configure("Sub.TLabel", background="#FFFFFF", foreground="#475569", font=("Segoe UI", 9))
        style.configure("CardTitle.TLabel", background="#FFFFFF", foreground="#0F172A", font=("Segoe UI", 11, "bold"))
        style.configure("CardText.TLabel", background="#FFFFFF", foreground="#334155", font=("Segoe UI", 10))
        style.configure("Primary.TButton", font=("Segoe UI", 10, "bold"), padding=(14, 8))
        style.configure("TNotebook", background="#F8FAFC", tabmargins=[2, 6, 2, 0])
        style.configure("TNotebook.Tab", padding=(14, 8), font=("Segoe UI", 10, "bold"))

    def _build_layout(self) -> None:
        # Top Header Bar
        header = tk.Frame(self, bg="#FFFFFF", bd=0, highlightthickness=1, highlightbackground="#E2E8F0")
        header.pack(fill="x", side="top")

        left_h = tk.Frame(header, bg="#FFFFFF", padx=20, pady=12)
        left_h.pack(side="left", fill="y")
        self.lbl_title = tk.Label(
            left_h,
            text="Biometric Fingerprint Voting System",
            bg="#FFFFFF",
            fg="#0F172A",
            font=("Segoe UI", 15, "bold"),
        )
        self.lbl_title.pack(anchor="w")
        self.lbl_subtitle = tk.Label(
            left_h,
            text="PyFingerprint Security Level 5 · SQLite WAL Atomic Ledger",
            bg="#FFFFFF",
            fg="#475569",
            font=("Segoe UI", 9),
        )
        self.lbl_subtitle.pack(anchor="w")

        right_h = tk.Frame(header, bg="#FFFFFF", padx=20, pady=12)
        right_h.pack(side="right", fill="y")
        self.lbl_election_status = tk.Label(
            right_h,
            text="SETUP MODE",
            bg="#E2E8F0",
            fg="#0F172A",
            font=("Segoe UI", 9, "bold"),
            padx=10,
            pady=4,
        )
        self.lbl_election_status.pack(side="right", padx=(8, 0))
        self.lbl_sensor_status = tk.Label(
            right_h,
            text="Simulator Mode",
            bg="#EFF6FF",
            fg="#1D4ED8",
            font=("Segoe UI", 9, "bold"),
            padx=10,
            pady=4,
        )
        self.lbl_sensor_status.pack(side="right")

        # KPI Summary Strip
        kpi_bar = tk.Frame(self, bg="#F8FAFC", padx=18, pady=8)
        kpi_bar.pack(fill="x", side="top")
        self.kpi_labels: Dict[str, tk.Label] = {}
        for idx, (key, title) in enumerate(
            [
                ("candidates", "Registered Candidates"),
                ("voters", "Enrolled Voters"),
                ("ballots", "Secret Ballots Cast"),
                ("chain", "Ballot Chain Integrity"),
            ]
        ):
            card = tk.Frame(kpi_bar, bg="#FFFFFF", highlightthickness=1, highlightbackground="#CBD5E1", padx=14, pady=8)
            card.pack(side="left", fill="x", expand=True, padx=(0 if idx == 0 else 8, 0))
            tk.Label(card, text=title, bg="#FFFFFF", fg="#64748B", font=("Segoe UI", 8, "bold")).pack(anchor="w")
            val_lbl = tk.Label(card, text="0", bg="#FFFFFF", fg="#0F172A", font=("Segoe UI", 14, "bold"))
            val_lbl.pack(anchor="w")
            self.kpi_labels[key] = val_lbl

        # Main Notebook
        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill="both", expand=True, padx=18, pady=(4, 14))

        self.tab_vote = ttk.Frame(self.notebook)
        self.tab_enroll = ttk.Frame(self.notebook)
        self.tab_admin = ttk.Frame(self.notebook)
        self.tab_results = ttk.Frame(self.notebook)
        self.tab_hardware = ttk.Frame(self.notebook)

        self.notebook.add(self.tab_vote, text="1. Voting Booth")
        self.notebook.add(self.tab_enroll, text="2. Biometric Enrollment")
        self.notebook.add(self.tab_admin, text="3. Candidates & Election")
        self.notebook.add(self.tab_results, text="4. Results & Audit Chain")
        self.notebook.add(self.tab_hardware, text="5. Sensor & Calibration")

        self._build_vote_tab()
        self._build_enroll_tab()
        self._build_admin_tab()
        self._build_results_tab()
        self._build_hardware_tab()

    # ------------------------------------------------------------------
    # Tab 1: Voting Booth
    # ------------------------------------------------------------------
    def _build_vote_tab(self) -> None:
        container = tk.Frame(self.tab_vote, bg="#F8FAFC", padx=8, pady=10)
        container.pack(fill="both", expand=True)
        container.columnconfigure(0, weight=5)
        container.columnconfigure(1, weight=7)
        container.rowconfigure(0, weight=1)

        # Left column: Fingerprint Scanner Station
        left_card = tk.Frame(container, bg="#FFFFFF", highlightthickness=1, highlightbackground="#CBD5E1", padx=18, pady=18)
        left_card.grid(row=0, column=0, sticky="nsew", padx=(0, 10))

        tk.Label(left_card, text="Biometric Voter Verification", bg="#FFFFFF", fg="#0F172A", font=("Segoe UI", 12, "bold")).pack(anchor="w")
        tk.Label(
            left_card,
            text="Place finger on optical prism. Runs 1:N search + 1:1 cross-check.",
            bg="#FFFFFF",
            fg="#475569",
            font=("Segoe UI", 9),
        ).pack(anchor="w", pady=(2, 12))

        self.vote_canvas = tk.Canvas(left_card, width=220, height=220, bg="#0F172A", highlightthickness=0)
        self.vote_canvas.pack(pady=8)
        self._draw_fingerprint_pattern(self.vote_canvas, "IDLE", matched=None)

        sim_frame = tk.Frame(left_card, bg="#FFFFFF")
        sim_frame.pack(fill="x", pady=(10, 6))
        tk.Label(sim_frame, text="Simulator Ridge Seed (if no USB/UART sensor):", bg="#FFFFFF", fg="#475569", font=("Segoe UI", 9)).pack(anchor="w")
        self.entry_vote_seed = ttk.Entry(sim_frame)
        self.entry_vote_seed.pack(fill="x", pady=(4, 0))

        self.btn_scan_vote = ttk.Button(left_card, text="Scan Fingerprint to Authenticate", style="Primary.TButton", command=self._handle_vote_scan)
        self.btn_scan_vote.pack(fill="x", pady=(12, 8))

        self.lbl_vote_feedback = tk.Label(
            left_card,
            text="Awaiting fingerprint scan...",
            bg="#F1F5F9",
            fg="#334155",
            font=("Segoe UI", 9),
            wraplength=300,
            justify="left",
            padx=10,
            pady=8,
        )
        self.lbl_vote_feedback.pack(fill="x", pady=(4, 0))

        # Right column: Secret Ballot Selection
        right_card = tk.Frame(container, bg="#FFFFFF", highlightthickness=1, highlightbackground="#CBD5E1", padx=18, pady=18)
        right_card.grid(row=0, column=1, sticky="nsew")

        tk.Label(right_card, text="Secret Ballot Paper", bg="#FFFFFF", fg="#0F172A", font=("Segoe UI", 12, "bold")).pack(anchor="w")
        self.lbl_authenticated_banner = tk.Label(
            right_card,
            text="Ballot locked until biometric verification succeeds.",
            bg="#FEF3C7",
            fg="#92400E",
            font=("Segoe UI", 9, "bold"),
            padx=10,
            pady=8,
            anchor="w",
        )
        self.lbl_authenticated_banner.pack(fill="x", pady=(8, 12))

        self.ballot_list_frame = tk.Frame(right_card, bg="#FFFFFF")
        self.ballot_list_frame.pack(fill="both", expand=True)

        action_row = tk.Frame(right_card, bg="#FFFFFF", pady=8)
        action_row.pack(fill="x", side="bottom")
        self.btn_cast_ballot = ttk.Button(action_row, text="Cast Secret Ballot", style="Primary.TButton", command=self._handle_cast_vote, state="disabled")
        self.btn_cast_ballot.pack(side="left")
        self.btn_cancel_auth = ttk.Button(action_row, text="Clear Session", command=self._clear_voter_session)
        self.btn_cancel_auth.pack(side="left", padx=(8, 0))

    # ------------------------------------------------------------------
    # Tab 2: Biometric Enrollment
    # ------------------------------------------------------------------
    def _build_enroll_tab(self) -> None:
        container = tk.Frame(self.tab_enroll, bg="#F8FAFC", padx=8, pady=10)
        container.pack(fill="both", expand=True)
        container.columnconfigure(0, weight=5)
        container.columnconfigure(1, weight=7)
        container.rowconfigure(0, weight=1)

        form_card = tk.Frame(container, bg="#FFFFFF", highlightthickness=1, highlightbackground="#CBD5E1", padx=18, pady=18)
        form_card.grid(row=0, column=0, sticky="nsew", padx=(0, 10))

        tk.Label(form_card, text="Dual-Pass Biometric Enrollment", bg="#FFFFFF", fg="#0F172A", font=("Segoe UI", 12, "bold")).pack(anchor="w")
        tk.Label(
            form_card,
            text="Captures 2 independent scans, checks 1:N duplicates, and verifies 1:1 consistency.",
            bg="#FFFFFF",
            fg="#475569",
            font=("Segoe UI", 9),
            wraplength=340,
            justify="left",
        ).pack(anchor="w", pady=(2, 12))

        tk.Label(form_card, text="Voter ID / National ID", bg="#FFFFFF", fg="#0F172A", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        self.entry_enroll_nid = ttk.Entry(form_card)
        self.entry_enroll_nid.pack(fill="x", pady=(3, 10))

        tk.Label(form_card, text="Full Legal Name", bg="#FFFFFF", fg="#0F172A", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        self.entry_enroll_name = ttk.Entry(form_card)
        self.entry_enroll_name.pack(fill="x", pady=(3, 10))

        tk.Label(form_card, text="Simulator Pass 1 Ridge Seed", bg="#FFFFFF", fg="#475569", font=("Segoe UI", 9)).pack(anchor="w")
        self.entry_enroll_seed1 = ttk.Entry(form_card)
        self.entry_enroll_seed1.pack(fill="x", pady=(3, 8))

        tk.Label(form_card, text="Simulator Pass 2 Ridge Seed (leave blank to reuse Pass 1)", bg="#FFFFFF", fg="#475569", font=("Segoe UI", 9)).pack(anchor="w")
        self.entry_enroll_seed2 = ttk.Entry(form_card)
        self.entry_enroll_seed2.pack(fill="x", pady=(3, 12))

        self.enroll_progress = ttk.Progressbar(form_card, mode="determinate", maximum=100)
        self.enroll_progress.pack(fill="x", pady=(0, 6))
        self.lbl_enroll_status = tk.Label(form_card, text="Ready for dual-pass enrollment.", bg="#F1F5F9", fg="#334155", font=("Segoe UI", 9), wraplength=340, justify="left", padx=8, pady=6)
        self.lbl_enroll_status.pack(fill="x", pady=(0, 12))

        self.btn_enroll = ttk.Button(form_card, text="Run Dual-Pass Enrollment", style="Primary.TButton", command=self._handle_enroll_voter)
        self.btn_enroll.pack(fill="x")

        # Voter Registry Table
        table_card = tk.Frame(container, bg="#FFFFFF", highlightthickness=1, highlightbackground="#CBD5E1", padx=18, pady=18)
        table_card.grid(row=0, column=1, sticky="nsew")
        table_hdr = tk.Frame(table_card, bg="#FFFFFF")
        table_hdr.pack(fill="x", pady=(0, 8))
        tk.Label(table_hdr, text="Enrolled Biometric Voter Roll (SQLite)", bg="#FFFFFF", fg="#0F172A", font=("Segoe UI", 12, "bold")).pack(side="left")
        self.voter_search_var = tk.StringVar()
        self.voter_search_var.trace_add("write", lambda *_: self.refresh_tables())
        search_entry = ttk.Entry(table_hdr, textvariable=self.voter_search_var, width=22)
        search_entry.pack(side="right")
        tk.Label(table_hdr, text="Filter:", bg="#FFFFFF", fg="#475569", font=("Segoe UI", 9)).pack(side="right", padx=(0, 6))

        cols = ("id", "nid", "name", "slot", "score", "status")
        self.tree_voters = ttk.Treeview(table_card, columns=cols, show="headings", height=18)
        self.tree_voters.heading("id", text="#")
        self.tree_voters.heading("nid", text="National ID")
        self.tree_voters.heading("name", text="Full Name")
        self.tree_voters.heading("slot", text="Flash Slot")
        self.tree_voters.heading("score", text="Consistency")
        self.tree_voters.heading("status", text="Status")
        self.tree_voters.column("id", width=40, anchor="center")
        self.tree_voters.column("nid", width=110)
        self.tree_voters.column("name", width=180)
        self.tree_voters.column("slot", width=80, anchor="center")
        self.tree_voters.column("score", width=90, anchor="center")
        self.tree_voters.column("status", width=100, anchor="center")
        self.tree_voters.pack(fill="both", expand=True)

    # ------------------------------------------------------------------
    # Tab 3: Candidates & Election Control
    # ------------------------------------------------------------------
    def _build_admin_tab(self) -> None:
        container = tk.Frame(self.tab_admin, bg="#F8FAFC", padx=8, pady=10)
        container.pack(fill="both", expand=True)
        container.columnconfigure(0, weight=5)
        container.columnconfigure(1, weight=7)
        container.rowconfigure(0, weight=1)

        left_card = tk.Frame(container, bg="#FFFFFF", highlightthickness=1, highlightbackground="#CBD5E1", padx=18, pady=18)
        left_card.grid(row=0, column=0, sticky="nsew", padx=(0, 10))

        tk.Label(left_card, text="Register Candidate", bg="#FFFFFF", fg="#0F172A", font=("Segoe UI", 12, "bold")).pack(anchor="w", pady=(0, 10))
        tk.Label(left_card, text="Candidate Full Name", bg="#FFFFFF", fg="#0F172A", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        self.entry_cand_name = ttk.Entry(left_card)
        self.entry_cand_name.pack(fill="x", pady=(3, 8))

        tk.Label(left_card, text="Party / Affiliation", bg="#FFFFFF", fg="#0F172A", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        self.entry_cand_party = ttk.Entry(left_card)
        self.entry_cand_party.pack(fill="x", pady=(3, 8))

        tk.Label(left_card, text="Symbol Code (e.g. CIV, IND)", bg="#FFFFFF", fg="#0F172A", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        self.entry_cand_symbol = ttk.Entry(left_card)
        self.entry_cand_symbol.pack(fill="x", pady=(3, 12))

        ttk.Button(left_card, text="Add Candidate", style="Primary.TButton", command=self._handle_add_candidate).pack(fill="x")

        ttk.Separator(left_card, orient="horizontal").pack(fill="x", pady=18)

        tk.Label(left_card, text="Election Lifecycle Control", bg="#FFFFFF", fg="#0F172A", font=("Segoe UI", 12, "bold")).pack(anchor="w", pady=(0, 8))
        btn_row = tk.Frame(left_card, bg="#FFFFFF")
        btn_row.pack(fill="x", pady=4)
        self.btn_start_election = ttk.Button(btn_row, text="Start Election", style="Primary.TButton", command=self._handle_start_election)
        self.btn_start_election.pack(side="left", fill="x", expand=True, padx=(0, 6))
        self.btn_stop_election = ttk.Button(btn_row, text="Stop Election", command=self._handle_stop_election)
        self.btn_stop_election.pack(side="left", fill="x", expand=True)

        ttk.Button(left_card, text="Reset Database & Sensor Flash", command=self._handle_reset_all).pack(fill="x", pady=(12, 0))

        right_card = tk.Frame(container, bg="#FFFFFF", highlightthickness=1, highlightbackground="#CBD5E1", padx=18, pady=18)
        right_card.grid(row=0, column=1, sticky="nsew")
        tk.Label(right_card, text="Registered Candidates", bg="#FFFFFF", fg="#0F172A", font=("Segoe UI", 12, "bold")).pack(anchor="w", pady=(0, 8))

        cols = ("id", "symbol", "name", "party", "votes")
        self.tree_candidates = ttk.Treeview(right_card, columns=cols, show="headings", height=16)
        self.tree_candidates.heading("id", text="ID")
        self.tree_candidates.heading("symbol", text="Code")
        self.tree_candidates.heading("name", text="Candidate Name")
        self.tree_candidates.heading("party", text="Affiliation")
        self.tree_candidates.heading("votes", text="Votes")
        self.tree_candidates.column("id", width=50, anchor="center")
        self.tree_candidates.column("symbol", width=70, anchor="center")
        self.tree_candidates.column("name", width=210)
        self.tree_candidates.column("party", width=150)
        self.tree_candidates.column("votes", width=70, anchor="center")
        self.tree_candidates.pack(fill="both", expand=True)

    # ------------------------------------------------------------------
    # Tab 4: Results & Audit Integrity
    # ------------------------------------------------------------------
    def _build_results_tab(self) -> None:
        container = tk.Frame(self.tab_results, bg="#F8FAFC", padx=8, pady=10)
        container.pack(fill="both", expand=True)
        container.rowconfigure(0, weight=5)
        container.rowconfigure(1, weight=5)
        container.columnconfigure(0, weight=1)

        top_card = tk.Frame(container, bg="#FFFFFF", highlightthickness=1, highlightbackground="#CBD5E1", padx=18, pady=14)
        top_card.grid(row=0, column=0, sticky="nsew", pady=(0, 10))

        top_bar = tk.Frame(top_card, bg="#FFFFFF")
        top_bar.pack(fill="x", pady=(0, 8))
        tk.Label(top_bar, text="Live Election Tally & Ballot Integrity", bg="#FFFFFF", fg="#0F172A", font=("Segoe UI", 12, "bold")).pack(side="left")
        ttk.Button(top_bar, text="Export CSV", command=self._handle_export_csv).pack(side="right", padx=(6, 0))
        ttk.Button(top_bar, text="Verify Hash Chain", command=self._handle_verify_chain).pack(side="right")

        self.lbl_chain_status = tk.Label(top_card, text="Chain verification pending...", bg="#F1F5F9", fg="#0F172A", font=("Consolas", 9), anchor="w", padx=10, pady=6)
        self.lbl_chain_status.pack(fill="x", pady=(0, 8))

        self.results_frame = tk.Frame(top_card, bg="#FFFFFF")
        self.results_frame.pack(fill="both", expand=True)

        log_card = tk.Frame(container, bg="#FFFFFF", highlightthickness=1, highlightbackground="#CBD5E1", padx=18, pady=14)
        log_card.grid(row=1, column=0, sticky="nsew")
        tk.Label(log_card, text="Biometric Audit Ledger", bg="#FFFFFF", fg="#0F172A", font=("Segoe UI", 11, "bold")).pack(anchor="w", pady=(0, 6))

        cols = ("time", "event", "actor", "score", "outcome", "details")
        self.tree_logs = ttk.Treeview(log_card, columns=cols, show="headings", height=8)
        for c, w in [("time", 150), ("event", 130), ("actor", 110), ("score", 60), ("outcome", 85), ("details", 430)]:
            self.tree_logs.heading(c, text=c.capitalize())
            self.tree_logs.column(c, width=w, anchor="center" if c in ("score", "outcome") else "w")
        self.tree_logs.pack(fill="both", expand=True)

    # ------------------------------------------------------------------
    # Tab 5: Sensor & Accuracy Calibration
    # ------------------------------------------------------------------
    def _build_hardware_tab(self) -> None:
        container = tk.Frame(self.tab_hardware, bg="#F8FAFC", padx=8, pady=10)
        container.pack(fill="both", expand=True)
        card = tk.Frame(container, bg="#FFFFFF", highlightthickness=1, highlightbackground="#CBD5E1", padx=22, pady=22)
        card.pack(fill="both", expand=True)

        tk.Label(card, text="R307 / AS608 Hardware Connection & Accuracy Calibration", bg="#FFFFFF", fg="#0F172A", font=("Segoe UI", 12, "bold")).pack(anchor="w", pady=(0, 12))

        grid = tk.Frame(card, bg="#FFFFFF")
        grid.pack(fill="x", anchor="w")

        tk.Label(grid, text="Serial Port:", bg="#FFFFFF", font=("Segoe UI", 10, "bold")).grid(row=0, column=0, sticky="w", pady=6)
        self.combo_port = ttk.Combobox(grid, values=self.sensor.discover_ports(), width=28)
        self.combo_port.set(self.sensor.config.port)
        self.combo_port.grid(row=0, column=1, sticky="w", padx=12, pady=6)

        tk.Label(grid, text="Baud Rate:", bg="#FFFFFF", font=("Segoe UI", 10, "bold")).grid(row=1, column=0, sticky="w", pady=6)
        self.combo_baud = ttk.Combobox(grid, values=[str(b) for b in SUPPORTED_BAUD_RATES], width=28)
        self.combo_baud.set(str(self.sensor.config.baud_rate))
        self.combo_baud.grid(row=1, column=1, sticky="w", padx=12, pady=6)

        tk.Label(grid, text="Accuracy Preset:", bg="#FFFFFF", font=("Segoe UI", 10, "bold")).grid(row=2, column=0, sticky="w", pady=6)
        self.combo_preset = ttk.Combobox(grid, values=[p.label for p in ACCURACY_PRESETS.values()], width=38, state="readonly")
        self.combo_preset.set(ACCURACY_PRESETS["maximum"].label)
        self.combo_preset.bind("<<ComboboxSelected>>", self._on_preset_selected)
        self.combo_preset.grid(row=2, column=1, sticky="w", padx=12, pady=6)

        cfg = self.db.get_config()
        tk.Label(grid, text="Sensor Security Level (1-5):", bg="#FFFFFF", font=("Segoe UI", 10, "bold")).grid(row=3, column=0, sticky="w", pady=6)
        self.spin_sec_level = ttk.Spinbox(grid, from_=1, to=5, width=10)
        self.spin_sec_level.set(str(cfg.get("security_level", 5)))
        self.spin_sec_level.grid(row=3, column=1, sticky="w", padx=12, pady=6)

        tk.Label(grid, text="Minimum Match Confidence Score (30-200):", bg="#FFFFFF", font=("Segoe UI", 10, "bold")).grid(row=4, column=0, sticky="w", pady=6)
        self.spin_min_score = ttk.Spinbox(grid, from_=30, to=200, width=10)
        self.spin_min_score.set(str(cfg.get("min_confidence_score", 85)))
        self.spin_min_score.grid(row=4, column=1, sticky="w", padx=12, pady=6)

        btn_row = tk.Frame(card, bg="#FFFFFF", pady=14)
        btn_row.pack(fill="x", anchor="w")
        ttk.Button(btn_row, text="Connect Hardware Sensor", style="Primary.TButton", command=self._handle_connect_sensor).pack(side="left", padx=(0, 8))
        ttk.Button(btn_row, text="Save Security Calibration", command=self._handle_save_calibration).pack(side="left")

        self.lbl_hw_diag = tk.Label(card, text=self.sensor.status_message, bg="#F1F5F9", fg="#0F172A", font=("Consolas", 9), padx=12, pady=10, anchor="w", justify="left")
        self.lbl_hw_diag.pack(fill="x", pady=(8, 0))

    # ------------------------------------------------------------------
    # Handlers & Refresh
    # ------------------------------------------------------------------
    def _draw_fingerprint_pattern(self, canvas: tk.Canvas, seed: str, matched: Optional[bool]) -> None:
        canvas.delete("all")
        cx, cy = 110, 110
        color = "#38BDF8" if matched is None else ("#22C55E" if matched else "#EF4444")
        digest = hashlib.sha256(seed.encode("utf-8")).digest()
        for ring in range(1, 9):
            rx = ring * 11
            ry = ring * 13
            offset_x = (digest[ring] % 7) - 3
            canvas.create_oval(
                cx - rx + offset_x,
                cy - ry,
                cx + rx + offset_x,
                cy + ry,
                outline=color,
                width=2,
            )
        # Draw minutiae markers
        for idx in range(10):
            ang = (digest[idx] / 255.0) * math.tau
            dist = 20 + (digest[idx + 10] % 65)
            mx = cx + math.cos(ang) * dist
            my = cy + math.sin(ang) * dist
            canvas.create_oval(mx - 3, my - 3, mx + 3, my + 3, fill="#F8FAFC", outline=color, width=1.5)

    def _handle_vote_scan(self) -> None:
        seed = self.entry_vote_seed.get().strip()
        res = self.sensor.verify_high_accuracy(simulated_seed=seed)
        self._draw_fingerprint_pattern(self.vote_canvas, seed or "hw", matched=res.matched)

        if not res.matched or res.template_position is None:
            self.authenticated_voter = None
            self.lbl_vote_feedback.config(text=res.message, bg="#FEE2E2", fg="#991B1B")
            self.refresh_ballot_panel()
            self.refresh_logs()
            return

        voter = self.db.get_voter_by_position(res.template_position)
        if not voter:
            self.authenticated_voter = None
            self.lbl_vote_feedback.config(text="Template matched on sensor but missing from SQLite voter roll.", bg="#FEE2E2", fg="#991B1B")
            self.refresh_ballot_panel()
            return

        if voter["has_voted"]:
            self.authenticated_voter = None
            self.lbl_vote_feedback.config(
                text=f"BLOCKED: {voter['full_name']} ({voter['national_id']}) has ALREADY voted!",
                bg="#FEE2E2",
                fg="#991B1B",
            )
            self.refresh_ballot_panel()
            return

        self.authenticated_voter = voter
        self.authenticated_score = res.confidence_score
        self.lbl_vote_feedback.config(
            text=f"VERIFIED: {voter['full_name']} · Confidence {res.confidence_score}/200 · Quality {res.quality_score}%",
            bg="#DCFCE7",
            fg="#166534",
        )
        self.refresh_ballot_panel()

    def _handle_cast_vote(self) -> None:
        if not self.authenticated_voter:
            messagebox.showwarning("Verification Required", "Scan your fingerprint first.")
            return
        cand_id = self.selected_candidate_var.get()
        if cand_id <= 0:
            messagebox.showwarning("Select Candidate", "Please choose a candidate on the ballot.")
            return
        ok, msg, receipt = self.db.cast_vote_atomic(
            voter_id=int(self.authenticated_voter["id"]),
            candidate_id=cand_id,
            match_score=self.authenticated_score,
        )
        if ok:
            messagebox.showinfo("Secret Ballot Recorded", f"{msg}\n\nFull Receipt Hash:\n{receipt}")
            self._clear_voter_session()
            self.refresh_all()
        else:
            messagebox.showerror("Vote Rejected", msg)
            self.refresh_logs()

    def _clear_voter_session(self) -> None:
        self.authenticated_voter = None
        self.authenticated_score = 0
        self.selected_candidate_var.set(0)
        self.entry_vote_seed.delete(0, "end")
        self._draw_fingerprint_pattern(self.vote_canvas, "IDLE", matched=None)
        self.lbl_vote_feedback.config(text="Awaiting fingerprint scan...", bg="#F1F5F9", fg="#334155")
        self.refresh_ballot_panel()

    def _handle_enroll_voter(self) -> None:
        nid = self.entry_enroll_nid.get().strip()
        name = self.entry_enroll_name.get().strip()
        seed1 = self.entry_enroll_seed1.get().strip()
        seed2 = self.entry_enroll_seed2.get().strip() or seed1

        def on_progress(msg: str, pct: int) -> None:
            self.enroll_progress["value"] = pct
            self.lbl_enroll_status.config(text=msg, bg="#EFF6FF", fg="#1E3A8A")
            self.update_idletasks()

        if not nid or not name:
            self.lbl_enroll_status.config(text="National ID and Full Name are required.", bg="#FEE2E2", fg="#991B1B")
            return

        enr = self.sensor.enroll_high_accuracy(
            simulated_seed_pass1=seed1,
            simulated_seed_pass2=seed2,
            progress_cb=on_progress,
        )
        if not enr.ok or enr.template_position is None or enr.template_bytes is None:
            self.enroll_progress["value"] = 0
            self.lbl_enroll_status.config(text=enr.message, bg="#FEE2E2", fg="#991B1B")
            self.refresh_logs()
            return

        ok, msg, _ = self.db.enroll_voter(
            national_id=nid,
            full_name=name,
            template_position=enr.template_position,
            template_bytes=enr.template_bytes,
            enrollment_score=enr.consistency_score,
        )
        if ok:
            self.lbl_enroll_status.config(text=msg, bg="#DCFCE7", fg="#166534")
            self.entry_enroll_nid.delete(0, "end")
            self.entry_enroll_name.delete(0, "end")
            self.entry_enroll_seed1.delete(0, "end")
            self.entry_enroll_seed2.delete(0, "end")
            self.refresh_all()
        else:
            self.lbl_enroll_status.config(text=msg, bg="#FEE2E2", fg="#991B1B")
            self.refresh_logs()

    def _handle_add_candidate(self) -> None:
        ok, msg, _ = self.db.add_candidate(
            name=self.entry_cand_name.get(),
            party=self.entry_cand_party.get(),
            symbol_code=self.entry_cand_symbol.get(),
        )
        if ok:
            self.entry_cand_name.delete(0, "end")
            self.entry_cand_party.delete(0, "end")
            self.entry_cand_symbol.delete(0, "end")
            self.refresh_all()
        else:
            messagebox.showerror("Candidate Error", msg)

    def _handle_start_election(self) -> None:
        ok, msg = self.db.start_election()
        if ok:
            self.refresh_all()
        else:
            messagebox.showwarning("Cannot Start Election", msg)

    def _handle_stop_election(self) -> None:
        ok, msg = self.db.stop_election()
        if ok:
            self._clear_voter_session()
            self.refresh_all()

    def _handle_reset_all(self) -> None:
        if not messagebox.askyesno("Confirm Reset", "Clear all candidates, voters, ballots, and sensor flash?"):
            return
        self.sensor.clear_sensor_flash()
        self.db.reset_all()
        self._clear_voter_session()
        self.refresh_all()

    def _handle_connect_sensor(self) -> None:
        port = self.combo_port.get().strip()
        baud = int(self.combo_baud.get().strip() or "57600")
        ok, msg = self.sensor.connect(port=port, baud_rate=baud)
        self.lbl_hw_diag.config(text=msg)
        self.refresh_header()
        if ok:
            messagebox.showinfo("Hardware Connected", msg)
        else:
            messagebox.showwarning("Simulator Fallback", msg)

    def _handle_save_calibration(self) -> None:
        level = int(self.spin_sec_level.get())
        score = int(self.spin_min_score.get())
        ok, msg = self.db.update_settings(security_level=level, min_confidence_score=score)
        if ok:
            self.sensor.config.security_level = level
            self.sensor.config.min_confidence_score = score
            if self.sensor.is_hardware:
                self.sensor.connect()
            self.refresh_all()
            messagebox.showinfo("Calibration Saved", msg)
        else:
            messagebox.showerror("Calibration Error", msg)

    def _handle_verify_chain(self) -> None:
        res = self.db.verify_ballot_chain()
        if res["valid"]:
            self.lbl_chain_status.config(
                text=f"VERIFIED · Ballots: {res['ballot_count']} · Head: {res['head_hash'][:24]}...",
                bg="#DCFCE7",
                fg="#166534",
            )
        else:
            self.lbl_chain_status.config(text=f"INTEGRITY ALERT: {res['reason']}", bg="#FEE2E2", fg="#991B1B")

    def _handle_export_csv(self) -> None:
        target = filedialog.asksaveasfilename(
            defaultextension=".csv",
            filetypes=[("CSV files", "*.csv")],
            initialfile="election_results.csv",
        )
        if target:
            saved = self.db.export_results_csv(target)
            messagebox.showinfo("Export Complete", f"Results exported to:\n{saved}")

    def refresh_header(self) -> None:
        cfg = self.db.get_config()
        status = str(cfg.get("status", "setup")).upper()
        self.lbl_title.config(text=cfg.get("title", "Biometric Fingerprint Voting System"))
        self.lbl_subtitle.config(
            text=f"PyFingerprint Security Level {cfg.get('security_level', 5)} · Min Confidence {cfg.get('min_confidence_score', 85)} · SQLite WAL"
        )
        if status == "ACTIVE":
            self.lbl_election_status.config(text="ELECTION ACTIVE", bg="#DCFCE7", fg="#166534")
        elif status == "CLOSED":
            self.lbl_election_status.config(text="ELECTION SEALED", bg="#FEE2E2", fg="#991B1B")
        else:
            self.lbl_election_status.config(text="SETUP MODE", bg="#E2E8F0", fg="#0F172A")

        if self.sensor.is_hardware:
            self.lbl_sensor_status.config(text=f"Hardware: {self.sensor.config.port}", bg="#DCFCE7", fg="#166534")
        else:
            self.lbl_sensor_status.config(text="Biometric Simulator", bg="#EFF6FF", fg="#1D4ED8")

    def refresh_ballot_panel(self) -> None:
        for w in self.ballot_list_frame.winfo_children():
            w.destroy()

        cfg = self.db.get_config()
        if cfg.get("status") != "active":
            self.lbl_authenticated_banner.config(
                text="Voting is closed. Start the election in 'Candidates & Election' first.",
                bg="#FEF3C7",
                fg="#92400E",
            )
            self.btn_cast_ballot.config(state="disabled")
            return

        if not self.authenticated_voter:
            self.lbl_authenticated_banner.config(
                text="Ballot locked until biometric verification succeeds.",
                bg="#F1F5F9",
                fg="#334155",
            )
            self.btn_cast_ballot.config(state="disabled")
            return

        self.lbl_authenticated_banner.config(
            text=f"Authenticated Voter: {self.authenticated_voter['full_name']} (ID: {self.authenticated_voter['national_id']})",
            bg="#DCFCE7",
            fg="#166534",
        )
        candidates = self.db.list_candidates()
        for c in candidates:
            rb = ttk.Radiobutton(
                self.ballot_list_frame,
                text=f"[{c['symbol_code']}]  {c['name']}  —  {c['party']}",
                variable=self.selected_candidate_var,
                value=c["id"],
            )
            rb.pack(anchor="w", pady=6, padx=6)
        self.btn_cast_ballot.config(state="normal")

    def _on_preset_selected(self, _event: object = None) -> None:
        selected_label = self.combo_preset.get()
        for preset in ACCURACY_PRESETS.values():
            if preset.label == selected_label:
                self.spin_sec_level.set(str(preset.security_level))
                self.spin_min_score.set(str(preset.min_confidence_score))
                break

    def refresh_tables(self) -> None:
        all_voters = self.db.list_voters()
        all_cands = self.db.list_candidates()
        total_ballots = sum(c["vote_count"] for c in all_cands)
        chain = self.db.verify_ballot_chain()

        self.kpi_labels["candidates"].config(text=str(len(all_cands)))
        self.kpi_labels["voters"].config(text=str(len(all_voters)))
        self.kpi_labels["ballots"].config(text=str(total_ballots))
        self.kpi_labels["chain"].config(
            text="Verified" if chain["valid"] else "Alert",
            fg="#166534" if chain["valid"] else "#991B1B",
        )

        query = self.voter_search_var.get().strip().lower() if hasattr(self, "voter_search_var") else ""
        for item in self.tree_voters.get_children():
            self.tree_voters.delete(item)
        for v in all_voters:
            if query and query not in v["full_name"].lower() and query not in v["national_id"].lower():
                continue
            self.tree_voters.insert(
                "",
                "end",
                values=(
                    v["id"],
                    v["national_id"],
                    v["full_name"],
                    f"#{v['template_position']}",
                    v["enrollment_score"],
                    "Voted" if v["has_voted"] else "Eligible",
                ),
            )

        for item in self.tree_candidates.get_children():
            self.tree_candidates.delete(item)
        for c in all_cands:
            self.tree_candidates.insert(
                "",
                "end",
                values=(c["id"], c["symbol_code"], c["name"], c["party"], c["vote_count"]),
            )

        for w in self.results_frame.winfo_children():
            w.destroy()
        cands = sorted(self.db.list_candidates(), key=lambda x: x["vote_count"], reverse=True)
        total = sum(c["vote_count"] for c in cands)
        for c in cands:
            pct = (c["vote_count"] / total * 100.0) if total > 0 else 0.0
            row = tk.Frame(self.results_frame, bg="#FFFFFF", pady=4)
            row.pack(fill="x")
            tk.Label(
                row,
                text=f"{c['name']} ({c['party']}) — {c['vote_count']} votes ({pct:.1f}%)",
                bg="#FFFFFF",
                fg="#0F172A",
                font=("Segoe UI", 10, "bold"),
            ).pack(anchor="w")
            bar = ttk.Progressbar(row, maximum=100, value=pct)
            bar.pack(fill="x", pady=(2, 4))

        self._handle_verify_chain()

    def refresh_logs(self) -> None:
        for item in self.tree_logs.get_children():
            self.tree_logs.delete(item)
        for row in self.db.list_audit_logs(limit=40):
            self.tree_logs.insert(
                "",
                "end",
                values=(
                    row["created_at"],
                    row["event_type"],
                    row["actor"],
                    row["match_score"] if row["match_score"] is not None else "—",
                    row["outcome"],
                    row["details"],
                ),
            )

    def refresh_all(self) -> None:
        self.refresh_header()
        self.refresh_ballot_panel()
        self.refresh_tables()
        self.refresh_logs()


def launch_gui(db_path: str = "voting_system.db") -> None:
    app = FingerprintVotingGUI(db_path=db_path)
    app.mainloop()
