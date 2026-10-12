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
from core.plugin.impl.oauth import OAuthHandler
from core.tools.tool_manager import ToolManager
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
# Preserve the production method before the metadata fixture forbids runtime use.
_NATIVE_TOOL_RUNTIME = ToolManager.get_tool_runtime.__func__
_NATIVE_OAUTH_REFRESH = OAuthHandler.refresh_credentials


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


@pytest.mark.parametrize("owner", ["console", "builder"])
def test_native_publish_owners_read_declarations_before_writes_or_draft_locks(
    native_draft,
    sqlite_session,
    monkeypatch,
    owner,
):
    """A real locked/write publication cannot perform external schema I/O."""
    from inspect import unwrap

    from sqlalchemy import event

    import controllers.console.app.workflow as console_owner
    import services.dify_builder.dify_port as builder_owner
    from core.dify_builder.models import Actor
    from services.dify_builder.revision import executable_graph_revision, execution_revision

    add_credential(sqlite_session, tenant_id=TENANT_ID, provider=AUTH_PROVIDER, user_id=ACCOUNT_A)
    sqlite_session.add(native_draft.user)
    sqlite_session.commit()
    database = SimpleNamespace(engine=native_draft.tools.engine)
    monkeypatch.setattr(console_owner, "db", database)
    monkeypatch.setattr(builder_owner, "db", database)
    guarded_sessions = set()
    write_connections = set()
    requests = []
    daemon_request = native_draft.tools.daemon.request

    def on_orm_execute(state):
        if (
            state.session.bind is native_draft.tools.engine
            and getattr(state.statement, "_for_update_arg", None) is not None
        ):
            guarded_sessions.add(state.session)

    def on_flush(session, _context, _instances):
        if session.bind is native_draft.tools.engine and (session.new or session.dirty or session.deleted):
            guarded_sessions.add(session)

    def on_end(session, transaction):
        if transaction.parent is None:
            guarded_sessions.discard(session)

    def on_sql(connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith(("INSERT ", "UPDATE ", "DELETE ")):
            write_connections.add(connection)

    def on_connection_end(connection):
        write_connections.discard(connection)

    def metadata_request(*args, **kwargs):
        assert not guarded_sessions, "external Tool declarations fetched during writes or a held draft lock"
        assert not write_connections, "external Tool declarations fetched inside an active SQL write transaction"
        requests.append(args)
        return daemon_request(*args, **kwargs)

    event.listen(Session, "do_orm_execute", on_orm_execute)
    event.listen(Session, "before_flush", on_flush)
    event.listen(Session, "after_transaction_end", on_end)
    event.listen(native_draft.tools.engine, "before_cursor_execute", on_sql)
    event.listen(native_draft.tools.engine, "commit", on_connection_end)
    event.listen(native_draft.tools.engine, "rollback", on_connection_end)
    monkeypatch.setattr(native_draft.tools.daemon, "request", metadata_request)
    try:
        if owner == "console":
            unwrap(console_owner.PublishedWorkflowApi.post)(
                console_owner.PublishedWorkflowApi(),
                args=console_owner.PublishWorkflowPayload(),
                current_user=native_draft.user,
                app_model=native_draft.app,
            )
        else:
            builder_owner.WorkflowServiceDifyPort().publish(
                APP_ID,
                Actor(account_id=ACCOUNT_A, tenant_id=TENANT_ID),
                expected_revision=execution_revision(native_draft.workflow),
                expected_graph_revision=executable_graph_revision(native_draft.workflow.graph_dict),
            )
        assert requests, "native publication never verified the actual installed Tool declaration"
        sqlite_session.expire_all()
        assert sqlite_session.get(App, APP_ID).workflow_id != DRAFT_ID
        assert sqlite_session.get(App, APP_ID).workflow_id is not None
        assert len(list(sqlite_session.scalars(select(Workflow).where(Workflow.app_id == APP_ID)))) == 2
        assert native_draft.tools.forbidden == []
    finally:
        event.remove(Session, "do_orm_execute", on_orm_execute)
        event.remove(Session, "before_flush", on_flush)
        event.remove(Session, "after_transaction_end", on_end)
        event.remove(native_draft.tools.engine, "before_cursor_execute", on_sql)
        event.remove(native_draft.tools.engine, "commit", on_connection_end)
        event.remove(native_draft.tools.engine, "rollback", on_connection_end)


@pytest.mark.parametrize("mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
def test_queued_draft_rechecks_revoked_selection_before_native_dispatch(
    native_draft,
    sqlite_session,
    monkeypatch,
    mode,
):
    """Request-time setup is not authorization after a queued credential revoke."""
    import tasks.app_generate.workflow_execute_task as worker

    credential = add_credential(
        sqlite_session,
        tenant_id=TENANT_ID,
        provider=AUTH_PROVIDER,
        user_id=ACCOUNT_B,
        visibility=PermissionEnum.PARTIAL_TEAM,
        partial_members=[ACCOUNT_A],
    )
    native_draft.app.mode = mode
    sqlite_session.add(native_draft.user)
    sqlite_session.commit()
    payload = worker.AppExecutionParams.new(
        app_model=native_draft.app,
        workflow=native_draft.workflow,
        user=native_draft.user,
        args={"inputs": {}, "query": "hello"},
        invoke_from=InvokeFrom.DEBUGGER,
        streaming=True,
    ).model_dump_json()
    grant = sqlite_session.scalar(
        select(CredentialPermission).where(CredentialPermission.credential_id == credential.id)
    )
    grant.has_permission = False
    sqlite_session.commit()
    monkeypatch.setattr(worker, "db", SimpleNamespace(engine=native_draft.tools.engine))
    monkeypatch.setattr(worker.WorkflowAppGenerator, "generate", dispatch)
    monkeypatch.setattr(worker.AdvancedChatAppGenerator, "generate", dispatch)
    monkeypatch.setattr(
        worker.MessageBasedAppGenerator,
        "get_response_topic",
        lambda *_args: SimpleNamespace(publish=lambda _value: None),
    )
    with pytest.raises(ValueError):
        worker.workflow_based_app_execution_task.run(payload)
    assert native_draft.tools.forbidden == []


@pytest.mark.parametrize("default", [True, False])
def test_ambiguous_native_default_cannot_mask_hidden_credential(native_draft, sqlite_session, monkeypatch, default):
    visible = add_credential(
        sqlite_session,
        tenant_id=TENANT_ID,
        provider=AUTH_PROVIDER,
        user_id=ACCOUNT_A,
        visibility=PermissionEnum.ONLY_ME,
        name="Visible tied native selection",
    )
    hidden = add_credential(
        sqlite_session,
        tenant_id=TENANT_ID,
        provider=AUTH_PROVIDER,
        user_id=ACCOUNT_B,
        visibility=PermissionEnum.ONLY_ME,
        name="Hidden tied native selection",
    )
    visible.is_default = hidden.is_default = default
    visible.created_at = hidden.created_at = datetime(2026, 1, 1)
    sqlite_session.commit()
    with pytest.raises(ValueError):
        invoke(native_draft, sqlite_session, monkeypatch, "workflow-full")
    # An explicit authorized choice removes the native ambiguity on this same node.
    set_tool(native_draft, sqlite_session, credential_id=visible.id)
    with pytest.raises(NativeDispatchReachedError):
        invoke(native_draft, sqlite_session, monkeypatch, "workflow-full")
    assert native_draft.tools.forbidden == []


def native_tool_node(case, *, workflow_id=None):
    """Construct the real Tool through the production native factory and scope."""
    from core.app.entities.app_invoke_entities import UserFrom, build_dify_run_context
    from core.workflow.node_factory import DifyGraphInitContext, DifyNodeFactory
    from graphon.runtime import GraphRuntimeState, VariablePool

    pool = VariablePool()
    factory = DifyNodeFactory.from_graph_init_context(
        graph_init_context=DifyGraphInitContext(
            workflow_id=workflow_id or case.workflow.id,
            graph_config=case.workflow.graph_dict,
            run_context=build_dify_run_context(
                tenant_id=TENANT_ID,
                app_id=APP_ID,
                user_id=ACCOUNT_A,
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
            ),
            call_depth=0,
        ),
        graph_runtime_state=GraphRuntimeState(variable_pool=pool, start_at=0.0),
    )
    return factory.create_node(case.workflow.get_node_config_by_id("t")), pool


@pytest.mark.parametrize("change", ["revoked", "hidden-default", "wrong-provider", "after-metadata"])
def test_native_tool_rechecks_selection_after_run_admission(native_draft, sqlite_session, monkeypatch, change):
    """A native node cannot decrypt a selection whose access changed since admission."""
    from sqlalchemy import event

    from graphon.nodes.tool.exc import ToolRuntimeResolutionError
    from models.tools import BuiltinToolProvider

    credential = add_credential(
        sqlite_session,
        tenant_id=TENANT_ID,
        provider=AUTH_PROVIDER,
        user_id=ACCOUNT_B,
        visibility=PermissionEnum.PARTIAL_TEAM,
        partial_members=[ACCOUNT_A],
    )
    if change != "hidden-default":
        set_tool(native_draft, sqlite_session, credential_id=credential.id)
    else:
        sqlite_session.commit()
    # Real public admission succeeds before the eventual Tool executes.
    with pytest.raises(NativeDispatchReachedError):
        invoke(native_draft, sqlite_session, monkeypatch, "workflow-full")
    grant = sqlite_session.scalar(
        select(CredentialPermission).where(CredentialPermission.credential_id == credential.id)
    )
    if change == "revoked":
        grant.has_permission = False
    elif change == "hidden-default":
        credential.is_default = False
        add_credential(
            sqlite_session,
            tenant_id=TENANT_ID,
            provider=AUTH_PROVIDER,
            user_id=ACCOUNT_B,
            visibility=PermissionEnum.ONLY_ME,
            name="New hidden default",
        )
    elif change == "wrong-provider":
        credential.provider = FREE_PROVIDER
    sqlite_session.commit()
    monkeypatch.setattr(ToolManager, "get_tool_runtime", classmethod(_NATIVE_TOOL_RUNTIME))
    node, pool = native_tool_node(native_draft)
    revoked_between_reads = []

    def revoke_before_native_value_read(state):
        if change == "after-metadata" and not revoked_between_reads:
            descriptions = getattr(state.statement, "column_descriptions", ())
            if descriptions and descriptions[0].get("expr") is BuiltinToolProvider:
                revoked_between_reads.append(True)
                grant.has_permission = False
                sqlite_session.commit()

    event.listen(Session, "do_orm_execute", revoke_before_native_value_read)
    try:
        with pytest.raises(ToolRuntimeResolutionError, match="authorized Tool credential"):
            node._runtime.get_runtime(node_id="t", node_data=node.node_data, variable_pool=pool)
        assert revoked_between_reads == ([True] if change == "after-metadata" else [])
        assert native_draft.tools.forbidden == []
    finally:
        event.remove(Session, "do_orm_execute", revoke_before_native_value_read)


def test_published_child_inherited_debugger_keeps_native_tool_delegation(native_draft, sqlite_session, monkeypatch):
    """Actual published child scope preserves delegation even with inherited DEBUGGER."""
    from graphon.nodes.tool.exc import ToolRuntimeResolutionError

    credential = add_credential(
        sqlite_session,
        tenant_id=TENANT_ID,
        provider=AUTH_PROVIDER,
        user_id=ACCOUNT_B,
        visibility=PermissionEnum.ONLY_ME,
    )
    set_tool(native_draft, sqlite_session, credential_id=credential.id)
    owner = Account(name="Publishing credential owner", email="credential-owner@example.test")
    owner.id = ACCOUNT_B
    sqlite_session.add(owner)
    sqlite_session.commit()
    published = WorkflowService(sessionmaker(bind=native_draft.tools.engine)).publish_workflow(
        session=sqlite_session,
        app_model=native_draft.app,
        # The credential owner performs actual publication, preserving native scope.
        account=owner,
    )
    sqlite_session.commit()
    # Only actual publication above needs draft setup metadata. Inherited debugger
    # execution of the published child must reach the existing native crypto owner.
    metadata_reads = len(native_draft.tools.daemon.requests)
    monkeypatch.setattr(ToolManager, "get_tool_runtime", classmethod(_NATIVE_TOOL_RUNTIME))
    import core.tools.tool_manager as tool_manager_module

    monkeypatch.setattr(
        tool_manager_module, "db", SimpleNamespace(engine=native_draft.tools.engine, session=sqlite_session)
    )
    node, pool = native_tool_node(native_draft, workflow_id=published.id)
    with pytest.raises(
        ToolRuntimeResolutionError, match="discovery must not call tool_manager.create_provider_encrypter"
    ):
        node._runtime.get_runtime(node_id="t", node_data=node.node_data, variable_pool=pool)
    assert native_draft.tools.forbidden == ["tool_manager.create_provider_encrypter"]
    # Native schema fetch is possible, but installed-catalogue admission must not run.
    assert not any("/management/tools" in r.path for r in native_draft.tools.daemon.requests[metadata_reads:])


@pytest.mark.parametrize("scope", ["deleted", "foreign"])
def test_native_tool_unknown_workflow_scope_refuses_before_crypto(native_draft, sqlite_session, monkeypatch, scope):
    from graphon.nodes.tool.exc import ToolRuntimeResolutionError

    add_credential(sqlite_session, tenant_id=TENANT_ID, provider=AUTH_PROVIDER, user_id=ACCOUNT_A)
    if scope == "deleted":
        sqlite_session.delete(native_draft.workflow)
    else:
        native_draft.workflow.tenant_id = OTHER_TENANT_ID
    sqlite_session.commit()
    monkeypatch.setattr(ToolManager, "get_tool_runtime", classmethod(_NATIVE_TOOL_RUNTIME))
    node, pool = native_tool_node(native_draft)
    with pytest.raises(ToolRuntimeResolutionError, match="workflow scope could not be verified"):
        node._runtime.get_runtime(node_id="t", node_data=node.node_data, variable_pool=pool)
    assert native_draft.tools.forbidden == []


def test_authorized_native_draft_oauth_refresh_persists_rotated_credentials_and_expiry(
    native_draft,
    sqlite_session,
    monkeypatch,
):
    """Refresh success must survive a fresh SQL read, not just the returned runtime.

    Actual stored draft ownership, installed declaration, credential visibility,
    native ToolManager/OAuth orchestration and ORM commit stay real. Synthetic
    crypto and daemon/Redis boundaries permit one authorized refresh only.
    """
    import core.tools.tool_manager as runtime_module
    import services.tools.builtin_tools_manage_service as client_module
    from contexts.wrapper import RecyclableContextVar
    from core.helper import provider_cache
    from core.plugin.entities.plugin_daemon import CredentialType as ToolCredentialType
    from core.plugin.entities.plugin_daemon import PluginOAuthCredentialsResponse
    from core.tools.entities.tool_entities import ToolInvokeFrom, ToolProviderType
    from models.tools import BuiltinToolProvider, ToolOAuthTenantClient

    # A normal fresh native request must not reuse another test's provider schema.
    RecyclableContextVar.increment_thread_recycles()
    declaration = native_draft.tools.daemon.providers_by_tenant[TENANT_ID][0]["declaration"]
    declaration["credentials_schema"] = []
    declaration["oauth_schema"] = {
        "client_schema": [
            {"name": "client_id", "type": "text-input"},
            {"name": "client_secret", "type": "secret-input"},
        ],
        "credentials_schema": [
            {"name": "access_token", "type": "secret-input"},
            {"name": "refresh_token", "type": "secret-input"},
        ],
    }
    credential = add_credential(
        sqlite_session,
        tenant_id=TENANT_ID,
        provider=AUTH_PROVIDER,
        user_id=ACCOUNT_A,
        visibility=PermissionEnum.ONLY_ME,
    )
    credential.credential_type = ToolCredentialType.OAUTH2
    credential.encrypted_credentials = json.dumps(
        {
            "access_token": "cipher:old-access",
            "refresh_token": "cipher:old-refresh",
        }
    )
    credential.expires_at = 1
    client = ToolOAuthTenantClient(tenant_id=TENANT_ID, plugin_id="acme/huddle", provider="huddle")
    client.enabled = True
    client.encrypted_oauth_params = json.dumps(
        {
            "client_id": "synthetic-client",
            "client_secret": "cipher:client-secret",
        }
    )
    sqlite_session.add_all([client, native_draft.user])
    sqlite_session.commit()
    set_tool(native_draft, sqlite_session, credential_id=credential.id)
    credential_id = credential.id
    native_database = SimpleNamespace(engine=native_draft.tools.engine, session=sqlite_session)
    monkeypatch.setattr(runtime_module, "db", native_database)
    monkeypatch.setattr(client_module, "db", native_database)
    monkeypatch.setattr(ToolManager, "get_tool_runtime", classmethod(_NATIVE_TOOL_RUNTIME))
    monkeypatch.setattr(OAuthHandler, "refresh_credentials", _NATIVE_OAUTH_REFRESH)
    crypto_calls = []
    refresh_calls = []
    cache_deletions = []

    class SyntheticCrypto:
        @staticmethod
        def decrypt(values):
            crypto_calls.append("decrypt")
            if values == {"client_id": "synthetic-client", "client_secret": "cipher:client-secret"}:
                return {"client_id": "synthetic-client", "client_secret": "synthetic-client-secret"}
            if values == {"access_token": "cipher:new-access", "refresh_token": "cipher:new-refresh"}:
                return {"access_token": "synthetic-new-access", "refresh_token": "synthetic-new-refresh"}
            assert values == {"access_token": "cipher:old-access", "refresh_token": "cipher:old-refresh"}
            return {"access_token": "synthetic-old-access", "refresh_token": "synthetic-old-refresh"}

        @staticmethod
        def encrypt(values):
            crypto_calls.append("encrypt")
            assert values == {"access_token": "synthetic-new-access", "refresh_token": "synthetic-new-refresh"}
            return {"access_token": "cipher:new-access", "refresh_token": "cipher:new-refresh"}

    def crypto_factory(*, tenant_id, config, cache):
        assert tenant_id == TENANT_ID
        assert len(config) == 2
        return SyntheticCrypto(), cache

    def refresh_stream(_self, method, path, response_type, **kwargs):
        assert method == "POST"
        assert path == "plugin/aaaaaaaa-0000-4000-8000-000000000001/dispatch/oauth/refresh_credentials"
        assert response_type is PluginOAuthCredentialsResponse
        assert kwargs["headers"] == {"X-Plugin-ID": "acme/huddle", "Content-Type": "application/json"}
        assert kwargs["data"]["user_id"] == ACCOUNT_A
        assert kwargs["data"]["data"]["provider"] == "huddle"
        assert kwargs["data"]["data"]["credentials"] == {
            "access_token": "synthetic-old-access",
            "refresh_token": "synthetic-old-refresh",
        }
        assert kwargs["data"]["data"]["system_credentials"] == {
            "client_id": "synthetic-client",
            "client_secret": "synthetic-client-secret",
        }
        refresh_calls.append(path)
        return iter(
            [
                PluginOAuthCredentialsResponse(
                    credentials={"access_token": "synthetic-new-access", "refresh_token": "synthetic-new-refresh"},
                    expires_at=4102444800,
                )
            ]
        )

    class RedisBoundary:
        @staticmethod
        def delete(key):
            cache_deletions.append(key)
            return 1

    monkeypatch.setattr(runtime_module, "create_provider_encrypter", crypto_factory)
    monkeypatch.setattr(client_module, "create_provider_encrypter", crypto_factory)
    monkeypatch.setattr(OAuthHandler, "_request_with_plugin_daemon_response_stream", refresh_stream)
    monkeypatch.setattr(provider_cache, "redis_client", RedisBoundary())
    runtime = ToolManager.get_tool_runtime(
        provider_type=ToolProviderType.BUILT_IN,
        provider_id=AUTH_PROVIDER,
        tool_name="post",
        tenant_id=TENANT_ID,
        user_id=ACCOUNT_A,
        invoke_from=InvokeFrom.DEBUGGER,
        tool_invoke_from=ToolInvokeFrom.WORKFLOW,
        credential_id=credential_id,
        draft_tool_workflow_id=DRAFT_ID,
        draft_tool_app_id=APP_ID,
    )
    assert runtime.runtime.credentials == {
        "access_token": "synthetic-new-access",
        "refresh_token": "synthetic-new-refresh",
    }
    assert len(refresh_calls) == 1
    assert crypto_calls == ["decrypt", "decrypt", "encrypt"]
    assert len(cache_deletions) == 1
    assert native_draft.tools.forbidden == []
    # A fresh independent read observes actual committed storage, not either
    # runtime state or the fixture session's potentially stale identity map.
    with Session(native_draft.tools.engine) as fresh_session:
        encrypted, expiry = fresh_session.execute(
            select(BuiltinToolProvider.encrypted_credentials, BuiltinToolProvider.expires_at).where(
                BuiltinToolProvider.tenant_id == TENANT_ID,
                BuiltinToolProvider.provider == AUTH_PROVIDER,
                BuiltinToolProvider.id == credential_id,
            )
        ).one()
    assert json.loads(encrypted) == {"access_token": "cipher:new-access", "refresh_token": "cipher:new-refresh"}
    assert expiry == 4102444800

    subsequent_runtime = ToolManager.get_tool_runtime(
        provider_type=ToolProviderType.BUILT_IN,
        provider_id=AUTH_PROVIDER,
        tool_name="post",
        tenant_id=TENANT_ID,
        user_id=ACCOUNT_A,
        invoke_from=InvokeFrom.DEBUGGER,
        tool_invoke_from=ToolInvokeFrom.WORKFLOW,
        credential_id=credential_id,
        draft_tool_workflow_id=DRAFT_ID,
        draft_tool_app_id=APP_ID,
    )
    assert subsequent_runtime.runtime.credentials == {
        "access_token": "synthetic-new-access",
        "refresh_token": "synthetic-new-refresh",
    }
    assert len(refresh_calls) == 1
    assert crypto_calls == ["decrypt", "decrypt", "encrypt", "decrypt"]
    assert len(cache_deletions) == 1
    assert native_draft.tools.forbidden == []
