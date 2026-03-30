from types import SimpleNamespace
from unittest.mock import patch

from graphon.model_runtime.entities.message_entities import UserPromptMessage

from core.plugin.backwards_invocation.model import PluginModelBackwardsInvocation
from core.plugin.entities.request import RequestInvokeSummary


def test_system_model_helpers_forward_user_id():
    with (
        patch(
            "core.plugin.backwards_invocation.model.ModelInvocationUtils.get_max_llm_context_tokens",
            return_value=4096,
        ) as mock_max_tokens,
        patch(
            "core.plugin.backwards_invocation.model.ModelInvocationUtils.calculate_tokens",
            return_value=7,
        ) as mock_prompt_tokens,
    ):
        assert PluginModelBackwardsInvocation.get_system_model_max_tokens("tenant-1", user_id="user-1") == 4096
        assert (
            PluginModelBackwardsInvocation.get_prompt_tokens(
                "tenant-1",
                [UserPromptMessage(content="hello")],
                user_id="user-1",
            )
            == 7
        )

    mock_max_tokens.assert_called_once_with(tenant_id="tenant-1", user_id="user-1")
    mock_prompt_tokens.assert_called_once_with(
        tenant_id="tenant-1",
        prompt_messages=[UserPromptMessage(content="hello")],
        user_id="user-1",
    )


def test_invoke_summary_uses_same_user_scope_for_token_helpers():
    tenant = SimpleNamespace(id="tenant-1")
    payload = RequestInvokeSummary(text="short", instruction="keep it concise")

    with (
        patch.object(
            PluginModelBackwardsInvocation,
            "get_system_model_max_tokens",
            return_value=100,
        ) as mock_max_tokens,
        patch.object(
            PluginModelBackwardsInvocation,
            "get_prompt_tokens",
            return_value=10,
        ) as mock_prompt_tokens,
    ):
        assert PluginModelBackwardsInvocation.invoke_summary("user-1", tenant, payload) == "short"

    mock_max_tokens.assert_called_once_with(tenant_id="tenant-1", user_id="user-1")
    mock_prompt_tokens.assert_called_once_with(
        tenant_id="tenant-1",
        prompt_messages=[UserPromptMessage(content="short")],
        user_id="user-1",
    )
