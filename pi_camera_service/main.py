"""Entrypoint for the Raspberry Pi smart plant capture service."""

from __future__ import annotations

import logging
import signal
import sys
import threading
from pathlib import Path

if __package__ in (None, ""):
    # Support `python pi_camera_service/main.py` (used by the PM2 deployment).
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from pi_camera_service.camera_service import CameraService
    from pi_camera_service.capture_processor import CaptureProcessor
    from pi_camera_service.config import Config, ConfigurationError
    from pi_camera_service.disease_analyzer import DiseaseAnalyzer
    from pi_camera_service.firebase_service import FirebaseService
    from pi_camera_service.logger_config import configure_logging
else:
    from .camera_service import CameraService
    from .capture_processor import CaptureProcessor
    from .config import Config, ConfigurationError
    from .disease_analyzer import DiseaseAnalyzer
    from .firebase_service import FirebaseService
    from .logger_config import configure_logging


def main() -> int:
    try:
        config = Config.from_env()
        logger = configure_logging(config.log_dir)
        firebase = FirebaseService(config)
        firebase.initialize()
        camera = CameraService(ustreamer_url=config.ustreamer_url, dry_run=config.dry_run)
        camera.start()
        processor = CaptureProcessor(config, firebase, camera, DiseaseAnalyzer(), logger)
        stop_event = threading.Event()
        signal.signal(signal.SIGINT, lambda *_: stop_event.set())
        signal.signal(signal.SIGTERM, lambda *_: stop_event.set())
        logger.info("Smart plant service started for plant_id=%s", config.plant_id)
        processor.run_forever(stop_event)
        camera.close()
        logger.info("Smart plant service stopped")
        return 0
    except (ConfigurationError, RuntimeError, OSError) as exc:
        logging.getLogger("smart_plant_pi").error("Service stopped safely: %s", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
