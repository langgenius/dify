import json
from collections.abc import Callable
from dataclasses import replace
from datetime import datetime
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from constants.end_user_connections import ConnectionCredentialStatus
from context.connection_execution import ConnectionExecutionContext, ExecutionConnectionSelection
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.tools.entities.tool_entities import ToolParameter
from core.tools.tool_manager import ToolManager
from core.workflow.node_runtime import DifyToolNodeRuntime
from extensions import ext_application_services
from graphon.nodes.tool.entities import ToolNodeData
from graphon.nodes.tool.exc import ToolRuntimeResolutionError
from graphon.runtime import VariablePool
from models.end_user_connection import EndUserConnection
from models.model import App, EndUser
from models.tools import ToolOAuthTenantClient
from services import end_user_connection_runtime_adapters as adapters
from services.end_user_connections.contracts import UpdateConnectionInput
from services.end_user_connections.runtime import ConnectionRuntimeService
from tests.helpers.end_user_api_key import PROVIDER
from tests.helpers.end_user_oauth import OAuthHarness, make_oauth_harness


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> OAuthHarness:
    harness = make_oauth_harness(sqlite_session_factory, monkeypatch)
    service = ConnectionRuntimeService(
        store=harness.base.repository, checks=harness.base.service, cipher=harness.base.cipher
    )
    monkeypatch.setattr(adapters.session_factory, "get_session_maker", lambda: harness.base.sessions)
    monkeypatch.setattr(ToolManager, "get_builtin_provider", lambda *_args: harness.providers.controller)
    monkeypatch.setattr(
        ext_application_services, "application_services", lambda: SimpleNamespace(end_user_connection_runtime=service)
    )
    return harness


def node_data(**updates: object) -> dict[str, object]:
    return {
        "type": "tool",
        "title": "Read",
        "provider_id": PROVIDER,
        "provider_name": PROVIDER,
        "provider_type": "builtin",
        "tool_name": "read",
        "tool_label": "Read",
        "tool_configurations": {},
        "tool_parameters": {},
        "credential_source": "end_user",
        "end_user_auth": {"allowed_credential_types": ["api-key", "oauth2"], "purpose": "Read calendar"},
        **updates,
    }


def context(harness: OAuthHarness, selections: dict[str, str]) -> DifyRunContext:
    identity = harness.base.context
    return DifyRunContext(
        tenant_id=identity.tenant_id,
        app_id=identity.app_id,
        user_id=identity.end_user_id,
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
        connection_context=ConnectionExecutionContext(
            tenant_id=identity.tenant_id,
            app_id=identity.app_id,
            end_user_id=identity.end_user_id,
            account_id=identity.account_id,
            workflow_id=harness.base.workflow_id,
            selections=tuple(
                ExecutionConnectionSelection(node_id=key, provider=PROVIDER, connection_id=value)
                for key, value in selections.items()
            ),
        ),
    )


def runtime(harness: OAuthHarness, selected: str) -> DifyToolNodeRuntime:
    return DifyToolNodeRuntime(
        context(harness, {"tool-1": selected}),
        workflow_id=harness.base.workflow_id,
        graph={"nodes": [{"id": "tool-1", "data": node_data()}]},
    )


def test_personal_tool_injects_selected_current_credentials_without_workspace_fallback(
    harness: OAuthHarness, mocker: MockerFixture
) -> None:
    selected = harness.base.service.create_api_key(harness.base.context, harness.base.command("selected-secret"))
    harness.base.service.create_api_key(harness.base.context, harness.base.command("unused-secret"))
    loader = runtime(harness, selected.id)
    workspace = mocker.spy(ToolManager, "get_tool_runtime")
    first = loader.get_runtime(node_id="tool-1", node_data=ToolNodeData.model_validate(node_data()), variable_pool=None)
    tool = loader._tool_from_handle(first)
    assert tool.runtime.credentials == {"api_key": "selected-secret"}
    assert tool.runtime.connection_id == selected.id
    assert "selected-secret" not in repr(tool.runtime)
    assert "connection_id" not in tool.runtime.model_dump()
    harness.base.service.update_connection(
        harness.base.context, selected.id, UpdateConnectionInput(credentials={"api_key": "replacement-secret"})
    )
    second = loader.get_runtime(
        node_id="tool-1", node_data=ToolNodeData.model_validate(node_data()), variable_pool=None
    )
    assert loader._tool_from_handle(second).runtime.credentials == {"api_key": "replacement-secret"}
    assert tool.runtime.credentials == {"api_key": "selected-secret"}
    workspace.assert_not_called()


