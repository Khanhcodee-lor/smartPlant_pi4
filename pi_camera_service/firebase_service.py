"""Firebase Admin SDK adapter for Realtime Database and Storage."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import Config


class FirebaseService:
    """Expose only the Firebase operations needed by capture orchestration."""

    def __init__(self, config: Config) -> None:
        self.config = config
        self._db: Any = None
        self._bucket: Any = None

    def initialize(self) -> None:
        if self.config.dry_run:
            return
        try:
            import firebase_admin
            from firebase_admin import credentials, db, storage

            if not firebase_admin._apps:
                firebase_admin.initialize_app(
                    credentials.Certificate(str(self.config.firebase_credentials_path)),
                    {
                        "databaseURL": self.config.database_url,
                        "storageBucket": self.config.storage_bucket,
                    },
                )
            self._db = db
            self._bucket = storage.bucket()
        except (ImportError, ValueError, OSError, RuntimeError) as exc:
            raise RuntimeError(f"Firebase initialization failed: {exc}") from exc

    def _reference(self, path: str) -> Any:
        if self.config.dry_run:
            raise RuntimeError("Firebase reference is unavailable in dry-run mode")
        return self._db.reference(path)

    def get_command(self) -> dict[str, Any] | None:
        if self.config.dry_run:
            return None
        data = self._reference(f"plants/{self.config.plant_id}/commands/capture").get()
        return data if isinstance(data, dict) else None

    def get_capture(self, request_id: str) -> dict[str, Any] | None:
        if self.config.dry_run:
            return None
        data = self._reference(
            f"plants/{self.config.plant_id}/plant_captures/{request_id}"
        ).get()
        return data if isinstance(data, dict) else None

    def update_command(self, data: dict[str, Any]) -> None:
        self._reference(f"plants/{self.config.plant_id}/commands/capture").set(data)

    def save_capture(self, capture_id: str, data: dict[str, Any]) -> None:
        self._reference(
            f"plants/{self.config.plant_id}/plant_captures/{capture_id}"
        ).set(data)

    def upload_image(self, image_path: Path, storage_path: str) -> str:
        """Upload an image and return a resolvable Storage path."""
        if image_path.stat().st_size > self.config.max_image_bytes:
            raise ValueError("Image exceeds MAX_IMAGE_BYTES")
        if self.config.dry_run:
            return storage_path
        blob = self._bucket.blob(storage_path)
        blob.upload_from_filename(str(image_path), content_type="image/jpeg")
        try:
            blob.make_public()
            return blob.public_url
        except (OSError, RuntimeError):
            return storage_path
