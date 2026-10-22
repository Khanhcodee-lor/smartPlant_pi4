from pathlib import Path
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
    processor = make_processor(firebase=firebase)
    assert processor.process_command({"status": 1, "request_id": "upload-error"}) is False
