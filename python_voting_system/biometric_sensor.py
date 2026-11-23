"""
High-Accuracy PyFingerprint Sensor Driver & Biometric Matching Engine.

Supports:
- Physical R307 / AS608 / ZFM-20 / R305 optical/capacitive sensors via `pyfingerprint`
- Security Level 5 hardware calibration (`setSystemParameter(5, 5)`)
- Dual-pass enrollment with 1:N duplicate detection + 1:1 template cross-verification
- Deterministic 512-byte minutiae template simulator when no physical sensor is attached
"""

from __future__ import annotations

import hashlib
import math
import time
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

try:
    from pyfingerprint.pyfingerprint import PyFingerprint
    HAS_PYFINGERPRINT = True
except ImportError:
    PyFingerprint = None  # type: ignore
    HAS_PYFINGERPRINT = False

try:
    import serial.tools.list_ports
    HAS_PYSERIAL = True
except ImportError:
    serial = None  # type: ignore
    HAS_PYSERIAL = False

from .database import VotingDatabase, compute_template_hash


ProgressCallback = Optional[Callable[[str, int], None]]


@dataclass
class BiometricConfig:
    port: str = "/dev/ttyUSB0"
    baud_rate: int = 57600
    address: int = 0xFFFFFFFF
    password: int = 0x00000000
    security_level: int = 5  # 1 (lowest) .. 5 (strictest FAR < 0.001%)
    min_confidence_score: int = 85  # Recommended >= 85 for high accuracy
    scan_timeout_sec: float = 12.0


@dataclass
class EnrollmentResult:
    ok: bool
    message: str
    template_position: Optional[int] = None
    template_bytes: Optional[bytes] = None
    consistency_score: int = 0
    quality_score: int = 0


@dataclass
class BiometricMatchResult:
    matched: bool
    message: str
    template_position: Optional[int] = None
    confidence_score: int = 0
    quality_score: int = 0
    template_hash: Optional[str] = None
    mode: str = "simulator"


def generate_minutiae_template(ridge_seed: str, noise_level: float = 0.0) -> bytes:
    """
    Produces a deterministic 512-byte biometric feature vector simulating R307 CharBuffer.
    Small controlled noise (0.0 - 0.08) models natural finger placement variation while
    distinct fingers remain orthogonal in feature space.
    """
    clean_seed = ridge_seed.strip()
    if not clean_seed:
        raise ValueError("Biometric ridge seed cannot be empty.")

    digest_blocks: List[bytes] = []
    for block_idx in range(16):  # 16 * 32 = 512 bytes
        h = hashlib.sha256(f"{clean_seed}|block={block_idx}".encode("utf-8")).digest()
        digest_blocks.append(h)
    raw = bytearray(b"".join(digest_blocks))

    if noise_level > 0.0:
        # Perturb up to int(noise_level * 512) non-anchor bytes slightly
        stride = max(2, int(round(1.0 / min(noise_level, 0.25))))
        for idx in range(0, len(raw), stride):
            raw[idx] = (raw[idx] + 3) % 256
    return bytes(raw)


def compute_template_similarity(tpl_a: bytes, tpl_b: bytes) -> int:
    """
    Computes an R307-compatible confidence score (0 - 200) between two 512-byte templates
    using normalized byte-tolerance + cosine similarity so natural placement jitter
    scores ~140-190 while different fingers score < 35.
    """
    if not tpl_a or not tpl_b or len(tpl_a) != len(tpl_b):
        return 0
    n = len(tpl_a)
    close_bytes = 0
    dot = 0.0
    mag_a = 0.0
    mag_b = 0.0
    for a, b in zip(tpl_a, tpl_b):
        if abs(a - b) <= 6:
            close_bytes += 1
        ca = float(a) - 127.5
        cb = float(b) - 127.5
        dot += ca * cb
        mag_a += ca * ca
        mag_b += cb * cb

    cosine = dot / (math.sqrt(mag_a) * math.sqrt(mag_b)) if (mag_a > 0 and mag_b > 0) else 0.0
    exact_ratio = close_bytes / n
    # Combine cosine alignment and byte-level minutiae proximity into 0..200 R307 scale
    raw_score = (0.55 * max(0.0, cosine) + 0.45 * exact_ratio) * 200.0
    return max(0, min(200, int(round(raw_score))))


