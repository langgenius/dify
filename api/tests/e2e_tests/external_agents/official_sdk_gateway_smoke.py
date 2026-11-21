"""Bounded real-socket SDK/gateway smoke test in the optional peer environment.

This uses explicit injected loopback HTTP only to validate SDK wire compatibility
quickly. It does not replace the verified-TLS Console/Workflow dev acceptance.
The one-second local SSE window is deliberately smaller than the unchanged
30-second product window exercised by official_sdk_acceptance.py.
"""

from __future__ import annotations

import base64
import json
import os
import socket
import threading
import time
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import httpx
import uvicorn

from providers.a2a.gateway import A2AGateway
from providers.a2a.transport import BoundedTransport
from services.external_agents.protocol import ConnectionSpec, NoAuth, SendRequest
from tests.e2e_tests.external_agents.acceptance import require
from tests.e2e_tests.external_agents.official_sdk_server import FILE_BYTES, create_app


class LoopbackRequester:
    """Inject real local HTTP without production SSRF exceptions or retries."""

    def __init__(self) -> None:
        """Create a non-proxy local test client; caller always closes it."""
        self.client = httpx.Client(trust_env=False)

    def request(self, method: str, url: str, **kwargs) -> httpx.Response:
        """Open one streaming response using the bounded transport's timeouts."""
        options = {
            k: v
            for k, v in kwargs.items()
            if k not in {"max_retries", "stream_response", "ssl_verify", "follow_redirects"}
        }
        request = self.client.build_request(method, url, **options)
        return self.client.send(request, stream=True, follow_redirects=False)


def run_smoke() -> dict:
    """Serve a temporary loopback peer; validate real gateway results and stop it.

    Preconditions: isolated SDK dependencies and Dify source are importable.
    Postconditions: all six wire paths agree with official SDK observations;
    client, listening socket and ASGI server are closed even on failed checks.
    """
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    origin = "http://127.0.0.1:" + str(listener.getsockname()[1])
    server = uvicorn.Server(uvicorn.Config(create_app(origin), log_level="error", access_log=False))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
    thread.start()
    requester = LoopbackRequester()
    gateway = A2AGateway(BoundedTransport(requester), allow_loopback_http=True)
    checks = []

    def request(scenario: str, *, file: bool = False) -> SendRequest:
        parts = [{"text": f"[byoa:{scenario}:local] Controlled SDK smoke"}]
        if file:
            parts.append(
                {"raw": base64.b64encode(FILE_BYTES).decode(), "mediaType": "application/pdf", "filename": "input.pdf"}
            )
        return SendRequest(
            message_id=str(uuid4()),
            parts=tuple(parts),
            accepted_output_modes=("text/plain", "application/pdf", "application/json"),
        )

    try:
        deadline = time.monotonic() + 10
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        require(server.started, "The bounded local official SDK peer did not start.")
        plain = ConnectionSpec(endpoint=origin, authentication=NoAuth())
        verified = gateway.verify(plain)
        require(not verified.streaming, "The plain SDK Card advertised streaming.")
        plain = replace(plain, interface_url=verified.interface_url)
        direct = gateway.send(plain, request("direct"), streaming=False)
        require(direct.kind == "message" and direct.task_id is None, "Direct SDK Message failed.")
        checks.append("official_sdk_direct_message_via_real_gateway")
        for scenario in ("working", "file-input", "file-output"):
            initial = gateway.send(plain, request(scenario, file=scenario == "file-input"), streaming=False)
            require(initial.state == "TASK_STATE_WORKING", "SDK async Task was not returned immediately.")
            assert initial.task_id is not None
            time.sleep(2.3)
            completed = gateway.get_task(plain, initial.task_id)
            require(completed.state == "TASK_STATE_COMPLETED", "The SDK Task did not complete.")
            if scenario == "file-input":
                require(
                    completed.payload["artifacts"][0]["parts"][0]["data"]["total_bytes"] == len(FILE_BYTES),
                    "SDK file input bytes changed.",
                )
            elif scenario == "file-output":
                require(
                    base64.b64decode(completed.payload["artifacts"][0]["parts"][0]["raw"]) == FILE_BYTES,
                    "SDK file output bytes changed.",
                )
            checks.append("official_sdk_" + scenario.replace("-", "_") + "_via_real_gateway")
        initial = gateway.send(plain, request("hold"), streaming=False)
        assert initial.task_id is not None
        require(
            gateway.cancel_task(plain, initial.task_id).state == "TASK_STATE_CANCELED",
            "SDK cancellation did not confirm Canceled.",
        )
        checks.append("official_sdk_cancel_via_real_gateway")
        stream = ConnectionSpec(endpoint=origin + "/stream/.well-known/agent-card.json", authentication=NoAuth())
        verified = gateway.verify(stream)
        require(verified.streaming, "The SDK streaming Card is unavailable.")
        stream = replace(stream, interface_url=verified.interface_url)
        initial = gateway.send(stream, request("working-stream"), streaming=True, timeout_seconds=1)
        require(initial.state == "TASK_STATE_WORKING", "The SDK partial SSE lost its known Task.")
        assert initial.task_id is not None
        time.sleep(2)
        require(
            gateway.get_task(stream, initial.task_id).state == "TASK_STATE_COMPLETED",
            "The known SDK SSE Task could not be queried after disconnect.",
        )
        checks.append("official_sdk_partial_sse_then_get_via_real_gateway")
        stats = requester.client.get(origin + "/admin/state").json()
        require(
            stats["counts"]["subscribe"] == 0 and stats["counts"]["send"] == 5 and stats["counts"]["stream"] == 1,
            "SDK HTTP operation counts differ from authorized sends.",
        )
        return {
            "result": "passed",
            "scope": "local real SDK socket + production gateway; not dev Console E2E",
            "checks": checks,
            "sdk_version": stats["sdk_version"],
            "counts": stats["counts"],
            "local_listen_seconds": 1,
            "local_explicit_loopback_http": True,
        }
    finally:
        requester.client.close()
        server.should_exit = True
        thread.join(5)
        listener.close()


def main() -> None:
    """Write validation facts only; any failed invariant produces a nonzero exit."""
    result = run_smoke()
    encoded = json.dumps(result, indent=2)
    if destination := os.environ.get("BYOA_SDK_SMOKE_OUTPUT"):
        Path(destination).write_text(encoded + "\n")
    print(encoded)


if __name__ == "__main__":
    main()
