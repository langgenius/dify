from types import SimpleNamespace

import pytest

from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.tool_manager import ToolManager
from extensions import ext_application_services
from graphon.nodes.tool.exc import ToolRuntimeResolutionError
from services.end_user_connection_runtime_adapters import get_tool_runtime
from tests.helpers.end_user_api_key import plugin_provider
from tests.helpers.workflow_test_credentials import SCOPE, BuilderCredentialHarness, tool_node


def test_debugger_injects_workspace_test_credential_without_personal_context(monkeypatch: pytest.MonkeyPatch) -> None:
    graph = {"nodes": [tool_node("a")]}
    harness = BuilderCredentialHarness(graph)
    provider = plugin_provider(SCOPE.tenant_id)
    monkeypatch.setattr(
        ext_application_services,
        "application_services",
        lambda: SimpleNamespace(workflow_test_credentials=harness.service),
    )
    monkeypatch.setattr(ToolManager, "get_builtin_provider", lambda *_: provider)
    captured = []

    def complete_runtime(*_args: object, tool_runtime: Tool, **_kwargs: object) -> Tool:
        captured.append(tool_runtime)
        return tool_runtime

    monkeypatch.setattr(ToolManager, "get_workflow_tool_runtime", complete_runtime)
    spec = SimpleNamespace(
        provider_type=ToolProviderType.BUILT_IN, provider_id="vendor/calendar/calendar", tool_name="read"
    )
    context = DifyRunContext(
        tenant_id=SCOPE.tenant_id,
        app_id=SCOPE.app_id,
        user_id=SCOPE.account_id,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )
    tool = get_tool_runtime(
        run_context=context, workflow_id="workflow", graph=graph, node_id="a", spec=spec, variable_pool=None
    )
    assert tool is captured[0]
    assert tool.runtime.credential_id == "credential"
    assert tool.runtime.connection_id is None
    assert tool.runtime.credentials == {"access_token": "secret"}
    assert tool.runtime.user_id == SCOPE.account_id
    assert graph["nodes"][0]["data"]["credential_source"] == "end_user"


@pytest.mark.parametrize(
    ("invoke_from", "user_from"),
    [
        (InvokeFrom.WEB_APP, UserFrom.END_USER),
        (InvokeFrom.SERVICE_API, UserFrom.END_USER),
        (InvokeFrom.EXPLORE, UserFrom.ACCOUNT),
        (InvokeFrom.DEBUGGER, UserFrom.END_USER),
    ],
)
def test_non_builder_execution_never_uses_test_credential(invoke_from: InvokeFrom, user_from: UserFrom) -> None:
    graph = {"nodes": [tool_node("a")]}
    spec = SimpleNamespace(
        provider_type=ToolProviderType.BUILT_IN, provider_id="vendor/calendar/calendar", tool_name="read"
    )
    context = DifyRunContext(
        tenant_id=SCOPE.tenant_id,
        app_id=SCOPE.app_id,
        user_id=SCOPE.account_id,
        user_from=user_from,
        invoke_from=invoke_from,
    )
    with pytest.raises(ToolRuntimeResolutionError):
        get_tool_runtime(
            run_context=context, workflow_id="workflow", graph=graph, node_id="a", spec=spec, variable_pool=None
        )
