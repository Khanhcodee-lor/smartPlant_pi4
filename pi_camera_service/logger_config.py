"""Logging configuration shared by the service and tests."""

from __future__ import annotations

import logging
from pathlib import Path


def configure_logging(log_dir: Path, level: str = "INFO") -> logging.Logger:
    """Configure console and rotating file logging and return the service logger."""
    log_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("smart_plant_pi")
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    logger.propagate = False
    if logger.handlers:
        return logger
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    console = logging.StreamHandler()
    console.setFormatter(formatter)
    from logging.handlers import RotatingFileHandler

    file_handler = RotatingFileHandler(
        log_dir / "smart-plant-pi.log", maxBytes=5 * 1024 * 1024, backupCount=3
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(console)
    logger.addHandler(file_handler)
    return logger
