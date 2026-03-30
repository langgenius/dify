"""Unit tests for ModelInvocationUtils.

Covers success and error branches for ModelInvocationUtils, including
InvokeModelError and invoke error mappings for InvokeAuthorizationError,
InvokeBadRequestError, InvokeConnectionError, InvokeRateLimitError, and
InvokeServerUnavailableError. Assumes mocked model instances and managers.
"""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from graphon.model_runtime.entities.model_entities import ModelPropertyKey
from graphon.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)

from core.tools.utils.model_invocation_utils import InvokeModelError, ModelInvocationUtils


def _mock_model_instance(*, schema: dict | None = None) -> SimpleNamespace:
    model_type_instance = Mock()
    model_type_instance.get_model_schema.return_value = (
        SimpleNamespace(model_properties=schema or {}) if schema is not None else None
    )
    return SimpleNamespace(
        provider="provider",
        model="model-a",
        model_name="model-a",
        credentials={"api_key": "x"},
        model_type_instance=model_type_instance,
        get_llm_num_tokens=lambda prompt_messages: 5,
        invoke_llm=Mock(),
    )


@pytest.mark.parametrize(
    ("model_instance", "expected", "error_match"),
    [
        (None, None, "Model not found"),
        (_mock_model_instance(schema=None), None, "No model schema found"),
        (_mock_model_instance(schema={}), 2048, None),
        (_mock_model_instance(schema={ModelPropertyKey.CONTEXT_SIZE: 8192}), 8192, None),
    ],
    ids=[
        "missing-model",
        "missing-schema",
        "default-context-size",
        "schema-context-size",
    ],
)
def test_get_max_llm_context_tokens_branches(model_instance, expected, error_match):
    manager = Mock()
    manager.get_default_model_instance.return_value = model_instance

    with patch("core.tools.utils.model_invocation_utils.ModelManager.for_tenant", return_value=manager) as mock_factory:
        if error_match:
            with pytest.raises(InvokeModelError, match=error_match):
                ModelInvocationUtils.get_max_llm_context_tokens("tenant", user_id="user-1")
        else:
            assert ModelInvocationUtils.get_max_llm_context_tokens("tenant", user_id="user-1") == expected

    mock_factory.assert_called_once_with(tenant_id="tenant", user_id="user-1")


def test_calculate_tokens_handles_missing_model():
    manager = Mock()
    manager.get_default_model_instance.return_value = None
    with patch("core.tools.utils.model_invocation_utils.ModelManager.for_tenant", return_value=manager) as mock_factory:
        with pytest.raises(InvokeModelError, match="Model not found"):
            ModelInvocationUtils.calculate_tokens("tenant", [])
    mock_factory.assert_called_once_with(tenant_id="tenant", user_id=None)


def test_invoke_success_and_error_mappings():
    model_instance = _mock_model_instance(schema={ModelPropertyKey.CONTEXT_SIZE: 2048})
    model_instance.invoke_llm.return_value = SimpleNamespace(
        message=SimpleNamespace(content="ok"),
        usage=SimpleNamespace(
            completion_tokens=7,
            completion_unit_price=Decimal("0.1"),
            completion_price_unit=Decimal(1),
            latency=0.3,
            total_price=Decimal("0.7"),
            currency="USD",
        ),
    )
    manager = Mock()
    manager.get_default_model_instance.return_value = model_instance

    class _ToolModelInvoke:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    db_mock = SimpleNamespace(session=Mock())

    with patch("core.tools.utils.model_invocation_utils.ModelManager.for_tenant", return_value=manager) as mock_factory:
        with patch("core.tools.utils.model_invocation_utils.ToolModelInvoke", _ToolModelInvoke):
            with patch("core.tools.utils.model_invocation_utils.db", db_mock):
                response = ModelInvocationUtils.invoke(
                    user_id="u1",
                    tenant_id="tenant",
                    tool_type="builtin",
                    tool_name="tool-a",
                    prompt_messages=[],
                    caller_user_id="caller-1",
                )

    assert response.message.content == "ok"
    assert db_mock.session.add.call_count == 1
    assert db_mock.session.commit.call_count == 2
    mock_factory.assert_called_once_with(tenant_id="tenant", user_id="caller-1")


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (InvokeRateLimitError("rate"), "Invoke rate limit error"),
        (InvokeBadRequestError("bad"), "Invoke bad request error"),
        (InvokeConnectionError("conn"), "Invoke connection error"),
        (InvokeAuthorizationError("auth"), "Invoke authorization error"),
        (InvokeServerUnavailableError("down"), "Invoke server unavailable error"),
        (RuntimeError("oops"), "Invoke error"),
    ],
    ids=[
        "rate-limit",
        "bad-request",
        "connection",
        "authorization",
        "server-unavailable",
        "generic-error",
    ],
)
def test_invoke_error_mappings(exc, expected):
    model_instance = _mock_model_instance(schema={ModelPropertyKey.CONTEXT_SIZE: 2048})
    model_instance.invoke_llm.side_effect = exc
    manager = Mock()
    manager.get_default_model_instance.return_value = model_instance

    class _ToolModelInvoke:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    db_mock = SimpleNamespace(session=Mock())

    with patch("core.tools.utils.model_invocation_utils.ModelManager.for_tenant", return_value=manager) as mock_factory:
        with patch("core.tools.utils.model_invocation_utils.ToolModelInvoke", _ToolModelInvoke):
            with patch("core.tools.utils.model_invocation_utils.db", db_mock):
                with pytest.raises(InvokeModelError, match=expected):
                    ModelInvocationUtils.invoke(
                        user_id="u1",
                        tenant_id="tenant",
                        tool_type="builtin",
                        tool_name="tool-a",
                        prompt_messages=[],
                    )
    mock_factory.assert_called_once_with(tenant_id="tenant", user_id="u1")
