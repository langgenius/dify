import json
from collections.abc import Awaitable, Callable
from typing import ClassVar, TypedDict, cast

import httpx2 as httpx
import pytest

from shellctl.client import ShellctlClient, ShellctlClientError
from shellctl.client import sdk as shellctl_sdk
from shellctl.shared import (
    DEFAULT_TERMINATE_GRACE_SECONDS,
    HealthResponse,
    JobStatusName,
)


class ForcedDeleteKwargs(TypedDict, total=False):
    force: bool
    grace_seconds: float


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("call", "expected_path", "expected_json", "wait_timeout"),
    [
        (
            lambda client: client.run(
                "printf ready\\n",
                cwd="/tmp",
                env={"HELLO": "world"},
                timeout=12,
            ),
            "/v1/jobs/run",
            {
                "script": "printf ready\\n",
                "cwd": "/tmp",
                "env": {"HELLO": "world"},
                "timeout": 12.0,
                "output_limit": 4096,
                "idle_flush_seconds": 0.25,
            },
            22.0,
        ),
        (
            lambda client: client.wait("job-1", offset=3, timeout=7),
            "/v1/jobs/job-1/wait",
            {
                "offset": 3,
                "timeout": 7,
                "output_limit": 4096,
                "idle_flush_seconds": 0.25,
            },
            17.0,
        ),
        (
            lambda client: client.input("job-1", "ls\\n", offset=5, timeout=9),
            "/v1/jobs/job-1/input",
            {
                "text": "ls\\n",
                "offset": 5,
                "timeout": 9,
                "output_limit": 4096,
                "idle_flush_seconds": 0.25,
            },
            19.0,
        ),
    ],
)
async def test_shellctl_client_blocking_calls_use_grace_read_timeout(
    monkeypatch: pytest.MonkeyPatch,
    call: Callable[[ShellctlClient], Awaitable[object]],
    expected_path: str,
    expected_json: dict[str, object],
    wait_timeout: float,
) -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        captured["headers"] = dict(request.headers)
        captured["json"] = json.loads(request.content.decode("utf-8"))
        captured["timeout"] = request.extensions["timeout"]
        return httpx.Response(
            200,
            json={
                "job_id": "05211530-k7p",
                "done": False,
                "status": "running",
                "exit_code": None,
                "output_path": "/tmp/output.log",
                "output": "",
                "offset": 0,
                "truncated": False,
            },
        )

    monkeypatch.setenv("SHELLCTL_AUTH_TOKEN", "from-env")
    transport = httpx.MockTransport(handler)
    async with ShellctlClient(
        "http://127.0.0.1:8765",
        output_limit=4096,
        idle_flush_seconds=0.25,
        transport=transport,
    ) as client:
        await call(client)

    headers = cast(dict[str, str], captured["headers"])
    assert captured["method"] == "POST"
    assert captured["path"] == expected_path
    assert headers["authorization"] == "Bearer from-env"
    assert captured["json"] == expected_json
    assert captured["timeout"] == {
        "connect": 30.0,
        "read": wait_timeout,
        "write": 30.0,
        "pool": 30.0,
    }


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("call", "expected_method", "expected_path", "response_json", "assert_result"),
    [
        (
            lambda client: client.tail("job-1"),
            "GET",
            "/v1/jobs/job-1/log/tail",
            {
                "job_id": "job-1",
                "done": False,
                "status": "running",
                "exit_code": None,
                "output_path": "/tmp/output.log",
                "output": "tail",
                "offset": 99,
                "truncated": False,
            },
            lambda result: (result.output, result.offset) == ("tail", 99),
        ),
        (
            lambda client: client.status("job-1"),
            "GET",
            "/v1/jobs/job-1",
            {
                "job_id": "job-1",
                "status": "running",
                "done": False,
                "exit_code": None,
                "created_at": "2026-01-01T00:00:00Z",
                "started_at": "2026-01-01T00:00:01Z",
                "ended_at": None,
                "offset": 99,
            },
            lambda result: (result.status, result.offset) == ("running", 99),
        ),
        (
            lambda client: client.delete("job-1", force=False),
            "DELETE",
            "/v1/jobs/job-1",
            {"job_id": "job-1", "deleted": True},
            lambda result: (result.job_id, result.deleted) == ("job-1", True),
        ),
    ],
)
async def test_shellctl_client_control_calls_use_default_timeout(
    call: Callable[[ShellctlClient], Awaitable[object]],
    expected_method: str,
    expected_path: str,
    response_json: dict[str, object],
    assert_result: Callable[[object], bool],
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == expected_method
        assert request.url.path == expected_path
        assert request.extensions["timeout"] == {
            "connect": 30.0,
            "read": 30.0,
            "write": 30.0,
            "pool": 30.0,
        }
        return httpx.Response(200, json=response_json)

    transport = httpx.MockTransport(handler)
    async with ShellctlClient(
        "http://127.0.0.1:8765",
        output_limit=1234,
        token="secret",
        transport=transport,
    ) as client:
        result = await call(client)

    assert assert_result(result)


@pytest.mark.anyio
async def test_shellctl_client_terminate_uses_grace_read_timeout() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/v1/jobs/job-1/terminate"
        assert json.loads(request.content.decode("utf-8")) == {"grace_seconds": 7.0}
        assert request.extensions["timeout"] == {
            "connect": 30.0,
            "read": 17.0,
            "write": 30.0,
            "pool": 30.0,
        }
        return httpx.Response(
            200,
            json={
                "job_id": "job-1",
                "status": "terminated",
                "done": True,
                "exit_code": 130,
                "created_at": "2026-01-01T00:00:00Z",
                "started_at": "2026-01-01T00:00:01Z",
                "ended_at": "2026-01-01T00:00:08Z",
                "offset": 99,
            },
        )

    transport = httpx.MockTransport(handler)
    async with ShellctlClient(
        "http://127.0.0.1:8765",
        token="secret",
        transport=transport,
    ) as client:
        result = await client.terminate("job-1", grace_seconds=7.0)

    assert (result.status, result.exit_code) == ("terminated", 130)


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("kwargs", "expected_params", "expected_read_timeout"),
    [
        (
            {"force": True, "grace_seconds": 3.5},
            {"force": "true", "grace_seconds": "3.5"},
            13.5,
        ),
        (
            {"force": True},
            {"force": "true"},
            DEFAULT_TERMINATE_GRACE_SECONDS + 10.0,
        ),
        (
            {"force": True, "grace_seconds": 0.0},
            {"force": "true", "grace_seconds": "0.0"},
            10.0,
        ),
    ],
)
async def test_shellctl_client_forced_delete_uses_terminate_grace_timeout(
    kwargs: ForcedDeleteKwargs,
    expected_params: dict[str, str],
    expected_read_timeout: float,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "DELETE"
        assert request.url.path == "/v1/jobs/job-1"
        assert dict(request.url.params) == expected_params
        assert request.extensions["timeout"] == {
            "connect": 30.0,
            "read": expected_read_timeout,
            "write": 30.0,
            "pool": 30.0,
        }
        return httpx.Response(200, json={"job_id": "job-1", "deleted": True})

    transport = httpx.MockTransport(handler)
    async with ShellctlClient(
        "http://127.0.0.1:8765",
        token="secret",
        transport=transport,
    ) as client:
        result = await client.delete("job-1", **kwargs)

    assert (result.job_id, result.deleted) == ("job-1", True)


@pytest.mark.anyio
async def test_shellctl_client_closes_owned_client_on_close_and_context_exit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "ok"})

    class TrackingAsyncClient(httpx.AsyncClient):
        created_clients: ClassVar[list["TrackingAsyncClient"]] = []

        def __init__(self, *args: object, **kwargs: object) -> None:
            super().__init__(*args, **kwargs)
            self.close_calls = 0
            self.__class__.created_clients.append(self)

        async def aclose(self) -> None:
            self.close_calls += 1
            await super().aclose()

    monkeypatch.setattr(shellctl_sdk.httpx, "AsyncClient", TrackingAsyncClient)
    close_client = ShellctlClient(
        "http://127.0.0.1:8765",
        transport=httpx.MockTransport(handler),
    )
    direct_owned_client = TrackingAsyncClient.created_clients[-1]
    await close_client.close()
    assert direct_owned_client.close_calls == 1

    async with ShellctlClient(
        "http://127.0.0.1:8765",
        transport=httpx.MockTransport(handler),
    ) as context_client:
        context_owned_client = TrackingAsyncClient.created_clients[-1]
        await context_client.healthz()

    assert context_owned_client.close_calls == 1


