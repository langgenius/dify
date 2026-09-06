"""Single-process, bounded ASGI supervisor for disposable parser process groups.

This controls resource exhaustion, not hostile native-code execution. Container hard
limits remain mandatory; aggregate RSS/CPU/temp/PID checks are sampled, not cgroups.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import shutil
import signal
import sys
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import psutil

from . import REVISION


@dataclass(frozen=True)
class Settings:
    active_limit: int = 1
    queue_limit: int = 8
    queue_seconds: float = 30
    wall_seconds: float = 2400
    input_bytes: int = 51 * 1024 * 1024
    response_bytes: int = 32 * 1024 * 1024
    memory_bytes: int = 4 * 1024**3
    address_space_bytes: int = 32 * 1024**3
    temp_bytes: int = 512 * 1024 * 1024
    file_bytes: int = 256 * 1024 * 1024
    process_limit: int = 64
    cpu_seconds: int = 2400
    temp_root: str = "/tmp"
    sample_seconds: float = 0.05

    def __post_init__(self):
        for key, value in asdict(self).items():
            if key != "temp_root" and (
                not isinstance(value, (int, float))
                or not math.isfinite(value)
                or value <= 0
            ):
                if not (key == "queue_limit" and value == 0):
                    raise ValueError(f"Invalid sandbox setting: {key}")
        if self.active_limit > 8 or self.queue_limit > 64:
            raise ValueError("Sandbox admission must remain bounded")


class ResourceLimit(Exception):
    def __init__(self, reason: str, status: int = 413):
        self.reason = reason
        self.status = status


class Disconnected(Exception):
    pass


async def respond(send, status: int, reason: str) -> None:
    payload = json.dumps(
        {
            "detail": {
                "code": "PARSER_RESOURCE_REJECTED",
                "reason": reason,
                "revision": REVISION,
            }
        }
    ).encode()
    headers = [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(payload)).encode()),
    ]
    if status == 429:
        headers.append((b"retry-after", b"1"))
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": payload})


class Gateway:
    def __init__(
        self, settings: Settings, *, app_target: str = "prepline_general.api.app:app"
    ):
        self.settings = settings
        self.app_target = app_target
        self.active = 0
        self.queued = 0
        self.slots = asyncio.Semaphore(settings.active_limit)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "lifespan":
            while True:
                event = await receive()
                if event["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                elif event["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"})
                    return
        if scope["type"] != "http":
            return
        if scope["path"] == "/healthcheck" and scope["method"] == "GET":
            body = json.dumps(
                {
                    "status": "healthy",
                    "revision": REVISION,
                    "active": self.active,
                    "queued": self.queued,
                }
            ).encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [(b"content-type", b"application/json")],
                }
            )
            await send({"type": "http.response.body", "body": body})
            return
        if scope["path"] != "/general/v0/general" or scope["method"] != "POST":
            await respond(send, 404, "not_found")
            return
        # Reserve capacity before the first await, independent of semaphore scheduling.
        if (
            self.active + self.queued
            >= self.settings.active_limit + self.settings.queue_limit
        ):
            await respond(send, 429, "admission_full")
            return
        self.queued += 1
        try:
            await asyncio.wait_for(self.slots.acquire(), self.settings.queue_seconds)
        except TimeoutError:
            await respond(send, 429, "admission_timeout")
            return
        finally:
            self.queued -= 1
        self.active += 1
        directory = None
        try:
            directory = Path(
                tempfile.mkdtemp(prefix="kfs-parse-", dir=self.settings.temp_root)
            )
            deadline = time.monotonic() + self.settings.wall_seconds
            await self._read_request(receive, directory, deadline)
            await self._execute(scope, receive, send, directory, deadline)
        except Disconnected:
            pass
        except ResourceLimit as error:
            await respond(send, error.status, error.reason)
        except OSError:
            await respond(send, 503, "supervisor_resource_limit")
        finally:
            try:
                if directory is not None:
                    # Exact mkdtemp-owned directory; never a caller-controlled path.
                    shutil.rmtree(directory)
            finally:
                self.active -= 1
                self.slots.release()

    async def _read_request(self, receive, directory: Path, deadline: float) -> None:
        size = 0
        with (directory / "request.body").open("wb") as output:
            while True:
                try:
                    event = await asyncio.wait_for(
                        receive(), max(0, deadline - time.monotonic())
                    )
                except TimeoutError as error:
                    raise ResourceLimit("wall_seconds", 504) from error
                if event["type"] == "http.disconnect":
                    raise Disconnected()
                data = event.get("body", b"")
                size += len(data)
                if size > self.settings.input_bytes:
                    raise ResourceLimit("input_bytes")
                output.write(data)
                if not event.get("more_body"):
                    break

    async def _execute(
        self, scope, receive, send, directory: Path, deadline: float
    ) -> None:
        serialized_scope = {
            key: scope[key]
            for key in (
                "type",
                "method",
                "path",
                "http_version",
                "scheme",
                "server",
                "client",
            )
            if key in scope
        }
        serialized_scope["headers"] = [
            (key.decode("latin-1"), value.decode("latin-1"))
            for key, value in scope["headers"]
        ]
        serialized_scope["query_string"] = scope.get("query_string", b"").decode(
            "latin-1"
        )
        envelope = {
            "scope": serialized_scope,
            "settings": asdict(self.settings),
            "app_target": self.app_target,
        }
        metadata = json.dumps(envelope)
        if len(metadata.encode()) > 64 * 1024:
            raise ResourceLimit("request_metadata_bytes")
        (directory / "request.json").write_text(metadata)
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            "kfs_sandbox.worker",
            str(directory),
            start_new_session=True,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        descendants: dict[tuple[int, float], psutil.Process] = {}
        disconnected = asyncio.create_task(self._wait_disconnect(receive))
        completed = asyncio.create_task(process.wait())
        try:
            while not completed.done():
                if disconnected.done():
                    raise Disconnected()
                if time.monotonic() >= deadline:
                    raise ResourceLimit("wall_seconds", 504)
                self._inspect_tree(process.pid, directory, descendants)
                await asyncio.wait(
                    {completed, disconnected},
                    timeout=self.settings.sample_seconds,
                    return_when=asyncio.FIRST_COMPLETED,
                )
            if disconnected.done():
                raise Disconnected()
            self._inspect_tree(process.pid, directory, descendants)
            if failure := self._read_failure(directory):
                raise ResourceLimit(failure["reason"], failure["status"])
            if process.returncode != 0 or not (directory / "response.json").exists():
                raise ResourceLimit("worker_terminated", 413)
            metadata_path = directory / "response.json"
            if metadata_path.stat().st_size > 64 * 1024:
                raise ResourceLimit("response_metadata_bytes")
            result = json.loads(metadata_path.read_text())
            headers = [
                (key.encode("latin-1"), value.encode("latin-1"))
                for key, value in result["headers"]
                if key.lower() not in {"transfer-encoding", "connection"}
            ]
            headers.append((b"x-knowledgefs-parser-revision", REVISION.encode()))

            async def send_bounded(message):
                delivery = asyncio.create_task(send(message))
                try:
                    ready, _ = await asyncio.wait(
                        {delivery, disconnected},
                        timeout=max(0, deadline - time.monotonic()),
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    if delivery not in ready or disconnected in ready:
                        # Headers may already have been sent; never emit a second error response.
                        raise Disconnected()
                    await delivery
                finally:
                    delivery.cancel()
                    await asyncio.gather(delivery, return_exceptions=True)

            await send_bounded(
                {
                    "type": "http.response.start",
                    "status": result["status"],
                    "headers": headers,
                }
            )
            with (directory / "response.body").open("rb") as response:
                while chunk := response.read(64 * 1024):
                    await send_bounded(
                        {"type": "http.response.body", "body": chunk, "more_body": True}
                    )
            await send_bounded(
                {"type": "http.response.body", "body": b"", "more_body": False}
            )
        finally:
            # Kill the entire session group, including converters left behind after a
            # successful response; also kill observed descendants that changed sessions.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            for child in descendants.values():
                try:
                    child.kill()
                except psutil.NoSuchProcess:
                    pass
            await process.wait()
            disconnected.cancel()
            await asyncio.gather(disconnected, completed, return_exceptions=True)

    @staticmethod
    async def _wait_disconnect(receive):
        while True:
            event = await receive()
            if event["type"] == "http.disconnect":
                return

    @staticmethod
    def _read_failure(directory: Path):
        path = directory / "failure.json"
        return json.loads(path.read_text()) if path.exists() else None

    def _inspect_tree(self, pid: int, directory: Path, descendants: dict) -> None:
        try:
            parent = psutil.Process(pid)
            processes = [parent, *parent.children(recursive=True)]
        except psutil.NoSuchProcess:
            return
        memory = 0
        cpu = 0.0
        for process in processes:
            try:
                descendants[(process.pid, process.create_time())] = process
                memory += process.memory_info().rss
                times = process.cpu_times()
                cpu += times.user + times.system
            except psutil.NoSuchProcess:
                continue
        # Bound retained process identities across repeated short-lived conversions.
        for identity, process in list(descendants.items()):
            if not process.is_running():
                del descendants[identity]
        if len(descendants) > self.settings.process_limit:
            raise ResourceLimit("process_limit")
        if len(processes) > self.settings.process_limit:
            raise ResourceLimit("process_limit")
        if memory > self.settings.memory_bytes:
            raise ResourceLimit("memory_bytes")
        if cpu > self.settings.cpu_seconds:
            raise ResourceLimit("cpu_seconds")
        size = 0
        entries = 0
        for root, directories, files in os.walk(directory, followlinks=False):
            entries += len(directories) + len(files)
            if entries > 8192:
                raise ResourceLimit("temp_entries")
            for name in files:
                try:
                    size += os.lstat(os.path.join(root, name)).st_size
                except FileNotFoundError:
                    continue
                if size > self.settings.temp_bytes:
                    raise ResourceLimit("temp_bytes")


app = Gateway(Settings())
