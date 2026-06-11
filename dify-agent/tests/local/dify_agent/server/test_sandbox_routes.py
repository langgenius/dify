from fastapi.testclient import TestClient

from dify_agent.protocol import SandboxListResult, SandboxReadResult, SandboxUploadedFile, SandboxUploadResult
from dify_agent.server.routes.sandbox import create_sandbox_router, install_sandbox_exception_handlers
from dify_agent.server.sandbox_service import SandboxServiceError


class _SuccessfulSandboxService:
    async def list_files(self, request: object) -> SandboxListResult:
        del request
        return SandboxListResult(path=".", entries=[], truncated=False)

    async def read_file(self, request: object) -> SandboxReadResult:
        del request
        return SandboxReadResult(path="report.txt", encoding="utf-8", content="hello", size=5, truncated=False)

    async def upload_file(self, request: object) -> SandboxUploadResult:
        del request
        return SandboxUploadResult(
            path="report.txt",
            file=SandboxUploadedFile(id="file-1", name="report.txt", size=5, mime_type="text/plain"),
        )


def _locator_payload() -> dict[str, object]:
    return {
        "composition": {
            "layers": [
                {
                    "name": "execution_context",
                    "type": "dify.execution_context",
                    "config": {"tenant_id": "tenant-1", "invoke_from": "workflow_run"},
                },
                {
                    "name": "shell",
                    "type": "dify.shell",
                    "deps": {"execution_context": "execution_context"},
                    "config": {},
                },
            ]
        },
        "session_snapshot": {
            "layers": [
                {"name": "execution_context", "lifecycle_state": "suspended", "runtime_state": {}},
                {
                    "name": "shell",
                    "lifecycle_state": "suspended",
                    "runtime_state": {
                        "session_id": "internal",
                        "workspace_cwd": "/tmp/workspace",
                        "job_ids": [],
                        "job_offsets": {},
                    },
                },
            ]
        },
        "shell_layer_name": "shell",
    }


def test_sandbox_routes_return_success_payloads() -> None:
    from fastapi import FastAPI

    app = FastAPI()
    install_sandbox_exception_handlers(app)
    app.include_router(create_sandbox_router(lambda: _SuccessfulSandboxService()))  # pyright: ignore[reportArgumentType]
    client = TestClient(app)

    list_response = client.post("/sandbox/files/list", json={"locator": _locator_payload(), "path": "."})
    read_response = client.post(
        "/sandbox/files/read",
        json={"locator": _locator_payload(), "path": "report.txt", "encoding": "utf-8", "max_bytes": 10},
    )
    upload_response = client.post("/sandbox/files/upload", json={"locator": _locator_payload(), "path": "report.txt"})

    assert list_response.status_code == 200
    assert list_response.json() == {"path": ".", "entries": [], "truncated": False}
    assert read_response.status_code == 200
    assert read_response.json()["content"] == "hello"
    assert upload_response.status_code == 200
    assert upload_response.json()["file"]["id"] == "file-1"


def test_sandbox_routes_map_service_errors_to_code_message_body() -> None:
    from fastapi import FastAPI

    class _FailingSandboxService(_SuccessfulSandboxService):
        async def read_file(self, request: object) -> SandboxReadResult:
            del request
            raise SandboxServiceError(status_code=404, code="sandbox_file_not_found", message="Missing file")

    app = FastAPI()
    install_sandbox_exception_handlers(app)
    app.include_router(create_sandbox_router(lambda: _FailingSandboxService()))  # pyright: ignore[reportArgumentType]
    client = TestClient(app)

    response = client.post(
        "/sandbox/files/read",
        json={"locator": _locator_payload(), "path": "missing.txt", "encoding": "utf-8", "max_bytes": 10},
    )

    assert response.status_code == 404
    assert response.json() == {"code": "sandbox_file_not_found", "message": "Missing file"}


def test_sandbox_routes_map_model_validation_failures_to_code_message_body() -> None:
    from fastapi import FastAPI

    app = FastAPI()
    install_sandbox_exception_handlers(app)
    app.include_router(create_sandbox_router(lambda: _SuccessfulSandboxService()))  # pyright: ignore[reportArgumentType]
    client = TestClient(app)

    response = client.post(
        "/sandbox/files/read",
        json={"locator": _locator_payload(), "path": "missing.txt", "encoding": "utf16", "max_bytes": 10},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "sandbox_request_invalid"
    assert "encoding" in response.json()["message"]


def test_sandbox_routes_map_malformed_json_to_code_message_body() -> None:
    from fastapi import FastAPI

    app = FastAPI()
    install_sandbox_exception_handlers(app)
    app.include_router(create_sandbox_router(lambda: _SuccessfulSandboxService()))  # pyright: ignore[reportArgumentType]
    client = TestClient(app)

    response = client.post(
        "/sandbox/files/list",
        content='{"locator":',
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "sandbox_request_invalid"
