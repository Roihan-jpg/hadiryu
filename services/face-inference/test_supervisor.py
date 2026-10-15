import time
import unittest
from unittest.mock import patch, Mock
from types import SimpleNamespace
from policy import InferenceError
from server import Supervisor


def controlled_worker(connection):
    """Declared process-lifecycle test double; not a biometric model."""
    connection.send({"ready": True, "coldStartMs": 0})
    while True:
        request = connection.recv()
        if request.get("hang"):
            time.sleep(60)
        if request.get("reject"):
            connection.send({"error": "PAD_FAILED", "details": {"stages": request["reject"]}})
            continue
        connection.send({"result": {"ok": True}})


class SupervisorTests(unittest.TestCase):
    def test_startup_timeout_restarts_with_bounded_attempts_instead_of_remaining_stuck(self):
        for finishes in (True, False):
            supervisor = Supervisor.__new__(Supervisor)
            supervisor.ready, supervisor.closed = False, False
            supervisor.startup_failures = 0
            supervisor.process, supervisor.connection = None, None
            processes = [Mock() for _ in range(3)]
            connections = [Mock() for _ in range(3)]
            for connection in connections:
                connection.poll.return_value = False
            if finishes:
                connections[1].poll.return_value = True
                connections[1].recv.return_value = {"ready": True, "coldStartMs": 1}
            context = Mock()
            context.Pipe.side_effect = [(connection, Mock()) for connection in connections]
            context.Process.side_effect = processes
            with patch("server.multiprocessing.get_context", return_value=context), \
                    patch("server.threading.Thread", side_effect=lambda target, **_: SimpleNamespace(start=target)):
                supervisor.start()
            self.assertEqual(context.Process.call_count, 2 if finishes else 3)
            self.assertEqual(supervisor.ready, finishes)
            processes[0].terminate.assert_called_once()
            if finishes:
                processes[1].terminate.assert_not_called()
            else:
                for process in processes:
                    process.terminate.assert_called_once()

    def test_bounded_rejection_metadata_survives_process_boundary_without_a_success_result(self):
        stages = [{"stage": "BLINK", "evaluated": 8, "rejected": 1}]
        with patch("server.worker", controlled_worker):
            supervisor = Supervisor()
            try:
                self.wait_ready(supervisor)
                with self.assertRaises(InferenceError) as raised:
                    supervisor.run({"reject": stages})
                self.assertEqual(raised.exception.code, "PAD_FAILED")
                self.assertEqual(raised.exception.details, {"stages": stages})
            finally:
                supervisor.close()

    def wait_ready(self, supervisor):
        expiry = time.monotonic() + 15
        while not supervisor.ready and time.monotonic() < expiry:
            time.sleep(.05)
        self.assertTrue(supervisor.ready)

    def test_load_once_busy_and_hard_timeout_restart(self):
        with patch("server.worker", controlled_worker):
            supervisor = Supervisor()
            try:
                self.wait_ready(supervisor)
                first = supervisor.process
                self.assertEqual(supervisor.run({}), {"ok": True})
                self.assertEqual(supervisor.run({}), {"ok": True})
                self.assertEqual(supervisor.process.pid, first.pid)
                supervisor.busy.acquire()
                try:
                    with self.assertRaises(InferenceError) as busy:
                        supervisor.run({})
                    self.assertEqual(busy.exception.code, "INFERENCE_BUSY")
                finally:
                    supervisor.busy.release()
                with self.assertRaises(InferenceError) as timeout:
                    supervisor.run({"hang": True})
                self.assertEqual(timeout.exception.code, "INFERENCE_TIMEOUT")
                self.assertFalse(first.is_alive())
                self.wait_ready(supervisor)
                self.assertNotEqual(supervisor.process.pid, first.pid)
                self.assertEqual(supervisor.run({}), {"ok": True})
            finally:
                supervisor.close()
            self.assertFalse(supervisor.process.is_alive())


if __name__ == "__main__":
    unittest.main()
