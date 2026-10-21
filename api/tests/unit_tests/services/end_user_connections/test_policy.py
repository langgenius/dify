from dataclasses import replace

import pytest

from constants.end_user_connections import ConnectionCredentialType, ConnectionStatus, OAuthClientSource
from services.end_user_connections.entities import (
    ConnectionAccessRecord,
    ConnectionOAuthClient,
    ConnectionOwner,
    ToolConnectionTarget,
    WebConnectionContext,
)
from services.end_user_connections.errors import (
    ConnectionConfigurationError,
    ConnectionNotFoundError,
    ConnectionReauthorizationRequiredError,
    ConnectionWorkflowChangedError,
)
from services.end_user_connections.policy import (
    connection_mutation_guard,
    require_applicable_connection,
    require_creation_target,
    require_owned_connection,
)


@pytest.fixture
def context() -> WebConnectionContext:
    return WebConnectionContext(tenant_id="tenant", app_id="app", end_user_id="user", account_id="account")


@pytest.fixture
def client() -> ConnectionOAuthClient:
    return ConnectionOAuthClient(
        source=OAuthClientSource.WORKSPACE, configuration_id="client-config", client_id="client"
    )


@pytest.fixture
def record(context: WebConnectionContext) -> ConnectionAccessRecord:
    return ConnectionAccessRecord(
        id="connection",
        tenant_id=context.tenant_id,
        owner=context.owner,
        provider="vendor/calendar/calendar",
        credential_type=ConnectionCredentialType.API_KEY,
        status=ConnectionStatus.CONNECTED,
        oauth_client=None,
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


@pytest.mark.parametrize("account_id", [None, "account"])
def test_context_derives_exactly_one_owner(context: WebConnectionContext, account_id: str | None) -> None:
    owner = replace(context, account_id=account_id).owner
    assert owner == ConnectionOwner(account_id=account_id, end_user_id=None if account_id else context.end_user_id)


@pytest.mark.parametrize(("account_id", "end_user_id"), [(None, None), ("a", "u"), ("", None), (None, "")])
def test_ambiguous_or_empty_owner_is_rejected(account_id: str | None, end_user_id: str | None) -> None:
    with pytest.raises(ValueError, match="Connection owner"):
        ConnectionOwner(account_id=account_id, end_user_id=end_user_id)


@pytest.mark.parametrize("field", ["tenant_id", "app_id", "end_user_id", "account_id"])
def test_empty_identity_context_is_rejected(context: WebConnectionContext, field: str) -> None:
    with pytest.raises(ValueError, match="Incomplete connection identity"):
        replace(context, **{field: ""})


def test_account_owner_can_manage_across_apps_in_same_tenant(
    context: WebConnectionContext, record: ConnectionAccessRecord
) -> None:
    other_app = replace(context, app_id="another-app", end_user_id="another-app-user")
    assert require_owned_connection(other_app, record) is record


@pytest.mark.parametrize("case", ["absent", "tenant", "account", "end-user", "unclaimed"])
def test_missing_and_foreign_connections_have_identical_errors(
    context: WebConnectionContext, record: ConnectionAccessRecord, case: str
) -> None:
    candidates = {
        "absent": None,
        "tenant": replace(record, tenant_id="another-tenant"),
        "account": replace(record, owner=ConnectionOwner(account_id="another-account", end_user_id=None)),
        "end-user": replace(record, owner=ConnectionOwner(account_id=None, end_user_id="another-user")),
        "unclaimed": replace(record, owner=ConnectionOwner(account_id=None, end_user_id=context.end_user_id)),
    }
    with pytest.raises(ConnectionNotFoundError, match="^Connection not found\\.$"):
        require_owned_connection(context, candidates[case])


def test_end_user_owner_cannot_reuse_another_apps_identity(
    context: WebConnectionContext, record: ConnectionAccessRecord
) -> None:
    guest = replace(context, account_id=None)
    owned = replace(record, owner=guest.owner)
    assert require_owned_connection(guest, owned) is owned
    with pytest.raises(ConnectionNotFoundError):
        require_owned_connection(replace(guest, app_id="other-app", end_user_id="other-user"), owned)


@pytest.mark.parametrize("status", list(ConnectionStatus))
def test_ownership_and_mutation_guards_do_not_depend_on_current_status(
    context: WebConnectionContext, record: ConnectionAccessRecord, status: ConnectionStatus
) -> None:
    owned = replace(record, status=status)
    guard = connection_mutation_guard(context, owned)
    assert guard.connection_id == record.id
    assert guard.tenant_id == context.tenant_id
    assert guard.owner == context.owner
    assert guard.revision == 3


def test_claimed_connection_is_no_longer_owned_by_guest(
    context: WebConnectionContext, record: ConnectionAccessRecord
) -> None:
    with pytest.raises(ConnectionNotFoundError):
        connection_mutation_guard(replace(context, account_id=None), record)


@pytest.mark.parametrize("credential_type", list(ConnectionCredentialType))
def test_creation_accepts_either_explicitly_allowed_authentication_method(
    context: WebConnectionContext, target: ToolConnectionTarget, credential_type: ConnectionCredentialType
) -> None:
    require_creation_target(
        context, workflow_id=target.workflow_id, node_id=target.node_id, credential_type=credential_type, target=target
    )


@pytest.mark.parametrize("field", ["tenant_id", "app_id", "node_id"])
def test_creation_rejects_wrong_target_scope(
    context: WebConnectionContext, target: ToolConnectionTarget, field: str
) -> None:
    mismatches = {
        "tenant_id": replace(target, tenant_id="other"),
        "app_id": replace(target, app_id="other"),
        "node_id": replace(target, node_id="other"),
    }
    with pytest.raises(ConnectionConfigurationError):
        require_creation_target(
            context,
            workflow_id=target.workflow_id,
            node_id=target.node_id,
            credential_type=ConnectionCredentialType.API_KEY,
            target=mismatches[field],
        )


def test_stale_workflow_reference_cannot_silently_resolve_new_node(
    context: WebConnectionContext, target: ToolConnectionTarget
) -> None:
    with pytest.raises(ConnectionWorkflowChangedError):
        require_creation_target(
            context,
            workflow_id="old-version",
            node_id=target.node_id,
            credential_type=ConnectionCredentialType.API_KEY,
            target=target,
        )


@pytest.mark.parametrize("field", ["allowed_credential_types", "provider_credential_types"])
def test_creation_requires_both_node_and_provider_support(
    context: WebConnectionContext, target: ToolConnectionTarget, field: str
) -> None:
    oauth_only = frozenset({ConnectionCredentialType.OAUTH2})
    mismatches = {
        "allowed_credential_types": replace(target, allowed_credential_types=oauth_only),
        "provider_credential_types": replace(target, provider_credential_types=oauth_only),
    }
    with pytest.raises(ConnectionConfigurationError):
        require_creation_target(
            context,
            workflow_id=target.workflow_id,
            node_id=target.node_id,
            credential_type=ConnectionCredentialType.API_KEY,
            target=mismatches[field],
        )


@pytest.mark.parametrize("missing", [True, False])
def test_oauth_creation_requires_identifiable_client(
    context: WebConnectionContext, target: ToolConnectionTarget, client: ConnectionOAuthClient, missing: bool
) -> None:
    unavailable = None if missing else replace(client, configuration_id=None, client_id=None)
    with pytest.raises(ConnectionConfigurationError):
        require_creation_target(
            context,
            workflow_id=target.workflow_id,
            node_id=target.node_id,
            credential_type=ConnectionCredentialType.OAUTH2,
            target=replace(target, oauth_client=unavailable),
        )


def test_applicability_checks_owner_before_target_errors(
    context: WebConnectionContext, record: ConnectionAccessRecord, target: ToolConnectionTarget
) -> None:
    with pytest.raises(ConnectionNotFoundError):
        require_applicable_connection(
            context,
            replace(record, tenant_id="other-tenant"),
            workflow_id="old-version",
            node_id=target.node_id,
            target=target,
        )


def test_same_provider_nodes_keep_independent_authentication_requirements(
    context: WebConnectionContext, record: ConnectionAccessRecord, target: ToolConnectionTarget
) -> None:
    assert (
        require_applicable_connection(
            context, record, workflow_id=target.workflow_id, node_id=target.node_id, target=target
        )
        is record
    )
    other_node = replace(
        target, node_id="node-2", allowed_credential_types=frozenset({ConnectionCredentialType.OAUTH2})
    )
    with pytest.raises(ConnectionConfigurationError):
        require_applicable_connection(
            context, record, workflow_id=other_node.workflow_id, node_id=other_node.node_id, target=other_node
        )


def test_other_provider_connection_is_not_applicable(
    context: WebConnectionContext, record: ConnectionAccessRecord, target: ToolConnectionTarget
) -> None:
    with pytest.raises(ConnectionConfigurationError):
        require_applicable_connection(
            context,
            replace(record, provider="vendor/other/other"),
            workflow_id=target.workflow_id,
            node_id=target.node_id,
            target=target,
        )


@pytest.mark.parametrize("difference", ["source", "configuration_id", "client_id", "unknown"])
def test_oauth_grant_must_match_the_current_client(
    context: WebConnectionContext,
    record: ConnectionAccessRecord,
    target: ToolConnectionTarget,
    client: ConnectionOAuthClient,
    difference: str,
) -> None:
    grants = {
        "source": replace(client, source=OAuthClientSource.PLATFORM),
        "configuration_id": replace(client, configuration_id="other-config"),
        "client_id": replace(client, client_id="other-client"),
        "unknown": replace(client, configuration_id=None, client_id=None),
    }
    oauth = replace(record, credential_type=ConnectionCredentialType.OAUTH2, oauth_client=grants[difference])
    assert require_owned_connection(context, oauth) is oauth
    with pytest.raises(ConnectionReauthorizationRequiredError):
        require_applicable_connection(
            context, oauth, workflow_id=target.workflow_id, node_id=target.node_id, target=target
        )


def test_matching_client_does_not_certify_token_readiness_or_mutate_status(
    context: WebConnectionContext,
    record: ConnectionAccessRecord,
    target: ToolConnectionTarget,
    client: ConnectionOAuthClient,
) -> None:
    oauth = replace(
        record,
        credential_type=ConnectionCredentialType.OAUTH2,
        oauth_client=client,
        status=ConnectionStatus.INVALID,
    )
    assert (
        require_applicable_connection(
            context, oauth, workflow_id=target.workflow_id, node_id=target.node_id, target=target
        )
        is oauth
    )
    assert oauth.status == ConnectionStatus.INVALID
