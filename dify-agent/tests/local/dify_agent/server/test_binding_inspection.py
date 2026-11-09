"""Read-only evidence must never turn ambiguous health into recovery authority."""

from collections.abc import Generator
from contextlib import contextmanager
import json
import shlex
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import override

import httpx

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from dify_agent import protocol
from dify_agent.client import Client
from dify_agent.runtime_backend.enterprise import EnterpriseExecutionBindingBackend
from dify_agent.runtime_backend.local import LocalExecutionBindingBackend, _LOCAL_INSPECTION_PROBE
from dify_agent.server.auth import create_bearer_token_dependency
from dify_agent.server.execution_bindings import ExecutionBindingService
from dify_agent.server.routes import execution_bindings


def test_inspection_dto_rejects_unbounded_or_conflicting_evidence() -> None:
    with pytest.raises(ValidationError):
        protocol.InspectExecutionBindingResponse.model_validate(
            dict(
                binding_ref="b:w",
                workspace_ref="w",
                adapter="local",
                state="definitively_gone",
                evidence_code="health_ok",
            )
        )
    with pytest.raises(ValidationError):
        protocol.InspectExecutionBindingRequest.model_validate(dict(binding_ref="b:w", workspace_ref="w", gone=True))


@pytest.mark.parametrize("state", ["ok", "empty", "degraded", "invalid", "generic404", "job404", "route404", "expired"])
@pytest.mark.anyio
async def test_enterprise_health_is_never_authoritative_absence(state: str) -> None:
    requests: list[tuple[str, str]] = []

    class Handler(BaseHTTPRequestHandler):
        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

        def do_GET(self) -> None:
            requests.append((self.command, self.path))
            self.send_response(404 if state.endswith("404") or state == "expired" else 200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            bodies: dict[str, object] = {
                "ok": {"status": "ok"},
                "empty": {},
                "degraded": {"status": "degraded"},
                "invalid": {"status": True},
                "generic404": {"error": {"code": "not_found"}},
                "job404": {"error": {"code": "job_not_found"}},
                "route404": {"error": {"code": "route_not_found"}},
                "expired": {"error": {"code": "sandbox_expired"}},
            }
            self.wfile.write(json.dumps(bodies[state]).encode())

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    service = ExecutionBindingService(
        backend=EnterpriseExecutionBindingBackend(
            gateway_endpoint=f"http://127.0.0.1:{server.server_port}",
            auth_token="private",
        )
    )
    app = FastAPI()
    app.include_router(
        execution_bindings.create_execution_binding_inspection_router(lambda: service),
        dependencies=[create_bearer_token_dependency("control")],
    )
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as http:
            assert (await http.post("/execution-bindings/inspect", json={})).status_code == 401
            assert requests == []
            client = Client(
                base_url="http://testserver", headers={"Authorization": "Bearer control"}, async_http_client=http
            )
            result = await client.inspect_execution_binding(
                protocol.InspectExecutionBindingRequest(binding_ref="sandbox", workspace_ref="sandbox")
            )
            assert result.state == ("usable" if state == "ok" else "uncertain")
            assert result.binding_ref == result.workspace_ref == "sandbox"
            assert "private" not in result.model_dump_json()
        assert requests == (
            [("GET", "/proxy/healthz")]
            if state == "ok"
            else [("GET", "/proxy/healthz"), ("GET", "/v1/sandboxes/sandbox")]
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


@pytest.mark.parametrize(
    "case,want",
    [
        ("present", "paths_present"),
        ("missing", "path_absent"),
        ("symlink", "path_ambiguous"),
        ("root_missing", "root_unavailable"),
        ("root_symlink", "root_unavailable"),
        ("permission", "root_unavailable"),
    ],
)
def test_fixed_local_probe_executes_only_exact_paths(tmp_path: Path, case: str, want: str) -> None:
    home_root, workspace_root = tmp_path / "homes", tmp_path / "workspaces"
    home_root.mkdir()
    workspace_root.mkdir()
    (home_root / "b").mkdir()
    (workspace_root / "w").mkdir()
    if case == "missing":
        (home_root / "b").rmdir()
    if case == "symlink":
        (home_root / "b").rmdir()
        (home_root / "b").symlink_to(workspace_root / "w")
    if case == "root_missing":
        (home_root / "b").rmdir()
        home_root.rmdir()
    if case == "root_symlink":
        (home_root / "b").rmdir()
        home_root.rmdir()
        home_root.symlink_to(workspace_root)
    if case == "permission":
        home_root.chmod(0)
    args = dict(
        binding_ref="b:w",
        workspace_ref="w",
        home_root=str(home_root),
        workspace_root=str(workspace_root),
        home_path=str(home_root / "b"),
        workspace_path=str(workspace_root / "w"),
    )
    try:
        result = subprocess.run(
            [sys.executable, "-c", _LOCAL_INSPECTION_PROBE, json.dumps(args)],
            check=True,
            capture_output=True,
            text=True,
        )
        assert json.loads(result.stdout) == {**args, "evidence_code": want}
    finally:
        if case == "permission":
            home_root.chmod(0o700)


@pytest.mark.anyio
async def test_local_identity_mismatch_and_transport_failure_are_uncertain() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
    endpoint = f"http://127.0.0.1:{server.server_port}"
    server.server_close()
    service = ExecutionBindingService(backend=LocalExecutionBindingBackend(endpoint=endpoint, auth_token="private"))
    mismatch = await service.inspect_binding(
        protocol.InspectExecutionBindingRequest(binding_ref="b:w", workspace_ref="other")
    )
    assert (mismatch.state, mismatch.evidence_code) == ("uncertain", "identity_mismatch")
    failed = await service.inspect_binding(
        protocol.InspectExecutionBindingRequest(binding_ref="b:w", workspace_ref="w")
    )
    assert (failed.state, failed.evidence_code) == ("uncertain", "probe_unavailable")
    enterprise = await ExecutionBindingService(
        backend=EnterpriseExecutionBindingBackend(gateway_endpoint=endpoint, auth_token="private")
    ).inspect_binding(protocol.InspectExecutionBindingRequest(binding_ref="sandbox", workspace_ref="sandbox"))
    assert (enterprise.state, enterprise.evidence_code) == ("uncertain", "health_unavailable")


@pytest.mark.anyio
@pytest.mark.parametrize(
    "case,want",
    [
        ("present", "usable"),
        ("missing", "definitively_gone"),
        ("invalid", "uncertain"),
        ("foreign", "uncertain"),
        ("permission", "uncertain"),
    ],
)
async def test_local_real_transport_runs_fixed_read_only_probe(tmp_path: Path, case: str, want: str) -> None:
    """Removing exact-output validation or collapsing errors to loss must fail here."""
    home_root, workspace_root = tmp_path / "homes", tmp_path / "workspaces"
    home_root.mkdir()
    workspace_root.mkdir()
    (home_root / "b").mkdir()
    (workspace_root / "w").mkdir()
    if case == "missing":
        (workspace_root / "w").rmdir()
    if case == "permission":
        (home_root / "b").chmod(0)
    probe_args = json.dumps(
        dict(
            binding_ref="b:w",
            workspace_ref="w",
            home_root=str(home_root),
            workspace_root=str(workspace_root),
            home_path=str(home_root / "b"),
            workspace_path=str(workspace_root / "w"),
        )
    )
    expected_script = shlex.join(["python3", "-c", _LOCAL_INSPECTION_PROBE, probe_args])
    requests: list[tuple[str, str]] = []
    probes_match: list[bool] = []

    class Handler(BaseHTTPRequestHandler):
        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

        def do_POST(self) -> None:
            requests.append((self.command, self.path))
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            matches = body.get("script") == expected_script
            probes_match.append(matches)
            if not matches:
                self.send_error(400, "unexpected inspection command")
                return
            completed = subprocess.run(
                [sys.executable, "-c", _LOCAL_INSPECTION_PROBE, probe_args],
                check=True,
                capture_output=True,
                text=True,
                cwd=tmp_path,
            )
            output = completed.stdout
            if case == "invalid":
                output = "{}"
            if case == "foreign":
                output = json.dumps({**json.loads(output), "workspace_ref": "foreign"})
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    dict(
                        job_id="probe",
                        done=True,
                        status="exited",
                        exit_code=0,
                        output_path="/tmp/probe.log",
                        output=output,
                        offset=0,
                        truncated=False,
                    )
                ).encode()
            )

        def do_DELETE(self) -> None:
            requests.append((self.command, self.path))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"job_id":"probe","deleted":true}')

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    backend = LocalExecutionBindingBackend(
        endpoint=f"http://127.0.0.1:{server.server_port}",
        auth_token="private",
        materialized_home_root=str(home_root),
        workspace_root=str(workspace_root),
        snapshot_root=str(home_root / ".snapshots"),
    )
    try:
        result = await ExecutionBindingService(backend=backend).inspect_binding(
            protocol.InspectExecutionBindingRequest(binding_ref="b:w", workspace_ref="w")
        )
        assert result.state == want
        assert requests == [("POST", "/v1/jobs/run"), ("DELETE", "/v1/jobs/probe?force=true")]
        assert probes_match == [True]
        assert home_root.is_dir() and workspace_root.is_dir()
    finally:
        if case == "permission":
            (home_root / "b").chmod(0o700)
        server.shutdown()
        server.server_close()
        thread.join()


