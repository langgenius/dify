"""Private, persistent TypeScript executor owned by one Celery prefork child.

No HTTP callback to the KnowledgeFS API and no shell execution. Each prefork process handles one
request at a time. Closing its stdin or killing the owner also kills the engine's parser children;
database leases/checkpoints then govern recovery after Celery redelivery.
"""

import json
import os
import selectors
import signal
import subprocess
import threading
import time
from pathlib import Path
from uuid import uuid4

from configs import dify_config

PROTOCOL = "knowledge-fs-celery-v1"
MAX_FRAME_BYTES = 16_384


class KnowledgeFSBackgroundEngineError(RuntimeError):
    """A local engine could not safely complete its delivery."""


def engine_environment(source: dict[str, str]) -> dict[str, str]:
    allowed = {"PATH", "LANG", "LC_ALL", "TMPDIR", "DATABASE_URL", "NODE_ENV"}
    prefixes = (
        "KNOWLEDGE_",
        "UNSTRUCTURED_",
        "RESEARCH_TASK_",
        "DURABLE_DELETION_",
        "POSTGRES_",
        "DIFY_ROOT_",
        "DIFY_MODEL_RUNTIME_",
        "DIFY_DATASOURCE_RUNTIME_",
    )
    inner_api = {
        "DIFY_INNER_API_URL",
        "DIFY_INNER_API_KEY",
        "DIFY_OBJECT_STORAGE_REQUEST_TIMEOUT_MS",
        "DIFY_REMOTE_IMAGE_REQUEST_TIMEOUT_MS",
    }
    result = {
        key: value
        for key, value in source.items()
        if (key in allowed or key in inner_api or key.startswith(prefixes)) and "PRIVATE_KEY" not in key
    }
    result["KNOWLEDGE_BACKGROUND_EXECUTION"] = "celery"
    # Never let an inherited rollout proxy start embedded timers inside the worker.
    result["DIFY_ROOT_KNOWLEDGE_BACKGROUND_EXECUTION_OVERRIDE"] = "celery"
    result["NODE_ENV"] = "production"
    return result


class KnowledgeFSBackgroundEngine:
    def __init__(self) -> None:
        self._process: subprocess.Popen[bytes] | None = None
        self._owner_pid = os.getpid()
        self._lock = threading.Lock()

    def close(self) -> None:
        process, self._process = self._process, None
        if process is None:
            return
        # Never kill a process group inherited across a fork: it belongs to another Celery child.
        if self._owner_pid == os.getpid():
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                # Preserve the task's original exception; SIGKILL has already been requested.
                pass
        for stream in (process.stdin, process.stdout):
            if stream is not None:
                stream.close()

    def _start(self) -> subprocess.Popen[bytes]:
        if self._owner_pid != os.getpid():
            self.close()
            self._owner_pid = os.getpid()
        if self._process is not None and self._process.poll() is None:
            return self._process
        self.close()
        path = Path(dify_config.KNOWLEDGE_FS_BACKGROUND_ENGINE_PATH)
        if not path.is_absolute() or not path.is_file():
            raise KnowledgeFSBackgroundEngineError("KnowledgeFS worker image is missing the local engine bundle")
        self._process = subprocess.Popen(
            ["node", str(path)],
            cwd=str(path.parent),
            env=engine_environment(dict(os.environ)),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=None,
            start_new_session=True,
            bufsize=0,
        )
        return self._process

    def execute(self, operation: str, delivery: dict[str, object] | None = None) -> dict[str, object]:
        # The worker entrypoint enforces prefork. This lock is a defensive assertion against
        # accidentally reusing a single IPC stream from more than one task/thread.
        with self._lock:
            request_id = str(uuid4())
            request: dict[str, object] = {"protocol": PROTOCOL, "id": request_id, "operation": operation}
            if delivery is not None:
                request["delivery"] = delivery
            frame = (json.dumps(request, separators=(",", ":")) + "\n").encode()
            if len(frame) > MAX_FRAME_BYTES:
                raise KnowledgeFSBackgroundEngineError("Background locator is too large")
            try:
                process = self._start()
                assert process.stdin is not None
                assert process.stdout is not None
                remaining = memoryview(frame)
                while remaining:
                    written = process.stdin.write(remaining)
                    if not written:
                        raise KnowledgeFSBackgroundEngineError("Background engine input pipe closed")
                    remaining = remaining[written:]
                process.stdin.flush()
                deadline = time.monotonic() + dify_config.KNOWLEDGE_FS_BACKGROUND_TASK_TIMEOUT_SECONDS
                received = bytearray()
                with selectors.DefaultSelector() as selector:
                    selector.register(process.stdout, selectors.EVENT_READ)
                    while time.monotonic() < deadline:
                        if not selector.select(timeout=min(1.0, max(0.0, deadline - time.monotonic()))):
                            continue
                        chunk = os.read(process.stdout.fileno(), MAX_FRAME_BYTES + 1)
                        if not chunk:
                            raise KnowledgeFSBackgroundEngineError(
                                "Background engine exited before acknowledging its task"
                            )
                        received.extend(chunk)
                        if len(received) > MAX_FRAME_BYTES:
                            raise KnowledgeFSBackgroundEngineError("Background engine response exceeds the IPC limit")
                        if b"\n" not in received:
                            continue
                        reply = json.loads(received)
                        if (
                            not isinstance(reply, dict)
                            or reply.get("protocol") != PROTOCOL
                            or reply.get("id") != request_id
                        ):
                            raise KnowledgeFSBackgroundEngineError("Background engine response identity mismatch")
                        result = reply.get("result")
                        if reply.get("ok") is not True or not isinstance(result, dict):
                            raise KnowledgeFSBackgroundEngineError("Background engine execution failed")
                        if result.get("outcome") not in {"completed", "retry", "failed", "unavailable"}:
                            raise KnowledgeFSBackgroundEngineError("Background engine returned an unknown outcome")
                        if operation == "delivery" and result.get("outcome") == "unavailable":
                            raise KnowledgeFSBackgroundEngineError("Background delivery executor is unavailable")
                        if result.get("outcome") == "retry":
                            retry_at = result.get("runAfter")
                            if type(retry_at) is not int or not 0 <= retry_at <= 2**53 - 1:
                                raise KnowledgeFSBackgroundEngineError(
                                    "Background engine returned an invalid retry time"
                                )
                        return result
                raise KnowledgeFSBackgroundEngineError("Background engine execution exceeded its deadline")
            except BaseException:
                # Includes Celery SoftTimeLimitExceeded: do not leave an unacknowledged child running.
                self.close()
                raise


background_engine = KnowledgeFSBackgroundEngine()
