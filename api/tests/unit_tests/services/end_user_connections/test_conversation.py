import json
from copy import deepcopy
from dataclasses import replace
from types import SimpleNamespace
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from clients.plugin.auth_entities import CredentialCheckResult
from constants.end_user_connections import ConnectionCredentialStatus
from core.app.app_config.entities import AppAdditionalFeatures, WorkflowUIBasedAppConfig
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom
from extensions import ext_application_services
from models.end_user_connection import EndUserConnection, SessionConnection
from models.model import App, AppMode, Conversation, EndUser, Message
from models.tools import ToolOAuthTenantClient
from models.workflow import Workflow
from services.end_user_connections.errors import (
    ConnectionConfigurationError,
    ConnectionConflictError,
    ConnectionIdentityError,
    ConnectionInvalidCredentialsError,
    ConnectionNotFoundError,
    ConnectionReauthorizationRequiredError,
    ConnectionRequiredError,
    ConnectionWorkflowChangedError,
)
from services.errors.conversation import ConversationNotExistsError
from tests.helpers.end_user_conversation import ConversationHarness, make_conversation_harness
from tests.helpers.end_user_oauth import make_oauth_harness


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> ConversationHarness:
    harness = make_conversation_harness(make_oauth_harness(sqlite_session_factory, monkeypatch))
    monkeypatch.setattr(
        ext_application_services,
        "application_services",
        lambda: SimpleNamespace(
            end_user_connection_execution=harness.execution, conversation_connections=harness.service
        ),
    )
    return harness


def test_conversations_restore_their_own_last_accepted_choices(harness: ConversationHarness) -> None:
    base = harness.oauth.base
    first = base.service.create_api_key(base.context, base.command("first-secret"))
    second = base.service.create_api_key(base.context, base.command("second-secret"))
    a, b = harness.create_conversation(), harness.create_conversation()
    original = harness.run(a, {"tool-1": first.id})
    harness.run(b, {"tool-1": second.id})
    base.auth.calls.clear()
    assert harness.run(a).selections[0].connection_id == first.id
    assert harness.run(b).selections[0].connection_id == second.id
    assert len(base.auth.calls) == 2
    harness.run(a, {"tool-1": second.id})
    assert harness.run(a).selections[0].connection_id == second.id
    assert original.selections[0].connection_id == first.id
    assert harness.saved(a) == {"tool-1": second.id}


def test_omitted_first_selection_and_explicit_empty_selection_are_rejected(harness: ConversationHarness) -> None:
    base = harness.oauth.base
    with pytest.raises(ConnectionRequiredError):
        harness.run(None)
    conversation_id = harness.create_conversation()
    with pytest.raises(ConnectionRequiredError):
        harness.run(conversation_id)
    connection = base.service.create_api_key(base.context, base.command())
    harness.run(conversation_id, {"tool-1": connection.id})
    empty_choices: list[dict[str, str | None]] = [{}, {"tool-1": None}]
    for choices in empty_choices:
        with pytest.raises(ConnectionRequiredError):
            harness.run(conversation_id, choices)
    assert harness.saved(conversation_id) == {"tool-1": connection.id}


@pytest.mark.parametrize("field", ["from_end_user_id", "app_id", "is_deleted"])
def test_empty_conversations_still_require_ownership(harness: ConversationHarness, field: str) -> None:
    conversation_id = harness.create_conversation()
    with harness.sessions.begin() as session:
        session.execute(
            sa.update(Conversation)
            .where(Conversation.id == conversation_id)
            .values({field: True if field == "is_deleted" else str(uuid4())})
        )
    with pytest.raises(ConversationNotExistsError):
        harness.run(conversation_id)


