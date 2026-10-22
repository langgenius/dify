import json
from collections.abc import Mapping
from copy import deepcopy
from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from clients.plugin.auth_entities import CredentialCheckResult
from constants.end_user_connections import ConnectionCredentialStatus
from context.connection_execution import ConnectionExecutionContext
from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    InvokeFrom,
    UserFrom,
    WorkflowAppGenerateEntity,
    build_dify_run_context,
)
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext
from models.end_user_connection import AppConnection, EndUserConnection, SessionConnection
from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation, EndUser
from models.tools import ToolOAuthTenantClient
from models.workflow import Workflow, WorkflowRun
from services.end_user_connection_execution_adapters import (
    prepare_web_connection_execution,
    validate_connection_execution,
)
from services.end_user_connection_preflight_adapters import PublishedPreflightRequirements
from services.end_user_connections.errors import (
    ConnectionCheckUnavailableError,
    ConnectionConfigurationError,
    ConnectionConflictError,
    ConnectionIdentityError,
    ConnectionInvalidCredentialsError,
    ConnectionNotFoundError,
    ConnectionReauthorizationRequiredError,
    ConnectionRequiredError,
    ConnectionWorkflowChangedError,
)
from services.end_user_connections.execution import (
    ConnectionExecutionService,
    ConnectionRunInput,
)
from services.end_user_connections.preflight import ConnectionPreflightInput, ConnectionPreflightService
from services.errors.conversation import ConversationNotExistsError
from tasks.app_generate.workflow_execute_task import AppExecutionParams
from tests.helpers.end_user_api_key import make_harness
from tests.helpers.end_user_oauth import OAuthHarness, make_oauth_harness


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> OAuthHarness:
    return make_oauth_harness(sqlite_session_factory, monkeypatch)


@pytest.fixture
def preflight(harness: OAuthHarness) -> ConnectionPreflightService:
    return ConnectionPreflightService(
        connections=harness.base.repository,
        checks=harness.base.service,
        requirements=PublishedPreflightRequirements(
            workflows=harness.base.repository, providers=harness.providers, oauth=harness.gateway
        ),
    )


@pytest.fixture
def service(preflight: ConnectionPreflightService) -> ConnectionExecutionService:
    return ConnectionExecutionService(preflight=preflight)


def prepare(
    harness: OAuthHarness,
    service: ConnectionExecutionService,
    choices: Mapping[str, str | None],
    conversation_id: str | None = None,
) -> ConnectionExecutionContext:
    return service.prepare(
        harness.base.context,
        ConnectionRunInput.model_validate({"workflow_id": harness.base.workflow_id, "connections": choices}),
        workflow_id=harness.base.workflow_id,
        conversation_id=conversation_id,
    )


def test_explicit_selection_is_checked_without_copying_secrets(
    harness: OAuthHarness, service: ConnectionExecutionService
) -> None:
    first = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    second = harness.base.service.create_api_key(harness.base.context, harness.base.command("new-secret"))
    harness.base.auth.calls.clear()
    choices = {"tool-1": first.id}
    context = prepare(harness, service, choices)
    choices["tool-1"] = second.id
    assert context.selections[0].connection_id == first.id
    assert prepare(harness, service, choices).selections[0].connection_id == second.id
    with pytest.raises(ConnectionRequiredError):
        prepare(harness, service, {})
    with pytest.raises(ConnectionRequiredError):
        prepare(harness, service, {"tool-1": None})
    serialized = context.model_dump_json()
    assert "original-secret" not in serialized
    assert "encrypted_credentials" not in serialized
    assert "revision" not in serialized
    assert ConnectionExecutionContext.model_validate_json(serialized) == context
    assert len(harness.base.auth.calls) == 2


@pytest.mark.parametrize("foreign", [False, True])
def test_unknown_and_foreign_connections_are_rejected(
    harness: OAuthHarness, service: ConnectionExecutionService, foreign: bool
) -> None:
    other = make_harness(harness.base.sessions)
    selected = other.service.create_api_key(other.context, other.command()).id if foreign else str(uuid4())
    with pytest.raises(ConnectionNotFoundError):
        prepare(harness, service, {"tool-1": selected})


