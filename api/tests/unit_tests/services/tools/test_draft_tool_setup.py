"""Ordinary draft compatibility with Builder disabled in self-hosted and Cloud deployments."""

import json
from collections.abc import Callable

import pytest
from sqlalchemy import Select
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker

import services.app_generate_service as generate_module
import services.workflow_service as workflow_module
from core.tools.errors import ToolProviderCredentialValidationError
from models.enums import PermissionEnum
from models.model import AppMode
from models.workflow import Workflow
from services.app_generate_service import AppGenerateService
from services.workflow_service import WorkflowService
from tests.helpers import billing_builders as builders
from tests.unit_tests.services.dify_builder.draft_tool_inventory import APP_ID, AUTH_PROVIDER, DRAFT_ID, FREE_PROVIDER
from tests.unit_tests.services.dify_builder.installed_tool_inventory import (
    ACCOUNT_A,
    ACCOUNT_B,
    OTHER_TENANT_ID,
    TENANT_ID,
    add_credential,
)
from tests.unit_tests.services.test_draft_tool_admission import (
    ENTRYPOINTS,
    NativeDispatchReachedError,
    NativeDraftCase,
    NativeOAuthCase,
    ResumeEvidence,
    dispatch,
    invoke,
    native_tool_node,
    nest_tool_in_container,
    set_tool,
)
from tests.unit_tests.services.test_draft_tool_admission import (
    draft_tools as installed_draft_tools,
)
from tests.unit_tests.services.test_draft_tool_admission import (
    native_draft as installed_native_draft,
)
from tests.unit_tests.services.test_draft_tool_admission import (
    native_draft_oauth as installed_native_draft_oauth,
)
from tests.unit_tests.services.test_draft_tool_admission import (
    paused_native_draft as installed_paused_native_draft,
)

draft_tools = installed_draft_tools
native_draft = installed_native_draft
native_draft_oauth = installed_native_draft_oauth
paused_native_draft = installed_paused_native_draft


@pytest.fixture(params=["COMMUNITY", "CLOUD"])
def builder_disabled_deployment(
    request: pytest.FixtureRequest,
    native_draft: NativeDraftCase,  # noqa: ARG001
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=request.param, DIFY_BUILDER_ENABLED=False)
    monkeypatch.setattr(generate_module.QuotaService, "reserve", lambda *_args: generate_module.unlimited())
    monkeypatch.setattr(
        workflow_module.BillingService,
        "get_info",
        lambda *_args: builders.subscription_info("team"),
    )


@pytest.mark.parametrize("operation", [*ENTRYPOINTS, "publish"])
@pytest.mark.parametrize("visibility", [PermissionEnum.ONLY_ME, PermissionEnum.PARTIAL_TEAM])
@pytest.mark.usefixtures("builder_disabled_deployment")
def test_ordinary_saved_borrowed_credential_keeps_native_admission_when_builder_disabled(
    native_draft: NativeDraftCase,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
    visibility: PermissionEnum,
) -> None:
    credential = add_credential(
        sqlite_session, tenant_id=TENANT_ID, provider=AUTH_PROVIDER, user_id=ACCOUNT_B, visibility=visibility
    )
    set_tool(native_draft, sqlite_session, credential_id=credential.id)
    assert native_draft.tools.queries.list_tools(
        workspace_id=TENANT_ID, actor_id=ACCOUNT_A, provider=AUTH_PROVIDER, include_credential_ids=[credential.id]
    )[0].from_other_member
    if operation == "publish":
        published = invoke(native_draft, sqlite_session, monkeypatch, operation)
        assert isinstance(published, Workflow)
        assert published.graph == native_draft.workflow.graph
    else:
        with pytest.raises(NativeDispatchReachedError):
            invoke(native_draft, sqlite_session, monkeypatch, operation)
    assert native_draft.tools.forbidden == []


@pytest.mark.parametrize("operation", ["run", "publish"])
def test_builder_does_not_borrow_another_members_saved_explicit_credential(
    native_draft: NativeDraftCase, sqlite_session: Session, operation: str
) -> None:
    from services.tools.draft_tool_setup import admit_draft_tool_setup

    credential = add_credential(
        sqlite_session,
        tenant_id=TENANT_ID,
        provider=AUTH_PROVIDER,
        user_id=ACCOUNT_B,
        visibility=PermissionEnum.ONLY_ME,
    )
    set_tool(native_draft, sqlite_session, credential_id=credential.id)
    if operation == "publish":
        with pytest.raises(ToolProviderCredentialValidationError, match="Tool"):
            WorkflowService(sessionmaker(bind=native_draft.tools.engine)).publish_workflow(
                session=sqlite_session,
                app_model=native_draft.app,
                account=native_draft.user,
                expected_draft_id=native_draft.workflow.id,
            )
    else:
        with pytest.raises(ToolProviderCredentialValidationError, match="Tool"):
            admit_draft_tool_setup(tenant_id=TENANT_ID, graph=native_draft.workflow.graph_dict, actor_id=ACCOUNT_A)
    assert native_draft.tools.forbidden == []


