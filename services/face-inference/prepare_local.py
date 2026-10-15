"""Generate local-only credentials. No key or password is printed."""
import argparse
import hashlib
import ipaddress
import json
import os
import pathlib
import shutil
import subprocess
import urllib.request


def command(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def ca(directory):
    directory.mkdir(parents=True, exist_ok=True)
    command("openssl", "req", "-x509", "-newkey", "rsa:3072", "-nodes", "-days", "30", "-sha256",
            "-subj", "/CN=HadirYu local evaluation", "-keyout", str(directory / "ca.key"), "-out", str(directory / "ca.pem"))


def certificate(directory, name, purpose, sans=""):
    command("openssl", "req", "-newkey", "rsa:3072", "-nodes", "-subj", "/CN=" + name,
            "-keyout", str(directory / (name + ".key")), "-out", str(directory / (name + ".csr")))
    extension = directory / (name + ".ext")
    extension.write_text("basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=" + purpose +
                         ("\nsubjectAltName=" + sans if sans else "") + "\n")
    command("openssl", "x509", "-req", "-in", str(directory / (name + ".csr")), "-CA", str(directory / "ca.pem"),
            "-CAkey", str(directory / "ca.key"), "-CAcreateserial", "-days", "30", "-sha256", "-extfile", str(extension),
            "-out", str(directory / (name + ".pem")))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lan-ip", default="127.0.0.1")
    options = parser.parse_args()
    lan_ip = str(ipaddress.ip_address(options.lan_ip))
    root = pathlib.Path("/output")
    models = root / "models"
    models.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(pathlib.Path("simple-model-manifest.json" if os.environ.get("FACE_PIPELINE_MODE") == "SIMPLE_LOCAL" else "model-manifest.json").read_text())
    for model in manifest["models"].values():
        target = models / model["file"]
        if not target.exists():
            with urllib.request.urlopen(model["url"], timeout=60) as response:
                content = response.read(50 * 1024 * 1024)
            if hashlib.sha256(content).hexdigest() != model["sha256"]:
                raise RuntimeError("Model checksum mismatch")
            target.write_bytes(content)
        if hashlib.sha256(target.read_bytes()).hexdigest() != model["sha256"]:
            raise RuntimeError("Model checksum mismatch")
    private = root / "private"
    if not (private / "ca.pem").exists():
        ca(private)
        certificate(private, "server", "serverAuth", "IP:127.0.0.1,DNS:localhost")
        certificate(private, "client", "clientAuth")
        # Same trusted CA but a different leaf must still be rejected by the service.
        certificate(private, "other-client", "clientAuth")
    server = root / "server"
    server.mkdir(exist_ok=True)
    for name in ("ca.pem", "server.pem", "server.key", "client.pem"):
        shutil.copyfile(private / name, server / name)
    browser = root / "browser"
    if not (browser / "ca.pem").exists():
        ca(browser)
    certificate(browser, "browser", "serverAuth", "DNS:localhost,IP:127.0.0.1,IP:" + lan_ip)
    shutil.copyfile(browser / "ca.pem", browser / "hadiryu-local-ca.crt")
    key = root / "template.key"
    if not key.exists():
        key.write_bytes(os.urandom(32))
    # Only the inference UID reads its private key. The launcher separately
    # restricts Windows host ACLs; POSIX hosts retain owner-only key modes.
    for entry in root.rglob("*.key"):
        if entry.parent == server:
            os.chown(entry, 10001, 10001)
        entry.chmod(0o600)
    print(json.dumps({"prepared": True, "lanIp": lan_ip, "modelVersion": manifest["modelVersion"]}))


if __name__ == "__main__":
    main()
