"""Idempotent capture orchestration."""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .camera_service import CameraService
from .config import Config
from .disease_analyzer import DiseaseAnalyzer
from .firebase_service import FirebaseService

REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class CaptureProcessor:
    """Validate commands, capture/analyze/upload, and persist completion atomically by ID."""

    def __init__(
        self,
        config: Config,
        firebase: FirebaseService,
        camera: CameraService,
        analyzer: DiseaseAnalyzer,
        logger: logging.Logger,
    ) -> None:
        self.config, self.firebase, self.camera, self.analyzer, self.logger = (
            config,
            firebase,
            camera,
            analyzer,
            logger,
        )

    @staticmethod
    def parse_command(command: Any) -> str | None:
        """Return a valid request ID only for a capture command (status 1)."""
        if not isinstance(command, dict) or command.get("status") != 1:
            return None
        request_id = command.get("request_id")
        return request_id if isinstance(request_id, str) and REQUEST_ID_PATTERN.fullmatch(request_id) else None

    def process_command(self, command: Any) -> bool:
        """Process one command; errors are recorded and do not escape the polling loop."""
        request_id = self.parse_command(command)
        if request_id is None:
            return False
        try:
            existing = self.firebase.get_capture(request_id)
            if existing and existing.get("status") == "completed":
                self.logger.info("Skipping completed request_id=%s", request_id)
                return False
            self.firebase.update_command(
                {"status": 2, "request_id": request_id, "processing_started_at": utc_now()}
            )
            captured_at = utc_now()
            filename = self._filename(request_id)
            image_path = self.config.capture_dir / filename
            self.camera.capture(image_path)
            detections = self._normalize_detections(self.analyzer.analyze(str(image_path)))
            storage_path = f"detections/snapshots/{filename}"
            snapshot_url = self._upload_with_retry(image_path, storage_path)
            capture_data = self._capture_data(
                request_id, captured_at, snapshot_url, storage_path, detections
            )
            self.firebase.save_capture(request_id, capture_data)
            self.firebase.update_command(
                {
                    "status": 0,
                    "request_id": request_id,
                    "last_processed_request_id": request_id,
                    "last_status": "completed",
                    "completed_at": utc_now(),
                }
            )
            self.logger.info("Completed request_id=%s", request_id)
            return True
        except Exception as exc:
            self.logger.error("Capture failed request_id=%s: %s", request_id, exc)
            self._mark_failed(request_id, str(exc))
            return False

    def _filename(self, request_id: str) -> str:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_request = re.sub(r"[^A-Za-z0-9_.-]", "_", request_id)[:64]
        return f"{self.config.plant_id}_{timestamp}_{safe_request}.jpg"

    def _capture_data(
        self, request_id: str, captured_at: str, snapshot_url: str, storage_path: str,
        detections: list[dict[str, Any]],
    ) -> dict[str, Any]:
        first = detections[0]
        return {
            "request_id": request_id,
            "captured_at": captured_at,
            "processed_at": utc_now(),
            "snapshot_url": snapshot_url,
            "image_path": storage_path,
            "status": "completed",
            "detections": detections,
            "latest_detections": detections,
            "diseaseClass": first["disease_class"],
            "confidence": first["confidence"],
            "snapshotUrl": snapshot_url,
            "capturedAt": captured_at,
        }

    @staticmethod
    def _normalize_detections(detections: Any) -> list[dict[str, Any]]:
        if not isinstance(detections, list):
            raise ValueError("Analyzer returned an invalid result")
        normalized = []
        for item in detections:
            if not isinstance(item, dict):
                raise ValueError("Analyzer returned an invalid detection")
            try:
                confidence = float(item.get("confidence", 0.0))
            except (TypeError, ValueError):
                confidence = 0.0
            normalized.append(
                {
                    "disease_class": str(item.get("disease_class", "Không phát hiện bệnh")),
                    "confidence": max(0.0, min(1.0, confidence)),
                }
            )
        return normalized or [{"disease_class": "Không phát hiện bệnh", "confidence": 0.0}]

    def _upload_with_retry(self, image_path: Path, storage_path: str) -> str:
        last_error: Exception | None = None
        for attempt in range(self.config.max_retries + 1):
            try:
                return self.firebase.upload_image(image_path, storage_path)
            except Exception as exc:
                last_error = exc
                if attempt == self.config.max_retries:
                    break
                delay = self.config.retry_base_seconds * (2**attempt)
                self.logger.warning(
                    "Upload attempt %d/%d failed; retrying in %.1fs: %s",
                    attempt + 1,
                    self.config.max_retries + 1,
                    delay,
                    exc,
                )
                time.sleep(delay)
        raise RuntimeError(f"Upload failed after retries: {last_error}") from last_error

    def _mark_failed(self, request_id: str, error: str) -> None:
        try:
            self.firebase.update_command(
                {
                    "status": -1,
                    "request_id": request_id,
                    "last_status": "failed",
                    "error": error[:300],
                    "failed_at": utc_now(),
                }
            )
        except Exception as update_error:
            self.logger.error("Could not update failed command: %s", update_error)

    def poll_once(self) -> None:
        """Poll once; Firebase errors are logged and isolated from the main loop."""
        try:
            self.process_command(self.firebase.get_command())
        except Exception as exc:
            self.logger.error("Polling failed: %s", exc)

    def run_forever(self, stop_event: Any) -> None:
        while not stop_event.is_set():
            self.poll_once()
            stop_event.wait(self.config.poll_interval_seconds)
