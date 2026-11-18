"""Exercise the built engine and bundled model when a native binary is available."""

import base64
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import shlex
import shutil
import subprocess
import threading
from io import BytesIO
from pathlib import Path
from unittest.mock import Mock

import pytest
from PIL import Image, ImageFilter

from pi_camera_service.camera_service import CameraService
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


def run_engine(engine, image, *, enhance=True, sharpen=None):
    binary, cwd = engine
    env = {**os.environ, "YOLO_CONFIDENCE_THRESHOLD": "0.35", "YOLO_ENHANCE": "1" if enhance else "0",
           "YOLO_SHARPEN_STRENGTH": str(sharpen if sharpen is not None else 0.3)}
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
    assert result["analysis_method"] == "sharpened_frame"
    assert "độ nét tăng nhẹ" in result["notes"]
    without_sharpening, raw = run_engine(engine, SAMPLE, sharpen=0)
    assert without_sharpening.returncode == 0
    assert raw["analysis_method"] == "full_frame"


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


def test_bright_noisy_frame_is_not_reported_as_healthy(engine, tmp_path):
    noise = Image.effect_noise((640, 480), 12).point(lambda value: min(255, int(247 + (value - 128) / 3)))
    image_path = tmp_path / "overexposed.jpg"
    noise.convert("RGB").save(image_path, quality=95)
    completed, result = run_engine(engine, image_path)
    assert completed.returncode == 0, completed.stderr
    assert result["pest_type"] == "Không phát hiện bệnh"
    assert result["needs_review"] is True


def test_small_centered_leaf_is_examined_when_full_frame_misses_it(engine, tmp_path):
    photo = Image.new("RGB", (1920, 1080), (114, 114, 114))
    with Image.open(SAMPLE) as sample:
        photo.paste(sample.resize((260, 260)), (830, 410))
    image_path = tmp_path / "small-leaf.jpg"
    photo.save(image_path, quality=95)

    raw_completed, raw = run_engine(engine, image_path, enhance=False)
    enhanced_completed, enhanced = run_engine(engine, image_path)

    assert raw_completed.returncode == enhanced_completed.returncode == 0
    assert raw["pest_type"] == "Không phát hiện bệnh"
    assert "Bacterial Spot" in enhanced["pest_type"]
    assert enhanced["analysis_method"] == "center_crop"
    assert enhanced["needs_review"] is True
    assert "vùng giữa ảnh" in enhanced["notes"]
    with Image.open(BytesIO(base64.b64decode(enhanced["image_b64"].split(",", 1)[1]))) as annotated:
        assert annotated.size == photo.size


def test_detected_leaf_is_checked_again_at_larger_scale(engine, tmp_path):
    sample_path = next((ROOT / "ai_engine/test_images").glob("6c1529dd*.jpg"))
    photo = Image.new("RGB", (1920, 1080), (114, 114, 114))
    with Image.open(sample_path) as sample:
        photo.paste(sample.resize((380, 380)), (770, 350))
    image_path = tmp_path / "leaf-detail.jpg"
    photo.save(image_path, quality=95)

    raw_completed, raw = run_engine(engine, image_path, enhance=False)
    enhanced_completed, enhanced = run_engine(engine, image_path)

    assert raw_completed.returncode == enhanced_completed.returncode == 0
    assert "Bacterial Spot" in raw["pest_type"]
    assert raw["pest_type"] == enhanced["pest_type"]
    assert enhanced["analysis_method"] == "leaf_crop"
    assert enhanced["confidence"] > raw["confidence"] + 0.1
    assert enhanced["needs_review"] is True
    assert "Ảnh toàn cảnh có điểm thấp" in enhanced["notes"]
    no_sharpen_completed, no_sharpen = run_engine(engine, image_path, sharpen=0)
    assert no_sharpen_completed.returncode == 0
    assert no_sharpen["analysis_method"] == "leaf_crop"
    assert "kích thước lớn hơn" in no_sharpen["notes"]