def test_explicit_choices_do_not_merge_missing_nodes_or_select_reuse_nodes(harness: ConversationHarness) -> None:
    base = harness.oauth.base
    with harness.sessions.begin() as session:
        workflow = session.get(Workflow, base.workflow_id)
        assert workflow is not None
        graph = workflow.graph_dict
        independent = deepcopy(graph["nodes"][0])
        independent["id"] = "tool-2"
        child = deepcopy(graph["nodes"][0])
        child["id"] = "child"
        child["data"].update(credential_source="reuse_node", reuse_node_id="tool-1")
        child["data"].pop("end_user_auth")
        graph["nodes"].extend([independent, child])
        workflow.graph = json.dumps(graph)
    a = base.service.create_api_key(base.context, base.command("a"))
    b = base.service.create_api_key(base.context, base.command("b"))
    conversation_id = harness.create_conversation()
    harness.run(conversation_id, {"tool-1": a.id, "tool-2": b.id})
    assert {item.node_id: item.connection_id for item in harness.run(conversation_id).selections} == {
        "tool-1": a.id,
        "tool-2": b.id,
    }
    with pytest.raises(ConnectionRequiredError):
        harness.run(conversation_id, {"tool-1": b.id})
    for key in ["child", "missing"]:
        with pytest.raises(ConnectionConfigurationError):
            harness.run(conversation_id, {"tool-1": a.id, "tool-2": b.id, key: a.id})
    assert harness.saved(conversation_id) == {"tool-1": a.id, "tool-2": b.id}


def test_workflow_changes_require_explicit_reconfirmation(harness: ConversationHarness) -> None:
    base = harness.oauth.base
    connection = base.service.create_api_key(base.context, base.command())
    conversation_id = harness.create_conversation()
    accepted = harness.run(conversation_id, {"tool-1": connection.id})
    with harness.sessions.begin() as session:
        old = session.get(Workflow, base.workflow_id)
        assert old is not None
        new = Workflow(
            tenant_id=old.tenant_id,
            app_id=old.app_id,
            type=old.type,
            version="next",
            graph=old.graph,
            _features=old.features,
            created_by=old.created_by,
        )
        session.add(new)
        session.flush()
        base.workflow_id = new.id
        session.execute(sa.update(App).where(App.id == base.context.app_id).values({"workflow_id": new.id}))
    with pytest.raises(ConnectionWorkflowChangedError):
        harness.run(conversation_id)
    confirmed = harness.run(conversation_id, {"tool-1": connection.id})
    assert confirmed.workflow_id == base.workflow_id
    assert accepted.workflow_id != confirmed.workflow_id
    assert harness.run(conversation_id).workflow_id == confirmed.workflow_id


@pytest.mark.parametrize("change", ["owner", "invalid", "delete"])
def test_reuse_rechecks_connection_ownership_and_validity(harness: ConversationHarness, change: str) -> None:
    base = harness.oauth.base
    connection = base.service.create_api_key(base.context, base.command())
    conversation_id = harness.create_conversation()
    harness.run(conversation_id, {"tool-1": connection.id})
    with harness.sessions.begin() as session:
        if change == "delete":
            # Mirror the production FK cascade in this SQLite harness.
            session.execute(sa.delete(SessionConnection).where(SessionConnection.connection_id == connection.id))
            session.execute(sa.delete(EndUserConnection).where(EndUserConnection.id == connection.id))
        else:
            values = (
                {"account_id": str(uuid4())} if change == "owner" else {"status": ConnectionCredentialStatus.INVALID}
            )
            session.execute(sa.update(EndUserConnection).where(EndUserConnection.id == connection.id).values(**values))
    if change == "invalid":
        base.auth.result = CredentialCheckResult(status="invalid", reason_code=None, retryable=False, checked_at=1)
    expected = {
        "owner": ConnectionNotFoundError,
        "invalid": ConnectionInvalidCredentialsError,
        "delete": ConnectionRequiredError,
    }[change]
    with pytest.raises(expected):
        harness.run(conversation_id)


def test_reuse_checks_current_oauth_client(harness: ConversationHarness) -> None:
    connection = harness.oauth.finish(harness.oauth.start())
    conversation_id = harness.create_conversation()
    harness.run(conversation_id, {"tool-1": connection.id})
    with harness.sessions.begin() as session:
        session.execute(
            sa.update(ToolOAuthTenantClient)
            .where(ToolOAuthTenantClient.id == harness.oauth.client_id)
            .values(encrypted_oauth_params=json.dumps({"client_id": "different-client"}))
        )
    with pytest.raises(ConnectionReauthorizationRequiredError):
        harness.run(conversation_id)


