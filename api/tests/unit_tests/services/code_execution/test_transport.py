from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from contextlib import ExitStack

import httpx
import pytest
from pydantic import ValidationError

from services.code_execution import transport as transport_module
from services.code_execution.contracts import CodeExecutionError, CodeExecutionResponse, CodeExecutionTransport


@pytest.fixture
def ordinary_client(
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[Callable[[httpx.Response | BaseException], list[httpx.Request]]]:
    with ExitStack() as stack:

        def install(result: httpx.Response | BaseException) -> list[httpx.Request]:
            requests: list[httpx.Request] = []

            def send(request: httpx.Request) -> httpx.Response:
                requests.append(request)
                if isinstance(result, BaseException):
                    raise result
                return result

            client = stack.enter_context(httpx.Client(transport=httpx.MockTransport(send)))

            def pooled(key: str, builder: Callable[[], httpx.Client]) -> httpx.Client:
                assert key == "code_executor:http_client"
                assert builder is transport_module._build_code_executor_client
                return client

            monkeypatch.setattr(transport_module, "get_pooled_http_client", pooled)
            return requests

        yield install


def execute() -> str:
    transport: CodeExecutionTransport = transport_module.OrdinaryCodeExecutionTransport()
    return transport.execute(language="nodejs", preload="preload", code="source")


def test_ordinary_request_retains_url_credentials_network_and_timeouts(
    ordinary_client: Callable[[httpx.Response | BaseException], list[httpx.Request]], monkeypatch: pytest.MonkeyPatch
) -> None:
    from yarl import URL

    monkeypatch.setattr(transport_module, "code_execution_endpoint_url", URL("https://sandbox.example/base"))
    settings = {
        "CODE_EXECUTION_API_KEY": "unit-test-key",
        "CODE_EXECUTION_CONNECT_TIMEOUT": 2.0,
        "CODE_EXECUTION_READ_TIMEOUT": 11.0,
        "CODE_EXECUTION_WRITE_TIMEOUT": 3.0,
    }
    for name, value in settings.items():
        monkeypatch.setattr(transport_module.dify_config, name, value)
    requests = ordinary_client(
        httpx.Response(200, json={"code": 0, "message": "ok", "data": {"stdout": "done", "error": None}})
    )

    assert execute() == "done"
    assert len(requests) == 1
    request = requests[0]
    assert request.method == "POST"
    assert str(request.url) == "https://sandbox.example/base/v1/sandbox/run"
    assert request.headers["X-Api-Key"] == "unit-test-key"
    assert json.loads(request.content) == {
        "language": "nodejs",
        "code": "source",
        "preload": "preload",
        "enable_network": True,
    }
    assert request.extensions["timeout"] == {"connect": 2.0, "read": 11.0, "write": 3.0, "pool": None}


def test_ordinary_factory_retains_tls_and_pool_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    observed: dict[str, object] = {}
    sentinel = object()

    def build(**kwargs: object) -> object:
        observed.update(kwargs)
        return sentinel

    monkeypatch.setattr(transport_module.httpx, "Client", build)
    assert transport_module._build_code_executor_client() is sentinel
    assert observed == {
        "verify": transport_module.CODE_EXECUTION_SSL_VERIFY,
        "limits": transport_module._CODE_EXECUTOR_CLIENT_LIMITS,
    }


@pytest.mark.parametrize(
    ("response", "message"),
    [
        (httpx.Response(503), "Code execution service is unavailable"),
        (
            httpx.Response(500),
            "Failed to execute code, which is likely a network issue,"
            " please check if the sandbox service is running."
            " ( Error: Failed to execute code, got status code 500,"
            " please check if the sandbox service is running )",
        ),
        (
            httpx.ConnectTimeout("timeout"),
            "Failed to execute code, which is likely a network issue,"
            " please check if the sandbox service is running. ( Error: timeout )",
        ),
        (httpx.Response(200, content=b"bad json"), "Failed to parse response"),
        (
            httpx.Response(200, json={"code": 1, "message": "boom", "data": {}}),
            "Got error code: 1. Got error msg: boom",
        ),
        (
            httpx.Response(
                200, json={"code": 0, "message": "ok", "data": {"stdout": "partial", "error": "runtime failed"}}
            ),
            "runtime failed",
        ),
    ],
)
def test_ordinary_failures_preserve_error_type_and_message(
    ordinary_client: Callable[[httpx.Response | BaseException], list[httpx.Request]],
    response: httpx.Response | BaseException,
    message: str,
) -> None:
    requests = ordinary_client(response)
    with pytest.raises(CodeExecutionError) as caught:
        execute()
    assert str(caught.value) == message
    assert len(requests) == 1


@pytest.mark.parametrize("data", [{}, {"stdout": None}, {"stdout": ""}])
def test_ordinary_empty_stdout_returns_empty_string(
    ordinary_client: Callable[[httpx.Response | BaseException], list[httpx.Request]], data: dict[str, object]
) -> None:
    ordinary_client(httpx.Response(200, json={"code": 0, "message": "ok", "data": data}))
    assert execute() == ""


@pytest.mark.parametrize(
    ("payload", "error_type"),
    [
        ([], AttributeError),
        ({"code": 0, "message": "ok"}, ValidationError),
        ({"code": 0, "message": "ok", "data": {"stdout": 42}}, ValidationError),
    ],
)
def test_ordinary_malformed_shape_retains_existing_failure_boundary(
    ordinary_client: Callable[[httpx.Response | BaseException], list[httpx.Request]],
    payload: object,
    error_type: type[Exception],
) -> None:
    ordinary_client(httpx.Response(200, json=payload))
    with pytest.raises(error_type):
        execute()


def test_ordinary_json_parse_retains_exception_cause(
    ordinary_client: Callable[[httpx.Response | BaseException], list[httpx.Request]],
) -> None:
    ordinary_client(httpx.Response(200, content=b"bad json"))
    with pytest.raises(CodeExecutionError) as caught:
        execute()
    assert isinstance(caught.value.__cause__, json.JSONDecodeError)


def test_core_error_and_response_exports_preserve_identity() -> None:
    from core.helper.code_executor import code_executor

    assert code_executor.CodeExecutionError is CodeExecutionError
    assert code_executor.CodeExecutionResponse is CodeExecutionResponse