@pytest.mark.parametrize("change", ["provider", "allowed_type"])
def test_inapplicable_selection_is_rejected(
    harness: OAuthHarness, service: ConnectionExecutionService, change: str
) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    with harness.base.sessions.begin() as session:
        if change == "provider":
            session.execute(
                sa.update(EndUserConnection)
                .where(EndUserConnection.id == connection.id)
                .values(provider="other/provider")
            )
        else:
            workflow = session.get(Workflow, harness.base.workflow_id)
            assert workflow is not None
            graph = workflow.graph_dict
            graph["nodes"][0]["data"]["end_user_auth"]["allowed_credential_types"] = ["oauth2"]
            workflow.graph = json.dumps(graph)
    with pytest.raises(ConnectionConfigurationError):
        prepare(harness, service, {"tool-1": connection.id})


def test_reuse_requires_root_selection_and_keeps_independent_nodes_separate(
    harness: OAuthHarness, service: ConnectionExecutionService
) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    with harness.base.sessions.begin() as session:
        workflow = session.get(Workflow, harness.base.workflow_id)
        assert workflow is not None
        graph = workflow.graph_dict
        independent = deepcopy(graph["nodes"][0])
        independent["id"] = "independent"
        reused = deepcopy(independent)
        reused["id"] = "reused"
        reused["data"].pop("end_user_auth")
        reused["data"].update(credential_source="reuse_node", reuse_node_id="tool-1")
        graph["nodes"].extend([independent, reused])
        workflow.graph = json.dumps(graph)
    with pytest.raises(ConnectionRequiredError):
        prepare(harness, service, {"tool-1": connection.id})
    harness.base.auth.calls.clear()
    context = prepare(harness, service, {"tool-1": connection.id, "independent": connection.id})
    assert len(harness.base.auth.calls) == 1
    assert tuple(selection.node_id for selection in context.selections) == ("tool-1", "independent")
    assert context.selections[0].connection_id == connection.id
    assert context.selections[1].connection_id == connection.id
    with pytest.raises(ConnectionConfigurationError):
        prepare(harness, service, {"reused": connection.id})


def test_protocol_mismatch_never_selects_the_requested_workflow(
    harness: OAuthHarness, service: ConnectionExecutionService
) -> None:
    with pytest.raises(ConnectionWorkflowChangedError):
        service.prepare(
            harness.base.context,
            ConnectionRunInput.model_validate({"workflow_id": str(uuid4()), "connections": {}}),
            workflow_id=harness.base.workflow_id,
            conversation_id=None,
        )


def test_async_authority_revalidated_without_rebinding_to_new_publication(
    harness: OAuthHarness, service: ConnectionExecutionService
) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    context = prepare(harness, service, {"tool-1": connection.id})
    with harness.base.sessions.begin() as session:
        app = session.get(App, harness.base.context.app_id)
        assert app is not None
        user = session.get(EndUser, harness.base.context.end_user_id)
        assert user is not None
        workflow = session.get(Workflow, harness.base.workflow_id)
        assert workflow is not None
        app.workflow_id = str(uuid4())
    validate_connection_execution(
        context, app=app, user=user, workflow=workflow, conversation_id=None, repository=harness.base.repository
    )
    with pytest.raises(ConnectionWorkflowChangedError):
        prepare(harness, service, {})
    changed = context.model_copy(update={"account_id": str(uuid4())})
    with pytest.raises(ConnectionIdentityError):
        validate_connection_execution(
            changed, app=app, user=user, workflow=workflow, conversation_id=None, repository=harness.base.repository
        )
    with harness.base.sessions.begin() as session:
        session.execute(sa.update(EndUser).where(EndUser.id == user.id).values(account_id=None))
    with pytest.raises(ConnectionIdentityError):
        validate_connection_execution(
            context, app=app, user=user, workflow=workflow, conversation_id=None, repository=harness.base.repository
        )


def test_existing_conversation_must_belong_to_authenticated_user(
    harness: OAuthHarness, service: ConnectionExecutionService
) -> None:
    with harness.base.sessions.begin() as session:
        session.execute(sa.update(App).where(App.id == harness.base.context.app_id).values(mode=AppMode.ADVANCED_CHAT))
        conversation = Conversation(
            app_id=harness.base.context.app_id,
            mode=AppMode.ADVANCED_CHAT,
            name="Chat",
            from_source=ConversationFromSource.API,
            from_end_user_id=harness.base.context.end_user_id,
            from_account_id=None,
            invoke_from=InvokeFrom.WEB_APP,
            _inputs={},
            is_deleted=False,
        )
        session.add(conversation)
        session.flush()
        conversation_id = conversation.id
        app = session.get(App, harness.base.context.app_id)
        user = session.get(EndUser, harness.base.context.end_user_id)
        workflow = session.get(Workflow, harness.base.workflow_id)
        assert app is not None
        assert user is not None
        assert workflow is not None
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    context = prepare(harness, service, {"tool-1": connection.id}, conversation_id)
    assert "conversation_id" not in context.model_dump()
    validate_connection_execution(
        context,
        app=app,
        user=user,
        workflow=workflow,
        conversation_id=conversation_id,
        repository=harness.base.repository,
    )
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(Conversation).where(Conversation.id == conversation_id).values({"from_end_user_id": str(uuid4())})
        )
    with pytest.raises(ConversationNotExistsError):
        prepare(harness, service, {}, conversation_id)
    with pytest.raises(ConversationNotExistsError):
        validate_connection_execution(
            context,
            app=app,
            user=user,
            workflow=workflow,
            conversation_id=conversation_id,
            repository=harness.base.repository,
        )


