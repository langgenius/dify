import json
from copy import deepcopy
from dataclasses import replace
from datetime import datetime
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from clients.plugin.auth_entities import CredentialCheckResult
from constants.end_user_connections import NodeConnectionStatus
from models.end_user_connection import AppConnection, EndUserConnection, SessionConnection
from models.enums import ConversationFromSource, InvokeFrom
from models.model import App, AppMode, Conversation, EndUser
from models.tools import ToolOAuthTenantClient
from models.workflow import Workflow, WorkflowRun, WorkflowType
from services.end_user_connection_preflight_adapters import PublishedPreflightRequirements
from services.end_user_connections.contracts import ConnectionCheckOutcome
from services.end_user_connections.entities import WebConnectionContext
from services.end_user_connections.errors import (
    ConnectionConfigurationError,
    ConnectionConflictError,
    ConnectionWorkflowChangedError,
)
from services.end_user_connections.preflight import ConnectionPreflightInput, ConnectionPreflightService
from services.errors.conversation import ConversationNotExistsError
from tests.helpers.end_user_api_key import make_harness
from tests.helpers.end_user_oauth import OAuthHarness, make_oauth_harness


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> OAuthHarness:
    return make_oauth_harness(sqlite_session_factory, monkeypatch)


@pytest.fixture
def service(harness: OAuthHarness) -> ConnectionPreflightService:
    return ConnectionPreflightService(
        connections=harness.base.repository,
        checks=harness.base.service,
        requirements=PublishedPreflightRequirements(
            workflows=harness.base.repository,
            providers=harness.providers,
            oauth=harness.gateway,
        ),
    )


def command(harness: OAuthHarness, selections: dict[str, str | None]) -> ConnectionPreflightInput:
    return ConnectionPreflightInput.model_validate({"workflow_id": harness.base.workflow_id, "connections": selections})


def add_node(harness: OAuthHarness, *, reuse: bool) -> None:
    with harness.base.sessions.begin() as session:
        workflow = session.get(Workflow, harness.base.workflow_id)
        assert workflow is not None
        graph = workflow.graph_dict
        node = deepcopy(graph["nodes"][0])
        node["id"] = "tool-2"
        if reuse:
            node["data"].pop("end_user_auth")
            node["data"].update(credential_source="reuse_node", reuse_node_id="tool-1")
        graph["nodes"].append(node)
        workflow.graph = json.dumps(graph)


def test_empty_selection_checks_explicit_version_without_credentials_or_run(
    harness: OAuthHarness, service: ConnectionPreflightService
) -> None:
    result = service.check(harness.base.context, command(harness, {}))
    assert result.workflow_id == harness.base.workflow_id
    assert not result.ready
    assert result.requirements[0].status == NodeConnectionStatus.DISCONNECTED
    assert result.requirements[0].connection_id is None
    assert result.requirements[0].check is None
    assert harness.base.auth.calls == []
    with harness.base.sessions() as session:
        for model in (WorkflowRun, AppConnection, SessionConnection, EndUserConnection):
            assert session.scalar(sa.select(sa.func.count()).select_from(model)) == 0


def test_same_connection_is_checked_once_for_independent_nodes(
    harness: OAuthHarness, service: ConnectionPreflightService
) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    add_node(harness, reuse=False)
    harness.base.auth.calls.clear()
    result = service.check(harness.base.context, command(harness, {"tool-1": connection.id, "tool-2": connection.id}))
    assert result.ready
    assert len(result.requirements) == 2
    assert len(harness.base.auth.calls) == 1
    assert all(item.connection_id == connection.id for item in result.requirements)
    assert "original-secret" not in result.model_dump_json()
    assert "revision" not in result.model_dump_json()


def test_reuse_nodes_share_root_requirement_without_provider_wide_merging(
    harness: OAuthHarness, service: ConnectionPreflightService
) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    add_node(harness, reuse=True)
    result = service.check(harness.base.context, command(harness, {"tool-1": connection.id}))
    assert result.ready
    assert len(result.requirements) == 1
    assert result.requirements[0].node_ids == ("tool-1", "tool-2")
    with pytest.raises(ConnectionConfigurationError):
        service.check(harness.base.context, command(harness, {"tool-2": connection.id}))


@pytest.mark.parametrize("status", ["valid", "invalid", "unsupported", "temporarily_unavailable"])
def test_preflight_preserves_check_outcomes(
    harness: OAuthHarness, service: ConnectionPreflightService, status: str
) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    harness.base.auth.result = CredentialCheckResult.model_validate(
        {"status": status, "reason_code": None, "retryable": False, "checked_at": 1}
    )
    result = service.check(harness.base.context, command(harness, {"tool-1": connection.id}))
    item = result.requirements[0]
    assert item.check is not None
    assert item.check.status == status
    assert result.ready == (status in {"valid", "unsupported"})
    if status == "temporarily_unavailable":
        assert item.status is None
    if status == "invalid":
        assert item.status == NodeConnectionStatus.INVALID
    stored = harness.base.repository.find(harness.base.context, connection.id)
    assert stored is not None
    assert stored.summary.last_active_at == connection.last_active_at