def test_private_inspection_validation_never_echoes_input() -> None:
    app = FastAPI()
    app.include_router(execution_bindings.create_execution_binding_inspection_router(lambda: None))
    with TestClient(app) as http:
        response = http.post(
            "/execution-bindings/inspect", json=dict(binding_ref="PRIVATE", workspace_ref="", credential="PRIVATE")
        )
    assert response.status_code == 422
    assert "PRIVATE" not in response.text


@pytest.mark.anyio
async def test_other_backends_and_native_scopes_are_explicitly_unsupported() -> None:
    from dify_agent.runtime_backend.e2b import E2BExecutionBindingBackend, E2BSDKControlPlane
    from dify_agent.runtime_backend.openshell import OpenShellExecutionBindingBackend, OpenShellSDKControlPlane

    backends = (
        E2BExecutionBindingBackend(
            control_plane=E2BSDKControlPlane(api_key="synthetic"), template="unused", active_timeout_seconds=300
        ),
        OpenShellExecutionBindingBackend(control_plane=OpenShellSDKControlPlane(endpoint="unused")),
        LocalExecutionBindingBackend(endpoint="http://unused", auth_token="private"),
    )
    for backend in backends[:2]:
        result = await ExecutionBindingService(backend=backend).inspect_binding(
            protocol.InspectExecutionBindingRequest(binding_ref="ordinary", workspace_ref="ordinary")
        )
        assert (result.state, result.adapter, result.evidence_code) == (
            "unsupported",
            "unsupported",
            "backend_unsupported",
        )
    for backend in backends:
        result = await ExecutionBindingService(backend=backend).inspect_binding(
            protocol.InspectExecutionBindingRequest(binding_ref="native:scope:0", workspace_ref="native:scope:0")
        )
        assert (result.state, result.adapter, result.evidence_code) == (
            "unsupported",
            "unsupported",
            "backend_unsupported",
        )


