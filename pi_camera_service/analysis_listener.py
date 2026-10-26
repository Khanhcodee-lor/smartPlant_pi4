"""Process mobile image analysis jobs from the Firebase Realtime Database queue."""

from __future__ import annotations

import json
import logging
import os
import re
import signal
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests

if __package__ in (None, ""):
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from pi_camera_service.config import Config, ConfigurationError
    from pi_camera_service.firebase_service import FirebaseService
    from pi_camera_service.logger_config import configure_logging
else:
    from .config import Config, ConfigurationError
    from .firebase_service import FirebaseService
    from .logger_config import configure_logging

REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
PLANT_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
HEALTHY_LABEL = "Cây khỏe mạnh (Healthy)"


class AnalysisWorker:
    """Claim, download, analyze, and persist one queued mobile image at a time."""

    def __init__(
        self,
        config: Config,
        firebase: FirebaseService,
        logger: logging.Logger,
        *,
        ai_engine_binary: Path | None = None,
        temp_dir: Path | None = None,
        poll_interval_seconds: float | None = None,
    ) -> None:
        self.config = config
        self.firebase = firebase
        self.logger = logger
        project_root = Path(__file__).resolve().parent.parent
        self.ai_engine_dir = project_root / "ai_engine"
        self.ai_engine_binary = ai_engine_binary or Path(
            os.getenv(
                "AI_ENGINE_BINARY",
                str(self.ai_engine_dir / "build" / "smart_plant_engine"),
            )
        ).expanduser()
        self.temp_dir = temp_dir or Path(
            os.getenv("ANALYZE_TEMP_DIR", "/tmp/ai_analysis")
        ).expanduser()
        self.poll_interval_seconds = (
            poll_interval_seconds
            if poll_interval_seconds is not None
            else config.poll_interval_seconds
        )

    def process_command(self, command: Any) -> bool:
        if not isinstance(command, dict) or command.get("status") != 1:
            return False

        request_id = command.get("request_id")
        plant_id = str(command.get("plant_id") or self.config.plant_id)
        if not isinstance(request_id, str) or not REQUEST_ID_PATTERN.fullmatch(request_id):
            self._mark_invalid_command("Missing or invalid request_id")
            return False
        if not PLANT_ID_PATTERN.fullmatch(plant_id):
            self._mark_failed(request_id, self.config.plant_id, "Invalid command plant_id")
            return False
        if plant_id != self.config.plant_id:
            self._mark_failed(
                request_id,
                self.config.plant_id,
                "Command plant_id does not match this worker",
            )
            return False

        claimed = self.firebase.claim_analyze_command(request_id, plant_id)
        if claimed is None:
            return False

        existing = self.firebase.get_capture(request_id)
        if existing and existing.get("status") == "completed":
            self.firebase.update_analyze_command(
                {
                    "status": 0,
                    "last_processed_request_id": request_id,
                    "last_status": "completed",
                    "completed_at": _utc_now(),
                    "processing_token": None,
                },
                plant_id,
            )
            self.logger.info("Skipping completed analysis request_id=%s", request_id)
            return False

        image_storage_path = str(claimed.get("image_storage_path") or "").strip()
        expected_prefix = f"plants/{plant_id}/mobile_uploads/"
        if image_storage_path and (
            not image_storage_path.startswith(expected_prefix)
            or ".." in Path(image_storage_path).parts
        ):
            self._mark_failed(request_id, plant_id, "Invalid image_storage_path")
            return False

        self.temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            with tempfile.TemporaryDirectory(
                prefix=f"{request_id}_", dir=str(self.temp_dir)
            ) as work_dir:
                image_path = Path(work_dir) / "mobile_upload.jpg"
                self._download_image(claimed, image_storage_path, image_path)
                result = self._run_inference(image_path)
                capture = self._build_capture_record(
                    request_id=request_id,
                    plant_id=plant_id,
                    command=claimed,
                    result=result,
                    image_storage_path=image_storage_path,
                )
                self.firebase.save_analysis_capture(request_id, plant_id, capture)

            self.firebase.update_analyze_command(
                {
                    "status": 0,
                    "last_processed_request_id": request_id,
                    "last_status": "completed",
                    "completed_at": _utc_now(),
                    "processing_token": None,
                },
                plant_id,
            )
            self.logger.info("Completed mobile analysis request_id=%s", request_id)
            return True
        except Exception as exc:
            self.logger.exception("Mobile analysis failed request_id=%s", request_id)
            self._mark_failed(request_id, plant_id, str(exc))
            return False

    def _download_image(
        self, command: dict[str, Any], storage_path: str, destination: Path
    ) -> None:
        if storage_path:
            self.firebase.download_storage_image(storage_path, destination)
        else:
            image_url = str(command.get("image_url") or "").strip()
            parsed = urlparse(image_url)
            if parsed.scheme != "https" or parsed.hostname not in {
                "firebasestorage.googleapis.com",
                "storage.googleapis.com",
            }:
                raise ValueError("Command needs a Firebase image_storage_path or image_url")
            response = requests.get(image_url, timeout=(5, 30))
            response.raise_for_status()
            if len(response.content) > self.config.max_image_bytes:
                raise ValueError("Uploaded image exceeds MAX_IMAGE_BYTES")
            destination.write_bytes(response.content)

        if destination.stat().st_size < 4:
            raise ValueError("Downloaded image is empty or truncated")
        with destination.open("rb") as image_file:
            header = image_file.read(8)
        if not (header.startswith(b"\xff\xd8") or header.startswith(b"\x89PNG\r\n\x1a\n")):
            raise ValueError("Uploaded file is not a JPEG or PNG image")

    def _run_inference(self, image_path: Path) -> dict[str, Any]:
        if not self.ai_engine_binary.is_file():
            raise FileNotFoundError(
                f"AI engine binary not found: {self.ai_engine_binary}"
            )
        if not os.access(self.ai_engine_binary, os.X_OK):
            raise PermissionError(f"AI engine binary is not executable: {self.ai_engine_binary}")

        completed = subprocess.run(
            [str(self.ai_engine_binary), "--analyze", str(image_path)],
            cwd=str(self.ai_engine_dir),
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if completed.returncode != 0:
            error = completed.stderr.strip() or completed.stdout.strip()
            raise RuntimeError(f"AI engine exited {completed.returncode}: {error[-1000:]}")

        json_line = next(
            (line.strip() for line in reversed(completed.stdout.splitlines()) if line.strip().startswith("{")),
            None,
        )
        if json_line is None:
            raise RuntimeError("AI engine did not return a JSON result")
        result = json.loads(json_line)
        if not isinstance(result, dict):
            raise RuntimeError("AI engine returned an invalid result")
        return result

    def _build_capture_record(
        self,
        *,
        request_id: str,
        plant_id: str,
        command: dict[str, Any],
        result: dict[str, Any],
        image_storage_path: str,
    ) -> dict[str, Any]:
        disease_class = str(
            result.get("disease_class") or result.get("pest_type") or HEALTHY_LABEL
        ).strip()
        try:
            confidence = float(result.get("confidence", 0.0))
        except (TypeError, ValueError):
            confidence = 0.0
        if confidence != confidence or confidence in (float("inf"), float("-inf")):
            confidence = 0.0
        confidence = max(0.0, min(1.0, confidence))
        severity = str(result.get("severity") or "low").strip().lower()
        treatment = str(result.get("treatment") or result.get("notes") or "").strip()
        captured_at = _normalize_captured_at(
            command.get("captured_at") or command.get("created_at")
        )
        snapshot_url = str(command.get("image_url") or image_storage_path).strip()
        detections = [{"disease_class": disease_class, "confidence": confidence}]
        return {
            "request_id": request_id,
            "plant_id": plant_id,
            "source": str(command.get("source") or "mobile_app"),
            "status": "completed",
            "disease_class": disease_class,
            "diseaseClass": disease_class,
            "pest_type": disease_class,
            "confidence": confidence,
            "severity": severity,
            "treatment": treatment,
            "notes": treatment,
            "captured_at": captured_at,
            "captured_at_iso": captured_at,
            "processed_at": _utc_now(),
            "snapshot_url": snapshot_url,
            "snapshotUrl": snapshot_url,
            "image_path": image_storage_path,
            "image_storage_path": image_storage_path,
            "detections": detections,
            "latest_detections": detections,
        }

    def _mark_invalid_command(self, error: str) -> None:
        self.firebase.update_analyze_command(
            {"status": -1, "last_status": "failed", "error": error[:300], "failed_at": _utc_now()},
            self.config.plant_id,
        )

    def _mark_failed(self, request_id: str, plant_id: str, error: str) -> None:
        failed_at = _utc_now()
        failure = {
            "request_id": request_id,
            "plant_id": plant_id,
            "source": "mobile_app",
            "status": "failed",
            "error": error[:500],
            "failed_at": failed_at,
        }
        try:
            self.firebase._reference(
                f"plants/{plant_id}/plant_captures/{request_id}"
            ).set(failure)
            self.firebase.update_analyze_command(
                {
                    "status": -1,
                    "last_status": "failed",
                    "error": error[:300],
                    "failed_at": failed_at,
                    "processing_token": None,
                },
                plant_id,
            )
        except Exception:
            self.logger.exception("Could not persist failed request_id=%s", request_id)

    def poll_once(self) -> None:
        try:
            command = self.firebase.get_analyze_command(self.config.plant_id)
            self.process_command(command)
        except Exception:
            self.logger.exception("Firebase analyze queue poll failed")

    def run_forever(self, stop_event: threading.Event) -> None:
        self.logger.info(
            "AI analysis listener started plant_id=%s poll=%.1fs",
            self.config.plant_id,
            self.poll_interval_seconds,
        )
        while not stop_event.is_set():
            self.poll_once()
            stop_event.wait(self.poll_interval_seconds)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def _normalize_captured_at(value: Any) -> str:
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, timezone.utc).isoformat(
            timespec="milliseconds"
        ).replace("+00:00", "Z")
    if isinstance(value, str) and value.strip():
        normalized = value.strip()
        try:
            return datetime.fromisoformat(normalized.replace("Z", "+00:00")).astimezone(
                timezone.utc
            ).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        except ValueError:
            pass
    return _utc_now()


def main() -> int:
    try:
        config = Config.from_env()
        logger = configure_logging(config.log_dir)
        firebase = FirebaseService(config)
        firebase.initialize()
        stop_event = threading.Event()
        signal.signal(signal.SIGINT, lambda *_: stop_event.set())
        signal.signal(signal.SIGTERM, lambda *_: stop_event.set())
        worker = AnalysisWorker(config, firebase, logger)
        worker.run_forever(stop_event)
        return 0
    except (ConfigurationError, RuntimeError, OSError) as exc:
        logging.getLogger("smart_plant_pi").error(
            "Analysis listener stopped safely: %s", exc
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
