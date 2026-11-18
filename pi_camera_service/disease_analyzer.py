"""Analyze webcam snapshots with the Raspberry Pi's YOLO engine."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from .engine_runner import run_engine


class AnalyzerError(RuntimeError):
    """Raised when model loading or inference fails."""


class DiseaseAnalyzer:
    """Return webcam detections using the same engine as mobile uploads."""

    def __init__(self, ai_engine_binary: Path | None = None) -> None:
        self.ai_engine_binary = ai_engine_binary

    def analyze(self, image_path: str) -> list[dict[str, Any]]:
        try:
            result = run_engine(Path(image_path), self.ai_engine_binary)
            confidence = float(result.get("confidence", 0.0))
            if not math.isfinite(confidence):
                raise ValueError("Invalid confidence from AI engine")
            return [{
                "disease_class": str(result.get("disease_class") or result["pest_type"]),
                "confidence": max(0.0, min(1.0, confidence)),
                "severity": str(result.get("severity") or "low"),
                "notes": str(result.get("notes") or ""),
                "image_b64": result.get("image_b64"),
            }]
        except Exception as exc:
            raise AnalyzerError(f"Disease analysis failed: {exc}") from exc
