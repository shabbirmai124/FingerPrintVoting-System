"""Centralized configuration, accuracy presets, and hardware specs for the Biometric Voting System."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Tuple


@dataclass(frozen=True)
class AccuracyPreset:
    key: str
    label: str
    security_level: int
    min_confidence_score: int
    description: str


ACCURACY_PRESETS: Dict[str, AccuracyPreset] = {
    "maximum": AccuracyPreset(
        key="maximum",
        label="Maximum Accuracy (Level 5 · Threshold 85)",
        security_level=5,
        min_confidence_score=85,
        description="Strictest False Acceptance Rate (< 0.001%). Recommended for official elections.",
    ),
    "high": AccuracyPreset(
        key="high",
        label="High Security (Level 4 · Threshold 75)",
        security_level=4,
        min_confidence_score=75,
        description="High biometric precision with slightly faster dry-finger acceptance.",
    ),
    "balanced": AccuracyPreset(
        key="balanced",
        label="Balanced Standard (Level 3 · Threshold 65)",
        security_level=3,
        min_confidence_score=65,
        description="Standard optical sensor matching for rapid throughput testing.",
    ),
}

DEFAULT_SERIAL_PORTS: Tuple[str, ...] = (
    "/dev/ttyUSB0",
    "/dev/ttyAMA0",
    "/dev/serial0",
    "/dev/ttyACM0",
    "COM3",
    "COM4",
)

SUPPORTED_BAUD_RATES: Tuple[int, ...] = (57600, 115200, 9600)
DEFAULT_DB_FILENAME = "voting_system.db"
DEFAULT_STORAGE_CAPACITY = 1000
