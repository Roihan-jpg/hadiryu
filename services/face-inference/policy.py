"""Strict media boundary. All evidence is decoded in memory, never persisted."""
import base64
import binascii
import io
import uuid
import warnings
import numpy as np
from PIL import Image, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = 640 * 480


class InferenceError(Exception):
    def __init__(self, code, details=None):
        self.code = code
        self.details = details
        super().__init__(code)


def decode_frame(frame):
    if not isinstance(frame, dict) or set(frame) != {"mimeType", "data"}:
        raise InferenceError("INVALID_IMAGE")
    data = frame["data"]
    if not isinstance(data, str) or len(data) > 349528:
        raise InferenceError("IMAGE_LIMIT")
    try:
        raw = base64.b64decode(data, validate=True)
        if len(raw) > 262144 or base64.b64encode(raw).decode() != data:
            raise InferenceError("IMAGE_LIMIT")
        expected = {"image/jpeg": "JPEG", "image/png": "PNG"}.get(frame["mimeType"])
        if not expected:
            raise InferenceError("INVALID_IMAGE")
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as image:
                if image.format != expected:
                    raise InferenceError("INVALID_IMAGE")
                width, height = image.size
                if not (64 <= width <= 640 and 64 <= height <= 480) or getattr(image, "n_frames", 1) != 1:
                    raise InferenceError("IMAGE_LIMIT")
                image.verify()
            with Image.open(io.BytesIO(raw)) as image:
                return np.asarray(image.convert("RGB")).copy()
    except (ValueError, TypeError, binascii.Error, UnidentifiedImageError, OSError,
            Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise InferenceError("INVALID_IMAGE") from None


def validate_request(body, version):
    keys = {"sessionId", "modelVersion", "steps", "frames", "challengeFrameCounts"}
    if not isinstance(body, dict) or set(body) != keys:
        raise InferenceError("INVALID_IMAGE")
    try:
        uuid.UUID(body["sessionId"])
    except (ValueError, TypeError, AttributeError):
        raise InferenceError("INVALID_IMAGE") from None
    if body["modelVersion"] != version:
        raise InferenceError("MODEL_VERSION_MISMATCH")
    steps, counts, frames = body["steps"], body["challengeFrameCounts"], body["frames"]
    if not isinstance(steps, list) or len(steps) != 2 or "BLINK" not in steps or steps[0] == steps[1] or any(
            step not in ("BLINK", "TURN_LEFT", "TURN_RIGHT") for step in steps):
        raise InferenceError("CHALLENGE_FAILED")
    if not isinstance(counts, list) or len(counts) != 2 or any(type(n) is not int or not 8 <= n <= 24 for n in counts):
        raise InferenceError("IMAGE_LIMIT")
    if not isinstance(frames, list) or not 19 <= len(frames) <= 60 or sum(counts) + 3 != len(frames):
        raise InferenceError("IMAGE_LIMIT")
    if any(not isinstance(frame, dict) or set(frame) != {"mimeType", "data"} or
           not isinstance(frame["data"], str) for frame in frames):
        raise InferenceError("INVALID_IMAGE")
    if sum(len(frame["data"]) * 3 // 4 for frame in frames) > 2936012:
        raise InferenceError("IMAGE_LIMIT")


def challenge_passed(step, signals, thresholds):
    opened, closed, neutral = False, False, None
    for value in signals:
        if step == "BLINK":
            is_open = value["left"] < thresholds["blinkOpenMaximum"] and value["right"] < thresholds["blinkOpenMaximum"]
            is_closed = value["left"] > thresholds["blinkClosedMinimum"] and value["right"] > thresholds["blinkClosedMinimum"]
            if closed and is_open:
                return True
            if opened and is_closed:
                closed = True
            if is_open:
                opened = True
        elif neutral is None:
            if abs(value["yaw"]) < thresholds["neutralYawMaximum"]:
                neutral = value["yaw"]
        elif (step == "TURN_LEFT" and value["yaw"] - neutral > thresholds["turnYawMinimum"]) or (
                step == "TURN_RIGHT" and value["yaw"] - neutral < -thresholds["turnYawMinimum"]):
            return True
    return False