@pytest.mark.anyio
@pytest.mark.parametrize("mode", ["sync", "async"])
async def test_client_rejects_foreign_inspection_identity(mode: str) -> None:
    from dify_agent.client import DifyAgentValidationError

    class Handler(BaseHTTPRequestHandler):
        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

        def do_POST(self) -> None:
            self.rfile.read(int(self.headers["Content-Length"]))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                b'{"binding_ref":"foreign","workspace_ref":"w","adapter":"local","state":"definitively_gone","evidence_code":"path_absent"}'
            )

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    request = protocol.InspectExecutionBindingRequest(binding_ref="b:w", workspace_ref="w")
    try:
        with pytest.raises(DifyAgentValidationError):
            if mode == "sync":
                with Client(base_url=f"http://127.0.0.1:{server.server_port}") as client:
                    client.inspect_execution_binding_sync(request)
            else:
                async with Client(base_url=f"http://127.0.0.1:{server.server_port}") as client:
                    await client.inspect_execution_binding(request)
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


@pytest.mark.anyio
@pytest.mark.parametrize(
    "status,body,want",
    [
        (404, b'{"code":404,"reason":"sandbox_not_found","message":"PRIVATE_UPSTREAM_BODY"}', "definitively_gone"),
        (404, b'{"code":404,"reason":"NOT_FOUND"}', "uncertain"),
        (404, b'{"code":404,"reason":"sandbox_expired"}', "uncertain"),
        (404, b'{"code":404,"reason":"job_not_found"}', "uncertain"),
        (404, b'{"code":404,"reason":"route_not_found"}', "uncertain"),
        (404, b'{"code":"404","reason":"sandbox_not_found"}', "uncertain"),
        (404, b'{"code":true,"reason":"sandbox_not_found"}', "uncertain"),
        (404, b'{"reason":"sandbox_not_found"}', "uncertain"),
        (200, b'{"code":404,"reason":"sandbox_not_found"}', "uncertain"),
        (401, b'{"code":404,"reason":"sandbox_not_found"}', "uncertain"),
        (403, b'{"code":404,"reason":"sandbox_not_found"}', "uncertain"),
        (500, b'{"code":404,"reason":"sandbox_not_found"}', "uncertain"),
        (302, b'{"code":404,"reason":"sandbox_not_found"}', "uncertain"),
        (404, b"", "uncertain"),
        (404, b"PRIVATE_UPSTREAM_BODY", "uncertain"),
        (404, b'{"code":404,"reason":"sandbox_not_found","sandboxId":"foreign"}', "uncertain"),
        (404, b'{"code":404,"reason":"sandbox_not_found","metadata":{"sandboxId":"foreign"}}', "uncertain"),
        (404, b'{"code":404,"reason":"other","reason":"sandbox_not_found"}', "uncertain"),
        (404, b'[["code",404],["reason","sandbox_not_found"]]', "uncertain"),
        (404, b'{"code":404,"reason":"sandbox_not_found","message":' + b'"' + b"x" * 4096 + b'"}', "uncertain"),
    ],
)
async def test_enterprise_inspection_requires_exact_control_plane_absence(
    status: int, body: bytes, want: str, caplog: pytest.LogCaptureFixture
) -> None:
    with _inspection_gateway(status=status, body=body) as (endpoint, requests):
        backend = EnterpriseExecutionBindingBackend(gateway_endpoint=endpoint, auth_token="PRIVATE_AUTH")
        result = await backend.inspect_binding(
            protocol.InspectExecutionBindingRequest(binding_ref="sandbox", workspace_ref="sandbox")
        )
        assert result.state == want
        assert result.evidence_code == ("sandbox_not_found" if want == "definitively_gone" else "health_unavailable")
        assert requests == [
            ("/proxy/healthz", "PRIVATE_AUTH"),
            ("/v1/sandboxes/sandbox", "PRIVATE_AUTH"),
        ]
        assert "PRIVATE_AUTH" not in result.model_dump_json() + caplog.text
        assert "PRIVATE_UPSTREAM_BODY" not in result.model_dump_json() + caplog.text


