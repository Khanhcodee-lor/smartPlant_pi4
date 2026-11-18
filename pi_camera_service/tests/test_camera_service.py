from io import BytesIO
from pathlib import Path
from unittest.mock import Mock

import pytest
import requests
from PIL import Image, ImageFilter

from pi_camera_service.camera_service import CameraError, CameraService
from pi_camera_service.config import Config, ConfigurationError

SAMPLE = next((Path(__file__).resolve().parents[2] / "ai_engine/test_images").glob("7e423f77*.jpg"))


def jpeg(image):
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=95)
    return buffer.getvalue()


def response(content):
    result = Mock()
    result.content = content
    return result


def test_burst_keeps_the_sharpest_original_frame(tmp_path, monkeypatch):
    with Image.open(SAMPLE) as image:
        sharp = jpeg(image.convert("RGB"))
        blurry = jpeg(image.convert("RGB").filter(ImageFilter.GaussianBlur(4)))
    assert CameraService._detail_score(sharp) > CameraService._detail_score(blurry)
    get = Mock(side_effect=[response(blurry), response(sharp), response(blurry)])
    monkeypatch.setattr(requests, "get", get)
    camera = CameraService(burst_frames=3, burst_interval_seconds=0)
    destination = tmp_path / "capture.jpg"

    camera.capture(destination)

    assert get.call_count == 3
    assert destination.read_bytes() == sharp


def test_burst_keeps_a_valid_frame_when_later_snapshots_fail(tmp_path, monkeypatch):
    with Image.open(SAMPLE) as image:
        valid = jpeg(image.convert("RGB"))
    get = Mock(side_effect=[response(valid), requests.Timeout("offline"), response(b"invalid")])
    monkeypatch.setattr(requests, "get", get)
    camera = CameraService(burst_frames=3, burst_interval_seconds=0)
    destination = tmp_path / "capture.jpg"

    camera.capture(destination)

    assert destination.read_bytes() == valid


def test_burst_reports_failure_when_no_frame_is_usable(tmp_path, monkeypatch):
    monkeypatch.setattr(requests, "get", Mock(return_value=response(b"not a jpeg")))
    camera = CameraService(burst_frames=2, burst_interval_seconds=0, retries=0)

    with pytest.raises(CameraError, match="No usable webcam snapshot"):
        camera.capture(tmp_path / "capture.jpg")


@pytest.mark.parametrize(
    ("name", "value"),
    [("CAPTURE_BURST_FRAMES", "0"), ("CAPTURE_BURST_FRAMES", "6"),
     ("CAPTURE_BURST_INTERVAL_SECONDS", "nan"), ("CAPTURE_BURST_INTERVAL_SECONDS", "2")],
)
def test_burst_configuration_is_bounded(name, value, monkeypatch):
    monkeypatch.setattr("dotenv.load_dotenv", lambda *_args, **_kwargs: False)
    monkeypatch.setenv("PLANT_ID", "tomato_001")
    monkeypatch.setenv("CAPTURE_BURST_FRAMES", "3")
    monkeypatch.setenv("CAPTURE_BURST_INTERVAL_SECONDS", "0.2")
    monkeypatch.setenv(name, value)
    with pytest.raises(ConfigurationError, match=name):
        Config.from_env(dry_run=True)
