from __future__ import annotations

from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

from core.helper.code_executor import code_executor as code_executor_module


def test_execute_workflow_code_template_raises_for_unsupported_language() -> None:
    with pytest.raises(code_executor_module.CodeExecutionError, match="Unsupported language"):
        code_executor_module.CodeExecutor.execute_workflow_code_template(cast(Any, "ruby"), "print(1)", {})


def test_execute_workflow_code_template_uses_transformer(mocker: MockerFixture) -> None:
    transformer = MagicMock()
    transformer.transform_caller.return_value = ("runner-script", "preload-script")
    transformer.transform_response.return_value = {"result": "ok"}
    execute_mock = mocker.patch.object(
        code_executor_module.CodeExecutor,
        "execute_code",
        return_value='<<RESULT>>{"result":"ok"}<<RESULT>>',
    )
    mocker.patch.dict(code_executor_module.CodeExecutor.code_template_transformers, {"fake": transformer}, clear=False)

    result = code_executor_module.CodeExecutor.execute_workflow_code_template(cast(Any, "fake"), "code", {"a": 1})

    assert result == {"result": "ok"}
    transformer.transform_caller.assert_called_once_with("code", {"a": 1})
    execute_mock.assert_called_once_with("fake", "preload-script", "runner-script")


def test_execute_code_raises_service_unavailable_for_503(mocker: MockerFixture) -> None:
    response = MagicMock()
    response.status_code = 503
    client = MagicMock()
    client.post.return_value = response
    mocker.patch("core.helper.code_executor.code_executor.get_pooled_http_client", return_value=client)

    with pytest.raises(code_executor_module.CodeExecutionError, match="service is unavailable"):
        code_executor_module.CodeExecutor.execute_code(cast(Any, "python3"), preload="", code="print(1)")


def test_execute_code_returns_stdout_on_success(mocker: MockerFixture) -> None:
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {"code": 0, "message": "ok", "data": {"stdout": "done", "error": None}}
    client = MagicMock()
    client.post.return_value = response
    mocker.patch("core.helper.code_executor.code_executor.get_pooled_http_client", return_value=client)

    assert code_executor_module.CodeExecutor.execute_code(cast(Any, "python3"), preload="", code="print(1)") == "done"


def test_execute_code_raises_for_non_200_status(mocker: MockerFixture) -> None:
    response = MagicMock()
    response.status_code = 500
    client = MagicMock()
    client.post.return_value = response
    mocker.patch("core.helper.code_executor.code_executor.get_pooled_http_client", return_value=client)

    with pytest.raises(code_executor_module.CodeExecutionError, match="likely a network issue"):
        code_executor_module.CodeExecutor.execute_code(cast(Any, "python3"), preload="", code="print(1)")


def test_execute_code_raises_when_client_post_fails(mocker: MockerFixture) -> None:
    client = MagicMock()
    client.post.side_effect = RuntimeError("timeout")
    mocker.patch("core.helper.code_executor.code_executor.get_pooled_http_client", return_value=client)

    with pytest.raises(code_executor_module.CodeExecutionError, match="likely a network issue"):
        code_executor_module.CodeExecutor.execute_code(cast(Any, "python3"), preload="", code="print(1)")


def test_execute_code_raises_when_response_json_is_invalid(mocker: MockerFixture) -> None:
    response = MagicMock()
    response.status_code = 200
    response.json.side_effect = ValueError("bad json")
    client = MagicMock()
    client.post.return_value = response
    mocker.patch("core.helper.code_executor.code_executor.get_pooled_http_client", return_value=client)

    with pytest.raises(code_executor_module.CodeExecutionError, match="Failed to parse response"):
        code_executor_module.CodeExecutor.execute_code(cast(Any, "python3"), preload="", code="print(1)")


def test_execute_code_raises_when_sandbox_returns_error_code(mocker: MockerFixture) -> None:
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {"code": 1, "message": "boom", "data": {"stdout": "", "error": None}}
    client = MagicMock()
    client.post.return_value = response
    mocker.patch("core.helper.code_executor.code_executor.get_pooled_http_client", return_value=client)

    with pytest.raises(code_executor_module.CodeExecutionError, match="Got error code: 1"):
        code_executor_module.CodeExecutor.execute_code(cast(Any, "python3"), preload="", code="print(1)")


