from dataclasses import replace
from typing import Literal

import pytest
from pydantic import ValidationError

from clients.plugin.auth_entities import CredentialCheckResult
from constants.end_user_connections import (
    ConnectionCredentialStatus,
    ConnectionCredentialType,
    NodeConnectionStatus,
    OAuthClientSource,
)
from services.end_user_connections.contracts import NodeConnectionState
from services.end_user_connections.entities import (
    ConnectionAccessRecord,
    ConnectionCheckSnapshot,
    ConnectionOAuthClient,
    ConnectionOwner,
    NodeConnectionSelection,
    ToolConnectionTarget,
    WebConnectionContext,
)
from services.end_user_connections.errors import (
    ConnectionCheckUnavailableError,
    ConnectionConfigurationError,
    ConnectionConflictError,
    ConnectionWorkflowChangedError,
)
from services.end_user_connections.status import resolve_node_connection_state

CheckStatus = Literal["valid", "invalid", "unsupported", "temporarily_unavailable"]


@pytest.fixture
def context() -> WebConnectionContext:
    return WebConnectionContext(tenant_id="tenant", app_id="app", end_user_id="user", account_id="account")


@pytest.fixture
def client() -> ConnectionOAuthClient:
    return ConnectionOAuthClient(
        source=OAuthClientSource.WORKSPACE, configuration_id="client-config", client_id="client"
    )


@pytest.fixture
def record(context: WebConnectionContext, client: ConnectionOAuthClient) -> ConnectionAccessRecord:
    return ConnectionAccessRecord(
        id="connection",
        tenant_id=context.tenant_id,
        owner=context.owner,
        provider="vendor/calendar/calendar",
        credential_type=ConnectionCredentialType.OAUTH2,
        credential_status=ConnectionCredentialStatus.CONNECTED,
        oauth_client=client,
        revision=3,
    )


@pytest.fixture
def target(context: WebConnectionContext, client: ConnectionOAuthClient) -> ToolConnectionTarget:
    return ToolConnectionTarget(
        tenant_id=context.tenant_id,
        app_id=context.app_id,
        workflow_id="published-version",
        node_id="node-1",
        provider="vendor/calendar/calendar",
        allowed_credential_types=frozenset(ConnectionCredentialType),
        provider_credential_types=frozenset(ConnectionCredentialType),
        oauth_client=client,
    )


@pytest.fixture
def selection(record: ConnectionAccessRecord, target: ToolConnectionTarget) -> NodeConnectionSelection:
    return NodeConnectionSelection(workflow_id=target.workflow_id, node_id=target.node_id, connection_id=record.id)


def checked(record: ConnectionAccessRecord, status: CheckStatus) -> ConnectionCheckSnapshot:
    return ConnectionCheckSnapshot(
        connection_id=record.id,
        revision=record.revision,
        result=CredentialCheckResult(status=status, checked_at=1792540800, reason_code=None, retryable=False),
    )


@pytest.mark.parametrize("case", ["unselected", "deleted", "tenant", "owner", "wrong-record"])
def test_disconnected_selections_do_not_expose_or_fall_back_to_connections(
    context: WebConnectionContext,
    target: ToolConnectionTarget,
    selection: NodeConnectionSelection,
    record: ConnectionAccessRecord,
    case: str,
) -> None:
    selected = replace(selection, connection_id=None) if case == "unselected" else selection
    candidates = {
        "unselected": record,
        "deleted": None,
        "tenant": replace(record, tenant_id="another-tenant"),
        "owner": replace(record, owner=ConnectionOwner(account_id="another-account", end_user_id=None)),
        "wrong-record": replace(record, id="another-connection"),
    }
    state = resolve_node_connection_state(
        context, selection=selected, target=target, record=candidates[case], check=checked(record, "invalid")
    )
    assert state.model_dump() == {
        "workflow_id": target.workflow_id,
        "node_id": target.node_id,
        "connection_id": None,
        "status": NodeConnectionStatus.DISCONNECTED,
        "check": None,
    }


@pytest.mark.parametrize("check_status", ["valid", "unsupported"])
def test_connected_requires_compatible_selection_and_a_completed_check(
    context: WebConnectionContext,
    target: ToolConnectionTarget,
    selection: NodeConnectionSelection,
    record: ConnectionAccessRecord,
    check_status: CheckStatus,
) -> None:
    check = checked(record, check_status)
    state = resolve_node_connection_state(context, selection=selection, target=target, record=record, check=check)
    assert state.status == NodeConnectionStatus.CONNECTED
    assert state.connection_id == record.id
    assert state.check == check.result


@pytest.mark.parametrize("credential_type", list(ConnectionCredentialType))
def test_definite_remote_invalidity_is_projected_without_mutating_the_record(
    context: WebConnectionContext,
    target: ToolConnectionTarget,
    selection: NodeConnectionSelection,
    record: ConnectionAccessRecord,
    credential_type: ConnectionCredentialType,
) -> None:
    record = replace(
        record,
        credential_type=credential_type,
        oauth_client=record.oauth_client if credential_type == "oauth2" else None,
    )
    state = resolve_node_connection_state(
        context, selection=selection, target=target, record=record, check=checked(record, "invalid")
    )
    assert state.status == NodeConnectionStatus.INVALID
    assert record.credential_status == ConnectionCredentialStatus.CONNECTED


