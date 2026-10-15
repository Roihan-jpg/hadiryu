import base64
import io
import unittest
import struct
import zlib
import json
import pathlib
from PIL import Image
from policy import InferenceError, decode_frame, challenge_passed, validate_request

THRESHOLDS = json.loads(pathlib.Path(__file__).with_name('model-manifest.json').read_text())["evaluationThresholds"]


class SafetyTests(unittest.TestCase):
    def frame(self, size=(640, 480), fmt="JPEG"):
        output = io.BytesIO()
        Image.new("RGB", size, (110, 110, 110)).save(output, format=fmt)
        return {"mimeType": "image/jpeg" if fmt == "JPEG" else "image/png", "data": base64.b64encode(output.getvalue()).decode()}

    def test_valid_frame(self):
        self.assertEqual(decode_frame(self.frame()).shape, (480, 640, 3))

    def test_corrupt_type_size_and_animation(self):
        for frame in [{"mimeType": "image/jpeg", "data": "AAAA"}, self.frame((641, 480)),
                      {**self.frame(), "mimeType": "image/png"}, {"mimeType": "image/jpeg", "data": "A" * 400000}]:
            with self.subTest(frame_keys=list(frame)):
                with self.assertRaises(InferenceError):
                    decode_frame(frame)
        output = io.BytesIO()
        Image.new("RGB", (128, 128)).save(output, format="PNG", save_all=True,
                                        append_images=[Image.new("RGB", (128, 128), "red")])
        with self.assertRaises(InferenceError):
            decode_frame({"mimeType": "image/png", "data": base64.b64encode(output.getvalue()).decode()})

    def test_decompression_bomb_header_rejected_before_pixel_allocation(self):
        raw = bytearray(base64.b64decode(self.frame((128, 128), "PNG")["data"]))
        raw[16:24] = struct.pack(">II", 65535, 65535)
        raw[29:33] = struct.pack(">I", zlib.crc32(raw[12:29]))
        with self.assertRaises(InferenceError):
            decode_frame({"mimeType": "image/png", "data": base64.b64encode(raw).decode()})

    def test_temporal_proof_rejects_static_wrong_and_reverse(self):
        opened = {"left": 0.1, "right": 0.1, "yaw": 0.0}
        closed = {"left": 0.9, "right": 0.9, "yaw": 0.0}
        turned = {**opened, "yaw": 0.25}
        self.assertTrue(challenge_passed("BLINK", [opened, closed, opened], THRESHOLDS))
        self.assertTrue(challenge_passed("TURN_LEFT", [opened, turned], THRESHOLDS))
        self.assertFalse(challenge_passed("BLINK", [opened] * 24, THRESHOLDS))
        self.assertFalse(challenge_passed("BLINK", [closed, opened], THRESHOLDS))
        self.assertFalse(challenge_passed("TURN_LEFT", [turned, opened], THRESHOLDS))
        self.assertFalse(challenge_passed("TURN_RIGHT", [opened, turned], THRESHOLDS))

    def test_strict_request_no_client_verdict(self):
        body = {"sessionId": "50000000-0000-4000-8000-000000000001", "modelVersion": "v1",
                "steps": ["BLINK", "TURN_LEFT"], "challengeFrameCounts": [8, 8], "frames": [self.frame()] * 19}
        validate_request(body, "v1")
        for bad in [{**body, "userId": "other"}, {**body, "modelVersion": "v2"},
                    {**body, "frames": body["frames"] * 5}, {**body, "challengeFrameCounts": [2, 14]}]:
            with self.assertRaises(InferenceError):
                validate_request(bad, "v1")

    def test_small_turn_from_neutral_offset_rejects_static_and_wrong_direction(self):
        neutral = {"left": .1, "right": .1, "yaw": .07}
        left, right = {**neutral, "yaw": .205}, {**neutral, "yaw": -.065}
        self.assertTrue(challenge_passed("TURN_LEFT", [neutral, left], THRESHOLDS))
        self.assertTrue(challenge_passed("TURN_RIGHT", [neutral, right], THRESHOLDS))
        self.assertFalse(challenge_passed("TURN_LEFT", [neutral] * 24, THRESHOLDS))
        self.assertFalse(challenge_passed("TURN_LEFT", [neutral, right], THRESHOLDS))
        self.assertFalse(challenge_passed("TURN_LEFT", [left, neutral], THRESHOLDS))


if __name__ == "__main__":
    unittest.main()
