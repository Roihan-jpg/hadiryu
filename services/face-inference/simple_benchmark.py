"""Synthetic model components, not a measurement of genuine face verification."""
import json
import resource
import time
import numpy as np
from simple_pipeline import SimplePipeline

started = time.perf_counter()
pipeline = SimplePipeline()
cold = (time.perf_counter() - started) * 1000
rgb = np.full((480, 640, 3), 120, dtype=np.uint8)
aligned = np.full((112, 112, 3), 120, dtype=np.uint8)
durations = []
cpu = time.process_time()
for _ in range(20):
    started = time.perf_counter()
    pipeline.detector.detect(rgb)
    pipeline.recognizer.feature(aligned)
    durations.append((time.perf_counter() - started) * 1000)
print(json.dumps({"workload": "synthetic-recognition-components-not-genuine-verification", "iterations": 20,
    "modelVersion": pipeline.version, "coldStartMs": cold,
    "p50Ms": float(np.percentile(durations, 50)), "p95Ms": float(np.percentile(durations, 95)),
    "cpuSeconds": time.process_time() - cpu, "peakRssMiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
    "cpus": 2, "memoryMiB": 2048, "realVerificationMeasured": False}))
