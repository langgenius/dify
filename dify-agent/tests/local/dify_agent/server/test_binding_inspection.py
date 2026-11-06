"""Read-only evidence must never turn ambiguous health into recovery authority."""

import json
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
from dify_agent.runtime_backend.local import LocalExecutionBindingBackend
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
        assert requests == [("GET", "/proxy/healthz")]
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
    from dify_agent.runtime_backend.local import _LOCAL_INSPECTION_PROBE

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
    requests: list[tuple[str, str]] = []

    class Handler(BaseHTTPRequestHandler):
        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

        def do_POST(self) -> None:
            requests.append((self.command, self.path))
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            completed = subprocess.run(
                body["script"],
                shell=True,
                executable="/bin/sh",
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
