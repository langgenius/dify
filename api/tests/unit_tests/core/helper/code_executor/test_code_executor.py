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
