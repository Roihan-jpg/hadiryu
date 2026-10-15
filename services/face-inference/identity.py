import hashlib
import json
import pathlib


def load_manifest(simple=False):
    digest = hashlib.sha256()
    files = ("simple-model-manifest.json", "simple_pipeline.py", "policy.py", "identity.py", "requirements.lock") if simple else ("model-manifest.json", "pipeline.py", "policy.py", "identity.py", "requirements.lock")
    for name in files:
        digest.update(pathlib.Path(name).read_bytes())
        digest.update(b"\0")
    manifest = json.loads(pathlib.Path(files[0]).read_text())
    manifest["modelVersion"] += "-" + digest.hexdigest()[:16]
    return manifest
