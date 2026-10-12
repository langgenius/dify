"""Fresh draft admission at native owners, independently of Enterprise RBAC.

A dispatch sentinel replaces only the final generator/engine boundary. Real
SQLite draft/credential rows and plugin declarations feed every denial. Removing
the setup description cannot supply permission; setting up the same row can.
"""

import json
from datetime import datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker

import services.app_generate_service as generate_module
import services.workflow_service as workflow_module
from core.app.entities.app_invoke_entities import InvokeFrom
from models.account import Account
from models.credential_permission import CredentialPermission, CredentialType
from models.enums import EndUserType, PermissionEnum
from models.model import App, AppMode, EndUser
from models.workflow import Workflow, WorkflowType
from services.app_generate_service import AppGenerateService
from services.workflow_service import WorkflowService
from tests.unit_tests.services.dify_builder.draft_tool_inventory import (
    APP_ID,
    AUTH_PROVIDER,
    DRAFT_ID,
    FREE_PROVIDER,
)
from tests.unit_tests.services.dify_builder.draft_tool_inventory import (
    draft_tools as installed_draft_tools,
)
from tests.unit_tests.services.dify_builder.installed_tool_inventory import (
    ACCOUNT_A,
    ACCOUNT_B,
    OTHER_TENANT_ID,
    SECRET_MARKER,
    TENANT_ID,
    add_credential,
    record_sql,
)

draft_tools = installed_draft_tools


class NativeDispatchReachedError(AssertionError):
    """Baseline behavioral RED: native dispatch occurred before setup admission."""


def dispatch(*args, **kwargs):  # noqa: ARG001
    raise NativeDispatchReachedError("native generator/engine reached before draft Tool setup admission")


class LocalRateLimit:
    """External Redis concurrency boundary only; executes the real action."""

    def __init__(self, *args):
        pass

    @staticmethod
    def gen_request_key():
        return "draft-setup-test"

    def enter(self, request_id):
        return request_id

    def exit(self, request_id):
        pass

    def generate(self, generator, request_id):  # noqa: ARG002
        return generator