@pytest.mark.parametrize("chatflow", [False, True])
def test_queue_pause_and_runtime_context_preserve_the_same_selection(
    harness: OAuthHarness, service: ConnectionExecutionService, chatflow: bool
) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    context = prepare(harness, service, {"tool-1": connection.id})
    with harness.base.sessions() as session:
        app = session.get(App, harness.base.context.app_id)
        assert app is not None
        user = session.get(EndUser, harness.base.context.end_user_id)
        assert user is not None
        workflow = session.get(Workflow, harness.base.workflow_id)
        assert workflow is not None
    conversation_id = str(uuid4()) if chatflow else None
    params = AppExecutionParams.new(
        app,
        workflow,
        user,
        {"inputs": {}, "conversation_id": conversation_id},
        InvokeFrom.WEB_APP,
        connection_context=context,
    )
    restored = AppExecutionParams.model_validate_json(params.model_dump_json())
    assert restored.connection_context == context
    assert restored.connection_context is not None
    assert "conversation_id" not in restored.connection_context.model_dump()
    assert restored.args["conversation_id"] == conversation_id
    entity_args: dict[str, object] = {
        "app_config": WorkflowUIBasedAppConfig(
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id=workflow.id,
            app_mode=AppMode.ADVANCED_CHAT if chatflow else AppMode.WORKFLOW,
        ),
        "task_id": "task",
        "inputs": {},
        "files": [],
        "user_id": user.id,
        "stream": True,
        "invoke_from": InvokeFrom.WEB_APP,
        "connection_context": restored.connection_context,
    }

    entity = (
        AdvancedChatAppGenerateEntity.model_validate(
            {**entity_args, "query": "hello", "conversation_id": conversation_id}
        )
        if chatflow
        else WorkflowAppGenerateEntity.model_validate({**entity_args, "workflow_execution_id": params.workflow_run_id})
    )
    paused = WorkflowResumptionContext.model_validate(
        {
            "generate_entity": {"type": "advanced-chat" if chatflow else "workflow", "entity": entity},
            "serialized_graph_runtime_state": "{}",
        }
    )
    resumed = WorkflowResumptionContext.loads(paused.dumps()).get_generate_entity()
    if chatflow:
        assert isinstance(resumed, AdvancedChatAppGenerateEntity)
        assert resumed.conversation_id == conversation_id
    runtime = build_dify_run_context(
        tenant_id=app.tenant_id,
        app_id=app.id,
        user_id=user.id,
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
        connection_context=resumed.connection_context,
        extra_context={"_dify": {"connection_context": "untrusted"}},
    )
    assert runtime["_dify"].connection_context == context


def test_entry_ignores_client_authority_fields(
    harness: OAuthHarness, service: ConnectionExecutionService, monkeypatch: pytest.MonkeyPatch
) -> None:
    from extensions import ext_application_services

    monkeypatch.setattr(
        ext_application_services, "application_services", lambda: SimpleNamespace(end_user_connection_execution=service)
    )
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    with harness.base.sessions() as session:
        app = session.get(App, harness.base.context.app_id)
        assert app is not None
        user = session.get(EndUser, harness.base.context.end_user_id)
        assert user is not None
        workflow = session.get(Workflow, harness.base.workflow_id)
        assert workflow is not None
    context = prepare_web_connection_execution(
        app=app,
        user=user,
        workflow=workflow,
        args={
            "workflow_id": workflow.id,
            "connections": {"tool-1": connection.id},
            "tenant_id": "foreign",
            "account_id": "foreign",
            "connection_context": {"identity": "foreign"},
        },
    )
    assert context is not None
    assert context.tenant_id == harness.base.context.tenant_id
    assert context.end_user_id == harness.base.context.end_user_id
    assert context.account_id == harness.base.context.account_id