@pytest.mark.parametrize("isolated", ["node", "workflow-iteration", "chat-iteration", "workflow-loop", "chat-loop"])
@pytest.mark.usefixtures("builder_disabled_deployment")
def test_isolated_debugging_ignores_unrelated_unconfigured_tool(
    native_draft: NativeDraftCase,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    isolated: str,
) -> None:
    from copy import deepcopy

    from fields.workflow_run_fields import LoopNodeRunPayload

    set_tool(native_draft, sqlite_session, provider_id=FREE_PROVIDER, provider_name=FREE_PROVIDER, tool_name="echo")
    if isolated != "node":
        nest_tool_in_container(native_draft, sqlite_session, "iteration" if isolated.endswith("iteration") else "loop")
    graph = native_draft.workflow.graph_dict
    unrelated = deepcopy(next(node for node in graph["nodes"] if node["id"] == "t"))
    unrelated["id"] = "unconfigured"
    unrelated.pop("parentId", None)
    unrelated["data"] = {
        "type": "tool",
        "title": "Unconfigured tool",
        "provider_type": "builtin",
        "provider_id": AUTH_PROVIDER,
        "tool_name": "post",
    }
    graph["nodes"].append(unrelated)
    native_draft.workflow.graph = json.dumps(graph)
    native_draft.app.mode = AppMode.ADVANCED_CHAT if isolated.startswith("chat-") else AppMode.WORKFLOW
    sqlite_session.commit()
    for generator in (generate_module.WorkflowAppGenerator, generate_module.AdvancedChatAppGenerator):
        for method in ("single_iteration_generate", "single_loop_generate"):
            monkeypatch.setattr(generator, method, dispatch)
    monkeypatch.setattr(workflow_module.WorkflowEntry, "single_step_run", dispatch)

    def invoke_isolated() -> None:
        if isolated == "node":
            WorkflowService(sessionmaker(bind=native_draft.tools.engine)).run_draft_workflow_node(
                native_draft.app, native_draft.workflow, "t", {}, native_draft.user
            )
        elif isolated.endswith("iteration"):
            AppGenerateService.generate_single_iteration(
                native_draft.app,
                native_draft.user,
                "container",
                {"inputs": {}},
                session=sqlite_session,
                streaming=False,
            )
        else:
            AppGenerateService.generate_single_loop(
                native_draft.app,
                native_draft.user,
                "container",
                LoopNodeRunPayload(inputs={}),
                session=sqlite_session,
                streaming=False,
            )

    with pytest.raises(NativeDispatchReachedError):
        invoke_isolated()
    with pytest.raises(ToolProviderCredentialValidationError):
        invoke(native_draft, sqlite_session, monkeypatch, "workflow-full")
    assert native_draft.tools.forbidden == []


@pytest.mark.parametrize("container_kind", ["iteration", "loop"])
def test_isolated_container_still_validates_nested_tool(
    native_draft: NativeDraftCase, sqlite_session: Session, container_kind: str
) -> None:
    from services.tools.draft_tool_setup import admit_draft_tool_setup, draft_tool_execution_graph

    nest_tool_in_container(native_draft, sqlite_session, container_kind)
    graph = native_draft.workflow.graph_dict
    tool = next(node for node in graph["nodes"] if node["id"] == "t")
    tool["parentId"] = "nested"
    tool["data"].pop(f"{container_kind}_id", None)
    graph["nodes"].append({"id": "nested", "parentId": "container", "data": {"type": "loop"}})
    scoped = draft_tool_execution_graph(graph, "container")
    assert {node["id"] for node in scoped["nodes"]} == {"container", "containerstart", "nested", "t"}
    with pytest.raises(ToolProviderCredentialValidationError):
        admit_draft_tool_setup(tenant_id=TENANT_ID, graph=scoped, actor_id=ACCOUNT_A)