@pytest.mark.parametrize("same_tenant", [False, True])
def test_foreign_connection_and_missing_id_are_indistinguishable(
    harness: OAuthHarness, service: ConnectionPreflightService, same_tenant: bool
) -> None:
    other = make_harness(harness.base.sessions)
    connection = other.service.create_api_key(other.context, other.command())
    if same_tenant:
        with harness.base.sessions.begin() as session:
            session.execute(
                sa.update(EndUserConnection)
                .where(EndUserConnection.id == connection.id)
                .values(tenant_id=harness.base.context.tenant_id)
            )
    foreign = service.check(harness.base.context, command(harness, {"tool-1": connection.id}))
    missing = service.check(harness.base.context, command(harness, {"tool-1": str(uuid4())}))
    assert foreign == missing
    assert harness.base.auth.calls == []


def test_saved_defaults_are_not_execution_selection_fallback(
    harness: OAuthHarness, service: ConnectionPreflightService
) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
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
    result = service.check(harness.base.context, command(harness, {}))
    assert not result.ready
    assert result.requirements[0].connection_id is None
    with harness.base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(AppConnection)) == 1


def test_oauth_check_uses_post_refresh_revision_and_preserves_activity(
    harness: OAuthHarness, service: ConnectionPreflightService
) -> None:
    connection = harness.finish(harness.start())
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(EndUserConnection)
            .where(EndUserConnection.id == connection.id)
            .values(expires_at=datetime(2000, 1, 1))
        )
    result = service.check(harness.base.context, command(harness, {"tool-1": connection.id}))
    assert result.ready
    assert len(harness.handler.refreshes) == 1
    stored = harness.base.repository.find(harness.base.context, connection.id)
    assert stored is not None
    assert stored.access.revision == 2
    assert stored.summary.last_active_at == connection.last_active_at


def test_oauth_client_change_is_reconnect_required_without_mutating_grant(
    harness: OAuthHarness, service: ConnectionPreflightService
) -> None:
    connection = harness.finish(harness.start())
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(ToolOAuthTenantClient)
            .where(ToolOAuthTenantClient.id == harness.client_id)
            .values(encrypted_oauth_params='{"client_id":"new-client"}')
        )
    result = service.check(harness.base.context, command(harness, {"tool-1": connection.id}))
    assert not result.ready
    assert result.requirements[0].status == NodeConnectionStatus.RECONNECT_REQUIRED
    assert harness.base.auth.calls == []
    stored = harness.base.repository.find(harness.base.context, connection.id)
    assert stored is not None
    assert stored.access.revision == 1


@pytest.mark.parametrize("change", ["version", "graph", "connection"])
def test_changes_during_checks_cannot_produce_ready(
    harness: OAuthHarness, service: ConnectionPreflightService, change: str
) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())

    def mutate() -> None:
        with harness.base.sessions.begin() as session:
            if change == "version":
                session.execute(
                    sa.update(App).where(App.id == harness.base.context.app_id).values({"workflow_id": str(uuid4())})
                )
            elif change == "connection":
                session.execute(
                    sa.update(EndUserConnection).where(EndUserConnection.id == connection.id).values(revision=2)
                )
            else:
                workflow = session.get(Workflow, harness.base.workflow_id)
                assert workflow is not None
                graph = workflow.graph_dict
                graph["nodes"][0]["data"]["end_user_auth"]["purpose"] = "Changed purpose"
                workflow.graph = json.dumps(graph)

    harness.base.auth.on_check = mutate
    with pytest.raises(ConnectionWorkflowChangedError if change == "version" else ConnectionConflictError):
        service.check(harness.base.context, command(harness, {"tool-1": connection.id}))


def conversation(harness: OAuthHarness) -> str:
    with harness.base.sessions.begin() as session:
        session.execute(sa.update(App).where(App.id == harness.base.context.app_id).values(mode=AppMode.ADVANCED_CHAT))
        session.execute(
            sa.update(Workflow).where(Workflow.id == harness.base.workflow_id).values(type=WorkflowType.CHAT)
        )
        row = Conversation(
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
        session.add(row)
        session.flush()
        return row.id


def test_existing_chatflow_session_is_validated_even_with_empty_selections(
    harness: OAuthHarness, service: ConnectionPreflightService
) -> None:
    conversation_id = conversation(harness)
    payload = command(harness, {}).model_copy(update={"conversation_id": uuid4()})
    with pytest.raises(ConversationNotExistsError):
        service.check(harness.base.context, payload)
    payload = ConnectionPreflightInput.model_validate(
        {"workflow_id": harness.base.workflow_id, "conversation_id": conversation_id, "connections": {}}
    )
    assert not service.check(harness.base.context, payload).ready
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(Conversation).where(Conversation.id == conversation_id).values({"from_end_user_id": str(uuid4())})
        )
    with pytest.raises(ConversationNotExistsError):
        service.check(harness.base.context, payload)


