"""mTLS loopback service with one persistent, replaceable inference process."""
import hashlib
import json
import multiprocessing
import os
import pathlib
import signal
import ssl
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from policy import InferenceError, validate_request
from identity import load_manifest


def worker(connection):
    # Third-party native runtimes can print diagnostics; never forward their exceptions or input.
    null = os.open(os.devnull, os.O_WRONLY)
    os.dup2(null, 1)
    os.dup2(null, 2)
    os.close(null)
    try:
        if os.environ.get("FACE_PIPELINE_MODE") == "SIMPLE_LOCAL":
            from simple_pipeline import SimplePipeline as Pipeline
        else:
            from pipeline import Pipeline
        started = time.perf_counter()
        pipeline = Pipeline()
        connection.send({"ready": True, "coldStartMs": (time.perf_counter() - started) * 1000})
        while True:
            body = connection.recv()
            if body is None:
                break
            try:
                connection.send({"result": pipeline.enroll(body)})
            except InferenceError as error:
                connection.send({"error": error.code, "details": error.details})
            except Exception:
                connection.send({"error": "MODEL_UNAVAILABLE"})
        pipeline.close()
    except Exception:
        connection.send({"ready": False})
    finally:
        connection.close()


class Supervisor:
    def __init__(self):
        self.busy = threading.Lock()
        self.ready = False
        self.closed = False
        self.cold_start_ms = None
        self.process = None
        self.connection = None
        self.startup_failures = 0
        self.start()

    def start(self):
        self.ready = False
        context = multiprocessing.get_context("spawn")
        self.connection, child = context.Pipe()
        self.process = context.Process(target=worker, args=(child,), daemon=True)
        self.process.start()
        child.close()
        process, connection = self.process, self.connection

        def warming():
            try:
                if connection.poll(45):
                    status = connection.recv()
                    if process is self.process and not self.closed:
                        self.ready = status.get("ready", False)
                        self.cold_start_ms = status.get("coldStartMs")
                        if self.ready:
                            self.startup_failures = 0
                elif process is self.process and not self.closed:
                    # A late warm-up previously left a living worker permanently unready.
                    self.stop_child()
                    self.startup_failures += 1
                    if self.startup_failures < 3:
                        self.start()
            except (EOFError, OSError):
                if process is self.process:
                    self.ready = False
        threading.Thread(target=warming, daemon=True).start()

    def stop_child(self):
        self.ready = False
        if self.process and self.process.is_alive():
            self.process.terminate()
            self.process.join(2)
            if self.process.is_alive():
                self.process.kill()
                self.process.join(1)
        if self.connection:
            self.connection.close()

    def run(self, body):
        if not self.busy.acquire(blocking=False):
            raise InferenceError("INFERENCE_BUSY")
        try:
            if not self.ready or not self.process.is_alive():
                raise InferenceError("MODEL_UNAVAILABLE")
            self.connection.send(body)
            if not self.connection.poll(10):
                self.stop_child()
                self.start()
                raise InferenceError("INFERENCE_TIMEOUT")
            reply = self.connection.recv()
            if "error" in reply:
                raise InferenceError(reply["error"], reply.get("details"))
            return reply["result"]
        except (EOFError, BrokenPipeError, OSError):
            self.stop_child()
            self.start()
            raise InferenceError("MODEL_UNAVAILABLE") from None
        finally:
            self.busy.release()

    def close(self):
        self.closed = True
        self.stop_child()


def main():
    if any(key.startswith("SUPABASE_") for key in os.environ):
        raise RuntimeError("Database configuration forbidden in inference")
    simple = os.environ.get("FACE_PIPELINE_MODE") == "SIMPLE_LOCAL"
    manifest = load_manifest(simple=simple)
    if simple:
        from simple_pipeline import validate_simple_request as validate
    else:
        validate = validate_request
    supervisor = Supervisor()
    client_pem = pathlib.Path("/certs/client.pem").read_text()
    client_fingerprint = hashlib.sha256(ssl.PEM_cert_to_DER_cert(client_pem)).hexdigest()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def setup(self):
            super().setup()
            self.connection.settimeout(15)

        def authorized(self):
            fingerprint = hashlib.sha256(self.connection.getpeercert(binary_form=True)).hexdigest()
            return fingerprint == client_fingerprint and not self.headers.get("Origin")

        def respond(self, status, body):
            encoded = json.dumps(body, allow_nan=False, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(encoded)

        def do_GET(self):
            if not self.authorized():
                return self.respond(403, {"error": {"code": "CALLER_FORBIDDEN"}})
            if self.path == "/health":
                return self.respond(200, {"status": "ok"})
            if self.path == "/ready":
                return self.respond(200 if supervisor.ready and supervisor.process.is_alive() else 503,
                                    {"ready": True, "modelVersion": manifest["modelVersion"]} if supervisor.ready and supervisor.process.is_alive()
                                    else {"error": {"code": "MODEL_UNAVAILABLE"}})
            self.respond(404, {"error": {"code": "NOT_FOUND"}})

        def do_POST(self):
            if not self.authorized():
                return self.respond(403, {"error": {"code": "CALLER_FORBIDDEN"}})
            if self.path != ("/v1/simple" if simple else "/v1/enrollment"):
                return self.respond(404, {"error": {"code": "NOT_FOUND"}})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 4194304 or self.headers.get("Transfer-Encoding") or self.headers.get("Content-Encoding"):
                    raise InferenceError("IMAGE_LIMIT")
                if self.headers.get("Content-Type") != "application/json":
                    raise InferenceError("INVALID_IMAGE")
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise InferenceError("INVALID_IMAGE")
                body = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
                validate(body, manifest["modelVersion"])
                self.respond(200, supervisor.run(body))
            except InferenceError as error:
                status = 429 if error.code == "INFERENCE_BUSY" else 503 if error.code in (
                    "MODEL_UNAVAILABLE", "INFERENCE_TIMEOUT") else 422
                self.respond(status, {"error": {"code": error.code,
                                               **({"details": error.details} if error.details is not None else {})}})
            except (ValueError, TypeError, UnicodeError):
                self.respond(400, {"error": {"code": "INVALID_IMAGE"}})
            except (TimeoutError, ConnectionError, OSError):
                self.close_connection = True
            except Exception:
                self.respond(503, {"error": {"code": "MODEL_UNAVAILABLE"}})

    class Server(ThreadingHTTPServer):
        daemon_threads = True
        request_queue_size = 8
        slots = threading.BoundedSemaphore(16)

        def get_request(self):
            connection, address = super().get_request()
            connection.settimeout(3)
            try:
                return context.wrap_socket(connection, server_side=True), address
            except (OSError, ssl.SSLError):
                connection.close()
                raise OSError("TLS_HANDSHAKE_FAILED") from None

        def process_request(self, request, client_address):
            if not self.slots.acquire(blocking=False):
                request.close()
                return
            super().process_request(request, client_address)

        def process_request_thread(self, request, client_address):
            try:
                super().process_request_thread(request, client_address)
            finally:
                self.slots.release()

        def handle_error(self, *_args):
            pass

    server = Server(("0.0.0.0", 9443), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain("/certs/server.pem", "/certs/server.key")
    context.load_verify_locations("/certs/ca.pem")
    context.verify_mode = ssl.CERT_REQUIRED

    def shutdown(*_args):
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    try:
        server.serve_forever(poll_interval=.2)
    finally:
        server.server_close()
        supervisor.close()


if __name__ == "__main__":
    main()
