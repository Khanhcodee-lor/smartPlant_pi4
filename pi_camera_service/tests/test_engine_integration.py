"""Exercise the built engine and bundled model when a native binary is available."""

import base64
import json
import os
import shlex
import shutil
import subprocess
from io import BytesIO
from pathlib import Path
from unittest.mock import Mock

import pytest
from PIL import Image

from pi_camera_service.capture_processor import CaptureProcessor
from pi_camera_service.config import Config
from pi_camera_service.disease_analyzer import DiseaseAnalyzer

ROOT = Path(__file__).resolve().parents[2]
SAMPLE = ROOT / "ai_engine/test_images/7e423f77-2947-4e4e-9777-17a780996d39___GCREC_Bact-Sp-5600_JPG_jpg.rf.22SIsV1MH2SYWf9Vzo9o.jpg"


@pytest.fixture
def engine(tmp_path):
    binary = Path(os.getenv("SMART_PLANT_TEST_ENGINE", ROOT / "ai_engine/build/smart_plant_engine"))
    if not binary.is_file() or not os.access(binary, os.X_OK):
        pytest.skip("Build smart_plant_engine or set SMART_PLANT_TEST_ENGINE")
    model_dir = tmp_path / "model"
    model_dir.mkdir()
    (model_dir / "best.onnx").symlink_to(ROOT / "ai_engine/model/best.onnx")
    return binary.resolve(), tmp_path


def run_engine(engine, image):
    binary, cwd = engine
    env = {**os.environ, "YOLO_CONFIDENCE_THRESHOLD": "0.35"}
    completed = subprocess.run(
        [str(binary), "--analyze", str(image.resolve())], cwd=cwd,
        capture_output=True, text=True, timeout=120, env=env, check=False,
    )
    if completed.returncode:
        return completed, None
    return completed, json.loads(completed.stdout.splitlines()[-1])


def test_model_recognizes_bacterial_spot_in_bundled_sample(engine):
    completed, result = run_engine(engine, SAMPLE)
    assert completed.returncode == 0, completed.stderr
    assert "Bacterial Spot" in result["pest_type"]
    assert result["confidence"] >= 0.35
    assert result["image_b64"].startswith("data:image/jpeg;base64,")


def test_model_accepts_wide_webcam_frame_and_preserves_image_size(engine, tmp_path):
    photo = Image.new("RGB", (1280, 720), (114, 114, 114))
    with Image.open(SAMPLE) as sample:
        photo.paste(sample.resize((600, 600)), (340, 60))
    image_path = tmp_path / "webcam-wide.jpg"
    photo.save(image_path)
    completed, result = run_engine(engine, image_path)
    assert completed.returncode == 0, completed.stderr
    assert "Bacterial Spot" in result["pest_type"]
    annotation = base64.b64decode(result["image_b64"].split(",", 1)[1])
    with Image.open(BytesIO(annotation)) as boxed:
        assert boxed.size == photo.size


def test_blank_image_is_not_reported_as_a_healthy_plant(engine, tmp_path):
    image_path = tmp_path / "blank.jpg"
    Image.new("RGB", (640, 480), "white").save(image_path)
    completed, result = run_engine(engine, image_path)
    assert completed.returncode == 0, completed.stderr
    assert result["pest_type"] == "Không phát hiện bệnh"
    assert "không xác nhận cây khỏe mạnh" in result["notes"]


def test_missing_photo_reports_an_error(engine, tmp_path):
    completed, result = run_engine(engine, tmp_path / "missing.jpg")
    assert completed.returncode != 0
    assert result is None


def test_camera_pipeline_uses_real_model_and_saves_annotation(engine, tmp_path, monkeypatch):
    binary, cwd = engine
    wrapper = tmp_path / "engine-in-isolated-directory"
    wrapper.write_text(f"#!/bin/sh\ncd {shlex.quote(str(cwd))}\nexec {shlex.quote(str(binary))} \"$@\"\n")
    wrapper.chmod(0o755)
    monkeypatch.setenv("YOLO_CONFIDENCE_THRESHOLD", "0.35")
    config = Config(Path("credentials.json"), "db", "bucket", "tomato_001", tmp_path, tmp_path, 1, 0, 0.1, 10_000_000)
    firebase, camera = Mock(), Mock()
    firebase.get_capture.return_value = None
    firebase.upload_image.side_effect = lambda path, storage_path: f"https://example.test/{storage_path}"
    camera.capture.side_effect = lambda path: shutil.copyfile(SAMPLE, path)
    processor = CaptureProcessor(config, firebase, camera, DiseaseAnalyzer(wrapper), Mock())

    assert processor.process_command({"status": 1, "request_id": "real-model"}) is True
    capture = firebase.save_capture.call_args.args[1]
    assert "Bacterial Spot" in capture["disease_class"]
    assert capture["confidence"] >= 0.95
    assert capture["annotated_image_url"].endswith("_annotated.jpg")
    assert firebase.upload_image.call_count == 2