@pytest.mark.parametrize("check_status", [None, "temporarily_unavailable"])
def test_missing_or_transient_check_is_not_invalidity_or_readiness(
    context: WebConnectionContext,
    target: ToolConnectionTarget,
    selection: NodeConnectionSelection,
    record: ConnectionAccessRecord,
    check_status: CheckStatus | None,
) -> None:
    check = checked(record, check_status) if check_status is not None else None
    with pytest.raises(ConnectionCheckUnavailableError):
        resolve_node_connection_state(context, selection=selection, target=target, record=record, check=check)
    assert record.credential_status == ConnectionCredentialStatus.CONNECTED


@pytest.mark.parametrize(
    ("credential_status", "node_status"),
    [
        (ConnectionCredentialStatus.INVALID, NodeConnectionStatus.INVALID),
        (ConnectionCredentialStatus.RECONNECT_REQUIRED, NodeConnectionStatus.RECONNECT_REQUIRED),
    ],
)
@pytest.mark.parametrize("check_status", [None, "valid", "unsupported", "temporarily_unavailable"])
def test_projection_does_not_revive_a_stored_credential_before_lifecycle_repair(
    context: WebConnectionContext,
    target: ToolConnectionTarget,
    selection: NodeConnectionSelection,
    record: ConnectionAccessRecord,
    credential_status: ConnectionCredentialStatus,
    node_status: NodeConnectionStatus,
    check_status: CheckStatus | None,
) -> None:
    record = replace(record, credential_status=credential_status)
    state = resolve_node_connection_state(
        context,
        selection=selection,
        target=target,
        record=record,
        check=checked(record, check_status) if check_status is not None else None,
    )
    assert state.status == node_status
    assert record.credential_status == credential_status


@pytest.mark.parametrize("client_available", [True, False])
def test_client_change_in_one_app_does_not_change_another_apps_state(
    context: WebConnectionContext,
    target: ToolConnectionTarget,
    selection: NodeConnectionSelection,
    record: ConnectionAccessRecord,
    client: ConnectionOAuthClient,
    client_available: bool,
) -> None:
    app_a = resolve_node_connection_state(
        context,
        selection=selection,
        target=replace(
            target, oauth_client=replace(client, configuration_id="new-client") if client_available else None
        ),
        record=record,
        check=None,
    )
    app_b_context = replace(context, app_id="app-b", end_user_id="user-in-app-b")
    app_b = resolve_node_connection_state(
        app_b_context,
        selection=selection,
        target=replace(target, app_id=app_b_context.app_id),
        record=record,
        check=checked(record, "valid"),
    )
    assert app_a.status == NodeConnectionStatus.RECONNECT_REQUIRED
    assert app_b.status == NodeConnectionStatus.CONNECTED
    assert record.credential_status == ConnectionCredentialStatus.CONNECTED


@pytest.mark.parametrize("mismatch", ["connection", "revision"])
def test_check_cannot_be_reused_after_another_connection_or_credential_revision(
    context: WebConnectionContext,
    target: ToolConnectionTarget,
    selection: NodeConnectionSelection,
    record: ConnectionAccessRecord,
    mismatch: str,
) -> None:
    check = checked(record, "valid")
    check = replace(check, connection_id="other") if mismatch == "connection" else replace(check, revision=2)
    with pytest.raises(ConnectionConflictError):
        resolve_node_connection_state(context, selection=selection, target=target, record=record, check=check)


def test_stale_workflow_is_not_silently_disconnected(
    context: WebConnectionContext, target: ToolConnectionTarget, selection: NodeConnectionSelection
) -> None:
    with pytest.raises(ConnectionWorkflowChangedError):
        resolve_node_connection_state(
            context, selection=replace(selection, workflow_id="old-version"), target=target, record=None, check=None
        )


def test_wrong_provider_is_a_configuration_error_not_credential_invalidity(
    context: WebConnectionContext,
    target: ToolConnectionTarget,
    selection: NodeConnectionSelection,
    record: ConnectionAccessRecord,
) -> None:
    with pytest.raises(ConnectionConfigurationError):
        resolve_node_connection_state(
            context,
            selection=selection,
            target=replace(target, provider="vendor/other/other"),
            record=record,
            check=checked(record, "valid"),
        )


@pytest.mark.parametrize(
    "status", [NodeConnectionStatus.CONNECTED, NodeConnectionStatus.INVALID, NodeConnectionStatus.RECONNECT_REQUIRED]
)
def test_nondisconnected_state_requires_a_connection(status: NodeConnectionStatus) -> None:
    with pytest.raises(ValidationError):
        NodeConnectionState(workflow_id="workflow", node_id="node", connection_id=None, status=status, check=None)
