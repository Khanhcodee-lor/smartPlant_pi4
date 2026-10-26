"""Firebase Admin SDK adapter for Realtime Database and Storage."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from .config import Config


class FirebaseService:
    """Expose only the Firebase operations needed by capture orchestration."""

    def __init__(self, config: Config) -> None:
        self.config = config
        self._db: Any = None
        self._bucket: Any = None
        self._firestore: Any = None

    def initialize(self) -> None:
        if self.config.dry_run:
            return
        try:
            import firebase_admin
            from firebase_admin import credentials, db, firestore, storage

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
            self._firestore = firestore.client()
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
        except Exception:
            # Private buckets still work: the server can create a short-lived
            # signed preview URL when the app polls this capture.
            return storage_path

    def get_analyze_command(self, plant_id: str | None = None) -> dict[str, Any] | None:
        if self.config.dry_run:
            return None
        data = self._reference(
            f"plants/{plant_id or self.config.plant_id}/commands/analyze"
        ).get()
        return data if isinstance(data, dict) else None

    def claim_analyze_command(
        self, request_id: str, plant_id: str | None = None
    ) -> dict[str, Any] | None:
        """Atomically move a new analyze command from status 1 to 2."""
        if self.config.dry_run:
            return None
        reference = self._reference(
            f"plants/{plant_id or self.config.plant_id}/commands/analyze"
        )
        claim_token = uuid4().hex

        def claim(command: Any) -> Any:
            if (
                isinstance(command, dict)
                and command.get("request_id") == request_id
                and command.get("status") == 1
            ):
                return {
                    **command,
                    "status": 2,
                    "processing_started_at": _utc_now(),
                    "processing_token": claim_token,
                }
            return command

        result = reference.transaction(claim)
        if (
            isinstance(result, dict)
            and result.get("request_id") == request_id
            and result.get("status") == 2
            and result.get("processing_token") == claim_token
        ):
            return result
        return None

    def download_storage_image(self, storage_path: str, destination: Path) -> None:
        if self.config.dry_run:
            raise RuntimeError("Firebase Storage is unavailable in dry-run mode")
        blob = self._bucket.blob(storage_path)
        blob.reload()
        if blob.size is not None and blob.size > self.config.max_image_bytes:
            raise ValueError("Uploaded image exceeds MAX_IMAGE_BYTES")
        destination.parent.mkdir(parents=True, exist_ok=True)
        blob.download_to_filename(str(destination))

    def update_analyze_command(
        self, data: dict[str, Any], plant_id: str | None = None
    ) -> None:
        self._reference(
            f"plants/{plant_id or self.config.plant_id}/commands/analyze"
        ).update(data)

    def save_analysis_capture(
        self, request_id: str, plant_id: str, data: dict[str, Any]
    ) -> None:
        """Persist the result in RTDB and best-effort mirror it to Firestore."""
        self._reference(
            f"plants/{plant_id}/plant_captures/{request_id}"
        ).set(data)
        self._reference(f"plants/{plant_id}").update(
            {
                "latest_disease": {
                    key: data.get(key)
                    for key in (
                        "request_id",
                        "disease_class",
                        "confidence",
                        "severity",
                        "treatment",
                        "captured_at",
                        "snapshot_url",
                    )
                }
            }
        )

        if self._firestore is None:
            return
        firestore_data = dict(data)
        captured_at = data.get("captured_at")
        if isinstance(captured_at, str):
            try:
                firestore_data["captured_at"] = datetime.fromisoformat(
                    captured_at.replace("Z", "+00:00")
                ).astimezone(timezone.utc)
            except ValueError:
                pass
        try:
            self._firestore.collection("plants").document(plant_id).collection(
                "plant_captures"
            ).document(request_id).set(firestore_data)
        except Exception as exc:
            # RTDB is the queue/result source of truth; Firestore is a mirror.
            import logging

            logging.getLogger("smart_plant_pi").warning(
                "Could not mirror analysis to Firestore request_id=%s: %s",
                request_id,
                exc,
            )


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )
