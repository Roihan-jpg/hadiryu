"""Recognition only. This pipeline provides no liveness or spoof protection."""
import hashlib
import importlib.metadata
import pathlib
import time
import uuid
import cv2
import numpy as np
from identity import load_manifest
from policy import InferenceError, decode_frame


def validate_simple_request(body, version):
    if not isinstance(body, dict) or set(body) != {"sessionId", "modelVersion", "operation", "frames"}:
        raise InferenceError("INVALID_IMAGE")
    try:
        uuid.UUID(body["sessionId"])
    except (ValueError, TypeError, AttributeError):
        raise InferenceError("INVALID_IMAGE") from None
    if body["modelVersion"] != version:
        raise InferenceError("MODEL_VERSION_MISMATCH")
    expected = {"ENROLLMENT": 3, "VERIFICATION": 1}.get(body["operation"])
    if not expected or not isinstance(body["frames"], list) or len(body["frames"]) != expected:
        raise InferenceError("IMAGE_LIMIT")
    for frame in body["frames"]:
        if not isinstance(frame, dict) or set(frame) != {"mimeType", "data"} or not isinstance(frame["data"], str):
            raise InferenceError("INVALID_IMAGE")
        if len(frame["data"]) > 349528:
            raise InferenceError("IMAGE_LIMIT")


def validate_face_center(face, width, height):
    x, y, w, h = face[:4]
    if abs((x + w / 2) / width - .5) > .1 or abs((y + h / 2) / height - .5) > .1:
        raise InferenceError("FACE_NOT_CENTERED")


class SimplePipeline:
    def __init__(self, model_dir="/models"):
        self.manifest = load_manifest(simple=True)
        self.version = self.manifest["modelVersion"]
        for package, expected in self.manifest["runtimes"].items():
            if package != "python" and importlib.metadata.version(package) != expected:
                raise InferenceError("MODEL_VERSION_MISMATCH")
        for model in self.manifest["models"].values():
            if hashlib.sha256((pathlib.Path(model_dir) / model["file"]).read_bytes()).hexdigest() != model["sha256"]:
                raise InferenceError("MODEL_UNAVAILABLE")
        cv2.setNumThreads(2)
        self.detector = cv2.FaceDetectorYN.create(str(pathlib.Path(model_dir) / "yunet.onnx"), "", (640, 480), .8)
        self.recognizer = cv2.FaceRecognizerSF.create(str(pathlib.Path(model_dir) / "sface.onnx"), "")
        self.detector.detect(np.full((480, 640, 3), 120, dtype=np.uint8))
        self.recognizer.feature(np.full((112, 112, 3), 120, dtype=np.uint8))

    def embedding(self, rgb, require_center=False):
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        self.detector.setInputSize((rgb.shape[1], rgb.shape[0]))
        _, faces = self.detector.detect(bgr)
        if faces is None or len(faces) != 1:
            raise InferenceError("ONE_FACE_REQUIRED")
        face = faces[0]
        if not np.isfinite(face).all() or min(face[2:4]) < 96:
            raise InferenceError("QUALITY_FAILED")
        if require_center:
            validate_face_center(face, rgb.shape[1], rgb.shape[0])
        vector = self.recognizer.feature(self.recognizer.alignCrop(bgr, face)).reshape(-1).astype(np.float64)
        norm = np.linalg.norm(vector)
        if vector.shape != (128,) or not np.isfinite(vector).all() or norm <= 0:
            raise InferenceError("MODEL_VERSION_MISMATCH")
        return vector / norm

    def enroll(self, body):
        started = time.perf_counter()
        validate_simple_request(body, self.version)
        vectors = []
        try:
            for frame in body["frames"]:
                rgb = decode_frame(frame)
                try:
                    vectors.append(self.embedding(rgb, require_center=body["operation"] == "ENROLLMENT"))
                finally:
                    rgb.fill(0)
            if any(float(a @ b) < .363 for index, a in enumerate(vectors) for b in vectors[index + 1:]):
                raise InferenceError("IDENTITY_INCONSISTENT")
            vector = np.mean(vectors, axis=0)
            vector /= np.linalg.norm(vector)
            result = {"modelVersion": self.version, "embedding": vector.tolist(),
                      "durationMs": (time.perf_counter() - started) * 1000}
            vector.fill(0)
            return result
        finally:
            for vector in vectors:
                vector.fill(0)

    def close(self):
        pass
