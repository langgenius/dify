from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from contextlib import ExitStack
from typing import Any, cast

import httpx
import pytest
from pytest_mock import MockerFixture

from core.helper.code_executor import code_executor as code_executor_module
from core.helper.code_executor.python3.python3_transformer import Python3TemplateTransformer


def test_execute_workflow_code_template_raises_for_unsupported_language() -> None:
    with pytest.raises(code_executor_module.CodeExecutionError, match="Unsupported language"):
        code_executor_module.CodeExecutor.execute_workflow_code_template(cast(Any, "ruby"), "print(1)", {})


@pytest.fixture
def sandbox_client(mocker: MockerFixture) -> Iterator[Callable[[httpx.Response | Exception], list[httpx.Request]]]:
    with ExitStack() as stack:

        def install(result: httpx.Response | Exception) -> list[httpx.Request]:
            requests: list[httpx.Request] = []

            def send(request: httpx.Request) -> httpx.Response:
                requests.append(request)
                if isinstance(result, Exception):
                    raise result
                return result

            client = stack.enter_context(httpx.Client(transport=httpx.MockTransport(send)))
            mocker.patch("core.helper.code_executor.code_executor.get_pooled_http_client", return_value=client)
            return requests

        yield install


def test_execute_workflow_code_template_uses_transformer(mocker: MockerFixture) -> None:
    transform = mocker.spy(Python3TemplateTransformer, "transform_caller")
    execute_mock = mocker.patch.object(
        code_executor_module.CodeExecutor,
        "execute_code",
        return_value='<<RESULT>>{"result":"ok"}<<RESULT>>',
    )
    code = "def main(a): return {'result': a}"
    language = code_executor_module.CodeLanguage.PYTHON3

    result = code_executor_module.CodeExecutor.execute_workflow_code_template(language, code, {"a": 1})

    assert result == {"result": "ok"}
    transform.assert_called_once_with(code, {"a": 1})
    runner, preload = transform.spy_return
    assert code in runner
    execute_mock.assert_called_once_with(language, preload, runner)


def test_execute_code_raises_service_unavailable_for_503(
    sandbox_client: Callable[[httpx.Response | Exception], list[httpx.Request]],
) -> None:
    sandbox_client(httpx.Response(503))

    with pytest.raises(code_executor_module.CodeExecutionError, match="service is unavailable"):
        code_executor_module.CodeExecutor.execute_code(
            code_executor_module.CodeLanguage.PYTHON3, preload="", code="print(1)"
        )


def test_execute_code_returns_stdout_on_success(
    sandbox_client: Callable[[httpx.Response | Exception], list[httpx.Request]],
) -> None:
    response = httpx.Response(200, json={"code": 0, "message": "ok", "data": {"stdout": "done", "error": None}})
    requests = sandbox_client(response)

    assert (
        code_executor_module.CodeExecutor.execute_code(
            code_executor_module.CodeLanguage.PYTHON3, preload="", code="print(1)"
        )
        == "done"
    )
    assert len(requests) == 1
    assert requests[0].method == "POST"
    assert requests[0].url.path == "/v1/sandbox/run"
    assert json.loads(requests[0].content) == {
        "language": "python3",
        "code": "print(1)",
        "preload": "",
        "enable_network": True,
    }


def test_execute_code_raises_for_non_200_status(
    sandbox_client: Callable[[httpx.Response | Exception], list[httpx.Request]],
) -> None:
    sandbox_client(httpx.Response(500))

    with pytest.raises(code_executor_module.CodeExecutionError, match="likely a network issue"):
        code_executor_module.CodeExecutor.execute_code(
            code_executor_module.CodeLanguage.PYTHON3, preload="", code="print(1)"
        )


def test_execute_code_raises_when_client_post_fails(
    sandbox_client: Callable[[httpx.Response | Exception], list[httpx.Request]],
) -> None:
    sandbox_client(httpx.ConnectTimeout("timeout"))

    with pytest.raises(code_executor_module.CodeExecutionError, match="likely a network issue"):
        code_executor_module.CodeExecutor.execute_code(
            code_executor_module.CodeLanguage.PYTHON3, preload="", code="print(1)"
        )


def test_execute_code_raises_when_response_json_is_invalid(
    sandbox_client: Callable[[httpx.Response | Exception], list[httpx.Request]],
) -> None:
    sandbox_client(httpx.Response(200, content=b"bad json"))

    with pytest.raises(code_executor_module.CodeExecutionError, match="Failed to parse response"):
        code_executor_module.CodeExecutor.execute_code(
            code_executor_module.CodeLanguage.PYTHON3, preload="", code="print(1)"
        )


def test_execute_code_raises_when_sandbox_returns_error_code(
    sandbox_client: Callable[[httpx.Response | Exception], list[httpx.Request]],
) -> None:
    response = httpx.Response(200, json={"code": 1, "message": "boom", "data": {"stdout": "", "error": None}})
    sandbox_client(response)

    with pytest.raises(code_executor_module.CodeExecutionError, match="Got error code: 1"):
        code_executor_module.CodeExecutor.execute_code(
            code_executor_module.CodeLanguage.PYTHON3, preload="", code="print(1)"
        )


def test_execute_code_raises_when_response_contains_runtime_error(
    sandbox_client: Callable[[httpx.Response | Exception], list[httpx.Request]],
) -> None:
    response = httpx.Response(200, json={"code": 0, "message": "ok", "data": {"stdout": "", "error": "runtime failed"}})
    sandbox_client(response)

    with pytest.raises(code_executor_module.CodeExecutionError, match="runtime failed"):
        code_executor_module.CodeExecutor.execute_code(
            code_executor_module.CodeLanguage.PYTHON3, preload="", code="print(1)"
        )
