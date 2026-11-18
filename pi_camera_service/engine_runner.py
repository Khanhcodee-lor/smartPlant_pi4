"""Run the same local YOLO engine for webcam and mobile photographs."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any


def default_engine_binary() -> Path:
    engine_dir = Path(__file__).resolve().parent.parent / "ai_engine"
    return Path(os.getenv("AI_ENGINE_BINARY", str(engine_dir / "build" / "smart_plant_engine"))).expanduser()


def run_engine(image_path: Path, binary: Path | None = None) -> dict[str, Any]:
    """Return the engine's final JSON line or raise when analysis fails."""
    engine_dir = Path(__file__).resolve().parent.parent / "ai_engine"
    executable = (binary or default_engine_binary()).resolve()
    if not executable.is_file():
        raise FileNotFoundError(f"AI engine binary not found: {executable}")
    if not os.access(executable, os.X_OK):
        raise PermissionError(f"AI engine binary is not executable: {executable}")

    try:
        completed = subprocess.run(
            [str(executable), "--analyze", str(image_path.resolve())],
            cwd=str(engine_dir),
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("AI engine timed out after 120 seconds") from exc
    if completed.returncode != 0:
        error = completed.stderr.strip() or completed.stdout.strip()
        raise RuntimeError(f"AI engine exited {completed.returncode}: {error[-1000:]}")

    json_line = next(
        (line.strip() for line in reversed(completed.stdout.splitlines()) if line.strip().startswith("{")),
        None,
    )
    if json_line is None:
        raise RuntimeError("AI engine did not return a JSON result")
    result = json.loads(json_line)
    if not isinstance(result, dict) or not str(result.get("pest_type") or result.get("disease_class") or "").strip():
        raise RuntimeError("AI engine returned an invalid result")
    return result
