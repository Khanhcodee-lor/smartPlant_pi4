"""Picamera2 adapter with an explicit dry-run implementation."""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

ONE_PIXEL_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////"
    "2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/"
    "2gAMAwEAAgADAAAAH//EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Af//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Af//"
    "EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//Z"
)


class CameraError(RuntimeError):
    """Raised when the camera cannot be initialized or capture an image."""


class CameraService:
    """Manage the Picamera2 lifecycle and capture still images."""

    def __init__(self, *, dry_run: bool = False) -> None:
        self.dry_run = dry_run
        self._camera: Any = None

    def start(self) -> None:
        if self.dry_run:
            return
        try:
            from picamera2 import Picamera2

            self._camera = Picamera2()
            self._camera.configure(self._camera.create_still_configuration())
            self._camera.start()
        except (ImportError, OSError, RuntimeError) as exc:
            raise CameraError(f"Unable to initialize Picamera2: {exc}") from exc

    def capture(self, destination: Path) -> None:
        """Capture one JPEG without overwriting an existing file."""
        if destination.exists():
            raise CameraError(f"Refusing to overwrite existing image: {destination}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            if self.dry_run:
                destination.write_bytes(ONE_PIXEL_JPEG)
            elif self._camera is None:
                raise CameraError("Camera has not been started")
            else:
                self._camera.capture_file(str(destination))
        except (OSError, RuntimeError) as exc:
            raise CameraError(f"Image capture failed: {exc}") from exc

    def close(self) -> None:
        if self._camera is not None:
            try:
                self._camera.stop()
                self._camera.close()
            except (OSError, RuntimeError):
                self._camera = None
                raise
            self._camera = None