@pytest.mark.parametrize("failure", ["deleted", "invalid", "reauthorize", "owner", "provider"])
def test_unusable_personal_connection_fails_without_fallback(
    harness: OAuthHarness, mocker: MockerFixture, failure: str
) -> None:
    selected = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    loader = runtime(harness, selected.id)
    with harness.base.sessions.begin() as session:
        row = session.get(EndUserConnection, selected.id)
        assert row is not None
        if failure == "deleted":
            session.delete(row)
        elif failure == "invalid":
            row.status = ConnectionCredentialStatus.INVALID
        elif failure == "reauthorize":
            row.status = ConnectionCredentialStatus.RECONNECT_REQUIRED
        elif failure == "owner":
            row.account_id = "different-owner"
        else:
            row.provider = "other/provider"
    workspace = mocker.spy(ToolManager, "get_tool_runtime")
    with pytest.raises(ToolRuntimeResolutionError):
        loader.get_runtime(node_id="tool-1", node_data=ToolNodeData.model_validate(node_data()), variable_pool=None)
    workspace.assert_not_called()


def test_reuse_inherits_only_credentials_and_uses_the_run_graph(harness: OAuthHarness) -> None:
    selected = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    root = node_data(tool_configurations={"mode": {"type": "constant", "value": "root"}})
    child = node_data(
        credential_source="reuse_node",
        reuse_node_id="tool-1",
        tool_configurations={"mode": {"type": "constant", "value": "child"}},
    )
    child.pop("end_user_auth")
    graph = {"nodes": [{"id": "tool-1", "data": root}, {"id": "child", "data": child}]}
    assert harness.providers.controller.entity.tools is not None
    harness.providers.controller.entity.tools[0].parameters = [
        ToolParameter.model_validate(
            {
                "name": "mode",
                "label": {"en_US": "Mode"},
                "type": "string",
                "form": "form",
                "required": False,
            }
        )
    ]
    loader = DifyToolNodeRuntime(
        context(harness, {"tool-1": selected.id}), workflow_id=harness.base.workflow_id, graph=graph
    )
    with harness.base.sessions.begin() as session:
        app = session.get(App, harness.base.context.app_id)
        assert app is not None
        app.workflow_id = "new-publication"
    root["credential_source"] = "workspace"
    handle = loader.get_runtime(
        node_id="child", node_data=ToolNodeData.model_validate(child), variable_pool=VariablePool()
    )
    tool = loader._tool_from_handle(handle)
    assert tool.runtime.credentials == {"api_key": "original-secret"}
    assert tool.runtime.runtime_parameters == {"mode": "child"}


def test_independent_nodes_for_same_provider_keep_distinct_choices(harness: OAuthHarness) -> None:
    first = harness.base.service.create_api_key(harness.base.context, harness.base.command("first-secret"))
    second = harness.base.service.create_api_key(harness.base.context, harness.base.command("second-secret"))
    loader = DifyToolNodeRuntime(
        context(harness, {"tool-1": first.id, "tool-2": second.id}),
        workflow_id=harness.base.workflow_id,
        graph={"nodes": [{"id": key, "data": node_data()} for key in ("tool-1", "tool-2")]},
    )
    for key, secret in [("tool-1", "first-secret"), ("tool-2", "second-secret")]:
        handle = loader.get_runtime(node_id=key, node_data=ToolNodeData.model_validate(node_data()), variable_pool=None)
        assert loader._tool_from_handle(handle).runtime.credentials == {"api_key": secret}