@pytest.mark.anyio
async def test_shellctl_client_list_jobs_uses_query_params_and_auth() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/v1/jobs"
        assert request.url.params["status"] == "running"
        assert request.url.params["limit"] == "5"
        assert request.headers["authorization"] == "Bearer secret"
        return httpx.Response(
            200,
            json={
                "jobs": [
                    {
                        "job_id": "job-1",
                        "status": "running",
                        "created_at": "2026-05-21T15:30:12Z",
                    }
                ]
            },
        )

    transport = httpx.MockTransport(handler)
    async with ShellctlClient("http://127.0.0.1:8765", token="secret", transport=transport) as client:
        result = await client.list_jobs(status="running", limit=5)

    assert len(result) == 1
    assert result[0].job_id == "job-1"
    assert result[0].status == JobStatusName.RUNNING


@pytest.mark.anyio
async def test_shellctl_client_wait_uses_body_and_omits_auth_without_token() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/v1/jobs/job-1/wait"
        assert "authorization" not in request.headers
        assert json.loads(request.content.decode("utf-8")) == {
            "offset": 3,
            "timeout": 9.0,
            "output_limit": 2048,
            "idle_flush_seconds": 0.1,
        }
        return httpx.Response(
            200,
            json={
                "job_id": "job-1",
                "done": False,
                "status": "running",
                "exit_code": None,
                "output_path": "/tmp/wait.log",
                "output": "chunk",
                "offset": 8,
                "truncated": False,
            },
        )

    transport = httpx.MockTransport(handler)
    async with ShellctlClient(
        "http://127.0.0.1:8765",
        output_limit=2048,
        idle_flush_seconds=0.1,
        transport=transport,
    ) as client:
        result = await client.wait("job-1", offset=3, timeout=9)

    assert result.job_id == "job-1"
    assert result.offset == 8
    assert result.output == "chunk"


