"""Disease analysis abstraction with a safe placeholder implementation."""

from __future__ import annotations

from typing import Any


class AnalyzerError(RuntimeError):
    """Raised when model loading or inference fails."""


class DiseaseAnalyzer:
    """Analyze an image. Replace `_run_inference` when adding a real model."""

    def load_model(self) -> None:
        """Load a model once; the sample analyzer has no model to load."""

    def _run_inference(self, image_path: str) -> list[dict[str, Any]]:
        return [{"disease_class": "Không phát hiện bệnh", "confidence": 0.0}]

    def analyze(self, image_path: str) -> list[dict[str, Any]]:
        """Return normalized detections and keep model failures local to a capture."""
        try:
            results = self._run_inference(image_path)
        except Exception as exc:
            raise AnalyzerError(f"Disease analysis failed: {exc}") from exc
        normalized: list[dict[str, Any]] = []
        for item in results:
            disease_class = str(item.get("disease_class", "Không phát hiện bệnh"))
            try:
                confidence = float(item.get("confidence", 0.0))
            except (TypeError, ValueError):
                confidence = 0.0
            normalized.append(
                {"disease_class": disease_class, "confidence": max(0.0, min(1.0, confidence))}
            )
        return normalized or [{"disease_class": "Không phát hiện bệnh", "confidence": 0.0}]
