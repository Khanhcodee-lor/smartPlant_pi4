"""Capture JPEG snapshots from the local ustreamer HTTP endpoint."""

from __future__ import annotations

import base64
from pathlib import Path
import time

import requests

ONE_PIXEL_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////"
    "2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/"
    "2gAMAwEAAgADAAAAH//EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Af//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Af//"
    "EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//Z"
)


class CameraError(RuntimeError):
    """Raised when the camera cannot be initialized or capture an image."""


class CameraService:
    """Read still images from ustreamer's snapshot endpoint."""

    def __init__(
        self,
        *,
        ustreamer_url: str = "http://127.0.0.1:8080",
        dry_run: bool = False,
        timeout: tuple[float, float] = (2.0, 5.0),
        retries: int = 2,
    ) -> None:
        self.dry_run = dry_run
        self.snapshot_url = f"{ustreamer_url.rstrip('/')}/snapshot"
        self.timeout = timeout
        self.retries = retries

    def start(self) -> None:
        """No camera device is opened; ustreamer owns the USB webcam."""

    def capture(self, destination: Path) -> None:
        """Capture one JPEG without overwriting an existing file."""
        if destination.exists():
            raise CameraError(f"Refusing to overwrite existing image: {destination}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            if self.dry_run:
                destination.write_bytes(ONE_PIXEL_JPEG)
            else:
                for attempt in range(self.retries + 1):
                    try:
                        response = requests.get(self.snapshot_url, timeout=self.timeout)
                        response.raise_for_status()
                        content = response.content
                        if not content.startswith(b"\xff\xd8"):
                            raise CameraError("ustreamer returned data that is not a JPEG")
                        destination.write_bytes(content)
                        break
                    except requests.Timeout:
                        if attempt == self.retries:
                            raise
                        time.sleep(0.2 * (attempt + 1))
        except (OSError, RuntimeError, requests.RequestException) as exc:
            raise CameraError(f"Image capture failed: {exc}") from exc

    def close(self) -> None:
        """Nothing to release; ustreamer owns the webcam lifecycle."""
