"""Isolated HTTPS A2A 1.0 fixture; never deploy on a shared/public service.

Run with BYOA_FIXTURE_CERT, BYOA_FIXTURE_KEY and BYOA_FIXTURE_PUBLIC_URL.
Only stdlib is required. Admin controls are deliberately unauthenticated inside
the dedicated acceptance network. No request bodies, headers or URLs are logged.
Every POST counts, including duplicate message IDs and deliberately lost replies.
"""

from __future__ import annotations

import base64
import copy
import hashlib
import hmac
import json
import os
import re
import socket
import ssl
import threading
import time
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, override
from urllib.parse import unquote, urlsplit
from uuid import uuid4

TRACE_URI = "https://github.com/a2aproject/a2a-samples/extensions/traceability/v1"
FILE_BYTES = b"%PDF-1.4\nBYOA acceptance fixture\n%%EOF\n"
MODES = ["text/plain", "application/pdf", "text/markdown", "image/png", "image/jpeg"]
SCENARIO = re.compile(r"^\[byoa:([a-z-]+)(?::([A-Za-z0-9_-]+))?\]")
CAPACITY_PREFIXES = frozenset(f"/capacity-{index}" for index in range(1, 6))
CARD_VARIANTS = frozenset(
    {
        "missing-required",
        "optional-omitted",
        "invalid-null",
        "unsupported-required-extension",
        "text-only",
        "changed-skills",
        "changed-info",
        "auth-changed",
        "without-trace",
        "streamless",
        "combined",
    }
)
MATRIX_MAX_FILE_BYTES = 15 * 1024 * 1024 + 1
_MATRIX_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII="
)


def matrix_file_bytes(descriptor: dict) -> bytes:
    """Generate deterministic bounded bytes without caching large fixture bodies.

    File descriptors are registered only on the private acceptance network.
    Trailing padding preserves a valid tiny PNG while exercising exact byte caps.
    """
    size = descriptor["bytes"]
    prefix = _MATRIX_PNG if descriptor["media_type"] == "image/png" else FILE_BYTES
    prefix += descriptor["seed"].encode("ascii")
    if size < len(prefix):
        prefix = prefix[:size]
    return prefix + b"f" * (size - len(prefix))


