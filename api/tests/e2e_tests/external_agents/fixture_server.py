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
                "previous_task_state_at_send": previous["value"]["status"]["state"] if previous else None,
            }
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

    def get(self, identifier: str) -> dict | None:
        with self.lock:
            self.counts["get"] += 1
            task = self.tasks.get(identifier)
            if task is not None:
                task["gets"] += 1
                if task["scenario"] == "working":
                    task["value"]["status"] = {"state": "TASK_STATE_COMPLETED"}
                    task["value"]["artifacts"] = self.artifacts("completed", [])
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
        elif path in {"/v1/projects", "/asset/v1/projects", "/app/v1/projects"}:
            # PhoenixProvider.verify requires a real project-page JSON shape.
            self.reply({"data": [], "next_cursor": None})
        elif path.endswith("/.well-known/agent-card.json"):
            prefix = path.removesuffix("/.well-known/agent-card.json")
            if prefix.startswith("/capacity-") and prefix not in CAPACITY_PREFIXES:
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
                task = self.state.get(path.rsplit("/", 1)[1])
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
            if path == "/admin/export-control":
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
                            task["value"]["artifacts"] = self.state.artifacts(output_scenario, [])
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
