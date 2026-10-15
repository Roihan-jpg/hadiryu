import unittest
import tempfile
import pathlib
from unittest.mock import patch, Mock
import numpy as np
from simple_pipeline import SimplePipeline, validate_simple_request, validate_face_center
from policy import InferenceError


class SimplePipelineTests(unittest.TestCase):
    def test_center_requirement_applies_to_enrollment_not_attendance(self):
        pipeline = SimplePipeline.__new__(SimplePipeline)
        pipeline.version = 'test'
        body = {'sessionId':'50000000-0000-4000-8000-000000000001','modelVersion':'test',
                'operation':'VERIFICATION','frames':[{'mimeType':'image/jpeg','data':'AAAA'}]}
        for operation, count in [('VERIFICATION',1),('ENROLLMENT',3)]:
            with patch('simple_pipeline.decode_frame', side_effect=lambda _: np.ones((96,96,3),dtype=np.uint8)), \
                 patch.object(pipeline, 'embedding', side_effect=lambda *args, **kwargs: np.eye(128)[0].copy()) as embedding:
                pipeline.enroll({**body,'operation':operation,'frames':body['frames']*count})
                self.assertEqual(embedding.call_count,count)
                self.assertTrue(all(call.kwargs['require_center'] == (operation=='ENROLLMENT') for call in embedding.call_args_list))
    def test_enrollment_center_accepts_a_small_offset_and_rejects_each_edge(self):
        validate_face_center([220,120,200,240],640,480)
        validate_face_center([245,135,200,240],640,480)
        for face in ([0,120,200,240],[440,120,200,240],[220,0,200,100],[220,380,200,100]):
            with self.assertRaises(InferenceError) as failure:
                validate_face_center(face,640,480)
            self.assertEqual(failure.exception.code,'FACE_NOT_CENTERED')
    def test_wrong_weights_fail_before_any_model_is_loaded(self):
        with tempfile.TemporaryDirectory() as directory:
            pathlib.Path(directory, 'sface.onnx').write_bytes(b'wrong')
            manifest={'modelVersion':'test','runtimes':{},'models':{'recognition':{'file':'sface.onnx','sha256':'a'*64}}}
            with patch('simple_pipeline.load_manifest',return_value=manifest),patch('simple_pipeline.cv2.FaceDetectorYN.create') as load:
                with self.assertRaises(InferenceError) as failure:
                    SimplePipeline(directory)
                self.assertEqual(failure.exception.code,'MODEL_UNAVAILABLE')
                load.assert_not_called()

    def test_operation_limits_and_version(self):
        body = {"sessionId": "50000000-0000-4000-8000-000000000001", "modelVersion": "test",
                "operation": "VERIFICATION", "frames": [{"mimeType": "image/jpeg", "data": "AAAA"}]}
        validate_simple_request(body, "test")
        for change in ({"frames": body["frames"] * 2}, {"userId": "other"}, {"modelVersion": "other"}):
            with self.assertRaises(InferenceError):
                validate_simple_request({**body, **change}, "test")

    def test_three_different_faces_cannot_enroll_and_pixels_are_cleared(self):
        pipeline = SimplePipeline.__new__(SimplePipeline)
        pipeline.version = "test"
        images = [np.ones((96, 96, 3), dtype=np.uint8) for _ in range(3)]
        vectors = [np.eye(128)[i] for i in range(3)]
        body = {"sessionId": "50000000-0000-4000-8000-000000000001", "modelVersion": "test",
                "operation": "ENROLLMENT", "frames": [{"mimeType": "image/jpeg", "data": "AAAA"}] * 3}
        with patch('simple_pipeline.decode_frame', side_effect=images), patch.object(pipeline, 'embedding', side_effect=vectors):
            with self.assertRaises(InferenceError) as failure:
                pipeline.enroll(body)
            self.assertEqual(failure.exception.code, 'IDENTITY_INCONSISTENT')
        self.assertTrue(all(not image.any() for image in images))

    def test_single_face_and_minimum_size_are_required(self):
        pipeline = SimplePipeline.__new__(SimplePipeline)
        pipeline.detector = Mock()
        pipeline.recognizer = Mock()
        for faces, code in [(None, 'ONE_FACE_REQUIRED'), (np.zeros((2, 15)), 'ONE_FACE_REQUIRED'),
                            (np.array([[0, 0, 95, 120] + [0] * 11]), 'QUALITY_FAILED')]:
            pipeline.detector.detect.return_value = (None, faces)
            with self.assertRaises(InferenceError) as failure:
                pipeline.embedding(np.zeros((480, 640, 3), dtype=np.uint8))
            self.assertEqual(failure.exception.code, code)
        pipeline.recognizer.feature.assert_not_called()
