from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from contextlib import ExitStack
from typing import Any, Never, cast

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
            mocker.patch("services.code_execution.transport.get_pooled_http_client", return_value=client)
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


class RecordingTransport:
    def __init__(self, response: str) -> None:
        self.response = response
        self.calls: list[dict[str, str]] = []

    def execute(self, *, language: str, preload: str, code: str) -> str:
        self.calls.append({"language": language, "preload": preload, "code": code})
        return self.response


@pytest.mark.parametrize(
    ("language", "running_language"),
    [
        (code_executor_module.CodeLanguage.PYTHON3, "python3"),
        (code_executor_module.CodeLanguage.JAVASCRIPT, "nodejs"),
        (code_executor_module.CodeLanguage.JINJA2, "python3"),
    ],
)
def test_injected_execute_code_uses_exact_payload_without_ordinary_resolution(
    language: code_executor_module.CodeLanguage, running_language: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    from configs import dify_config
    from services.code_execution import transport as transport_module

    def forbidden(*_args: object, **_kwargs: object) -> Never:
        pytest.fail("Injected execution resolved ordinary configuration or HTTP client")

    monkeypatch.setattr(type(dify_config), "__getattribute__", forbidden)
    monkeypatch.setattr(transport_module, "get_pooled_http_client", forbidden)
    monkeypatch.setattr(transport_module, "_build_code_executor_client", forbidden)
    transport = RecordingTransport("raw output")

    assert (
        code_executor_module.CodeExecutor.execute_code(language, "preload", "source", transport=transport)
        == "raw output"
    )
    assert transport.calls == [{"language": running_language, "preload": "preload", "code": "source"}]


@pytest.mark.parametrize(
    ("language", "code", "response", "expected"),
    [
        (
            code_executor_module.CodeLanguage.PYTHON3,
            "def main(a): return {'result': a}",
            '{"result":"ok"}',
            {"result": "ok"},
        ),
        (
            code_executor_module.CodeLanguage.JAVASCRIPT,
            "function main({a}) { return {result: a}; }",
            '{"result":42}',
            {"result": 42},
        ),
        (
            code_executor_module.CodeLanguage.JINJA2,
            '{{ a | upper }}\n"quoted"',
            'OK\n"quoted"',
            {"result": 'OK\n"quoted"'},
        ),
    ],
)
def test_injected_workflow_runs_actual_transformer_roundtrip(
    language: code_executor_module.CodeLanguage,
    code: str,
    response: str,
    expected: dict[str, Any],
    mocker: MockerFixture,
) -> None:
    import re
    from base64 import b64decode, b64encode

    transformer = code_executor_module.CodeExecutor.code_template_transformers[language]
    transform = mocker.spy(transformer, "transform_caller")
    transport = RecordingTransport(f"noise\n<<RESULT>>{response}<<RESULT>>\n")
    result = code_executor_module.CodeExecutor.execute_workflow_code_template(
        language, code, {"a": "ok"}, transport=transport
    )

    assert result == expected
    assert len(transport.calls) == 1
    call = transport.calls[0]
    assert call["language"] == ("nodejs" if language == code_executor_module.CodeLanguage.JAVASCRIPT else "python3")
    transform.assert_called_once_with(code, {"a": "ok"})
    runner, preload = transform.spy_return
    assert call["code"] == runner
    assert call["preload"] == preload
    input_pattern = (
        r"Buffer.from\('([^']+)', 'base64'\)"
        if language == code_executor_module.CodeLanguage.JAVASCRIPT
        else r"inputs_obj = json.loads\(b64decode\('([^']+)'\)"
    )
    encoded_inputs = re.search(input_pattern, call["code"])
    assert encoded_inputs is not None
    assert json.loads(b64decode(encoded_inputs.group(1))) == {"a": "ok"}
    if language == code_executor_module.CodeLanguage.JINJA2:
        assert code not in call["code"]
        assert b64encode(code.encode()).decode() in call["code"]
        assert "from jinja2.sandbox import SandboxedEnvironment" in call["code"]
        assert "return template.render(**inputs)" in call["code"]
        assert "_jinja2_preload_()" in call["preload"]
    else:
        assert code in call["code"]
        assert call["preload"] == ""
        assert (
            "output_obj = main(**inputs_obj)"
            if language == code_executor_module.CodeLanguage.PYTHON3
            else "var output_obj = main(inputs_obj)"
        ) in call["code"]


def test_injected_private_control_base_exception_propagates_unchanged() -> None:
    class PrivateControl(BaseException):
        pass

    control = PrivateControl("stop")

    class StoppingTransport:
        def execute(self, *, language: str, preload: str, code: str) -> str:
            assert (language, preload) == ("python3", "")
            assert "def main(): pass" in code
            raise control

    with pytest.raises(PrivateControl) as caught:
        code_executor_module.CodeExecutor.execute_workflow_code_template(
            code_executor_module.CodeLanguage.PYTHON3, "def main(): pass", {}, transport=StoppingTransport()
        )
    assert caught.value is control


def test_concurrent_injected_transports_do_not_cross_scopes() -> None:
    from concurrent.futures import ThreadPoolExecutor
    from dataclasses import dataclass
    from threading import Barrier

    barrier = Barrier(2)

    @dataclass(frozen=True)
    class ScopedTransport:
        scope: str

        def execute(self, *, language: str, preload: str, code: str) -> str:
            barrier.wait(timeout=5)
            assert code == self.scope
            assert preload == f"preload-{self.scope}"
            assert language == "python3"
            return self.scope

    def run(scope: str) -> str:
        return code_executor_module.CodeExecutor.execute_code(
            code_executor_module.CodeLanguage.PYTHON3, f"preload-{scope}", scope, transport=ScopedTransport(scope)
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(run, scope) for scope in ("tenant-a", "tenant-b")]
        assert [future.result(timeout=10) for future in futures] == ["tenant-a", "tenant-b"]


def test_injected_transport_does_not_bypass_unsupported_language() -> None:
    transport = RecordingTransport("unused")
    with pytest.raises(code_executor_module.CodeExecutionError, match="Unsupported language ruby"):
        code_executor_module.CodeExecutor.execute_code(cast(Any, "ruby"), "", "", transport=transport)
    assert transport.calls == []
