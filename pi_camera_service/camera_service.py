"""Capture JPEG snapshots from the local ustreamer HTTP endpoint."""

from __future__ import annotations

import base64
import logging
import time
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image, ImageFilter, ImageStat

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
        burst_frames: int = 3,
        burst_interval_seconds: float = 0.2,
        max_image_bytes: int = 10 * 1024 * 1024,
    ) -> None:
        self.dry_run = dry_run
        self.snapshot_url = f"{ustreamer_url.rstrip('/')}/snapshot"
        self.timeout = timeout
        self.retries = retries
        self.burst_frames = burst_frames
        self.burst_interval_seconds = burst_interval_seconds
        self.max_image_bytes = max_image_bytes

    def start(self) -> None:
        """No camera device is opened; ustreamer owns the USB webcam."""

    def capture(self, destination: Path) -> None:
        """Keep an original JPEG with more edge detail from a short burst."""
        if destination.exists():
            raise CameraError(f"Refusing to overwrite existing image: {destination}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            if self.dry_run:
                destination.write_bytes(ONE_PIXEL_JPEG)
            else:
                best_content = None
                best_score = -1.0
                last_error = None
                for index in range(self.burst_frames):
                    if index:
                        time.sleep(self.burst_interval_seconds)
                    try:
                        # The first request retains the existing timeout retries;
                        # later frames are optional if a good snapshot is available.
                        content = self._snapshot(self.retries if best_content is None else 0)
                        score = self._detail_score(content)
                        if score > best_score:
                            best_content, best_score = content, score
                    except (CameraError, OSError, ValueError, Image.DecompressionBombError,
                            requests.RequestException) as exc:
                        last_error = exc
                        logging.getLogger("smart_plant_pi").warning("Snapshot %d failed: %s", index + 1, exc)
                if best_content is None:
                    raise CameraError(f"No usable webcam snapshot: {last_error}")
                destination.write_bytes(best_content)
        except (OSError, RuntimeError, requests.RequestException) as exc:
            raise CameraError(f"Image capture failed: {exc}") from exc

    def _snapshot(self, retries: int) -> bytes:
        for attempt in range(retries + 1):
            try:
                response = requests.get(self.snapshot_url, timeout=self.timeout)
                response.raise_for_status()
                content = response.content
                if not content.startswith(b"\xff\xd8"):
                    raise CameraError("ustreamer returned data that is not a JPEG")
                if len(content) > self.max_image_bytes:
                    raise CameraError("Snapshot exceeds MAX_IMAGE_BYTES")
                return content
            except requests.Timeout:
                if attempt == retries:
                    raise
                time.sleep(0.2 * (attempt + 1))
        raise CameraError("No snapshot returned")

    @staticmethod
    def _detail_score(content: bytes) -> float:
        """Estimate edge detail on a small copy; never alter the saved JPEG."""
        with Image.open(BytesIO(content)) as image:
            if image.format != "JPEG":
                raise CameraError("Snapshot is not a JPEG")
            image.load()
            gray = image.convert("L")
            gray.thumbnail((320, 320), Image.Resampling.BILINEAR)
            edges = gray.filter(ImageFilter.FIND_EDGES)
            if edges.width > 4 and edges.height > 4:
                edges = edges.crop((2, 2, edges.width - 2, edges.height - 2))
            return float(ImageStat.Stat(edges).var[0])

    def close(self) -> None:
        """Nothing to release; ustreamer owns the webcam lifecycle."""
