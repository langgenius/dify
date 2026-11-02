"""Credential composition tests for the canonical tool runtime manager."""

from collections.abc import Generator
from typing import Never
from unittest.mock import create_autospec, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeFrom, ToolProviderType
from models.tool_runtime_contracts import WorkflowToolQueries
from services.credentials.refresh import CredentialRefreshUnavailableError
from services.tools.provider_queries import ToolProviders
from services.tools.tool_manager import ToolManager


@pytest.fixture(autouse=True)
def _restore_credential_resolver() -> Generator[None]:
    previous = ToolManager._credential_resolver
    try:
        yield
    finally:
        ToolManager._credential_resolver = previous


def _credentialed_controller(tool: BuiltinTool) -> BuiltinToolProviderController:
    controller = create_autospec(BuiltinToolProviderController, instance=True, need_credentials=True)
    controller.get_tool.return_value = tool
    return controller


def test_builtin_runtime_uses_configured_serialized_credential_resolver() -> None:
    tool = create_autospec(BuiltinTool, instance=True)
    forked_tool = create_autospec(BuiltinTool, instance=True)
    tool.fork_tool_runtime.return_value = forked_tool
    calls: list[tuple[BuiltinToolProviderController, str, str, str | None]] = []

    def resolver(
        *,
        controller: BuiltinToolProviderController,
        provider_id: str,
        workspace_id: str,
        credential_id: str | None,
    ) -> tuple[dict[str, str], CredentialType]:
        calls.append((controller, provider_id, workspace_id, credential_id))
        return {"access_token": "refreshed"}, CredentialType.OAUTH2

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
            tool_providers=create_autospec(ToolProviders, instance=True),
            workflow_queries=create_autospec(WorkflowToolQueries, instance=True),
        )

    assert result is forked_tool
    assert calls == [(controller, "time", "workspace", None)]
    runtime = tool.fork_tool_runtime.call_args.kwargs["runtime"]
    assert runtime.credentials == {"access_token": "refreshed"}
    assert runtime.credential_type == CredentialType.OAUTH2
    assert runtime.user_id == "user"
    assert runtime.invoke_from == InvokeFrom.WEB_APP
    assert runtime.tool_invoke_from == ToolInvokeFrom.WORKFLOW


def test_builtin_runtime_preserves_refresh_coordination_unavailable_error() -> None:
    tool = create_autospec(BuiltinTool, instance=True)

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
            tool_providers=create_autospec(ToolProviders, instance=True),
            workflow_queries=create_autospec(WorkflowToolQueries, instance=True),
        )
