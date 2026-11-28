from dataclasses import replace

import pytest
from pytest_mock import MockerFixture

from constants.end_user_connections import CredentialCheckStatus
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.tool_manager import ToolManager
from core.workflow.node_runtime import _WorkflowToolRuntimeSpec
from extensions import ext_application_services
from extensions.ext_application_services import ApplicationServices
from graphon.nodes.tool.exc import ToolRuntimeResolutionError
from services.end_user_connection_runtime_adapters import get_tool_runtime
from tests.helpers.end_user_api_key import plugin_provider
from tests.helpers.workflow_test_credentials import SCOPE, BuilderCredentialHarness, tool_node

_SPEC = _WorkflowToolRuntimeSpec(
    provider_type=ToolProviderType.BUILT_IN,
    provider_id="vendor/calendar/calendar",
    tool_name="read",
    tool_configurations={},
)


def test_debugger_injects_workspace_test_credential_without_personal_context(
    monkeypatch: pytest.MonkeyPatch, application_service_graph: ApplicationServices
) -> None:
    graph = {"nodes": [tool_node("a")]}
    harness = BuilderCredentialHarness(graph)
    provider = plugin_provider(SCOPE.tenant_id)
    monkeypatch.setattr(
        ext_application_services,
        "application_services",
        lambda: replace(application_service_graph, workflow_test_credentials=harness.service),
    )
    monkeypatch.setattr(ToolManager, "get_builtin_provider", lambda *_: provider)
    captured = []

    def complete_runtime(*_args: object, tool_runtime: Tool, **_kwargs: object) -> Tool:
        captured.append(tool_runtime)
        return tool_runtime

    monkeypatch.setattr(ToolManager, "get_workflow_tool_runtime", complete_runtime)
    spec = _SPEC
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
    spec = _SPEC
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


def test_caller_without_a_connection_context_is_told_where_the_app_runs() -> None:
    """An OpenAPI run carries no connection context; the failure has to name the surface that can."""
    graph = {"nodes": [tool_node("a")]}
    spec = _SPEC
    context = DifyRunContext(
        tenant_id=SCOPE.tenant_id,
        app_id=SCOPE.app_id,
        user_id=SCOPE.account_id,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.OPENAPI,
    )

    with pytest.raises(ToolRuntimeResolutionError, match="Run the app from the WebApp"):
        get_tool_runtime(
            run_context=context, workflow_id="workflow", graph=graph, node_id="a", spec=spec, variable_pool=None
        )


def test_installed_app_resolves_workspace_selection_without_using_preview_credential(
    monkeypatch: pytest.MonkeyPatch, mocker: MockerFixture, application_service_graph: ApplicationServices
) -> None:
    from context.connection_execution import (
        ConnectionExecutionContext,
        ExecutionConnectionSelection,
        WorkspaceConnectionScope,
    )
    from services.workflow_test_credentials import ResolvedTestCredential, TestCredentialCheck

    graph = {"nodes": [tool_node("a", "preview-must-not-be-used")]}
    provider = plugin_provider(SCOPE.tenant_id)
    scope = WorkspaceConnectionScope(
        installed_app_id="installed", tenant_id=SCOPE.tenant_id, account_id=SCOPE.account_id
    )
    execution = ConnectionExecutionContext(
        tenant_id=SCOPE.tenant_id,
        app_id=SCOPE.app_id,
        end_user_id="",
        account_id=SCOPE.account_id,
        workflow_id="workflow",
        connection_revision="revision",
        workspace=scope,
        selections=(
            ExecutionConnectionSelection(node_id="a", provider="vendor/calendar/calendar", connection_id="selected"),
        ),
    )
    resolve = mocker.patch.object(
        application_service_graph.installed_apps.connections,
        "resolve",
        return_value=ResolvedTestCredential(
            "selected",
            "oauth2",
            {"access_token": "workspace-secret"},
            TestCredentialCheck(status=CredentialCheckStatus.VALID, reason_code=None, retryable=False),
        ),
    )
    monkeypatch.setattr(ext_application_services, "application_services", lambda: application_service_graph)
    monkeypatch.setattr(ToolManager, "get_builtin_provider", lambda *_: provider)
    monkeypatch.setattr(ToolManager, "get_workflow_tool_runtime", lambda *_args, tool_runtime, **_kwargs: tool_runtime)
    spec = _SPEC
    context = DifyRunContext(
        tenant_id=SCOPE.tenant_id,
        app_id=SCOPE.app_id,
        user_id=SCOPE.account_id,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.EXPLORE,
        connection_context=execution,
    )
    tool = get_tool_runtime(
        run_context=context, workflow_id="workflow", graph=graph, node_id="a", spec=spec, variable_pool=None
    )
    assert tool.runtime.credential_id == "selected"
    assert tool.runtime.connection_id is None
    assert tool.runtime.credentials == {"access_token": "workspace-secret"}
    assert tool.runtime.invoke_from == InvokeFrom.EXPLORE
    resolve.assert_called_once_with(execution, account_id=SCOPE.account_id, node_id="a", graph=graph)
