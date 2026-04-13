from __future__ import annotations

from collections.abc import Generator
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest
from graphon.model_runtime.entities.message_entities import UserPromptMessage

from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeMessage, ToolProviderType


class _BuiltinDummyTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        yield self.create_text_message("ok")


def _build_tool(user_id: str | None = None) -> _BuiltinDummyTool:
    entity = ToolEntity(
        identity=ToolIdentity(author="author", name="tool-a", label=I18nObject(en_US="tool-a"), provider="provider-a"),
        parameters=[],
    )
    runtime = ToolRuntime(tenant_id="tenant-1", user_id=user_id, invoke_from=InvokeFrom.DEBUGGER)
    return _BuiltinDummyTool(provider="provider-a", entity=entity, runtime=runtime)


def test_builtin_tool_fork_and_provider_type():
    tool = _build_tool()
    forked = tool.fork_tool_runtime(ToolRuntime(tenant_id="tenant-2"))
    assert isinstance(forked, _BuiltinDummyTool)
    assert forked.runtime.tenant_id == "tenant-2"
    assert tool.tool_provider_type() == ToolProviderType.BUILT_IN


def test_invoke_model_calls_model_invocation_utils_invoke():
    tool = _build_tool(user_id="runtime-user")
    with patch("core.tools.builtin_tool.tool.ModelInvocationUtils.invoke", return_value="result") as mock_invoke:
        assert (
            tool.invoke_model(
                user_id="u1",
                prompt_messages=[UserPromptMessage(content="hello")],
                stop=[],
            )
            == "result"
        )
    mock_invoke.assert_called_once_with(
        user_id="u1",
        tenant_id="tenant-1",
        tool_type=ToolProviderType.BUILT_IN,
        tool_name="tool-a",
        prompt_messages=[UserPromptMessage(content="hello")],
        caller_user_id="runtime-user",
    )


def test_get_max_tokens_returns_value():
    tool = _build_tool(user_id="runtime-user")
    with patch(
        "core.tools.builtin_tool.tool.ModelInvocationUtils.get_max_llm_context_tokens", return_value=4096
    ) as mock_get:
        assert tool.get_max_tokens() == 4096
    mock_get.assert_called_once_with(tenant_id="tenant-1", user_id="runtime-user")


def test_get_prompt_tokens_returns_value():
    tool = _build_tool(user_id="runtime-user")
    with patch("core.tools.builtin_tool.tool.ModelInvocationUtils.calculate_tokens", return_value=7) as mock_calculate:
        assert tool.get_prompt_tokens([UserPromptMessage(content="hello")]) == 7
    mock_calculate.assert_called_once_with(
        tenant_id="tenant-1",
        prompt_messages=[UserPromptMessage(content="hello")],
        user_id="runtime-user",
    )


def test_get_prompt_tokens_falls_back_to_tenant_scope_when_runtime_user_id_missing():
    tool = _build_tool()

    with patch("core.tools.builtin_tool.tool.ModelInvocationUtils.calculate_tokens", return_value=7) as mock_calculate:
        assert tool.get_prompt_tokens([UserPromptMessage(content="hello")]) == 7

    mock_calculate.assert_called_once_with(
        tenant_id="tenant-1",
        prompt_messages=[UserPromptMessage(content="hello")],
        user_id=None,
    )


def test_runtime_none_raises():
    tool = _build_tool()
    tool.runtime = None
    with pytest.raises(ValueError, match="runtime is required"):
        tool.get_max_tokens()
    with pytest.raises(ValueError, match="runtime is required"):
        tool.get_prompt_tokens([UserPromptMessage(content="hello")])


def test_builtin_tool_summary_short_and_long_content_paths():
    tool = _build_tool()

    with patch.object(_BuiltinDummyTool, "get_max_tokens", return_value=100):
        with patch.object(_BuiltinDummyTool, "get_prompt_tokens", return_value=10):
            assert tool.summary(user_id="u1", content="short") == "short"

    with patch.object(_BuiltinDummyTool, "get_max_tokens", return_value=10):
        with patch.object(
            _BuiltinDummyTool,
            "get_prompt_tokens",
            side_effect=lambda prompt_messages: len(prompt_messages[-1].content),
        ):
            with patch.object(
                _BuiltinDummyTool,
                "invoke_model",
                return_value=SimpleNamespace(message=SimpleNamespace(content="S")),
            ):
                result = tool.summary(user_id="u1", content="x" * 30 + "\n" + "y" * 5)

    assert result
    assert "S" in result