@pytest.mark.parametrize("short_provider", ["wikipedia", "jina"])
@pytest.mark.parametrize("operation", ["workflow-full", "publish"])
@pytest.mark.usefixtures("builder_disabled_deployment")
def test_native_short_plugin_id_resolves_installed_canonical_declaration(
    native_draft: NativeDraftCase,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    short_provider: str,
    operation: str,
) -> None:
    from models.provider_ids import ToolProviderID
    from tests.unit_tests.services.dify_builder.installed_tool_inventory import FakeTool, provider_payload

    canonical = ToolProviderID(short_provider)
    native_draft.tools.daemon.providers_by_tenant[TENANT_ID].append(
        provider_payload(
            canonical.plugin_id,
            canonical.provider_name,
            [FakeTool("search", "Search")],
            needs_credentials=short_provider == "jina",
        )
    )
    if short_provider == "jina":
        credential = add_credential(
            sqlite_session,
            tenant_id=TENANT_ID,
            provider=short_provider,
            user_id=ACCOUNT_B,
            visibility=PermissionEnum.ONLY_ME,
        )
        set_tool(native_draft, sqlite_session, credential_id=credential.id)
    set_tool(native_draft, sqlite_session, provider_id=short_provider, provider_name=short_provider, tool_name="search")
    if operation == "publish":
        assert isinstance(invoke(native_draft, sqlite_session, monkeypatch, operation), Workflow)
    else:
        with pytest.raises(NativeDispatchReachedError):
            invoke(native_draft, sqlite_session, monkeypatch, operation)
    set_tool(native_draft, sqlite_session, provider_id=f"other/{short_provider}/{short_provider}")
    with pytest.raises(ToolProviderCredentialValidationError, match="not verified as installed"):
        invoke(native_draft, sqlite_session, monkeypatch, operation)
    assert native_draft.tools.forbidden == []


@pytest.mark.parametrize("change", ["unchanged", "unrelated-autosave", "visibility", "rebound", "rotated"])
@pytest.mark.usefixtures("builder_disabled_deployment")
def test_borrowed_native_oauth_read_and_refresh_keeps_exact_saved_binding(
    native_draft_oauth: NativeOAuthCase,
    sqlite_session: Session,
    change: str,
) -> None:
    from core.workflow.node_runtime import _WorkflowToolRuntimeBinding
    from graphon.nodes.tool.exc import ToolRuntimeResolutionError
    from models.tools import BuiltinToolProvider

    boundary = native_draft_oauth
    credential = sqlite_session.get(BuiltinToolProvider, boundary.credential_id)
    assert credential is not None
    credential.user_id = ACCOUNT_B
    credential.visibility = PermissionEnum.ALL_TEAM if change == "visibility" else PermissionEnum.ONLY_ME
    sqlite_session.commit()
    boundary.refresh_boundary.credential_owner = ACCOUNT_B

    def during_refresh() -> None:
        with Session(boundary.engine) as session, session.begin():
            workflow = session.get(Workflow, DRAFT_ID)
            assert workflow is not None
            graph = workflow.graph_dict
            if change == "unrelated-autosave":
                graph["nodes"][0]["data"]["title"] = "Edited while refreshing"
                workflow.graph = json.dumps(graph)
            elif change == "rebound":
                graph["nodes"][1]["data"].pop("credential_id")
                workflow.graph = json.dumps(graph)
            elif change == "visibility":
                current = session.get(BuiltinToolProvider, boundary.credential_id)
                assert current is not None
                current.visibility = PermissionEnum.ONLY_ME
            elif change == "rotated":
                current = session.get(BuiltinToolProvider, boundary.credential_id)
                assert current is not None
                current.encrypted_credentials = '{"access_token":"different-rotation"}'

    boundary.refresh_boundary.action = during_refresh
    node, pool = native_tool_node(boundary.case)
    if change in {"rebound", "rotated"}:
        with pytest.raises(ToolRuntimeResolutionError, match="changed or access was revoked"):
            node._runtime.get_runtime(node_id="t", node_data=node.node_data, variable_pool=pool)
    else:
        result = node._runtime.get_runtime(node_id="t", node_data=node.node_data, variable_pool=pool)
        assert isinstance(result.raw, _WorkflowToolRuntimeBinding)
        assert result.raw.tool.runtime.credentials["access_token"] == "synthetic-new-access"
        with Session(boundary.engine) as session:
            saved = session.get(BuiltinToolProvider, boundary.credential_id)
            assert saved is not None
            assert saved.encrypted_credentials is not None
            assert json.loads(saved.encrypted_credentials)["refresh_token"] == "cipher:new-refresh"
    assert len(boundary.refresh_calls) == 1
    assert boundary.forbidden == []


