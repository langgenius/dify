import json
from collections.abc import Mapping
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

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
from models.end_user_connection import EndUserConnection
from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation, EndUser
from models.workflow import Workflow
from services.end_user_connection_execution_adapters import (
    prepare_web_connection_execution,
    validate_connection_execution,
)
from services.end_user_connection_preflight_adapters import PublishedPreflightRequirements
from services.end_user_connections.errors import (
    ConnectionConfigurationError,
    ConnectionIdentityError,
    ConnectionNotFoundError,
    ConnectionWorkflowChangedError,
)
from services.end_user_connections.execution import (
    ConnectionExecutionService,
    ConnectionRunInput,
)
from services.errors.conversation import ConversationNotExistsError
from tasks.app_generate.workflow_execute_task import AppExecutionParams
from tests.helpers.end_user_api_key import make_harness
from tests.helpers.end_user_oauth import OAuthHarness, make_oauth_harness


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> OAuthHarness:
    return make_oauth_harness(sqlite_session_factory, monkeypatch)


@pytest.fixture
def service(harness: OAuthHarness) -> ConnectionExecutionService:
    return ConnectionExecutionService(
        connections=harness.base.repository,
        requirements=PublishedPreflightRequirements(
            workflows=harness.base.repository, providers=harness.providers, oauth=harness.gateway
        ),
    )


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


def test_explicit_selection_is_immutable_and_does_not_check_or_copy_secrets(
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
    assert prepare(harness, service, {}).selections[0].connection_id is None
    assert prepare(harness, service, {"tool-1": None}).selections[0].connection_id is None
    serialized = context.model_dump_json()
    assert "original-secret" not in serialized
    assert "encrypted_credentials" not in serialized
    assert "revision" not in serialized
    assert ConnectionExecutionContext.model_validate_json(serialized) == context
    assert harness.base.auth.calls == []


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
    context = prepare(harness, service, {"tool-1": connection.id})
    assert context.selections[0].node_ids == ("tool-1", "reused")
    assert context.selections[1].node_id == "independent"
    assert context.selections[1].connection_id is None
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
    context = prepare(harness, service, {})
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
    assert prepare(harness, service, {}, conversation_id).conversation_id == conversation_id
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(Conversation).where(Conversation.id == conversation_id).values({"from_end_user_id": str(uuid4())})
        )
    with pytest.raises(ConversationNotExistsError):
        prepare(harness, service, {}, conversation_id)


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
    params = AppExecutionParams.new(app, workflow, user, {"inputs": {}}, InvokeFrom.WEB_APP, connection_context=context)
    restored = AppExecutionParams.model_validate_json(params.model_dump_json())
    assert restored.connection_context == context
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
        AdvancedChatAppGenerateEntity.model_validate({**entity_args, "query": "hello", "conversation_id": None})
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
            "connections": {},
            "tenant_id": "foreign",
            "account_id": "foreign",
            "connection_context": {"identity": "foreign"},
        },
    )
    assert context is not None
    assert context.tenant_id == harness.base.context.tenant_id
    assert context.end_user_id == harness.base.context.end_user_id
    assert context.account_id == harness.base.context.account_id