def test_disagreeing_views_are_marked_for_review(engine, tmp_path):
    sample_path = next((ROOT / "ai_engine/test_images").glob("6bbdcbc3*.jpg"))
    photo = Image.new("RGB", (1920, 1080), (114, 114, 114))
    with Image.open(sample_path) as sample:
        photo.paste(sample.resize((340, 340)), (790, 370))
    image_path = tmp_path / "ambiguous-leaf.jpg"
    photo.save(image_path, quality=95)

    completed, result = run_engine(engine, image_path)

    assert completed.returncode == 0, completed.stderr
    assert result["analysis_method"] == "leaf_crop"
    assert result["needs_review"] is True
    assert "hai kết quả khác nhau" in result["notes"]


def test_simultaneous_analyses_save_separate_annotated_images(engine, tmp_path):
    binary, _ = engine
    isolated_engine = tmp_path / "isolated" / "ai_engine"
    isolated_engine.mkdir(parents=True)
    (isolated_engine / "model").symlink_to(ROOT / "ai_engine/model")
    public = isolated_engine.parent / "server/public"
    public.mkdir(parents=True)
    samples = [SAMPLE, next((ROOT / "ai_engine/test_images").glob("6c1529dd*.jpg"))]

    def analyze(path):
        completed, result = run_engine((binary, isolated_engine), path)
        assert completed.returncode == 0, completed.stderr
        return result

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(analyze, samples))
    assert results[0]["image_path"] != results[1]["image_path"]
    for result in results:
        image_path = public / Path(result["image_path"]).name
        assert image_path.read_bytes() == base64.b64decode(result["image_b64"].split(",", 1)[1])


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
    monkeypatch.setenv("YOLO_ENHANCE", "1")
    monkeypatch.setenv("YOLO_SHARPEN_STRENGTH", "0.3")
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


def test_webcam_burst_uses_real_model_on_the_chosen_frame(engine, tmp_path, monkeypatch):
    binary, cwd = engine
    wrapper = tmp_path / "engine-webcam-test"
    wrapper.write_text(f"#!/bin/sh\ncd {shlex.quote(str(cwd))}\nexec {shlex.quote(str(binary))} \"$@\"\n")
    wrapper.chmod(0o755)
    monkeypatch.setenv("YOLO_CONFIDENCE_THRESHOLD", "0.35")
    monkeypatch.setenv("YOLO_ENHANCE", "1")
    monkeypatch.setenv("YOLO_SHARPEN_STRENGTH", "0.3")
    with Image.open(SAMPLE) as sample:
        sharp_buffer, blurred_buffer = BytesIO(), BytesIO()
        sample.convert("RGB").save(sharp_buffer, format="JPEG", quality=95)
        sample.convert("RGB").filter(ImageFilter.GaussianBlur(4)).save(blurred_buffer, format="JPEG", quality=95)
    sharp, blurred = sharp_buffer.getvalue(), blurred_buffer.getvalue()
    frames = iter([blurred, sharp, blurred])

    class SnapshotHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            assert self.path == "/snapshot"
            image = next(frames)
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(image)))
            self.end_headers()
            self.wfile.write(image)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), SnapshotHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        camera = CameraService(ustreamer_url=f"http://127.0.0.1:{server.server_port}", burst_interval_seconds=0)
        config = Config(Path("credentials.json"), "db", "bucket", "tomato_001", tmp_path, tmp_path, 1, 0, 0.1, 10_000_000)
        firebase = Mock()
        firebase.get_capture.return_value = None
        firebase.upload_image.side_effect = lambda path, storage_path: f"https://example.test/{storage_path}"
        logger = Mock()
        processor = CaptureProcessor(config, firebase, camera, DiseaseAnalyzer(wrapper), logger)

        assert processor.process_command({"status": 1, "request_id": "webcam-burst"}) is True, logger.error.call_args_list
        assert firebase.upload_image.call_args_list[0].args[0].read_bytes() == sharp
        result = firebase.save_capture.call_args.args[1]
        assert "Bacterial Spot" in result["disease_class"]
        assert result.get("annotated_image_url", "").endswith("_annotated.jpg"), logger.warning.call_args_list
    finally:
        server.shutdown()
        thread.join()
        server.server_close()