@pytest.mark.parametrize("marker", ["bindings", "mocked", "native-required"])
def test_builder_marked_native_runtime_cannot_borrow_saved_credential(
    native_draft_oauth: NativeOAuthCase,
    sqlite_session: Session,
    marker: str,
) -> None:
    from core.workflow.node_runtime import DifyToolNodeRuntime
    from graphon.nodes.tool.exc import ToolRuntimeResolutionError
    from models.tools import BuiltinToolProvider

    boundary = native_draft_oauth
    credential = sqlite_session.get(BuiltinToolProvider, boundary.credential_id)
    assert credential is not None
    credential.user_id = ACCOUNT_B
    sqlite_session.commit()
    node, pool = native_tool_node(boundary.case, credential_bindings={} if marker == "bindings" else None)
    assert isinstance(node._runtime, DifyToolNodeRuntime)
    if marker == "mocked":
        node._runtime._run_context.builder_mocked_node_ids = frozenset({"unrelated"})
    elif marker == "native-required":
        node._runtime._run_context.native_test_required = True
    with pytest.raises(ToolRuntimeResolutionError, match="authorized Tool credential|native"):
        node._runtime.get_runtime(node_id="t", node_data=node.node_data, variable_pool=pool)
    assert boundary.crypto_calls == []
    assert boundary.refresh_calls == []


@pytest.mark.parametrize("mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
@pytest.mark.usefixtures("builder_disabled_deployment")
def test_ordinary_resume_preserves_saved_borrowed_credential(
    paused_native_draft: ResumeEvidence,
    native_draft: NativeDraftCase,
    sqlite_session: Session,
    mode: AppMode,
) -> None:
    credential = add_credential(
        sqlite_session,
        tenant_id=TENANT_ID,
        provider=AUTH_PROVIDER,
        user_id=ACCOUNT_B,
        visibility=PermissionEnum.ONLY_ME,
    )
    set_tool(native_draft, sqlite_session, credential_id=credential.id)
    paused_native_draft.store(mode, dict(native_draft.workflow.graph_dict))
    with pytest.raises(NativeDispatchReachedError):
        paused_native_draft.resume()
    assert paused_native_draft.native_calls == [paused_native_draft.run_id]
    assert native_draft.tools.forbidden == []


@pytest.mark.parametrize("mismatch", ["tenant", "app", "workflow", "node", "provider", "action", "credential"])
def test_saved_credential_delegation_requires_exact_persisted_binding(
    native_draft: NativeDraftCase,
    sqlite_session: Session,
    mismatch: str,
) -> None:
    from services.workflow_ref_service import WorkflowRef

    credential = add_credential(
        sqlite_session,
        tenant_id=TENANT_ID,
        provider=AUTH_PROVIDER,
        user_id=ACCOUNT_B,
        visibility=PermissionEnum.ONLY_ME,
    )
    set_tool(native_draft, sqlite_session, credential_id=credential.id)
    ref = WorkflowRef(
        OTHER_TENANT_ID if mismatch == "tenant" else TENANT_ID,
        "cccccccc-0000-4000-8000-000000000002" if mismatch == "app" else APP_ID,
        "dddddddd-0000-4000-8000-000000000002" if mismatch == "workflow" else DRAFT_ID,
    )
    assert (
        native_draft.tools.queries.resolve_workflow_tool_credential_metadata(
            workflow_ref=ref,
            node_id="different" if mismatch == "node" else "t",
            provider=FREE_PROVIDER if mismatch == "provider" else AUTH_PROVIDER,
            action="different" if mismatch == "action" else "post",
            credential_id="eeeeeeee-0000-4000-8000-000000000002" if mismatch == "credential" else credential.id,
        )
        is None
    )
    assert native_draft.tools.forbidden == []


def test_borrowed_native_read_rechecks_binding_before_decryption(
    native_draft_oauth: NativeOAuthCase,
    sqlite_session: Session,
) -> None:
    from sqlalchemy import event

    from graphon.nodes.tool.exc import ToolRuntimeResolutionError
    from models.tools import BuiltinToolProvider

    boundary = native_draft_oauth
    credential = sqlite_session.get(BuiltinToolProvider, boundary.credential_id)
    assert credential is not None
    credential.user_id = ACCOUNT_B
    sqlite_session.commit()
    node, pool = native_tool_node(boundary.case)
    changed: list[bool] = []

    def rebind_before_value_read(state: ORMExecuteState) -> None:
        descriptions = state.statement.column_descriptions if isinstance(state.statement, Select) else ()
        if not changed and descriptions and descriptions[0].get("expr") is BuiltinToolProvider:
            changed.append(True)
            graph = boundary.case.workflow.graph_dict
            graph["nodes"][1]["data"].pop("credential_id")
            boundary.case.workflow.graph = json.dumps(graph)
            sqlite_session.commit()

    event.listen(Session, "do_orm_execute", rebind_before_value_read)
    try:
        with pytest.raises(ToolRuntimeResolutionError, match="authorized Tool credential"):
            node._runtime.get_runtime(node_id="t", node_data=node.node_data, variable_pool=pool)
    finally:
        event.remove(Session, "do_orm_execute", rebind_before_value_read)
    assert changed == [True]
    assert boundary.crypto_calls == []
    assert boundary.refresh_calls == []
