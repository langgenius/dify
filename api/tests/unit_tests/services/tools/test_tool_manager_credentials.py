"""Credential composition tests for the canonical tool runtime manager."""

from collections.abc import Generator
from types import SimpleNamespace
from typing import Never
from unittest.mock import Mock, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.entities.tool_entities import ToolInvokeFrom, ToolProviderType
from services.credentials.refresh import CredentialRefreshUnavailableError
from services.tools.tool_manager import ToolManager


@pytest.fixture(autouse=True)
def _restore_credential_resolver() -> Generator[None]:
    previous = ToolManager._credential_resolver
    try:
        yield
    finally:
        ToolManager._credential_resolver = previous


def _credentialed_controller(tool: Mock) -> SimpleNamespace:
    return SimpleNamespace(get_tool=Mock(return_value=tool), need_credentials=True)


def test_builtin_runtime_uses_configured_serialized_credential_resolver() -> None:
    tool = Mock()
    tool.fork_tool_runtime.return_value = "runtime-tool"
    resolver = Mock(return_value=({"access_token": "refreshed"}, CredentialType.OAUTH2))
    controller = _credentialed_controller(tool)
    ToolManager.configure_credential_resolver(resolver)

    with patch.object(ToolManager, "get_builtin_provider", return_value=controller):
        result = ToolManager.get_tool_runtime(
            provider_type=ToolProviderType.BUILT_IN,
            provider_id="time",
            tool_name="weekday",
            tenant_id="workspace",
            user_id="user",
            invoke_from=InvokeFrom.WEB_APP,
            tool_invoke_from=ToolInvokeFrom.WORKFLOW,
            credential_id="not-a-plugin-credential-id",
            tool_providers=Mock(),
            workflow_queries=Mock(),
        )

    assert result == "runtime-tool"
    resolver.assert_called_once_with(
        controller=controller,
        provider_id="time",
        workspace_id="workspace",
        credential_id=None,
    )
    runtime = tool.fork_tool_runtime.call_args.kwargs["runtime"]
    assert runtime.credentials == {"access_token": "refreshed"}
    assert runtime.credential_type == CredentialType.OAUTH2
    assert runtime.user_id == "user"
    assert runtime.invoke_from == InvokeFrom.WEB_APP
    assert runtime.tool_invoke_from == ToolInvokeFrom.WORKFLOW


def test_builtin_runtime_preserves_refresh_coordination_unavailable_error() -> None:
    tool = Mock()

    def unavailable(**_kwargs: object) -> Never:
        raise CredentialRefreshUnavailableError

    ToolManager.configure_credential_resolver(unavailable)
    with (
        patch.object(ToolManager, "get_builtin_provider", return_value=_credentialed_controller(tool)),
        pytest.raises(CredentialRefreshUnavailableError),
    ):
        ToolManager.get_tool_runtime(
            provider_type=ToolProviderType.BUILT_IN,
            provider_id="time",
            tool_name="weekday",
            tenant_id="workspace",
            tool_providers=Mock(),
            workflow_queries=Mock(),
        )