def test_two_conversations_check_independent_choices_without_persisting_selections(
    harness: OAuthHarness, service: ConnectionPreflightService
) -> None:
    first = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    second = harness.base.service.create_api_key(harness.base.context, harness.base.command("second-secret"))
    for connection in (first, second):
        conversation_id = conversation(harness)
        payload = ConnectionPreflightInput.model_validate(
            {
                "workflow_id": harness.base.workflow_id,
                "conversation_id": conversation_id,
                "connections": {"tool-1": connection.id},
            }
        )
        result = service.check(harness.base.context, payload)
        assert result.ready
        assert result.requirements[0].connection_id == connection.id
    with harness.base.sessions() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(SessionConnection)) == 0
        assert session.scalar(sa.select(sa.func.count()).select_from(AppConnection)) == 0
        assert session.scalar(sa.select(sa.func.count()).select_from(WorkflowRun)) == 0


def test_guest_can_inspect_requirements_without_enabling_connection_creation(
    harness: OAuthHarness, service: ConnectionPreflightService
) -> None:
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(EndUser).where(EndUser.id == harness.base.context.end_user_id).values(account_id=None)
        )
    guest = replace(harness.base.context, account_id=None)
    assert not service.check(guest, command(harness, {})).ready


def test_plain_workflow_rejects_unowned_session_uuid(
    harness: OAuthHarness, service: ConnectionPreflightService
) -> None:
    with pytest.raises(ConnectionConfigurationError):
        service.check(harness.base.context, command(harness, {}).model_copy(update={"conversation_id": uuid4()}))


def test_replacement_after_check_completion_cannot_reuse_old_validation(
    harness: OAuthHarness, service: ConnectionPreflightService, monkeypatch: pytest.MonkeyPatch
) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    original = harness.base.service.check_connection_result

    def check(context: WebConnectionContext, connection_id: str) -> ConnectionCheckOutcome:
        outcome = original(context, connection_id)
        with harness.base.sessions.begin() as session:
            session.execute(
                sa.update(EndUserConnection)
                .where(EndUserConnection.id == connection_id)
                .values(revision=outcome.revision + 1)
            )
        return outcome

    monkeypatch.setattr(harness.base.service, "check_connection_result", check)
    with pytest.raises(ConnectionConflictError):
        service.check(harness.base.context, command(harness, {"tool-1": connection.id}))


def test_workspace_only_graph_requires_no_personal_connections(
    harness: OAuthHarness, service: ConnectionPreflightService
) -> None:
    with harness.base.sessions.begin() as session:
        workflow = session.get(Workflow, harness.base.workflow_id)
        assert workflow is not None
        graph = workflow.graph_dict
        graph["nodes"][0]["data"].pop("end_user_auth")
        graph["nodes"][0]["data"]["credential_source"] = "workspace"
        workflow.graph = json.dumps(graph)
    result = service.check(harness.base.context, command(harness, {}))
    assert result.ready
    assert result.requirements == ()
    assert harness.base.auth.calls == []


def test_foreign_provider_selection_is_rejected_before_check(
    harness: OAuthHarness, service: ConnectionPreflightService
) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    with harness.base.sessions.begin() as session:
        session.execute(
            sa.update(EndUserConnection)
            .where(EndUserConnection.id == connection.id)
            .values(provider="vendor/other/other")
        )
    harness.base.auth.calls.clear()
    with pytest.raises(ConnectionConfigurationError):
        service.check(harness.base.context, command(harness, {"tool-1": connection.id}))
    assert harness.base.auth.calls == []


def test_conversation_deleted_during_check_cannot_produce_ready(
    harness: OAuthHarness, service: ConnectionPreflightService
) -> None:
    connection = harness.base.service.create_api_key(harness.base.context, harness.base.command())
    conversation_id = conversation(harness)

    def delete() -> None:
        with harness.base.sessions.begin() as session:
            session.execute(sa.update(Conversation).where(Conversation.id == conversation_id).values(is_deleted=True))

    harness.base.auth.on_check = delete
    payload = ConnectionPreflightInput.model_validate(
        {
            "workflow_id": harness.base.workflow_id,
            "conversation_id": conversation_id,
            "connections": {"tool-1": connection.id},
        }
    )
    with pytest.raises(ConversationNotExistsError):
        service.check(harness.base.context, payload)
