"""Synthetic component profiling only; no camera/identity/PAD acceptance claim."""
import json
import resource
import time
import platform
import importlib.metadata
import cv2
import mediapipe as mp
import numpy as np
from pipeline import Pipeline

started = time.perf_counter()
pipeline = Pipeline()
cold_ms = (time.perf_counter() - started) * 1000
rgb = np.full((480, 640, 3), 120, dtype=np.uint8)
bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
aligned = np.full((112, 112, 3), 120, dtype=np.uint8)
durations = []
cpu_started = time.process_time()
for _ in range(100):
    start = time.perf_counter()
    pipeline.detector.detect(bgr)
    pipeline.landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    pipeline.pad_score(rgb)
    pipeline.recognizer.feature(aligned)
    durations.append((time.perf_counter() - start) * 1000)
print(json.dumps({"workload": "synthetic-component-cycle-not-enrollment", "iterations": 100,
                  "modelVersion": pipeline.version, "coldStartMs": cold_ms,
                  "actualRuntimes": {"python": platform.python_version(), **{
                      name: importlib.metadata.version(name) for name in pipeline.manifest["runtimes"] if name != "python"}},
                  "containerLimits": {"cpus": 2, "memoryMiB": 2048},
                  "p50Ms": float(np.percentile(durations, 50)), "p95Ms": float(np.percentile(durations, 95)),
                  "p99Ms": float(np.percentile(durations, 99)), "cpuSeconds": time.process_time() - cpu_started,
                  "peakRssMiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
                  "realEnrollmentMeasured": False}))
pipeline.close()
