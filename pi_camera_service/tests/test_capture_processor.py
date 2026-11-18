from pathlib import Path
import base64
import json
import sys
from unittest.mock import Mock

from pi_camera_service.capture_processor import CaptureProcessor
from pi_camera_service.camera_service import CameraError
from pi_camera_service.config import Config
from pi_camera_service.disease_analyzer import DiseaseAnalyzer


def make_processor(firebase=None, camera=None, analyzer=None):
    config = Config(Path("credentials.json"), "db", "bucket", "tomato_001", Path("captures"), Path("logs"), 1, 3, 0.1, 1024)
    return CaptureProcessor(config, firebase or Mock(), camera or Mock(), analyzer or DiseaseAnalyzer(), Mock())


def test_parse_valid_command():
    assert CaptureProcessor.parse_command({"status": 1, "request_id": "manual_123"}) == "manual_123"


def test_ignores_non_capture_status_and_empty_id():
    assert CaptureProcessor.parse_command({"status": 0, "request_id": "x"}) is None
    assert CaptureProcessor.parse_command({"status": 1, "request_id": ""}) is None


def test_skips_completed_request():
    firebase = Mock()
    firebase.get_capture.return_value = {"status": "completed"}
    assert make_processor(firebase=firebase).process_command({"status": 1, "request_id": "done"}) is False
    firebase.update_command.assert_not_called()


def test_creates_expected_paths_and_normalizes_confidence(tmp_path):
    firebase, camera = Mock(), Mock()
    firebase.get_capture.return_value = None
    analyzer = Mock()
    analyzer.analyze.return_value = [{"disease_class": "x", "confidence": 2.5}]
    processor = make_processor(firebase, camera, analyzer)
    processor.config = Config(Path("credentials.json"), "db", "bucket", "tomato_001", tmp_path, Path("logs"), 1, 3, 0.1, 1024)
    assert processor.process_command({"status": 1, "request_id": "req-1"})
    capture = firebase.save_capture.call_args.args[1]
    assert capture["image_path"].startswith("detections/snapshots/")
    assert capture["confidence"] == 1.0


def test_camera_error_marks_command_failed():
    firebase, camera = Mock(), Mock()
    firebase.get_capture.return_value = None
    camera.capture.side_effect = CameraError("camera offline")
    assert make_processor(firebase=firebase, camera=camera).process_command(
        {"status": 1, "request_id": "camera-error"}
    ) is False
    assert firebase.update_command.call_args.args[0]["status"] == -1


def test_upload_error_does_not_escape_loop():
    firebase = Mock()
    firebase.get_capture.return_value = None
    firebase.upload_image.side_effect = RuntimeError("storage offline")
    analyzer = Mock()
    analyzer.analyze.return_value = [{"disease_class": "x", "confidence": 0.8}]
    processor = make_processor(firebase=firebase, analyzer=analyzer)
    assert processor.process_command({"status": 1, "request_id": "upload-error"}) is False


def test_camera_sends_snapshot_to_engine_and_saves_annotated_result(tmp_path):
    jpeg = b"\xff\xd8test\xff\xd9"
    result = {
        "pest_type": "Đốm lá vi khuẩn (Bacterial Spot)",
        "confidence": 0.81,
        "severity": "high",
        "notes": "Kiểm tra vết đốm trên lá",
        "image_b64": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode(),
    }
    engine = tmp_path / "fake-engine"
    engine.write_text(
        f"#!{sys.executable}\n"
        "import json, sys\n"
        "from pathlib import Path\n"
        "assert sys.argv[1] == '--analyze' and Path(sys.argv[2]).read_bytes() == " + repr(jpeg) + "\n"
        "print('engine log')\n"
        "print(" + repr(json.dumps(result)) + ")\n"
    )
    engine.chmod(0o755)
    firebase, camera = Mock(), Mock()
    firebase.get_capture.return_value = None
    firebase.upload_image.side_effect = lambda path, storage_path: f"https://example.test/{storage_path}"
    camera.capture.side_effect = lambda path: path.write_bytes(jpeg)
    processor = make_processor(firebase, camera, DiseaseAnalyzer(engine))
    processor.config = Config(Path("credentials.json"), "db", "bucket", "tomato_001", tmp_path, Path("logs"), 1, 0, 0.1, 1024)

    assert processor.process_command({"status": 1, "request_id": "camera-1"}) is True
    capture = firebase.save_capture.call_args.args[1]
    assert capture["diseaseClass"] == result["pest_type"]
    assert capture["confidence"] == 0.81
    assert capture["notes"] == result["notes"]
    assert capture["annotated_image_url"].endswith("_annotated.jpg")
    assert "image_b64" not in capture["detections"][0]
    assert firebase.upload_image.call_count == 2


def test_camera_engine_failure_is_not_saved_as_healthy(tmp_path):
    engine = tmp_path / "failing-engine"
    engine.write_text(f"#!{sys.executable}\nimport sys\nprint('model unavailable', file=sys.stderr)\nsys.exit(1)\n")
    engine.chmod(0o755)
    firebase, camera = Mock(), Mock()
    firebase.get_capture.return_value = None
    camera.capture.side_effect = lambda path: path.write_bytes(b"\xff\xd8\xff\xd9")
    processor = make_processor(firebase, camera, DiseaseAnalyzer(engine))
    processor.config = Config(Path("credentials.json"), "db", "bucket", "tomato_001", tmp_path, Path("logs"), 1, 0, 0.1, 1024)

    assert processor.process_command({"status": 1, "request_id": "model-error"}) is False
    assert firebase.update_command.call_args.args[0]["status"] == -1
    firebase.save_capture.assert_not_called()