def test_guest_owned_connection_can_execute(harness: OAuthHarness, config_overrides: Callable[..., None]) -> None:
    config_overrides(END_USER_AUTH_ALLOW_ANONYMOUS=True)
    with harness.base.sessions.begin() as session:
        user = session.get(EndUser, harness.base.context.end_user_id)
        assert user is not None
        user.account_id = None
    harness.base.context = replace(harness.base.context, account_id=None)
    selected = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    loader = runtime(harness, selected.id)
    handle = loader.get_runtime(
        node_id="tool-1", node_data=ToolNodeData.model_validate(node_data()), variable_pool=None
    )
    assert loader._tool_from_handle(handle).runtime.credentials == {"api_key": "original-secret"}

    harness.base.auth.calls.clear()
    config_overrides(END_USER_AUTH_ALLOW_ANONYMOUS=False)
    with pytest.raises(ToolRuntimeResolutionError, match="Sign in to use personal connections"):
        loader.get_runtime(node_id="tool-1", node_data=ToolNodeData.model_validate(node_data()), variable_pool=None)
    assert harness.base.auth.calls == []


def test_oauth_refresh_preserves_connection_id_and_checks_current_client(harness: OAuthHarness) -> None:
    selected = harness.finish(harness.start())
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(EndUserConnection)
            .where(EndUserConnection.id == selected.id)
            .values(expires_at=datetime(2000, 1, 1))
        )
    loader = runtime(harness, selected.id)
    handle = loader.get_runtime(
        node_id="tool-1", node_data=ToolNodeData.model_validate(node_data()), variable_pool=None
    )
    tool = loader._tool_from_handle(handle)
    assert tool.runtime.credentials["access_token"] == "new-access-secret"
    assert len(harness.handler.refreshes) == 1
    assert tool.runtime.connection_id == selected.id
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(ToolOAuthTenantClient)
            .where(ToolOAuthTenantClient.id == harness.client_id)
            .values(encrypted_oauth_params=json.dumps({"client_id": "new-client"}))
        )
    with pytest.raises(ToolRuntimeResolutionError, match="OAuth client"):
        loader.get_runtime(node_id="tool-1", node_data=ToolNodeData.model_validate(node_data()), variable_pool=None)


@pytest.mark.parametrize("failure", ["tenant", "app", "user", "workflow", "debugger"])
def test_runtime_context_cannot_be_used_under_another_execution(harness: OAuthHarness, failure: str) -> None:
    selected = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    outer = context(harness, {"tool-1": selected.id})
    field = {"tenant": "tenant_id", "app": "app_id", "user": "user_id", "debugger": "invoke_from"}.get(failure)
    if field is not None:
        outer = outer.model_copy(update={field: InvokeFrom.DEBUGGER if failure == "debugger" else "other"})
    loader = DifyToolNodeRuntime(
        outer,
        workflow_id="other" if failure == "workflow" else harness.base.workflow_id,
        graph={"nodes": [{"id": "tool-1", "data": node_data()}]},
    )
    with pytest.raises(ToolRuntimeResolutionError, match="identity"):
        loader.get_runtime(node_id="tool-1", node_data=ToolNodeData.model_validate(node_data()), variable_pool=None)


def test_reuse_of_workspace_source_keeps_existing_resolution(harness: OAuthHarness, mocker: MockerFixture) -> None:
    from core.tools.__base.tool_runtime import ToolRuntime

    root = node_data(credential_source="workspace", credential_id="workspace-credential")
    root.pop("end_user_auth")
    child = node_data(credential_source="reuse_node", reuse_node_id="root")
    child.pop("end_user_auth")
    outer = context(harness, {}).model_copy(
        update={"connection_context": None, "invoke_from": InvokeFrom.DEBUGGER, "user_from": UserFrom.ACCOUNT}
    )
    tool = harness.providers.controller.get_tool("read").fork_tool_runtime(
        runtime=ToolRuntime(
            tenant_id=outer.tenant_id,
            credentials={"api_key": "workspace-secret"},
            credential_id="workspace-credential",
        )
    )
    workspace = mocker.patch.object(ToolManager, "get_tool_runtime", return_value=tool)
    loader = DifyToolNodeRuntime(
        outer,
        workflow_id=harness.base.workflow_id,
        graph={"nodes": [{"id": "root", "data": root}, {"id": "child", "data": child}]},
    )
    result = loader._tool_from_handle(
        loader.get_runtime(node_id="child", node_data=ToolNodeData.model_validate(child), variable_pool=None)
    )
    workspace.assert_called_once()
    assert workspace.call_args.kwargs["credential_id"] == "workspace-credential"
    assert result.runtime.credentials == {"api_key": "workspace-secret"}
    assert result.runtime.connection_id is None


