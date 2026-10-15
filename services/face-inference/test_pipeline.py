"""Boundary tests with declared signal doubles; these are not biometric acceptance."""
import pathlib
import json
import tempfile
import unittest
from unittest.mock import patch, Mock
from types import SimpleNamespace
import cv2
import numpy as np
from pipeline import Pipeline
from policy import InferenceError

THRESHOLDS = json.loads(pathlib.Path(__file__).with_name('model-manifest.json').read_text())["evaluationThresholds"]


class PipelineBoundaryTests(unittest.TestCase):
    def test_pad_rejections_distinguish_model_class_from_acceptance_without_exposing_scores(self):
        pipeline = Pipeline.__new__(Pipeline)
        pipeline.version = "test"
        body = {"sessionId": "50000000-0000-4000-8000-000000000001", "modelVersion": "test",
                "steps": ["BLINK", "TURN_RIGHT"], "challengeFrameCounts": [8, 8],
                "frames": [{"mimeType": "image/jpeg", "data": "AAAA"}] * 19}
        for kinds, expected in [(["MODEL_NOT_REAL"] * 19, "MODEL_NOT_REAL"),
                                (["BELOW_ACCEPTANCE"] * 19, "BELOW_ACCEPTANCE"),
                                (["MODEL_NOT_REAL"] + ["BELOW_ACCEPTANCE"] * 18, "MIXED")]:
            with patch("pipeline.decode_frame", side_effect=lambda _: np.ones((64, 64, 3), dtype=np.uint8)), \
                    patch.object(pipeline, "inspect", side_effect=[InferenceError("PAD_FAILED", {"rejectionKind": kind}) for kind in kinds]):
                with self.assertRaises(InferenceError) as raised:
                    pipeline.enroll(body)
                self.assertEqual(raised.exception.details["rejectionKind"], expected)
                self.assertEqual(set(raised.exception.details), {"stages", "rejectionKind"})

    def test_pad_output_must_be_a_normalized_probability_pair(self):
        pipeline = Pipeline.__new__(Pipeline)
        pipeline.pad = Mock()
        pipeline.pad.get_inputs.return_value = [SimpleNamespace(name="actual_input_1")]
        pipeline.pad.run.return_value = [np.array([[.95, .95]], dtype=np.float32)]
        with self.assertRaises(InferenceError) as raised:
            pipeline.pad_score(np.zeros((64, 64, 3), dtype=np.uint8))
        self.assertEqual(raised.exception.code, "MODEL_VERSION_MISMATCH")

    def test_pad_rejection_reports_all_stages_without_accepting_failed_frames_or_retaining_pixels(self):
        pipeline = Pipeline.__new__(Pipeline)
        pipeline.version = "test"
        body = {"sessionId": "50000000-0000-4000-8000-000000000001", "modelVersion": "test",
                "steps": ["BLINK", "TURN_RIGHT"], "challengeFrameCounts": [8, 8],
                "frames": [{"mimeType": "image/jpeg", "data": "AAAA"}] * 19}
        pixels = [np.full((64, 64, 3), 120, dtype=np.uint8) for _ in range(19)]
        good = ({"left": .1, "right": .1, "yaw": 0}, np.ones(128) / np.sqrt(128))
        for rejected_indices in ({1}, set(range(19)), {17, 18}):
            evidence = [InferenceError("PAD_FAILED") if i in rejected_indices else good for i in range(19)]
            with patch("pipeline.decode_frame", side_effect=pixels), patch.object(pipeline, "inspect", side_effect=evidence) as inspect:
                with self.assertRaises(InferenceError) as raised:
                    pipeline.enroll(body)
                self.assertEqual(raised.exception.code, "PAD_FAILED")
                self.assertEqual(inspect.call_count, 19)
                self.assertEqual(raised.exception.details, {"stages": [
                    {"stage": stage, "evaluated": len(indices), "rejected": len(rejected_indices.intersection(indices))}
                    for stage, indices in [("BLINK", set(range(8))), ("TURN_RIGHT", set(range(8, 16))),
                                           ("FRONT", {16}), ("LEFT", {17}), ("RIGHT", {18})]]})
                self.assertTrue(all(not image.any() for image in pixels))

    def test_pad_preprocessing_matches_original_model_reference_without_changing_acceptance_threshold(self):
        pipeline = Pipeline.__new__(Pipeline)
        pipeline.pad = Mock()
        pipeline.pad.get_inputs.return_value = [SimpleNamespace(name="actual_input_1")]
        pipeline.pad.run.return_value = [np.array([[.95, .05]], dtype=np.float32)]
        # Synthetic RGB checkerboard exposes interpolation and channel-order differences.
        rgb = np.zeros((23, 31, 3), dtype=np.uint8)
        rgb[::2, ::2] = [240, 100, 20]
        expected = cv2.resize(rgb, (128, 128), interpolation=cv2.INTER_CUBIC).astype(np.float32)
        expected = (expected - np.array([151.2405, 119.5950, 107.8395], dtype=np.float32)) / np.array(
            [63.0105, 56.4570, 55.0035], dtype=np.float32)
        pipeline.pad_score(rgb)
        actual = pipeline.pad.run.call_args.args[1]["actual_input_1"]
        np.testing.assert_allclose(actual, np.transpose(expected, (2, 0, 1))[None, ...])
        self.assertEqual(THRESHOLDS["padRealMinimum"], .9)

    def test_pad_receives_reference_margin_but_blur_and_recognition_keep_their_existing_crop(self):
        pipeline = Pipeline.__new__(Pipeline)
        pipeline.thresholds = THRESHOLDS
        pipeline.manifest = json.loads(pathlib.Path(__file__).with_name('model-manifest.json').read_text())
        rgb = np.zeros((480, 640, 3), dtype=np.uint8)
        rgb[::2] = 200
        face = np.array([200., 100., 200., 240.] + [0.] * 10, dtype=np.float32)
        pipeline.detector = Mock()
        pipeline.detector.detect.return_value = (None, np.array([face]))
        points = [SimpleNamespace(x=.5) for _ in range(478)]
        points[234].x, points[454].x = .3, .7
        pipeline.landmarker = Mock()
        pipeline.landmarker.detect.return_value = SimpleNamespace(face_landmarks=[points], face_blendshapes=[[]])
        pipeline.recognizer = Mock()
        pipeline.recognizer.feature.return_value = np.ones((1, 128))
        with patch.object(pipeline, 'pad_score', return_value=.95) as pad, \
                patch('pipeline.cv2.Laplacian') as laplacian:
            laplacian.return_value.var.return_value = 100
            pipeline.inspect(rgb)
            # Original wrapper's (1.1, 1.05) expansion for this integer detector box.
            np.testing.assert_array_equal(pad.call_args.args[0], rgb[94:346, 190:410])
            pipeline.recognizer.alignCrop.assert_called_once()
            np.testing.assert_array_equal(pipeline.recognizer.alignCrop.call_args.args[1], face)
            expected_blur_input = cv2.cvtColor(cv2.resize(rgb[100:340, 200:400], (112, 112)), cv2.COLOR_RGB2GRAY)
            np.testing.assert_array_equal(laplacian.call_args.args[0], expected_blur_input)
        # A confident-looking crop must still be rejected below the unchanged PAD boundary.
        for score, kind in [(.89, 'BELOW_ACCEPTANCE'), (.51, 'BELOW_ACCEPTANCE'), (.5, 'MODEL_NOT_REAL'), (.1, 'MODEL_NOT_REAL')]:
            with patch.object(pipeline, 'pad_score', return_value=score), patch('pipeline.cv2.Laplacian') as laplacian:
                laplacian.return_value.var.return_value = 100
                with self.assertRaises(InferenceError) as raised:
                    pipeline.inspect(rgb)
                self.assertEqual(raised.exception.code, 'PAD_FAILED')
                self.assertEqual(raised.exception.details, {'rejectionKind': kind})

    def test_small_pose_offsets_are_accepted_but_static_wrong_and_excessive_poses_are_rejected(self):
        pipeline = Pipeline.__new__(Pipeline)
        pipeline.version = "test"
        pipeline.thresholds = THRESHOLDS
        opened = {"left": .1, "right": .1, "yaw": .07}
        closed = {**opened, "left": .9, "right": .9}
        left, right = {**opened, "yaw": .205}, {**opened, "yaw": -.065}
        signals = [opened, closed] + [opened] * 6 + [opened] + [{**opened, "yaw": .30}] * 7 + [opened, left, right]
        body = {"sessionId": "50000000-0000-4000-8000-000000000001", "modelVersion": "test",
                "steps": ["BLINK", "TURN_LEFT"], "challengeFrameCounts": [8, 8],
                "frames": [{"mimeType": "image/jpeg", "data": "AAAA"}] * 19}
        vector = np.ones(128) / np.sqrt(128)
        for final_left in [left, opened, right, {**opened, "yaw": .60}]:
            evidence = [(signal, vector.copy()) for signal in signals]
            evidence[-2] = (final_left, vector.copy())
            with patch("pipeline.decode_frame", side_effect=lambda _: np.zeros((64, 64, 3), dtype=np.uint8)), \
                    patch.object(pipeline, "inspect", side_effect=evidence):
                if final_left is left:
                    self.assertEqual(pipeline.enroll(body)["modelVersion"], "test")
                else:
                    with self.assertRaises(InferenceError) as raised:
                        pipeline.enroll(body)
                    self.assertEqual(raised.exception.code, "POSE_FAILED")

    def test_bad_weights_and_runtime_fail_before_loading_models(self):
        with tempfile.TemporaryDirectory() as directory:
            pathlib.Path(directory, "sface.onnx").write_bytes(b"corrupted weights")
            with self.assertRaises(InferenceError) as raised:
                Pipeline(directory)
            self.assertEqual(raised.exception.code, "MODEL_UNAVAILABLE")
        with patch("pipeline.importlib.metadata.version", return_value="incompatible"):
            with self.assertRaises(InferenceError) as raised:
                Pipeline()
            self.assertEqual(raised.exception.code, "MODEL_VERSION_MISMATCH")

    def test_mixed_identity_and_wrong_pose_fail(self):
        pipeline = Pipeline.__new__(Pipeline)
        pipeline.version = "test"
        pipeline.thresholds = THRESHOLDS
        opened = {"left": .1, "right": .1, "yaw": 0}
        closed = {**opened, "left": .9, "right": .9}
        left, right = {**opened, "yaw": .25}, {**opened, "yaw": -.25}
        signals = [opened, closed] + [opened] * 6 + [opened] + [left] * 7 + [opened, left, right]
        body = {"sessionId": "50000000-0000-4000-8000-000000000001", "modelVersion": "test",
                "steps": ["BLINK", "TURN_LEFT"], "challengeFrameCounts": [8, 8],
                "frames": [{"mimeType": "image/jpeg", "data": "AAAA"}] * 19}
        vector = np.ones(128) / np.sqrt(128)
        for different_identity in (True, False):
            evidence = [(signal, vector.copy()) for signal in signals]
            if different_identity:
                evidence[0] = (signals[0], -vector)
            else:
                evidence[-1] = (opened, vector.copy())
            with patch("pipeline.decode_frame", side_effect=lambda _: np.zeros((64, 64, 3), dtype=np.uint8)), \
                    patch.object(pipeline, "inspect", side_effect=evidence):
                with self.assertRaises(InferenceError) as raised:
                    pipeline.enroll(body)
                self.assertEqual(raised.exception.code, "IDENTITY_INCONSISTENT" if different_identity else "POSE_FAILED")


if __name__ == "__main__":
    unittest.main()