@pytest.mark.parametrize("pin", ["matching", "missing", "stale"])
@pytest.mark.parametrize("selection", ["omitted", "empty", "unused", "unused-null"])
def test_workspace_only_entry_checks_protocol_and_rejects_unused_selections(
    harness: OAuthHarness, monkeypatch: pytest.MonkeyPatch, pin: str, selection: str
) -> None:
    from extensions import ext_application_services

    def unexpected_services() -> None:
        raise AssertionError("Workspace-only runs must not resolve personal connections.")

    monkeypatch.setattr(ext_application_services, "application_services", unexpected_services)
    with harness.base.sessions.begin() as session:
        app = session.get(App, harness.base.context.app_id)
        user = session.get(EndUser, harness.base.context.end_user_id)
        workflow = session.get(Workflow, harness.base.workflow_id)
        assert app is not None
        assert user is not None
        assert workflow is not None
        workflow.graph = json.dumps({"nodes": [], "edges": []})
    args: dict[str, object] = {}
    if selection != "omitted":
        choices: dict[str, str | None] = {}
        if selection != "empty":
            choices["removed-node"] = None if selection == "unused-null" else str(uuid4())
        args["connections"] = choices
    if pin != "missing":
        args["workflow_id"] = workflow.id if pin == "matching" else str(uuid4())
    if pin == "stale":
        with pytest.raises(ConnectionWorkflowChangedError):
            prepare_web_connection_execution(app=app, user=user, workflow=workflow, args=args)
    elif selection in {"unused", "unused-null"}:
        with pytest.raises(ConnectionConfigurationError):
            prepare_web_connection_execution(app=app, user=user, workflow=workflow, args=args)
    else:
        assert prepare_web_connection_execution(app=app, user=user, workflow=workflow, args=args) is None


@pytest.mark.parametrize("choices", [None, {}, {"tool-1": None}])
@pytest.mark.parametrize("saved_scope", ["app", "session"])
def test_missing_selection_never_uses_saved_defaults(
    harness: OAuthHarness,
    service: ConnectionExecutionService,
    choices: dict[str, str | None] | None,
    saved_scope: str,
) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    conversation_id = None
    with harness.base.sessions.begin() as session:
        session.add(
            AppConnection(
                tenant_id=harness.base.context.tenant_id,
                app_id=harness.base.context.app_id,
                workflow_id=harness.base.workflow_id,
                end_user_id=harness.base.context.end_user_id,
                node_id="tool-1",
                provider=connection.provider,
                connection_id=connection.id,
                source_run_id=str(uuid4()),
            )
        )
        if saved_scope == "session":
            session.execute(
                sa.update(App).where(App.id == harness.base.context.app_id).values(mode=AppMode.ADVANCED_CHAT)
            )
            conversation = Conversation(
                app_id=harness.base.context.app_id,
                mode=AppMode.ADVANCED_CHAT,
                name="Chat",
                from_source=ConversationFromSource.API,
                from_end_user_id=harness.base.context.end_user_id,
                from_account_id=None,
                invoke_from=InvokeFrom.WEB_APP,
                _inputs={},
                is_deleted=False,
            )
            session.add(conversation)
            session.flush()
            conversation_id = conversation.id
            session.add(
                SessionConnection(
                    tenant_id=harness.base.context.tenant_id,
                    app_id=harness.base.context.app_id,
                    workflow_id=harness.base.workflow_id,
                    session_id=conversation_id,
                    node_id="tool-1",
                    provider=connection.provider,
                    connection_id=connection.id,
                )
            )
    harness.base.auth.calls.clear()
    with pytest.raises(ConnectionRequiredError):
        service.prepare(
            harness.base.context,
            ConnectionRunInput.model_validate({"workflow_id": harness.base.workflow_id, "connections": choices}),
            workflow_id=harness.base.workflow_id,
            conversation_id=conversation_id,
        )
    assert harness.base.auth.calls == []
    with harness.base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(WorkflowRun)) == 0