@pytest.mark.anyio
async def test_shellctl_client_input_uses_body_and_auth() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/v1/jobs/job-1/input"
        assert request.headers["authorization"] == "Bearer secret"
        assert json.loads(request.content.decode("utf-8")) == {
            "text": "ls\n",
            "offset": 5,
            "timeout": 4.0,
            "output_limit": 512,
            "idle_flush_seconds": 0.0,
        }
        return httpx.Response(
            200,
            json={
                "job_id": "job-1",
                "done": False,
                "status": "running",
                "exit_code": None,
                "output_path": "/tmp/input.log",
                "output": "reply",
                "offset": 10,
                "truncated": False,
            },
        )

    transport = httpx.MockTransport(handler)
    async with ShellctlClient(
        "http://127.0.0.1:8765",
        output_limit=512,
        idle_flush_seconds=0.0,
        token="secret",
        transport=transport,
    ) as client:
        result = await client.input("job-1", "ls\n", offset=5, timeout=4)

    assert result.output == "reply"
    assert result.offset == 10


@pytest.mark.anyio
async def test_shellctl_client_terminate_uses_body_and_auth() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/v1/jobs/job-1/terminate"
        assert request.headers["authorization"] == "Bearer secret"
        assert json.loads(request.content.decode("utf-8")) == {"grace_seconds": 0.25}
        return httpx.Response(
            200,
            json={
                "job_id": "job-1",
                "status": "terminated",
                "done": True,
                "created_at": "2026-05-21T15:30:12Z",
                "started_at": "2026-05-21T15:30:13Z",
                "ended_at": "2026-05-21T15:30:18Z",
                "offset": 12,
            },
        )

    transport = httpx.MockTransport(handler)
    async with ShellctlClient("http://127.0.0.1:8765", token="secret", transport=transport) as client:
        result = await client.terminate("job-1", 0.25)

    assert result.status == JobStatusName.TERMINATED
    assert result.done is True


