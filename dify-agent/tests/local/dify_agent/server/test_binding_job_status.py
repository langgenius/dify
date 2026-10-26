"""Real Shellctl SDK HTTP boundary plus protected service route and SDK serialization."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from dify_agent import protocol
from dify_agent.client import Client, DifyAgentHTTPError
from dify_agent.runtime_backend.enterprise import EnterpriseExecutionBindingBackend
from dify_agent.runtime_backend.local import LocalExecutionBindingBackend
from dify_agent.server.auth import create_bearer_token_dependency
from dify_agent.server.execution_bindings import ExecutionBindingService
from dify_agent.server.routes import execution_bindings


@pytest.mark.parametrize("backend_name", ["local", "enterprise"])
@pytest.mark.parametrize(
    "state", ["running", "exited", "missing", "foreign", "malformed", "coerced_bool", "coerced_exit"]
)
def test_status_real_http_only_get_and_strips_private_fields(backend_name, state):
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            requests.append((self.command, self.path, dict(self.headers)))
            self.send_response(404 if state == "missing" else 200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            body = (
                {"error": {"code": "job_not_found", "message": "PRIVATE"}}
                if state == "missing"
                else dict(
                    job_id="foreign" if state == "foreign" else "job",
                    status="exited" if state == "exited" else "running",
                    done=state == "exited",
                    exit_code=0 if state == "exited" else None,
                    created_at="2026-01-01T00:00:00Z",
                    started_at=None,
                    ended_at=None,
                    offset=0,
                )
            )
            if state == "malformed":
                body["done"] = True
            if state == "coerced_bool":
                body["done"] = "false"
            if state == "coerced_exit":
                body.update(status="exited", done=True, exit_code="0")
            self.wfile.write(json.dumps(body).encode())

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    endpoint = f"http://127.0.0.1:{server.server_port}"
    backend = (
        LocalExecutionBindingBackend(endpoint=endpoint, auth_token="private")
        if backend_name == "local"
        else (EnterpriseExecutionBindingBackend(gateway_endpoint=endpoint, auth_token="private"))
    )
    service = ExecutionBindingService(backend=backend)
    router_factory = execution_bindings.create_execution_binding_job_router
    try:
        app = FastAPI()
        app.include_router(router_factory(lambda: service), dependencies=[create_bearer_token_dependency("control")])
        with TestClient(app) as http:
            assert http.post("/execution-bindings/job-status", json={}).status_code == 401
            assert requests == []
            client = Client(
                base_url="http://testserver", headers={"Authorization": "Bearer control"}, sync_http_client=http
            )
            selection = protocol.ReadExecutionBindingJobRequest(binding_ref="binding:workspace", job_id="job")
            if state in {"running", "exited"}:
                response = client.read_execution_binding_job_sync(selection)
                assert response.model_dump() == dict(
                    job_id="job", status=state, done=state == "exited", exit_code=0 if state == "exited" else None
                )
            else:
                with pytest.raises(DifyAgentHTTPError) as caught:
                    client.read_execution_binding_job_sync(selection)
                assert caught.value.status_code == (404 if state == "missing" else 502)
                assert "PRIVATE" not in str(caught.value)
        assert len(requests) == 1
        method, path, headers = requests[0]
        assert method == "GET"
        assert path == ("/v1/jobs/job" if backend_name == "local" else "/proxy/v1/jobs/job")
        if backend_name == "enterprise":
            assert headers["X-Sandbox-Id"] == "binding:workspace"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


@pytest.mark.anyio
async def test_status_unsupported_and_transport_failure_refuse_without_acquire():
    from dify_agent.server.execution_bindings import ExecutionBindingServiceError
    from tests.local.dify_agent.server.test_execution_bindings import _Backend

    for backend, binding in [
        (_Backend(), "binding"),
        (LocalExecutionBindingBackend(endpoint="http://unused", auth_token="private"), "native:scope:0"),
    ]:
        with pytest.raises(ExecutionBindingServiceError) as caught:
            await ExecutionBindingService(backend=backend).read_job(
                protocol.ReadExecutionBindingJobRequest(binding_ref=binding, job_id="job")
            )
        assert caught.value.status_code == 409
    # Reserve then close a real loopback listener to exercise connection refusal.
    server = ThreadingHTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
    endpoint = f"http://127.0.0.1:{server.server_port}"
    server.server_close()
    for backend in [
        LocalExecutionBindingBackend(endpoint=endpoint, auth_token="private"),
        EnterpriseExecutionBindingBackend(gateway_endpoint=endpoint, auth_token="private"),
    ]:
        with pytest.raises(ExecutionBindingServiceError) as caught:
            await ExecutionBindingService(backend=backend).read_job(
                protocol.ReadExecutionBindingJobRequest(binding_ref="binding:workspace", job_id="job")
            )
        assert caught.value.status_code == 502
        assert caught.value.code == "binding_job_status_failed"


def test_invalid_job_selection_never_echoes_private_input():
    app = FastAPI()
    app.include_router(execution_bindings.create_execution_binding_job_router(lambda: None))
    with TestClient(app) as http:
        response = http.post(
            "/execution-bindings/job-status", json={"binding_ref": "PRIVATE", "job_id": "", "extra": "PRIVATE"}
        )
    assert response.status_code == 422
    assert "PRIVATE" not in response.text


@pytest.mark.anyio
async def test_status_real_http_timeout_refuses():
    from dify_agent.server.execution_bindings import ExecutionBindingServiceError

    requests = []
    release = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            requests.append((self.command, self.path))
            release.wait(1)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        service = ExecutionBindingService(
            backend=EnterpriseExecutionBindingBackend(
                gateway_endpoint=f"http://127.0.0.1:{server.server_port}", auth_token="private", proxy_timeout=0.05
            )
        )
        with pytest.raises(ExecutionBindingServiceError) as caught:
            await service.read_job(protocol.ReadExecutionBindingJobRequest(binding_ref="binding", job_id="job"))
        assert caught.value.status_code == 502
        assert caught.value.code == "binding_job_status_failed"
        assert requests == [("GET", "/proxy/v1/jobs/job")]
    finally:
        release.set()
        server.shutdown()
        server.server_close()
        thread.join()