def test_execute_code_raises_when_response_contains_runtime_error(mocker: MockerFixture) -> None:
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {"code": 0, "message": "ok", "data": {"stdout": "", "error": "runtime failed"}}
    client = MagicMock()
    client.post.return_value = response
    mocker.patch("core.helper.code_executor.code_executor.get_pooled_http_client", return_value=client)

    with pytest.raises(code_executor_module.CodeExecutionError, match="runtime failed"):
        code_executor_module.CodeExecutor.execute_code(cast(Any, "python3"), preload="", code="print(1)")


# Regression tests for #40603: the upstream proxy (typically nginx in front
# of the sandbox) can return transient 502 / 503 / 504 responses. Without
# retries, those leak to the user as "sandbox is unavailable" even when
# the sandbox is healthy. The retry loop should retry on the transient
# status codes and surface the real error only when every attempt
# fails.
def _make_client(responses: list[int]) -> MagicMock:
    """Return a client that yields each `responses` value in order."""
    client = MagicMock()
    iter_responses = iter(responses)

    def _post(*_args, **_kwargs):
        status = next(iter_responses)
        resp = MagicMock()
        resp.status_code = status
        if status == 200:
            resp.json.return_value = {"code": 0, "message": "ok", "data": {"stdout": "done", "error": None}}
        return resp

    client.post.side_effect = _post
    return client


def test_execute_code_retries_transient_502_then_succeeds(mocker: MockerFixture) -> None:
    """A first 502 from the upstream proxy should be retried and the
    eventual 200 should be returned normally, no error leaked to the
    caller. Regression for #40603."""
    client = _make_client([502, 200])
    mocker.patch("core.helper.code_executor.code_executor.get_pooled_http_client", return_value=client)

    assert code_executor_module.CodeExecutor.execute_code(
        cast(Any, "python3"), preload="", code="print(1)"
    ) == "done"
    assert client.post.call_count == 2


def test_execute_code_retries_transient_503_then_succeeds(mocker: MockerFixture) -> None:
    client = _make_client([503, 200])
    mocker.patch("core.helper.code_executor.code_executor.get_pooled_http_client", return_value=client)

    assert code_executor_module.CodeExecutor.execute_code(
        cast(Any, "python3"), preload="", code="print(1)"
    ) == "done"
    assert client.post.call_count == 2


def test_execute_code_raises_when_persistent_502_exhausts_retries(mocker: MockerFixture) -> None:
    """If the upstream proxy keeps returning 502 after every retry, the
    final error should mention that the sandbox may be down so the user
    knows where to look. Regression for #40603."""
    client = _make_client([502, 502, 502, 502])
    mocker.patch("core.helper.code_executor.code_executor.get_pooled_http_client", return_value=client)

    with pytest.raises(code_executor_module.CodeExecutionError, match="sandbox service is running"):
        code_executor_module.CodeExecutor.execute_code(
            cast(Any, "python3"), preload="", code="print(1)"
        )
    # Default retry count is 1, so the total attempts is 2
    # (initial + 1 retry).
    assert client.post.call_count == 2


def test_execute_code_does_not_retry_persistent_500(mocker: MockerFixture) -> None:
    """A 500 from the sandbox itself isn't transient — don't burn
    retries on it. Regression for #40603 (retry only the proxy 502/503/504
    envelope, not arbitrary 5xx)."""
    client = _make_client([500])
    mocker.patch("core.helper.code_executor.code_executor.get_pooled_http_client", return_value=client)

    with pytest.raises(code_executor_module.CodeExecutionError, match="likely a network issue"):
        code_executor_module.CodeExecutor.execute_code(
            cast(Any, "python3"), preload="", code="print(1)"
        )
    assert client.post.call_count == 1


def test_execute_code_retry_count_zero_disables_retries(mocker: MockerFixture) -> None:
    mocker.patch.object(
        code_executor_module.dify_config, "CODE_EXECUTION_PROXY_RETRY_COUNT", 0
    )
    client = _make_client([502, 200])
    mocker.patch("core.helper.code_executor.code_executor.get_pooled_http_client", return_value=client)

    with pytest.raises(code_executor_module.CodeExecutionError, match="sandbox service is running"):
        code_executor_module.CodeExecutor.execute_code(
            cast(Any, "python3"), preload="", code="print(1)"
        )
    assert client.post.call_count == 1