def test_only_selected_connection_is_checked_without_saving_usage(
    harness: OAuthHarness, service: ConnectionExecutionService
) -> None:
    selected = harness.base.service.create_api_key(harness.base.context, harness.base.command("selected-key"))
    unused = harness.base.service.create_api_key(harness.base.context, harness.base.command("unused-key"))
    before = harness.base.repository.find(harness.base.context, unused.id)
    assert before is not None
    harness.base.auth.calls.clear()
    result = prepare(harness, service, {"tool-1": selected.id})
    assert result.selections[0].connection_id == selected.id
    assert [call[3] for call in harness.base.auth.calls] == [{"api_key": "selected-key"}]
    after = harness.base.repository.find(harness.base.context, unused.id)
    assert after is not None
    assert after.access.revision == before.access.revision
    checked = harness.base.repository.find(harness.base.context, selected.id)
    assert checked is not None
    assert checked.summary.last_active_at == selected.last_active_at
    with harness.base.sessions() as session:
        for model in (WorkflowRun, AppConnection, SessionConnection):
            assert session.scalar(sa.select(sa.func.count()).select_from(model)) == 0


@pytest.mark.parametrize("outcome", ["valid", "unsupported", "invalid", "temporarily_unavailable"])
def test_gate_uses_preflight_readiness_rules(
    harness: OAuthHarness, service: ConnectionExecutionService, outcome: str
) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    harness.base.auth.result = CredentialCheckResult.model_validate(
        {
            "status": outcome,
            "reason_code": None,
            "retryable": False,
            "checked_at": 1,
        }
    )
    error = {
        "invalid": ConnectionInvalidCredentialsError,
        "temporarily_unavailable": ConnectionCheckUnavailableError,
    }.get(outcome)
    if error is not None:
        with pytest.raises(error):
            prepare(harness, service, {"tool-1": connection.id})
    else:
        assert prepare(harness, service, {"tool-1": connection.id}).selections[0].connection_id == connection.id
    stored = harness.base.repository.find(harness.base.context, connection.id)
    assert stored is not None
    assert stored.access.credential_status == (
        ConnectionCredentialStatus.INVALID if outcome == "invalid" else ConnectionCredentialStatus.CONNECTED
    )


def test_previous_preflight_success_does_not_skip_execution_check(
    harness: OAuthHarness, service: ConnectionExecutionService, preflight: ConnectionPreflightService
) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    command = ConnectionPreflightInput.model_validate(
        {
            "workflow_id": harness.base.workflow_id,
            "connections": {"tool-1": connection.id},
        }
    )
    assert preflight.check(harness.base.context, command).ready
    harness.base.auth.calls.clear()
    harness.base.auth.result = CredentialCheckResult(status="invalid", reason_code=None, retryable=False, checked_at=1)
    with pytest.raises(ConnectionInvalidCredentialsError):
        prepare(harness, service, {"tool-1": connection.id})
    assert len(harness.base.auth.calls) == 1


@pytest.mark.parametrize("change", ["publication", "connection"])
def test_gate_rejects_changes_during_selected_connection_check(
    harness: OAuthHarness, service: ConnectionExecutionService, change: str
) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())

    def mutate() -> None:
        with harness.base.sessions.begin() as session:
            if change == "publication":
                session.execute(
                    sa.update(App).where(App.id == harness.base.context.app_id).values({"workflow_id": str(uuid4())})
                )
            else:
                session.execute(
                    sa.update(EndUserConnection).where(EndUserConnection.id == connection.id).values(revision=2)
                )

    harness.base.auth.on_check = mutate
    with pytest.raises(ConnectionWorkflowChangedError if change == "publication" else ConnectionConflictError):
        prepare(harness, service, {"tool-1": connection.id})


def test_gate_uses_existing_oauth_refresh(harness: OAuthHarness, service: ConnectionExecutionService) -> None:
    connection = harness.finish(harness.start())
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(EndUserConnection)
            .where(EndUserConnection.id == connection.id)
            .values(expires_at=datetime(2000, 1, 1))
        )
    result = prepare(harness, service, {"tool-1": connection.id})
    assert len(harness.handler.refreshes) == 1
    assert result.selections[0].connection_id == connection.id
    assert "new-access-secret" not in result.model_dump_json()


def test_gate_rejects_changed_oauth_client(harness: OAuthHarness, service: ConnectionExecutionService) -> None:
    connection = harness.finish(harness.start())
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(ToolOAuthTenantClient)
            .where(ToolOAuthTenantClient.id == harness.client_id)
            .values(encrypted_oauth_params='{"client_id":"other-client"}')
        )
    harness.base.auth.calls.clear()
    with pytest.raises(ConnectionReauthorizationRequiredError):
        prepare(harness, service, {"tool-1": connection.id})
    assert harness.base.auth.calls == []
    assert harness.handler.refreshes == []