def test_reused_request_never_overwrites_a_newer_explicit_selection(harness: ConversationHarness) -> None:
    base = harness.oauth.base
    first = base.service.create_api_key(base.context, base.command("a"))
    second = base.service.create_api_key(base.context, base.command("b"))
    conversation_id = harness.create_conversation()
    harness.run(conversation_id, {"tool-1": first.id})

    def accept_new_selection() -> None:
        harness.run(conversation_id, {"tool-1": second.id})

    base.auth.on_check = accept_new_selection
    reused = harness.run(conversation_id)
    assert reused.selections[0].connection_id == first.id
    assert harness.saved(conversation_id) == {"tool-1": second.id}


def generate_entity(harness: ConversationHarness, connection_id: str) -> AdvancedChatAppGenerateEntity:
    base = harness.oauth.base
    return AdvancedChatAppGenerateEntity.model_validate(
        {
            "task_id": "task",
            "app_config": WorkflowUIBasedAppConfig(
                tenant_id=base.context.tenant_id,
                app_id=base.context.app_id,
                workflow_id=base.workflow_id,
                app_mode=AppMode.ADVANCED_CHAT,
                additional_features=AppAdditionalFeatures(),
            ),
            "user_id": base.context.end_user_id,
            "inputs": {},
            "query": "hello",
            "files": [],
            "stream": True,
            "invoke_from": InvokeFrom.WEB_APP,
            "connection_context": harness.run(None, {"tool-1": connection_id}),
        }
    )


@pytest.mark.parametrize("deleted", [False, True])
def test_initial_configuration_is_atomic_and_existing_worker_does_not_save(
    harness: ConversationHarness, deleted: bool
) -> None:
    base = harness.oauth.base
    first = base.service.create_api_key(base.context, base.command("a"))
    second = base.service.create_api_key(base.context, base.command("b"))
    entity = generate_entity(harness, first.id)
    if deleted:
        base.service.delete_connection(base.context, first.id)
    with harness.sessions() as session:
        if deleted:
            with pytest.raises(ConnectionConflictError):
                MessageBasedAppGenerator()._init_generate_records(entity, session=session)
            assert session.scalar(sa.select(sa.func.count()).select_from(Conversation)) == 0
            assert session.scalar(sa.select(sa.func.count()).select_from(Message)) == 0
        else:
            conversation, _ = MessageBasedAppGenerator()._init_generate_records(entity, session=session)
            assert harness.saved(conversation.id) == {"tool-1": first.id}
            harness.run(conversation.id, {"tool-1": second.id})
            MessageBasedAppGenerator()._init_generate_records(entity, conversation, session=session)
            assert harness.saved(conversation.id) == {"tool-1": second.id}
            assert harness.run(conversation.id).selections[0].connection_id == second.id


def test_guest_can_restore_only_its_own_choices(harness: ConversationHarness) -> None:
    base = harness.oauth.base
    with harness.sessions.begin() as session:
        session.execute(sa.update(EndUser).where(EndUser.id == base.context.end_user_id).values({"account_id": None}))
    base.context = replace(base.context, account_id=None)
    connection = base.service.create_api_key(base.context, base.command())
    conversation_id = harness.create_conversation()
    harness.run(conversation_id, {"tool-1": connection.id})
    assert harness.run(conversation_id).selections[0].connection_id == connection.id
    with harness.sessions.begin() as session:
        session.execute(
            sa.update(EndUser).where(EndUser.id == base.context.end_user_id).values({"account_id": str(uuid4())})
        )
    with pytest.raises(ConnectionIdentityError):
        harness.saved(conversation_id)


def test_first_conversation_keeps_accepted_version_after_publication(harness: ConversationHarness) -> None:
    base = harness.oauth.base
    connection = base.service.create_api_key(base.context, base.command())
    entity = generate_entity(harness, connection.id)
    with harness.sessions.begin() as session:
        session.execute(sa.update(App).where(App.id == base.context.app_id).values({"workflow_id": str(uuid4())}))
    with harness.sessions() as session:
        conversation, _ = MessageBasedAppGenerator()._init_generate_records(entity, session=session)
        saved = session.scalar(sa.select(SessionConnection).where(SessionConnection.session_id == conversation.id))
        assert saved is not None
        assert saved.workflow_id == base.workflow_id
        assert saved.connection_id == connection.id