class FixtureState:
    def __init__(
        self, *, public_url: str, bearer: str = "", slow_seconds: float = 35, barrier_seconds: float = 60
    ) -> None:
        if not 0 < barrier_seconds <= 60:
            raise ValueError("Receipt barrier must be greater than zero and at most 60 seconds.")
        self.public_url = public_url.rstrip("/")
        self.bearer = bearer
        self.slow_seconds = slow_seconds
        self.barrier_seconds = barrier_seconds
        self.lock = threading.RLock()
        self.tasks: dict[str, dict[str, Any]] = {}
        self.messages: dict[str, dict[str, Any]] = {}
        self.exports: list[dict[str, Any]] = []
        self.export_failures: dict[str, int] = {}
        self.receipt_barriers: dict[str, threading.Event] = {}
        self.scenario_attempts: dict[tuple[str, str], int] = {}
        self.previous_tasks: dict[tuple[str, str], str] = {}
        self.matrix_cases: dict[tuple[str, str], dict] = {}
        self.query_io: dict[str, dict[str, Any]] = {}
        self.counts = dict.fromkeys(
            (
                "send",
                "get",
                "cancel",
                "verify",
                "file_get",
                "file_head",
                "file_authorization",
                "input_url",
                "subscribe",
            ),
            0,
        )

    def card(self, *, protected: bool = False, capacity_prefix: str | None = None) -> dict:
        if capacity_prefix is not None and capacity_prefix not in CAPACITY_PREFIXES:
            raise ValueError("Unsupported capacity fixture prefix.")
        interface = self.public_url + (
            capacity_prefix + "/a2a/v1" if capacity_prefix is not None else "/bearer/a2a" if protected else "/a2a"
        )
        value: dict[str, Any] = {
            "name": "BYOA HTTPS acceptance fixture",
            "description": "Dedicated test service",
            "version": "fixture-v1",
            "supportedInterfaces": [{"url": interface, "protocolBinding": "HTTP+JSON", "protocolVersion": "1.0"}],
            "capabilities": {
                "streaming": True,
                "extendedAgentCard": protected,
                "extensions": [{"uri": TRACE_URI, "required": False}],
            },
            "defaultInputModes": MODES,
            "defaultOutputModes": [*MODES, "application/json"],
            "skills": [
                {
                    "id": "acceptance",
                    "name": "Acceptance",
                    "description": "Controlled contract scenarios",
                    "tags": ["acceptance"],
                }
            ],
        }
        if protected:
            value["securitySchemes"] = {"fixture": {"httpAuthSecurityScheme": {"scheme": "bearer"}}}
            value["securityRequirements"] = [{"schemes": {"fixture": {"list": []}}}]
        return value

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "counts": dict(self.counts),
                "messages": copy.deepcopy(self.messages),
                "exports": copy.deepcopy(self.exports),
                "query_io": copy.deepcopy(self.query_io),
                "tasks": {
                    identifier: {
                        "scenario": task["scenario"],
                        "context_id": task["value"]["contextId"],
                        "state": task["value"]["status"]["state"],
                        "gets": task["gets"],
                        "message_id": task.get("message_id"),
                        "attempt": task.get("attempt"),
                        "cancel_count": task.get("cancel_count", 0),
                        "first_cancel_at": task.get("first_cancel_at"),
                        "receipt_barrier": task.get("receipt_barrier"),
                        "receipt_started": task.get("receipt_started"),
                    }
                    for identifier, task in self.tasks.items()
                },
            }

    def card_variant(self, case: str) -> dict[str, Any]:
        """Return a fixed read-only Card case, never an arbitrary admin rewrite."""
        if case not in CARD_VARIANTS:
            raise ValueError("Unknown fixed Agent Card case.")
        card = self.card()
        if case == "missing-required":
            card.pop("name")
        elif case == "optional-omitted":
            card["capabilities"] = {}
            card["skills"] = [
                {
                    "id": "acceptance",
                    "name": "Acceptance",
                    "description": "Controlled contract scenarios",
                    "tags": ["acceptance"],
                }
            ]
        elif case == "invalid-null":
            card["defaultInputModes"] = None
        elif case == "unsupported-required-extension":
            card["capabilities"]["extensions"].append({"uri": "https://unsupported.example/required", "required": True})
        if case in {"text-only", "combined"}:
            card["defaultInputModes"] = ["text/plain"]
            card["defaultOutputModes"] = ["text/plain"]
        if case in {"streamless", "combined"}:
            card["capabilities"]["streaming"] = False
        if case in {"changed-skills", "combined"}:
            card["skills"] = [
                {
                    "id": "changed",
                    "name": "Changed skill",
                    "description": "Changed service declaration",
                    "tags": ["changed"],
                    "inputModes": ["application/pdf"],
                }
            ]
        if case in {"changed-info", "combined"}:
            card["name"] = "Changed remote service name"
            card["description"] = "Changed remote service description"
        if case in {"without-trace", "combined"}:
            card["capabilities"]["extensions"] = []
        if case in {"auth-changed", "combined"}:
            card["securitySchemes"] = {"fixture": {"httpAuthSecurityScheme": {"scheme": "bearer"}}}
            # The empty alternative remains satisfiable by None auth. The
            # change is a warning, not a fabricated failed credential probe.
            card["securityRequirements"] = [{"schemes": {}}, {"schemes": {"fixture": {"list": []}}}]
        return card

    def send(self, payload: dict) -> tuple[str, dict]:
        message = payload["message"]
        message_id = message["messageId"]
        parts = message["parts"]
        text = "".join(part.get("text", "") for part in parts if isinstance(part.get("text", ""), str))
        match = SCENARIO.match(text)
        scenario, run = (match.group(1), match.group(2) or "") if match else ("completed", "")
        context = message.get("contextId") or f"fixture-context-{uuid4()}"
        inputs = []
        for part in parts:
            if "raw" in part:
                data = base64.b64decode(part["raw"], validate=True)
                inputs.append(
                    {
                        "media_type": part.get("mediaType"),
                        "size": len(data),
                        "sha256": hashlib.sha256(data).hexdigest(),
                        "has_filename": bool(part.get("filename")),
                    }
                )
        with self.lock:
            self.counts["send"] += 1
            self.counts["input_url"] += sum("url" in part for part in parts)
            old = self.messages.get(message_id)
            attempt_key = (scenario, run)
            attempt = self.scenario_attempts.get(attempt_key, 0) + 1
            self.scenario_attempts[attempt_key] = attempt
            previous = self.tasks.get(self.previous_tasks.get(attempt_key, ""))
            self.messages[message_id] = {
                "sends": old["sends"] + 1 if old else 1,
                "scenario": scenario,
                "run": run,
                "provided_context": message.get("contextId"),
                "provided_task_id": message.get("taskId"),
                "returned_context": context,
                "input_files": inputs,
                "attempt": attempt,
                "accepted_at": datetime.now(UTC).isoformat(),
                "task_text_sha256": hashlib.sha256(text.encode()).hexdigest(),
                "previous_task_state_at_send": previous["value"]["status"]["state"] if previous else None,
            }
            if scenario == "matrix-output":
                key = text[match.end() :].strip() if match is not None else ""
                descriptor = self.matrix_cases.get((run, key))
                if descriptor is None:
                    raise ValueError("matrix_case_not_registered")
                task = {
                    "id": str(uuid4()),
                    "contextId": context,
                    "status": {"state": "TASK_STATE_COMPLETED"},
                    "artifacts": self.matrix_artifacts(run, key, descriptor),
                }
                return scenario, {"task": task}
            if scenario == "direct":
                return scenario, {
                    "message": {
                        "messageId": str(uuid4()),
                        "role": "ROLE_AGENT",
                        "contextId": context,
                        "parts": [{"text": "direct ok"}],
                    }
                }
            task_id = str(uuid4())
            working = (scenario == "timeout-retry" and attempt == 1) or scenario in {
                "working",
                "load-hold",
                "working-echo",
                "hold",
                "cancel-rejected",
                "cancel-unsupported",
                "cancel-unconfirmed",
                "unknown",
                "slow-first",
                "crash-before-receipt",
            }
            task = {
                "id": task_id,
                "contextId": context,
                "status": {"state": "TASK_STATE_WORKING" if working else "TASK_STATE_COMPLETED"},
            }
            if not working:
                task["artifacts"] = self.artifacts(scenario, inputs)
            self.tasks[task_id] = {
                "value": task,
                "scenario": scenario,
                "gets": 0,
                "message_id": message_id,
                "attempt": attempt,
                "cancel_count": 0,
                "echo": text[match.end() :].strip() if match and scenario == "working-echo" else None,
            }
            self.previous_tasks[attempt_key] = task_id
            self.messages[message_id]["created_task_id"] = task_id
            if scenario == "crash-before-receipt":
                self.receipt_barriers[task_id] = threading.Event()
                self.tasks[task_id].update(receipt_barrier="waiting", receipt_started=False)
            return scenario, {"task": copy.deepcopy(task)}

    def wait_before_receipt(self, task_id: str) -> dict:
        """Wait without holding the state lock or writing any HTTP response bytes."""
        released = self.receipt_barriers[task_id].wait(timeout=self.barrier_seconds)
        with self.lock:
            task = self.tasks[task_id]
            task["receipt_barrier"] = "released" if released else "timed_out"
            task["receipt_started"] = True
            return {"task": copy.deepcopy(task["value"])}

    def artifacts(self, scenario: str, inputs: list[dict]) -> list[dict]:
        if scenario in {"file-output", "file-url"}:
            content = (
                {"url": self.public_url + "/files/report.pdf?signature=fixture"}
                if scenario == "file-url"
                else {"raw": base64.b64encode(FILE_BYTES).decode()}
            )
            return [
                {
                    "artifactId": "report",
                    "name": "report",
                    "parts": [{**content, "filename": "report.pdf", "mediaType": "application/pdf"}],
                }
            ]
        if scenario == "ambiguous":
            return [{"artifactId": "ambiguous", "parts": [{"data": {"text": "one"}}, {"data": {"text": "two"}}]}]
        data: dict[str, Any] = {"text": "file input ok" if scenario == "file-input" else "task ok"}
        if scenario == "file-input":
            data.update(file_count=len(inputs), total_bytes=sum(item["size"] for item in inputs))
        result: list[dict[str, Any]] = [{"artifactId": "business", "parts": [{"data": data}]}]
        if scenario == "trace":
            timestamp = datetime.now(UTC).isoformat()
            trace = {
                "trace_id": "fixture-trace",
                "steps": [
                    {
                        "step_id": "fixture-step",
                        "call_type": "TOOL",
                        "start_time": timestamp,
                        "end_time": timestamp,
                        "status": "completed",
                        "total_tokens": "0",
                        "step_action": {"tool_invocation": {"tool_name": "fixture-tool"}},
                    }
                ],
            }
            result.append({"artifactId": "trace", "extensions": [TRACE_URI], "parts": [{"data": trace}]})
        return result

    def register_matrix(self, payload: dict) -> None:
        """Admit small, bounded response descriptors; never cache file byte arrays."""
        run, key = payload.get("run"), payload.get("case")
        if (
            not isinstance(run, str)
            or not isinstance(key, str)
            or not all(re.fullmatch(r"[A-Za-z0-9_-]{1,80}", value) for value in (run, key))
        ):
            raise ValueError("invalid_matrix_identity")
        artifacts = payload.get("artifacts", [])
        files = payload.get("files", [])
        if not isinstance(artifacts, list) or len(artifacts) > 8 or len(json.dumps(artifacts)) > 64 * 1024:
            raise ValueError("invalid_matrix_artifacts")
        if not isinstance(files, list) or len(files) > 6:
            raise ValueError("invalid_matrix_files")
        for item in files:
            if (
                not isinstance(item, dict)
                or type(item.get("bytes")) is not int
                or not 0 <= item["bytes"] <= MATRIX_MAX_FILE_BYTES
                or item.get("media_type") not in MODES
                or not isinstance(item.get("filename"), str)
                or not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", item["filename"])
                or not isinstance(item.get("seed"), str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", item["seed"])
                or item.get("transfer") not in {"raw", "url"}
                or ("name" in item and (not isinstance(item["name"], str) or len(item["name"]) > 100))
            ):
                raise ValueError("invalid_matrix_file_descriptor")
        if sum(item["bytes"] for item in files) > 31 * 1024 * 1024 + 6:
            raise ValueError("matrix_total_limit")
        with self.lock:
            if len(self.matrix_cases) >= 1024 and (run, key) not in self.matrix_cases:
                raise ValueError("matrix_case_limit")
            self.matrix_cases[run, key] = {"artifacts": copy.deepcopy(artifacts), "files": copy.deepcopy(files)}

    def matrix_artifacts(self, run: str, key: str, descriptor: dict) -> list[dict]:
        """Build final Artifact wire values from the registered small descriptor."""
        result = copy.deepcopy(descriptor["artifacts"])
        for index, item in enumerate(descriptor["files"]):
            content = (
                {"raw": base64.b64encode(matrix_file_bytes(item)).decode("ascii")}
                if item["transfer"] == "raw"
                else {"url": f"{self.public_url}/matrix-files/{run}/{key}/{index}"}
            )
            artifact = {
                "artifactId": f"matrix-file-{index}",
                "parts": [{**content, "filename": item["filename"], "mediaType": item["media_type"]}],
            }
            if "name" in item:
                artifact["name"] = item["name"]
            result.append(artifact)
        return result

    def get(self, identifier: str, *, endpoint: str = "") -> dict | None:
        """Read a Task; load-hold observes bounded real I/O outside the state lock."""
        with self.lock:
            value = self.tasks.get(identifier)
            delayed = value is not None and value["scenario"] == "load-hold"
            message = self.messages.get(value.get("message_id", ""), {}) if value is not None else {}
            scopes = ("all", "run:" + message.get("run", ""), "endpoint:" + endpoint)
            if delayed:
                for scope in scopes:
                    metrics = self.query_io.setdefault(scope, {"active": 0, "peak": 0, "started": 0, "finished": 0})
                    metrics["active"] += 1
                    metrics["peak"] = max(metrics["peak"], metrics["active"])
                    metrics["started"] += 1
                    metrics["last_get_started"] = datetime.now(UTC).isoformat()
        if delayed:
            try:
                time.sleep(2)
            finally:
                with self.lock:
                    for scope in scopes:
                        self.query_io[scope]["active"] -= 1
                        self.query_io[scope]["finished"] += 1
                        self.query_io[scope]["last_get_finished"] = datetime.now(UTC).isoformat()
        with self.lock:
            self.counts["get"] += 1
            task = self.tasks.get(identifier)
            if task is not None:
                task["gets"] += 1
                if task["scenario"] == "working":
                    task["value"]["status"] = {"state": "TASK_STATE_COMPLETED"}
                    task["value"]["artifacts"] = self.artifacts("completed", [])
                if task["scenario"] == "working-echo" and task["gets"] >= 2:
                    task["value"]["status"] = {"state": "TASK_STATE_COMPLETED"}
                    task["value"]["artifacts"] = [
                        {"artifactId": "business", "parts": [{"data": {"text": task["echo"]}}]}
                    ]
                return copy.deepcopy(task["value"])
            return None

    def cancel(self, identifier: str) -> tuple[int, dict]:
        with self.lock:
            self.counts["cancel"] += 1
            task = self.tasks.get(identifier)
            if task is None:
                return 404, {"code": "task_not_found"}
            task["cancel_count"] += 1
            task.setdefault("first_cancel_at", datetime.now(UTC).isoformat())
            if task["scenario"] == "cancel-rejected":
                return 409, {"code": "cancellation_rejected"}
            if task["scenario"] == "cancel-unsupported":
                return 501, {"code": "cancellation_unsupported"}
            if task["scenario"] != "cancel-unconfirmed":
                task["value"]["status"] = {"state": "TASK_STATE_CANCELED"}
            return 200, copy.deepcopy(task["value"])


class FixtureServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], state: FixtureState) -> None:
        self.state = state
        super().__init__(address, FixtureHandler)

    @override
    def handle_error(self, request, client_address) -> None:
        # Standard handler tracebacks may include request/peer data.
        return


class FixtureHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    @property
    def state(self) -> FixtureState:
        server = self.server
        if not isinstance(server, FixtureServer):
            raise TypeError("Fixture handler requires its dedicated fixture server.")
        return server.state

    @override
    def log_message(self, format, *args) -> None:
        return

    def reply(self, value: dict, *, status: int = 200, sse: bool = False) -> None:
        encoded = json.dumps(value, separators=(",", ":")).encode()
        body = b"data: " + encoded + b"\n\n" if sse else encoded
        self.send_response(status)
        self.send_header("Content-Type", "text/event-stream" if sse else "application/a2a+json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("A2A-Version", "1.0")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)
            self.wfile.flush()

    def body(self) -> dict:
        size = int(self.headers.get("Content-Length", "0"))
        if not 0 <= size <= 48 * 1024 * 1024:
            raise ValueError("body_limit")
        value = json.loads(self.rfile.read(size) or b"{}")
        if not isinstance(value, dict):
            raise ValueError("body_object_required")
        return value

    def authorized(self) -> bool:
        if self.path.startswith("/bearer/a2a"):
            expected = "Bearer " + self.state.bearer
            if not self.state.bearer or not hmac.compare_digest(self.headers.get("Authorization", ""), expected):
                self.reply({"code": "authentication_required"}, status=401)
                return False
        return True

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        path = unquote(urlsplit(self.path).path)
        if path == "/admin/stats":
            self.reply(self.state.snapshot())
        elif path.startswith("/matrix-files/"):
            parts = path.strip("/").split("/")
            descriptor = None
            if len(parts) == 4 and parts[3].isdigit():
                with self.state.lock:
                    case = self.state.matrix_cases.get((parts[1], parts[2]))
                    index = int(parts[3])
                    if case is not None and 0 <= index < len(case["files"]):
                        descriptor = case["files"][index]
                    self.state.counts["file_head" if self.command == "HEAD" else "file_get"] += 1
                    self.state.counts["file_authorization"] += bool(self.headers.get("Authorization"))
            if descriptor is None:
                self.reply({"code": "matrix_file_not_found"}, status=404)
            else:
                self.send_response(200)
                self.send_header("Content-Type", descriptor["media_type"])
                self.send_header("Content-Length", str(descriptor["bytes"]))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(matrix_file_bytes(descriptor))
        elif path in {"/v1/projects", "/asset/v1/projects", "/app/v1/projects"}:
            # PhoenixProvider.verify requires a real project-page JSON shape.
            self.reply({"data": [], "next_cursor": None})
        elif path.endswith("/.well-known/agent-card.json"):
            prefix = path.removesuffix("/.well-known/agent-card.json")
            if prefix.startswith("/cards/"):
                case = prefix.removeprefix("/cards/")
                if case not in CARD_VARIANTS:
                    self.reply({"code": "not_found"}, status=404)
                else:
                    with self.state.lock:
                        self.state.counts["verify"] += 1
                    self.reply(self.state.card_variant(case))
            elif prefix.startswith("/capacity-") and prefix not in CAPACITY_PREFIXES:
                self.reply({"code": "not_found"}, status=404)
            else:
                with self.state.lock:
                    self.state.counts["verify"] += 1
                self.reply(
                    self.state.card(
                        protected=path.startswith("/bearer/"),
                        capacity_prefix=prefix if prefix in CAPACITY_PREFIXES else None,
                    )
                )
        elif path.startswith("/files/"):
            with self.state.lock:
                self.state.counts["file_head" if self.command == "HEAD" else "file_get"] += 1
                self.state.counts["file_authorization"] += bool(self.headers.get("Authorization"))
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Length", str(len(FILE_BYTES)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(FILE_BYTES)
        elif self.authorized():
            if path.endswith("/extendedAgentCard"):
                self.reply(self.state.card(protected=True))
            elif "/tasks/" in path and not path.endswith(":subscribe"):
                task = self.state.get(path.rsplit("/", 1)[1], endpoint=path.rsplit("/tasks/", 1)[0])
                self.reply(task or {"code": "task_not_found"}, status=200 if task else 404)
            else:
                if path.endswith(":subscribe"):
                    with self.state.lock:
                        self.state.counts["subscribe"] += 1
                self.reply({"code": "not_found"}, status=404)

    def do_POST(self) -> None:
        path = unquote(urlsplit(self.path).path)
        try:
            if path in {"/v1/traces", "/asset/v1/traces", "/app/v1/traces"}:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 <= size <= 16 * 1024 * 1024:
                    raise ValueError("export_body_limit")
                body = self.rfile.read(size)
                with self.state.lock:
                    self.state.exports.append({"path": path, "bytes": size, "sha256": hashlib.sha256(body).hexdigest()})
                    status = self.state.export_failures.get(path, 200)
                # An empty protobuf ExportTraceServiceResponse is a valid ACK.
                self.send_response(status)
                self.send_header("Content-Type", "application/x-protobuf")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            payload = self.body()
            if path == "/admin/matrix-case":
                self.state.register_matrix(payload)
                self.reply({"registered": True})
            elif path == "/admin/export-control":
                failures = payload.get("failures", {})
                if not isinstance(failures, dict) or any(
                    key not in {"/v1/traces", "/asset/v1/traces", "/app/v1/traces"} or value not in {429, 500, 503}
                    for key, value in failures.items()
                ):
                    raise ValueError("invalid_export_control")
                with self.state.lock:
                    self.state.export_failures = dict(failures)
                self.reply({"configured": True})
            elif path == "/admin/release":
                output_scenario = payload.get("output_scenario", "completed")
                if output_scenario not in {"completed", "file-output", "file-url", "trace"}:
                    raise ValueError("invalid_release_output")
                output_text = payload.get("output_text")
                if "output_text" in payload and (
                    not isinstance(output_text, str)
                    or len(output_text) > 256
                    or any(ord(char) < 32 or 127 <= ord(char) < 160 for char in output_text)
                ):
                    raise ValueError("invalid_release_text")
                with self.state.lock:
                    for identifier, task in self.state.tasks.items():
                        if (
                            payload.get("all")
                            or identifier == payload.get("task_id")
                            or (
                                payload.get("message_id") is not None
                                and task.get("message_id") == payload.get("message_id")
                            )
                        ):
                            task["value"]["status"] = {"state": "TASK_STATE_COMPLETED"}
                            task["value"]["artifacts"] = (
                                [{"artifactId": "release-text", "parts": [{"data": {"text": output_text}}]}]
                                if output_text is not None
                                else self.state.artifacts(output_scenario, [])
                            )
                            barrier = self.state.receipt_barriers.get(identifier)
                            if barrier is not None:
                                barrier.set()
                self.reply({"released": True})
            elif self.authorized():
                if path.endswith("/message:send") or path.endswith("/message:stream"):
                    scenario, value = self.state.send(payload)
                    if scenario == "unknown":
                        self.close_connection = True
                        self.connection.shutdown(socket.SHUT_RDWR)
                        self.connection.close()
                    else:
                        if scenario == "slow-first":
                            time.sleep(self.state.slow_seconds)
                        if scenario == "crash-before-receipt":
                            value = self.state.wait_before_receipt(value["task"]["id"])
                        self.reply(value, sse=path.endswith("message:stream"))
                elif path.endswith(":cancel"):
                    status, value = self.state.cancel(path.rsplit("/", 1)[1].removesuffix(":cancel"))
                    self.reply(value, status=status)
                else:
                    self.reply({"code": "not_found"}, status=404)
        except (ValueError, KeyError, TypeError):
            self.reply({"code": "invalid_fixture_request"}, status=400)


def serve() -> None:
    state = FixtureState(
        public_url=os.environ.get("BYOA_FIXTURE_PUBLIC_URL", "https://byoa-fixture"),
        bearer=os.environ.get("BYOA_FIXTURE_BEARER", ""),
        slow_seconds=float(os.environ.get("BYOA_FIXTURE_SLOW_SECONDS", "35")),
        barrier_seconds=float(os.environ.get("BYOA_FIXTURE_BARRIER_SECONDS", "60")),
    )
    server = FixtureServer(
        (os.environ.get("BYOA_FIXTURE_HOST", "0.0.0.0"), int(os.environ.get("BYOA_FIXTURE_PORT", "443"))), state
    )
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(os.environ["BYOA_FIXTURE_CERT"], os.environ["BYOA_FIXTURE_KEY"])
    server.socket = context.wrap_socket(server.socket, server_side=True)
    server.serve_forever(poll_interval=0.2)


if __name__ == "__main__":
    serve()