@pytest.mark.anyio
@pytest.mark.parametrize(
    "binding,expected_path",
    [
        ("sandbox?x=y#part", "/v1/sandboxes/sandbox%3Fx%3Dy%23part"),
        ("sandbox space", "/v1/sandboxes/sandbox%20space"),
        ("sandbox:version", "/v1/sandboxes/sandbox%3Aversion"),
    ],
)
async def test_enterprise_inspection_keeps_one_escaped_control_plane_identifier(
    binding: str, expected_path: str
) -> None:
    with _inspection_gateway() as (endpoint, requests):
        result = await EnterpriseExecutionBindingBackend(
            gateway_endpoint=endpoint, auth_token="PRIVATE_AUTH"
        ).inspect_binding(protocol.InspectExecutionBindingRequest(binding_ref=binding, workspace_ref=binding))
        assert result.state == "definitively_gone"
        assert requests == [("/proxy/healthz", "PRIVATE_AUTH"), (expected_path, "PRIVATE_AUTH")]


@pytest.mark.anyio
@pytest.mark.parametrize("binding", [".", "..", "../foreign", "a/b", "a\\b", "a%2fb", "a\x00b", "a\nb", "native:scope"])
async def test_enterprise_inspection_refuses_ambiguous_identifiers_without_http(binding: str) -> None:
    with _inspection_gateway() as (endpoint, requests):
        result = await EnterpriseExecutionBindingBackend(
            gateway_endpoint=endpoint, auth_token="PRIVATE_AUTH"
        ).inspect_binding(protocol.InspectExecutionBindingRequest(binding_ref=binding, workspace_ref=binding))
        assert (result.state, result.evidence_code) == ("uncertain", "identity_mismatch")
        assert requests == []


