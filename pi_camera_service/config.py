"""Environment-backed configuration for the Raspberry Pi capture service."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

PLANT_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class ConfigurationError(ValueError):
    """Raised when required service configuration is invalid."""


@dataclass(frozen=True)
class Config:
    """Validated runtime settings."""

    firebase_credentials_path: Path
    database_url: str
    storage_bucket: str
    plant_id: str
    capture_dir: Path
    log_dir: Path
    poll_interval_seconds: float
    max_retries: int
    retry_base_seconds: float
    max_image_bytes: int
    dry_run: bool = False

    @classmethod
    def from_env(cls, *, dry_run: bool | None = None) -> "Config":
        """Load `.env` and validate settings without exposing credentials."""
        from dotenv import load_dotenv

        load_dotenv()
        is_dry_run = _env_bool("DRY_RUN", False) if dry_run is None else dry_run
        values = {
            "firebase_credentials_path": os.getenv("FIREBASE_CREDENTIALS_PATH", ""),
            "database_url": os.getenv("FIREBASE_DATABASE_URL", ""),
            "storage_bucket": os.getenv("FIREBASE_STORAGE_BUCKET", ""),
            "plant_id": os.getenv("PLANT_ID", ""),
        }
        if not is_dry_run:
            missing = [key.upper() for key, value in values.items() if not value]
            if missing:
                raise ConfigurationError(
                    f"Missing required environment variables: {', '.join(missing)}"
                )
            credential_path = Path(values["firebase_credentials_path"]).expanduser()
            if not credential_path.is_file():
                raise ConfigurationError(
                    f"Firebase credentials file not found: {credential_path}"
                )
        else:
            credential_path = Path(values["firebase_credentials_path"] or "dry-run.json")

        plant_id = values["plant_id"] or "dry-run-plant"
        if not PLANT_ID_PATTERN.fullmatch(plant_id):
            raise ConfigurationError(
                "PLANT_ID must contain only letters, numbers, '_' or '-' (max 64 characters)"
            )
        return cls(
            firebase_credentials_path=credential_path,
            database_url=values["database_url"] or "https://dry-run.invalid",
            storage_bucket=values["storage_bucket"] or "dry-run-bucket",
            plant_id=plant_id,
            capture_dir=Path(os.getenv("CAPTURE_DIR", "captures")).expanduser(),
            log_dir=Path(os.getenv("LOG_DIR", "logs")).expanduser(),
            poll_interval_seconds=_env_float("POLL_INTERVAL_SECONDS", 5.0, minimum=0.5),
            max_retries=_env_int("MAX_RETRIES", 3, minimum=0),
            retry_base_seconds=_env_float("RETRY_BASE_SECONDS", 1.0, minimum=0.1),
            max_image_bytes=_env_int("MAX_IMAGE_BYTES", 10 * 1024 * 1024, minimum=1024),
            dry_run=is_dry_run,
        )


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    return default if value is None else value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, *, minimum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be an integer") from exc
    if value < minimum:
        raise ConfigurationError(f"{name} must be at least {minimum}")
    return value


def _env_float(name: str, default: float, *, minimum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be a number") from exc
    if value < minimum:
        raise ConfigurationError(f"{name} must be at least {minimum}")
    return value
