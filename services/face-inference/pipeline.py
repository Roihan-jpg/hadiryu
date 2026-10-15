import hashlib
import importlib.metadata
import json
import pathlib
import time
import cv2
import mediapipe as mp
import numpy as np
import onnxruntime as ort
from identity import load_manifest
from policy import InferenceError, challenge_passed, decode_frame, validate_request


class Pipeline:
    def __init__(self, model_dir="/models"):
        self.manifest = load_manifest()
        self.version = self.manifest["modelVersion"]
        self.thresholds = self.manifest["evaluationThresholds"]
        for package, expected in self.manifest["runtimes"].items():
            if package != "python" and importlib.metadata.version(package) != expected:
                raise InferenceError("MODEL_VERSION_MISMATCH")
        for model in self.manifest["models"].values():
            model_path = pathlib.Path(model_dir) / model["file"]
            if hashlib.sha256(model_path.read_bytes()).hexdigest() != model["sha256"]:
                raise InferenceError("MODEL_UNAVAILABLE")
        cv2.setNumThreads(2)
        self.detector = cv2.FaceDetectorYN.create(str(pathlib.Path(model_dir) / "yunet.onnx"), "", (640, 480), .8)
        self.recognizer = cv2.FaceRecognizerSF.create(str(pathlib.Path(model_dir) / "sface.onnx"), "")
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        self.pad = ort.InferenceSession(str(pathlib.Path(model_dir) / "pad.onnx"), options, providers=["CPUExecutionProvider"])
        self.landmarker = mp.tasks.vision.FaceLandmarker.create_from_options(mp.tasks.vision.FaceLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(pathlib.Path(model_dir) / "landmarker.task")),
            running_mode=mp.tasks.vision.RunningMode.IMAGE, num_faces=2, output_face_blendshapes=True))
        self.warmup()

    def warmup(self):
        rgb = np.full((480, 640, 3), 120, dtype=np.uint8)
        self.detector.detect(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
        self.recognizer.feature(np.full((112, 112, 3), 120, dtype=np.uint8))
        self.pad_score(rgb)
        self.landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))

    def pad_score(self, rgb):
        tensor = cv2.resize(rgb, (128, 128), interpolation=cv2.INTER_CUBIC).astype(np.float32)
        tensor = (tensor - np.array([151.2405, 119.5950, 107.8395], dtype=np.float32)) / np.array(
            [63.0105, 56.4570, 55.0035], dtype=np.float32)
        tensor = np.transpose(tensor, (2, 0, 1))[None, ...]
        output = self.pad.run(None, {self.pad.get_inputs()[0].name: tensor})[0].reshape(-1)
        if output.shape != (2,) or not np.isfinite(output).all() or not np.all((output >= 0) & (output <= 1)) or not np.isclose(output.sum(), 1, atol=1e-5):
            raise InferenceError("MODEL_VERSION_MISMATCH")
        return float(output[0])

    def inspect(self, rgb):
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        self.detector.setInputSize((rgb.shape[1], rgb.shape[0]))
        _, faces = self.detector.detect(bgr)
        if faces is None or len(faces) != 1:
            raise InferenceError("ONE_FACE_REQUIRED")
        result = self.landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        if len(result.face_landmarks) != 1:
            raise InferenceError("ONE_FACE_REQUIRED")
        points = result.face_landmarks[0]
        xs = [point.x for point in points]
        width = max(xs) - min(xs)
        brightness = float(rgb.mean())
        if width < .22 or abs((min(xs) + max(xs)) / 2 - .5) > .18 or not 55 <= brightness <= 225:
            raise InferenceError("QUALITY_FAILED")
        face = faces[0]
        x, y, w, h = face[:4]
        x1, y1 = max(0, int(x)), max(0, int(y))
        x2, y2 = min(rgb.shape[1], int(x + w)), min(rgb.shape[0], int(y + h))
        crop = rgb[y1:y2, x1:x2]
        if crop.size == 0:
            raise InferenceError("QUALITY_FAILED")
        gray = cv2.cvtColor(cv2.resize(crop, (112, 112)), cv2.COLOR_RGB2GRAY)
        if cv2.Laplacian(gray, cv2.CV_64F).var() < self.thresholds["blurMinimum"]:
            raise InferenceError("QUALITY_FAILED")
        # Match the original model demo's detector margin; keep blur/SFace inputs unchanged.
        pad_policy = self.manifest["padPreprocessing"]
        pad_x, pad_y, pad_w, pad_h = map(float, face[:4])
        dw = pad_w * (pad_policy["faceWidthScale"] - 1) / 2
        dh = pad_h * (pad_policy["faceHeightScale"] - 1) / 2
        pad_crop = rgb[max(0, int(pad_y - dh)):min(rgb.shape[0], int(pad_y + pad_h + dh)),
                       max(0, int(pad_x - dw)):min(rgb.shape[1], int(pad_x + pad_w + dw))]
        if pad_crop.size == 0:
            raise InferenceError("QUALITY_FAILED")
        real_probability = self.pad_score(pad_crop)
        if real_probability < self.thresholds["padRealMinimum"]:
            # A model class and an acceptance policy are different; retain only the category.
            kind = "MODEL_NOT_REAL" if real_probability <= .5 else "BELOW_ACCEPTANCE"
            raise InferenceError("PAD_FAILED", {"rejectionKind": kind})
        aligned = self.recognizer.alignCrop(bgr, face)
        feature = self.recognizer.feature(aligned).reshape(-1).astype(np.float64)
        norm = np.linalg.norm(feature)
        if feature.shape != (128,) or not np.isfinite(feature).all() or norm <= 0:
            raise InferenceError("MODEL_VERSION_MISMATCH")
        feature /= norm
        categories = {item.category_name: item.score for item in result.face_blendshapes[0]}
        cheeks = abs(points[454].x - points[234].x)
        if cheeks < .01:
            raise InferenceError("QUALITY_FAILED")
        yaw = (points[1].x - (points[234].x + points[454].x) / 2) / cheeks
        return {"left": categories.get("eyeBlinkLeft", 0), "right": categories.get("eyeBlinkRight", 0), "yaw": yaw}, feature

    def enroll(self, body):
        started = time.perf_counter()
        validate_request(body, self.version)
        signals, vectors = [], []
        rejection_kinds = set()
        first, second = body["challengeFrameCounts"]
        stages = [{"stage": step, "evaluated": count, "rejected": 0}
                  for step, count in zip(body["steps"] + ["FRONT", "LEFT", "RIGHT"], [first, second, 1, 1, 1])]
        boundaries = np.cumsum([first, second, 1, 1, 1])
        for index, frame in enumerate(body["frames"]):
            rgb = decode_frame(frame)
            try:
                signal, vector = self.inspect(rgb)
                signals.append(signal)
                vectors.append(vector)
            except InferenceError as error:
                if error.code != "PAD_FAILED":
                    raise
                # Evaluate the remaining evidence for diagnosis; any rejection still fails the whole session.
                stage_index = int(np.searchsorted(boundaries, index, side="right"))
                stages[stage_index]["rejected"] += 1
                if error.details and error.details.get("rejectionKind") in ("MODEL_NOT_REAL", "BELOW_ACCEPTANCE"):
                    rejection_kinds.add(error.details["rejectionKind"])
            finally:
                rgb.fill(0)
        if any(stage["rejected"] for stage in stages):
            details = {"stages": stages}
            if rejection_kinds:
                details["rejectionKind"] = next(iter(rejection_kinds)) if len(rejection_kinds) == 1 else "MIXED"
            raise InferenceError("PAD_FAILED", details)
        for step, segment in zip(body["steps"], [signals[:first], signals[first:first + second]]):
            if not challenge_passed(step, segment, self.thresholds):
                raise InferenceError("CHALLENGE_FAILED")
        front, left, right = signals[-3:]
        left_delta, right_delta = left["yaw"] - front["yaw"], right["yaw"] - front["yaw"]
        if abs(front["yaw"]) >= self.thresholds["neutralYawMaximum"] or not (
                self.thresholds["turnYawMinimum"] < left_delta < self.thresholds["turnYawMaximum"] and
                -self.thresholds["turnYawMaximum"] < right_delta < -self.thresholds["turnYawMinimum"]):
            raise InferenceError("POSE_FAILED")
        anchor = vectors[-3]
        if any(float(np.dot(anchor, feature)) < self.thresholds["embeddingConsistencyCosine"] for feature in vectors):
            raise InferenceError("IDENTITY_INCONSISTENT")
        embedding = np.mean(vectors[-3:], axis=0)
        embedding /= np.linalg.norm(embedding)
        return {"modelVersion": self.version, "embedding": embedding.tolist(),
                "durationMs": (time.perf_counter() - started) * 1000}

    def close(self):
        self.landmarker.close()