@pytest.mark.anyio
@pytest.mark.parametrize("health_delay,control_delay,request_count", [(0.15, 0.15, 2), (0.3, 0, 1)])
async def test_enterprise_inspection_has_one_shared_total_deadline(
    health_delay: float, control_delay: float, request_count: int
) -> None:
    import asyncio

    with _inspection_gateway(health_delay=health_delay, control_delay=control_delay) as (endpoint, requests):
        backend = EnterpriseExecutionBindingBackend(
            gateway_endpoint=endpoint, auth_token="PRIVATE_AUTH", proxy_timeout=0.25
        )
        started = asyncio.get_running_loop().time()
        result = await backend.inspect_binding(
            protocol.InspectExecutionBindingRequest(binding_ref="sandbox", workspace_ref="sandbox")
        )
        assert asyncio.get_running_loop().time() - started < 0.4
        assert (result.state, result.evidence_code) == ("uncertain", "health_unavailable")
        assert (
            requests == [("/proxy/healthz", "PRIVATE_AUTH"), ("/v1/sandboxes/sandbox", "PRIVATE_AUTH")][:request_count]
        )


@pytest.mark.parametrize(
    "adapter,state,code",
    [
        ("enterprise", "definitively_gone", "path_absent"),
        ("local", "definitively_gone", "sandbox_not_found"),
        ("enterprise", "usable", "sandbox_not_found"),
        ("enterprise", "definitively_gone", "health_unavailable"),
        ("unsupported", "definitively_gone", "sandbox_not_found"),
    ],
)
def test_inspection_rejects_spoofed_cross_adapter_absence(adapter: str, state: str, code: str) -> None:
    with pytest.raises(ValidationError):
        protocol.InspectExecutionBindingResponse.model_validate(
            dict(binding_ref="sandbox", workspace_ref="sandbox", adapter=adapter, state=state, evidence_code=code)
        )


@contextmanager
def _inspection_gateway(
    *,
    status: int = 404,
    body: bytes = b'{"code":404,"reason":"sandbox_not_found"}',
    health_delay: float = 0,
    control_delay: float = 0,
) -> Generator[tuple[str, list[tuple[str, str | None]]]]:
    """Serve real HTTP contract responses without running a sandbox or replacing a client."""
    requests: list[tuple[str, str | None]] = []

    class Handler(BaseHTTPRequestHandler):
        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

        def do_GET(self) -> None:
            requests.append((self.path, self.headers.get("X-Inner-Api-Key")))
            health = self.path == "/proxy/healthz"
            threading.Event().wait(health_delay if health else control_delay)
            self.send_response(503 if health else status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Location", "/v1/sandboxes/foreign")
            self.end_headers()
            try:
                self.wfile.write(b'{"status":"degraded"}' if health else body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.01), daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_enterprise_absence_evidence_requires_coupled_refs() -> None:
    with pytest.raises(ValidationError):
        protocol.InspectExecutionBindingResponse.model_validate(
            dict(
                binding_ref="sandbox",
                workspace_ref="foreign",
                adapter="enterprise",
                state="definitively_gone",
                evidence_code="sandbox_not_found",
            )
        )
