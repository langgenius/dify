"""Unit tests for ModelInvocationUtils.

Covers success and error branches for ModelInvocationUtils, including
InvokeModelError and invoke error mappings for InvokeAuthorizationError,
InvokeBadRequestError, InvokeConnectionError, InvokeRateLimitError, and
InvokeServerUnavailableError. Real model instances supply validated schemas and
results, while invocation logging uses real SQLite-backed SQLAlchemy sessions.
"""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.model_manager import ModelManager
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.utils.model_invocation_utils import InvokeModelError, ModelInvocationUtils
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import ModelPropertyKey
from graphon.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from models.tools import ToolModelInvoke
from tests.helpers.unit.core.model_fixtures import make_model_config, make_model_instance

TENANT_ID = "11111111-1111-1111-1111-111111111111"
USER_ID = "22222222-2222-2222-2222-222222222222"
CALLER_ID = "33333333-3333-3333-3333-333333333333"


@pytest.mark.parametrize(
    ("model_exists", "properties", "expected", "error_match"),
    [
        (False, None, None, "Model not found"),
        (True, None, None, "No model schema found"),
        (True, {}, 2048, None),
        (True, {ModelPropertyKey.CONTEXT_SIZE: 8192}, 8192, None),
    ],
    ids=[
        "missing-model",
        "missing-schema",
        "default-context-size",
        "schema-context-size",
    ],
)
def test_get_max_llm_context_tokens_branches(
    model_exists: bool,
    properties: dict[ModelPropertyKey, object] | None,
    expected: int | None,
    error_match: str | None,
) -> None:
    manager = ModelManager.for_tenant("tenant", user_id="user-1")
    model_instance = make_model_instance(provider="provider", model="model-a")
    schema = make_model_config(provider="provider", model="model-a", mode="chat").model_schema
    if properties is not None:
        schema.model_properties = properties

    with (
        patch("core.tools.utils.model_invocation_utils.ModelManager.for_tenant", return_value=manager) as mock_factory,
        patch.object(manager, "get_default_model_instance", return_value=model_instance if model_exists else None),
        patch.object(
            model_instance.model_type_instance,
            "get_model_schema",
            return_value=schema if properties is not None else None,
        ),
    ):
        if error_match:
            with pytest.raises(InvokeModelError, match=error_match):
                ModelInvocationUtils.get_max_llm_context_tokens("tenant", user_id="user-1")
        else:
            assert ModelInvocationUtils.get_max_llm_context_tokens("tenant", user_id="user-1") == expected

    mock_factory.assert_called_once_with(tenant_id="tenant", user_id="user-1")


def test_calculate_tokens_handles_missing_model() -> None:
    manager = ModelManager.for_tenant("tenant")
    with (
        patch("core.tools.utils.model_invocation_utils.ModelManager.for_tenant", return_value=manager) as mock_factory,
        patch.object(manager, "get_default_model_instance", return_value=None),
    ):
        with pytest.raises(InvokeModelError, match="Model not found"):
            ModelInvocationUtils.calculate_tokens("tenant", [])
    mock_factory.assert_called_once_with(tenant_id="tenant", user_id=None)


def test_invoke_success_and_error_mappings(sqlite_session_factory: sessionmaker[Session]) -> None:
    model_instance = make_model_instance(provider="provider", model="model-a")
    result = LLMResult(
        model="model-a",
        message=AssistantPromptMessage(content="ok"),
        usage=LLMUsage(
            prompt_tokens=5,
            prompt_unit_price=Decimal(0),
            prompt_price_unit=Decimal(1),
            prompt_price=Decimal(0),
            completion_tokens=7,
            completion_unit_price=Decimal("0.1"),
            completion_price_unit=Decimal(1),
            completion_price=Decimal("0.7"),
            total_tokens=12,
            latency=0.3,
            total_price=Decimal("0.7"),
            currency="USD",
        ),
    )
    manager = ModelManager.for_tenant(TENANT_ID, user_id=CALLER_ID)

    responses_seen_during_call: list[str] = []

    def _invoke_llm(**_kwargs: object) -> LLMResult:
        # The log row must already be committed by its own session before the model call starts.
        with sqlite_session_factory() as observer_session:
            pending = observer_session.scalar(select(ToolModelInvoke))
            assert pending is not None
            responses_seen_during_call.append(pending.model_response)
        return result

    with (
        patch("core.tools.utils.model_invocation_utils.ModelManager.for_tenant", return_value=manager) as mock_factory,
        patch.object(manager, "get_default_model_instance", return_value=model_instance),
        patch.object(model_instance, "get_llm_num_tokens", return_value=5),
        patch.object(model_instance, "invoke_llm", side_effect=_invoke_llm),
    ):
        response = ModelInvocationUtils.invoke(
            user_id=USER_ID,
            tenant_id=TENANT_ID,
            tool_type=ToolProviderType.BUILT_IN,
            tool_name="tool-a",
            prompt_messages=[],
            caller_user_id=CALLER_ID,
            session_maker=sqlite_session_factory,
        )

    assert response.message.content == "ok"
    assert responses_seen_during_call == [""]
    with sqlite_session_factory() as observer_session:
        persisted = observer_session.scalar(select(ToolModelInvoke))
        assert persisted is not None
        assert persisted.user_id == USER_ID
        assert persisted.tenant_id == TENANT_ID
        assert persisted.tool_type == ToolProviderType.BUILT_IN
        assert persisted.model_response == "ok"
        assert persisted.prompt_tokens == 5
        assert persisted.answer_tokens == 7
        assert persisted.total_price == Decimal("0.7000000")
    mock_factory.assert_called_once_with(tenant_id=TENANT_ID, user_id=CALLER_ID)


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
def test_invoke_error_mappings(
    exc: Exception, expected: str, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    model_instance = make_model_instance(provider="provider", model="model-a")
    manager = ModelManager.for_tenant(TENANT_ID, user_id=USER_ID)

    with (
        patch("core.tools.utils.model_invocation_utils.ModelManager.for_tenant", return_value=manager) as mock_factory,
        patch.object(manager, "get_default_model_instance", return_value=model_instance),
        patch.object(model_instance, "get_llm_num_tokens", return_value=5),
        patch.object(model_instance, "invoke_llm", side_effect=exc),
    ):
        with pytest.raises(InvokeModelError, match=expected):
            ModelInvocationUtils.invoke(
                user_id=USER_ID,
                tenant_id=TENANT_ID,
                tool_type=ToolProviderType.BUILT_IN,
                tool_name="tool-a",
                prompt_messages=[],
                session_maker=sqlite_session_factory,
            )
    persisted = sqlite_session.scalar(select(ToolModelInvoke))
    assert persisted is not None
    assert persisted.model_response == ""
    assert persisted.prompt_tokens == 5
    assert persisted.answer_tokens == 0
    mock_factory.assert_called_once_with(tenant_id=TENANT_ID, user_id=USER_ID)