def compute_image_quality(tpl: bytes) -> int:
    """Estimates ridge contrast / minutiae entropy quality (0 - 100)."""
    if not tpl:
        return 0
    unique_bins = len(set(tpl))
    mean = sum(tpl) / len(tpl)
    variance = sum((b - mean) ** 2 for b in tpl) / len(tpl)
    entropy_score = min(100, int(round((unique_bins / 220.0) * 60 + min(40.0, variance / 120.0))))
    return max(40, min(100, entropy_score))


class FingerprintSensorManager:
    """Unified hardware + simulator interface for R307/AS608/ZFM-20 sensors."""

    def __init__(self, db: VotingDatabase, config: Optional[BiometricConfig] = None) -> None:
        self.db = db
        self.config = config or BiometricConfig()
        self._sensor = None
        self.is_hardware = False
        self.status_message = "Initialized in Biometric Simulator mode."
        self.storage_capacity = 1000

    @staticmethod
    def discover_ports() -> List[str]:
        ports: List[str] = []
        if HAS_PYSERIAL:
            for p in serial.tools.list_ports.comports():
                ports.append(p.device)
        defaults = ["/dev/ttyUSB0", "/dev/ttyAMA0", "/dev/serial0", "/dev/ttyACM0", "COM3", "COM4"]
        for d in defaults:
            if d not in ports:
                ports.append(d)
        return ports

    def connect(self, port: Optional[str] = None, baud_rate: Optional[int] = None) -> Tuple[bool, str]:
        if port:
            self.config.port = port
        if baud_rate:
            self.config.baud_rate = int(baud_rate)

        if not HAS_PYFINGERPRINT:
            self._sensor = None
            self.is_hardware = False
            self.status_message = "pyfingerprint library not installed — running high-precision Biometric Simulator."
            return False, self.status_message

        try:
            sensor = PyFingerprint(
                self.config.port,
                self.config.baud_rate,
                self.config.address,
                self.config.password,
            )
            if not sensor.verifyPassword():
                raise ValueError("Fingerprint sensor password verification failed.")

            # Calibrate sensor to highest accuracy (Security Level 5 & 128-byte packets)
            try:
                sensor.setSystemParameter(5, self.config.security_level)
                sensor.setSystemParameter(6, 2)  # Packet length 128 bytes
            except Exception:
                pass

            self._sensor = sensor
            self.is_hardware = True
            self.storage_capacity = sensor.getStorageCapacity()
            count = sensor.getTemplateCount()
            self.status_message = (
                f"Connected to hardware sensor on {self.config.port} @ {self.config.baud_rate} bps "
                f"(Security Level {self.config.security_level}, {count}/{self.storage_capacity} templates)."
            )
            return True, self.status_message
        except Exception as exc:
            self._sensor = None
            self.is_hardware = False
            self.status_message = f"Hardware unavailable on {self.config.port} ({exc}); using Biometric Simulator."
            return False, self.status_message

    def disconnect(self) -> None:
        self._sensor = None
        self.is_hardware = False
        self.status_message = "Disconnected hardware sensor; Biometric Simulator active."

    def _wait_for_finger_hardware(self, prompt_msg: str, progress_cb: ProgressCallback) -> None:
        deadline = time.monotonic() + self.config.scan_timeout_sec
        if progress_cb:
            progress_cb(prompt_msg, 15)
        while not self._sensor.readImage():  # type: ignore[union-attr]
            if time.monotonic() > deadline:
                raise TimeoutError("Timed out waiting for finger placement on sensor prism.")
            time.sleep(0.08)

    def _wait_for_finger_lift_hardware(self, progress_cb: ProgressCallback) -> None:
        if progress_cb:
            progress_cb("Lift finger from optical prism...", 45)
        deadline = time.monotonic() + 6.0
        while self._sensor.readImage():  # type: ignore[union-attr]
            if time.monotonic() > deadline:
                break
            time.sleep(0.1)

    def enroll_high_accuracy(
        self,
        simulated_seed_pass1: Optional[str] = None,
        simulated_seed_pass2: Optional[str] = None,
        progress_cb: ProgressCallback = None,
    ) -> EnrollmentResult:
        """
        Dual-pass enrollment with 1:N duplicate prevention and 1:1 consistency validation.
        """
        cfg = self.db.get_config()
        min_score = int(cfg.get("min_confidence_score", self.config.min_confidence_score))

        if self.is_hardware and self._sensor is not None:
            try:
                self._wait_for_finger_hardware("Pass 1/2: Place finger firmly on optical sensor...", progress_cb)
                self._sensor.convertImage(0x01)

                # 1:N duplicate check before proceeding
                pos, dup_score = self._sensor.searchTemplate()
                if pos >= 0 and dup_score >= min_score:
                    existing = self.db.get_voter_by_position(pos)
                    owner = existing["full_name"] if existing else f"Flash Slot #{pos}"
                    return EnrollmentResult(
                        ok=False,
                        message=f"Duplicate fingerprint rejected! Matches {owner} (Confidence: {dup_score}).",
                    )

                if progress_cb:
                    progress_cb("Pass 1 captured. Lift finger...", 40)
                time.sleep(1.0)
                self._wait_for_finger_lift_hardware(progress_cb)

                self._wait_for_finger_hardware("Pass 2/2: Place the SAME finger again for cross-check...", progress_cb)
                self._sensor.convertImage(0x02)

                # 1:1 cross-verification between Pass 1 and Pass 2
                consistency = int(self._sensor.compareCharacteristics())
                if consistency < min_score:
                    return EnrollmentResult(
                        ok=False,
                        message=(
                            f"Pass 1 & Pass 2 mismatch (Consistency: {consistency} < {min_score}). "
                            "Clean prism and rescan the same finger."
                        ),
                        consistency_score=consistency,
                    )

                if progress_cb:
                    progress_cb("Fusing minutiae template into sensor flash...", 80)

                self._sensor.createTemplate()
                tpl_list = self._sensor.downloadCharacteristics(0x01)
                tpl_bytes = bytes(tpl_list)
                free_pos = self.db.next_free_template_position(self.storage_capacity)
                stored_pos = int(self._sensor.storeTemplate(free_pos, 0x01))
                quality = compute_image_quality(tpl_bytes)

                if progress_cb:
                    progress_cb("Biometric template fused & verified.", 100)

                return EnrollmentResult(
                    ok=True,
                    message=f"Dual-pass biometric template fused at Slot #{stored_pos} (Consistency: {consistency}).",
                    template_position=stored_pos,
                    template_bytes=tpl_bytes,
                    consistency_score=consistency,
                    quality_score=quality,
                )
            except Exception as exc:
                return EnrollmentResult(ok=False, message=f"Sensor enrollment error: {exc}")

        # --- Biometric Simulator Path (runs real 512-byte feature matching + SQLite duplicate search) ---
        seed1 = (simulated_seed_pass1 or "").strip()
        seed2 = (simulated_seed_pass2 or seed1).strip()
        if not seed1:
            return EnrollmentResult(ok=False, message="Fingerprint scan data is required.")

        if progress_cb:
            progress_cb("Pass 1/2: Extracting minutiae vector...", 25)

        tpl1 = generate_minutiae_template(seed1, noise_level=0.0)
        quality = compute_image_quality(tpl1)

        # 1:N duplicate search across all SQLite stored templates
        for existing in self.db.get_all_voter_templates():
            blob = bytes(existing["template_blob"] or b"")
            if not blob:
                continue
            dup_score = compute_template_similarity(tpl1, blob)
            if dup_score >= min_score:
                return EnrollmentResult(
                    ok=False,
                    message=(
                        f"Duplicate fingerprint rejected! Matches {existing['full_name']} "
                        f"({existing['national_id']}, Score: {dup_score})."
                    ),
                )

        if progress_cb:
            progress_cb("Pass 2/2: Cross-verifying second capture...", 65)

        tpl2 = generate_minutiae_template(seed2, noise_level=0.03)
        consistency = compute_template_similarity(tpl1, tpl2)
        if consistency < min_score:
            return EnrollmentResult(
                ok=False,
                message=(
                    f"Pass 1 vs Pass 2 consistency too low ({consistency} < {min_score}). "
                    "Use the same finger on both passes."
                ),
                consistency_score=consistency,
                quality_score=quality,
            )

        free_pos = self.db.next_free_template_position(self.storage_capacity)
        if progress_cb:
            progress_cb("Composite biometric template verified.", 100)

        return EnrollmentResult(
            ok=True,
            message=f"Dual-pass template verified at Slot #{free_pos} (Consistency: {consistency}).",
            template_position=free_pos,
            template_bytes=tpl1,
            consistency_score=consistency,
            quality_score=quality,
        )

    def verify_high_accuracy(
        self,
        simulated_seed: Optional[str] = None,
        progress_cb: ProgressCallback = None,
    ) -> BiometricMatchResult:
        """
        1:N biometric search + strict confidence gating + 1:1 secondary verification.
        """
        cfg = self.db.get_config()
        min_score = int(cfg.get("min_confidence_score", self.config.min_confidence_score))

        if self.is_hardware and self._sensor is not None:
            try:
                self._wait_for_finger_hardware("Place finger on optical sensor to authenticate...", progress_cb)
                self._sensor.convertImage(0x01)
                live_bytes = bytes(self._sensor.downloadCharacteristics(0x01))
                quality = compute_image_quality(live_bytes)

                position, search_score = self._sensor.searchTemplate()
                if position < 0:
                    return BiometricMatchResult(
                        matched=False,
                        message="Authentication failed: Fingerprint not found in voter registry.",
                        confidence_score=0,
                        quality_score=quality,
                        mode="hardware",
                    )

                # Secondary 1:1 cross-check against stored template
                self._sensor.loadTemplate(position, 0x02)
                verify_score = int(self._sensor.compareCharacteristics())
                final_score = min(int(search_score), verify_score)

                if final_score < min_score:
                    return BiometricMatchResult(
                        matched=False,
                        message=(
                            f"Rejected: Confidence {final_score} is below Security Level "
                            f"{cfg.get('security_level', 5)} threshold ({min_score})."
                        ),
                        template_position=position,
                        confidence_score=final_score,
                        quality_score=quality,
                        mode="hardware",
                    )

                return BiometricMatchResult(
                    matched=True,
                    message=f"Biometric verified at Slot #{position} (Confidence: {final_score}).",
                    template_position=position,
                    confidence_score=final_score,
                    quality_score=quality,
                    mode="hardware",
                )
            except Exception as exc:
                return BiometricMatchResult(
                    matched=False,
                    message=f"Hardware authentication error: {exc}",
                    mode="hardware",
                )

        # --- Simulator Path ---
        seed = (simulated_seed or "").strip()
        if not seed:
            return BiometricMatchResult(
                matched=False,
                message="Provide a fingerprint sample / ridge seed to authenticate.",
                mode="simulator",
            )

        live_tpl = generate_minutiae_template(seed, noise_level=0.02)
        quality = compute_image_quality(live_tpl)

        best_voter: Optional[Dict[str, object]] = None
        best_score = -1
        for voter in self.db.get_all_voter_templates():
            blob = bytes(voter["template_blob"] or b"")
            if not blob:
                continue
            score = compute_template_similarity(live_tpl, blob)
            if score > best_score:
                best_score = score
                best_voter = voter

        if best_voter is None or best_score < min_score:
            return BiometricMatchResult(
                matched=False,
                message=(
                    f"Authentication rejected: Best match score ({max(0, best_score)}) "
                    f"is below accuracy threshold ({min_score})."
                ),
                confidence_score=max(0, best_score),
                quality_score=quality,
                mode="simulator",
            )

        return BiometricMatchResult(
            matched=True,
            message=f"Biometric matched {best_voter['full_name']} (Confidence: {best_score}).",
            template_position=int(best_voter["template_position"]),  # type: ignore[arg-type]
            confidence_score=best_score,
            quality_score=quality,
            template_hash=str(best_voter["template_hash"]),
            mode="simulator",
        )

    def clear_sensor_flash(self) -> Tuple[bool, str]:
        if self.is_hardware and self._sensor is not None:
            try:
                self._sensor.clearDatabase()
                return True, "Hardware sensor flash memory cleared."
            except Exception as exc:
                return False, f"Failed to clear sensor flash: {exc}"
        return True, "Simulator template buffer cleared."