@pytest.mark.anyio
async def test_shellctl_client_delete_uses_query_params_and_auth() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "DELETE"
        assert request.url.path == "/v1/jobs/job-1"
        assert request.url.params["force"] == "true"
        assert request.url.params["grace_seconds"] == "0.5"
        assert request.headers["authorization"] == "Bearer secret"
        return httpx.Response(200, json={"job_id": "job-1", "deleted": True})

    transport = httpx.MockTransport(handler)
    async with ShellctlClient("http://127.0.0.1:8765", token="secret", transport=transport) as client:
        result = await client.delete("job-1", force=True, grace_seconds=0.5)

    assert result.job_id == "job-1"
    assert result.deleted is True


@pytest.mark.anyio
async def test_shellctl_client_raises_structured_errors() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409,
            json={"error": {"code": "job_not_running", "message": "already done"}},
        )

    transport = httpx.MockTransport(handler)
    async with ShellctlClient("http://127.0.0.1:8765", token="secret", transport=transport) as client:
        with pytest.raises(ShellctlClientError, match="job_not_running"):
            await client.input("job-1", "ls\n", offset=0)


@pytest.mark.anyio
async def test_shellctl_client_does_not_close_injected_client() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "ok"})

    class TrackingAsyncClient(httpx.AsyncClient):
        def __init__(self) -> None:
            super().__init__(
                base_url="http://127.0.0.1:8765",
                transport=httpx.MockTransport(handler),
            )
            self.close_calls = 0

        async def aclose(self) -> None:
            self.close_calls += 1
            await super().aclose()

    injected_client = TrackingAsyncClient()

    async with ShellctlClient(
        "http://127.0.0.1:8765",
        client=injected_client,
    ) as client:
        await client.healthz()

    assert injected_client.close_calls == 0
    await injected_client.aclose()
    assert injected_client.close_calls == 1


@pytest.mark.anyio
async def test_shellctl_client_raises_invalid_json_errors() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "application/json"},
            content=b"{",
        )

    transport = httpx.MockTransport(handler)
    async with ShellctlClient("http://127.0.0.1:8765", transport=transport) as client:
        with pytest.raises(ShellctlClientError) as exc_info:
            await client.status("job-1")

    assert exc_info.value.code == "invalid_json"
    assert exc_info.value.message == "{"


@pytest.mark.anyio
async def test_shellctl_client_raises_invalid_payload_errors() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=["not", "a", "dict"])

    transport = httpx.MockTransport(handler)
    async with ShellctlClient("http://127.0.0.1:8765", transport=transport) as client:
        with pytest.raises(ShellctlClientError) as exc_info:
            await client.healthz()

    assert exc_info.value.code == "invalid_payload"
    assert exc_info.value.message == '["not","a","dict"]'


@pytest.mark.anyio
async def test_shellctl_client_health_returns_model_and_healthz_stays_compatible() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/healthz"
        return httpx.Response(200, json={"status": "ok"})

    transport = httpx.MockTransport(handler)
    async with ShellctlClient("http://127.0.0.1:8765", transport=transport) as client:
        health = await client.health()
        healthz = await client.healthz()

    assert health == HealthResponse(status="ok")
    assert healthz == {"status": "ok"}