@pytest.fixture
def native_draft(draft_tools, sqlite_session, monkeypatch, config_overrides):
    config_overrides(DEPLOYMENT_EDITION="COMMUNITY")
    monkeypatch.setattr(generate_module, "RateLimit", LocalRateLimit)
    monkeypatch.setattr(workflow_module.SystemFeatureService, "is_plugin_manager_enabled", lambda: False)
    # Sending publication signals may enqueue external tasks. Preserve actual
    # graph validation, version allocation, ORM creation, and agent ownership.
    monkeypatch.setattr(workflow_module.app_published_workflow_was_updated, "send", lambda *_args, **_kwargs: None)
    app = App(
        id=APP_ID,
        tenant_id=TENANT_ID,
        name="Draft tools",
        description="",
        mode=AppMode.WORKFLOW,
        enable_api=True,
        enable_site=True,
        max_active_requests=0,
    )
    user = Account(name="Acting member", email="actor@example.test")
    user.id = ACCOUNT_A
    graph = {
        "nodes": [
            {"id": "s", "type": "custom", "data": {"type": "start", "title": "Start", "variables": []}},
            {
                "id": "t",
                "type": "custom",
                "data": {
                    "type": "tool",
                    "title": "Post to Huddle",
                    "provider_id": AUTH_PROVIDER,
                    "provider_name": AUTH_PROVIDER,
                    "provider_type": "builtin",
                    "tool_name": "post",
                    "tool_label": "Post to Huddle",
                    "tool_parameters": {"message": {"type": "mixed", "value": "hello"}},
                    "tool_configurations": {},
                    "desc": "Builder reminder: configure credentials before testing or publishing.",
                },
            },
            {"id": "e", "type": "custom", "data": {"type": "end", "title": "End", "outputs": []}},
        ],
        "edges": [{"id": "e1", "source": "s", "target": "t"}, {"id": "e2", "source": "t", "target": "e"}],
    }
    workflow = Workflow(
        id=DRAFT_ID,
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        type=WorkflowType.WORKFLOW,
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps(graph),
        features="{}",
        created_by=ACCOUNT_B,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    sqlite_session.add_all([app, workflow])
    sqlite_session.commit()
    return SimpleNamespace(app=app, user=user, workflow=workflow, tools=draft_tools)


def set_tool(case, session, **values):
    graph = case.workflow.graph_dict
    graph["nodes"][1]["data"].update(values)
    case.workflow.graph = json.dumps(graph)
    session.commit()


ENTRYPOINTS = [
    "workflow-full",
    "chat-full",
    "workflow-iteration",
    "chat-iteration",
    "workflow-loop",
    "chat-loop",
    "node",
]


def nest_tool_in_container(case, session, kind):
    """Use a real container id and enclosing Tool rather than a nonexistent node."""
    graph = case.workflow.graph_dict
    tool = next(node for node in graph["nodes"] if node["id"] == "t")
    tool["parentId"] = "container"
    tool["data"].update({f"isIn{kind.title()}": True, f"{kind}_id": "container"})
    container_data = {
        "type": kind,
        "title": kind.title(),
        "start_node_id": "containerstart",
        "error_handle_mode": "terminated",
        "is_parallel": False,
    }
    if kind == "iteration":
        graph["nodes"][0]["data"]["variables"] = [
            {"variable": "items", "label": "Items", "type": "json_object", "required": True}
        ]
        container_data.update({"iterator_selector": ["s", "items"], "output_selector": ["t", "text"]})
    else:
        container_data.update({"loop_count": 1, "break_conditions": [], "logical_operator": "and"})
    graph["nodes"] = [
        graph["nodes"][0],
        {"id": "container", "type": "custom", "data": container_data},
        {
            "id": "containerstart",
            "type": f"custom-{kind}-start",
            "parentId": "container",
            "data": {"type": f"{kind}-start", "title": "Start"},
        },
        tool,
        next(node for node in graph["nodes"] if node["id"] == "e"),
    ]
    graph["edges"] = [
        {"id": "outer-in", "source": "s", "target": "container"},
        {"id": "inner", "source": "containerstart", "target": "t"},
        {"id": "outer-out", "source": "container", "target": "e"},
    ]
    case.workflow.graph = json.dumps(graph)
    session.commit()


def invoke(case, session, monkeypatch, entrypoint, *, invoke_from=InvokeFrom.DEBUGGER):
    """Call the real request owner through its SQL workflow lookup."""
    if entrypoint == "publish":
        return WorkflowService(sessionmaker(bind=case.tools.engine)).publish_workflow(
            session=session,
            app_model=case.app,
            account=case.user,
        )
    case.app.mode = AppMode.ADVANCED_CHAT if entrypoint.startswith("chat-") else AppMode.WORKFLOW
    session.commit()
    for generator in (generate_module.WorkflowAppGenerator, generate_module.AdvancedChatAppGenerator):
        for method in ("generate", "single_iteration_generate", "single_loop_generate"):
            monkeypatch.setattr(generator, method, dispatch)
    monkeypatch.setattr(workflow_module.WorkflowEntry, "single_step_run", dispatch)
    if entrypoint == "node":
        return WorkflowService(sessionmaker(bind=case.tools.engine)).run_draft_workflow_node(
            case.app,
            case.workflow,
            "t",
            {},
            case.user,
        )
    if entrypoint.endswith("iteration"):
        nest_tool_in_container(case, session, "iteration")
        return AppGenerateService.generate_single_iteration(
            case.app,
            case.user,
            "container",
            {"inputs": {}},
            session=session,
            streaming=False,
        )
    if entrypoint.endswith("loop"):
        from controllers.console.app.workflow import LoopNodeRunPayload

        nest_tool_in_container(case, session, "loop")
        return AppGenerateService.generate_single_loop(
            case.app,
            case.user,
            "container",
            LoopNodeRunPayload(inputs={}),
            session=session,
            streaming=False,
        )
    return AppGenerateService.generate(
        case.app,
        case.user,
        {"inputs": {}, "query": "hello"},
        invoke_from,
        session=session,
        streaming=False,
        workflow_execution_mode="in_process",
    )


@pytest.mark.parametrize("entrypoint", ENTRYPOINTS)
@pytest.mark.parametrize("description", ["", "User removed or changed the reminder; ready now!"])
def test_draft_execution_without_credentials_refuses_before_native_dispatch_even_without_note(
    native_draft,
    sqlite_session,
    monkeypatch,
    entrypoint,
    description,
):
    set_tool(native_draft, sqlite_session, desc=description)
    with pytest.raises(ValueError):
        invoke(native_draft, sqlite_session, monkeypatch, entrypoint)
    assert native_draft.tools.forbidden == []


@pytest.mark.parametrize("entrypoint", [*ENTRYPOINTS, "publish"])
@pytest.mark.parametrize("hidden_selection", ["default", "oldest", "legacy-short-default"])
def test_native_default_hidden_credential_is_not_replaced_by_some_visible_credential(
    native_draft,
    sqlite_session,
    monkeypatch,
    entrypoint,
    hidden_selection,
):
    hidden = add_credential(
        sqlite_session,
        tenant_id=TENANT_ID,
        provider="huddle" if hidden_selection == "legacy-short-default" else AUTH_PROVIDER,
        user_id=ACCOUNT_B,
        visibility=PermissionEnum.ONLY_ME,
        name="Hidden native selection",
    )
    hidden.is_default = hidden_selection != "oldest"
    hidden.created_at = datetime(2026, 10, 1)
    visible = add_credential(
        sqlite_session,
        tenant_id=TENANT_ID,
        provider=AUTH_PROVIDER,
        user_id=ACCOUNT_A,
        name="Actor-visible alternative",
    )
    visible.is_default = False
    visible.created_at = datetime(2026, 10, 2)
    sqlite_session.commit()
    assert native_draft.tools.queries.list_visible_tool_provider_ids(workspace_id=TENANT_ID, actor_id=ACCOUNT_A) == {
        AUTH_PROVIDER
    }
    with pytest.raises(ValueError):
        invoke(native_draft, sqlite_session, monkeypatch, entrypoint)
    assert hidden.id != visible.id
    assert native_draft.tools.forbidden == []


@pytest.mark.parametrize("selection", ["hidden", "foreign", "wrong-provider", "deleted", "revoked-grant", "malformed"])
@pytest.mark.parametrize("operation", ["workflow-full", "node", "publish"])
def test_exact_selected_credential_requires_the_complete_actor_provider_tenant_chain(
    native_draft,
    sqlite_session,
    monkeypatch,
    selection,
    operation,
):
    credential = add_credential(
        sqlite_session,
        tenant_id=OTHER_TENANT_ID if selection == "foreign" else TENANT_ID,
        provider=FREE_PROVIDER if selection == "wrong-provider" else AUTH_PROVIDER,
        user_id=ACCOUNT_B if selection in ("hidden", "revoked-grant") else ACCOUNT_A,
        visibility=PermissionEnum.PARTIAL_TEAM if selection == "revoked-grant" else PermissionEnum.ONLY_ME,
    )
    credential_id = credential.id
    if selection == "deleted":
        sqlite_session.delete(credential)
        sqlite_session.commit()
    elif selection == "malformed":
        credential_id = "not-a-credential-id"
    elif selection == "revoked-grant":
        sqlite_session.add(
            CredentialPermission(
                credential_id=credential_id,
                credential_type=CredentialType.BUILTIN_TOOL_PROVIDER,
                account_id=ACCOUNT_A,
                tenant_id=TENANT_ID,
                has_permission=False,
            )
        )
        sqlite_session.commit()
    set_tool(native_draft, sqlite_session, credential_id=credential_id, desc="")
    with pytest.raises(ValueError) as refused:
        invoke(native_draft, sqlite_session, monkeypatch, operation)
    assert SECRET_MARKER not in str(refused.value)
    assert native_draft.tools.forbidden == []


@pytest.mark.parametrize("entrypoint", ENTRYPOINTS)
@pytest.mark.parametrize("configured", ["explicit", "default", "credential-free"])
def test_configured_and_credential_free_drafts_reach_native_dispatch_without_removing_the_note(
    native_draft,
    sqlite_session,
    monkeypatch,
    entrypoint,
    configured,
):
    if configured == "credential-free":
        set_tool(native_draft, sqlite_session, provider_id=FREE_PROVIDER, provider_name=FREE_PROVIDER, tool_name="echo")
    else:
        credential = add_credential(
            sqlite_session,
            tenant_id=TENANT_ID,
            provider=AUTH_PROVIDER,
            user_id=ACCOUNT_A,
            name="Explicit actor credential",
        )
        if configured == "explicit":
            # An explicit authorized selection overrides the hidden default.
            credential.is_default = False
            sqlite_session.commit()
            add_credential(
                sqlite_session,
                tenant_id=TENANT_ID,
                provider=AUTH_PROVIDER,
                user_id=ACCOUNT_B,
                visibility=PermissionEnum.ONLY_ME,
                name="Hidden provider default",
            )
            set_tool(native_draft, sqlite_session, credential_id=credential.id)
    statements = record_sql(native_draft.tools.engine)
    with pytest.raises(NativeDispatchReachedError):
        invoke(native_draft, sqlite_session, monkeypatch, entrypoint)
    assert not [s for s in statements if "encrypted_credentials" in s]
    assert native_draft.tools.forbidden == []


def test_setup_enables_the_same_stored_draft_without_regeneration(native_draft, sqlite_session, monkeypatch):
    graph_before = native_draft.workflow.graph
    with pytest.raises(ValueError):
        invoke(native_draft, sqlite_session, monkeypatch, "workflow-full")
    add_credential(sqlite_session, tenant_id=TENANT_ID, provider=AUTH_PROVIDER, user_id=ACCOUNT_A)
    with pytest.raises(NativeDispatchReachedError):
        invoke(native_draft, sqlite_session, monkeypatch, "workflow-full")
    assert native_draft.workflow.id == DRAFT_ID
    assert native_draft.workflow.graph == graph_before
    assert native_draft.tools.forbidden == []


@pytest.mark.parametrize(
    "failure", ["credential-query", "declaration-query", "uninstalled", "unknown-action", "foreign-installation"]
)
@pytest.mark.parametrize("operation", [*ENTRYPOINTS, "publish"])
def test_fresh_query_or_installation_uncertainty_refuses_draft_admission(
    native_draft,
    sqlite_session,
    monkeypatch,
    failure,
    operation,
):
    add_credential(sqlite_session, tenant_id=TENANT_ID, provider=AUTH_PROVIDER, user_id=ACCOUNT_A)
    if failure == "credential-query":
        with native_draft.tools.engine.begin() as connection:
            connection.execute(text("DROP TABLE tool_builtin_providers"))
    elif failure == "declaration-query":
        native_draft.tools.daemon.fail_all = True
    elif failure == "uninstalled":
        native_draft.tools.daemon.installed_ids_by_tenant = {TENANT_ID: ["acme/free"]}
    elif failure == "unknown-action":
        set_tool(native_draft, sqlite_session, tool_name="not_installed")
    elif failure == "foreign-installation":
        set_tool(
            native_draft, sqlite_session, provider_id="foreign/huddle/huddle", provider_name="foreign/huddle/huddle"
        )
    with pytest.raises(ValueError):
        invoke(native_draft, sqlite_session, monkeypatch, operation)
    assert native_draft.tools.forbidden == []


def test_publish_without_credentials_and_plugin_manager_disabled_creates_no_version_or_pointer(
    native_draft,
    sqlite_session: Session,
):
    service = WorkflowService(sessionmaker(bind=native_draft.tools.engine))
    before_pointer = native_draft.app.workflow_id
    with pytest.raises(ValueError):
        service.publish_workflow(session=sqlite_session, app_model=native_draft.app, account=native_draft.user)
    sqlite_session.flush()
    assert [row.version for row in sqlite_session.scalars(select(Workflow).where(Workflow.app_id == APP_ID))] == [
        "draft"
    ]
    # Signal receivers are isolated above: this assertion covers the service's
    # in-memory pointer only, not the normal signal-driven database update owner.
    assert native_draft.app.workflow_id == before_pointer
    assert native_draft.tools.forbidden == []


@pytest.mark.parametrize("configured", ["explicit", "default", "credential-free"])
def test_publish_configured_or_credential_free_draft_with_plugin_manager_disabled(
    native_draft,
    sqlite_session,
    configured,
):
    if configured == "credential-free":
        set_tool(native_draft, sqlite_session, provider_id=FREE_PROVIDER, provider_name=FREE_PROVIDER, tool_name="echo")
    else:
        row = add_credential(sqlite_session, tenant_id=TENANT_ID, provider=AUTH_PROVIDER, user_id=ACCOUNT_A)
        if configured == "explicit":
            set_tool(native_draft, sqlite_session, credential_id=row.id)
    statements = record_sql(native_draft.tools.engine)
    published = WorkflowService(sessionmaker(bind=native_draft.tools.engine)).publish_workflow(
        session=sqlite_session,
        app_model=native_draft.app,
        account=native_draft.user,
    )
    sqlite_session.flush()
    assert published.version != "draft"
    assert published.graph_dict == native_draft.workflow.graph_dict
    assert not [s for s in statements if "encrypted_credentials" in s]
    assert native_draft.tools.forbidden == []


@pytest.mark.parametrize("invoke_from", [InvokeFrom.SERVICE_API, InvokeFrom.WEB_APP])
def test_published_execution_keeps_normal_credential_delegation(native_draft, sqlite_session, monkeypatch, invoke_from):
    native_draft.workflow.version = "2026-10-12 12:00:00"
    native_draft.app.workflow_id = DRAFT_ID
    end_user = EndUser(
        id="eeeeeeee-0000-4000-8000-000000000001",
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        type=EndUserType.SERVICE_API if invoke_from == InvokeFrom.SERVICE_API else EndUserType.BROWSER,
        session_id="ffffffff-0000-4000-8000-000000000001",
        external_user_id="external-customer-1",
        name="External customer",
        is_anonymous=False,
    )
    sqlite_session.add(end_user)
    sqlite_session.commit()
    monkeypatch.setattr(generate_module.WorkflowAppGenerator, "generate", dispatch)
    with pytest.raises(NativeDispatchReachedError):
        AppGenerateService.generate(
            app_model=native_draft.app,
            user=end_user,
            args={"inputs": {}, "query": "hello"},
            invoke_from=invoke_from,
            session=sqlite_session,
            streaming=False,
            workflow_execution_mode="in_process",
        )
    assert native_draft.tools.forbidden == []