@pytest.mark.parametrize("target", ["child", "missing", "chain"])
def test_invalid_reuse_is_a_node_error_without_fallback(
    harness: OAuthHarness, mocker: MockerFixture, target: str
) -> None:
    child = node_data(credential_source="reuse_node", reuse_node_id=target)
    child.pop("end_user_auth")
    chain = node_data(credential_source="reuse_node", reuse_node_id="root")
    chain.pop("end_user_auth")
    loader = DifyToolNodeRuntime(
        context(harness, {}),
        workflow_id=harness.base.workflow_id,
        graph={
            "nodes": [
                {"id": "root", "data": node_data()},
                {"id": "child", "data": child},
                {"id": "chain", "data": chain},
            ]
        },
    )
    workspace = mocker.spy(ToolManager, "get_tool_runtime")
    with pytest.raises(ToolRuntimeResolutionError):
        loader.get_runtime(node_id="child", node_data=ToolNodeData.model_validate(child), variable_pool=None)
    workspace.assert_not_called()


def test_replacement_during_decryption_is_not_injected(harness: OAuthHarness, monkeypatch: pytest.MonkeyPatch) -> None:
    selected = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    decrypt = harness.base.cipher.decrypt
    calls = 0

    def changing_decrypt(tenant_id: str, ciphertext: str) -> dict[str, object]:
        nonlocal calls
        calls += 1
        result = decrypt(tenant_id, ciphertext)
        if calls == 2:
            with harness.base.sessions.begin() as session:
                session.execute(
                    sa.update(EndUserConnection).where(EndUserConnection.id == selected.id).values(revision=2)
                )
        return result

    monkeypatch.setattr(harness.base.cipher, "decrypt", changing_decrypt)
    loader = runtime(harness, selected.id)
    with pytest.raises(ToolRuntimeResolutionError, match="changed"):
        loader.get_runtime(node_id="tool-1", node_data=ToolNodeData.model_validate(node_data()), variable_pool=None)


def test_actual_tool_cannot_differ_from_the_pinned_graph(harness: OAuthHarness) -> None:
    selected = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    loader = runtime(harness, selected.id)
    with pytest.raises(ToolRuntimeResolutionError, match="compatible"):
        loader.get_runtime(
            node_id="tool-1",
            node_data=ToolNodeData.model_validate(node_data(tool_name="different-action")),
            variable_pool=None,
        )


def test_deleted_connection_uses_normal_tool_node_failure(harness: OAuthHarness) -> None:
    from core.workflow.node_factory import DifyGraphInitContext, DifyNodeFactory
    from graphon.node_events import StreamCompletedEvent
    from graphon.runtime import RuntimeState

    selected = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    graph = {"nodes": [{"id": "tool-1", "data": node_data()}]}
    factory = DifyNodeFactory.from_graph_init_context(
        graph_init_context=DifyGraphInitContext(
            workflow_id=harness.base.workflow_id,
            graph_config=graph,
            run_context={"_dify": context(harness, {"tool-1": selected.id})},
            call_depth=0,
        ),
        runtime_state=RuntimeState(variable_pool=VariablePool(), start_at=0, workflow_id=harness.base.workflow_id),
    )
    node = factory.create_node({"id": "tool-1", "data": node_data()})
    node.bind_execution_id("node-execution")
    harness.base.service.delete_connection(harness.base.context, selected.id)
    events = list(node._run())
    assert len(events) == 1
    assert isinstance(events[0], StreamCompletedEvent)
    assert events[0].node_run_result.status == "failed"
    assert events[0].node_run_result.error_type == "ToolRuntimeResolutionError"
    assert "original-secret" not in repr(events)
